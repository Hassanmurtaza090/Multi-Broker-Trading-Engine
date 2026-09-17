"""Shared fixtures for event tests."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from domain.instrument import AssetClass, Exchange, Instrument
from domain.money import Currency, Price, Quantity
from domain.orders import Order, OrderRequest, OrderSide, OrderStatus, OrderType, TimeInForce
from domain.fills import Fill, ExecutionReportType


@pytest.fixture()
def usd() -> Currency:
    return Currency(code="USD")


@pytest.fixture()
def aapl(usd: Currency) -> Instrument:
    return Instrument(
        symbol="AAPL",
        asset_class=AssetClass.EQUITY,
        currency=usd,
        exchange=Exchange.NASDAQ,
    )


@pytest.fixture()
def limit_order(aapl: Instrument, usd: Currency) -> Order:
    return Order(
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value="10"),
        limit_price=Price(value="100", currency=usd),
    )


@pytest.fixture()
def filled_order(aapl: Instrument, usd: Currency) -> Order:
    return Order(
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value="10"),
        limit_price=Price(value="100", currency=usd),
        status=OrderStatus.FILLED,
    )


@pytest.fixture()
def order_request(aapl: Instrument, usd: Currency) -> OrderRequest:
    return OrderRequest(
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value="10"),
        limit_price=Price(value="100", currency=usd),
    )


@pytest.fixture()
def fill(aapl: Instrument, usd: Currency) -> Fill:
    return Fill(
        fill_id="F-1",
        order_client_id=uuid4(),
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        quantity=Quantity(value="10"),
        price=Price(value="100", currency=usd),
    )


@pytest.fixture()
def event_bus():
    from events import InProcessEventBus
    return InProcessEventBus()


__all__ = [
    "usd", "aapl", "limit_order", "filled_order", "order_request", "fill", "event_bus",
    "Decimal", "UUID", "uuid4", "OrderSide", "OrderStatus", "OrderType", "TimeInForce",
    "ExecutionReportType", "AssetClass", "Exchange",
]