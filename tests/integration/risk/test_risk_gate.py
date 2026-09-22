"""Integration: risk gate ensures no order bypasses risk; reactivity to state."""

from __future__ import annotations

import asyncio

from domain.market import MarketQuote
from domain.money import Money, Price, Quantity
from domain.orders import OrderStatus
from domain.position import Position
from events import RiskViolation
from execution import ExecutionEngine
from order_management import InMemoryOrderRepository, OrderManager
from risk import RiskGatedExecutor, RiskLimits
from tests.unit.risk.conftest import make_request
from tests.unit.execution.conftest import SimulatedExecutionBroker


def run(coro):
    return asyncio.run(coro)


def _gate(risk_engine, oms, broker):
    executor = ExecutionEngine(broker, oms)
    return RiskGatedExecutor(risk_engine, oms, executor), executor


class TestRiskGate:
    def test_approved_order_reaches_broker(self, risk_engine, bus, aapl, usd):
        broker = SimulatedExecutionBroker()
        oms = OrderManager(InMemoryOrderRepository(), bus)
        gate, _ = _gate(risk_engine, oms, broker)

        result = run(gate.submit(make_request(aapl, usd)))
        assert result.approved is True
        assert result.order is not None
        assert result.order.status == OrderStatus.SUBMITTED
        assert broker.submit_calls == 1

    def test_rejected_order_never_reaches_broker(self, risk_engine, bus, aapl, usd):
        risk_engine.set_policy("ACC-001", RiskLimits(max_order_quantity=Quantity(value="5")))
        violations = []
        bus.subscribe("risk.violation", lambda env: violations.append(env.payload))
        broker = SimulatedExecutionBroker()
        oms = OrderManager(InMemoryOrderRepository(), bus)
        gate, _ = _gate(risk_engine, oms, broker)

        result = run(gate.submit(make_request(aapl, usd, quantity="10")))
        assert result.approved is False
        assert result.order is None
        assert broker.submit_calls == 0  # no bypass
        assert len(violations) == 1
        assert isinstance(violations[0], RiskViolation)

    def test_kill_switch_blocks_submission(self, risk_engine, bus, aapl, usd):
        risk_engine.set_kill_switch("ACC-001", active=True)
        broker = SimulatedExecutionBroker()
        oms = OrderManager(InMemoryOrderRepository(), bus)
        gate, _ = _gate(risk_engine, oms, broker)

        result = run(gate.submit(make_request(aapl, usd)))
        assert result.approved is False
        assert broker.submit_calls == 0


class TestReactivity:
    def test_position_update_affects_next_evaluation(self, risk_engine, portfolio, aapl, usd):
        """Risk reads authoritative portfolio state, which updates reactively."""
        risk_engine.set_policy("ACC-001", RiskLimits(position_limit=Quantity(value="20")))
        # Initially no position -> approved.
        assert run(risk_engine.evaluate(make_request(aapl, usd, quantity="10"))).approved is True
        # Portfolio (M7) updates position after a fill -> next order sees it.
        portfolio.set_position(
            "ACC-001",
            Position(account_id="ACC-001", instrument=aapl, quantity=Quantity(value="15")),
        )
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))  # 25 > 20
        assert "position_limit" in d.rejected_rules

    def test_quote_reacts_to_market_update(self, risk_engine, market, portfolio, aapl, usd):
        risk_engine.set_policy(
            "ACC-001", RiskLimits(max_notional_exposure=Money(amount="1000", currency=usd))
        )
        market.set_quote(MarketQuote(instrument=aapl, last=Price(value="100", currency=usd)))
        portfolio.set_exposure("ACC-001", Money(amount="900", currency=usd))
        # 900 + 1000 > 1000 -> reject.
        assert "notional_exposure_limit" in run(
            risk_engine.evaluate(make_request(aapl, usd, quantity="10"))
        ).rejected_rules