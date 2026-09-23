"""Unit tests for the Saxo mapping layer (pure translation)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from domain.errors import BrokerError, ErrorCode
from domain.fills import ExecutionReportType
from domain.instrument import AssetClass, Exchange, InstrumentType
from domain.orders import OrderSide, OrderType, TimeInForce
from brokers.saxo import mapping
from brokers.saxo.contracts import SaxoBalance, SaxoInstrument
from tests.unit.brokers.conftest import (
    SAXO_AAPL_UIC,
    make_order,
    make_saxo_execution,
    saxo_aapl,
    saxo_aapl_instrument,
    saxo_balance_usd,
    saxo_eurusd,
    saxo_position_aapl,
)


class TestInstrumentMapping:
    def test_equity_to_saxo(self, usd):
        instrument = saxo_aapl(usd)
        saxo = mapping.instrument_to_saxo(instrument)
        assert saxo.uic == SAXO_AAPL_UIC
        assert saxo.asset_type == "Stock"
        assert saxo.symbol == "AAPL"
        assert saxo.currency == "USD"
        assert saxo.exchange == "NASDAQ"

    def test_equity_round_trip(self, usd):
        instrument = saxo_aapl(usd)
        restored = mapping.saxo_to_instrument(mapping.instrument_to_saxo(instrument))
        assert restored.symbol == "AAPL"
        assert restored.asset_class is AssetClass.EQUITY
        assert restored.exchange is Exchange.NASDAQ
        assert restored.instrument_type is InstrumentType.STOCK
        assert restored.identifiers["SAXO_UIC"] == str(SAXO_AAPL_UIC)

    def test_forex_round_trip(self, eur):
        instrument = saxo_eurusd(eur)
        saxo = mapping.instrument_to_saxo(instrument)
        assert saxo.asset_type == "FxSpot"
        restored = mapping.saxo_to_instrument(saxo)
        assert restored.symbol == "EUR/USD"
        assert restored.asset_class is AssetClass.FOREX
        assert restored.exchange is Exchange.OTC
        assert restored.instrument_type is InstrumentType.CURRENCY_PAIR

    def test_missing_uic_rejected(self, aapl):
        with pytest.raises(BrokerError) as excinfo:
            mapping.instrument_to_saxo(aapl)
        assert excinfo.value.broker_error_code == "MISSING_UIC"

    def test_invalid_uic_rejected(self, usd):
        bad = saxo_aapl(usd).model_copy(update={"identifiers": {"SAXO_UIC": "not-a-number"}})
        with pytest.raises(BrokerError):
            mapping.instrument_to_saxo(bad)

    def test_unsupported_asset_type_rejected(self):
        bad = SaxoInstrument(uic=1, asset_type="WarpDrive", symbol="X", currency="USD")
        with pytest.raises(BrokerError):
            mapping.saxo_to_instrument(bad)


class TestOrderMapping:
    def test_limit_order_mapping(self, usd):
        order = make_order(saxo_aapl(usd), usd)
        saxo = mapping.order_to_saxo(
            order, account_key="ACC-001", saxo=mapping.instrument_to_saxo(order.instrument)
        )
        assert saxo.buy_sell == "buy"
        assert saxo.order_type == "Limit"
        assert Decimal(saxo.quantity) == Decimal("10")
        assert saxo.order_duration == "Day"
        assert saxo.limit_price == "100"
        assert saxo.external_reference == str(order.client_order_id)
        assert saxo.uic == SAXO_AAPL_UIC

    def test_order_type_matrix(self, usd):
        base = make_order(saxo_aapl(usd), usd)
        for internal, expected in [
            (OrderType.MARKET, "Market"),
            (OrderType.STOP, "Stop"),
            (OrderType.STOP_LIMIT, "StopLimit"),
        ]:
            order = base.model_copy(update={"order_type": internal})
            saxo = mapping.order_to_saxo(
                order, account_key="ACC-001", saxo=mapping.instrument_to_saxo(order.instrument)
            )
            assert saxo.order_type == expected

    def test_sell_side(self, usd):
        order = make_order(saxo_aapl(usd), usd, side=OrderSide.SELL)
        saxo = mapping.order_to_saxo(
            order, account_key="ACC-001", saxo=mapping.instrument_to_saxo(order.instrument)
        )
        assert saxo.buy_sell == "sell"


class TestStatusMapping:
    def test_accepted_statuses(self):
        assert mapping.order_status_to_report_type("Working") is ExecutionReportType.ACCEPTED
        assert (
            mapping.order_status_to_report_type("WaitingConfirmation")
            is ExecutionReportType.ACCEPTED
        )

    def test_terminal_statuses(self):
        assert mapping.order_status_to_report_type("Cancelled") is ExecutionReportType.CANCELLED
        assert mapping.order_status_to_report_type("Rejected") is ExecutionReportType.REJECTED
        # Saxo additionally reports expiry — a genuine capability difference.
        assert mapping.order_status_to_report_type("Expired") is ExecutionReportType.EXPIRED

    def test_fill_and_prestates_unmapped(self):
        for status in ("Filled", "PartiallyFilled", "Received", "Suspended"):
            with pytest.raises(ValueError):
                mapping.order_status_to_report_type(status)


class TestExecutionMapping:
    def test_execution_to_fill(self, usd):
        order = make_order(saxo_aapl(usd), usd)
        execution = make_saxo_execution(201, order, execution_id="SE-1", quantity="10", cum="10")
        fill = mapping.execution_to_fill(execution, order.instrument, account_id="ACC-001")
        assert fill.fill_id == "SE-1"
        assert fill.order_client_id == order.client_order_id
        assert fill.side is OrderSide.BUY
        assert fill.quantity.value == Decimal("10")
        assert fill.price.value == Decimal("100")
        assert fill.executed_at == datetime(2023, 11, 14, 22, 13, 20, tzinfo=UTC)

    def test_invalid_side_rejected(self, usd):
        from dataclasses import replace

        order = make_order(saxo_aapl(usd), usd)
        execution = make_saxo_execution(201, order, execution_id="SE-2", quantity="10", cum="10")
        bad = replace(execution, buy_sell="sideways")
        with pytest.raises(BrokerError):
            mapping.execution_to_fill(bad, order.instrument, account_id="ACC-001")

    def test_missing_external_reference_rejected(self, usd):
        from dataclasses import replace

        order = make_order(saxo_aapl(usd), usd)
        execution = make_saxo_execution(201, order, execution_id="SE-3", quantity="10", cum="10")
        bad = replace(execution, external_reference=None)
        with pytest.raises(BrokerError):
            mapping.execution_to_fill(bad, order.instrument, account_id="ACC-001")


class TestBalanceMapping:
    def test_full_snapshot_to_balance(self):
        balance = mapping.balance_to_domain("ACC-001", saxo_balance_usd())
        cash = balance.cash["USD"]
        assert cash.total.amount == Decimal("10000")
        assert cash.available.amount == Decimal("8000")
        assert cash.buying_power is not None
        assert cash.buying_power.amount == Decimal("40000")

    def test_missing_currency_rejected(self):
        from dataclasses import replace

        bad = replace(saxo_balance_usd(), currency="")
        with pytest.raises(BrokerError):
            mapping.balance_to_domain("ACC-001", bad)


class TestPositionMapping:
    def test_position_to_domain(self):
        position = mapping.position_to_domain(saxo_position_aapl())
        assert position.account_id == "SAXO-ACC"  # adapter relabels afterwards
        assert position.quantity.value == Decimal("100")
        assert position.average_price is not None
        assert position.average_price.value == Decimal("100")
        assert position.instrument.identifiers["SAXO_UIC"] == str(SAXO_AAPL_UIC)


class TestErrorMapping:
    def test_auth_errors(self):
        for code in (401, 403):
            error = mapping.map_saxo_error(code, "denied")
            assert error.code is ErrorCode.UNAUTHORIZED
            assert error.broker == "SAXO"
            assert error.broker_error_code == str(code)

    def test_rate_limit(self):
        error = mapping.map_saxo_error(429, "slow down")
        assert error.code is ErrorCode.RATE_LIMITED

    def test_service_unavailable(self):
        error = mapping.map_saxo_error(503, "unavailable")
        assert error.code is ErrorCode.CONNECTION_LOST

    def test_unknown_code_preserved(self):
        error = mapping.map_saxo_error(99999, "mystery")
        assert error.code is ErrorCode.UNKNOWN
        assert error.broker_error_code == "99999"


class TestIntervalMapping:
    def test_intervals(self):
        assert mapping.saxo_interval_to_bar_interval("1m").value == "1m"
        assert mapping.saxo_interval_to_bar_interval("1d").value == "1d"

    def test_unsupported_interval_rejected(self):
        with pytest.raises(BrokerError):
            mapping.saxo_interval_to_bar_interval("2m")