"""Fills and execution reports."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain.instrument import Instrument
from domain.money import Money, Price, Quantity
from domain.orders import OrderSide


class ExecutionReportType(StrEnum):
    """Type of execution report received from a broker."""

    SUBMITTED = "SUBMITTED"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"
    REPLACED = "REPLACED"
    PARTIAL_FILL = "PARTIAL_FILL"
    FILL = "FILL"
    EXPIRED = "EXPIRED"
    PENDING_CANCEL = "PENDING_CANCEL"


class Fill(BaseModel):
    """A single execution fill for (part of) an order.

    Semantics: `quantity` is positive; `side` conveys the direction, and
    `signed_quantity` provides the position delta (positive for buys, negative
    for sells). `price` is the executed price; `commission`/`fees` are optional
    per-fill costs.
    """

    model_config = ConfigDict(frozen=True)

    fill_id: str = Field(min_length=1)
    order_client_id: UUID
    broker_order_id: str | None = None
    account_id: str = Field(min_length=1)
    instrument: Instrument
    side: OrderSide
    quantity: Quantity
    price: Price
    commission: Money | None = None
    fees: Money | None = None
    executed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("quantity")
    @classmethod
    def _validate_quantity(cls, v: Quantity) -> Quantity:
        if v.is_zero() or v.is_negative():
            raise ValueError("fill quantity must be positive")
        return v

    @property
    def signed_quantity(self) -> Quantity:
        """Position delta: positive for BUY, negative for SELL."""
        return self.quantity if self.side == OrderSide.BUY else -self.quantity

    @property
    def gross_value(self) -> Money:
        """Notional = quantity * price (always positive)."""
        return Money(amount=self.quantity.value * self.price.value, currency=self.price.currency)

    @property
    def signed_value(self) -> Money:
        """Gross value with direction sign applied."""
        gross = self.gross_value
        if self.side == OrderSide.SELL:
            return -gross
        return gross


class ExecutionReport(BaseModel):
    """Broker acknowledgment/execution report mapped to domain types.

    A single report may carry zero or one fill. The `status` field indicates
    the current order state implied by this report.
    """

    model_config = ConfigDict(frozen=True)

    report_id: str = Field(min_length=1)
    order_client_id: UUID
    broker_order_id: str | None = None
    account_id: str = Field(min_length=1)
    report_type: ExecutionReportType
    fill: Fill | None = None
    status: str = Field(default="")
    rejection_reason: str | None = None
    received_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("fill")
    @classmethod
    def _fill_matches_order(cls, v: Fill | None, info: object) -> Fill | None:
        return v

    def model_post_init(self, __context: object) -> None:
        if self.fill is not None and self.fill.order_client_id != self.order_client_id:
            raise ValueError("fill.order_client_id must match report.order_client_id")
