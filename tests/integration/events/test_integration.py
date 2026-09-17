"""Integration tests for event system: publisher -> bus -> multiple handlers."""

from __future__ import annotations

import asyncio

import pytest

from events import InProcessEventBus, EventEnvelope, OrderFilled, OrderSubmitted, OrderAccepted
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


class TestEventBusIntegration:
    """End-to-end: publish -> bus -> multiple handlers with typed payloads."""

    def test_order_lifecycle_events_propagate(self, usd, aapl):
        bus = InProcessEventBus()
        received = []

        def on_submitted(env): received.append(("submitted", env.payload))
        def on_accepted(env): received.append(("accepted", env.payload))
        def on_filled(env): received.append(("filled", env.payload))

        bus.subscribe("order.submitted", on_submitted)
        bus.subscribe("order.accepted", on_accepted)
        bus.subscribe("order.filled", on_filled)

        # Submit
        order = _order(usd, aapl, status=OrderStatus.SUBMITTED)
        asyncio.run(bus.publish(OrderSubmitted(order=order)))

        # Accept
        order = _order(usd, aapl, status=OrderStatus.SUBMITTED)
        asyncio.run(bus.publish(OrderAccepted(order=order)))

        # Fill
        order = _order(usd, aapl)
        asyncio.run(bus.publish(OrderFilled(order=order, fill=_fill(usd, aapl))))

        assert len(received) == 3
        assert received[0][0] == "submitted"
        assert received[1][0] == "accepted"
        assert received[2][0] == "filled"

    def test_position_event_chain(self, usd, aapl):
        """Position updates flow through bus to portfolio/risk consumers."""
        bus = InProcessEventBus()
        positions = []
        risk_flags = []

        def on_position(env):
            # Position events wrap a Position object in .position
            pos = getattr(env.payload, "position", None)
            if pos is not None:
                positions.append(pos)

        def on_risk(env):
            # Position events wrap a Position object; check its quantity
            pos = getattr(env.payload, "position", None)
            if pos is not None and pos.quantity.value > Decimal("1000"):
                risk_flags.append(pos)

        from events import PositionOpened, PositionUpdated, PositionClosed
        bus.subscribe("position.opened", on_position)
        bus.subscribe("position.updated", on_position)
        bus.subscribe("position.closed", on_position)
        bus.subscribe("position.opened", on_risk)
        bus.subscribe("position.updated", on_risk)

        from domain.position import Position
        pos1 = Position(account_id="ACC-001", instrument=aapl, quantity=Quantity(value="100"))
        pos2 = Position(account_id="ACC-001", instrument=aapl, quantity=Quantity(value="200"))
        pos3 = Position(account_id="ACC-001", instrument=aapl, quantity=Quantity(value="0"))

        asyncio.run(bus.publish(PositionOpened(position=pos1)))
        asyncio.run(bus.publish(PositionUpdated(position=pos2)))
        asyncio.run(bus.publish(PositionClosed(position=pos3)))

        assert len(positions) == 3
        assert positions[0].quantity.value == Decimal("100")
        assert positions[1].quantity.value == Decimal("200")
        assert positions[2].quantity.value == Decimal("0")
        assert len(risk_flags) == 0  # all below threshold

    def test_event_traceability_correlation_id(self, usd, aapl):
        """Correlation IDs trace related events through the bus."""
        bus = InProcessEventBus()
        traced = []

        def handler(env):
            traced.append((env.event_type, env.correlation_id, env.causation_id))

        bus.subscribe("order.submitted", handler)
        bus.subscribe("order.accepted", handler)
        bus.subscribe("order.filled", handler)

        corr_id = "corr-abc-123"
        order = _order(usd, aapl, status=OrderStatus.SUBMITTED)
        asyncio.run(bus.publish(OrderSubmitted(order=order), correlation_id=corr_id))

        # Use the submitted event's ID as causation for accepted
        accepted_event = OrderAccepted(order=order)
        asyncio.run(bus.publish(accepted_event, correlation_id=corr_id, causation_id=str(order.client_order_id)))

        filled_order = _order(usd, aapl)
        asyncio.run(bus.publish(OrderFilled(order=filled_order, fill=_fill(usd, aapl)), correlation_id=corr_id, causation_id=str(accepted_event.order.client_order_id)))

        assert all(corr == corr_id for (_, corr, _) in traced)
        # causation chain: filled -> accepted -> submitted
        assert traced[0][2] is None
        assert traced[1][2] == str(order.client_order_id)
        assert traced[2][2] == str(accepted_event.order.client_order_id)

    def test_handler_isolation_does_not_stop_others(self, usd, aapl):
        bus = InProcessEventBus()
        results = []

        def good1(env): results.append("good1")
        def bad(env): raise RuntimeError("fail")
        def good2(env): results.append("good2")

        bus.subscribe("order.filled", good1)
        bus.subscribe("order.filled", bad)
        bus.subscribe("order.filled", good2)

        event = OrderFilled(order=_order(usd, aapl), fill=_fill(usd, aapl))
        result = asyncio.run(bus.publish(event))

        assert result.ok is False
        assert len(result.errors) == 1
        assert results == ["good1", "good2"]

    def test_market_quote_flow(self, usd, aapl):
        bus = InProcessEventBus()
        quotes = []

        def handler(env):
            quotes.append(env.payload.quote)

        from events import MarketQuoteUpdated
        from domain.market import MarketQuote
        bus.subscribe("market.quote.updated", handler)

        quote = MarketQuote(instrument=aapl, bid=Price(value="99", currency=usd), ask=Price(value="101", currency=usd))
        asyncio.run(bus.publish(MarketQuoteUpdated(quote=quote)))

        assert len(quotes) == 1
        assert quotes[0].bid.value == Decimal("99")

from decimal import Decimal