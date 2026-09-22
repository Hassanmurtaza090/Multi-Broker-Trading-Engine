"""Risk-gated execution: the mandatory checkpoint between intent and execution.

This is the enforcement point that makes "no order bypasses risk" concrete: an
order is submitted to the execution engine only if the risk engine approves it.
The OMS and Execution Engine themselves remain risk-agnostic (per M4/M5); the
application/orchestration layer (and tests) use this gate.
"""

from __future__ import annotations

from dataclasses import dataclass

from domain.orders import Order, OrderRequest
from execution import ExecutionEngine
from order_management import OrderManager
from risk.engine import RiskEngine
from risk.models import RiskDecision


@dataclass(frozen=True)
class RiskGateResult:
    """Outcome of a risk-gated submission."""

    approved: bool
    decision: RiskDecision
    order: Order | None = None


class RiskGatedExecutor:
    """Wraps an `ExecutionEngine` behind a mandatory risk gate."""

    def __init__(self, risk: RiskEngine, oms: OrderManager, executor: ExecutionEngine) -> None:
        self._risk = risk
        self._oms = oms
        self._executor = executor

    async def submit(self, request: OrderRequest) -> RiskGateResult:
        """Evaluate risk; if approved, create + execute the order.

        A rejected order is never passed to the execution engine (no bypass).
        """
        decision = await self._risk.evaluate(request)
        if not decision.approved:
            return RiskGateResult(approved=False, decision=decision, order=None)
        order = self._oms.create_order(request)
        await self._executor.submit(order.client_order_id)
        return RiskGateResult(
            approved=True,
            decision=decision,
            order=self._oms.get_order(order.client_order_id),
        )
