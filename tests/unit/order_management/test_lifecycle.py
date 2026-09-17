"""OMS lifecycle: submit, accept, fills, reject, cancel, expire, modify."""

from __future__ import annotations

import asyncio

import pytest

from domain.errors import OrderStateError, InvalidArgumentError
from domain.fills import ExecutionReportType
from domain.orders import OrderStatus
from domain.money import Price
from events import (
    OrderAccepted,
    OrderCancelled,
    OrderExpired,
    OrderFilled,
    OrderModified,
    OrderPartiallyFilled,
    OrderRejected,
    OrderSubmitted,
)
from tests.unit.order_management.conftest import make_fill, make_report, make_request


def run(coro):
    return asyncio.run(coro)


class TestSubmit:
    def test_submit_new_publishes_submitted(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        events = []
        bus.subscribe("order.submitted", lambda env: events.append(env.payload))
        run(manager.submit_order(order.client_order_id))
        assert manager.get_order(order.client_order_id).status == OrderStatus.PENDING_SUBMIT
        assert len(events) == 1
        assert isinstance(events[0], OrderSubmitted)

    def test_submit_non_new_rejected(self, manager, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        run(manager.submit_order(order.client_order_id))
        with pytest.raises(OrderStateError):
            run(manager.submit_order(order.client_order_id))  # already pending


class TestReports:
    def test_accept_transitions_and_publishes(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        run(manager.submit_order(order.client_order_id))
        events = []
        bus.subscribe("order.accepted", lambda env: events.append(env.payload))

        report = make_report(order, ExecutionReportType.ACCEPTED, broker_order_id="B-1")
        run(manager.on_execution_report(report))

        cur = manager.get_order(order.client_order_id)
        assert cur.status == OrderStatus.SUBMITTED
        assert cur.broker_order_id == "B-1"
        assert len(events) == 1 and isinstance(events[0], OrderAccepted)

    def test_reject_transitions_and_publishes(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        run(manager.submit_order(order.client_order_id))
        events = []
        bus.subscribe("order.rejected", lambda env: events.append(env.payload))
        report = make_report(order, ExecutionReportType.REJECTED, rejection_reason="bad")
        run(manager.on_execution_report(report))
        cur = manager.get_order(order.client_order_id)
        assert cur.status == OrderStatus.REJECTED
        assert cur.rejection_reason == "bad"
        assert isinstance(events[0], OrderRejected)

    def test_partial_then_full_fill(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd, quantity="10"))
        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.ACCEPTED)))
        part_events, fill_events = [], []
        bus.subscribe("order.partially_filled", lambda env: part_events.append(env.payload))
        bus.subscribe("order.filled", lambda env: fill_events.append(env.payload))

        fill1 = make_fill(manager.get_order(order.client_order_id), usd, quantity="4")
        run(manager.on_execution_report(make_report(order, ExecutionReportType.PARTIAL_FILL, fill=fill1)))
        cur = manager.get_order(order.client_order_id)
        assert cur.status == OrderStatus.PARTIALLY_FILLED
        assert cur.filled_quantity.value == 4
        assert cur.remaining_quantity.value == 6
        assert isinstance(part_events[0], OrderPartiallyFilled)

        fill2 = make_fill(cur, usd, quantity="6")
        run(manager.on_execution_report(make_report(order, ExecutionReportType.FILL, fill=fill2)))
        cur = manager.get_order(order.client_order_id)
        assert cur.status == OrderStatus.FILLED
        assert cur.filled_quantity.value == 10
        assert cur.remaining_quantity.value == 0
        assert isinstance(fill_events[0], OrderFilled)

    def test_overfill_rejected(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd, quantity="10"))
        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.ACCEPTED)))
        fill = make_fill(manager.get_order(order.client_order_id), usd, quantity="11")
        with pytest.raises(OrderStateError):
            run(manager.on_execution_report(make_report(order, ExecutionReportType.FILL, fill=fill)))
        # State unchanged after rejected overfill.
        assert manager.get_order(order.client_order_id).status == OrderStatus.SUBMITTED

    def test_partial_report_completing_order_becomes_filled(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd, quantity="10"))
        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.ACCEPTED)))
        fill = make_fill(manager.get_order(order.client_order_id), usd, quantity="10")
        run(manager.on_execution_report(make_report(order, ExecutionReportType.PARTIAL_FILL, fill=fill)))
        cur = manager.get_order(order.client_order_id)
        assert cur.status == OrderStatus.FILLED
        assert cur.filled_quantity.value == 10

    def test_fill_report_missing_fill_rejected(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd, quantity="10"))
        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.ACCEPTED)))
        with pytest.raises(InvalidArgumentError):
            run(manager.on_execution_report(make_report(order, ExecutionReportType.FILL, fill=None)))

    def test_fill_report_not_completing_rejected(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd, quantity="10"))
        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.ACCEPTED)))
        fill = make_fill(manager.get_order(order.client_order_id), usd, quantity="4")
        with pytest.raises(OrderStateError):
            run(manager.on_execution_report(make_report(order, ExecutionReportType.FILL, fill=fill)))

    def test_duplicate_report_ignored(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        run(manager.submit_order(order.client_order_id))
        events = []
        bus.subscribe("order.accepted", lambda env: events.append(env.payload))

        report = make_report(order, ExecutionReportType.ACCEPTED, report_id="R-SAME")
        run(manager.on_execution_report(report))
        run(manager.on_execution_report(report))  # duplicate
        assert manager.get_order(order.client_order_id).status == OrderStatus.SUBMITTED
        assert len(events) == 1


class TestCancel:
    def test_cancel_unsent_order_immediate(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        events = []
        bus.subscribe("order.cancelled", lambda env: events.append(env.payload))
        run(manager.cancel_order(order.client_order_id))
        assert manager.get_order(order.client_order_id).status == OrderStatus.CANCELLED
        assert isinstance(events[0], OrderCancelled)

    def test_cancel_working_order_pending(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.ACCEPTED)))
        run(manager.cancel_order(order.client_order_id))
        cur = manager.get_order(order.client_order_id)
        assert cur.status == OrderStatus.PENDING_CANCEL
        # Final cancellation via broker report.
        run(manager.on_execution_report(make_report(order, ExecutionReportType.CANCELLED)))
        assert manager.get_order(order.client_order_id).status == OrderStatus.CANCELLED

    def test_cancel_terminal_rejected(self, manager, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.REJECTED)))
        with pytest.raises(OrderStateError):
            run(manager.cancel_order(order.client_order_id))


class TestExpire:
    def test_expired_via_report(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        run(manager.submit_order(order.client_order_id))
        events = []
        bus.subscribe("order.expired", lambda env: events.append(env.payload))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.EXPIRED)))
        assert manager.get_order(order.client_order_id).status == OrderStatus.EXPIRED
        assert isinstance(events[0], OrderExpired)


class TestModify:
    def test_modify_updates_prices_and_publishes(self, manager, bus, aapl, usd):
        order = manager.create_order(make_request(aapl, usd, limit_price="100"))
        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.ACCEPTED)))
        events = []
        bus.subscribe("order.modified", lambda env: events.append(env.payload))

        run(manager.modify_order(order.client_order_id, limit_price=Price(value="95", currency=usd)))
        cur = manager.get_order(order.client_order_id)
        assert cur.limit_price.value == 95
        assert isinstance(events[0], OrderModified)

    def test_modify_terminal_rejected(self, manager, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        run(manager.submit_order(order.client_order_id))
        run(manager.on_execution_report(make_report(order, ExecutionReportType.REJECTED)))
        with pytest.raises(OrderStateError):
            run(manager.modify_order(order.client_order_id, limit_price=Price(value="95", currency=usd)))