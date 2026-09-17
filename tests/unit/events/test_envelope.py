"""Unit tests for EventEnvelope."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from events import EventEnvelope, OrderFilled
from domain.money import Price, Quantity
from domain.orders import Order, OrderSide, OrderStatus, OrderType
from domain.instrument import AssetClass, Exchange, Instrument
from domain.fills import Fill


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


class TestEventEnvelope:
    def test_wrap_fills_metadata(self, usd, aapl):
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        env = EventEnvelope.wrap(event, source="order_engine", correlation_id="corr-123")
        assert env.event_type == "order.filled"
        assert env.event_version == 1
        assert env.source == "order_engine"
        assert env.correlation_id == "corr-123"
        assert env.payload is event

    def test_wrap_uses_fresh_uuid_by_default(self, usd, aapl):
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        env1 = EventEnvelope.wrap(event)
        env2 = EventEnvelope.wrap(event)
        assert env1.event_id != env2.event_id

    def test_wrap_allows_explicit_id(self, usd, aapl):
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        fixed = uuid4()
        env = EventEnvelope.wrap(event, event_id=fixed)
        assert env.event_id == fixed

    def test_wrap_allows_explicit_timestamp(self, usd, aapl):
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        from datetime import UTC, datetime
        ts = datetime(2025, 1, 1, 12, 0, tzinfo=UTC)
        env = EventEnvelope.wrap(event, timestamp=ts)
        assert env.timestamp == ts

    def test_envelope_is_immutable(self, usd, aapl):
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        env = EventEnvelope.wrap(event)
        with pytest.raises(Exception):
            env.source = "hack"

    def test_event_type_matches_event(self, usd, aapl):
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        env = EventEnvelope.wrap(event)
        assert env.event_type == event.event_type
        assert env.event_version == event.event_version

    def test_naive_timestamp_rejected(self, usd, aapl):
        from datetime import datetime
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        naive = datetime(2025, 1, 1, 12, 0)  # no tzinfo
        with pytest.raises(Exception):
            EventEnvelope.wrap(event, timestamp=naive)

    def test_tz_aware_timestamp_accepted(self, usd, aapl):
        from datetime import UTC, datetime
        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        aware = datetime(2025, 1, 1, 12, 0, tzinfo=UTC)
        env = EventEnvelope.wrap(event, timestamp=aware)
        assert env.timestamp == aware