"""Unit tests for ExecutionEngine."""

from __future__ import annotations

import asyncio

import pytest

from domain.errors import BrokerError, OrderStateError
from domain.fills import ExecutionReportType
from domain.orders import OrderStatus
from domain.money import Price
from tests.unit.execution.conftest import make_request


def run(coro):
    return asyncio.run(coro)


class TestSubmit:
    def test_submit_accept(self, engine, oms, broker, aapl, usd):
        order = run(oms.create_order(make_request(aapl, usd)))
        result = run(engine.submit(order.client_order_id))
        assert result.status == OrderStatus.SUBMITTED
        assert result.broker_order_id is not None
        assert broker.submit_calls == 1

    def test_submit_reject(self, engine, oms, broker, aapl, usd):
        order = run(oms.create_order(make_request(aapl, usd)))
        broker.reject_on_submit = True
        result = run(engine.submit(order.client_order_id))
        assert result.status == OrderStatus.REJECTED

    def test_submit_timeout_raises_and_keeps_state(self, engine, oms, aapl, usd):
        order = run(oms.create_order(make_request(aapl, usd)))

        class SlowBroker:
            def attach_report_handler(self, h): pass
            async def submit_order(self, order):
                await asyncio.sleep(10)
            async def cancel_order(self, order): pass
            async def modify_order(self, order): pass
            async def fetch_order_status(self, order): return None

        engine._broker = SlowBroker()
        engine._broker.attach_report_handler(engine._on_broker_report)
        with pytest.raises(BrokerError) as excinfo:
            run(engine.submit(order.client_order_id, timeout=0.01))
        assert excinfo.value.code.value == "TIMEOUT"
        # State unchanged: still PENDING_SUBMIT, not assumed rejected.
        assert run(oms.get_order(order.client_order_id)).status == OrderStatus.PENDING_SUBMIT

    def test_submit_retry_on_connection_error(self, engine, oms, broker, aapl, usd):
        from execution import ExecutionEngine

        engine = ExecutionEngine(broker, oms, submit_max_attempts=2)
        order = run(oms.create_order(make_request(aapl, usd)))
        broker.fail_submit_until = 1  # first submit raises connection lost
        result = run(engine.submit(order.client_order_id, timeout=5))
        assert result.status == OrderStatus.SUBMITTED
        assert broker.submit_calls == 2  # retried once

    def test_submit_retry_exhausted_raises(self, engine, oms, broker, aapl, usd):
        from execution import ExecutionEngine

        engine = ExecutionEngine(broker, oms, submit_max_attempts=2)
        order = run(oms.create_order(make_request(aapl, usd)))
        broker.fail_submit_until = 5  # fail more times than attempts allow
        with pytest.raises(BrokerError):
            run(engine.submit(order.client_order_id, timeout=5))
        assert broker.submit_calls == 2  # tried twice, then gave up


class TestCancel:
    def test_cancel_unsent_local(self, engine, oms, aapl, usd):
        order = run(oms.create_order(make_request(aapl, usd)))
        result = run(engine.cancel(order.client_order_id))
        assert result.status == OrderStatus.CANCELLED

    def test_cancel_working_goes_to_broker(self, engine, oms, aapl, usd):
        order = run(oms.create_order(make_request(aapl, usd)))
        run(engine.submit(order.client_order_id))
        result = run(engine.cancel(order.client_order_id))
        assert result.status == OrderStatus.CANCELLED

    def test_cancel_terminal_rejected(self, engine, oms, broker, aapl, usd):
        order = run(oms.create_order(make_request(aapl, usd)))
        broker.reject_on_submit = True
        run(engine.submit(order.client_order_id))
        with pytest.raises(OrderStateError):
            run(engine.cancel(order.client_order_id))


class TestModify:
    def test_modify_working(self, engine, oms, aapl, usd):
        order = run(oms.create_order(make_request(aapl, usd, limit_price="100")))
        run(engine.submit(order.client_order_id))
        result = run(
            engine.modify(order.client_order_id, limit_price=Price(value="95", currency=usd))
        )
        assert result.limit_price.value == 95

    def test_modify_terminal_rejected(self, engine, oms, broker, aapl, usd):
        order = run(oms.create_order(make_request(aapl, usd)))
        broker.reject_on_submit = True
        run(engine.submit(order.client_order_id))
        with pytest.raises(OrderStateError):
            run(engine.modify(order.client_order_id, limit_price=Price(value="95", currency=usd)))


class TestReconcile:
    def test_reconcile_applies_reports_for_open_orders(self, engine, oms, broker, aapl, usd):
        order = run(oms.create_order(make_request(aapl, usd)))
        run(engine.submit(order.client_order_id))
        assert run(oms.get_order(order.client_order_id)).status == OrderStatus.SUBMITTED

        # Simulate the broker now reporting the order was filled meanwhile.
        async def fetch(order):
            await broker.push(order, ExecutionReportType.FILL, quantity="10")
            return None

        broker.fetch_order_status = fetch
        run(engine.reconcile())
        assert run(oms.get_order(order.client_order_id)).status == OrderStatus.FILLED

class TestAsyncReportIsolation:
    """M13 regression: invalid asynchronously-delivered broker reports must
    never escape the engine's report handler. Before the fix, an overfilling
    report raised OrderStateError through the adapter's delivery loop and
    wedged every subsequent queued report."""

    def test_invalid_async_report_is_dropped_not_raised(self, engine, broker, oms, aapl, usd):
        order = run(oms.create_order(make_request(aapl, usd)))
        run(engine.submit(order.client_order_id))

        # Overfill the order via the async push path (would raise through a
        # naive handler): 10/10 first completes the order.
        run(broker.push(order, ExecutionReportType.FILL, quantity="10"))
        assert run(oms.get_order(order.client_order_id)).status is OrderStatus.FILLED

        # The overfilling report: REJECTED by the OMS, absorbed by the engine
        # boundary — no exception escapes to the "broker" delivery loop.
        run(broker.push(order, ExecutionReportType.FILL, quantity="5"))

        # State unchanged; the pipeline keeps working (a second order's
        # report still flows through the same handler).
        cur = run(oms.get_order(order.client_order_id))
        assert cur.status is OrderStatus.FILLED
        assert cur.filled_quantity.value == 10

        second = run(oms.create_order(make_request(aapl, usd)))
        run(engine.submit(second.client_order_id))
        run(broker.push(second, ExecutionReportType.FILL, quantity="10"))
        assert run(oms.get_order(second.client_order_id)).status is OrderStatus.FILLED

    def test_reconcile_skips_invalid_poll_report_and_continues(self, engine, broker, oms, aapl, usd):
        """Same isolation for the reconciliation sweep: an invalid poll report
        (an overfilling partial fill) is skipped — recovery continues and a
        subsequent VALID poll still applies."""
        from domain.fills import ExecutionReport, Fill
        from domain.money import Quantity
        from uuid import uuid4

        order = run(oms.create_order(make_request(aapl, usd)))
        run(engine.submit(order.client_order_id))
        assert run(oms.get_order(order.client_order_id)).status is OrderStatus.SUBMITTED

        def overfilling_report() -> ExecutionReport:
            return ExecutionReport(
                report_id=f"R-{uuid4()}",
                order_client_id=order.client_order_id,
                broker_order_id="B-1",
                account_id=order.account_id,
                report_type=ExecutionReportType.PARTIAL_FILL,
                fill=Fill(
                    fill_id=f"F-{uuid4()}",
                    order_client_id=order.client_order_id,
                    broker_order_id="B-1",
                    account_id=order.account_id,
                    instrument=order.instrument,
                    side=order.side,
                    quantity=Quantity(value="15"),  # > remaining 10
                    price=Price(value="100", currency=order.instrument.currency),
                ),
            )

        reports: list[ExecutionReport | None] = [overfilling_report()]

        async def fetch(_order):
            return reports.pop(0) if reports else None

        broker.fetch_order_status = fetch  # type: ignore[assignment]

        changed = run(engine.reconcile())
        # The invalid poll was skipped; the order is untouched.
        assert changed == []
        assert run(oms.get_order(order.client_order_id)).status is OrderStatus.SUBMITTED

        # A subsequent VALID poll applies normally — recovery continued.
        reports.append(broker._report(order, ExecutionReportType.CANCELLED))
        changed = run(engine.reconcile())
        assert len(changed) == 1
        assert run(oms.get_order(order.client_order_id)).status is OrderStatus.CANCELLED
