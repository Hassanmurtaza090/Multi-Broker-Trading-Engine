"""Unit tests for the IBKR adapter (lifecycle, market data, orders, dedup)."""

from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest

from domain.errors import BrokerError, ErrorCode
from domain.fills import ExecutionReportType
from domain.orders import OrderStatus
from events import BalanceUpdated, BrokerConnected, BrokerDisconnected
from brokers.ibkr import IbkrAdapter, SimulatedIbkrClient
from brokers.ibkr.contracts import IbkrPosition
from brokers.base import RawQuote
from tests.unit.brokers.conftest import (
    aapl_contract,
    account_values_usd,
    make_execution,
    make_order,
    make_quote,
)


def run(coro):
    return asyncio.run(coro)


class TestConnection:
    def test_start_connects_and_publishes_connected(self, adapter, client, bus):
        events = []
        bus.subscribe("broker.connected", lambda env: events.append(env.payload))
        run(adapter.start())
        assert adapter.is_connected is True
        run(adapter.drain())
        assert len(events) == 1 and isinstance(events[0], BrokerConnected)
        assert events[0].broker == "IBKR"

    def test_start_failure_raises_broker_error(self, adapter, client):
        client.fail_connect = True
        with pytest.raises(BrokerError) as excinfo:
            run(adapter.start())
        assert excinfo.value.code is ErrorCode.CONNECTION_LOST
        assert adapter.is_connected is False

    def test_start_is_idempotent(self, adapter, client, bus):
        events = []
        bus.subscribe("broker.connected", lambda env: events.append(env.payload))
        run(adapter.start())
        run(adapter.start())  # duplicate start
        run(adapter.drain())
        assert adapter.is_connected
        assert len(events) == 1  # no duplicate connection events

    def test_stop_publishes_disconnected(self, adapter, client, bus):
        events = []
        bus.subscribe("broker.disconnected", lambda env: events.append(env.payload))
        run(adapter.start())
        run(adapter.stop())
        run(adapter.drain())
        assert len(events) == 1 and isinstance(events[0], BrokerDisconnected)
        assert events[0].reason == "shutdown"
        assert adapter.is_connected is False

    def test_unexpected_disconnect_publishes_connection_lost(self, adapter, client, bus):
        events = []
        bus.subscribe("broker.disconnected", lambda env: events.append(env.payload))
        run(adapter.start())
        run(adapter.drain())
        client.simulate_unexpected_disconnect()
        run(adapter.drain())
        assert events[-1].reason == "connection lost"
        assert adapter.is_connected is False

    def test_reconnect_resubscribes_market_data(self, adapter, client, aapl):
        run(adapter.start())
        run(adapter.subscribe(aapl))
        client.simulate_unexpected_disconnect()
        assert len(client.subscriptions) == 0  # simulated drop clears client subs
        run(adapter.reconnect())
        assert adapter.is_connected
        # Exactly one subscription after reconnect (no duplicates).
        assert len(client.subscriptions) == 1
        run(adapter.stop())

    def test_reconnect_is_idempotent(self, adapter, client, aapl):
        run(adapter.start())
        run(adapter.reconnect())  # already connected -> no-op
        assert len(client.subscriptions) == 0
        run(adapter.stop())


class TestMarketData:
    def test_subscribe_unsubscribe(self, adapter, client, aapl):
        run(adapter.start())
        sub = run(adapter.subscribe(aapl))
        assert len(client.subscriptions) == 1
        run(adapter.unsubscribe(sub))
        assert len(client.subscriptions) == 0
        run(adapter.stop())

    def test_duplicate_subscribe_not_duplicated_at_client(self, adapter, client, aapl):
        run(adapter.start())
        run(adapter.subscribe(aapl))
        run(adapter.subscribe(aapl))  # engine-level dedup happens too; adapter is safe
        assert len(client.subscriptions) == 1
        run(adapter.stop())

    def test_quote_pushed_as_raw_quote(self, adapter, client, aapl, usd):
        received = []

        async def handler(event):
            received.append(event)

        adapter.attach_handler(handler)
        run(adapter.start())
        client.emit_quote(make_quote(aapl_contract()))
        run(adapter.drain())
        assert len(received) == 1
        quote = received[0]
        assert isinstance(quote, RawQuote)
        assert quote.instrument.symbol == "AAPL"
        assert quote.bid is not None and quote.bid.value == Decimal("99")
        assert quote.ask is not None and quote.ask.value == Decimal("101")
        assert quote.last is not None and quote.last.value == Decimal("100")
        assert quote.bid_size is not None and quote.bid_size.value == Decimal("100")
        assert quote.timestamp.tzinfo is not None
        run(adapter.stop())

    def test_malformed_quote_dropped_without_crash(self, adapter, client, aapl):
        received = []

        async def handler(event):
            received.append(event)

        adapter.attach_handler(handler)
        run(adapter.start())
        from brokers.ibkr.contracts import IbkrContract
        bad = make_quote(IbkrContract(symbol="X", sec_type="WARP", exchange="SMART", currency="USD"))
        client.emit_quote(bad)
        run(adapter.drain())
        assert received == []  # dropped, no crash
        run(adapter.stop())

    def test_bar_pushed_as_raw_bar(self, adapter, client, aapl):
        from brokers.ibkr.contracts import IbkrBar

        received = []

        async def handler(event):
            received.append(event)

        adapter.attach_handler(handler)
        run(adapter.start())
        client.emit_bar(
            IbkrBar(
                contract=aapl_contract(),
                interval="1 min",
                open="100",
                high="101",
                low="99",
                close="100",
                volume="1000",
                timestamp_unix=1_700_000_000,
            )
        )
        run(adapter.drain())
        assert len(received) == 1
        bar = received[0]
        assert bar.interval.value == "1m"
        assert bar.open.value == Decimal("100")
        assert bar.volume.value == Decimal("1000")
        run(adapter.stop())

    def test_historical_bars_requested(self, adapter, client, aapl):
        from brokers.ibkr import mapping

        run(adapter.start())
        run(adapter.request_historical_bars(aapl, "1 min"))
        expected_contract = mapping.instrument_to_contract(aapl)
        assert client.requested_bars == [(expected_contract, "1 min")]
        run(adapter.stop())

    def test_subscribe_requires_connection(self, adapter, aapl):
        with pytest.raises(BrokerError):
            run(adapter.subscribe(aapl))


class TestOrders:
    def test_submit_returns_accept(self, adapter, client, aapl, usd):
        run(adapter.start())
        order = make_order(aapl, usd)
        report = run(adapter.submit_order(order))
        assert report.report_type is ExecutionReportType.ACCEPTED
        assert report.order_client_id == order.client_order_id
        assert report.broker_order_id is not None
        run(adapter.drain())  # buffered Submitted consumed, nothing pushed
        run(adapter.stop())

    def test_submit_rejection_returned(self, adapter, client, aapl, usd):
        run(adapter.start())
        client.reject_orders = True
        order = make_order(aapl, usd)
        report = run(adapter.submit_order(order))
        assert report.report_type is ExecutionReportType.REJECTED
        run(adapter.stop())

    def test_submit_not_connected_rejected(self, adapter, aapl, usd):
        with pytest.raises(BrokerError):
            run(adapter.submit_order(make_order(aapl, usd)))

    def test_cancel_confirmed(self, adapter, client, aapl, usd):
        run(adapter.start())
        order = make_order(aapl, usd)
        run(adapter.submit_order(order))
        report = run(adapter.cancel_order(order))
        assert report.report_type is ExecutionReportType.CANCELLED
        run(adapter.stop())

    def test_modify_confirmed(self, adapter, client, aapl, usd):
        run(adapter.start())
        order = make_order(aapl, usd)
        run(adapter.submit_order(order))
        modified = order.model_copy(update={"limit_price": order.limit_price})
        report = run(adapter.modify_order(modified))
        assert report.report_type is ExecutionReportType.REPLACED
        run(adapter.stop())

    def test_cancel_unknown_order_raises(self, adapter, client, aapl, usd):
        run(adapter.start())
        with pytest.raises(BrokerError):
            run(adapter.cancel_order(make_order(aapl, usd)))
        run(adapter.stop())

    def test_duplicate_status_callback_not_pushed_twice(self, adapter, client, aapl, usd):
        reports = []

        async def handler(report):
            reports.append(report)

        adapter.attach_report_handler(handler)
        run(adapter.start())
        order = make_order(aapl, usd)
        submitted = run(adapter.submit_order(order))
        run(adapter.drain())
        assert reports == []  # the buffered Submitted was consumed by submit
        ibkr_order_id = int(submitted.broker_order_id)

        from brokers.ibkr.contracts import IbkrOrderStatus

        # IBKR repeats the Submitted status -> deduped (no ACCEPTED push).
        client._cb().on_order_status(IbkrOrderStatus(ibkr_order_id=ibkr_order_id, status="Submitted"))
        run(adapter.drain())
        assert reports == []

        # A changed status IS pushed exactly once.
        client._cb().on_order_status(IbkrOrderStatus(ibkr_order_id=ibkr_order_id, status="Cancelled"))
        run(adapter.drain())
        assert len(reports) == 1
        assert reports[0].report_type is ExecutionReportType.CANCELLED
        # ...and repeats of it are deduped.
        client._cb().on_order_status(IbkrOrderStatus(ibkr_order_id=ibkr_order_id, status="Cancelled"))
        run(adapter.drain())
        assert len(reports) == 1
        run(adapter.stop())


class TestExecutions:
    def test_execution_pushed_as_fill_report(self, adapter, client, aapl, usd):
        reports = []

        async def handler(report):
            reports.append(report)

        adapter.attach_report_handler(handler)
        run(adapter.start())
        order = make_order(aapl, usd, quantity="10")
        submitted = run(adapter.submit_order(order))
        ibkr_order_id = int(submitted.broker_order_id)

        client.emit_execution(
            make_execution(ibkr_order_id, order, execution_id="E-1", quantity="4", cum="4")
        )
        run(adapter.drain())
        assert len(reports) == 1
        assert reports[0].report_type is ExecutionReportType.PARTIAL_FILL
        assert reports[0].fill is not None
        assert reports[0].fill.fill_id == "E-1"

        client.emit_execution(
            make_execution(ibkr_order_id, order, execution_id="E-2", quantity="6", cum="10")
        )
        run(adapter.drain())
        assert len(reports) == 2
        assert reports[1].report_type is ExecutionReportType.FILL
        run(adapter.stop())

    def test_duplicate_execution_ignored(self, adapter, client, aapl, usd):
        reports = []

        async def handler(report):
            reports.append(report)

        adapter.attach_report_handler(handler)
        run(adapter.start())
        order = make_order(aapl, usd, quantity="10")
        submitted = run(adapter.submit_order(order))
        ibkr_order_id = int(submitted.broker_order_id)
        execution = make_execution(ibkr_order_id, order, execution_id="E-DUP", quantity="10", cum="10")
        client.emit_execution(execution)
        client.emit_execution(execution)  # redelivery
        run(adapter.drain())
        assert len(reports) == 1
        run(adapter.stop())

    def test_execution_for_unknown_order_dropped(self, adapter, client, aapl, usd):
        reports = []

        async def handler(report):
            reports.append(report)

        adapter.attach_report_handler(handler)
        run(adapter.start())
        # An unexpected broker response: execution for an order we never placed.
        orphan = make_execution(999, make_order(aapl, usd), execution_id="E-9", quantity="1", cum="1")
        client._cb().on_execution(orphan)
        run(adapter.drain())
        assert reports == []
        run(adapter.stop())


class TestAccountAndPositions:
    def test_account_values_publish_balance(self, adapter, client, bus):
        balances = []
        bus.subscribe("balance.updated", lambda env: balances.append(env.payload))
        run(adapter.start())
        client.account_values = account_values_usd()
        client.request_account_summary()
        run(adapter.drain())
        assert balances, "balance events published"
        final = balances[-1].balance
        assert final.cash["USD"].total.amount == Decimal("10000")
        assert final.cash["USD"].available.amount == Decimal("8000")
        run(adapter.stop())

    def test_positions_snapshot(self, adapter, client, aapl):
        from brokers.ibkr.contracts import IbkrPosition

        run(adapter.start())
        client.positions = [
            IbkrPosition(account="DU123456", contract=aapl_contract(), position="100", avg_cost="100")
        ]
        client.request_positions()
        snapshot = adapter.position_snapshot()
        assert len(snapshot) == 1
        assert snapshot[0].quantity.value == Decimal("100")
        assert snapshot[0].account_id == "DU123456"
        run(adapter.stop())


class TestErrors:
    def test_ibkr_error_logged_not_fatal(self, adapter, client, aapl, usd):
        run(adapter.start())
        client.emit_error(1100, "connectivity lost")
        assert adapter.is_connected  # error alone does not flip state
        run(adapter.stop())

    def test_error_mapping_preserved(self, adapter, client):
        from brokers.ibkr import mapping

        error = mapping.map_ibkr_error(10089, "no market data permissions")
        assert error.code is ErrorCode.UNAVAILABLE
        assert error.broker_error_code == "10089"


class TestReconciliation:
    def test_fetch_status_returns_none_when_unchanged(self, adapter, client, aapl, usd):
        run(adapter.start())
        order = make_order(aapl, usd)
        run(adapter.submit_order(order))
        # Status at broker == last recorded (Submitted) -> nothing new.
        assert run(adapter.fetch_order_status(order)) is None
        run(adapter.stop())

    def test_fetch_status_detects_broker_side_cancel(self, adapter, client, aapl, usd):
        run(adapter.start())
        order = make_order(aapl, usd)
        submitted = run(adapter.submit_order(order))
        client.force_status(int(submitted.broker_order_id), "Cancelled")
        report = run(adapter.fetch_order_status(order))
        assert report is not None
        assert report.report_type is ExecutionReportType.CANCELLED
        # Second query: nothing new.
        assert run(adapter.fetch_order_status(order)) is None
        run(adapter.stop())

    def test_status_replay_after_reconnect_deduped(self, adapter, client, aapl, usd):
        reports = []

        async def handler(report):
            reports.append(report)

        adapter.attach_report_handler(handler)
        run(adapter.start())
        order = make_order(aapl, usd)
        submitted = run(adapter.submit_order(order))
        run(adapter.drain())
        assert reports == []

        # Broker cancelled while we were disconnected.
        client.simulate_unexpected_disconnect()
        client.force_status(int(submitted.broker_order_id), "Cancelled")
        run(adapter.reconnect())
        run(adapter.drain())
        # New information delivered exactly once via the status replay.
        assert len(reports) == 1
        assert reports[0].report_type is ExecutionReportType.CANCELLED

        # A second disconnect/reconnect replays the SAME status -> deduped.
        client.simulate_unexpected_disconnect()
        run(adapter.reconnect())
        run(adapter.drain())
        assert len(reports) == 1
        run(adapter.stop())