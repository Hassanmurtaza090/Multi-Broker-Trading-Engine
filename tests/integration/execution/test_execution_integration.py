"""Integration: Engine -> Broker -> OMS -> EventBus -> consumers (full lifecycle)."""

from __future__ import annotations

import asyncio

from domain.fills import ExecutionReportType
from domain.orders import OrderStatus
from tests.unit.execution.conftest import make_request


def run(coro):
    return asyncio.run(coro)


class TestExecutionIntegration:
    def test_full_flow_emits_ordered_events(self, engine, oms, broker, bus, aapl, usd):
        """submit -> accept -> partial -> filled, consumers see events in order."""
        order = oms.create_order(make_request(aapl, usd, quantity="10"))
        received = []

        def on_event(env):
            received.append(env.event_type)

        bus.subscribe("order.submitted", on_event)
        bus.subscribe("order.accepted", on_event)
        bus.subscribe("order.partially_filled", on_event)
        bus.subscribe("order.filled", on_event)

        run(engine.submit(order.client_order_id))
        cur = oms.get_order(order.client_order_id)
        run(broker.push(cur, ExecutionReportType.PARTIAL_FILL, quantity="4"))
        run(broker.push(oms.get_order(order.client_order_id), ExecutionReportType.FILL, quantity="6"))

        assert received == [
            "order.submitted",
            "order.accepted",
            "order.partially_filled",
            "order.filled",
        ]
        final = oms.get_order(order.client_order_id)
        assert final.status == OrderStatus.FILLED
        assert final.filled_quantity.value == 10

    def test_multiple_fills_accumulate(self, engine, oms, broker, aapl, usd):
        order = oms.create_order(make_request(aapl, usd, quantity="10"))
        run(engine.submit(order.client_order_id))
        cur = oms.get_order(order.client_order_id)
        run(broker.push(cur, ExecutionReportType.PARTIAL_FILL, quantity="3"))
        run(broker.push(cur, ExecutionReportType.PARTIAL_FILL, quantity="4"))
        run(broker.push(cur, ExecutionReportType.PARTIAL_FILL, quantity="3"))
        final = oms.get_order(order.client_order_id)
        assert final.status == OrderStatus.FILLED
        assert final.filled_quantity.value == 10

    def test_duplicate_async_report_ignored(self, engine, oms, broker, bus, aapl, usd):
        order = oms.create_order(make_request(aapl, usd, quantity="5"))
        run(engine.submit(order.client_order_id))
        events = []
        bus.subscribe("order.filled", lambda env: events.append(env.payload))
        cur = oms.get_order(order.client_order_id)

        # Build one report and deliver the exact same object twice (same report_id).
        from domain.fills import ExecutionReport, Fill
        from domain.money import Price, Quantity

        fill = Fill(
            fill_id="F-SAME",
            order_client_id=cur.client_order_id,
            broker_order_id=cur.broker_order_id,
            account_id=cur.account_id,
            instrument=cur.instrument,
            side=cur.side,
            quantity=Quantity(value="5"),
            price=Price(value="100", currency=usd),
        )
        report = ExecutionReport(
            report_id="R-SAME",
            order_client_id=cur.client_order_id,
            broker_order_id=cur.broker_order_id,
            account_id=cur.account_id,
            report_type=ExecutionReportType.FILL,
            fill=fill,
        )
        run(broker.handler(report))
        run(broker.handler(report))  # duplicate report_id -> ignored

        assert oms.get_order(order.client_order_id).status == OrderStatus.FILLED
        assert len(events) == 1

    def test_consumer_sees_final_filled_state(self, engine, oms, broker, bus, aapl, usd):
        """A portfolio/risk consumer observes the filled order via the bus."""
        order = oms.create_order(make_request(aapl, usd, quantity="5"))
        seen = []

        def on_fill(env):
            seen.append((env.payload.order.status, env.payload.order.filled_quantity.value))

        bus.subscribe("order.filled", on_fill)
        run(engine.submit(order.client_order_id))
        run(broker.push(oms.get_order(order.client_order_id), ExecutionReportType.FILL, quantity="5"))
        assert seen == [(OrderStatus.FILLED, 5)]