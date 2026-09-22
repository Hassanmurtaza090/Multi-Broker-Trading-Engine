"""Risk Engine — pre-trade risk evaluation, kill switch, and order-activity state.

Ownership (see `risk/views.py`):
- risk owns: the kill switch, daily order counts (from `OrderSubmitted` events),
  and the policy/decision.
- risk reads (never writes): positions/exposure (M7), balances (account layer),
  quotes/staleness (M3), and realized P&L (M7).

Concurrency: `_evaluate_sync` is fully synchronous (no awaits), so each
evaluation is atomic on the cooperative asyncio event loop; order counts and the
kill switch cannot be interleaved mid-evaluation. `evaluate()` awaits only after
the decision is computed, to publish `RiskViolation` events.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from domain.orders import OrderRequest
from events import EventBus, EventEnvelope, RiskViolation
from risk.models import RiskContext, RiskDecision
from risk.policy import RiskLimits, RiskPolicy
from risk.rules import ALL_RULES
from risk.views import AccountView, DailyPnlProvider, MarketDataView, PortfolioView

logger = logging.getLogger("mtbe.risk")

Clock = Callable[[], datetime]


def _system_clock() -> datetime:
    return datetime.now(UTC)


class RiskEngine:
    """Deterministic pre-trade risk evaluator with kill-switch and state."""

    def __init__(
        self,
        portfolio: PortfolioView,
        account: AccountView,
        market: MarketDataView,
        *,
        policy: RiskPolicy | None = None,
        daily_pnl: DailyPnlProvider | None = None,
        clock: Clock = _system_clock,
        bus: EventBus | None = None,
    ) -> None:
        self._portfolio = portfolio
        self._account = account
        self._market = market
        self._policy = policy or RiskPolicy()
        self._daily_pnl = daily_pnl
        self._clock = clock
        self._bus = bus
        self._rules = [rule() for rule in ALL_RULES]
        # Kill switch: global flag + per-account set.
        self._global_kill = False
        self._kill_switches: set[str] = set()
        # Daily order counts: account -> (UTC date, count).
        self._order_counts: dict[str, tuple[str, int]] = {}
        self._seen_event_ids: set[str] = set()
        if bus is not None:
            bus.subscribe("order.submitted", self._on_order_submitted)

    # -- policy ----------------------------------------------------------------
    def set_policy(self, account_id: str, limits: RiskLimits) -> None:
        self._policy.set(account_id, limits)

    def limits_for(self, account_id: str) -> RiskLimits:
        return self._policy.limits_for(account_id)

    # -- kill switch -----------------------------------------------------------
    def set_kill_switch(self, account_id: str | None = None, active: bool = True) -> None:
        """Activate/deactivate the kill switch.

        `account_id=None` sets a global halt for all accounts.
        """
        if account_id is None:
            self._global_kill = active
        else:
            if active:
                self._kill_switches.add(account_id)
            else:
                self._kill_switches.discard(account_id)

    def is_kill_switch_active(self, account_id: str) -> bool:
        return self._global_kill or account_id in self._kill_switches

    # -- order activity (risk-owned) ------------------------------------------
    async def _on_order_submitted(self, envelope: EventEnvelope[Any]) -> None:
        eid = str(envelope.event_id)
        if eid in self._seen_event_ids:
            return  # duplicate event
        self._seen_event_ids.add(eid)
        account_id = envelope.payload.order.account_id
        today = self._clock().date().isoformat()
        seen_date, count = self._order_counts.get(account_id, (None, 0))
        if seen_date != today:
            count = 0
        self._order_counts[account_id] = (today, count + 1)

    def order_count_today(self, account_id: str) -> int:
        today = self._clock().date().isoformat()
        seen_date, count = self._order_counts.get(account_id, (None, 0))
        return count if seen_date == today else 0

    # -- evaluation ------------------------------------------------------------
    async def evaluate(self, order: OrderRequest) -> RiskDecision:
        """Evaluate an order against all configured rules (deterministic).

        If rejected, publishes a `RiskViolation` event per failed rule. The
        decision itself is computed synchronously and is deterministic.
        """
        decision = self._evaluate_sync(order)
        if not decision.approved and self._bus is not None:
            for v in decision.violations:
                await self._bus.publish(
                    RiskViolation(
                        account_id=order.account_id,
                        instrument=order.instrument,
                        rule=v.rule,
                        message=v.reason or "",
                        order=None,
                    ),
                    source="risk",
                )
        return decision

    def _evaluate_sync(self, order: OrderRequest) -> RiskDecision:
        ctx = self._build_context(order)
        limits = self._policy.limits_for(order.account_id)
        results = tuple(rule.evaluate(ctx, order, limits) for rule in self._rules)
        return RiskDecision(approved=all(r.approved for r in results), results=results)

    def _build_context(self, order: OrderRequest) -> RiskContext:
        account_id = order.account_id
        balance = self._account.balance(account_id)
        positions = self._portfolio.positions(account_id)
        exposure = self._portfolio.exposure(account_id)
        quote = self._market.quote(order.instrument)
        stale = self._market.is_stale(order.instrument)
        daily_pnl = (
            self._daily_pnl.realized_pnl_today(account_id) if self._daily_pnl is not None else None
        )
        return RiskContext(
            account_id=account_id,
            balance=balance,
            positions=positions,
            current_exposure=exposure,
            quote=quote,
            quote_stale=stale,
            order_count_today=self.order_count_today(account_id),
            now=self._clock(),
            daily_pnl=daily_pnl,
            kill_switch_active=self.is_kill_switch_active(account_id),
        )
