"""Unit tests for individual risk rules."""

from __future__ import annotations

import asyncio
from datetime import time

from domain.account import Balance
from domain.market import MarketQuote
from domain.money import Money, Price, Quantity
from domain.position import Position
from risk import RiskLimits, TradingWindow
from tests.unit.risk.conftest import cash_balance, make_request


def run(coro):
    return asyncio.run(coro)


def _configure(risk_engine, *, account_id="ACC-001", **limits):
    risk_engine.set_policy(account_id, RiskLimits(**limits))


class TestKillSwitch:
    def test_active_rejects(self, risk_engine, aapl, usd):
        risk_engine.set_kill_switch("ACC-001", active=True)
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert d.approved is False
        assert "kill_switch" in d.rejected_rules

    def test_inactive_approves(self, risk_engine, aapl, usd):
        risk_engine.set_kill_switch("ACC-001", active=False)
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert d.approved is True

    def test_global_kill_switch(self, risk_engine, aapl, usd):
        risk_engine.set_kill_switch(active=True)  # global
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert "kill_switch" in d.rejected_rules


class TestOrderSize:
    def test_within_limit_approves(self, risk_engine, aapl, usd):
        _configure(risk_engine, max_order_quantity=Quantity(value="100"))
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))
        assert d.approved is True

    def test_exceeds_limit_rejects(self, risk_engine, aapl, usd):
        _configure(risk_engine, max_order_quantity=Quantity(value="5"))
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))
        assert "order_size_limit" in d.rejected_rules

    def test_not_configured_not_enforced(self, risk_engine, aapl, usd):
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="999999")))
        assert "order_size_limit" not in d.rejected_rules


class TestPositionLimit:
    def test_within_approves(self, risk_engine, aapl, usd):
        _configure(risk_engine, position_limit=Quantity(value="100"))
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))
        assert d.approved is True

    def test_exceeds_rejects(self, risk_engine, portfolio, aapl, usd):
        _configure(risk_engine, position_limit=Quantity(value="20"))
        portfolio.set_position(
            "ACC-001",
            Position(account_id="ACC-001", instrument=aapl, quantity=Quantity(value="15")),
        )
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))  # 15+10=25 > 20
        assert "position_limit" in d.rejected_rules

    def test_short_side_uses_signed_quantity(self, risk_engine, portfolio, aapl, usd):
        _configure(risk_engine, position_limit=Quantity(value="20"))
        portfolio.set_position(
            "ACC-001",
            Position(account_id="ACC-001", instrument=aapl, quantity=Quantity(value="-15")),
        )
        # SELL 10 -> -25, magnitude 25 > 20 -> reject.
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10", side="SELL")))
        assert "position_limit" in d.rejected_rules


class TestNotionalExposure:
    def test_within_approves(self, risk_engine, market, aapl, usd):
        _configure(risk_engine, max_notional_exposure=Money(amount="100000", currency=usd))
        market.set_quote(MarketQuote(instrument=aapl, last=Price(value="100", currency=usd)))
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))  # 1000 notional
        assert d.approved is True

    def test_exceeds_rejects(self, risk_engine, portfolio, market, aapl, usd):
        _configure(risk_engine, max_notional_exposure=Money(amount="1000", currency=usd))
        market.set_quote(MarketQuote(instrument=aapl, last=Price(value="100", currency=usd)))
        portfolio.set_exposure("ACC-001", Money(amount="500", currency=usd))
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))  # 500+1000=1500>1000
        assert "notional_exposure_limit" in d.rejected_rules

    def test_stale_data_fails_closed(self, risk_engine, market, aapl, usd):
        _configure(risk_engine, max_notional_exposure=Money(amount="100000", currency=usd))
        market.set_quote(MarketQuote(instrument=aapl, last=Price(value="100", currency=usd)))
        market.set_stale(aapl, True)
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))
        assert "notional_exposure_limit" in d.rejected_rules


class TestAvailableFunds:
    def test_sufficient_approves(self, risk_engine, account, market, aapl, usd):
        _configure(risk_engine, require_available_funds=True)
        account.set_balance(
            Balance(account_id="ACC-001", cash={"USD": cash_balance(usd, available="50000")})
        )
        market.set_quote(MarketQuote(instrument=aapl, last=Price(value="100", currency=usd)))
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))  # 1000 <= 50000
        assert d.approved is True

    def test_insufficient_rejects(self, risk_engine, account, market, aapl, usd):
        _configure(risk_engine, require_available_funds=True)
        account.set_balance(
            Balance(account_id="ACC-001", cash={"USD": cash_balance(usd, available="100")})
        )
        market.set_quote(MarketQuote(instrument=aapl, last=Price(value="100", currency=usd)))
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))  # 1000 > 100
        assert "available_funds_limit" in d.rejected_rules

    def test_balance_unavailable_fails_closed(self, risk_engine, market, aapl, usd):
        _configure(risk_engine, require_available_funds=True)
        market.set_quote(MarketQuote(instrument=aapl, last=Price(value="100", currency=usd)))
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))
        assert "available_funds_limit" in d.rejected_rules

    def test_not_enforced_without_flag(self, risk_engine, aapl, usd):
        # No balance and flag off -> available-funds rule is not enforced.
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10")))
        assert "available_funds_limit" not in d.rejected_rules

    def test_sell_side_not_cash_gated(self, risk_engine, market, aapl, usd):
        _configure(risk_engine, require_available_funds=True)
        market.set_quote(MarketQuote(instrument=aapl, last=Price(value="100", currency=usd)))
        d = run(risk_engine.evaluate(make_request(aapl, usd, quantity="10", side="SELL")))
        assert "available_funds_limit" not in d.rejected_rules


class TestDailyOrderCount:
    def test_rejects_when_limit_reached(self, risk_engine, bus, aapl, usd):
        from events import OrderSubmitted
        from domain.orders import Order, OrderSide, OrderType
        from domain.money import Quantity as Q

        _configure(risk_engine, max_daily_orders=2)
        order = Order(
            account_id="ACC-001",
            instrument=aapl,
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            quantity=Q(value="10"),
            limit_price=Price(value="100", currency=usd),
        )
        # The engine subscribes to order.submitted in __init__; publishing counts.
        run(bus.publish(OrderSubmitted(order=order)))
        run(bus.publish(OrderSubmitted(order=order)))
        assert risk_engine.order_count_today("ACC-001") == 2
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert "daily_order_count_limit" in d.rejected_rules


class TestDailyLoss:
    def test_exceeds_rejects(self, risk_engine, daily_pnl, aapl, usd):
        # max_daily_loss is a positive magnitude: 1000 -> floor at -1000.
        _configure(risk_engine, max_daily_loss=Money(amount="1000", currency=usd))
        daily_pnl.set_pnl("ACC-001", Money(amount="-2000", currency=usd))
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert "daily_loss_limit" in d.rejected_rules

    def test_zero_pnl_within_limit_approves(self, risk_engine, daily_pnl, aapl, usd):
        # Regression for the sign bug: zero P&L must NOT breach a positive limit.
        _configure(risk_engine, max_daily_loss=Money(amount="1000", currency=usd))
        daily_pnl.set_pnl("ACC-001", Money(amount="0", currency=usd))
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert "daily_loss_limit" not in d.rejected_rules

    def test_negative_limit_fails_closed(self, risk_engine, daily_pnl, aapl, usd):
        _configure(risk_engine, max_daily_loss=Money(amount="-1000", currency=usd))
        d = run(risk_engine.evaluate(make_request(aapl, usd)))
        assert "daily_loss_limit" in d.rejected_rules  # misconfiguration -> reject

    def test_unavailable_fails_closed(self, portfolio, account, market, clock, bus, aapl, usd):
        from risk import RiskEngine
        from tests.unit.risk.conftest import make_request

        # A risk engine WITHOUT a daily P&L provider, with the limit configured.
        engine = RiskEngine(portfolio, account, market, clock=clock, bus=bus)
        engine.set_policy("ACC-001", RiskLimits(max_daily_loss=Money(amount="1000", currency=usd)))
        d = run(engine.evaluate(make_request(aapl, usd)))
        assert "daily_loss_limit" in d.rejected_rules


class TestTradingSession:
    def test_inside_window_approves(self, risk_engine, aapl, usd):
        _configure(risk_engine, trading_window=TradingWindow(start=time(9, 0), end=time(17, 0)))
        d = run(risk_engine.evaluate(make_request(aapl, usd)))  # clock = 12:00 UTC
        assert d.approved is True

    def test_outside_window_rejects(self, risk_engine, aapl, usd):
        _configure(risk_engine, trading_window=TradingWindow(start=time(9, 0), end=time(11, 0)))
        d = run(risk_engine.evaluate(make_request(aapl, usd)))  # 12:00 outside
        assert "trading_session" in d.rejected_rules