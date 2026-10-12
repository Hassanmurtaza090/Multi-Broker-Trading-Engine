"""Integration: fills flow Execution->OMS->bus->Portfolio; Portfolio feeds Risk."""

from __future__ import annotations

import asyncio
from decimal import Decimal

from domain.fills import ExecutionReportType
from domain.money import Money, Price, Quantity
from events import BalanceUpdated, MarketQuoteUpdated, PositionOpened, RiskViolation
from execution import ExecutionEngine
from order_management import InMemoryOrderRepository, OrderManager
from risk import RiskEngine, RiskLimits
from tests.unit.execution.conftest import SimulatedExecutionBroker
from tests.unit.portfolio.conftest import make_balance, make_quote
from domain.orders import OrderRequest, OrderSide, OrderType


def run(coro):
    return asyncio.run(coro)


def _limit_request(aapl, usd, quantity="10", side=OrderSide.BUY, price="100") -> OrderRequest:
    return OrderRequest(
        account_id="ACC-001",
        instrument=aapl,
        side=side,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value=quantity),
        limit_price=Price(value=price, currency=usd),
    )


class TestPortfolioIntegration:
    def test_fill_updates_portfolio_and_feeds_risk(self, service, bus, clock, aapl, usd):
        """Execution fill -> portfolio position -> risk sees updated exposure."""
        oms = OrderManager(InMemoryOrderRepository(), bus)
        broker = SimulatedExecutionBroker()
        executor = ExecutionEngine(broker, oms)
        # Risk consumes portfolio state through all four M6 ports.
        risk = RiskEngine(service, service, service, daily_pnl=service, clock=clock, bus=bus)
        risk.set_policy("ACC-001", RiskLimits(position_limit=Quantity(value="15")))

        opened = []
        bus.subscribe("position.opened", lambda env: opened.append(env.payload))

        # Cash balance known (balance event).
        run(bus.publish(BalanceUpdated(balance=make_balance(usd, total="100000"))))
        # Fresh market quote.
        run(bus.publish(MarketQuoteUpdated(quote=make_quote(aapl, usd, price="100", timestamp=clock.now))))

        # Risk-gated submit: approve -> execute -> partial fill 10.
        request = _limit_request(aapl, usd, quantity="10")
        decision = run(risk.evaluate(request))
        assert decision.approved is True
        order = run(oms.create_order(request))
        run(executor.submit(order.client_order_id))
        run(broker.push(run(oms.get_order(order.client_order_id)), ExecutionReportType.FILL, quantity="10"))

        # Portfolio updated via the fill event.
        pos = service.position("ACC-001", aapl)
        assert pos is not None
        assert pos.quantity.value == 10
        assert len(opened) == 1 and isinstance(opened[0], PositionOpened)

        # Risk now sees the position: a second buy of 10 would hit 20 > 15 -> reject.
        d2 = run(risk.evaluate(_limit_request(aapl, usd, quantity="10")))
        assert d2.approved is False
        assert "position_limit" in d2.rejected_rules

    def test_realized_loss_feeds_risk_daily_limit(self, service, bus, clock, aapl, usd):
        """A closing fill realizes a loss; risk's daily-loss limit then rejects."""
        oms = OrderManager(InMemoryOrderRepository(), bus)
        broker = SimulatedExecutionBroker()
        executor = ExecutionEngine(broker, oms)
        risk = RiskEngine(service, service, service, daily_pnl=service, clock=clock, bus=bus)
        risk.set_policy("ACC-001", RiskLimits(max_daily_loss=Money(amount="50", currency=usd)))

        run(bus.publish(BalanceUpdated(balance=make_balance(usd, total="100000"))))
        run(bus.publish(MarketQuoteUpdated(quote=make_quote(aapl, usd, price="100", timestamp=clock.now))))

        # Open long 10 @ 100 (approved: zero realized so far).
        req = _limit_request(aapl, usd, quantity="10")
        assert run(risk.evaluate(req)).approved is True
        order = run(oms.create_order(req))
        run(executor.submit(order.client_order_id))
        run(broker.push(run(oms.get_order(order.client_order_id)), ExecutionReportType.FILL, quantity="10"))

        # Close at 90 -> realized loss (90-100)*10 = -100 <= -50 limit.
        close_req = _limit_request(aapl, usd, quantity="10", side=OrderSide.SELL, price="90")
        assert run(risk.evaluate(close_req)).approved is True
        close_order = run(oms.create_order(close_req))
        run(executor.submit(close_order.client_order_id))
        run(
            broker.push(
                run(oms.get_order(close_order.client_order_id)),
                ExecutionReportType.FILL,
                quantity="10",
                price="90",
            )
        )

        today = service.realized_pnl_today("ACC-001")
        assert today is not None and today.amount == Decimal("-100")

        # Next order is rejected by the daily-loss rule (via the portfolio provider).
        d = run(risk.evaluate(_limit_request(aapl, usd, quantity="5")))
        assert "daily_loss_limit" in d.rejected_rules

    def test_risk_violation_event_published_on_breach(self, service, bus, clock, aapl, usd):
        risk = RiskEngine(service, service, service, daily_pnl=service, clock=clock, bus=bus)
        risk.set_policy("ACC-001", RiskLimits(position_limit=Quantity(value="5")))

        violations = []
        bus.subscribe("risk.violation", lambda env: violations.append(env.payload))

        run(bus.publish(BalanceUpdated(balance=make_balance(usd))))
        run(bus.publish(MarketQuoteUpdated(quote=make_quote(aapl, usd, price="100", timestamp=clock.now))))

        d = run(risk.evaluate(_limit_request(aapl, usd, quantity="10")))
        assert d.approved is False
        assert len(violations) == 1 and isinstance(violations[0], RiskViolation)
