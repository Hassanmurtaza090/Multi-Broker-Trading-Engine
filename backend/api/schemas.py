"""API request/response schemas and serialization (M10).

These are API-layer DTOs — a deliberate serialization boundary. They are NOT
domain models: every Decimal is serialized as a JSON string to preserve
exact financial precision (documented in ADR-016). Mapping helpers are pure
functions; no business logic lives here.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from domain.account import Balance
from domain.instrument import AssetClass, Exchange, Instrument
from domain.market import MarketQuote
from domain.money import Currency, Price, Quantity
from domain.orders import (
    Order,
    OrderRequest,
    OrderSide,
    OrderType,
    TimeInForce,
)
from domain.position import Position
from risk.models import RiskDecision, RuleResult


def dec(value: Decimal | None) -> str | None:
    """Serialize a Decimal as an exact JSON string (never a float).

    Fixed-point formatting avoids scientific notation (e.g. "0E-8" from
    quantized zeros) so clients always see plain decimal strings.
    """
    if value is None:
        return None
    return format(value, "f")


def dec_req(value: Decimal) -> str:
    """Required-value variant of `dec` (non-optional fields)."""
    return format(value, "f")


class StrictModel(BaseModel):
    """Base API model: reject unknown fields (no mass-assignment)."""

    model_config = ConfigDict(extra="forbid")


# --- requests -----------------------------------------------------------------


class InstrumentIn(StrictModel):
    symbol: str = Field(min_length=1, max_length=64)
    asset_class: AssetClass
    currency: str = Field(min_length=3, max_length=3)
    exchange: Exchange = Exchange.UNKNOWN


class OrderCreateIn(StrictModel):
    account_id: str = Field(min_length=1, max_length=128)
    instrument: InstrumentIn
    side: OrderSide
    order_type: OrderType
    quantity: str = Field(min_length=1, max_length=32)
    limit_price: str | None = Field(default=None, max_length=32)
    stop_price: str | None = Field(default=None, max_length=32)
    time_in_force: TimeInForce = TimeInForce.DAY
    idempotency_key: str | None = Field(default=None, max_length=128)


class OrderModifyIn(StrictModel):
    limit_price: str | None = Field(default=None, max_length=32)
    stop_price: str | None = Field(default=None, max_length=32)


class KillSwitchIn(StrictModel):
    active: bool


class MarketQuoteIn(StrictModel):
    symbol: str = Field(min_length=1, max_length=64)
    asset_class: AssetClass
    currency: str = Field(min_length=3, max_length=3)
    exchange: Exchange = Exchange.UNKNOWN


# --- responses ------------------------------------------------------------------


class OrderOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_order_id: UUID
    account_id: str
    symbol: str
    exchange: str
    currency: str
    side: str
    order_type: str
    status: str
    quantity: str
    filled_quantity: str
    remaining_quantity: str
    limit_price: str | None
    stop_price: str | None
    time_in_force: str
    broker_order_id: str | None
    rejection_reason: str | None
    created_at: str
    updated_at: str


class PositionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str
    symbol: str
    exchange: str
    currency: str
    quantity: str
    average_price: str | None
    realized_pnl: str | None
    unrealized_pnl: str | None
    market_price: str | None
    stale: bool


class CashBalanceOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    total: str
    available: str
    buying_power: str | None


class BalanceOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str
    cash: list[CashBalanceOut]


class AccountSummaryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str
    equity: str | None
    exposure: str | None
    realized_pnl: dict[str, str]
    unrealized_pnl: dict[str, str]
    market_value: dict[str, str]


class RuleResultOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule: str
    reason: str | None
    data_unavailable: bool


class RiskDecisionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approved: bool
    violations: list[RuleResultOut]


class BrokerStatusOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    connected: bool


class KillSwitchOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str
    active: bool


class QuoteOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    exchange: str
    currency: str
    bid: str | None
    ask: str | None
    last: str | None
    mid: str | None
    timestamp: str
    stale: bool


class HealthOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    broker: str
    broker_connected: bool


class ErrorOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    detail: str | None = None


class ErrorResponseOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorOut


# --- mapping helpers (pure) -----------------------------------------------------


def build_order_request(body: OrderCreateIn) -> OrderRequest:
    """Translate an API payload into a validated domain `OrderRequest`.

    Domain constructors perform the financial validation (quantities, prices,
    order-type invariants); failures surface as ValueError/ValidationError and
    are mapped to HTTP 400 by the API error handlers.
    """
    instrument = Instrument(
        symbol=body.instrument.symbol,
        asset_class=body.instrument.asset_class,
        currency=Currency(code=body.instrument.currency),
        exchange=body.instrument.exchange,
    )
    return OrderRequest(
        account_id=body.account_id,
        instrument=instrument,
        side=body.side,
        order_type=body.order_type,
        quantity=Quantity(value=Decimal(body.quantity)),
        time_in_force=body.time_in_force,
        limit_price=Price(value=Decimal(body.limit_price), currency=instrument.currency)
        if body.limit_price is not None
        else None,
        stop_price=Price(value=Decimal(body.stop_price), currency=instrument.currency)
        if body.stop_price is not None
        else None,
        idempotency_key=body.idempotency_key,
    )


def build_instrument(body: MarketQuoteIn) -> Instrument:
    return Instrument(
        symbol=body.symbol,
        asset_class=body.asset_class,
        currency=Currency(code=body.currency),
        exchange=body.exchange,
    )


def order_to_out(order: Order) -> OrderOut:
    return OrderOut(
        client_order_id=order.client_order_id,
        account_id=order.account_id,
        symbol=order.instrument.symbol,
        exchange=order.instrument.exchange.value,
        currency=order.instrument.currency.code,
        side=order.side.value,
        order_type=order.order_type.value,
        status=order.status.value,
        quantity=dec_req(order.quantity.value),
        filled_quantity=dec_req(order.filled_quantity.value),
        remaining_quantity=dec_req(order.remaining_quantity.value),
        limit_price=dec(order.limit_price.value) if order.limit_price else None,
        stop_price=dec(order.stop_price.value) if order.stop_price else None,
        time_in_force=order.time_in_force.value,
        broker_order_id=order.broker_order_id,
        rejection_reason=order.rejection_reason,
        created_at=order.created_at.isoformat(),
        updated_at=order.updated_at.isoformat(),
    )


def position_to_out(
    position: Position,
    unrealized: Any,
    market_price: Price | None,
    stale: bool,
) -> PositionOut:
    return PositionOut(
        account_id=position.account_id,
        symbol=position.instrument.symbol,
        exchange=position.instrument.exchange.value,
        currency=position.instrument.currency.code,
        quantity=dec_req(position.quantity.value),
        average_price=dec(position.average_price.value) if position.average_price else None,
        realized_pnl=dec(position.realized_pnl.amount) if position.realized_pnl else None,
        unrealized_pnl=dec(unrealized.amount) if unrealized is not None else None,
        market_price=dec(market_price.value) if market_price is not None else None,
        stale=stale,
    )


def balance_to_out(balance: Balance) -> BalanceOut:
    return BalanceOut(
        account_id=balance.account_id,
        cash=[
            CashBalanceOut(
                currency=code,
                total=dec(entry.total.amount) or "0.00",
                available=dec(entry.available.amount) or "0.00",
                buying_power=dec(entry.buying_power.amount) if entry.buying_power else None,
            )
            for code, entry in sorted(balance.cash.items())
        ],
    )


def quote_to_out(quote: MarketQuote, stale: bool) -> QuoteOut:
    return QuoteOut(
        symbol=quote.instrument.symbol,
        exchange=quote.instrument.exchange.value,
        currency=quote.instrument.currency.code,
        bid=dec(quote.bid.value) if quote.bid else None,
        ask=dec(quote.ask.value) if quote.ask else None,
        last=dec(quote.last.value) if quote.last else None,
        mid=dec(quote.mid.value) if quote.mid else None,
        timestamp=quote.timestamp.isoformat(),
        stale=stale,
    )


def decision_to_out(decision: RiskDecision) -> RiskDecisionOut:
    return RiskDecisionOut(
        approved=decision.approved,
        violations=[
            RuleResultOut(rule=v.rule, reason=v.reason, data_unavailable=v.data_unavailable)
            for v in decision.violations
        ],
    )


def rule_results_out(results: tuple[RuleResult, ...]) -> list[RuleResultOut]:
    return [
        RuleResultOut(rule=r.rule, reason=r.reason, data_unavailable=r.data_unavailable)
        for r in results
    ]
