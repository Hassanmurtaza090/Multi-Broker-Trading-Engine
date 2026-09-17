"""Account and balance models."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain.money import Currency, Money


class CashBalance(BaseModel):
    """A cash amount and its available-for-trading subset."""

    model_config = ConfigDict(frozen=True)

    currency: Currency
    total: Money
    available: Money
    buying_power: Money | None = None

    @field_validator("available")
    @classmethod
    def _available_le_total(cls, v: Money, info: object) -> Money:
        # `info` is a ValidationInfo; total may not be parsed yet depending on
        # field ordering, so we rely on model_post_init for the cross-field check.
        return v

    def model_post_init(self, __context: object) -> None:
        if self.available.currency != self.total.currency:
            raise ValueError("available and total must share currency")
        if self.available.amount > self.total.amount:
            raise ValueError("available cash cannot exceed total cash")


class Balance(BaseModel):
    """Aggregated account balances across currencies.

    `cash` holds per-currency cash balances; `positions`/margin fields are
    populated in later milestones (portfolio/risk)."""

    model_config = ConfigDict(frozen=True)

    account_id: str = Field(min_length=1)
    cash: dict[str, CashBalance] = Field(default_factory=dict)
    equity: Money | None = None
    margin_used: Money | None = None
    realized_pnl: Money | None = None
    unrealized_pnl: Money | None = None

    def cash_for(self, currency: Currency | str) -> CashBalance | None:
        key = currency.code if isinstance(currency, Currency) else currency
        return self.cash.get(key)


class Account(BaseModel):
    """A broker-agnostic account reference.

    `broker` is an opaque identifier (e.g. "IBKR", "SAXO") used for routing;
    the core does not interpret it beyond grouping."""

    model_config = ConfigDict(frozen=True)

    account_id: str = Field(min_length=1)
    name: str | None = None
    broker: str = Field(min_length=1)
    base_currency: Currency
    account_type: str = "CASH"  # CASH | MARGIN | etc.; refined later

    @field_validator("name")
    @classmethod
    def _normalize_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


AnnotatedAccountId = Annotated[str, "AccountId"]
