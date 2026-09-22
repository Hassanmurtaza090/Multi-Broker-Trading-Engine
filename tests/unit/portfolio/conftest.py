"""Shared fixtures for portfolio tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from domain.account import Balance, CashBalance
from domain.fills import Fill
from domain.instrument import AssetClass, Exchange, Instrument
from domain.market import MarketQuote
from domain.money import Currency, Money, Price, Quantity
from domain.orders import Order, OrderSide, OrderType
from events import InProcessEventBus
from portfolio import PortfolioService


class ControllableClock:
    def __init__(self, start: datetime | None = None) -> None:
        self.now = start or datetime(2025, 1, 2, 12, 0, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, delta: timedelta) -> None:
        self.now = self.now + delta


@pytest.fixture()
def usd() -> Currency:
    return Currency(code="USD")


@pytest.fixture()
def eur() -> Currency:
    return Currency(code="EUR")


@pytest.fixture()
def aapl(usd: Currency) -> Instrument:
    return Instrument(symbol="AAPL", asset_class=AssetClass.EQUITY, currency=usd, exchange=Exchange.NASDAQ)


@pytest.fixture()
def clock() -> ControllableClock:
    return ControllableClock()


@pytest.fixture()
def bus() -> InProcessEventBus:
    return InProcessEventBus()


@pytest.fixture()
def service(bus: InProcessEventBus, clock: ControllableClock) -> PortfolioService:
    return PortfolioService(bus=bus, clock=clock)


def make_order(aapl: Instrument, usd: Currency, *, side: OrderSide = OrderSide.BUY, quantity: str = "10") -> Order:
    return Order(
        account_id="ACC-001",
        instrument=aapl,
        side=side,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value=quantity),
        limit_price=Price(value="100", currency=usd),
    )


def make_fill(
    order: Order,
    usd: Currency,
    *,
    quantity: str = "10",
    price: str = "100",
    fill_id: str | None = None,
    commission: str | None = None,
    fees: str | None = None,
) -> Fill:
    return Fill(
        fill_id=fill_id or f"F-{uuid4()}",
        order_client_id=order.client_order_id,
        account_id=order.account_id,
        instrument=order.instrument,
        side=order.side,
        quantity=Quantity(value=quantity),
        price=Price(value=price, currency=usd),
        commission=Money(amount=commission, currency=usd) if commission else None,
        fees=Money(amount=fees, currency=usd) if fees else None,
    )


def make_quote(aapl: Instrument, usd: Currency, *, price: str, timestamp: datetime) -> MarketQuote:
    return MarketQuote(
        instrument=aapl,
        last=Price(value=price, currency=usd),
        timestamp=timestamp,
    )


def make_balance(usd: Currency, *, account_id: str = "ACC-001", total: str = "10000") -> Balance:
    return Balance(
        account_id=account_id,
        cash={"USD": CashBalance(currency=usd, total=Money(amount=total, currency=usd), available=Money(amount=total, currency=usd))},
    )


__all__ = [
    "ControllableClock", "usd", "aapl", "clock", "bus", "service",
    "make_order", "make_fill", "make_quote", "make_balance",
    "OrderSide", "Money", "Price", "Quantity", "MarketQuote", "Balance",
]