"""Unit tests for PortfolioService (event-driven state, valuation, views)."""

from __future__ import annotations

import asyncio
import datetime as dt
from decimal import Decimal

from domain.orders import OrderSide
from events import (
    BalanceUpdated,
    MarketQuoteUpdated,
    OrderFilled,
    OrderPartiallyFilled,
    PositionClosed,
    PositionOpened,
    PositionUpdated,
)
from tests.unit.portfolio.conftest import make_balance, make_fill, make_order, make_quote


def run(coro):
    return asyncio.run(coro)


def publish_fill(bus, order, usd, *, quantity, price, fill_id=None, partial=True):
    fill = make_fill(order, usd, quantity=quantity, price=price, fill_id=fill_id)
    event = OrderPartiallyFilled(order=order, fill=fill) if partial else OrderFilled(order=order, fill=fill)
    run(bus.publish(event))
    return fill


class TestPositionLifecycleViaEvents:
    def test_open_increases_position(self, service, bus, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        publish_fill(bus, order, usd, quantity="10", price="100")
        publish_fill(bus, order, usd, quantity="10", price="110")
        pos = service.position("ACC-001", aapl)
        assert pos is not None
        assert pos.quantity.value == 20
        assert pos.average_price.value == 105

    def test_reduce_close_and_realized_accumulation(self, service, bus, aapl, usd):
        buy = make_order(aapl, usd, side=OrderSide.BUY)
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        publish_fill(bus, buy, usd, quantity="10", price="100")
        publish_fill(bus, sell, usd, quantity="5", price="120")   # (120-100)*5 = +100
        publish_fill(bus, sell, usd, quantity="5", price="110")   # (110-100)*5 = +50, flat
        assert service.position("ACC-001", aapl) is None
        total = service.realized_pnl("ACC-001", "USD")
        assert total.amount == Decimal("150")

    def test_position_lifecycle_events_published(self, service, bus, aapl, usd):
        opened, updated, closed = [], [], []
        bus.subscribe("position.opened", lambda env: opened.append(env.payload))
        bus.subscribe("position.updated", lambda env: updated.append(env.payload))
        bus.subscribe("position.closed", lambda env: closed.append(env.payload))

        buy = make_order(aapl, usd, side=OrderSide.BUY)
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        publish_fill(bus, buy, usd, quantity="10", price="100")     # opened: 10 @ 100
        publish_fill(bus, buy, usd, quantity="10", price="110")     # updated: 20 @ 105
        publish_fill(bus, sell, usd, quantity="25", price="120")     # updated: reversal -> short 5 @ 120

        assert len(opened) == 1 and isinstance(opened[0], PositionOpened)
        assert len(updated) == 2 and all(isinstance(u, PositionUpdated) for u in updated)
        assert len(closed) == 0
        # Reversal: closed 20 long @ avg 105 -> realized (120-105)*20 = 300.
        assert updated[-1].position.quantity.value == -5
        assert updated[-1].position.average_price.value == 120
        assert service.realized_pnl("ACC-001", "USD").amount == Decimal("300")

    def test_close_publishes_position_closed(self, service, bus, aapl, usd):
        closed = []
        bus.subscribe("position.closed", lambda env: closed.append(env.payload))
        buy = make_order(aapl, usd, side=OrderSide.BUY)
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        publish_fill(bus, buy, usd, quantity="10", price="100")
        publish_fill(bus, sell, usd, quantity="10", price="105")
        assert len(closed) == 1 and isinstance(closed[0], PositionClosed)
        assert closed[0].position.is_flat

    def test_multiple_fills_same_order_accumulate(self, service, bus, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        publish_fill(bus, order, usd, quantity="4", price="100")
        publish_fill(bus, order, usd, quantity="6", price="100")
        pos = service.position("ACC-001", aapl)
        assert pos is not None
        assert pos.quantity.value == 10


class TestDuplicateEvents:
    def test_duplicate_fill_not_double_applied(self, service, bus, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        envelope = OrderPartiallyFilled(
            order=order, fill=make_fill(order, usd, quantity="10", price="100", fill_id="F-DUP")
        )
        run(bus.publish(envelope))
        run(bus.publish(envelope))  # same envelope (same event_id AND same fill_id)
        pos = service.position("ACC-001", aapl)
        assert pos is not None
        assert pos.quantity.value == 10  # not 20

    def test_same_fill_id_in_new_envelope_ignored(self, service, bus, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        fill = make_fill(order, usd, quantity="10", price="100", fill_id="F-SAME")
        run(bus.publish(OrderPartiallyFilled(order=order, fill=fill)))
        # New envelope (new event_id) but the SAME fill_id -> deduped.
        run(bus.publish(OrderPartiallyFilled(order=order, fill=fill)))
        assert service.position("ACC-001", aapl).quantity.value == 10


class TestMarketDataValuation:
    def test_quote_updates_unrealized_pnl(self, service, bus, clock, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        publish_fill(bus, order, usd, quantity="10", price="100")
        run(bus.publish(MarketQuoteUpdated(quote=make_quote(aapl, usd, price="110", timestamp=clock.now))))
        pnl = service.unrealized_pnl("ACC-001", aapl)
        assert pnl is not None
        assert pnl.amount == Decimal("100")

    def test_stale_quote_not_used_for_unrealized(self, service, bus, clock, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        publish_fill(bus, order, usd, quantity="10", price="100")
        run(bus.publish(MarketQuoteUpdated(quote=make_quote(aapl, usd, price="110", timestamp=clock.now))))
        clock.advance(dt.timedelta(seconds=30))  # beyond max age
        assert service.unrealized_pnl("ACC-001", aapl) is None  # never silently zero
        assert service.is_stale(aapl) is True

    def test_missing_price_unrealized_none(self, service, bus, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        publish_fill(bus, order, usd, quantity="10", price="100")
        assert service.unrealized_pnl("ACC-001", aapl) is None

    def test_exposure_uses_fresh_market_price(self, service, bus, clock, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        publish_fill(bus, order, usd, quantity="10", price="100")
        run(bus.publish(MarketQuoteUpdated(quote=make_quote(aapl, usd, price="110", timestamp=clock.now))))
        exposure = service.exposure("ACC-001")
        assert exposure is not None
        assert exposure.amount == Decimal("1100")

    def test_exposure_falls_back_to_entry_price_when_stale(self, service, bus, clock, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        publish_fill(bus, order, usd, quantity="10", price="100")
        run(bus.publish(MarketQuoteUpdated(quote=make_quote(aapl, usd, price="110", timestamp=clock.now))))
        clock.advance(dt.timedelta(seconds=30))
        exposure = service.exposure("ACC-001")
        assert exposure is not None
        assert exposure.amount == Decimal("1000")  # entry-price fallback, documented


class TestBalancesAndEquity:
    def test_balance_event_updates_balance(self, service, bus, usd):
        balance = make_balance(usd, total="10000")
        run(bus.publish(BalanceUpdated(balance=balance)))
        assert service.balance("ACC-001") == balance

    def test_equity_cash_plus_market_value(self, service, bus, clock, aapl, usd):
        run(bus.publish(BalanceUpdated(balance=make_balance(usd, total="10000"))))
        order = make_order(aapl, usd, side=OrderSide.BUY)
        publish_fill(bus, order, usd, quantity="10", price="100")
        run(bus.publish(MarketQuoteUpdated(quote=make_quote(aapl, usd, price="110", timestamp=clock.now))))
        equity = service.equity("ACC-001")
        assert equity is not None
        assert equity.amount == Decimal("11100")  # 10000 cash + 10*110 market value

    def test_equity_none_without_balance(self, service, bus, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        publish_fill(bus, order, usd, quantity="10", price="100")
        # Market value alone exists; equity requires cash. Single-currency market value.
        by_ccy = service.equity_by_currency("ACC-001")
        assert by_ccy["USD"].amount == Decimal("1000")
        assert service.equity("ACC-001") is None  # no cash balance known at all


class TestRealizedToday:
    def test_realized_pnl_today_single_currency(self, service, bus, aapl, usd):
        buy = make_order(aapl, usd, side=OrderSide.BUY)
        sell = make_order(aapl, usd, side=OrderSide.SELL)
        publish_fill(bus, buy, usd, quantity="10", price="100")
        publish_fill(bus, sell, usd, quantity="10", price="110")
        today = service.realized_pnl_today("ACC-001")
        assert today is not None
        assert today.amount == Decimal("100")

    def test_realized_pnl_today_zero_with_known_currency(self, service, bus, usd):
        run(bus.publish(BalanceUpdated(balance=make_balance(usd))))
        today = service.realized_pnl_today("ACC-001")
        assert today is not None
        assert today.amount == Decimal("0")

    def test_realized_pnl_today_none_when_unknown(self, service):
        assert service.realized_pnl_today("ACC-001") is None


class TestReconciliation:
    def test_broker_snapshot_replaces_positions(self, service, bus, aapl, usd, clock):
        from domain.position import Position
        from domain.money import Quantity

        # Internal state: long 10 AAPL.
        order = make_order(aapl, usd, side=OrderSide.BUY)
        publish_fill(bus, order, usd, quantity="10", price="100")
        # Broker says: actually flat, but long 5 (reconciled).
        snapshot_pos = Position(account_id="ACC-001", instrument=aapl, quantity=Quantity(value="5"))
        service.apply_broker_snapshot("ACC-001", [snapshot_pos], make_balance(usd, total="9000"))
        pos = service.position("ACC-001", aapl)
        assert pos is not None
        assert pos.quantity.value == 5
        assert service.balance("ACC-001").cash["USD"].total.amount == Decimal("9000")

    def test_snapshot_rejects_foreign_account_positions(self, service, aapl, usd):
        from domain.position import Position
        from domain.money import Quantity

        bad = Position(account_id="OTHER", instrument=aapl, quantity=Quantity(value="5"))
        import pytest
        with pytest.raises(ValueError):
            service.apply_broker_snapshot("ACC-001", [bad])


class TestConcurrency:
    def test_concurrent_fills_both_applied(self, service, bus, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)
        f1 = make_fill(order, usd, quantity="4", price="100")
        f2 = make_fill(order, usd, quantity="6", price="100")

        async def publish_all():
            await asyncio.gather(
                bus.publish(OrderPartiallyFilled(order=order, fill=f1)),
                bus.publish(OrderPartiallyFilled(order=order, fill=f2)),
            )

        run(publish_all())
        pos = service.position("ACC-001", aapl)
        assert pos is not None
        assert pos.quantity.value == 10  # both applied exactly once

    def test_concurrent_quote_and_fill_consistent(self, service, bus, clock, aapl, usd):
        order = make_order(aapl, usd, side=OrderSide.BUY)

        async def mixed():
            await asyncio.gather(
                bus.publish(OrderFilled(order=order, fill=make_fill(order, usd, quantity="10", price="100"))),
                bus.publish(MarketQuoteUpdated(quote=make_quote(aapl, usd, price="105", timestamp=clock.now))),
            )

        run(mixed())
        pos = service.position("ACC-001", aapl)
        assert pos is not None and pos.quantity.value == 10
        pnl = service.unrealized_pnl("ACC-001", aapl)
        # Either outcome is internally consistent (fill then price, or price then fill):
        assert pnl is not None
        assert pnl.amount == Decimal("50")
