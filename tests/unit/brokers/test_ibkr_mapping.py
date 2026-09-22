"""Unit tests for the IBKR mapping layer (pure translation)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from domain.errors import BrokerError, ErrorCode
from domain.fills import ExecutionReportType
from domain.instrument import AssetClass, Exchange, InstrumentType
from domain.orders import OrderType, TimeInForce
from brokers.ibkr import mapping
from brokers.ibkr.contracts import IbkrContract
from tests.unit.brokers.conftest import account_values_usd, make_execution, make_order


class TestInstrumentMapping:
    def test_equity_to_contract(self, aapl):
        contract = mapping.instrument_to_contract(aapl)
        assert contract.symbol == "AAPL"
        assert contract.sec_type == "STK"
        assert contract.exchange == "NASDAQ"
        assert contract.currency == "USD"
        assert contract.con_id is None

    def test_equity_round_trip(self, aapl):
        contract = mapping.instrument_to_contract(aapl)
        restored = mapping.contract_to_instrument(contract)
        assert restored.symbol == aapl.symbol
        assert restored.asset_class is AssetClass.EQUITY
        assert restored.exchange is Exchange.NASDAQ
        assert restored.currency == aapl.currency
        assert restored.instrument_type is InstrumentType.STOCK

    def test_forex_pair_to_cash_contract(self, eurusd, eur):
        contract = mapping.instrument_to_contract(eurusd)
        assert contract.sec_type == "CASH"
        assert contract.symbol == "EUR"
        assert contract.currency == "USD"  # quote currency
        assert contract.exchange == "IDEALPRO"

    def test_forex_round_trip(self, eurusd):
        restored = mapping.contract_to_instrument(mapping.instrument_to_contract(eurusd))
        assert restored.symbol == "EUR/USD"
        assert restored.asset_class is AssetClass.FOREX

    def test_con_id_preserved_both_ways(self, aapl):
        instrument = aapl.model_copy(update={"identifiers": {"CON_ID": "265598"}})
        contract = mapping.instrument_to_contract(instrument)
        assert contract.con_id == 265598
        assert mapping.contract_to_instrument(contract).identifiers["CON_ID"] == "265598"

    def test_unknown_exchange_routes_smart(self, aapl):
        unknown = aapl.model_copy(update={"exchange": Exchange.UNKNOWN})
        assert mapping.instrument_to_contract(unknown).exchange == "SMART"

    def test_unsupported_sec_type_rejected(self):
        contract = IbkrContract(symbol="X", sec_type="WARP", exchange="SMART", currency="USD")
        with pytest.raises(BrokerError):
            mapping.contract_to_instrument(contract)


class TestOrderMapping:
    def test_limit_order_mapping(self, aapl, usd):
        order = make_order(aapl, usd)
        ibkr_order = mapping.order_to_ibkr(order)
        assert ibkr_order.action == "BUY"
        assert ibkr_order.order_type == "LMT"
        # The internal Quantity is quantized to 8dp; the exact value is preserved.
        assert Decimal(ibkr_order.quantity) == Decimal("10")
        assert ibkr_order.lmt_price == "100"
        assert ibkr_order.tif == "DAY"
        assert ibkr_order.order_ref == str(order.client_order_id)

    def test_order_type_matrix(self, aapl, usd):
        base = make_order(aapl, usd)
        for internal, expected in [
            (OrderType.MARKET, "MKT"),
            (OrderType.STOP, "STP"),
            (OrderType.STOP_LIMIT, "STP LMT"),
        ]:
            order = base.model_copy(update={"order_type": internal})
            assert mapping.order_to_ibkr(order).order_type == expected


class TestStatusMapping:
    def test_accepted_statuses(self):
        assert mapping.order_status_to_report_type("Submitted") is ExecutionReportType.ACCEPTED
        assert mapping.order_status_to_report_type("PreSubmitted") is ExecutionReportType.ACCEPTED

    def test_cancelled(self):
        assert mapping.order_status_to_report_type("Cancelled") is ExecutionReportType.CANCELLED
        assert mapping.order_status_to_report_type("ApiCancelled") is ExecutionReportType.CANCELLED

    def test_inactive_is_rejection(self):
        assert mapping.order_status_to_report_type("Inactive") is ExecutionReportType.REJECTED

    def test_fill_and_prestates_unmapped(self):
        for status in ("Filled", "PartiallyFilled", "ApiPending", "PendingSubmit"):
            with pytest.raises(ValueError):
                mapping.order_status_to_report_type(status)


class TestExecutionMapping:
    def test_execution_to_fill(self, aapl, usd):
        order = make_order(aapl, usd)
        execution = make_execution(101, order, execution_id="E-1", quantity="10", cum="10")
        fill = mapping.execution_to_fill(execution, aapl, account_id="ACC-001")
        assert fill.fill_id == "E-1"
        assert fill.order_client_id == order.client_order_id
        assert fill.account_id == "ACC-001"
        assert fill.quantity.value == Decimal("10")
        assert fill.price.value == Decimal("100")
        # Unix seconds -> timezone-aware UTC.
        assert fill.executed_at == datetime(2023, 11, 14, 22, 13, 20, tzinfo=UTC)

    def test_invalid_side_rejected(self, aapl, usd):
        from dataclasses import replace

        order = make_order(aapl, usd)
        execution = make_execution(101, order, execution_id="E-2", quantity="10", cum="10")
        bad = replace(execution, side="SIDEWAYS")
        with pytest.raises(BrokerError):
            mapping.execution_to_fill(bad, aapl, account_id="ACC-001")

    def test_missing_order_ref_rejected(self, aapl, usd):
        from dataclasses import replace
        order = make_order(aapl, usd)
        execution = make_execution(101, order, execution_id="E-3", quantity="10", cum="10")
        bad = replace(execution, order_ref=None)
        with pytest.raises(BrokerError):
            mapping.execution_to_fill(bad, aapl, account_id="ACC-001")


class TestAccountMapping:
    def test_account_values_to_balance(self, usd):
        balance = mapping.account_values_to_balance("DU123456", account_values_usd())
        cash = balance.cash["USD"]
        assert cash.total.amount == Decimal("10000")
        assert cash.available.amount == Decimal("8000")
        assert cash.buying_power is not None
        assert cash.buying_power.amount == Decimal("40000")

    def test_no_usable_values_rejected(self):
        from brokers.ibkr.contracts import IbkrAccountValue
        with pytest.raises(BrokerError):
            mapping.account_values_to_balance("DU123456", [IbkrAccountValue(key="Other", value="1", currency="USD")])


class TestPositionMapping:
    def test_ibkr_position_to_domain(self, aapl):
        from brokers.ibkr.contracts import IbkrPosition
        from tests.unit.brokers.conftest import aapl_contract

        position = mapping.ibkr_position_to_position(
            IbkrPosition(
                account="DU123456",
                contract=aapl_contract(),
                position="-150",
                avg_cost="99.50",
            )
        )
        assert position.account_id == "DU123456"
        assert position.quantity.value == Decimal("-150")
        assert position.is_short
        assert position.average_price is not None
        assert position.average_price.value == Decimal("99.50")


class TestErrorMapping:
    def test_connection_errors(self):
        for code in (502, 504, 1100):
            error = mapping.map_ibkr_error(code, "boom")
            assert error.code is ErrorCode.CONNECTION_LOST
            assert error.broker == "IBKR"
            assert error.broker_error_code == str(code)

    def test_order_rejected(self):
        error = mapping.map_ibkr_error(201, "order rejected")
        assert error.code is ErrorCode.ORDER_REJECTED

    def test_unknown_code_preserved(self):
        error = mapping.map_ibkr_error(99999, "mystery")
        assert error.code is ErrorCode.UNKNOWN
        assert error.broker_error_code == "99999"


class TestBarMapping:
    def test_bar_size_mapping(self):
        assert mapping.ibkr_bar_size_to_interval("1 min").value == "1m"
        assert mapping.ibkr_bar_size_to_interval("1 day").value == "1d"

    def test_unsupported_bar_size_rejected(self):
        with pytest.raises(BrokerError):
            mapping.ibkr_bar_size_to_interval("2 mins")