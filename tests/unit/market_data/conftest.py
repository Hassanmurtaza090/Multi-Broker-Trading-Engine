"""Shared fixtures for market-data engine tests (including a simulated feed)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from domain.instrument import AssetClass, Exchange, Instrument
from domain.market import BarInterval, QuoteType
from domain.money import Currency, Price, Quantity
from brokers.base import FeedHandler, FeedSubscription, MarketDataFeed


class _FeedSubscription:
    def __init__(self, instrument: Instrument) -> None:
        self.instrument = instrument
        self.cancelled = False

    async def cancel(self) -> None:
        self.cancelled = True


class SimulatedFeed:
    """In-memory `MarketDataFeed` implementation used by tests."""

    def __init__(self) -> None:
        self.handler: FeedHandler | None = None
        self.started = False
        self.stopped = False
        self.subscribed: list[str] = []
        self._subs: dict[str, _FeedSubscription] = {}

    async def start(self) -> None:
        self.started = True
        self.stopped = False

    async def stop(self) -> None:
        self.stopped = True
        self.started = False

    def attach_handler(self, handler: FeedHandler) -> None:
        self.handler = handler

    async def subscribe(self, instrument: Instrument) -> FeedSubscription:
        self.subscribed.append(instrument.primary_identifier)
        sub = _FeedSubscription(instrument)
        self._subs[instrument.primary_identifier] = sub
        return sub

    async def unsubscribe(self, subscription: FeedSubscription) -> None:
        key = subscription.instrument.primary_identifier
        self.subscribed = [k for k in self.subscribed if k != key]
        self._subs.pop(key, None)

    async def push(self, event) -> None:
        if self.handler is not None:
            await self.handler(event)


@pytest.fixture()
def usd() -> Currency:
    return Currency(code="USD")


@pytest.fixture()
def aapl(usd: Currency) -> Instrument:
    return Instrument(
        symbol="AAPL",
        asset_class=AssetClass.EQUITY,
        currency=usd,
        exchange=Exchange.NASDAQ,
    )


@pytest.fixture()
def tsla(usd: Currency) -> Instrument:
    return Instrument(
        symbol="TSLA",
        asset_class=AssetClass.EQUITY,
        currency=usd,
        exchange=Exchange.NASDAQ,
    )


@pytest.fixture()
def sim_feed() -> SimulatedFeed:
    return SimulatedFeed()


@pytest.fixture()
def tick_at() -> datetime:
    return datetime(2025, 1, 2, 12, 0, 0, tzinfo=UTC)


@pytest.fixture()
def p100(usd: Currency) -> Price:
    return Price(value="100", currency=usd)


@pytest.fixture()
def p99(usd: Currency) -> Price:
    return Price(value="99", currency=usd)


@pytest.fixture()
def p101(usd: Currency) -> Price:
    return Price(value="101", currency=usd)


@pytest.fixture()
def qty10() -> Quantity:
    return Quantity(value="10")


__all__ = [
    "SimulatedFeed",
    "usd", "aapl", "tsla", "sim_feed", "tick_at",
    "p100", "p99", "p101", "qty10",
    "BarInterval", "QuoteType",
]