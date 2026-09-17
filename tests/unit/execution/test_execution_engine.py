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
        order = oms.create_order(make_request(aapl, usd))
        result = run(engine.submit(order.client_order_id))
        assert result.status == OrderStatus.SUBMITTED
        assert result.broker_order_id is not None
        assert broker.submit_calls == 1

    def test_submit_reject(self, engine, oms, broker, aapl, usd):
        order = oms.create_order(make_request(aapl, usd))
        broker.reject_on_submit = True
        result = run(engine.submit(order.client_order_id))
        assert result.status == OrderStatus.REJECTED

    def test_submit_timeout_raises_and_keeps_state(self, engine, oms, aapl, usd):
        order = oms.create_order(make_request(aapl, usd))

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
        assert oms.get_order(order.client_order_id).status == OrderStatus.PENDING_SUBMIT

    def test_submit_retry_on_connection_error(self, engine, oms, broker, aapl, usd):
        from execution import ExecutionEngine

        engine = ExecutionEngine(broker, oms, submit_max_attempts=2)
        order = oms.create_order(make_request(aapl, usd))
        broker.fail_submit_until = 1  # first submit raises connection lost
        result = run(engine.submit(order.client_order_id, timeout=5))
        assert result.status == OrderStatus.SUBMITTED
        assert broker.submit_calls == 2  # retried once

    def test_submit_retry_exhausted_raises(self, engine, oms, broker, aapl, usd):
        from execution import ExecutionEngine

        engine = ExecutionEngine(broker, oms, submit_max_attempts=2)
        order = oms.create_order(make_request(aapl, usd))
        broker.fail_submit_until = 5  # fail more times than attempts allow
        with pytest.raises(BrokerError):
            run(engine.submit(order.client_order_id, timeout=5))
        assert broker.submit_calls == 2  # tried twice, then gave up


class TestCancel:
    def test_cancel_unsent_local(self, engine, oms, aapl, usd):
        order = oms.create_order(make_request(aapl, usd))
        result = run(engine.cancel(order.client_order_id))
        assert result.status == OrderStatus.CANCELLED

    def test_cancel_working_goes_to_broker(self, engine, oms, aapl, usd):
        order = oms.create_order(make_request(aapl, usd))
        run(engine.submit(order.client_order_id))
        result = run(engine.cancel(order.client_order_id))
        assert result.status == OrderStatus.CANCELLED

    def test_cancel_terminal_rejected(self, engine, oms, broker, aapl, usd):
        order = oms.create_order(make_request(aapl, usd))
        broker.reject_on_submit = True
        run(engine.submit(order.client_order_id))
        with pytest.raises(OrderStateError):
            run(engine.cancel(order.client_order_id))


class TestModify:
    def test_modify_working(self, engine, oms, aapl, usd):
        order = oms.create_order(make_request(aapl, usd, limit_price="100"))
        run(engine.submit(order.client_order_id))
        result = run(
            engine.modify(order.client_order_id, limit_price=Price(value="95", currency=usd))
        )
        assert result.limit_price.value == 95

    def test_modify_terminal_rejected(self, engine, oms, broker, aapl, usd):
        order = oms.create_order(make_request(aapl, usd))
        broker.reject_on_submit = True
        run(engine.submit(order.client_order_id))
        with pytest.raises(OrderStateError):
            run(engine.modify(order.client_order_id, limit_price=Price(value="95", currency=usd)))


class TestReconcile:
    def test_reconcile_applies_reports_for_open_orders(self, engine, oms, broker, aapl, usd):
        order = oms.create_order(make_request(aapl, usd))
        run(engine.submit(order.client_order_id))
        assert oms.get_order(order.client_order_id).status == OrderStatus.SUBMITTED

        # Simulate the broker now reporting the order was filled meanwhile.
        async def fetch(order):
            await broker.push(order, ExecutionReportType.FILL, quantity="10")
            return None

        broker.fetch_order_status = fetch
        run(engine.reconcile())
        assert oms.get_order(order.client_order_id).status == OrderStatus.FILLED