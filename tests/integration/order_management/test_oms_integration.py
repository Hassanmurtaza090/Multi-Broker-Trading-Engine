"""Integration: OrderManager -> EventBus -> multiple consumers (full lifecycle)."""

from __future__ import annotations

import asyncio

import pytest

from domain.errors import OrderNotFoundError
from domain.fills import ExecutionReportType
from domain.orders import OrderStatus
from tests.unit.order_management.conftest import make_fill, make_report, make_request


def run(coro):
    return asyncio.run(coro)


class TestOmsIntegration:
    def test_full_lifecycle_emits_ordered_events(self, manager, bus, aapl, usd):
        """create -> submit -> accept -> partial -> filled, events in order."""
        order = manager.create_order(make_request(aapl, usd, quantity="10"))
        received = []

        def on_order_event(env):
            received.append(env.event_type)

        bus.subscribe("order.submitted", on_order_event)
        bus.subscribe("order.accepted", on_order_event)
        bus.subscribe("order.partially_filled", on_order_event)
        bus.subscribe("order.filled", on_order_event)

        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.ACCEPTED)))
        run(
            manager.on_execution_report(
                make_report(
                    order,
                    ExecutionReportType.PARTIAL_FILL,
                    fill=make_fill(manager.get_order(order.client_order_id), usd, quantity="4"),
                )
            )
        )
        run(
            manager.on_execution_report(
                make_report(
                    order,
                    ExecutionReportType.FILL,
                    fill=make_fill(manager.get_order(order.client_order_id), usd, quantity="6"),
                )
            )
        )

        assert received == [
            "order.submitted",
            "order.accepted",
            "order.partially_filled",
            "order.filled",
        ]
        cur = manager.get_order(order.client_order_id)
        assert cur.status == OrderStatus.FILLED
        assert cur.filled_quantity.value == 10

    def test_unknown_order_raises(self, manager, usd):
        from uuid import uuid4

        with pytest.raises(OrderNotFoundError):
            manager.get_order(uuid4())

    def test_consumer_observes_final_state(self, manager, bus, aapl, usd):
        """A portfolio/risk consumer sees the final filled order via the bus."""
        order = manager.create_order(make_request(aapl, usd, quantity="5"))
        seen = []

        def on_fill(env):
            seen.append((env.payload.order.status, env.payload.order.filled_quantity.value))

        bus.subscribe("order.filled", on_fill)

        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.ACCEPTED)))
        run(
            manager.on_execution_report(
                make_report(order, ExecutionReportType.FILL, fill=make_fill(order, usd, quantity="5"))
            )
        )

        assert seen == [(OrderStatus.FILLED, 5)]

    def test_rejection_path_no_phantom_fills(self, manager, bus, aapl, usd):
        """Rejected order emits only rejection, never a fill event."""
        order = manager.create_order(make_request(aapl, usd))
        run(manager.submit_order(order.client_order_id))
        types = []
        bus.subscribe("order.rejected", lambda env: types.append(env.event_type))
        bus.subscribe("order.filled", lambda env: types.append(env.event_type))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.REJECTED, rejection_reason="risk")))
        assert types == ["order.rejected"]