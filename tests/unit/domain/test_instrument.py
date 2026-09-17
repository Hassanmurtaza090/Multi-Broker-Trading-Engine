"""Unit tests for Instrument."""

from __future__ import annotations

import pytest

from domain.instrument import AssetClass, Exchange, Instrument
from domain.money import Currency


def test_symbol_normalized_upper() -> None:
    inst = Instrument(symbol="  aapl ", asset_class=AssetClass.EQUITY, currency=Currency(code="USD"))
    assert inst.symbol == "AAPL"


def test_empty_symbol_rejected() -> None:
    with pytest.raises(ValueError):
        Instrument(symbol="", asset_class=AssetClass.EQUITY, currency=Currency(code="USD"))


def test_primary_identifier() -> None:
    inst = Instrument(
        symbol="AAPL",
        asset_class=AssetClass.EQUITY,
        currency=Currency(code="USD"),
        exchange=Exchange.NASDAQ,
    )
    assert inst.primary_identifier == "NASDAQ:AAPL"


def test_default_exchange_unknown() -> None:
    inst = Instrument(symbol="XYZ", asset_class=AssetClass.EQUITY, currency=Currency(code="USD"))
    assert inst.exchange == Exchange.UNKNOWN


def test_description_stripped_and_empty_to_none() -> None:
    inst = Instrument(
        symbol="AAPL",
        asset_class=AssetClass.EQUITY,
        currency=Currency(code="USD"),
        description="   ",
    )
    assert inst.description is None


def test_identifiers_default_empty() -> None:
    inst = Instrument(symbol="AAPL", asset_class=AssetClass.EQUITY, currency=Currency(code="USD"))
    assert inst.identifiers == {}


def test_immutability() -> None:
    inst = Instrument(symbol="AAPL", asset_class=AssetClass.EQUITY, currency=Currency(code="USD"))
    with pytest.raises(Exception):
        inst.symbol = "MSFT"  # type: ignore[misc]