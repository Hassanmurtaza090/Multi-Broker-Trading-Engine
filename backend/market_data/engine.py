"""Market data engine.

Consumes a `MarketDataFeed` (broker port), normalizes and validates its raw
payloads into domain value objects, tracks staleness, and publishes typed events
on the M2 event bus (`MarketQuoteUpdated`, `MarketTickUpdated`,
`MarketBarUpdated`). It depends only on the broker abstraction and the event
system — never on a specific broker, framework, or database.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from brokers.base import (
    MarketDataFeed,
    RawBar,
    RawQuote,
    RawTick,
)
from domain.instrument import Instrument
from domain.market import Bar, MarketQuote, MarketTick
from events import (
    EventBus,
    MarketBarUpdated,
    MarketQuoteUpdated,
    MarketTickUpdated,
)
from market_data.staleness import StalenessMonitor
from market_data.subscription import SubscriptionManager

logger = logging.getLogger("mtbe.market_data")


class MarketDataEngine:
    """Orchestrates feed subscriptions, normalization, staleness, and events."""

    def __init__(
        self,
        feed: MarketDataFeed,
        bus: EventBus,
        *,
        subscription_manager: SubscriptionManager | None = None,
        staleness: StalenessMonitor | None = None,
    ) -> None:
        self._feed = feed
        self._bus = bus
        self._subs = subscription_manager or SubscriptionManager()
        self._staleness = staleness or StalenessMonitor(max_age=timedelta(seconds=10))
        self._latest_quote: dict[str, MarketQuote] = {}
        self._latest_tick: dict[str, MarketTick] = {}
        self._latest_bar: dict[str, Bar] = {}
        self._running = False
        self._feed.attach_handler(self._on_feed_event)

    @property
    def subscription_manager(self) -> SubscriptionManager:
        return self._subs

    @property
    def staleness_monitor(self) -> StalenessMonitor:
        return self._staleness

    # -- lifecycle ------------------------------------------------------------
    async def start(self) -> None:
        self._running = True
        await self._feed.start()
        logger.info("market_data_started")

    async def stop(self) -> None:
        self._running = False
        await self._subs.cancel_all(self._feed)
        await self._feed.stop()
        logger.info("market_data_stopped")

    # -- subscription ---------------------------------------------------------
    async def subscribe(self, instrument: Instrument) -> bool:
        """Subscribe the engine to `instrument`. Idempotent."""
        return await self._subs.subscribe(instrument, self._feed)

    async def unsubscribe(self, instrument: Instrument) -> bool:
        """Remove one subscription reference to `instrument`."""
        return await self._subs.unsubscribe(instrument, self._feed)

    def is_subscribed(self, instrument: Instrument) -> bool:
        return self._subs.is_subscribed(instrument)

    # -- latest state ---------------------------------------------------------
    def latest_quote(self, instrument: Instrument) -> MarketQuote | None:
        return self._latest_quote.get(instrument.primary_identifier)

    def latest_tick(self, instrument: Instrument) -> MarketTick | None:
        return self._latest_tick.get(instrument.primary_identifier)

    def latest_bar(self, instrument: Instrument) -> Bar | None:
        return self._latest_bar.get(instrument.primary_identifier)

    def is_stale(self, instrument: Instrument) -> bool:
        return self._staleness.is_stale(instrument)

    # -- normalization + dispatch ---------------------------------------------
    async def _on_feed_event(self, event: RawQuote | RawTick | RawBar) -> None:
        try:
            if isinstance(event, RawQuote):
                await self._handle_quote(event)
            elif isinstance(event, RawTick):
                await self._handle_tick(event)
            elif isinstance(event, RawBar):
                await self._handle_bar(event)
        except Exception:  # noqa: BLE001 — a bad payload must not kill the feed
            logger.warning(
                "market_data_drop",
                extra={"event": type(event).__name__},
                exc_info=True,
            )

    async def _handle_quote(self, raw: RawQuote) -> None:
        quote = MarketQuote(
            instrument=raw.instrument,
            bid=raw.bid,
            ask=raw.ask,
            last=raw.last,
            bid_size=raw.bid_size,
            ask_size=raw.ask_size,
            timestamp=raw.timestamp,
        )
        self._latest_quote[raw.instrument.primary_identifier] = quote
        self._staleness.record(raw.instrument, raw.timestamp)
        await self._bus.publish(MarketQuoteUpdated(quote=quote), source="market_data")

    async def _handle_tick(self, raw: RawTick) -> None:
        tick = MarketTick(
            instrument=raw.instrument,
            quote_type=raw.quote_type,
            price=raw.price,
            volume=raw.volume,
            timestamp=raw.timestamp,
        )
        self._latest_tick[raw.instrument.primary_identifier] = tick
        self._staleness.record(raw.instrument, raw.timestamp)
        await self._bus.publish(MarketTickUpdated(tick=tick), source="market_data")

    async def _handle_bar(self, raw: RawBar) -> None:
        bar = Bar(
            instrument=raw.instrument,
            interval=raw.interval,
            open=raw.open,
            high=raw.high,
            low=raw.low,
            close=raw.close,
            volume=raw.volume,
            timestamp=raw.timestamp,
        )
        self._latest_bar[raw.instrument.primary_identifier] = bar
        self._staleness.record(raw.instrument, raw.timestamp)
        await self._bus.publish(MarketBarUpdated(bar=bar), source="market_data")
