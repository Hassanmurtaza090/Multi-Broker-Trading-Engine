"""Risk limits and policy (configuration).

Limits are *configuration*, not hardcoded production values. A `RiskPolicy`
maps an account to its `RiskLimits`. A limit set to `None` means the
corresponding rule is not enforced for that account.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time

from domain.money import Money, Quantity


@dataclass(frozen=True)
class TradingWindow:
    """A daily trading window in UTC.

    If `end <= start`, the window wraps past midnight (e.g. 22:00–02:00).
    """

    start: time
    end: time


@dataclass(frozen=True)
class RiskLimits:
    """Configurable per-account risk limits (None = rule not enforced)."""

    max_order_quantity: Quantity | None = None
    position_limit: Quantity | None = None  # max |net position| per instrument
    max_notional_exposure: Money | None = None
    max_daily_orders: int | None = None
    # Positive magnitude of the allowed daily realized loss (e.g. 50 -> the
    # floor is -50). Rejection when cumulative realized P&L today is below
    # -(max_daily_loss).
    max_daily_loss: Money | None = None
    trading_window: TradingWindow | None = None
    # When True, buy orders are gated on available cash/buying power
    # (fail-closed if the account balance is unavailable).
    require_available_funds: bool = False


class RiskPolicy:
    """Maps account ids to their configured `RiskLimits`."""

    def __init__(self) -> None:
        self._limits: dict[str, RiskLimits] = {}

    def set(self, account_id: str, limits: RiskLimits) -> None:
        self._limits[account_id] = limits

    def limits_for(self, account_id: str) -> RiskLimits:
        return self._limits.get(account_id, RiskLimits())

    def accounts(self) -> tuple[str, ...]:
        return tuple(self._limits)

    def __len__(self) -> int:
        return len(self._limits)
