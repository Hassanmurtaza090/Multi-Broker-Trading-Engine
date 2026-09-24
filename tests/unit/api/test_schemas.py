"""Unit tests for API schemas (DTO mapping + exact-decimal serialization)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from domain.instrument import AssetClass, Exchange
from domain.money import Currency, Price, Quantity
from domain.orders import Order, OrderRequest, OrderSide, OrderType, TimeInForce
from api.schemas import (
    InstrumentIn,
    OrderCreateIn,
    build_order_request,
    decision_to_out,
    order_to_out,
    balance_to_out,
    quote_to_out,
    dec,
)


def _order() -> Order:
    usd = Currency(code="USD")
    from domain.instrument import Instrument

    instrument = Instrument(
        symbol="AAPL", asset_class=AssetClass.EQUITY, currency=usd, exchange=Exchange.NASDAQ
    )
    return OrderRequest(
        account_id="ACC-001",
        instrument=instrument,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value="10"),
        limit_price=Price(value="100.125", currency=usd),
    ).to_order()


class TestDecimalSerialization:
    def test_dec_exact_string(self):
        assert dec(Decimal("100.125")) == "100.125"
        assert dec(Decimal("0.1")) == "0.1"  # never "0.1000000000000000055"
        assert dec(None) is None

    def test_order_out_serializes_decimals_as_strings(self):
        out = order_to_out(_order())
        assert out.quantity == "10.00000000"
        assert out.limit_price == "100.125"
        # Fixed-point strings: never scientific notation like "0E-8".
        assert out.filled_quantity == "0.00000000"
        assert out.remaining_quantity == "10.00000000"
        assert out.status == "NEW"


class TestOrderRequestBuilding:
    def test_build_order_request(self):
        body = OrderCreateIn(
            account_id="ACC-001",
            instrument=InstrumentIn(symbol="AAPL", asset_class="EQUITY", currency="USD", exchange="NASDAQ"),
            side="BUY",
            order_type="LIMIT",
            quantity="10",
            limit_price="100",
        )
        request = build_order_request(body)
        assert request.account_id == "ACC-001"
        assert request.instrument.symbol == "AAPL"
        assert request.quantity.value == Decimal("10")
        assert request.limit_price is not None
        assert request.limit_price.value == Decimal("100")
        assert request.side is OrderSide.BUY
        assert request.time_in_force is TimeInForce.DAY

    def test_invalid_order_type_invariant_rejected(self):
        # MARKET order with a limit price violates the domain invariant.
        body = OrderCreateIn(
            account_id="ACC-001",
            instrument=InstrumentIn(symbol="AAPL", asset_class="EQUITY", currency="USD"),
            side="BUY",
            order_type="MARKET",
            quantity="10",
            limit_price="100",
        )
        with pytest.raises(ValueError):
            build_order_request(body)

    def test_unknown_field_rejected(self):
        with pytest.raises(ValueError):
            OrderCreateIn.model_validate(
                {
                    "account_id": "ACC-001",
                    "instrument": {"symbol": "AAPL", "asset_class": "EQUITY", "currency": "USD"},
                    "side": "BUY",
                    "order_type": "MARKET",
                    "quantity": "10",
                    "sneaky_field": "no-mass-assignment",
                }
            )


class TestRiskDecisionOut:
    def test_decision_mapping(self):
        from risk.models import RiskDecision, RuleResult

        decision = RiskDecision(
            approved=False,
            results=(RuleResult(rule="kill_switch", approved=False, reason="halted"),),
        )
        out = decision_to_out(decision)
        assert out.approved is False
        assert out.violations[0].rule == "kill_switch"
        assert out.violations[0].reason == "halted"


class TestBalanceOut:
    def test_balance_mapping_sorted(self):
        from domain.account import Balance, CashBalance
        from domain.money import Money

        usd = Currency(code="USD")
        balance = Balance(
            account_id="ACC-001",
            cash={
                "USD": CashBalance(
                    currency=usd,
                    total=Money(amount="10000", currency=usd),
                    available=Money(amount="8000", currency=usd),
                )
            },
        )
        out = balance_to_out(balance)
        assert out.cash[0].currency == "USD"
        assert out.cash[0].total == "10000.00"
        assert out.cash[0].available == "8000.00"
        assert out.cash[0].buying_power is None


class TestQuoteOut:
    def test_quote_mapping(self):
        from domain.market import MarketQuote
        from domain.instrument import Instrument

        usd = Currency(code="USD")
        instrument = Instrument(
            symbol="AAPL", asset_class=AssetClass.EQUITY, currency=usd, exchange=Exchange.NASDAQ
        )
        quote = MarketQuote(
            instrument=instrument,
            bid=Price(value="99", currency=usd),
            ask=Price(value="101", currency=usd),
        )
        out = quote_to_out(quote, stale=True)
        assert out.bid == "99"
        assert out.ask == "101"
        assert out.mid == "100"
        assert out.stale is True
