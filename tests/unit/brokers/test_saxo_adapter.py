"""Unit tests for the Saxo adapter (session, connection, orders, dedup, errors)."""

from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest

from domain.errors import BrokerError, ErrorCode
from domain.fills import ExecutionReportType
from domain.orders import OrderStatus
from events import BalanceUpdated, BrokerConnected, BrokerDisconnected
from brokers.base import RawQuote
from brokers.saxo.contracts import SaxoOrderStatus
from tests.unit.brokers.conftest import (
    SAXO_AAPL_UIC,
    make_order,
    make_saxo_execution,
    make_saxo_quote,
    saxo_aapl,
    saxo_balance_usd,
    saxo_position_aapl,
)


def run(coro):
    return asyncio.run(coro)


class TestSessionAndConnection:
    def test_start_authorizes_and_publishes_connected(self, saxo_adapter, saxo_client, bus):
        events = []
        bus.subscribe("broker.connected", lambda env: events.append(env.payload))
        run(saxo_adapter.start())
        assert saxo_adapter.is_connected
        run(saxo_adapter.drain())
        assert len(events) == 1 and isinstance(events[0], BrokerConnected)
        assert events[0].broker == "SAXO"

    def test_authorization_failure_raises_unauthorized(self, saxo_adapter, saxo_client):
        saxo_client.fail_authorize = True
        with pytest.raises(BrokerError) as excinfo:
            run(saxo_adapter.start())
        assert excinfo.value.code is ErrorCode.UNAUTHORIZED
        assert saxo_adapter.is_connected is False

    def test_start_is_idempotent(self, saxo_adapter, saxo_client, bus):
        events = []
        bus.subscribe("broker.connected", lambda env: events.append(env.payload))
        run(saxo_adapter.start())
        run(saxo_adapter.start())  # duplicate start
        run(saxo_adapter.drain())
        assert len(events) == 1

    def test_stop_publishes_disconnected(self, saxo_adapter, saxo_client, bus):
        events = []
        bus.subscribe("broker.disconnected", lambda env: events.append(env.payload))
        run(saxo_adapter.start())
        run(saxo_adapter.stop())
        run(saxo_adapter.drain())
        assert len(events) == 1 and isinstance(events[0], BrokerDisconnected)
        assert events[0].reason == "shutdown"

    def test_unexpected_disconnect_publishes_connection_lost(self, saxo_adapter, saxo_client, bus):
        events = []
        bus.subscribe("broker.disconnected", lambda env: events.append(env.payload))
        run(saxo_adapter.start())
        run(saxo_adapter.drain())
        saxo_client.simulate_unexpected_disconnect()
        run(saxo_adapter.drain())
        assert events[-1].reason == "connection lost"
        assert saxo_adapter.is_connected is False

    def test_reconnect_resubscribes_streaming(self, saxo_adapter, saxo_client, usd):
        aapl = saxo_aapl(usd)
        run(saxo_adapter.start())
        run(saxo_adapter.subscribe(aapl))
        saxo_client.simulate_unexpected_disconnect()
        assert len(saxo_client.subscriptions) == 0  # streaming lost on drop
        run(saxo_adapter.reconnect())
        assert saxo_adapter.is_connected
        # Exactly one subscription after reconnect (no duplicates).
        assert len(saxo_client.subscriptions) == 1
        run(saxo_adapter.stop())

    def test_reconnect_is_idempotent(self, saxo_adapter, saxo_client):
        run(saxo_adapter.start())
        run(saxo_adapter.reconnect())  # already connected -> no-op
        assert len(saxo_client.subscriptions) == 0
        run(saxo_adapter.stop())


class TestTokenLifecycle:
    def test_proactive_refresh_on_token_expired(self, saxo_adapter, saxo_client, usd):
        aapl = saxo_aapl(usd)
        run(saxo_adapter.start())
        saxo_client.expire_session()  # fires on_token_expired -> adapter refreshes
        # Session restored: subsequent API calls work.
        run(saxo_adapter.subscribe(aapl))
        assert len(saxo_client.subscriptions) == 1
        run(saxo_adapter.stop())

    def test_refresh_failure_disconnects(self, saxo_adapter, saxo_client, bus):
        events = []
        bus.subscribe("broker.disconnected", lambda env: events.append(env.payload))
        run(saxo_adapter.start())
        saxo_client.fail_refresh = True
        saxo_client.expire_session()
        run(saxo_adapter.drain())
        assert saxo_adapter.is_connected is False
        assert events[-1].reason == "session expired"

    def test_reactive_refresh_and_retry_on_auth_error(self, saxo_adapter, saxo_client, usd):
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd)
        # Silent expiry (no callback): the next request raises inside the
        # client; the adapter refreshes once and retries — the order lands.
        saxo_client.session_expired = True
        report = run(saxo_adapter.submit_order(order))
        assert report.report_type is ExecutionReportType.ACCEPTED
        assert saxo_client.session_expired is False  # refresh restored the session
        run(saxo_adapter.stop())

    def test_refresh_failure_maps_to_unauthorized(self, saxo_adapter, saxo_client, usd):
        run(saxo_adapter.start())
        saxo_client.session_expired = True
        saxo_client.fail_refresh = True
        with pytest.raises(BrokerError) as excinfo:
            run(saxo_adapter.submit_order(make_order(saxo_aapl(usd), usd)))
        assert excinfo.value.code is ErrorCode.UNAUTHORIZED
        run(saxo_adapter.stop())


class TestMarketData:
    def test_subscribe_unsubscribe(self, saxo_adapter, saxo_client, usd):
        aapl = saxo_aapl(usd)
        run(saxo_adapter.start())
        sub = run(saxo_adapter.subscribe(aapl))
        assert len(saxo_client.subscriptions) == 1
        run(saxo_adapter.unsubscribe(sub))
        assert len(saxo_client.subscriptions) == 0
        run(saxo_adapter.stop())

    def test_duplicate_subscribe_not_duplicated_at_client(self, saxo_adapter, saxo_client, usd):
        aapl = saxo_aapl(usd)
        run(saxo_adapter.start())
        run(saxo_adapter.subscribe(aapl))
        run(saxo_adapter.subscribe(aapl))
        assert len(saxo_client.subscriptions) == 1
        run(saxo_adapter.stop())

    def test_quote_pushed_as_raw_quote(self, saxo_adapter, saxo_client, usd):
        received = []

        async def handler(event):
            received.append(event)

        saxo_adapter.attach_handler(handler)
        aapl = saxo_aapl(usd)
        run(saxo_adapter.start())
        run(saxo_adapter.subscribe(aapl))
        saxo_client.emit_quote(make_saxo_quote())
        run(saxo_adapter.drain())
        assert len(received) == 1
        quote = received[0]
        assert isinstance(quote, RawQuote)
        assert quote.instrument.symbol == "AAPL"
        assert quote.bid is not None and quote.bid.value == Decimal("99")
        assert quote.ask is not None and quote.ask.value == Decimal("101")
        assert quote.timestamp.tzinfo is not None
        run(saxo_adapter.stop())

    def test_quote_for_unsubscribed_uic_dropped(self, saxo_adapter, saxo_client, usd):
        received = []

        async def handler(event):
            received.append(event)

        saxo_adapter.attach_handler(handler)
        run(saxo_adapter.start())
        saxo_client.emit_quote(make_saxo_quote(uic=999999))
        run(saxo_adapter.drain())
        assert received == []
        run(saxo_adapter.stop())

    def test_malformed_quote_dropped_without_crash(self, saxo_adapter, saxo_client, usd):
        received = []

        async def handler(event):
            received.append(event)

        saxo_adapter.attach_handler(handler)
        aapl = saxo_aapl(usd)
        run(saxo_adapter.start())
        run(saxo_adapter.subscribe(aapl))
        bad = make_saxo_quote(bid="not-a-price")
        saxo_client.emit_quote(bad)
        run(saxo_adapter.drain())
        assert received == []
        run(saxo_adapter.stop())

    def test_bar_pushed_as_raw_bar(self, saxo_adapter, saxo_client, usd):
        from brokers.saxo.contracts import SaxoBar

        received = []

        async def handler(event):
            received.append(event)

        saxo_adapter.attach_handler(handler)
        aapl = saxo_aapl(usd)
        run(saxo_adapter.start())
        run(saxo_adapter.subscribe(aapl))
        saxo_client.emit_bar(
            SaxoBar(
                uic=SAXO_AAPL_UIC,
                asset_type="Stock",
                interval="1m",
                open="100",
                high="101",
                low="99",
                close="100",
                volume="1000",
                timestamp_unix=1_700_000_000,
            )
        )
        run(saxo_adapter.drain())
        assert len(received) == 1
        assert received[0].interval.value == "1m"
        assert received[0].open.value == Decimal("100")
        run(saxo_adapter.stop())

    def test_historical_bars_requested(self, saxo_adapter, saxo_client, usd):
        from brokers.saxo import mapping

        aapl = saxo_aapl(usd)
        run(saxo_adapter.start())
        run(saxo_adapter.request_historical_bars(aapl, "1m"))
        expected = mapping.instrument_to_saxo(aapl)
        assert saxo_client.requested_bars == [(expected, "1m")]
        run(saxo_adapter.stop())

    def test_subscribe_requires_connection(self, saxo_adapter, usd):
        with pytest.raises(BrokerError):
            run(saxo_adapter.subscribe(saxo_aapl(usd)))


class TestOrders:
    def test_submit_returns_accept(self, saxo_adapter, saxo_client, usd):
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd)
        report = run(saxo_adapter.submit_order(order))
        assert report.report_type is ExecutionReportType.ACCEPTED
        assert report.order_client_id == order.client_order_id
        run(saxo_adapter.drain())
        run(saxo_adapter.stop())

    def test_submit_rejection_returned(self, saxo_adapter, saxo_client, usd):
        run(saxo_adapter.start())
        saxo_client.reject_orders = True
        order = make_order(saxo_aapl(usd), usd)
        report = run(saxo_adapter.submit_order(order))
        assert report.report_type is ExecutionReportType.REJECTED
        run(saxo_adapter.stop())

    def test_submit_not_connected_rejected(self, saxo_adapter, usd):
        with pytest.raises(BrokerError):
            run(saxo_adapter.submit_order(make_order(saxo_aapl(usd), usd)))

    def test_cancel_confirmed(self, saxo_adapter, saxo_client, usd):
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd)
        run(saxo_adapter.submit_order(order))
        report = run(saxo_adapter.cancel_order(order))
        assert report.report_type is ExecutionReportType.CANCELLED
        run(saxo_adapter.stop())

    def test_modify_confirmed(self, saxo_adapter, saxo_client, usd):
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd)
        run(saxo_adapter.submit_order(order))
        report = run(saxo_adapter.modify_order(order))
        assert report.report_type is ExecutionReportType.REPLACED
        run(saxo_adapter.stop())

    def test_cancel_unknown_order_raises(self, saxo_adapter, saxo_client, usd):
        run(saxo_adapter.start())
        with pytest.raises(BrokerError):
            run(saxo_adapter.cancel_order(make_order(saxo_aapl(usd), usd)))
        run(saxo_adapter.stop())

    def test_duplicate_status_callback_not_pushed_twice(self, saxo_adapter, saxo_client, usd):
        reports = []

        async def handler(report):
            reports.append(report)

        saxo_adapter.attach_report_handler(handler)
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd)
        submitted = run(saxo_adapter.submit_order(order))
        run(saxo_adapter.drain())
        assert reports == []  # the buffered Working was consumed by submit
        order_id = int(submitted.broker_order_id)

        # Saxo repeats the Working status -> deduped (no ACCEPTED push).
        saxo_client._cb().on_order_status(SaxoOrderStatus(order_id=order_id, status="Working"))
        run(saxo_adapter.drain())
        assert reports == []

        # A changed status IS pushed exactly once.
        saxo_client._cb().on_order_status(SaxoOrderStatus(order_id=order_id, status="Cancelled"))
        run(saxo_adapter.drain())
        assert len(reports) == 1
        assert reports[0].report_type is ExecutionReportType.CANCELLED
        # ...and repeats of it are deduped.
        saxo_client._cb().on_order_status(SaxoOrderStatus(order_id=order_id, status="Cancelled"))
        run(saxo_adapter.drain())
        assert len(reports) == 1
        run(saxo_adapter.stop())


class TestExecutions:
    def test_execution_pushed_as_fill_report(self, saxo_adapter, saxo_client, usd):
        reports = []

        async def handler(report):
            reports.append(report)

        saxo_adapter.attach_report_handler(handler)
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd, quantity="10")
        submitted = run(saxo_adapter.submit_order(order))
        order_id = int(submitted.broker_order_id)

        saxo_client.emit_execution(
            make_saxo_execution(order_id, order, execution_id="SE-1", quantity="4", cum="4")
        )
        run(saxo_adapter.drain())
        assert len(reports) == 1
        assert reports[0].report_type is ExecutionReportType.PARTIAL_FILL
        assert reports[0].fill is not None
        assert reports[0].fill.fill_id == "SE-1"

        saxo_client.emit_execution(
            make_saxo_execution(order_id, order, execution_id="SE-2", quantity="6", cum="10")
        )
        run(saxo_adapter.drain())
        assert len(reports) == 2
        assert reports[1].report_type is ExecutionReportType.FILL
        run(saxo_adapter.stop())

    def test_duplicate_execution_ignored(self, saxo_adapter, saxo_client, usd):
        reports = []

        async def handler(report):
            reports.append(report)

        saxo_adapter.attach_report_handler(handler)
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd, quantity="10")
        submitted = run(saxo_adapter.submit_order(order))
        order_id = int(submitted.broker_order_id)
        execution = make_saxo_execution(order_id, order, execution_id="SE-DUP", quantity="10", cum="10")
        saxo_client.emit_execution(execution)
        saxo_client.emit_execution(execution)  # redelivery
        run(saxo_adapter.drain())
        assert len(reports) == 1
        run(saxo_adapter.stop())

    def test_execution_for_unknown_order_dropped(self, saxo_adapter, saxo_client, usd):
        reports = []

        async def handler(report):
            reports.append(report)

        saxo_adapter.attach_report_handler(handler)
        run(saxo_adapter.start())
        orphan = make_saxo_execution(999, make_order(saxo_aapl(usd), usd), execution_id="SE-9", quantity="1", cum="1")
        saxo_client._cb().on_execution(orphan)
        run(saxo_adapter.drain())
        assert reports == []
        run(saxo_adapter.stop())


class TestAccountAndPositions:
    def test_balance_snapshot_publishes_balance(self, saxo_adapter, saxo_client, bus):
        balances = []
        bus.subscribe("balance.updated", lambda env: balances.append(env.payload))
        run(saxo_adapter.start())
        saxo_client.balances = [saxo_balance_usd()]
        saxo_client.request_account_summary()
        run(saxo_adapter.drain())
        assert balances and isinstance(balances[0], BalanceUpdated)
        final = balances[-1].balance
        assert final.account_id == "ACC-001"  # relabeled to internal account
        assert final.cash["USD"].total.amount == Decimal("10000")
        # account_balance() aggregates the latest snapshot.
        agg = saxo_adapter.account_balance()
        assert agg is not None
        assert agg.cash["USD"].available.amount == Decimal("8000")
        run(saxo_adapter.stop())

    def test_positions_snapshot_relabeled(self, saxo_adapter, saxo_client):
        run(saxo_adapter.start())
        saxo_client.positions = [saxo_position_aapl()]
        saxo_client.request_positions()
        snapshot = saxo_adapter.position_snapshot()
        assert len(snapshot) == 1
        assert snapshot[0].quantity.value == Decimal("100")
        assert snapshot[0].account_id == "ACC-001"  # relabeled
        run(saxo_adapter.stop())


class TestErrors:
    def test_saxo_error_logged_not_fatal(self, saxo_adapter, saxo_client):
        run(saxo_adapter.start())
        saxo_client.emit_error(429, "rate limit exceeded")
        assert saxo_adapter.is_connected
        run(saxo_adapter.stop())


class TestReconciliation:
    def test_fetch_status_returns_none_when_unchanged(self, saxo_adapter, saxo_client, usd):
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd)
        run(saxo_adapter.submit_order(order))
        assert run(saxo_adapter.fetch_order_status(order)) is None
        run(saxo_adapter.stop())

    def test_fetch_status_detects_broker_side_cancel(self, saxo_adapter, saxo_client, usd):
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd)
        submitted = run(saxo_adapter.submit_order(order))
        saxo_client.force_status(int(submitted.broker_order_id), "Cancelled")
        report = run(saxo_adapter.fetch_order_status(order))
        assert report is not None
        assert report.report_type is ExecutionReportType.CANCELLED
        assert run(saxo_adapter.fetch_order_status(order)) is None  # nothing new
        run(saxo_adapter.stop())

    def test_fetch_status_detects_expiry(self, saxo_adapter, saxo_client, usd):
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd)
        submitted = run(saxo_adapter.submit_order(order))
        saxo_client.force_status(int(submitted.broker_order_id), "Expired")
        report = run(saxo_adapter.fetch_order_status(order))
        assert report is not None
        assert report.report_type is ExecutionReportType.EXPIRED
        run(saxo_adapter.stop())

    def test_status_replay_after_reconnect_deduped(self, saxo_adapter, saxo_client, usd):
        reports = []

        async def handler(report):
            reports.append(report)

        saxo_adapter.attach_report_handler(handler)
        run(saxo_adapter.start())
        order = make_order(saxo_aapl(usd), usd)
        submitted = run(saxo_adapter.submit_order(order))
        run(saxo_adapter.drain())
        assert reports == []

        # Broker cancelled while we were disconnected.
        saxo_client.simulate_unexpected_disconnect()
        saxo_client.force_status(int(submitted.broker_order_id), "Cancelled")
        run(saxo_adapter.reconnect())
        run(saxo_adapter.drain())
        # New information delivered exactly once via the status replay.
        assert len(reports) == 1
        assert reports[0].report_type is ExecutionReportType.CANCELLED

        # A second disconnect/reconnect replays the SAME status -> deduped.
        saxo_client.simulate_unexpected_disconnect()
        run(saxo_adapter.reconnect())
        run(saxo_adapter.drain())
        assert len(reports) == 1
        run(saxo_adapter.stop())