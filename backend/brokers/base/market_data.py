"""Market-data feed abstraction (broker port).

This is the contract broker adapters (IBKR, Saxo) implement to stream market
data into the engine. The core market-data engine (`backend/market_data`) depends
only on this abstraction — never on a specific broker. A simulated feed (used by
tests) also implements this protocol.

The feed delivers **normalized raw payloads** (`RawQuote`, `RawTick`, `RawBar`)
that are already mapped to domain types (Price, Quantity, Instrument). The
engine is responsible for turning these into validated domain value objects and
publishing typed events on the event bus.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from domain.instrument import Instrument
from domain.market import BarInterval, QuoteType
from domain.money import Price, Quantity


def _now_utc() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True, slots=True)
class RawQuote:
    """A two-sided (or single-sided) quote as delivered by a broker feed."""

    instrument: Instrument
    bid: Price | None = None
    ask: Price | None = None
    last: Price | None = None
    bid_size: Quantity | None = None
    ask_size: Quantity | None = None
    timestamp: datetime = field(default_factory=_now_utc)


@dataclass(frozen=True, slots=True)
class RawTick:
    """A single price tick as delivered by a broker feed."""

    instrument: Instrument
    quote_type: QuoteType
    price: Price
    volume: Quantity | None = None
    timestamp: datetime = field(default_factory=_now_utc)


@dataclass(frozen=True, slots=True)
class RawBar:
    """An OHLCV bar as delivered by a broker feed."""

    instrument: Instrument
    interval: BarInterval
    open: Price
    high: Price
    low: Price
    close: Price
    volume: Quantity
    timestamp: datetime = field(default_factory=_now_utc)


FeedEvent = RawQuote | RawTick | RawBar


class FeedHandler(Protocol):
    """Async callback the engine installs to receive feed events."""

    async def __call__(self, event: FeedEvent) -> None: ...


class FeedSubscription(Protocol):
    """Opaque handle to an active feed subscription.

    `instrument` identifies the subscription; `cancel()` detaches it from the
    feed (used when the engine unsubscribes).
    """

    instrument: Instrument

    async def cancel(self) -> None: ...


class MarketDataFeed(Protocol):
    """Broker adapter contract for streaming market data.

    Lifecycle: a feed is created (per account/connection), `start()` begins
    streaming, `stop()` ends it. A handler installed via `attach_handler`
    receives every normalized `FeedEvent`. The engine subscribes to instruments
    it cares about via `subscribe`/`unsubscribe`.
    """

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    def attach_handler(self, handler: FeedHandler) -> None: ...

    async def subscribe(self, instrument: Instrument) -> FeedSubscription: ...

    async def unsubscribe(self, subscription: FeedSubscription) -> None: ...
