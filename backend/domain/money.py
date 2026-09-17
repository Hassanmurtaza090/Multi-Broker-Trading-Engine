"""Core financial primitives: currency, money, price, quantity.

These are value objects. All are immutable, strongly validated, and use
`Decimal` internally to avoid floating-point error in financial math.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from pydantic import BaseModel, ConfigDict, field_validator

# Currency quantities are rounded to 8 decimal places (handles most FX/sub-asset
# tick sizes while keeping values stable); money (cash) uses 2 by default.
_QTY_PLACES = Decimal("0.00000001")
_MONEY_PLACES = Decimal("0.01")


class Currency(BaseModel):
    """An ISO 4217 currency code, upper-cased and validated."""

    model_config = ConfigDict(frozen=True)

    code: str

    @field_validator("code")
    @classmethod
    def _normalize_code(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != 3 or not v.isalpha():
            raise ValueError(f"currency code must be a 3-letter ISO code, got {v!r}")
        return v

    def __str__(self) -> str:
        return self.code

    def __hash__(self) -> int:
        return hash(self.code)


def _to_decimal(value: Decimal | int | float | str, field_name: str) -> Decimal:
    """Coerce a value to Decimal, rejecting NaN/Infinity and non-numbers."""
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:  # noqa: B904
        raise ValueError(f"{field_name} must be a number") from exc
    if not d.is_finite():
        raise ValueError(f"{field_name} must be a finite number")
    return d


class Money(BaseModel):
    """An amount of money in a specific currency."""

    model_config = ConfigDict(frozen=True)

    amount: Decimal
    currency: Currency

    @field_validator("amount")
    @classmethod
    def _validate_amount(cls, v: Decimal | int | float | str) -> Decimal:
        d = _to_decimal(v, "amount")
        return d.quantize(_MONEY_PLACES, rounding=ROUND_HALF_UP)

    def __add__(self, other: Money) -> Money:
        if self.currency != other.currency:
            raise ValueError("cannot add money of different currencies")
        return Money(amount=self.amount + other.amount, currency=self.currency)

    def __sub__(self, other: Money) -> Money:
        if self.currency != other.currency:
            raise ValueError("cannot subtract money of different currencies")
        return Money(amount=self.amount - other.amount, currency=self.currency)

    def __neg__(self) -> Money:
        return Money(amount=-self.amount, currency=self.currency)

    def __abs__(self) -> Money:
        return Money(amount=abs(self.amount), currency=self.currency)

    def is_zero(self) -> bool:
        return self.amount == 0

    def __lt__(self, other: Money) -> bool:
        return self.amount < other.amount

    def __le__(self, other: Money) -> bool:
        return self.amount <= other.amount

    def __gt__(self, other: Money) -> bool:
        return self.amount > other.amount

    def __ge__(self, other: Money) -> bool:
        return self.amount >= other.amount


class Quantity(BaseModel):
    """A signed asset quantity (can be fractional for FX/sub-assets)."""

    model_config = ConfigDict(frozen=True)

    value: Decimal

    @field_validator("value")
    @classmethod
    def _validate_value(cls, v: Decimal | int | float | str) -> Decimal:
        d = _to_decimal(v, "value")
        return d.quantize(_QTY_PLACES, rounding=ROUND_HALF_UP)

    def __add__(self, other: Quantity) -> Quantity:
        return Quantity(value=self.value + other.value)

    def __sub__(self, other: Quantity) -> Quantity:
        return Quantity(value=self.value - other.value)

    def __neg__(self) -> Quantity:
        return Quantity(value=-self.value)

    def __abs__(self) -> Quantity:
        return Quantity(value=abs(self.value))

    def is_zero(self) -> bool:
        return self.value == 0

    def is_positive(self) -> bool:
        return self.value > 0

    def is_negative(self) -> bool:
        return self.value < 0

    def __lt__(self, other: Quantity) -> bool:
        return self.value < other.value

    def __le__(self, other: Quantity) -> bool:
        return self.value <= other.value

    def __gt__(self, other: Quantity) -> bool:
        return self.value > other.value

    def __ge__(self, other: Quantity) -> bool:
        return self.value >= other.value


class Price(BaseModel):
    """A price in a given currency (e.g. USD for equities, or a quoted pair)."""

    model_config = ConfigDict(frozen=True)

    value: Decimal
    currency: Currency

    @field_validator("value")
    @classmethod
    def _validate_value(cls, v: Decimal | int | float | str) -> Decimal:
        d = _to_decimal(v, "value")
        if d < 0:
            raise ValueError("price cannot be negative")
        return d

    def __lt__(self, other: Price) -> bool:
        self._assert_same_currency(other)
        return self.value < other.value

    def __le__(self, other: Price) -> bool:
        self._assert_same_currency(other)
        return self.value <= other.value

    def __gt__(self, other: Price) -> bool:
        self._assert_same_currency(other)
        return self.value > other.value

    def __ge__(self, other: Price) -> bool:
        self._assert_same_currency(other)
        return self.value >= other.value

    def _assert_same_currency(self, other: Price) -> None:
        if self.currency != other.currency:
            raise ValueError("cannot compare prices of different currencies")


def qty(value: Decimal | int | float | str) -> Quantity:
    """Helper to build a Quantity (coerces numeric input via pydantic)."""
    return Quantity.model_validate({"value": value})


def money(amount: Decimal | int | float | str, currency: str) -> Money:
    """Helper to build a Money value (coerces numeric input via pydantic)."""
    return Money.model_validate({"amount": amount, "currency": {"code": currency}})
