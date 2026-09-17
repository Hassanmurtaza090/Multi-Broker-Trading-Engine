"""Shared fixtures for order-management (OMS) tests."""

from __future__ import annotations

from uuid import uuid4

import pytest

from domain.instrument import AssetClass, Exchange, Instrument
from domain.money import Currency, Price, Quantity
from domain.orders import OrderRequest, OrderSide, OrderType, TimeInForce
from events import InProcessEventBus
from order_management import InMemoryOrderRepository, OrderManager


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
def bus() -> InProcessEventBus:
    return InProcessEventBus()


@pytest.fixture()
def repo() -> InMemoryOrderRepository:
    return InMemoryOrderRepository()


@pytest.fixture()
def manager(repo: InMemoryOrderRepository, bus: InProcessEventBus) -> OrderManager:
    return OrderManager(repo, bus)


def make_request(
    aapl: Instrument,
    usd: Currency,
    *,
    side: OrderSide = OrderSide.BUY,
    order_type: OrderType = OrderType.LIMIT,
    quantity: str = "10",
    limit_price: str = "100",
    idempotency_key: str | None = None,
    client_order_id=None,
) -> OrderRequest:
    return OrderRequest(
        account_id="ACC-001",
        instrument=aapl,
        side=side,
        order_type=order_type,
        quantity=Quantity(value=quantity),
        limit_price=Price(value=limit_price, currency=usd),
        idempotency_key=idempotency_key,
        client_order_id=client_order_id,
    )


def make_fill(
    order,
    usd: Currency,
    *,
    quantity: str = "5",
    price: str = "100",
    fill_id: str | None = None,
):
    from domain.fills import Fill

    return Fill(
        fill_id=fill_id or f"F-{uuid4()}",
        order_client_id=order.client_order_id,
        account_id=order.account_id,
        instrument=order.instrument,
        side=order.side,
        quantity=Quantity(value=quantity),
        price=Price(value=price, currency=usd),
    )


def make_report(
    order,
    report_type,
    *,
    report_id: str | None = None,
    fill=None,
    rejection_reason: str | None = None,
    broker_order_id: str | None = None,
):
    from domain.fills import ExecutionReport

    return ExecutionReport(
        report_id=report_id or f"R-{uuid4()}",
        order_client_id=order.client_order_id,
        broker_order_id=broker_order_id,
        account_id=order.account_id,
        report_type=report_type,
        fill=fill,
        rejection_reason=rejection_reason,
    )


__all__ = [
    "usd", "aapl", "bus", "repo", "manager",
    "make_request", "make_fill", "make_report",
    "OrderSide", "OrderType", "TimeInForce",
]