"""Unit tests for M3 market-data domain models (MarketTick, Bar, BarInterval)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from domain.market import Bar, BarInterval, MarketTick, QuoteType
from domain.money import Price, Quantity


class TestBar:
    def test_valid_bar(self, usd, aapl):
        ts = datetime(2025, 1, 2, 12, 0, tzinfo=UTC)
        bar = Bar(
            instrument=aapl,
            interval=BarInterval.MINUTE,
            open=Price(value="100", currency=usd),
            high=Price(value="105", currency=usd),
            low=Price(value="99", currency=usd),
            close=Price(value="104", currency=usd),
            volume=Quantity(value="1000"),
            timestamp=ts,
        )
        assert bar.high.value == 105
        assert bar.low.value == 99
        assert bar.close.value == 104

    def test_high_below_ceiling_rejected(self, usd, aapl):
        with pytest.raises(Exception):
            Bar(
                instrument=aapl,
                interval=BarInterval.MINUTE,
                open=Price(value="100", currency=usd),
                high=Price(value="99", currency=usd),  # < open
                low=Price(value="98", currency=usd),
                close=Price(value="101", currency=usd),
                volume=Quantity(value="10"),
            )

    def test_low_above_floor_rejected(self, usd, aapl):
        with pytest.raises(Exception):
            Bar(
                instrument=aapl,
                interval=BarInterval.MINUTE,
                open=Price(value="100", currency=usd),
                high=Price(value="102", currency=usd),
                low=Price(value="101", currency=usd),  # > min(open,close)
                close=Price(value="99", currency=usd),
                volume=Quantity(value="10"),
            )

    def test_negative_volume_rejected(self, usd, aapl):
        with pytest.raises(Exception):
            Bar(
                instrument=aapl,
                interval=BarInterval.MINUTE,
                open=Price(value="100", currency=usd),
                high=Price(value="101", currency=usd),
                low=Price(value="99", currency=usd),
                close=Price(value="100", currency=usd),
                volume=Quantity(value="-5"),
            )

    def test_mixed_currency_rejected(self, usd, eur, aapl):
        with pytest.raises(Exception):
            Bar(
                instrument=aapl,
                interval=BarInterval.MINUTE,
                open=Price(value="100", currency=usd),
                high=Price(value="101", currency=eur),
                low=Price(value="99", currency=usd),
                close=Price(value="100", currency=usd),
                volume=Quantity(value="10"),
            )


class TestMarketTick:
    def test_valid_tick(self, usd, aapl):
        ts = datetime(2025, 1, 2, 12, 0, tzinfo=UTC)
        tick = MarketTick(
            instrument=aapl,
            quote_type=QuoteType.LAST,
            price=Price(value="100", currency=usd),
            volume=Quantity(value="50"),
            timestamp=ts,
        )
        assert tick.quote_type == QuoteType.LAST
        assert tick.price.value == 100

    def test_negative_volume_rejected(self, usd, aapl):
        with pytest.raises(Exception):
            MarketTick(
                instrument=aapl,
                quote_type=QuoteType.BID,
                price=Price(value="100", currency=usd),
                volume=Quantity(value="-1"),
            )

    def test_tick_immutable(self, usd, aapl):
        tick = MarketTick(
            instrument=aapl,
            quote_type=QuoteType.ASK,
            price=Price(value="100", currency=usd),
        )
        with pytest.raises(Exception):
            tick.price = Price(value="101", currency=usd)

    def test_bar_interval_values(self):
        assert BarInterval.MINUTE == "1m"
        assert BarInterval.DAY == "1d"