"""Instrument and related market-identity value objects.

Broker-agnostic: instruments are described by a standard set of identifiers
(no broker-specific symbols or contract metadata).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain.money import Currency


class AssetClass(StrEnum):
    """Broad asset classification."""

    EQUITY = "EQUITY"
    OPTION = "OPTION"
    FUTURE = "FUTURE"
    FOREX = "FOREX"
    CFD = "CFD"
    BOND = "BOND"
    FUND = "FUND"
    CRYPTO = "CRYPTO"


class Exchange(StrEnum):
    """Primary exchange / venue identifiers used cross-broker."""

    NYSE = "NYSE"
    NASDAQ = "NASDAQ"
    AMEX = "AMEX"
    ARCA = "ARCA"
    CBOE = "CBOE"
    CME = "CME"
    ICE = "ICE"
    LSE = "LSE"
    EURONEXT = "EURONEXT"
    OTC = "OTC"
    UNKNOWN = "UNKNOWN"


class InstrumentType(StrEnum):
    """Refined instrument kind used by the execution/risk layers."""

    STOCK = "STOCK"
    ETF = "ETF"
    INDEX = "INDEX"
    CURRENCY_PAIR = "CURRENCY_PAIR"
    CONTRACT = "CONTRACT"


class Instrument(BaseModel):
    """A tradeable instrument, described broker-agnostically.

    `symbol` is the canonical display symbol; `asset_class` and `instrument_type`
    drive risk/execution behavior. Optional identifiers allow precise mapping
    to broker-specific contracts in adapters (never in the core).
    """

    model_config = ConfigDict(frozen=True)

    symbol: str = Field(min_length=1, max_length=64)
    asset_class: AssetClass
    currency: Currency
    instrument_type: InstrumentType | None = None
    exchange: Exchange = Exchange.UNKNOWN
    description: str | None = None
    # ISO 10383 MIC or standard identifiers — adapters use these to resolve
    # the concrete contract. Kept as optional strings so the core stays generic.
    identifiers: dict[str, str] = Field(default_factory=dict)

    @field_validator("symbol")
    @classmethod
    def _normalize_symbol(cls, v: str) -> str:
        v = v.strip().upper()
        if not v:
            raise ValueError("symbol must not be empty")
        return v

    @field_validator("description")
    @classmethod
    def _normalize_description(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @property
    def primary_identifier(self) -> str:
        """Canonical key: exchange:symbol (unique within a broker account)."""
        return f"{self.exchange.value}:{self.symbol}"


class InstrumentId(str):
    """Strongly-typed instrument identifier alias."""

    __slots__ = ()


AnnotatedInstrumentId = Annotated[str, "InstrumentId"]
