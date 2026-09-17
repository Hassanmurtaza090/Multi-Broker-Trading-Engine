"""Market data value objects: quotes, ticks, and bars."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain.instrument import Instrument
from domain.money import Price, Quantity


class QuoteType(StrEnum):
    BID = "BID"
    ASK = "ASK"
    LAST = "LAST"
    MID = "MID"


class MarketQuote(BaseModel):
    """A single-sided or composite quote for an instrument.

    For a full two-sided quote, provide both `bid` and `ask`. A trade/last
    print may provide only `last`. `timestamp` marks data origin time for
    staleness detection (TS-007).
    """

    model_config = ConfigDict(frozen=True)

    instrument: Instrument
    bid: Price | None = None
    ask: Price | None = None
    last: Price | None = None
    bid_size: Quantity | None = None
    ask_size: Quantity | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("bid_size", "ask_size")
    @classmethod
    def _non_negative_size(cls, v: Quantity | None) -> Quantity | None:
        if v is not None and v.is_negative():
            raise ValueError("size must be non-negative")
        return v

    def model_post_init(self, __context: object) -> None:
        if self.bid is not None and self.ask is not None and self.bid.value > self.ask.value:
            raise ValueError("bid cannot exceed ask")
        if self.bid is None and self.ask is None and self.last is None:
            raise ValueError("quote must provide bid/ask and/or last")

    @property
    def mid(self) -> Price | None:
        if self.bid is None or self.ask is None:
            return None
        return Price(
            value=(self.bid.value + self.ask.value) / 2,
            currency=self.bid.currency,
        )

    @property
    def spread(self) -> Price | None:
        if self.bid is None or self.ask is None:
            return None
        return Price(value=self.ask.value - self.bid.value, currency=self.ask.currency)


class MarketTick(BaseModel):
    """A single price tick (a trade/last print, or a one-sided quote change).

    Used to represent raw, un-aggregated market activity before it is rolled up
    into a two-sided `MarketQuote` or an OHLCV `Bar`. `timestamp` marks the
    exchange/data origin time for staleness detection (TS-007).
    """

    model_config = ConfigDict(frozen=True)

    instrument: Instrument
    quote_type: QuoteType
    price: Price
    volume: Quantity | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("volume")
    @classmethod
    def _non_negative_volume(cls, v: Quantity | None) -> Quantity | None:
        if v is not None and v.is_negative():
            raise ValueError("volume must be non-negative")
        return v


class BarInterval(StrEnum):
    """Standard OHLCV bar aggregation intervals."""

    SECOND = "1s"
    MINUTE = "1m"
    MINUTE_5 = "5m"
    MINUTE_15 = "15m"
    MINUTE_30 = "30m"
    HOUR = "1h"
    HOUR_4 = "4h"
    DAY = "1d"
    WEEK = "1w"
    MONTH = "1M"


class Bar(BaseModel):
    """An OHLCV bar for an instrument over a fixed interval.

    `high` must be the max of open/close/high, `low` the min, and all prices
    must share a single currency. `volume` must be non-negative.
    """

    model_config = ConfigDict(frozen=True)

    instrument: Instrument
    interval: BarInterval
    open: Price
    high: Price
    low: Price
    close: Price
    volume: Quantity
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("volume")
    @classmethod
    def _non_negative_volume(cls, v: Quantity) -> Quantity:
        if v.is_negative():
            raise ValueError("volume must be non-negative")
        return v

    def model_post_init(self, __context: object) -> None:
        currencies = {
            self.open.currency,
            self.high.currency,
            self.low.currency,
            self.close.currency,
        }
        if len(currencies) != 1:
            raise ValueError("all bar prices must share a single currency")
        if self.high.value < max(self.open.value, self.close.value):
            raise ValueError("high must be >= max(open, close)")
        if self.low.value > min(self.open.value, self.close.value):
            raise ValueError("low must be <= min(open, close)")
