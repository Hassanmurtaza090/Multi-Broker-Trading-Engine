"""Portfolio & P&L (M7).

Authoritative internal portfolio state: positions, realized/unrealized P&L,
balances, exposure, and equity — updated by events and serving the M6 risk
read-model ports.
"""

from __future__ import annotations

from portfolio.accounting import (
    FillOutcome,
    apply_fill,
    gross_exposure,
    market_value,
    unrealized_pnl,
)
from portfolio.service import PortfolioService

__all__ = [
    "PortfolioService",
    "FillOutcome",
    "apply_fill",
    "unrealized_pnl",
    "market_value",
    "gross_exposure",
]
