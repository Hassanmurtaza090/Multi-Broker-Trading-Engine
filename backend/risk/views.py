"""Read-model ports the Risk Engine consumes.

These define *who owns* each piece of risk-relevant state so the risk engine
does not duplicate it:

- `PortfolioView` — positions/exposure, owned by M7 (Portfolio & P&L).
- `AccountView` — balances/equity, owned by the account/broker layer.
- `MarketDataView` — live quotes and staleness, owned by M3 (Market Data).
- `DailyPnlProvider` — cumulative realized P&L, owned by M7.

The risk engine reads these (never writes them) and reacts to their updates,
which are themselves driven by the event bus upstream.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol

from domain.account import Balance
from domain.instrument import Instrument
from domain.market import MarketQuote
from domain.money import Money
from domain.position import Position


class PortfolioView(Protocol):
    """Authoritative portfolio state (implemented by M7)."""

    def positions(self, account_id: str) -> Mapping[str, Position]: ...

    def exposure(self, account_id: str) -> Money | None: ...


class AccountView(Protocol):
    """Authoritative account balances (implemented by the account/broker layer)."""

    def balance(self, account_id: str) -> Balance | None: ...


class MarketDataView(Protocol):
    """Live market quotes and staleness (implemented by M3)."""

    def quote(self, instrument: Instrument) -> MarketQuote | None: ...

    def is_stale(self, instrument: Instrument) -> bool: ...


class DailyPnlProvider(Protocol):
    """Cumulative realized P&L today (implemented by M7)."""

    def realized_pnl_today(self, account_id: str) -> Money | None: ...
