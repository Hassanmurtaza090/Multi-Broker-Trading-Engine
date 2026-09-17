"""Integration tests: SimulatedFeed -> MarketDataEngine -> EventBus -> handlers."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from events import InProcessEventBus
from market_data import MarketDataEngine
from market_data.staleness import StalenessMonitor
from brokers.base import RawBar, RawQuote, RawTick
from domain.market import BarInterval, QuoteType


def _now() -> datetime:
    return datetime.now(UTC)


class TestMarketDataEngineIntegration:
    def test_feed_to_bus_to_multiple_consumers(
        self, aapl, sim_feed, p99, p101, qty10, tick_at
    ):
        """One raw quote flows feed -> engine -> bus to two independent consumers."""
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        asyncio.run(engine.start())

        quotes = []
        stale_flags = []

        def consumer_a(env):
            quotes.append(env.payload.quote)

        def consumer_b(env):
            stale_flags.append(engine.is_stale(aapl))

        bus.subscribe("market.quote.updated", consumer_a)
        bus.subscribe("market.quote.updated", consumer_b)

        raw = RawQuote(instrument=aapl, bid=p99, ask=p101, bid_size=qty10, ask_size=qty10, timestamp=_now())
        asyncio.run(sim_feed.push(raw))

        assert len(quotes) == 1
        assert quotes[0].bid.value == 99
        # Both consumers observed a fresh (non-stale) market.
        assert stale_flags == [False]

    def test_multiple_instruments_routed_independently(
        self, aapl, tsla, sim_feed, p99, p101, p100, tick_at
    ):
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        asyncio.run(engine.start())

        per_instrument = {"AAPL": [], "TSLA": []}

        def on_quote(env):
            sym = env.payload.quote.instrument.symbol
            per_instrument[sym].append(env.payload.quote)

        bus.subscribe("market.quote.updated", on_quote)

        asyncio.run(sim_feed.push(RawQuote(instrument=aapl, bid=p99, ask=p101, timestamp=tick_at)))
        asyncio.run(sim_feed.push(RawQuote(instrument=tsla, bid=p100, ask=p101, timestamp=tick_at)))

        assert len(per_instrument["AAPL"]) == 1
        assert len(per_instrument["TSLA"]) == 1
        assert per_instrument["AAPL"][0].mid.value == 100

    def test_bar_and_tick_reach_consumers(self, aapl, sim_feed, p100, qty10, tick_at):
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        asyncio.run(engine.start())

        ticks = []
        bars = []

        def on_tick(env):
            ticks.append(env.payload.tick)

        def on_bar(env):
            bars.append(env.payload.bar)

        bus.subscribe("market.tick.updated", on_tick)
        bus.subscribe("market.bar.updated", on_bar)

        asyncio.run(
            sim_feed.push(
                RawTick(instrument=aapl, quote_type=QuoteType.LAST, price=p100, volume=qty10, timestamp=tick_at)
            )
        )
        asyncio.run(
            sim_feed.push(
                RawBar(
                    instrument=aapl, interval=BarInterval.MINUTE,
                    open=p100, high=p100, low=p100, close=p100, volume=qty10, timestamp=tick_at,
                )
            )
        )

        assert len(ticks) == 1
        assert len(bars) == 1
        assert ticks[0].price.value == 100
        assert bars[0].interval == BarInterval.MINUTE

    def test_stale_detection_across_engine(self, aapl, sim_feed, p99, p101, tick_at):
        """With a tiny staleness window, a stale instrument is flagged."""
        bus = InProcessEventBus()
        start = _now()
        state = {"now": start}

        def clock() -> datetime:
            return state["now"]

        monitor = StalenessMonitor(max_age=timedelta(seconds=10), clock=clock)
        engine = MarketDataEngine(sim_feed, bus, staleness=monitor)
        asyncio.run(engine.start())

        asyncio.run(sim_feed.push(RawQuote(instrument=aapl, bid=p99, ask=p101, timestamp=start)))
        assert engine.is_stale(aapl) is False

        # Advance the injected clock beyond the staleness window.
        state["now"] = start + timedelta(seconds=11)
        assert engine.is_stale(aapl) is True

    def test_handler_failure_does_not_block_other_consumers(self, aapl, sim_feed, p99, p101, tick_at):
        bus = InProcessEventBus()
        engine = MarketDataEngine(sim_feed, bus)
        asyncio.run(engine.start())

        reached = []

        def bad(env):
            raise RuntimeError("consumer bug")

        def good(env):
            reached.append(env.payload.quote)

        bus.subscribe("market.quote.updated", bad)
        bus.subscribe("market.quote.updated", good)

        result = asyncio.run(sim_feed.push(RawQuote(instrument=aapl, bid=p99, ask=p101, timestamp=tick_at)))
        assert result is None
        assert len(reached) == 1