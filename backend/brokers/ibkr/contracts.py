"""IBKR-shaped data transfer objects (DTOs) used at the adapter boundary.

These mirror the Interactive Brokers API's wire concepts (contracts, orders,
executions, account values, positions, order-status strings). They exist ONLY
inside `backend/brokers/ibkr` — they never leak into the core, which operates
exclusively on the M1 domain models via the `brokers.base` ports.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# IBKR order status strings (subset relevant to the engine).
IBKR_API_PENDING = "ApiPending"
IBKR_PENDING_SUBMIT = "PendingSubmit"
IBKR_PRE_SUBMITTED = "PreSubmitted"
IBKR_SUBMITTED = "Submitted"
IBKR_API_CANCELLED = "ApiCancelled"
IBKR_CANCELLED = "Cancelled"
IBKR_FILLED = "Filled"
IBKR_PARTIALLY_FILLED = "PartiallyFilled"
IBKR_INACTIVE = "Inactive"

# IBKR error codes relevant to the engine (documented subset; unknown codes
# are preserved as diagnostics and mapped to UNKNOWN).
IBKR_ERROR_CONNECT_FAIL = 502
IBKR_ERROR_ALREADY_CONNECTED = 503
IBKR_ERROR_NOT_CONNECTED = 504
IBKR_ERROR_CONN_LOST = 1100
IBKR_ERROR_INVALID_CONTRACT = 200
IBKR_ERROR_ORDER_REJECTED = 201
IBKR_ERROR_MD_NOT_SUBSCRIBED = 10089


@dataclass(frozen=True, slots=True)
class IbkrContract:
    """An IBKR contract (mirrors IBKR `Contract`)."""

    symbol: str
    sec_type: str  # STK | CASH | FUT | OPT | CFD | BOND | FUND | CRYPTO
    exchange: str  # e.g. SMART, NASDAQ, NYSE, IDEALPRO
    currency: str  # ISO 4217
    con_id: int | None = None


@dataclass(frozen=True, slots=True)
class IbkrOrder:
    """An IBKR order (mirrors IBKR `Order`)."""

    action: str  # BUY | SELL
    order_type: str  # MKT | LMT | STP | STP_LMT (IBKR spells the last STP LMT)
    quantity: str  # decimal string for exactness
    lmt_price: str | None = None
    aux_price: str | None = None  # stop price
    tif: str = "DAY"  # DAY | GTC | IOC | FOK | GTD
    order_ref: str | None = None  # carries the internal client_order_id
    ibkr_order_id: int | None = None


@dataclass(frozen=True, slots=True)
class IbkrExecution:
    """An IBKR execution (mirrors IBKR `Execution`)."""

    execution_id: str
    ibkr_order_id: int
    order_ref: str | None  # internal client_order_id when known
    symbol: str
    sec_type: str
    exchange: str
    currency: str
    side: str  # BOT | SLD
    quantity: str
    price: str
    cum_quantity: str
    executed_at_unix: int  # Unix seconds (UTC)


@dataclass(frozen=True, slots=True)
class IbkrAccountValue:
    """An IBKR account-summary value for one currency."""

    key: str  # e.g. TotalCashValue, AvailableFunds, BuyingPower
    value: str
    currency: str


@dataclass(frozen=True, slots=True)
class IbkrPosition:
    """An IBKR portfolio position."""

    account: str
    contract: IbkrContract
    position: str  # signed decimal string
    avg_cost: str | None = None  # average cost per unit


@dataclass(frozen=True, slots=True)
class IbkrQuote:
    """A snapshot of IBKR tick data combined into one callback payload."""

    contract: IbkrContract
    bid: str | None = None
    ask: str | None = None
    bid_size: str | None = None
    ask_size: str | None = None
    last: str | None = None
    timestamp_unix: int = 0


@dataclass(frozen=True, slots=True)
class IbkrBar:
    """An IBKR historical bar."""

    contract: IbkrContract
    interval: str  # e.g. 1 min, 1 day — IBKR bar-size strings
    open: str
    high: str
    low: str
    close: str
    volume: str
    timestamp_unix: int


@dataclass(frozen=True, slots=True)
class IbkrOrderStatus:
    """An IBKR `orderStatus` callback payload."""

    ibkr_order_id: int
    status: str
    filled: str = "0"
    remaining: str = "0"
    fields: dict[str, str] = field(default_factory=dict)
