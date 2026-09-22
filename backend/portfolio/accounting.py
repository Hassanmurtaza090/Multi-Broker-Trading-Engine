"""Position accounting: pure functions for fill application and P&L.

Semantics (average-cost method, documented in `docs/DECISIONS.md` ADR-013):

- **Open / increase:** the position's average entry price is the volume-weighted
  average (delegated to the M1 `Position.apply_fill` VWAP logic).
- **Reduce / close / reverse:** the closing portion realizes
  `(exit - avg) * closed` for longs and `(avg - exit) * closed` for shorts.
  Reducing within the same direction keeps the average; a reversal resets the
  average to the fill price for the new side (M1 semantics).
- **Fees:** a fill's optional `commission`/`fees` are recognized immediately as
  a reduction of realized P&L (expense recognition; no cost-basis
  amortization). Currency must match the fill price currency — no invented FX
  conversion.
- **Cumulative realized P&L per position** is stored on `Position.realized_pnl`
  (a domain reporting field).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from domain.fills import Fill
from domain.money import Money, Price
from domain.position import Position


@dataclass(frozen=True)
class FillOutcome:
    """Result of applying one fill to a position."""

    position: Position
    realized_pnl: Money | None  # None when the fill neither closes nor incurs fees


def _fees_total(fill: Fill) -> Money | None:
    parts = [f for f in (fill.commission, fill.fees) if f is not None]
    if not parts:
        return None
    total = parts[0]
    for part in parts[1:]:
        if part.currency != total.currency:
            raise ValueError("commission and fees must share a currency")
        total = total + part
    if total.currency != fill.price.currency:
        raise ValueError("fee currency must match the fill price currency")
    return total


def apply_fill(position: Position | None, fill: Fill) -> FillOutcome:
    """Apply a fill to a position, computing realized P&L.

    `position` may be `None` (opening). Returns the new immutable position and
    the realized P&L attributable to this fill (closing portion minus fees).
    """
    signed = fill.signed_quantity

    if position is not None and position.average_price is not None:
        if position.average_price.currency != fill.price.currency:
            raise ValueError("fill price currency does not match the position currency")

    fees = _fees_total(fill)

    realized_amount = Decimal(0)
    has_impact = False
    if (
        position is not None
        and not position.is_flat
        and position.average_price is not None
        and position.quantity.value * signed.value < 0
    ):
        # Opposite-direction fill closes (part of) the position.
        closing = min(abs(position.quantity.value), abs(signed.value))
        avg = position.average_price.value
        exit_price = fill.price.value
        if position.quantity.value > 0:  # long closed by a sell
            realized_amount += (exit_price - avg) * closing
        else:  # short closed by a buy
            realized_amount += (avg - exit_price) * closing
        has_impact = True
    if fees is not None:
        realized_amount -= fees.amount
        has_impact = True

    realized = Money(amount=realized_amount, currency=fill.price.currency) if has_impact else None

    if position is None:
        new_position = Position(
            account_id=fill.account_id,
            instrument=fill.instrument,
            quantity=signed,
            average_price=fill.price,
        )
    else:
        new_position = position.apply_fill(signed, fill.price)

    # Store cumulative realized P&L on the position (domain reporting field).
    if realized is not None:
        previous = position.realized_pnl if position is not None else None
        if previous is not None:
            if previous.currency != realized.currency:
                raise ValueError("realized P&L currency mismatch on position")
            cumulative = previous + realized
        else:
            cumulative = realized
        new_position = new_position.model_copy(update={"realized_pnl": cumulative})

    return FillOutcome(position=new_position, realized_pnl=realized)


def unrealized_pnl(position: Position, market_price: Price | None) -> Money | None:
    """Unrealized P&L of an open position at `market_price`.

    Returns `None` for flat positions or when the average entry price is
    unknown (never silently zero).
    """
    if position.is_flat or position.average_price is None:
        return None
    if market_price is None:
        return None
    if market_price.currency != position.average_price.currency:
        raise ValueError("market price currency does not match the position currency")
    qty = position.quantity.value
    avg = position.average_price.value
    px = market_price.value
    amount = (px - avg) * qty if qty > 0 else (avg - px) * (-qty)
    return Money(amount=amount, currency=market_price.currency)


def market_value(position: Position, market_price: Price | None) -> Money | None:
    """Signed market value of a position: `quantity * price` (long positive)."""
    if market_price is None:
        return None
    return Money(
        amount=position.quantity.value * market_price.value,
        currency=market_price.currency,
    )


def gross_exposure(position: Position, valuation_price: Price | None) -> Money | None:
    """Gross notional exposure: `|quantity| * price`."""
    if valuation_price is None:
        return None
    return Money(
        amount=abs(position.quantity.value) * valuation_price.value,
        currency=valuation_price.currency,
    )
