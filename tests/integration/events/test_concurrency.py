"""Async/concurrency tests for event system."""

from __future__ import annotations

import asyncio

import pytest

from events import InProcessEventBus, OrderFilled, EventEnvelope
from domain.money import Price, Quantity
from domain.orders import Order, OrderSide, OrderStatus, OrderType
from domain.instrument import AssetClass, Exchange, Instrument
from domain.fills import Fill
from uuid import uuid4


def _order(usd, aapl):
    return Order(
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value="10"),
        limit_price=Price(value="100", currency=usd),
        status=OrderStatus.FILLED,
    )


def _fill(usd, aapl):
    return Fill(
        fill_id="F-1",
        order_client_id=uuid4(),
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        quantity=Quantity(value="10"),
        price=Price(value="100", currency=usd),
    )


class TestAsyncConcurrency:
    """Verify deterministic sequential dispatch under concurrent publishing."""

    def test_sequential_dispatch_per_event(self, usd, aapl):
        """Handlers run sequentially for a single published event."""
        bus = InProcessEventBus()
        order = _order(usd, aapl)
        event = OrderFilled(order=order, fill=_fill(usd, aapl))

        sequence = []
        async def h1(env): await asyncio.sleep(0.01); sequence.append("h1")
        async def h2(env): sequence.append("h2")
        async def h3(env): await asyncio.sleep(0.01); sequence.append("h3")

        bus.subscribe("order.filled", h1)
        bus.subscribe("order.filled", h2)
        bus.subscribe("order.filled", h3)

        asyncio.run(bus.publish(event))
        # h1 sleeps, then h2, then h3 sleeps — sequential in registration order
        assert sequence == ["h1", "h2", "h3"]

    def test_concurrent_publishes_sequentialized(self, usd, aapl):
        """Multiple concurrent publishes are processed serially (bus-level lock)."""
        bus = InProcessEventBus()
        completed = []

        async def slow_handler(env):
            await asyncio.sleep(0.02)
            completed.append(env.event_id)

        bus.subscribe("order.filled", slow_handler)

        order = _order(usd, aapl)
        events = [OrderFilled(order=order, fill=_fill(usd, aapl)) for _ in range(3)]

        async def publish_all():
            await asyncio.gather(*[bus.publish(e) for e in events])

        asyncio.run(publish_all())

        # Each publish waits for the previous to fully complete (including handlers)
        # Order of completion matches publish order since gather preserves order
        assert len(completed) == 3

    def test_concurrent_publishes_do_not_interleave_handlers(self, usd, aapl):
        """Handler execution for different events never interleaves (bus lock)."""
        bus = InProcessEventBus()
        timeline = []

        async def handler(env):
            eid = str(env.event_id)[:8]
            timeline.append(f"{eid}-start")
            await asyncio.sleep(0.01)
            timeline.append(f"{eid}-end")

        bus.subscribe("order.filled", handler)

        order = _order(usd, aapl)
        events = [OrderFilled(order=order, fill=_fill(usd, aapl)) for _ in range(2)]

        async def publish_all():
            return await asyncio.gather(*[bus.publish(e) for e in events])

        results = asyncio.run(publish_all())
        ids = [str(r.envelope.event_id)[:8] for r in results]

        # The per-bus lock serializes publishes, so each event's handler
        # completes fully before the next begins (no interleaving).
        assert timeline == [
            f"{ids[0]}-start",
            f"{ids[0]}-end",
            f"{ids[1]}-start",
            f"{ids[1]}-end",
        ]

    def test_nested_publish_from_handler_no_deadlock(self, usd, aapl):
        """A handler publishing a follow-up event (same task) must not deadlock."""
        bus = InProcessEventBus()
        order = _order(usd, aapl)
        events = [OrderFilled(order=order, fill=_fill(usd, aapl)) for _ in range(2)]

        seen = []

        async def on_filled(env):
            seen.append(("filled", str(env.event_id)[:8]))
            if len(seen) < 2:
                # Chain a follow-up event from within the handler.
                await bus.publish(events[1], source="chained")

        bus.subscribe("order.filled", on_filled)

        asyncio.run(bus.publish(events[0], source="root"))

        # The root publish drove the nested publish to completion.
        assert len(seen) == 2
        assert seen[0][1] != seen[1][1]
        assert bus.subscriber_count("order.filled") == 1

    def test_duplicate_event_delivered_twice_with_same_event_id(self, usd, aapl):
        """Publishing the same envelope twice delivers twice (at-least-once);
        consumers identify duplicates via event_id."""
        bus = InProcessEventBus()
        order = _order(usd, aapl)
        received_ids = []

        def handler(env):
            received_ids.append(str(env.event_id))

        bus.subscribe("order.filled", handler)

        event = OrderFilled(order=order, fill=_fill(usd, aapl))
        env = EventEnvelope.wrap(event, source="dup-test")
        asyncio.run(bus.publish(env))
        asyncio.run(bus.publish(env))

        # Delivered twice (no bus-level dedup in M2) with identical event_id,
        # enabling consumers to deduplicate by event_id.
        assert received_ids == [str(env.event_id), str(env.event_id)]

    def test_many_handlers_one_event(self, usd, aapl):
        """100 handlers for one event all execute in order."""
        bus = InProcessEventBus()
        results = []

        def make_handler(i):
            def h(env): results.append(i)
            return h

        for i in range(100):
            bus.subscribe("order.filled", make_handler(i))

        order = _order(usd, aapl)
        event = OrderFilled(order=order, fill=_fill(usd, aapl))
        asyncio.run(bus.publish(event))

        assert results == list(range(100))