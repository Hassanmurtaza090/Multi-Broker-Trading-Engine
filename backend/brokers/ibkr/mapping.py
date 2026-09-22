"""IBKR ↔ internal translation (pure functions, no state).

All IBKR-specific knowledge lives here and in `contracts.py`. The mapping is
one-directional per artifact and never imports infrastructure:

- Instrument ↔ IbkrContract (asset class ↔ sec type, exchange names, FX pairs)
- internal Order → IbkrOrder (side/type/TIF/prices; orderRef carries the
  client_order_id)
- IBKR status string → ExecutionReportType
- IbkrExecution → Fill (BOT/SLD → side, unix → UTC)
- IbkrAccountValue list → Balance (cash totals/available/buying power)
- IbkrPosition → domain Position
- IBKR error codes → BrokerError with stable ErrorCode + preserved diagnostics
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from brokers.ibkr.contracts import (
    IBKR_API_CANCELLED,
    IBKR_CANCELLED,
    IBKR_ERROR_ALREADY_CONNECTED,
    IBKR_ERROR_CONN_LOST,
    IBKR_ERROR_CONNECT_FAIL,
    IBKR_ERROR_INVALID_CONTRACT,
    IBKR_ERROR_MD_NOT_SUBSCRIBED,
    IBKR_ERROR_NOT_CONNECTED,
    IBKR_ERROR_ORDER_REJECTED,
    IBKR_INACTIVE,
    IBKR_PRE_SUBMITTED,
    IBKR_SUBMITTED,
    IbkrAccountValue,
    IbkrContract,
    IbkrExecution,
    IbkrOrder,
    IbkrPosition,
)
from domain.account import Balance, CashBalance
from domain.errors import BrokerError, ErrorCode
from domain.fills import ExecutionReportType, Fill
from domain.instrument import AssetClass, Exchange, Instrument, InstrumentType
from domain.market import BarInterval
from domain.money import Currency, Money, Price, Quantity
from domain.orders import Order, OrderSide, OrderType, TimeInForce
from domain.position import Position

# --- instrument <-> contract -------------------------------------------------

_ASSET_TO_SEC_TYPE: dict[AssetClass, str] = {
    AssetClass.EQUITY: "STK",
    AssetClass.FOREX: "CASH",
    AssetClass.FUTURE: "FUT",
    AssetClass.OPTION: "OPT",
    AssetClass.CFD: "CFD",
    AssetClass.BOND: "BOND",
    AssetClass.FUND: "FUND",
    AssetClass.CRYPTO: "CRYPTO",
}

_SEC_TYPE_TO_ASSET: dict[str, AssetClass] = {v: k for k, v in _ASSET_TO_SEC_TYPE.items()}

_SEC_TYPE_TO_INSTRUMENT_TYPE: dict[str, InstrumentType | None] = {
    "STK": InstrumentType.STOCK,
    "CASH": InstrumentType.CURRENCY_PAIR,
    "FUT": InstrumentType.CONTRACT,
    "OPT": InstrumentType.CONTRACT,
}

# Internal Exchange → IBKR exchange string. UNKNOWN/OTC route via SMART.
_EXCHANGE_TO_IBKR: dict[Exchange, str] = {
    Exchange.NYSE: "NYSE",
    Exchange.NASDAQ: "NASDAQ",
    Exchange.AMEX: "AMEX",
    Exchange.ARCA: "ARCA",
    Exchange.CBOE: "CBOE",
    Exchange.CME: "CME",
    Exchange.ICE: "ICE",
    Exchange.LSE: "LSE",
    Exchange.EURONEXT: "EURONEXT",
}
_IBKR_EXCHANGE_DEFAULT = "SMART"


def instrument_to_contract(instrument: Instrument) -> IbkrContract:
    """Map the canonical instrument to an IBKR contract.

    FOREX pairs ("EUR/USD") map to IBKR CASH contracts (symbol=base,
    currency=quote). A known CON_ID in `identifiers` is preserved.
    """
    sec_type = _ASSET_TO_SEC_TYPE.get(instrument.asset_class)
    if sec_type is None:
        raise BrokerError(
            f"unsupported asset class for IBKR: {instrument.asset_class.value}",
            broker="IBKR",
            broker_error_code="UNSUPPORTED_SEC_TYPE",
        )
    currency = instrument.currency.code
    exchange = _EXCHANGE_TO_IBKR.get(instrument.exchange, _IBKR_EXCHANGE_DEFAULT)
    if instrument.asset_class is AssetClass.FOREX:
        symbol, _, quote = instrument.symbol.partition("/")
        if not symbol or not quote:
            raise BrokerError(
                f"invalid FOREX symbol for IBKR: {instrument.symbol!r}",
                broker="IBKR",
                broker_error_code="INVALID_FX_SYMBOL",
            )
        return IbkrContract(
            symbol=symbol,
            sec_type="CASH",
            exchange="IDEALPRO",
            currency=quote,
            con_id=_con_id_of(instrument),
        )
    return IbkrContract(
        symbol=instrument.symbol,
        sec_type=sec_type,
        exchange=exchange,
        currency=currency,
        con_id=_con_id_of(instrument),
    )


def contract_to_instrument(contract: IbkrContract) -> Instrument:
    """Map an IBKR contract to the canonical instrument."""
    asset_class = _SEC_TYPE_TO_ASSET.get(contract.sec_type)
    if asset_class is None:
        raise BrokerError(
            f"unsupported IBKR sec type: {contract.sec_type!r}",
            broker="IBKR",
            broker_error_code="UNSUPPORTED_SEC_TYPE",
        )
    if contract.sec_type == "CASH":
        symbol = f"{contract.symbol}/{contract.currency}"
        exchange = Exchange.OTC
    else:
        symbol = contract.symbol
        exchange = _ibkr_exchange_to_internal(contract.exchange)
    identifiers: dict[str, str] = {}
    if contract.con_id is not None:
        identifiers["CON_ID"] = str(contract.con_id)
    return Instrument(
        symbol=symbol,
        asset_class=asset_class,
        currency=Currency(code=contract.currency),
        instrument_type=_SEC_TYPE_TO_INSTRUMENT_TYPE.get(contract.sec_type),
        exchange=exchange,
        identifiers=identifiers,
    )


def _con_id_of(instrument: Instrument) -> int | None:
    raw = instrument.identifiers.get("CON_ID")
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise BrokerError(
            "invalid CON_ID identifier",
            broker="IBKR",
            broker_error_code="INVALID_CON_ID",
        ) from exc


def _ibkr_exchange_to_internal(exchange: str) -> Exchange:
    for internal, ibkr in _EXCHANGE_TO_IBKR.items():
        if ibkr == exchange:
            return internal
    if exchange == _IBKR_EXCHANGE_DEFAULT:
        return Exchange.UNKNOWN
    return Exchange.UNKNOWN


# --- order -> IBKR order -------------------------------------------------------

_ORDER_TYPE_TO_IBKR: dict[OrderType, str] = {
    OrderType.MARKET: "MKT",
    OrderType.LIMIT: "LMT",
    OrderType.STOP: "STP",
    OrderType.STOP_LIMIT: "STP LMT",
}

_TIF_TO_IBKR: dict[TimeInForce, str] = {
    TimeInForce.DAY: "DAY",
    TimeInForce.GTC: "GTC",
    TimeInForce.IOC: "IOC",
    TimeInForce.FOK: "FOK",
    TimeInForce.GTD: "GTD",
}


def order_to_ibkr(order: Order) -> IbkrOrder:
    """Map an internal order to an IBKR order (orderRef = client_order_id)."""
    return IbkrOrder(
        action=order.side.value,
        order_type=_ORDER_TYPE_TO_IBKR[order.order_type],
        quantity=str(order.quantity.value),
        lmt_price=str(order.limit_price.value) if order.limit_price is not None else None,
        aux_price=str(order.stop_price.value) if order.stop_price is not None else None,
        tif=_TIF_TO_IBKR[order.time_in_force],
        order_ref=str(order.client_order_id),
    )


# --- status -> report type -------------------------------------------------------

_ACCEPTED_STATUSES = frozenset({IBKR_SUBMITTED, IBKR_PRE_SUBMITTED})


def order_status_to_report_type(status: str) -> ExecutionReportType:
    """Map an IBKR order-status string to the internal report type.

    Pre-ack states (ApiPending/PendingSubmit) and fill states raise ValueError:
    pre-acks are not order confirmations, and fills arrive via executions.
    """
    if status in _ACCEPTED_STATUSES:
        return ExecutionReportType.ACCEPTED
    if status in (IBKR_API_CANCELLED, IBKR_CANCELLED):
        return ExecutionReportType.CANCELLED
    if status == IBKR_INACTIVE:
        return ExecutionReportType.REJECTED
    raise ValueError(f"unmapped IBKR order status: {status!r}")


# --- execution -> fill -----------------------------------------------------------

_IBKR_SIDE = {"BOT": OrderSide.BUY, "SLD": OrderSide.SELL}


def execution_to_fill(
    execution: IbkrExecution,
    instrument: Instrument,
    *,
    account_id: str,
) -> Fill:
    """Map an IBKR execution to an internal fill.

    `account_id` comes from the adapter's configured account; the internal
    `client_order_id` is recovered from the IBKR `orderRef`.
    """
    side = _IBKR_SIDE.get(execution.side)
    if side is None:
        raise BrokerError(
            f"unexpected IBKR execution side: {execution.side!r}",
            broker="IBKR",
            broker_error_code="INVALID_SIDE",
        )
    from uuid import UUID

    try:
        client_order_id: UUID = UUID(execution.order_ref or "")
    except ValueError as exc:
        raise BrokerError(
            "IBKR execution missing a valid orderRef (client_order_id)",
            broker="IBKR",
            broker_error_code="MISSING_ORDER_REF",
        ) from exc
    return Fill(
        fill_id=execution.execution_id,
        order_client_id=client_order_id,
        account_id=account_id,
        instrument=instrument,
        side=side,
        quantity=Quantity(value=Decimal(execution.quantity)),
        price=Price(value=Decimal(execution.price), currency=Currency(code=execution.currency)),
        executed_at=datetime.fromtimestamp(execution.executed_at_unix, tz=UTC),
    )


# --- account values -> balance ----------------------------------------------------

_BALANCE_KEYS = ("TotalCashValue", "AvailableFunds", "BuyingPower")


def account_values_to_balance(account_id: str, values: list[IbkrAccountValue]) -> Balance:
    """Aggregate IBKR account values into a per-currency `Balance`."""
    per_currency: dict[str, dict[str, Money]] = {}
    for value in values:
        if value.key not in _BALANCE_KEYS:
            continue
        bucket = per_currency.setdefault(value.currency, {})
        bucket[value.key] = Money(
            amount=Decimal(value.value), currency=Currency(code=value.currency)
        )
    if not per_currency:
        raise BrokerError(
            "no usable IBKR account values for balance",
            broker="IBKR",
            broker_error_code="NO_ACCOUNT_DATA",
        )
    cash: dict[str, CashBalance] = {}
    for currency, bucket in per_currency.items():
        total = bucket.get("TotalCashValue")
        available = bucket.get("AvailableFunds", total)
        if total is None or available is None:
            raise BrokerError(
                f"missing TotalCashValue for currency {currency}",
                broker="IBKR",
                broker_error_code="NO_ACCOUNT_DATA",
            )
        cash[currency] = CashBalance(
            currency=Currency(code=currency),
            total=total,
            available=available,
            buying_power=bucket.get("BuyingPower"),
        )
    return Balance(account_id=account_id, cash=cash)


# --- position -> domain position ----------------------------------------------------


def ibkr_position_to_position(ibkr_position: IbkrPosition) -> Position:
    """Map an IBKR portfolio position to the domain model."""
    instrument = contract_to_instrument(ibkr_position.contract)
    avg_price = (
        Price(value=Decimal(ibkr_position.avg_cost), currency=instrument.currency)
        if ibkr_position.avg_cost is not None
        else None
    )
    return Position(
        account_id=ibkr_position.account,
        instrument=instrument,
        quantity=Quantity(value=Decimal(ibkr_position.position)),
        average_price=avg_price,
    )


# --- errors ---------------------------------------------------------------------------

_ERROR_CODE_MAP: dict[int, ErrorCode] = {
    IBKR_ERROR_CONNECT_FAIL: ErrorCode.CONNECTION_LOST,
    IBKR_ERROR_ALREADY_CONNECTED: ErrorCode.CONFLICT,
    IBKR_ERROR_NOT_CONNECTED: ErrorCode.CONNECTION_LOST,
    IBKR_ERROR_CONN_LOST: ErrorCode.CONNECTION_LOST,
    IBKR_ERROR_INVALID_CONTRACT: ErrorCode.INVALID_ARGUMENT,
    IBKR_ERROR_ORDER_REJECTED: ErrorCode.ORDER_REJECTED,
    IBKR_ERROR_MD_NOT_SUBSCRIBED: ErrorCode.UNAVAILABLE,
}


def map_ibkr_error(code: int, message: str) -> BrokerError:
    """Translate an IBKR error into the internal `BrokerError` hierarchy.

    The raw IBKR code/message are preserved for diagnostics; the core only
    sees the stable internal error code.
    """
    return BrokerError(
        f"IBKR error {code}: {message}",
        broker="IBKR",
        broker_error_code=str(code),
        code=_ERROR_CODE_MAP.get(code, ErrorCode.UNKNOWN),
    )


# --- bars -------------------------------------------------------------------------------

_IBKR_BAR_SIZES: dict[str, BarInterval] = {
    "1 secs": BarInterval.SECOND,
    "1 min": BarInterval.MINUTE,
    "5 mins": BarInterval.MINUTE_5,
    "15 mins": BarInterval.MINUTE_15,
    "30 mins": BarInterval.MINUTE_30,
    "1 hour": BarInterval.HOUR,
    "1 day": BarInterval.DAY,
    "1 week": BarInterval.WEEK,
    "1 month": BarInterval.MONTH,
}


def ibkr_bar_size_to_interval(bar_size: str) -> BarInterval:
    """Map an IBKR bar-size string to the internal interval."""
    interval = _IBKR_BAR_SIZES.get(bar_size)
    if interval is None:
        raise BrokerError(
            f"unsupported IBKR bar size: {bar_size!r}",
            broker="IBKR",
            broker_error_code="UNSUPPORTED_BAR_SIZE",
        )
    return interval
