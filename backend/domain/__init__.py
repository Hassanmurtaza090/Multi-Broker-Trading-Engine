"""Multi-Broker Trading Engine — trading domain core.

Broker-agnostic value objects, entities, invariants, and error types. This
package must not import Reactive UI, FastAPI, any broker adapter, or
infrastructure (see `docs/ARCHITECTURE.md`).
"""

from __future__ import annotations

from domain.account import Account, Balance, CashBalance
from domain.errors import (
    BrokerError,
    DomainError,
    DuplicateOrderError,
    ErrorCode,
    InvalidArgumentError,
    OrderNotFoundError,
    OrderRejectedError,
    RiskRejectedError,
    StaleDataError,
)
from domain.fills import ExecutionReport, ExecutionReportType, Fill
from domain.instrument import AssetClass, Exchange, Instrument, InstrumentType
from domain.market import MarketQuote, QuoteType
from domain.money import Currency, Money, Price, Quantity, money, qty
from domain.orders import (
    Order,
    OrderRequest,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)
from domain.portfolio import Portfolio
from domain.position import Position

__all__ = [
    # money
    "Currency",
    "Money",
    "Price",
    "Quantity",
    "money",
    "qty",
    # instrument
    "AssetClass",
    "Exchange",
    "Instrument",
    "InstrumentType",
    # account
    "Account",
    "Balance",
    "CashBalance",
    # orders
    "Order",
    "OrderRequest",
    "OrderSide",
    "OrderStatus",
    "OrderType",
    "TimeInForce",
    # position / fills
    "Position",
    "Fill",
    "ExecutionReport",
    "ExecutionReportType",
    # portfolio
    "Portfolio",
    # market
    "MarketQuote",
    "QuoteType",
    # errors
    "DomainError",
    "BrokerError",
    "ErrorCode",
    "InvalidArgumentError",
    "OrderNotFoundError",
    "DuplicateOrderError",
    "OrderRejectedError",
    "RiskRejectedError",
    "StaleDataError",
]
