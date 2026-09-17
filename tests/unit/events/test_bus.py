"""Unit tests for InProcessEventBus."""

from __future__ import annotations

import asyncio

import pytest

from events import InProcessEventBus, EventEnvelope, OrderFilled, OrderSubmitted, Subscription
from domain.money import Price, Quantity
from domain.orders import Order, OrderSide, OrderStatus, OrderType
from domain.instrument import AssetClass, Exchange, Instrument
from domain.fills import Fill
from uuid import uuid4


def _order(usd, aapl, status=OrderStatus.FILLED):
    return Order(
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value="10"),
        limit_price=Price(value="100", currency=usd),
        status=status,
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


class TestInProcessEventBus:
    def test_subscribe_returns_subscription(self, event_bus):
        called = []
        def handler(env): called.append(env)
        sub = event_bus.subscribe("order.filled", handler)
        assert isinstance(sub, Subscription)
        assert sub.event_type == "order.filled"
        assert event_bus.subscriber_count("order.filled") == 1

    def test_unsubscribe(self, event_bus):
        called = []
        def handler(env): called.append(env)
        sub = event_bus.subscribe("order.filled", handler)
        assert event_bus.unsubscribe(sub) is True
        assert event_bus.subscriber_count("order.filled") == 0

    def test_unsubscribe_nonexistent_false(self, event_bus):
        sub = Subscription(token="fake", event_type="order.filled", handler=lambda e: None)
        assert event_bus.unsubscribe(sub) is False

    def test_publish_delivers_to_all_subscribers(self, usd, aapl, event_bus):
        received = []
        def h1(env): received.append(("h1", env))
        def h2(env): received.append(("h2", env))
        event_bus.subscribe("order.filled", h1)
        event_bus.subscribe("order.filled", h2)
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        result = asyncio.run(event_bus.publish(event))
        assert result.delivered_to == 2
        assert len(received) == 2

    def test_publish_no_subscribers_ok(self, usd, aapl, event_bus):
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        result = asyncio.run(event_bus.publish(event))
        assert result.delivered_to == 0
        assert result.ok is True

    def test_publish_returns_envelope(self, usd, aapl, event_bus):
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        result = asyncio.run(event_bus.publish(event))
        assert result.envelope.event_type == "order.filled"
        assert result.envelope.payload is event

    def test_handler_exception_isolated(self, usd, aapl, event_bus):
        def bad_handler(env):
            raise ValueError("boom")
        def good_handler(env):
            good_handler.called = True
        good_handler.called = False
        event_bus.subscribe("order.filled", bad_handler)
        event_bus.subscribe("order.filled", good_handler)
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        result = asyncio.run(event_bus.publish(event))
        assert good_handler.called is True
        assert len(result.errors) == 1
        assert result.errors[0].exception_type == "ValueError"

    def test_async_handler_awaited(self, usd, aapl, event_bus):
        received = []
        async def handler(env):
            await asyncio.sleep(0.001)
            received.append(env)
        event_bus.subscribe("order.filled", handler)
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        asyncio.run(event_bus.publish(event))
        assert len(received) == 1

    def test_publish_wraps_bare_event(self, usd, aapl, event_bus):
        called = []
        def handler(env): called.append(env)
        event_bus.subscribe("order.submitted", handler)
        order = _order(usd, aapl, status=OrderStatus.SUBMITTED)
        event = OrderSubmitted(order=order)
        result = asyncio.run(event_bus.publish(event, source="test"))
        assert len(called) == 1
        assert called[0].source == "test"

    def test_subscription_order_preserved(self, usd, aapl, event_bus):
        order = []
        def h1(env): order.append("h1")
        def h2(env): order.append("h2")
        def h3(env): order.append("h3")
        event_bus.subscribe("order.filled", h1)
        event_bus.subscribe("order.filled", h2)
        event_bus.subscribe("order.filled", h3)
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        asyncio.run(event_bus.publish(event))
        assert order == ["h1", "h2", "h3"]

    def test_mid_dispatch_unsubscribe_does_not_affect_current(self, usd, aapl, event_bus):
        """Handlers list is snapshotted at publish time."""
        calls = []
        sub_h2 = None
        def h1(env): calls.append("h1")
        def h2(env):
            calls.append("h2")
            if sub_h2:
                event_bus.unsubscribe(sub_h2)
        def h3(env): calls.append("h3")
        event_bus.subscribe("order.filled", h1)
        sub_h2 = event_bus.subscribe("order.filled", h2)
        event_bus.subscribe("order.filled", h3)
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        asyncio.run(event_bus.publish(event))
        # h2 ran and unsubscribed itself, but h3 still runs because list was snapshotted
        assert calls == ["h1", "h2", "h3"]