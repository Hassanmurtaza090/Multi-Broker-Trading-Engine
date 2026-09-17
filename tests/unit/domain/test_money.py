"""Unit tests for money primitives (Currency, Money, Quantity, Price)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from domain.money import Currency, Money, Price, Quantity, money, qty


class TestCurrency:
    def test_normalizes_to_upper(self) -> None:
        assert Currency(code="usd").code == "USD"

    def test_rejects_bad_length(self) -> None:
        with pytest.raises(ValueError):
            Currency(code="US")

    def test_rejects_non_alpha(self) -> None:
        with pytest.raises(ValueError):
            Currency(code="U5D")

    def test_equality_and_hash(self) -> None:
        assert Currency(code="usd") == Currency(code="USD")
        assert hash(Currency(code="usd")) == hash(Currency(code="USD"))


class TestMoney:
    def test_rounds_to_2dp(self) -> None:
        m = Money(amount="1.234", currency=Currency(code="USD"))
        assert m.amount == Decimal("1.23")

    def test_add_same_currency(self) -> None:
        a = money("1.00", "USD")
        b = money("2.50", "USD")
        assert (a + b).amount == Decimal("3.50")

    def test_add_mismatched_currency_raises(self) -> None:
        with pytest.raises(ValueError):
            money("1.00", "USD") + money("1.00", "EUR")

    def test_subtract(self) -> None:
        assert (money("5.00", "USD") - money("2.00", "USD")).amount == Decimal("3.00")

    def test_neg_and_abs(self) -> None:
        assert (-money("5.00", "USD")).amount == Decimal("-5.00")
        assert abs(money("-5.00", "USD")).amount == Decimal("5.00")

    def test_comparisons(self) -> None:
        assert money("1.00", "USD") < money("2.00", "USD")
        assert money("2.00", "USD") >= money("2.00", "USD")

    def test_rejects_infinity(self) -> None:
        with pytest.raises(ValueError):
            Money(amount=float("inf"), currency=Currency(code="USD"))

    def test_rejects_nan(self) -> None:
        with pytest.raises(ValueError):
            Money(amount=float("nan"), currency=Currency(code="USD"))


class TestQuantity:
    def test_signed_values(self) -> None:
        assert qty("10").is_positive()
        assert qty("-10").is_negative()
        assert qty("0").is_zero()

    def test_add_subtract(self) -> None:
        assert (qty("10") + qty("-4")).value == Decimal("6")
        assert (qty("10") - qty("4")).value == Decimal("6")

    def test_neg_abs(self) -> None:
        assert (-qty("5")).value == Decimal("-5")
        assert abs(qty("-5")).value == Decimal("5")

    def test_comparisons(self) -> None:
        assert qty("1") < qty("2")
        assert qty("2") >= qty("1")

    def test_rejects_non_number(self) -> None:
        with pytest.raises(ValueError):
            Quantity(value="abc")


class TestPrice:
    def test_rejects_negative(self) -> None:
        with pytest.raises(ValueError):
            Price(value="-1", currency=Currency(code="USD"))

    def test_zero_valid(self) -> None:
        assert Price(value="0", currency=Currency(code="USD")).value == Decimal("0")

    def test_comparison_same_currency(self) -> None:
        p1 = Price(value="1", currency=Currency(code="USD"))
        p2 = Price(value="2", currency=Currency(code="USD"))
        assert p1 < p2

    def test_comparison_mismatched_currency_raises(self) -> None:
        p1 = Price(value="1", currency=Currency(code="USD"))
        p2 = Price(value="2", currency=Currency(code="EUR"))
        with pytest.raises(ValueError):
            p1 < p2