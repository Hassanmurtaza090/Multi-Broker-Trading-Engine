"""Multi-Broker Trading Engine — event subsystem (M2).

Public API: `EventBus`/`InProcessEventBus` for production wiring,
`EventEnvelope` for tracing, `DomainEvent` and concrete event types, and a
serializer/registry for wire-format conversion.
"""

from __future__ import annotations

from events.base import DEFAULT_EVENT_VERSION, DomainEvent
from events.bus import (
    AnyHandler,
    EventBus,
    HandlerError,
    InProcessEventBus,
    PublishResult,
    Subscription,
)
from events.envelope import EventEnvelope
from events.registry import (
    DEFAULT_REGISTRY,
    EventRegistry,
    UnknownEventTypeError,
    UnsupportedEventVersionError,
)
from events.serialization import EventSerializer
from events.types import (
    AccountUpdated,
    BalanceUpdated,
    BrokerConnected,
    BrokerDisconnected,
    MarketBarUpdated,
    MarketQuoteUpdated,
    MarketTickUpdated,
    OrderAccepted,
    OrderCancelled,
    OrderExpired,
    OrderFilled,
    OrderModified,
    OrderPartiallyFilled,
    OrderRejected,
    OrderSubmitted,
    PositionClosed,
    PositionOpened,
    PositionUpdated,
    RiskViolation,
)

__all__ = [
    # base / identity
    "DomainEvent",
    "DEFAULT_EVENT_VERSION",
    # envelope
    "EventEnvelope",
    # bus
    "EventBus",
    "InProcessEventBus",
    "Subscription",
    "PublishResult",
    "HandlerError",
    "AnyHandler",
    # serialization
    "EventSerializer",
    "EventRegistry",
    "DEFAULT_REGISTRY",
    "UnknownEventTypeError",
    "UnsupportedEventVersionError",
    # event types — market data
    "MarketQuoteUpdated",
    "MarketTickUpdated",
    "MarketBarUpdated",
    # order lifecycle
    "OrderSubmitted",
    "OrderAccepted",
    "OrderRejected",
    "OrderCancelled",
    "OrderModified",
    "OrderPartiallyFilled",
    "OrderFilled",
    "OrderExpired",
    # position
    "PositionOpened",
    "PositionUpdated",
    "PositionClosed",
    # account
    "AccountUpdated",
    "BalanceUpdated",
    # broker connectivity
    "BrokerConnected",
    "BrokerDisconnected",
    # risk
    "RiskViolation",
]
