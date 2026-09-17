"""Shared fixtures for execution-engine tests (including a simulated broker)."""

from __future__ import annotations

from uuid import uuid4

import pytest

from domain.errors import BrokerError, ErrorCode
from domain.fills import ExecutionReport, ExecutionReportType, Fill
from domain.instrument import AssetClass, Exchange, Instrument
from domain.money import Currency, Price, Quantity
from domain.orders import OrderRequest, OrderSide, OrderType, TimeInForce
from events import InProcessEventBus
from order_management import InMemoryOrderRepository, OrderManager
from execution import ExecutionEngine


class SimulatedExecutionBroker:
    """In-memory `ExecutionBroker` used by tests.

    Configuration flags control acceptance, failures, and async push of fills.
    """

    def __init__(self) -> None:
        self.handler = None
        self.fail_submit = False
        self.fail_submit_until = 0  # fail the first N submit calls (connection error)
        self.submit_calls = 0
        self.auto_accept = True
        self.reject_on_submit = False
        self.cancel_report_type = ExecutionReportType.CANCELLED
        self.broker_order_id = None

    def attach_report_handler(self, handler) -> None:
        self.handler = handler

    async def submit_order(self, order):
        self.submit_calls += 1
        if self.fail_submit or self.submit_calls <= self.fail_submit_until:
            raise BrokerError("connection lost", code=ErrorCode.CONNECTION_LOST)
        if self.reject_on_submit:
            return self._report(order, ExecutionReportType.REJECTED, rejection_reason="nms")
        return self._report(order, ExecutionReportType.ACCEPTED)

    async def cancel_order(self, order):
        return self._report(order, self.cancel_report_type)

    async def modify_order(self, order):
        return self._report(order, ExecutionReportType.REPLACED)

    async def fetch_order_status(self, order):
        # Default: no asynchronous status available.
        return None

    def _report(self, order, report_type, *, rejection_reason=None):
        return ExecutionReport(
            report_id=f"R-{uuid4()}",
            order_client_id=order.client_order_id,
            broker_order_id=self.broker_order_id or f"B-{order.client_order_id}",
            account_id=order.account_id,
            report_type=report_type,
            rejection_reason=rejection_reason,
        )

    async def push(self, order, report_type, *, quantity="5", price="100", fill_id=None):
        """Simulate an async report (e.g. a fill) delivered to the handler."""
        fill = Fill(
            fill_id=fill_id or f"F-{uuid4()}",
            order_client_id=order.client_order_id,
            broker_order_id=self.broker_order_id,
            account_id=order.account_id,
            instrument=order.instrument,
            side=order.side,
            quantity=Quantity(value=quantity),
            price=Price(value=price, currency=order.instrument.currency),
        )
        await self.handler(
            ExecutionReport(
                report_id=f"R-{uuid4()}",
                order_client_id=order.client_order_id,
                broker_order_id=self.broker_order_id,
                account_id=order.account_id,
                report_type=report_type,
                fill=fill,
            )
        )


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
def oms(repo: InMemoryOrderRepository, bus: InProcessEventBus) -> OrderManager:
    return OrderManager(repo, bus)


@pytest.fixture()
def broker() -> SimulatedExecutionBroker:
    return SimulatedExecutionBroker()


@pytest.fixture()
def engine(broker: SimulatedExecutionBroker, oms: OrderManager) -> ExecutionEngine:
    return ExecutionEngine(broker, oms)


def make_request(
    aapl: Instrument,
    usd: Currency,
    *,
    quantity: str = "10",
    limit_price: str = "100",
    idempotency_key: str | None = None,
) -> OrderRequest:
    return OrderRequest(
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value=quantity),
        limit_price=Price(value=limit_price, currency=usd),
        idempotency_key=idempotency_key,
    )


__all__ = [
    "SimulatedExecutionBroker",
    "usd", "aapl", "bus", "repo", "oms", "broker", "engine",
    "make_request",
    "ExecutionReportType",
]