"""Engine-level tests: determinism, fail-safe, duplicates, concurrency."""

from __future__ import annotations

import asyncio

from domain.orders import Order, OrderSide, OrderType
from domain.money import Money, Price, Quantity
from events import EventEnvelope, OrderSubmitted, RiskViolation
from risk import RiskLimits
from tests.unit.risk.conftest import make_request


def run(coro):
    return asyncio.run(coro)


def _order(aapl, usd):
    return Order(
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value="10"),
        limit_price=Price(value="100", currency=usd),
    )


class TestDecisionDeterminism:
    def test_decision_is_deterministic(self, risk_engine, aapl, usd):
        d1 = run(risk_engine.evaluate(make_request(aapl, usd)))
        d2 = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert d1.approved == d2.approved
        assert d1.rejected_rules == d2.rejected_rules

    def test_summary_explainable(self, risk_engine, aapl, usd):
        risk_engine.set_policy("ACC-001", RiskLimits(max_order_quantity=Quantity(value="5")))
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))
        assert d.approved is False
        assert "order_size_limit" in d.summary()


class TestFailSafe:
    def test_notional_rule_fails_closed_on_no_quote(self, risk_engine, aapl, usd):
        risk_engine.set_policy(
            "ACC-001", RiskLimits(max_notional_exposure=Money(amount="100000", currency=usd))
        )
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        violation = next(r for r in d.violations if r.rule == "notional_exposure_limit")
        assert violation.data_unavailable is True
        assert d.approved is False  # fail-closed

    def test_no_limits_approves(self, risk_engine, aapl, usd):
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert d.approved is True  # no limits configured -> nothing enforced

    def test_kill_switch_blocks_even_when_no_limits(self, risk_engine, aapl, usd):
        risk_engine.set_kill_switch("ACC-001", active=True)
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert "kill_switch" in d.rejected_rules


class TestDuplicateEvents:
    def test_duplicate_order_submitted_not_double_counted(self, risk_engine, bus, aapl, usd):
        risk_engine.set_policy("ACC-001", RiskLimits(max_daily_orders=1))
        order = _order(aapl, usd)
        envelope = EventEnvelope.wrap(OrderSubmitted(order=order))
        # Publish the exact same envelope twice (same event_id) -> deduped.
        run(bus.publish(envelope))
        run(bus.publish(envelope))
        assert risk_engine.order_count_today("ACC-001") == 1  # deduped
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert "daily_order_count_limit" in d.rejected_rules


class TestConcurrency:
    def test_concurrent_evals_serialize_order_counts(self, risk_engine, bus, aapl, usd):
        """Multiple concurrent risk evaluations never race on the shared limit."""
        risk_engine.set_policy("ACC-001", RiskLimits(max_daily_orders=2))
        order = _order(aapl, usd)

        # Pre-populate the count with two submissions, then the next order is blocked.
        run(bus.publish(OrderSubmitted(order=order)))
        run(bus.publish(OrderSubmitted(order=order)))

        async def evals():
            return await asyncio.gather(
                risk_engine.evaluate(make_request(aapl, usd)),
                risk_engine.evaluate(make_request(aapl, usd)),
            )

        results = run(evals())
        # Both see count==2 (>= limit) -> both rejected, no inconsistent approval.
        assert all(not r.approved for r in results)
        assert risk_engine.order_count_today("ACC-001") == 2

    def test_concurrent_submit_events_count_once(self, risk_engine, bus, aapl, usd):
        order = _order(aapl, usd)

        async def publish_many():
            await asyncio.gather(
                bus.publish(OrderSubmitted(order=order)),
                bus.publish(OrderSubmitted(order=order)),
                bus.publish(OrderSubmitted(order=order)),
            )

        run(publish_many())
        # Each has a distinct event_id, so all three count.
        assert risk_engine.order_count_today("ACC-001") == 3


class TestRiskViolationEvent:
    def test_rejection_publishes_violation(self, risk_engine, bus, aapl, usd):
        risk_engine.set_policy("ACC-001", RiskLimits(max_order_quantity=Quantity(value="5")))
        seen = []
        bus.subscribe("risk.violation", lambda env: seen.append(env.payload))
        run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))
        assert len(seen) == 1
        assert isinstance(seen[0], RiskViolation)
        assert seen[0].rule == "order_size_limit"
        assert seen[0].account_id == "ACC-001"

    def test_approval_publishes_no_violation(self, risk_engine, bus, aapl, usd):
        seen = []
        bus.subscribe("risk.violation", lambda env: seen.append(env.payload))
        run(risk_engine.evaluate(make_request(aapl, usd)))
        assert seen == []