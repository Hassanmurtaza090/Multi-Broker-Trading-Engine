"""Saxo-shaped data transfer objects (DTOs) used at the adapter boundary.

These mirror the Saxo OpenAPI's JSON concepts (UIC/AssetType instruments,
orders, order activities, price ticks, balance/position DTOs). They exist ONLY
inside `backend/brokers/saxo` — they never leak into the core, which operates
exclusively on the M1 domain models via the `brokers.base` ports.
"""

from __future__ import annotations

from dataclasses import dataclass

# Saxo order status strings (documented subset of Saxo's activity states).
SAXO_RECEIVED = "Received"  # pre-ack (registered, not yet working)
SAXO_WORKING = "Working"
SAXO_WAITING_CONFIRMATION = "WaitingConfirmation"
SAXO_CANCELLED = "Cancelled"
SAXO_REJECTED = "Rejected"
SAXO_EXPIRED = "Expired"
SAXO_SUSPENDED = "Suspended"
SAXO_PARTIALLY_FILLED = "PartiallyFilled"
SAXO_FILLED = "Filled"

# Saxo error codes relevant to the engine (documented subset; unknown codes
# are preserved as diagnostics and mapped to UNKNOWN).
SAXO_ERROR_AUTH_REQUIRED = 401
SAXO_ERROR_PERMISSION = 403
SAXO_ERROR_NOT_FOUND = 404
SAXO_ERROR_RATE_LIMIT = 429
SAXO_ERROR_INTERNAL = 500
SAXO_ERROR_SERVICE_UNAVAILABLE = 503


@dataclass(frozen=True, slots=True)
class SaxoSession:
    """An authenticated Saxo session (opaque tokens; never logged or stored)."""

    access_token: str
    refresh_token: str
    expires_at_unix: int


@dataclass(frozen=True, slots=True)
class SaxoInstrument:
    """A Saxo instrument reference (UIC + AssetType identifies it)."""

    uic: int
    asset_type: str  # Stock | FxSpot | Future | Option | Cfd | Bond | MutualFund
    symbol: str  # display symbol, e.g. "AAPL" / "EUR/USD"
    currency: str
    exchange: str | None = None


@dataclass(frozen=True, slots=True)
class SaxoOrder:
    """A Saxo order (mirrors the OpenAPI `PostOrderRequest`)."""

    account_key: str
    uic: int
    asset_type: str
    buy_sell: str  # "buy" | "sell"
    order_type: str  # Market | Limit | Stop | StopLimit
    quantity: str  # decimal string for exactness
    order_duration: str  # Day | Gtc | Ioc | Fok | Gtd
    limit_price: str | None = None
    stop_price: str | None = None
    external_reference: str | None = None  # carries the internal client_order_id
    order_id: int | None = None


@dataclass(frozen=True, slots=True)
class SaxoOrderStatus:
    """A Saxo order activity/status callback payload."""

    order_id: int
    status: str
    filled: str = "0"
    remaining: str = "0"


@dataclass(frozen=True, slots=True)
class SaxoExecution:
    """A Saxo execution (mirrors the OpenAPI `ActivityRecord` fill)."""

    execution_id: str
    order_id: int
    external_reference: str | None  # internal client_order_id when known
    uic: int
    asset_type: str
    buy_sell: str  # "buy" | "sell"
    quantity: str
    price: str
    cum_quantity: str
    executed_at_unix: int  # Unix seconds (UTC)


@dataclass(frozen=True, slots=True)
class SaxoQuote:
    """A Saxo price tick (combined into one callback payload)."""

    uic: int
    asset_type: str
    bid: str | None = None
    ask: str | None = None
    bid_size: str | None = None
    ask_size: str | None = None
    last: str | None = None
    timestamp_unix: int = 0


@dataclass(frozen=True, slots=True)
class SaxoBar:
    """A Saxo historical bar."""

    uic: int
    asset_type: str
    interval: str  # e.g. "1m", "5m", "1h", "1d"
    open: str
    high: str
    low: str
    close: str
    volume: str
    timestamp_unix: int


@dataclass(frozen=True, slots=True)
class SaxoBalance:
    """A Saxo account balance snapshot (per currency)."""

    account_key: str
    currency: str
    cash_amount: str
    available: str
    margin_available: str | None = None
    equity: str | None = None


@dataclass(frozen=True, slots=True)
class SaxoPosition:
    """A Saxo portfolio position."""

    account_key: str
    uic: int
    asset_type: str
    symbol: str
    currency: str
    position_size: str  # signed decimal string
    average_open_price: str | None = None
    exchange: str | None = None
