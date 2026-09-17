"""Position: net signed exposure to an instrument on an account."""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain.instrument import Instrument
from domain.money import Money, Price, Quantity


class Position(BaseModel):
    """A signed, netted position.

    `quantity` is signed: positive = long, negative = short. `average_price` is
    the volume-weighted average open price; `realized_pnl` and `unrealized_pnl`
    are computed by the portfolio layer but stored here for reporting.
    """

    model_config = ConfigDict(frozen=True)

    account_id: str = Field(min_length=1)
    instrument: Instrument
    quantity: Quantity
    average_price: Price | None = None
    realized_pnl: Money | None = None
    unrealized_pnl: Money | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("quantity")
    @classmethod
    def _validate_quantity(cls, v: Quantity) -> Quantity:
        # A position may be flat (zero), long, or short — all valid.
        return v

    @property
    def is_flat(self) -> bool:
        return self.quantity.is_zero()

    @property
    def is_long(self) -> bool:
        return self.quantity.is_positive()

    @property
    def is_short(self) -> bool:
        return self.quantity.is_negative()

    @property
    def direction(self) -> str:
        if self.is_flat:
            return "FLAT"
        return "LONG" if self.is_long else "SHORT"

    def apply_fill(self, signed_qty: Quantity, fill_price: Price) -> Position:
        """Apply a fill, updating quantity and volume-weighted average price.

        This is a pure helper for reconciliation (P&L/portfolio in M7);
        it does not mutate — it returns a new Position.
        """
        new_qty = self.quantity + signed_qty
        new_avg = self._compute_vwap(signed_qty, fill_price)
        return self.model_copy(
            update={
                "quantity": new_qty,
                "average_price": new_avg,
                "updated_at": datetime.now(UTC),
            }
        )

    def _compute_vwap(self, signed_qty: Quantity, fill_price: Price) -> Price | None:
        if self.average_price is None:
            if signed_qty.is_zero():
                return None
            return fill_price
        if signed_qty.is_zero():
            return self.average_price
        old_qty = self.quantity.value
        new_qty = old_qty + signed_qty.value
        # Increasing position magnitude in the same direction → VWAP update.
        if (old_qty > 0 and new_qty > old_qty) or (old_qty < 0 and new_qty < old_qty):
            total_cost = self.average_price.value * old_qty
            add_cost = fill_price.value * signed_qty.value
            new_avg = (total_cost + add_cost) / new_qty
            return Price(value=new_avg, currency=fill_price.currency)
        # Reducing within the same direction → average unchanged.
        if (old_qty > 0 and new_qty >= 0) or (old_qty < 0 and new_qty <= 0):
            if new_qty == 0:
                return None
            return self.average_price
        # Position flips to the opposite side → average resets to the fill price.
        return fill_price
