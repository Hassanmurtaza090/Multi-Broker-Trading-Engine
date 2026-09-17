"""Order execution broker port.

This is the contract broker adapters (IBKR, Saxo) implement for order
execution. The Execution Engine (`backend/execution`) depends only on this
abstraction — never on a specific broker. A simulated broker (used by tests)
also implements this protocol.

Request/response calls (`submit_order`, `cancel_order`, `modify_order`,
`fetch_order_status`) return the initial `ExecutionReport` (ack or reject).
Subsequent asynchronous reports (partial/full fills, later cancels, expires)
are pushed to a handler installed via `attach_report_handler`.
"""

from __future__ import annotations

from typing import Protocol

from domain.fills import ExecutionReport
from domain.orders import Order


class ExecutionReportHandler(Protocol):
    """Async callback receiving asynchronously-pushed execution reports."""

    async def __call__(self, report: ExecutionReport) -> None: ...


class ExecutionBroker(Protocol):
    """Broker adapter contract for order execution.

    All methods are broker-agnostic at this layer: adapters translate between
    these and their SDK. `client_order_id` is the idempotency key that must be
    propagated to the broker for safe retry/reconciliation.
    """

    def attach_report_handler(self, handler: ExecutionReportHandler) -> None: ...

    async def submit_order(self, order: Order) -> ExecutionReport: ...

    async def cancel_order(self, order: Order) -> ExecutionReport: ...

    async def modify_order(self, order: Order) -> ExecutionReport: ...

    async def fetch_order_status(self, order: Order) -> ExecutionReport | None: ...
