"""Unit tests for MarketDataEngine (normalization + event publishing)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from events import InProcessEventBus
from market_data import MarketDataEngine
from brokers.base import RawBar, RawQuote, RawTick
from domain.market import BarInterval, QuoteType
from domain.money import Quantity


def _now() -> datetime:
    return datetime.now(UTC)


class TestMarketDataEngine:
    def test_quote_normalized_and_published(self, aapl, sim_feed, p99, p101, qty10, tick_at):
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        asyncio.run(engine.start())
        received = []

        def on_quote(env):
            received.append(env.payload)

        bus.subscribe("market.quote.updated", on_quote)

        raw = RawQuote(
            instrument=aapl,
            bid=p99,
            ask=p101,
            bid_size=qty10,
            ask_size=qty10,
            timestamp=_now(),  # fresh timestamp so staleness check passes
        )
        asyncio.run(sim_feed.push(raw))

        assert len(received) == 1
        quote = received[0].quote
        assert quote.bid.value == 99
        assert quote.ask.value == 101
        assert quote.mid.value == 100
        assert engine.latest_quote(aapl) is quote
        assert engine.is_stale(aapl) is False

    def test_tick_normalized_and_published(self, aapl, sim_feed, p100, qty10, tick_at):
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        asyncio.run(engine.start())
        received = []

        def on_tick(env):
            received.append(env.payload)

        bus.subscribe("market.tick.updated", on_tick)

        raw = RawTick(
            instrument=aapl,
            quote_type=QuoteType.LAST,
            price=p100,
            volume=qty10,
            timestamp=tick_at,
        )
        asyncio.run(sim_feed.push(raw))

        assert len(received) == 1
        tick = received[0].tick
        assert tick.price.value == 100
        assert tick.quote_type == QuoteType.LAST
        assert engine.latest_tick(aapl) is tick

    def test_bar_normalized_and_published(self, aapl, sim_feed, p100, qty10, tick_at):
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        asyncio.run(engine.start())
        received = []

        def on_bar(env):
            received.append(env.payload)

        bus.subscribe("market.bar.updated", on_bar)

        raw = RawBar(
            instrument=aapl,
            interval=BarInterval.MINUTE,
            open=p100,
            high=p100,
            low=p100,
            close=p100,
            volume=qty10,
            timestamp=tick_at,
        )
        asyncio.run(sim_feed.push(raw))

        assert len(received) == 1
        bar = received[0].bar
        assert bar.interval == BarInterval.MINUTE
        assert bar.open.value == 100
        assert engine.latest_bar(aapl) is bar

    def test_invalid_quote_dropped_without_crash(self, aapl, sim_feed, p99, p101, tick_at):
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        asyncio.run(engine.start())
        received = []

        def on_quote(env):
            received.append(env.payload)

        bus.subscribe("market.quote.updated", on_quote)

        # bid > ask -> domain validation rejects; feed must not crash.
        raw = RawQuote(instrument=aapl, bid=p101, ask=p99, timestamp=tick_at)
        asyncio.run(sim_feed.push(raw))

        assert received == []
        assert engine.latest_quote(aapl) is None

    def test_subscribe_forwarded_to_feed(self, aapl, sim_feed):
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        first = asyncio.run(engine.subscribe(aapl))
        assert first is True
        assert sim_feed.subscribed == [aapl.primary_identifier]
        assert engine.is_subscribed(aapl) is True

    def test_subscribe_idempotent(self, aapl, sim_feed):
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        asyncio.run(engine.subscribe(aapl))
        again = asyncio.run(engine.subscribe(aapl))
        assert again is False
        assert sim_feed.subscribed == [aapl.primary_identifier]

    def test_stop_clears_subscriptions(self, aapl, sim_feed):
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        asyncio.run(engine.start())
        asyncio.run(engine.subscribe(aapl))
        asyncio.run(engine.stop())
        assert sim_feed.stopped is True
        assert sim_feed.subscribed == []