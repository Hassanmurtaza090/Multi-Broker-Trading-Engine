"""Shared fixtures for risk-engine tests (fake views + controllable clock)."""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

import pytest

from domain.account import Balance, CashBalance
from domain.instrument import AssetClass, Exchange, Instrument
from domain.market import MarketQuote
from domain.money import Currency, Money, Price, Quantity
from domain.orders import OrderRequest, OrderSide, OrderType
from domain.position import Position
from events import InProcessEventBus
from risk import RiskEngine, RiskLimits, RiskPolicy
from risk.views import AccountView, DailyPnlProvider, MarketDataView, PortfolioView


class FakePortfolio:
    def __init__(self) -> None:
        self._positions: dict[str, dict[str, Position]] = {}
        self._exposure: dict[str, Money] = {}

    def set_position(self, account_id: str, position: Position) -> None:
        self._positions.setdefault(account_id, {})[position.instrument.primary_identifier] = position

    def set_exposure(self, account_id: str, exposure: Money) -> None:
        self._exposure[account_id] = exposure

    def positions(self, account_id: str):
        return dict(self._positions.get(account_id, {}))

    def exposure(self, account_id: str) -> Money | None:
        return self._exposure.get(account_id)


class FakeAccount:
    def __init__(self) -> None:
        self._balances: dict[str, Balance] = {}

    def set_balance(self, balance: Balance) -> None:
        self._balances[balance.account_id] = balance

    def balance(self, account_id: str) -> Balance | None:
        return self._balances.get(account_id)


class FakeMarket:
    def __init__(self) -> None:
        self._quotes: dict[str, MarketQuote] = {}
        self._stale: set[str] = set()

    def set_quote(self, quote: MarketQuote) -> None:
        self._quotes[quote.instrument.primary_identifier] = quote

    def set_stale(self, instrument: Instrument, stale: bool) -> None:
        if stale:
            self._stale.add(instrument.primary_identifier)
        else:
            self._stale.discard(instrument.primary_identifier)

    def quote(self, instrument: Instrument) -> MarketQuote | None:
        return self._quotes.get(instrument.primary_identifier)

    def is_stale(self, instrument: Instrument) -> bool:
        return instrument.primary_identifier in self._stale


class FakeDailyPnl:
    def __init__(self) -> None:
        self._pnl: dict[str, Money] = {}

    def set_pnl(self, account_id: str, pnl: Money) -> None:
        self._pnl[account_id] = pnl

    def realized_pnl_today(self, account_id: str) -> Money | None:
        return self._pnl.get(account_id)


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
def aapl(usd: Currency) -> Instrument:
    return Instrument(symbol="AAPL", asset_class=AssetClass.EQUITY, currency=usd, exchange=Exchange.NASDAQ)


@pytest.fixture()
def tsla(usd: Currency) -> Instrument:
    return Instrument(symbol="TSLA", asset_class=AssetClass.EQUITY, currency=usd, exchange=Exchange.NASDAQ)


@pytest.fixture()
def portfolio() -> FakePortfolio:
    return FakePortfolio()


@pytest.fixture()
def account() -> FakeAccount:
    return FakeAccount()


@pytest.fixture()
def market() -> FakeMarket:
    return FakeMarket()


@pytest.fixture()
def daily_pnl() -> FakeDailyPnl:
    return FakeDailyPnl()


@pytest.fixture()
def clock() -> ControllableClock:
    return ControllableClock()


@pytest.fixture()
def bus() -> InProcessEventBus:
    return InProcessEventBus()


@pytest.fixture()
def policy() -> RiskPolicy:
    return RiskPolicy()


@pytest.fixture()
def risk_engine(
    portfolio: FakePortfolio,
    account: FakeAccount,
    market: FakeMarket,
    daily_pnl: FakeDailyPnl,
    policy: RiskPolicy,
    clock: ControllableClock,
    bus: InProcessEventBus,
) -> RiskEngine:
    return RiskEngine(
        portfolio, account, market, daily_pnl=daily_pnl, policy=policy, clock=clock, bus=bus
    )


def make_request(
    aapl: Instrument,
    usd: Currency,
    *,
    quantity: str = "10",
    limit_price: str = "100",
    side: OrderSide = OrderSide.BUY,
    account_id: str = "ACC-001",
) -> OrderRequest:
    return OrderRequest(
        account_id=account_id,
        instrument=aapl,
        side=side,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value=quantity),
        limit_price=Price(value=limit_price, currency=usd),
    )


def cash_balance(usd: Currency, *, total: str = "100000", available: str = "50000", buying_power: str | None = None) -> CashBalance:
    return CashBalance(
        currency=usd,
        total=Money(amount=total, currency=usd),
        available=Money(amount=available, currency=usd),
        buying_power=Money(amount=buying_power, currency=usd) if buying_power else None,
    )


__all__ = [
    "FakePortfolio", "FakeAccount", "FakeMarket", "FakeDailyPnl", "ControllableClock",
    "usd", "aapl", "tsla", "portfolio", "account", "market", "daily_pnl",
    "clock", "bus", "policy", "risk_engine",
    "make_request", "cash_balance",
    "Balance", "MarketQuote", "Position", "Price", "Quantity", "Money", "time",
]