"""Order model: enums, order request, and the order lifecycle.

The order lifecycle is a state machine. `Order` is an immutable value object
representing a specific state; transitions produce *new* instances (functional
style) which makes state bugs hard to introduce and auditing trivial.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain.instrument import Instrument
from domain.money import Price, Quantity


class OrderSide(StrEnum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(StrEnum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"
    STOP_LIMIT = "STOP_LIMIT"


class TimeInForce(StrEnum):
    DAY = "DAY"
    GTC = "GTC"  # good-til-cancelled
    IOC = "IOC"  # immediate-or-cancel
    FOK = "FOK"  # fill-or-kill
    GTD = "GTD"  # good-til-date


class OrderStatus(StrEnum):
    """Order lifecycle states."""

    NEW = "NEW"  # created locally, not yet sent
    PENDING_SUBMIT = "PENDING_SUBMIT"  # queued for broker
    SUBMITTED = "SUBMITTED"  # acked by broker, no fills yet
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    FILLED = "FILLED"
    PENDING_CANCEL = "PENDING_CANCEL"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


# Terminal states — no further transitions are possible.
TERMINAL_STATUSES: frozenset[OrderStatus] = frozenset(
    {OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED, OrderStatus.EXPIRED}
)

# Active (open) states — orders that consume working capital / position intent.
OPEN_STATUSES: frozenset[OrderStatus] = frozenset(
    {
        OrderStatus.NEW,
        OrderStatus.PENDING_SUBMIT,
        OrderStatus.SUBMITTED,
        OrderStatus.PARTIALLY_FILLED,
        OrderStatus.PENDING_CANCEL,
    }
)


class Order(BaseModel):
    """An immutable order in a specific lifecycle state.

    Broker-agnostic: `broker_order_id` is an opaque string set by adapters only
    after the broker acknowledges the order. `client_order_id` is the canonical
    idempotency key generated (or accepted) before submission.
    """

    model_config = ConfigDict(frozen=True)

    client_order_id: UUID = Field(default_factory=uuid4)
    account_id: str = Field(min_length=1)
    instrument: Instrument
    side: OrderSide
    order_type: OrderType
    quantity: Quantity
    status: OrderStatus = OrderStatus.NEW
    time_in_force: TimeInForce = TimeInForce.DAY
    limit_price: Price | None = None
    stop_price: Price | None = None
    broker_order_id: str | None = None
    rejection_reason: str | None = None
    # Cumulative filled quantity (M4 fills the M1 placeholder). Zero until the
    # first confirmed execution is applied.
    filled_quantity: Quantity = Field(default_factory=lambda: Quantity(value=Decimal(0)))
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("quantity")
    @classmethod
    def _validate_quantity(cls, v: Quantity) -> Quantity:
        if v.is_zero():
            raise ValueError("order quantity must be non-zero")
        # Side determines sign; keep the stored quantity positive and derive
        # signed quantity via the side. A negative quantity is rejected here.
        if v.is_negative():
            raise ValueError("order quantity must be positive; side conveys direction")
        return v

    @field_validator("filled_quantity")
    @classmethod
    def _validate_filled_quantity(cls, v: Quantity) -> Quantity:
        if v.is_negative():
            raise ValueError("filled quantity must be non-negative")
        return v

    @field_validator("limit_price", "stop_price")
    @classmethod
    def _validate_price_currency(cls, v: Price | None) -> Price | None:
        if v is not None and v.value < 0:
            raise ValueError("order price cannot be negative")
        return v

    @field_validator("side")
    @classmethod
    def _validate_side(cls, v: OrderSide) -> OrderSide:
        return v

    def model_post_init(self, __context: object) -> None:
        # Invariant: order type implies required price fields.
        self._validate_prices()

    def _validate_prices(self) -> None:
        if self.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT) and self.limit_price is None:
            raise ValueError(f"{self.order_type.value} order requires a limit_price")
        if self.order_type in (OrderType.STOP, OrderType.STOP_LIMIT) and self.stop_price is None:
            raise ValueError(f"{self.order_type.value} order requires a stop_price")
        has_prices = self.limit_price is not None or self.stop_price is not None
        if self.order_type == OrderType.MARKET and has_prices:
            raise ValueError("MARKET order must not specify limit/stop price")

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES

    @property
    def remaining_quantity(self) -> Quantity:
        """Quantity still open to fill."""
        return self.quantity - self.filled_quantity

    def apply_fill_quantity(self, filled: Quantity) -> Order:
        """Return a new Order with the cumulative filled quantity set to `filled`.

        Rejects negative/decreasing totals and totals exceeding the order
        quantity. Does not change status (callers apply the matching status
        transition).
        """
        if filled.is_negative():
            raise ValueError("filled quantity must be non-negative")
        if filled > self.quantity:
            raise ValueError("filled quantity exceeds order quantity")
        if filled < self.filled_quantity:
            raise ValueError("filled quantity cannot decrease")
        return self.model_copy(update={"filled_quantity": filled, "updated_at": datetime.now(UTC)})

    # --- Lifecycle transitions (functional: return a NEW Order) ----------------

    def _evolve(self, *, status: OrderStatus, **changes: object) -> Order:
        if self.is_terminal:
            raise ValueError(f"cannot transition a terminal order (status={self.status.value})")
        return self.model_copy(
            update={"status": status, "updated_at": datetime.now(UTC), **changes}
        )

    def mark_submitted(self, broker_order_id: str | None = None) -> Order:
        if self.status not in (OrderStatus.NEW, OrderStatus.PENDING_SUBMIT):
            raise ValueError(f"invalid transition: {self.status.value} -> SUBMITTED")
        return self._evolve(status=OrderStatus.SUBMITTED, broker_order_id=broker_order_id)

    def mark_pending_submit(self) -> Order:
        """Queue an order for submission to the broker (NEW -> PENDING_SUBMIT)."""
        if self.status is not OrderStatus.NEW:
            raise ValueError(f"invalid transition: {self.status.value} -> PENDING_SUBMIT")
        return self._evolve(status=OrderStatus.PENDING_SUBMIT)

    def mark_rejected(self, reason: str | None = None) -> Order:
        if self.is_terminal:
            raise ValueError("order is already terminal")
        return self._evolve(status=OrderStatus.REJECTED, rejection_reason=reason)

    def mark_partially_filled(self) -> Order:
        if self.status not in (OrderStatus.SUBMITTED, OrderStatus.PARTIALLY_FILLED):
            raise ValueError(f"invalid transition: {self.status.value} -> PARTIALLY_FILLED")
        return self._evolve(status=OrderStatus.PARTIALLY_FILLED)

    def mark_filled(self) -> Order:
        if self.status not in (OrderStatus.SUBMITTED, OrderStatus.PARTIALLY_FILLED):
            raise ValueError(f"invalid transition: {self.status.value} -> FILLED")
        return self._evolve(status=OrderStatus.FILLED)

    def mark_cancelled(self) -> Order:
        if self.status in TERMINAL_STATUSES:
            raise ValueError("order is already terminal")
        return self._evolve(status=OrderStatus.CANCELLED)

    def mark_pending_cancel(self) -> Order:
        if self.status not in (OrderStatus.SUBMITTED, OrderStatus.PARTIALLY_FILLED):
            raise ValueError(f"invalid transition: {self.status.value} -> PENDING_CANCEL")
        return self._evolve(status=OrderStatus.PENDING_CANCEL)

    def mark_expired(self) -> Order:
        if self.status not in (OrderStatus.NEW, OrderStatus.PENDING_SUBMIT, OrderStatus.SUBMITTED):
            raise ValueError(f"invalid transition: {self.status.value} -> EXPIRED")
        return self._evolve(status=OrderStatus.EXPIRED)


class OrderRequest(BaseModel):
    """An intent to place an order (pre-submission).

    Separate from `Order` so that the request can be validated *before* an order
    id and timestamps are assigned, and so idempotency is explicit via
    `client_order_id`.
    """

    model_config = ConfigDict(frozen=True)

    account_id: str = Field(min_length=1)
    instrument: Instrument
    side: OrderSide
    order_type: OrderType
    quantity: Quantity
    time_in_force: TimeInForce = TimeInForce.DAY
    limit_price: Price | None = None
    stop_price: Price | None = None
    client_order_id: UUID | None = None
    # Optional client-supplied correlation key for idempotency.
    idempotency_key: str | None = Field(default=None, max_length=128)

    @field_validator("quantity")
    @classmethod
    def _validate_quantity(cls, v: Quantity) -> Quantity:
        if v.is_zero() or v.is_negative():
            raise ValueError("order quantity must be positive")
        return v

    def model_post_init(self, __context: object) -> None:
        self._validate_prices()

    def _validate_prices(self) -> None:
        if self.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT) and self.limit_price is None:
            raise ValueError(f"{self.order_type.value} order requires a limit_price")
        if self.order_type in (OrderType.STOP, OrderType.STOP_LIMIT) and self.stop_price is None:
            raise ValueError(f"{self.order_type.value} order requires a stop_price")
        has_prices = self.limit_price is not None or self.stop_price is not None
        if self.order_type == OrderType.MARKET and has_prices:
            raise ValueError("MARKET order must not specify limit/stop price")

    def to_order(self) -> Order:
        """Materialize an Order from an intent (assigns id/timestamps)."""
        return Order(
            client_order_id=self.client_order_id or uuid4(),
            account_id=self.account_id,
            instrument=self.instrument,
            side=self.side,
            order_type=self.order_type,
            quantity=self.quantity,
            time_in_force=self.time_in_force,
            limit_price=self.limit_price,
            stop_price=self.stop_price,
        )
