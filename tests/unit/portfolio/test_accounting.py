"""Unit tests for portfolio accounting (hand-calculated expected values)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from domain.money import Money, Price, Quantity
from domain.orders import OrderSide
from portfolio import apply_fill, unrealized_pnl
from tests.unit.portfolio.conftest import make_fill, make_order


class TestAccounting:
    def test_open_long(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        fill = make_fill(order, usd, quantity="10", price="100")
        outcome = apply_fill(None, fill)
        assert outcome.position.quantity.value == 10
        assert outcome.position.average_price.value == 100
        assert outcome.position.is_long
        assert outcome.realized_pnl is None

    def test_increase_updates_vwap(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        pos = apply_fill(None, make_fill(order, usd, quantity="10", price="100")).position
        outcome = apply_fill(pos, make_fill(order, usd, quantity="10", price="110"))
        # avg = (100*10 + 110*10) / 20 = 105
        assert outcome.position.quantity.value == 20
        assert outcome.position.average_price.value == 105
        assert outcome.realized_pnl is None

    def test_reduce_realizes_pnl_and_keeps_avg(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        pos = apply_fill(None, make_fill(order, usd, quantity="10", price="100")).position
        pos = apply_fill(pos, make_fill(order, usd, quantity="10", price="110")).position
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        outcome = apply_fill(pos, make_fill(sell, usd, quantity="5", price="120"))
        # realized = (120 - 105) * 5 = 75
        assert outcome.realized_pnl is not None
        assert outcome.realized_pnl.amount == Decimal("75")
        assert outcome.position.quantity.value == 15
        assert outcome.position.average_price.value == 105

    def test_close_realizes_pnl_and_flattens(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        pos = apply_fill(None, make_fill(order, usd, quantity="10", price="100")).position
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        outcome = apply_fill(pos, make_fill(sell, usd, quantity="10", price="95"))
        # realized = (95 - 100) * 10 = -50
        assert outcome.realized_pnl is not None
        assert outcome.realized_pnl.amount == Decimal("-50")
        assert outcome.position.is_flat
        assert outcome.position.average_price is None

    def test_reverse_closes_then_opens_opposite(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        pos = apply_fill(None, make_fill(order, usd, quantity="10", price="100")).position
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        outcome = apply_fill(pos, make_fill(sell, usd, quantity="15", price="110"))
        # Closed 10 long: realized = (110 - 100) * 10 = 100; new short 5 @ 110.
        assert outcome.realized_pnl is not None
        assert outcome.realized_pnl.amount == Decimal("100")
        assert outcome.position.quantity.value == -5
        assert outcome.position.average_price.value == 110

    def test_short_open_and_reduce(self, aapl, usd):
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        pos = apply_fill(None, make_fill(sell, usd, quantity="10", price="100")).position
        assert pos.quantity.value == -10
        assert pos.average_price.value == 100
        buy = make_order(aapl, usd, side=OrderSide.BUY)
        outcome = apply_fill(pos, make_fill(buy, usd, quantity="4", price="90"))
        # Short closed 4: realized = (100 - 90) * 4 = 40; short 6 remains @ 100.
        assert outcome.realized_pnl is not None
        assert outcome.realized_pnl.amount == Decimal("40")
        assert outcome.position.quantity.value == -6
        assert outcome.position.average_price.value == 100

    def test_fees_reduce_realized(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        pos = apply_fill(None, make_fill(order, usd, quantity="10", price="100")).position
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        outcome = apply_fill(
            pos,
            make_fill(sell, usd, quantity="10", price="110", commission="1.50", fees="0.50"),
        )
        # realized = (110 - 100) * 10 - 2.00 = 98
        assert outcome.realized_pnl is not None
        assert outcome.realized_pnl.amount == Decimal("98")

    def test_opening_fill_with_fees(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        outcome = apply_fill(None, make_fill(order, usd, quantity="10", price="100", commission="2"))
        assert outcome.realized_pnl is not None
        assert outcome.realized_pnl.amount == Decimal("-2")
        assert outcome.position.realized_pnl.amount == Decimal("-2")

    def test_cumulative_realized_stored_on_position(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        pos = apply_fill(None, make_fill(order, usd, quantity="10", price="100")).position
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        pos = apply_fill(pos, make_fill(sell, usd, quantity="5", price="120")).position
        assert pos.realized_pnl is not None
        assert pos.realized_pnl.amount == Decimal("100")  # (120-100)*5
        pos = apply_fill(pos, make_fill(sell, usd, quantity="5", price="110")).position
        assert pos.realized_pnl is not None
        assert pos.realized_pnl.amount == Decimal("150")  # + (110-100)*5

    def test_currency_mismatch_rejected(self, aapl, eur, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        pos = apply_fill(None, make_fill(order, usd, quantity="10", price="100")).position
        bad = make_fill(order, usd, quantity="5", price="120", commission="1")
        # Simulate a fee in the wrong currency.
        bad = bad.model_copy(
            update={"fees": Money(amount="1", currency=eur)},
        )
        with pytest.raises(ValueError):
            apply_fill(pos, bad)


class TestUnrealized:
    def test_long_unrealized(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        pos = apply_fill(None, make_fill(order, usd, quantity="10", price="100")).position
        pnl = unrealized_pnl(pos, Price(value="110", currency=usd))
        assert pnl is not None
        assert pnl.amount == Decimal("100")

    def test_short_unrealized(self, aapl, usd):
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        pos = apply_fill(None, make_fill(sell, usd, quantity="10", price="100")).position
        pnl = unrealized_pnl(pos, Price(value="90", currency=usd))
        assert pnl is not None
        assert pnl.amount == Decimal("100")  # (100-90)*10

    def test_no_price_returns_none(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        pos = apply_fill(None, make_fill(order, usd, quantity="10", price="100")).position
        assert unrealized_pnl(pos, None) is None

    def test_flat_returns_none(self, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        from domain.position import Position

        flat = Position(account_id="ACC-001", instrument=aapl, quantity=Quantity(value="0"))
        assert unrealized_pnl(flat, Price(value="100", currency=usd)) is None