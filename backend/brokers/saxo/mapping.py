"""Saxo ↔ internal translation (pure functions, no state).

All Saxo-specific knowledge lives here and in `contracts.py`:

- Instrument ↔ SaxoInstrument (asset class ↔ AssetType; UIC travels in the
  broker-neutral `identifiers` dict under "SAXO_UIC" — the existing
  architecture's broker-neutral identifier field)
- internal Order → SaxoOrder (BuySell, Market/Limit/Stop/StopLimit, durations;
  ExternalReference carries the client_order_id)
- Saxo status string → ExecutionReportType (fill statuses are intentionally
  unmapped — executions carry the fills; Saxo additionally reports Expired)
- SaxoExecution → Fill (buy/sell, unix → UTC)
- SaxoBalance → Balance (full snapshot per currency)
- SaxoPosition → domain Position
- Saxo error codes → BrokerError with stable ErrorCode + preserved diagnostics
- Saxo bar intervals → BarInterval
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from brokers.saxo.contracts import (
    SAXO_CANCELLED,
    SAXO_ERROR_AUTH_REQUIRED,
    SAXO_ERROR_INTERNAL,
    SAXO_ERROR_NOT_FOUND,
    SAXO_ERROR_PERMISSION,
    SAXO_ERROR_RATE_LIMIT,
    SAXO_ERROR_SERVICE_UNAVAILABLE,
    SAXO_EXPIRED,
    SAXO_REJECTED,
    SAXO_WAITING_CONFIRMATION,
    SAXO_WORKING,
    SaxoBalance,
    SaxoExecution,
    SaxoInstrument,
    SaxoOrder,
    SaxoPosition,
)
from domain.account import Balance, CashBalance
from domain.errors import BrokerError, ErrorCode
from domain.fills import ExecutionReportType, Fill
from domain.instrument import AssetClass, Exchange, Instrument, InstrumentType
from domain.market import BarInterval
from domain.money import Currency, Money, Price, Quantity
from domain.orders import Order, OrderSide, OrderType, TimeInForce
from domain.position import Position

SAXO_UIC_KEY = "SAXO_UIC"

# --- instrument <-> Saxo instrument --------------------------------------------

_ASSET_TO_SAXO_TYPE: dict[AssetClass, str] = {
    AssetClass.EQUITY: "Stock",
    AssetClass.FOREX: "FxSpot",
    AssetClass.FUTURE: "Future",
    AssetClass.OPTION: "Option",
    AssetClass.CFD: "Cfd",
    AssetClass.BOND: "Bond",
    AssetClass.FUND: "MutualFund",
}

_SAXO_TYPE_TO_ASSET: dict[str, AssetClass] = {v: k for k, v in _ASSET_TO_SAXO_TYPE.items()}

_SAXO_TYPE_TO_INSTRUMENT_TYPE: dict[str, InstrumentType | None] = {
    "Stock": InstrumentType.STOCK,
    "FxSpot": InstrumentType.CURRENCY_PAIR,
    "Future": InstrumentType.CONTRACT,
    "Option": InstrumentType.CONTRACT,
}


def instrument_to_saxo(instrument: Instrument) -> SaxoInstrument:
    """Map the canonical instrument to a Saxo instrument reference.

    The Saxo UIC MUST be present in the broker-neutral `identifiers` dict
    (key "SAXO_UIC") — the adapter never guesses instrument identifiers.
    """
    asset_type = _ASSET_TO_SAXO_TYPE.get(instrument.asset_class)
    if asset_type is None:
        raise BrokerError(
            f"unsupported asset class for Saxo: {instrument.asset_class.value}",
            broker="SAXO",
            broker_error_code="UNSUPPORTED_ASSET_TYPE",
        )
    uic_raw = instrument.identifiers.get(SAXO_UIC_KEY)
    if uic_raw is None:
        raise BrokerError(
            f"instrument {instrument.symbol} has no {SAXO_UIC_KEY} identifier",
            broker="SAXO",
            broker_error_code="MISSING_UIC",
        )
    try:
        uic = int(uic_raw)
    except ValueError as exc:
        raise BrokerError(
            f"invalid {SAXO_UIC_KEY} identifier: {uic_raw!r}",
            broker="SAXO",
            broker_error_code="INVALID_UIC",
        ) from exc
    return SaxoInstrument(
        uic=uic,
        asset_type=asset_type,
        symbol=instrument.symbol,
        currency=instrument.currency.code,
        exchange=instrument.exchange.value,
    )


def saxo_to_instrument(saxo: SaxoInstrument) -> Instrument:
    """Map a Saxo instrument reference to the canonical instrument."""
    asset_class = _SAXO_TYPE_TO_ASSET.get(saxo.asset_type)
    if asset_class is None:
        raise BrokerError(
            f"unsupported Saxo AssetType: {saxo.asset_type!r}",
            broker="SAXO",
            broker_error_code="UNSUPPORTED_ASSET_TYPE",
        )
    if saxo.asset_type == "FxSpot":
        exchange = Exchange.OTC
    else:
        exchange = _saxo_exchange_to_internal(saxo.exchange)
    return Instrument(
        symbol=saxo.symbol,
        asset_class=asset_class,
        currency=Currency(code=saxo.currency),
        instrument_type=_SAXO_TYPE_TO_INSTRUMENT_TYPE.get(saxo.asset_type),
        exchange=exchange,
        identifiers={SAXO_UIC_KEY: str(saxo.uic)},
    )


def _saxo_exchange_to_internal(exchange: str | None) -> Exchange:
    if exchange is None or exchange == "SMART" or exchange == "":
        return Exchange.UNKNOWN
    try:
        return Exchange(exchange)
    except ValueError:
        return Exchange.UNKNOWN


# --- order -> Saxo order ---------------------------------------------------------

_ORDER_TYPE_TO_SAXO: dict[OrderType, str] = {
    OrderType.MARKET: "Market",
    OrderType.LIMIT: "Limit",
    OrderType.STOP: "Stop",
    OrderType.STOP_LIMIT: "StopLimit",
}

_TIF_TO_SAXO: dict[TimeInForce, str] = {
    TimeInForce.DAY: "Day",
    TimeInForce.GTC: "Gtc",
    TimeInForce.IOC: "Ioc",
    TimeInForce.FOK: "Fok",
    TimeInForce.GTD: "Gtd",
}


def order_to_saxo(order: Order, *, account_key: str, saxo: SaxoInstrument) -> SaxoOrder:
    """Map an internal order to a Saxo order (ExternalReference = client id)."""
    return SaxoOrder(
        account_key=account_key,
        uic=saxo.uic,
        asset_type=saxo.asset_type,
        buy_sell="buy" if order.side is OrderSide.BUY else "sell",
        order_type=_ORDER_TYPE_TO_SAXO[order.order_type],
        quantity=str(order.quantity.value),
        order_duration=_TIF_TO_SAXO[order.time_in_force],
        limit_price=str(order.limit_price.value) if order.limit_price is not None else None,
        stop_price=str(order.stop_price.value) if order.stop_price is not None else None,
        external_reference=str(order.client_order_id),
    )


# --- status -> report type ----------------------------------------------------------

_ACCEPTED_STATUSES = frozenset({SAXO_WORKING, SAXO_WAITING_CONFIRMATION})


def order_status_to_report_type(status: str) -> ExecutionReportType:
    """Map a Saxo order status to the internal report type.

    Pre-ack ("Received"), suspended, and fill states raise ValueError: they
    are not order confirmations, and fills arrive via executions.
    """
    if status in _ACCEPTED_STATUSES:
        return ExecutionReportType.ACCEPTED
    if status == SAXO_CANCELLED:
        return ExecutionReportType.CANCELLED
    if status == SAXO_REJECTED:
        return ExecutionReportType.REJECTED
    if status == SAXO_EXPIRED:
        return ExecutionReportType.EXPIRED
    raise ValueError(f"unmapped Saxo order status: {status!r}")


# --- execution -> fill ------------------------------------------------------------------

_SAXO_SIDE = {"buy": OrderSide.BUY, "sell": OrderSide.SELL}


def execution_to_fill(
    execution: SaxoExecution,
    instrument: Instrument,
    *,
    account_id: str,
) -> Fill:
    """Map a Saxo execution to an internal fill."""
    side = _SAXO_SIDE.get(execution.buy_sell)
    if side is None:
        raise BrokerError(
            f"unexpected Saxo execution side: {execution.buy_sell!r}",
            broker="SAXO",
            broker_error_code="INVALID_SIDE",
        )
    try:
        client_order_id: UUID = UUID(execution.external_reference or "")
    except ValueError as exc:
        raise BrokerError(
            "Saxo execution missing a valid ExternalReference (client_order_id)",
            broker="SAXO",
            broker_error_code="MISSING_EXTERNAL_REFERENCE",
        ) from exc
    return Fill(
        fill_id=execution.execution_id,
        order_client_id=client_order_id,
        account_id=account_id,
        instrument=instrument,
        side=side,
        quantity=Quantity(value=Decimal(execution.quantity)),
        price=Price(value=Decimal(execution.price), currency=instrument.currency),
        executed_at=datetime.fromtimestamp(execution.executed_at_unix, tz=UTC),
    )


# --- balance -> domain Balance --------------------------------------------------------


def balance_to_domain(account_id: str, saxo: SaxoBalance) -> Balance:
    """Map a Saxo balance snapshot to a per-currency `Balance`."""
    if not saxo.currency:
        raise BrokerError(
            "Saxo balance missing currency",
            broker="SAXO",
            broker_error_code="NO_ACCOUNT_DATA",
        )
    currency = Currency(code=saxo.currency)
    return Balance(
        account_id=account_id,
        cash={
            saxo.currency: CashBalance(
                currency=currency,
                total=Money(amount=Decimal(saxo.cash_amount), currency=currency),
                available=Money(amount=Decimal(saxo.available), currency=currency),
                buying_power=(
                    Money(amount=Decimal(saxo.margin_available), currency=currency)
                    if saxo.margin_available is not None
                    else None
                ),
            )
        },
    )


# --- position -> domain position --------------------------------------------------------


def position_to_domain(saxo: SaxoPosition) -> Position:
    """Map a Saxo position to the domain model (under the internal account)."""
    instrument = saxo_to_instrument(
        SaxoInstrument(
            uic=saxo.uic,
            asset_type=saxo.asset_type,
            symbol=saxo.symbol,
            currency=saxo.currency,
            exchange=saxo.exchange,
        )
    )
    return Position(
        account_id=saxo.account_key,
        instrument=instrument,
        quantity=Quantity(value=Decimal(saxo.position_size)),
        average_price=(
            Price(value=Decimal(saxo.average_open_price), currency=instrument.currency)
            if saxo.average_open_price is not None
            else None
        ),
    )


# --- errors -----------------------------------------------------------------------------

_ERROR_CODE_MAP: dict[int, ErrorCode] = {
    SAXO_ERROR_AUTH_REQUIRED: ErrorCode.UNAUTHORIZED,
    SAXO_ERROR_PERMISSION: ErrorCode.UNAUTHORIZED,
    SAXO_ERROR_NOT_FOUND: ErrorCode.NOT_FOUND,
    SAXO_ERROR_RATE_LIMIT: ErrorCode.RATE_LIMITED,
    SAXO_ERROR_INTERNAL: ErrorCode.UNAVAILABLE,
    SAXO_ERROR_SERVICE_UNAVAILABLE: ErrorCode.CONNECTION_LOST,
}


def map_saxo_error(code: int, message: str) -> BrokerError:
    """Translate a Saxo API error into the internal `BrokerError` hierarchy.

    The raw Saxo code/message are preserved for diagnostics; the core only
    sees the stable internal error code. Messages never contain tokens.
    """
    return BrokerError(
        f"Saxo error {code}: {message}",
        broker="SAXO",
        broker_error_code=str(code),
        code=_ERROR_CODE_MAP.get(code, ErrorCode.UNKNOWN),
    )


# --- bars -------------------------------------------------------------------------------

_SAXO_INTERVALS: dict[str, BarInterval] = {
    "1m": BarInterval.MINUTE,
    "5m": BarInterval.MINUTE_5,
    "15m": BarInterval.MINUTE_15,
    "30m": BarInterval.MINUTE_30,
    "1h": BarInterval.HOUR,
    "1d": BarInterval.DAY,
    "1w": BarInterval.WEEK,
    "1M": BarInterval.MONTH,
}


def saxo_interval_to_bar_interval(interval: str) -> BarInterval:
    """Map a Saxo interval string to the internal interval."""
    mapped = _SAXO_INTERVALS.get(interval)
    if mapped is None:
        raise BrokerError(
            f"unsupported Saxo interval: {interval!r}",
            broker="SAXO",
            broker_error_code="UNSUPPORTED_INTERVAL",
        )
    return mapped
