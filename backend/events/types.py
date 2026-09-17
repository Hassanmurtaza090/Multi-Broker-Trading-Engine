"""Concrete domain event types for M2.

All events reuse the M1 domain models directly (Order, Position, Instrument,
MarketQuote, Balance, ...) — no duplicated broker- or event-specific copies.
Each event declares a stable `__event_type__` string and inherits `version = 1`.
"""

from __future__ import annotations

from pydantic import Field

from domain.account import Balance
from domain.fills import Fill
from domain.instrument import Instrument
from domain.market import Bar, MarketQuote, MarketTick
from domain.orders import Order, OrderRequest
from domain.position import Position
from events.base import DomainEvent


# --- Market data -------------------------------------------------------------
class MarketQuoteUpdated(DomainEvent):
    """A market quote for an instrument was received/normalized."""

    __event_type__ = "market.quote.updated"

    quote: MarketQuote


class MarketTickUpdated(DomainEvent):
    """A raw price tick was received/normalized for an instrument."""

    __event_type__ = "market.tick.updated"

    tick: MarketTick


class MarketBarUpdated(DomainEvent):
    """An OHLCV bar was received/normalized for an instrument."""

    __event_type__ = "market.bar.updated"

    bar: Bar


# --- Order lifecycle ---------------------------------------------------------
class OrderSubmitted(DomainEvent):
    """An order was submitted to the broker (accepted transport, pending ack)."""

    __event_type__ = "order.submitted"

    order: Order
    # The request that produced the order (carries idempotency_key), if known.
    request: OrderRequest | None = None


class OrderAccepted(DomainEvent):
    """The broker acknowledged and accepted the order (working)."""

    __event_type__ = "order.accepted"

    order: Order


class OrderRejected(DomainEvent):
    """The broker (or risk engine) rejected the order."""

    __event_type__ = "order.rejected"

    order: Order
    reason: str = Field(default="", max_length=512)


class OrderCancelled(DomainEvent):
    """The order was cancelled."""

    __event_type__ = "order.cancelled"

    order: Order


class OrderModified(DomainEvent):
    """A working order's terms (price fields) were modified locally.

    The change is reflected in the order payload; broker confirmation of the
    replace is handled by the execution layer (M5).
    """

    __event_type__ = "order.modified"

    order: Order


class OrderPartiallyFilled(DomainEvent):
    """A partial execution occurred against the order."""

    __event_type__ = "order.partially_filled"

    order: Order
    fill: Fill


class OrderFilled(DomainEvent):
    """The order was fully filled."""

    __event_type__ = "order.filled"

    order: Order
    fill: Fill


class OrderExpired(DomainEvent):
    """The order expired before being filled."""

    __event_type__ = "order.expired"

    order: Order


# --- Position lifecycle ------------------------------------------------------
class PositionOpened(DomainEvent):
    """A new position was opened (previously flat)."""

    __event_type__ = "position.opened"

    position: Position


class PositionUpdated(DomainEvent):
    """An existing position changed (size or average price)."""

    __event_type__ = "position.updated"

    position: Position
    fill: Fill | None = None


class PositionClosed(DomainEvent):
    """A position returned to flat."""

    __event_type__ = "position.closed"

    position: Position


# --- Account -----------------------------------------------------------------
class AccountUpdated(DomainEvent):
    """An account's metadata/state changed."""

    __event_type__ = "account.updated"

    account_id: str = Field(min_length=1)


class BalanceUpdated(DomainEvent):
    """A balance changed on an account."""

    __event_type__ = "balance.updated"

    balance: Balance


# --- Broker connectivity -----------------------------------------------------
class BrokerConnected(DomainEvent):
    """A broker adapter established connectivity."""

    __event_type__ = "broker.connected"

    broker: str = Field(min_length=1)
    account_id: str | None = None


class BrokerDisconnected(DomainEvent):
    """A broker adapter lost connectivity."""

    __event_type__ = "broker.disconnected"

    broker: str = Field(min_length=1)
    account_id: str | None = None
    reason: str = Field(default="", max_length=256)


# --- Risk --------------------------------------------------------------------
class RiskViolation(DomainEvent):
    """A risk check rejected an operation."""

    __event_type__ = "risk.violation"

    account_id: str = Field(min_length=1)
    instrument: Instrument | None = None
    rule: str = Field(default="", max_length=128)
    message: str = Field(default="", max_length=512)
    order: Order | None = None
