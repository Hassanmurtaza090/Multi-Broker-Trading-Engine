"""Execution Engine — routes orders through the broker abstraction.

The Execution Engine is the broker-independent coordinator between the OMS
(which owns order lifecycle state) and the `ExecutionBroker` port (which broker
adapters implement). It:

- submits, cancels, and modifies orders through the broker;
- applies broker `ExecutionReport`s to the OMS (which publishes `order.*`
  events) — the engine itself publishes no events, avoiding duplication;
- handles submission timeouts (raises `BrokerError` with `TIMEOUT`, leaving
  order state unchanged so reconciliation can resolve it — it never assumes an
  execution outcome without confirmation);
- optionally retries a submission on a transient connection error (safe only
  because `client_order_id` is the idempotency key and adapters propagate it);
- provides a `reconcile()` boundary to re-sync outstanding orders after a
  broker reconnect.

It contains no broker-specific logic.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Sequence
from typing import TypeVar
from uuid import UUID

from brokers.base import ExecutionBroker
from domain.errors import BrokerError, ErrorCode, OrderStateError
from domain.fills import ExecutionReport
from domain.money import Price
from domain.orders import Order, OrderStatus
from order_management import OrderManager

logger = logging.getLogger("mtbe.execution")

T = TypeVar("T")


class ExecutionEngine:
    """Coordinates order execution through a broker adapter."""

    def __init__(
        self,
        broker: ExecutionBroker,
        oms: OrderManager,
        *,
        submit_max_attempts: int = 1,
    ) -> None:
        self._broker = broker
        self._oms = oms
        self._submit_max_attempts = max(1, submit_max_attempts)
        # Wire async broker reports (fills, cancels, expires) to the OMS.
        self._broker.attach_report_handler(self._on_broker_report)

    # -- submission ------------------------------------------------------------
    async def submit(self, client_order_id: UUID, *, timeout: float = 10.0) -> Order:
        """Submit an order to the broker and await its acknowledgment.

        The OMS marks the order PENDING_SUBMIT (publishing `OrderSubmitted`),
        then the broker's initial report is applied (ACCEPTED -> `OrderAccepted`,
        REJECTED -> `OrderRejected`).
        """
        order = await self._oms.submit_order(client_order_id)
        attempt = 0
        while True:
            attempt += 1
            try:
                report = await self._wait(self._broker.submit_order(order), timeout, "submit")
                break
            except BrokerError as exc:
                if (
                    exc.code is not ErrorCode.CONNECTION_LOST
                    or attempt >= self._submit_max_attempts
                ):
                    raise
                logger.warning(
                    "execution_submit_retry",
                    extra={
                        "client_order_id": str(client_order_id),
                        "attempt": attempt,
                    },
                )
        return await self._oms.on_execution_report(report)

    # -- cancellation ----------------------------------------------------------
    async def cancel(self, client_order_id: UUID, *, timeout: float = 10.0) -> Order:
        """Cancel an order.

        Unsent orders (NEW/PENDING_SUBMIT) are cancelled locally by the OMS.
        Working orders move to PENDING_CANCEL and a broker cancel is requested;
        the broker's CANCELLED report finalizes it.
        """
        order = self._oms.get_order(client_order_id)
        if order.is_terminal:
            raise OrderStateError(f"cannot cancel terminal order (status={order.status.value})")
        await self._oms.cancel_order(client_order_id)
        cur = self._oms.get_order(client_order_id)
        if cur.status is OrderStatus.CANCELLED:
            return cur  # never reached the broker
        report = await self._wait(self._broker.cancel_order(cur), timeout, "cancel")
        return await self._oms.on_execution_report(report)

    # -- modification ----------------------------------------------------------
    async def modify(
        self,
        client_order_id: UUID,
        *,
        limit_price: Price | None = None,
        stop_price: Price | None = None,
        timeout: float = 10.0,
    ) -> Order:
        """Modify a working order's prices and request broker confirmation."""
        order = self._oms.get_order(client_order_id)
        if order.is_terminal:
            raise OrderStateError(f"cannot modify terminal order (status={order.status.value})")
        await self._oms.modify_order(
            client_order_id, limit_price=limit_price, stop_price=stop_price
        )
        cur = self._oms.get_order(client_order_id)
        if cur.status in (OrderStatus.PENDING_SUBMIT, OrderStatus.PENDING_CANCEL):
            return cur  # not yet at the broker / already cancelling
        report = await self._wait(self._broker.modify_order(cur), timeout, "modify")
        return await self._oms.on_execution_report(report)

    # -- reconciliation --------------------------------------------------------
    async def reconcile(self) -> Sequence[Order]:
        """Re-sync outstanding (non-terminal) orders with the broker.

        Used after a broker reconnect (TS-006). For each open order the broker's
        current status is fetched and applied. Returns the orders that changed.
        """
        applied: list[Order] = []
        for order in self._oms.list_orders():
            if order.is_terminal:
                continue
            report = await self._broker.fetch_order_status(order)
            if report is not None:
                updated = await self._oms.on_execution_report(report)
                applied.append(updated)
        return applied

    # -- internals -------------------------------------------------------------
    async def _on_broker_report(self, report: ExecutionReport) -> None:
        await self._oms.on_execution_report(report)

    async def _wait(self, coro: Awaitable[T], timeout: float, operation: str) -> T:
        try:
            return await asyncio.wait_for(coro, timeout)
        except TimeoutError as exc:
            logger.warning("execution_timeout", extra={"operation": operation})
            raise BrokerError(
                f"{operation} timed out",
                code=ErrorCode.TIMEOUT,
            ) from exc
