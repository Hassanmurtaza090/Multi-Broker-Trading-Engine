"""Unit tests for the WebSocket hub (topics, fan-out, backpressure)."""

from __future__ import annotations

import asyncio

from events import DEFAULT_REGISTRY, EventSerializer, EventEnvelope, InProcessEventBus, OrderSubmitted
from api.ws import WebSocketHub, hello_message, _CLOSE_SENTINEL


def run(coro):
    return asyncio.run(coro)


def _order_submitted():
    """Build a minimal OrderSubmitted event envelope."""
    from domain.instrument import AssetClass, Exchange, Instrument
    from domain.money import Currency, Price, Quantity
    from domain.orders import Order, OrderSide, OrderType

    usd = Currency(code="USD")
    instrument = Instrument(symbol="AAPL", asset_class=AssetClass.EQUITY, currency=usd, exchange=Exchange.NASDAQ)
    order = Order(
        account_id="ACC-001",
        instrument=instrument,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value="10"),
        limit_price=Price(value="100", currency=usd),
    )
    return EventEnvelope.wrap(OrderSubmitted(order=order))


class _FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closed_with: int | None = None

    async def send_text(self, data: str) -> None:
        self.sent.append(data)

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code


class TestTopicParsing:
    def test_all_default(self):
        assert WebSocketHub.parse_topics(None) == frozenset({"all"})
        assert WebSocketHub.parse_topics("all") == frozenset({"all"})

    def test_specific_topics(self):
        parsed = WebSocketHub.parse_topics("orders, positions")
        assert parsed == frozenset({"orders", "positions"})

    def test_unknown_topic_rejected(self):
        import pytest

        with pytest.raises(ValueError):
            WebSocketHub.parse_topics("orders,warp")


class TestFanOut:
    def test_all_topic_client_receives_everything(self):
        bus = InProcessEventBus()
        hub = WebSocketHub(bus, EventSerializer(DEFAULT_REGISTRY))
        ws = _FakeWebSocket()
        hub.register(ws, frozenset({"all"}))
        run(bus.publish(_order_submitted()))
        client = next(iter(hub._clients.values()))
        assert client.queue.qsize() == 1

    def test_topic_filtering(self):
        bus = InProcessEventBus()
        hub = WebSocketHub(bus, EventSerializer(DEFAULT_REGISTRY))
        orders_ws = _FakeWebSocket()
        risk_ws = _FakeWebSocket()
        hub.register(orders_ws, frozenset({"orders"}))
        hub.register(risk_ws, frozenset({"risk"}))
        run(bus.publish(_order_submitted()))
        orders_client = [c for c in hub._clients.values() if c.websocket is orders_ws][0]
        risk_client = [c for c in hub._clients.values() if c.websocket is risk_ws][0]
        assert orders_client.queue.qsize() == 1  # matched
        assert risk_client.queue.qsize() == 0  # filtered out

    def test_unregistered_client_receives_nothing(self):
        bus = InProcessEventBus()
        hub = WebSocketHub(bus, EventSerializer(DEFAULT_REGISTRY))
        ws = _FakeWebSocket()
        client_id = hub.register(ws, frozenset({"all"}))
        hub.unregister(client_id)
        run(bus.publish(_order_submitted()))
        assert hub.client_count() == 0


class TestBackpressure:
    def test_overflow_closes_slow_client(self):
        bus = InProcessEventBus()
        hub = WebSocketHub(bus, EventSerializer(DEFAULT_REGISTRY), queue_size=1)
        ws = _FakeWebSocket()
        hub.register(ws, frozenset({"all"}))
        client = next(iter(hub._clients.values()))
        # The queue allows one event plus one reserved sentinel slot.
        hub._fan_out(_order_submitted(), "orders")
        assert client.queue.qsize() == 1
        hub._fan_out(_order_submitted(), "orders")  # overflow -> sentinel + closed
        assert client.closed is True
        first = client.queue.get_nowait()
        assert first.event_type == "order.submitted"  # the delivered event
        assert client.queue.get_nowait() is _CLOSE_SENTINEL

    async def _drain_once(self, hub, client_id):
        """Run one sender iteration; returns after one queue item."""
        served = hub.serve(client_id)
        try:
            await asyncio.wait_for(served, timeout=0.2)
        except asyncio.TimeoutError:
            pass

    def test_sender_closes_on_sentinel(self):
        async def scenario():
            bus = InProcessEventBus()
            hub = WebSocketHub(bus, EventSerializer(DEFAULT_REGISTRY), queue_size=1)
            ws = _FakeWebSocket()
            client_id = hub.register(ws, frozenset({"all"}))
            client = hub._clients[client_id]
            client.closed = True
            await client.queue.put(_CLOSE_SENTINEL)
            serve = asyncio.create_task(hub.serve(client_id))
            await asyncio.sleep(0.05)
            assert ws.closed_with == 1013
            serve.cancel()

        asyncio.run(scenario())


class TestHelloMessage:
    def test_hello_contract(self):
        import json

        message = json.loads(hello_message("c-1", frozenset({"orders"})))
        assert message["control"] == "hello"
        assert message["client_id"] == "c-1"
        assert message["topics"] == ["orders"]
        assert message["delivery"] == "at-least-once"
        assert message["dedupe_key"] == "event_id"
