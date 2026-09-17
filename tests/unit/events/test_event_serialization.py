"""Unit tests for EventSerializer."""

from __future__ import annotations

import pytest

from events import EventSerializer, EventRegistry, DEFAULT_REGISTRY, EventEnvelope, OrderFilled
from domain.money import Price, Quantity
from domain.orders import Order, OrderSide, OrderStatus, OrderType
from domain.instrument import AssetClass, Exchange, Instrument
from domain.fills import Fill
from uuid import uuid4


def _filled_event(usd, aapl):
    order = Order(
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value="10"),
        limit_price=Price(value="100", currency=usd),
        status=OrderStatus.FILLED,
    )
    fill = Fill(
        fill_id="F-1",
        order_client_id=uuid4(),
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        quantity=Quantity(value="10"),
        price=Price(value="100", currency=usd),
    )
    return OrderFilled(order=order, fill=fill)


class TestEventSerializer:
    def test_roundtrip_envelope(self, usd, aapl):
        ser = EventSerializer(DEFAULT_REGISTRY)
        event = _filled_event(usd, aapl)
        env = EventEnvelope.wrap(event, source="test", correlation_id="corr-1")
        data = ser.dumps(env)
        restored = ser.loads(data)
        assert restored.event_type == env.event_type
        assert restored.event_version == env.event_version
        assert restored.source == "test"
        assert restored.correlation_id == "corr-1"
        assert isinstance(restored.payload, OrderFilled)
        assert restored.payload.order.client_order_id == event.order.client_order_id

    def test_roundtrip_bare_event(self, usd, aapl):
        ser = EventSerializer(DEFAULT_REGISTRY)
        event = _filled_event(usd, aapl)
        data = ser.dumps(event)  # wraps automatically
        restored = ser.loads(data)
        assert isinstance(restored, EventEnvelope)
        assert restored.payload.event_type == "order.filled"

    def test_unknown_type_deserialization_fails(self, usd, aapl):
        from events import UnknownEventTypeError
        ser = EventSerializer(EventRegistry())  # empty registry
        event = _filled_event(usd, aapl)
        data = ser.dumps(event)
        with pytest.raises(UnknownEventTypeError):
            ser.loads(data)

    def test_missing_payload_rejected(self):
        ser = EventSerializer(DEFAULT_REGISTRY)
        with pytest.raises(ValueError):
            ser.loads({"event_type": "order.filled", "event_version": 1})

    def test_invalid_payload_type_rejected(self):
        from events import UnsupportedEventVersionError
        ser = EventSerializer(DEFAULT_REGISTRY)
        data = {"event_type": "order.filled", "event_version": 99, "payload": {}}
        with pytest.raises(UnsupportedEventVersionError):
            ser.loads(data)

    def test_json_string_deserialization(self, usd, aapl):
        import json
        ser = EventSerializer(DEFAULT_REGISTRY)
        event = _filled_event(usd, aapl)
        env = EventEnvelope.wrap(event)
        data = ser.dumps(env)
        json_str = json.dumps(data)
        restored = ser.loads(json_str)
        assert restored.event_type == "order.filled"