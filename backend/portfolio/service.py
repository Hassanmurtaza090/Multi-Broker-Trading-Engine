"""Portfolio service — authoritative internal portfolio & P&L state (M7).

State ownership:
- **portfolio owns:** positions (authoritative internal state), cumulative and
  daily realized P&L, unrealized P&L (derived), last-known market quotes, and
  the last broker-reported balances.
- **OMS owns order state; Risk owns risk decisions; the broker is authoritative
  for cash/positions at reconciliation** (via `apply_broker_snapshot`).

Event integration (M2 bus):
- consumes `order.partially_filled` / `order.filled` (fill-driven position
  updates), `market.quote.updated` (prices), `balance.updated` (balances);
- publishes `position.opened` / `position.updated` / `position.closed`.

Determinism / concurrency: each handler commits state synchronously and only
`await`s when publishing after the commit, so a handler is atomic on the
cooperative event loop; the M2 bus lock serializes publishes. Duplicate fills
are deduplicated by `fill_id`. Delivery order follows the M2 per-bus total
ordering (ADR-007); fill order matters for average-cost accounting and is
preserved.

Market-price policy: valuation uses the last quote's `last` (else mid) price
only while it is fresher than `price_max_age`; stale or missing prices make
unrealized P&L `None` (never silently zero) and fall back to the average entry
price for exposure/equity valuation (documented in ADR-013).

Implements the M6 read-model ports (`PortfolioView`, `AccountView`,
`MarketDataView`, `DailyPnlProvider`) so Risk consumes authoritative state
without duplication. Persistence is in-memory for M7 (PostgreSQL deferred to
the infrastructure milestone; state is rebuildable from events and/or a broker
snapshot).
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from domain.account import Balance
from domain.instrument import Instrument
from domain.market import MarketQuote
from domain.money import Currency, Money, Price
from domain.position import Position
from events import (
    BalanceUpdated,
    EventBus,
    EventEnvelope,
    MarketQuoteUpdated,
    OrderFilled,
    OrderPartiallyFilled,
    PositionClosed,
    PositionOpened,
    PositionUpdated,
)
from portfolio import accounting

logger = logging.getLogger("mtbe.portfolio")

Clock = Callable[[], datetime]


def _system_clock() -> datetime:
    return datetime.now(UTC)


class PortfolioService:
    """Authoritative portfolio/account state, updated by events."""

    def __init__(
        self,
        *,
        bus: EventBus | None = None,
        clock: Clock = _system_clock,
        price_max_age: timedelta = timedelta(seconds=10),
    ) -> None:
        self._clock = clock
        self._price_max_age = price_max_age
        self._bus: EventBus | None = None
        # account_id -> (instrument_key -> Position)
        self._positions: dict[str, dict[str, Position]] = {}
        # instrument_key -> MarketQuote
        self._quotes: dict[str, MarketQuote] = {}
        # account_id -> Balance (last broker-reported)
        self._balances: dict[str, Balance] = {}
        # account_id -> {currency_code: cumulative realized P&L}
        self._realized: dict[str, dict[str, Money]] = {}
        # account_id -> {date_iso: {currency_code: realized P&L}}
        self._realized_by_day: dict[str, dict[str, dict[str, Money]]] = {}
        # Duplicate-fill protection (at-least-once delivery).
        self._seen_fill_ids: set[str] = set()
        if bus is not None:
            self.attach(bus)

    def attach(self, bus: EventBus) -> None:
        """Subscribe the portfolio to the relevant event streams."""
        self._bus = bus
        bus.subscribe("order.partially_filled", self._on_fill_event)
        bus.subscribe("order.filled", self._on_fill_event)
        bus.subscribe("market.quote.updated", self._on_quote_event)
        bus.subscribe("balance.updated", self._on_balance_event)

    # -- event handlers (atomic: state commits before any await) ---------------
    async def _on_fill_event(self, envelope: EventEnvelope[Any]) -> None:
        payload = envelope.payload
        if not isinstance(payload, (OrderPartiallyFilled, OrderFilled)):
            return
        fill = payload.fill
        if fill.fill_id in self._seen_fill_ids:
            return  # duplicate delivery
        self._seen_fill_ids.add(fill.fill_id)

        account_id = fill.account_id
        key = fill.instrument.primary_identifier
        book = self._positions.setdefault(account_id, {})
        existing = book.get(key)
        outcome = accounting.apply_fill(existing, fill)

        was_open = existing is not None and not existing.is_flat
        is_open = not outcome.position.is_flat

        if is_open:
            book[key] = outcome.position
        else:
            book.pop(key, None)

        if outcome.realized_pnl is not None:
            self._accumulate_realized(account_id, outcome.realized_pnl)

        event: Any
        if not was_open and is_open:
            event = PositionOpened(position=outcome.position)
        elif was_open and not is_open:
            event = PositionClosed(position=outcome.position)
        elif was_open and is_open:
            event = PositionUpdated(position=outcome.position, fill=fill)
        else:  # pragma: no cover - fills are quantity-positive
            event = None

        if event is not None and self._bus is not None:
            await self._bus.publish(event, source="portfolio")

    async def _on_quote_event(self, envelope: EventEnvelope[Any]) -> None:
        payload = envelope.payload
        if not isinstance(payload, MarketQuoteUpdated):
            return
        quote = payload.quote
        self._quotes[quote.instrument.primary_identifier] = quote
        # Valuation is derived on demand; quotes publish no portfolio events.

    async def _on_balance_event(self, envelope: EventEnvelope[Any]) -> None:
        payload = envelope.payload
        if not isinstance(payload, BalanceUpdated):
            return
        self._balances[payload.balance.account_id] = payload.balance

    # -- read API (M6 views) ----------------------------------------------------
    def position(self, account_id: str, instrument: Instrument) -> Position | None:
        return self._positions.get(account_id, {}).get(instrument.primary_identifier)

    def positions(self, account_id: str) -> Mapping[str, Position]:
        return dict(self._positions.get(account_id, {}))

    def balance(self, account_id: str) -> Balance | None:
        return self._balances.get(account_id)

    def quote(self, instrument: Instrument) -> MarketQuote | None:
        return self._quotes.get(instrument.primary_identifier)

    def is_stale(self, instrument: Instrument) -> bool:
        return self._market_price(instrument) is None

    # -- valuation --------------------------------------------------------------
    def _market_price(self, instrument: Instrument) -> Price | None:
        """Fresh market price (`last` else mid), or None when missing/stale."""
        quote = self._quotes.get(instrument.primary_identifier)
        if quote is None:
            return None
        if (self._clock() - quote.timestamp) > self._price_max_age:
            return None  # stale (TS-007): never used as a valid current price
        return quote.last or quote.mid

    def _valuation_price(self, position: Position) -> Price | None:
        """Market price when fresh, else the average entry price (fallback)."""
        market = self._market_price(position.instrument)
        if market is not None:
            return market
        return position.average_price

    def unrealized_pnl(self, account_id: str, instrument: Instrument) -> Money | None:
        position = self.position(account_id, instrument)
        if position is None:
            return None
        return accounting.unrealized_pnl(position, self._market_price(position.instrument))

    def unrealized_pnl_by_currency(self, account_id: str) -> dict[str, Money]:
        """Aggregate unrealized P&L per currency (unpriced positions excluded)."""
        result: dict[str, Money] = {}
        for position in self._positions.get(account_id, {}).values():
            pnl = accounting.unrealized_pnl(position, self._market_price(position.instrument))
            if pnl is None:
                continue
            code = pnl.currency.code
            result[code] = result[code] + pnl if code in result else pnl
        return result

    def exposure_by_currency(self, account_id: str) -> dict[str, Money]:
        result: dict[str, Money] = {}
        for position in self._positions.get(account_id, {}).values():
            value = accounting.gross_exposure(position, self._valuation_price(position))
            if value is None:
                continue
            code = value.currency.code
            result[code] = result[code] + value if code in result else value
        return result

    def exposure(self, account_id: str) -> Money | None:
        """Gross notional exposure (M6 `PortfolioView`).

        Single-currency accounts return the total; multi-currency accounts
        return `None` (no invented FX aggregation — ADR-013).
        """
        by_ccy = self.exposure_by_currency(account_id)
        if len(by_ccy) == 1:
            return next(iter(by_ccy.values()))
        return None

    def market_value_by_currency(self, account_id: str) -> dict[str, Money]:
        result: dict[str, Money] = {}
        for position in self._positions.get(account_id, {}).values():
            value = accounting.market_value(position, self._valuation_price(position))
            if value is None:
                continue
            code = value.currency.code
            result[code] = result[code] + value if code in result else value
        return result

    def equity_by_currency(self, account_id: str) -> dict[str, Money]:
        """Cash total + signed position market value, per currency."""
        balance = self._balances.get(account_id)
        result: dict[str, Money] = {}
        if balance is not None:
            for code, cb in balance.cash.items():
                result[code] = cb.total
        for code, value in self.market_value_by_currency(account_id).items():
            result[code] = result[code] + value if code in result else value
        return result

    def equity(self, account_id: str) -> Money | None:
        """Single-currency equity; `None` without a known balance or when
        multi-currency (no invented FX aggregation — ADR-013)."""
        if self._balances.get(account_id) is None:
            return None  # cash unknown -> equity unknown (never silently zero)
        by_ccy = self.equity_by_currency(account_id)
        if len(by_ccy) == 1:
            return next(iter(by_ccy.values()))
        return None

    # -- realized P&L -----------------------------------------------------------
    def realized_pnl(self, account_id: str, currency_code: str) -> Money:
        entry = self._realized.get(account_id, {}).get(currency_code)
        if entry is not None:
            return entry
        return Money(amount=Decimal(0), currency=Currency(code=currency_code))

    def realized_pnl_today(self, account_id: str) -> Money | None:
        """Today's realized P&L (M6 `DailyPnlProvider`).

        Returns the total when exactly one currency has P&L today (or a known
        single-currency history/balance yields a zero); otherwise `None`
        (ambiguous without FX — risk fails closed).
        """
        today = self._clock().date().isoformat()
        today_bucket = self._realized_by_day.get(account_id, {}).get(today, {})
        if today_bucket:
            if len(today_bucket) == 1:
                return next(iter(today_bucket.values()))
            return None
        # No fills today: zero in a known single currency, else unavailable.
        codes = set(self._realized.get(account_id, {}))
        balance = self._balances.get(account_id)
        if balance is not None:
            codes |= set(balance.cash)
        if len(codes) == 1:
            return Money(amount=Decimal(0), currency=Currency(code=next(iter(codes))))
        return None

    # -- reconciliation boundary (broker adapters, M8/M9) ----------------------
    def apply_broker_snapshot(
        self,
        account_id: str,
        positions: Iterable[Position],
        balance: Balance | None = None,
    ) -> None:
        """Align internal state with a broker-reported snapshot (TS-002/TS-006).

        Broker-independent: accepts domain models only. Positions are replaced
        for the account; the balance is stored when provided. Realized-P&L
        history is preserved (broker snapshots do not carry internal P&L).
        No events are published (bulk reconciliation; adapters document it).
        """
        book: dict[str, Position] = {}
        for position in positions:
            if position.account_id != account_id:
                raise ValueError("snapshot position belongs to a different account")
            book[position.instrument.primary_identifier] = position
        self._positions[account_id] = book
        if balance is not None:
            self._balances[account_id] = balance
        logger.info(
            "portfolio_snapshot_applied",
            extra={"account": account_id, "positions": len(book)},
        )

    # -- internals ---------------------------------------------------------------
    def _accumulate_realized(self, account_id: str, pnl: Money) -> None:
        code = pnl.currency.code
        cumulative = self._realized.setdefault(account_id, {})
        cumulative[code] = cumulative[code] + pnl if code in cumulative else pnl
        today = self._clock().date().isoformat()
        day = self._realized_by_day.setdefault(account_id, {}).setdefault(today, {})
        day[code] = day[code] + pnl if code in day else pnl
