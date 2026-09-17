"""Shared fixtures for domain model tests (conftest for tests/unit/domain)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from domain.instrument import AssetClass, Exchange, Instrument
from domain.money import Currency, Price, Quantity


@pytest.fixture()
def usd() -> Currency:
    return Currency(code="USD")


@pytest.fixture()
def eur() -> Currency:
    return Currency(code="EUR")


@pytest.fixture()
def aapl(usd: Currency) -> Instrument:
    return Instrument(
        symbol="AAPL",
        asset_class=AssetClass.EQUITY,
        currency=usd,
        exchange=Exchange.NASDAQ,
    )


@pytest.fixture()
def eurusd(eur: Currency) -> Instrument:
    return Instrument(
        symbol="EUR/USD",
        asset_class=AssetClass.FOREX,
        currency=eur,
        exchange=Exchange.OTC,
    )


@pytest.fixture()
def price_100(usd: Currency) -> Price:
    return Price(value=Decimal("100.00"), currency=usd)


@pytest.fixture()
def price_150(usd: Currency) -> Price:
    return Price(value=Decimal("150.00"), currency=usd)


@pytest.fixture()
def qty_10() -> Quantity:
    return Quantity(value=Decimal("10"))


@pytest.fixture()
def account_id() -> str:
    return "ACC-001"
