"""Risk evaluation models: context, per-rule result, and the decision."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from domain.account import Balance
from domain.market import MarketQuote
from domain.money import Money
from domain.position import Position


@dataclass(frozen=True)
class RiskContext:
    """Snapshot of risk-relevant state used to evaluate one order.

    Built fresh at evaluation time from the read-model ports, so it always
    reflects the latest authoritative state (which is itself updated by events
    upstream). Fields may be `None` when the owning component has no data;
    price-dependent rules then fail closed (see `RiskRule` docs).
    """

    account_id: str
    balance: Balance | None
    positions: Mapping[str, Position]
    current_exposure: Money | None
    quote: MarketQuote | None
    quote_stale: bool
    order_count_today: int
    now: datetime
    daily_pnl: Money | None
    kill_switch_active: bool


@dataclass(frozen=True)
class RuleResult:
    """Outcome of one rule for one order."""

    rule: str
    approved: bool
    reason: str | None = None
    data_unavailable: bool = False


@dataclass(frozen=True)
class RiskDecision:
    """Deterministic, explainable result of running all configured rules."""

    approved: bool
    results: tuple[RuleResult, ...] = ()

    @property
    def violations(self) -> tuple[RuleResult, ...]:
        return tuple(r for r in self.results if not r.approved)

    @property
    def rejected_rules(self) -> tuple[str, ...]:
        return tuple(r.rule for r in self.violations)

    def summary(self) -> str:
        if self.approved:
            return "APPROVED"
        return "REJECTED: " + ", ".join(f"{r.rule}({r.reason})" for r in self.violations)
