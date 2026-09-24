"""Order Management System (OMS) — order lifecycle, state, and event publication.

The OMS is the broker-independent authority on order lifecycle. It:

- creates and validates orders (idempotent / duplicate-protected);
- drives state transitions using the M1 `Order` state machine;
- applies broker `ExecutionReport`s (fills, rejects, cancels, expires) only when
  confirmed — it never assumes an execution occurred without a report;
- publishes typed events on the M2 event bus;
- persists via the `OrderRepository` port (no storage dependency).

It does **not** route orders to a broker (that is M5, the Execution Engine) and
contains no broker-specific logic.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from uuid import UUID

from domain.errors import (
    DuplicateOrderError,
    InvalidArgumentError,
    OrderNotFoundError,
    OrderStateError,
)
from domain.fills import ExecutionReport, ExecutionReportType
from domain.money import Price
from domain.orders import Order, OrderRequest, OrderStatus
from events import (
    EventBus,
    OrderAccepted,
    OrderCancelled,
    OrderExpired,
    OrderFilled,
    OrderModified,
    OrderPartiallyFilled,
    OrderRejected,
    OrderSubmitted,
)
from order_management.repository import OrderRepository

logger = logging.getLogger("mtbe.oms")

# Report types that carry a fill.
_FILL_REPORT_TYPES = frozenset({ExecutionReportType.PARTIAL_FILL, ExecutionReportType.FILL})


class OrderManager:
    """Central order lifecycle manager."""

    def __init__(self, repository: OrderRepository, bus: EventBus) -> None:
        self._repo = repository
        self._bus = bus
        # Already-applied execution report ids (duplicate-report protection).
        self._seen_reports: set[str] = set()

    # -- creation --------------------------------------------------------------
    def create_order(self, request: OrderRequest) -> Order:
        """Create and persist a NEW order (idempotent, duplicate-protected).

        Repeating a request with the same `client_order_id` or `idempotency_key`
        returns the already-created order instead of creating a duplicate.
        """
        if request.idempotency_key is not None:
            existing = self._repo.get_by_idempotency_key(request.idempotency_key)
            if existing is not None:
                if (
                    request.client_order_id is None
                    or existing.client_order_id == request.client_order_id
                ):
                    return existing
                raise DuplicateOrderError("idempotency_key already used for a different order")
        if request.client_order_id is not None:
            existing = self._repo.get(request.client_order_id)
            if existing is not None:
                return existing

        order = request.to_order()
        if self._repo.get(order.client_order_id) is not None:
            raise DuplicateOrderError("order with this client_order_id already exists")
        self._repo.save(order)
        if request.idempotency_key is not None:
            self._repo.bind_idempotency_key(request.idempotency_key, order.client_order_id)
        logger.info(
            "oms_order_created",
            extra={"client_order_id": str(order.client_order_id), "account": order.account_id},
        )
        return order

    # -- submission ------------------------------------------------------------
    async def submit_order(self, client_order_id: UUID) -> Order:
        """Queue a NEW order for submission (NEW -> PENDING_SUBMIT).

        Publishes `OrderSubmitted`. Broker acknowledgment arrives later via an
        `ExecutionReport` (SUBMITTED/ACCEPTED -> `OrderAccepted`).
        """
        order = self._require(client_order_id)
        submitted = self._transition(lambda o: o.mark_pending_submit(), order)
        self._repo.save(submitted)
        await self._bus.publish(OrderSubmitted(order=submitted), source="oms")
        return submitted

    # -- execution reports -----------------------------------------------------
    async def on_execution_report(self, report: ExecutionReport) -> Order:
        """Apply a confirmed broker report and publish the corresponding event.

        Duplicate reports (same `report_id`) are ignored idempotently. No state
        transition is implied unless the report confirms it.
        """
        if report.report_id in self._seen_reports:
            return self._require(report.order_client_id)
        self._seen_reports.add(report.report_id)

        order = self._require(report.order_client_id)
        order = self._apply_report(order, report)
        self._repo.save(order)
        await self._publish_for_report(order, report)
        return order

    # -- cancellation ----------------------------------------------------------
    async def cancel_order(self, client_order_id: UUID) -> Order:
        """Request cancellation of an order.

        - NEW/PENDING_SUBMIT: cancelled immediately (never reached a broker);
          publishes `OrderCancelled`.
        - SUBMITTED/PARTIALLY_FILLED: moved to PENDING_CANCEL (no event; final
          cancellation arrives via a CANCELLED `ExecutionReport`).
        - terminal/pending-cancel: rejected as an invalid transition.
        """
        order = self._require(client_order_id)
        if order.status in (OrderStatus.NEW, OrderStatus.PENDING_SUBMIT):
            cancelled = self._transition(lambda o: o.mark_cancelled(), order)
            self._repo.save(cancelled)
            await self._bus.publish(OrderCancelled(order=cancelled), source="oms")
            return cancelled
        if order.status in (OrderStatus.SUBMITTED, OrderStatus.PARTIALLY_FILLED):
            pending = self._transition(lambda o: o.mark_pending_cancel(), order)
            self._repo.save(pending)
            return pending
        raise OrderStateError(
            f"cannot cancel order in state {order.status.value}",
            detail="invalid cancellation transition",
        )

    # -- modification ----------------------------------------------------------
    async def modify_order(
        self,
        client_order_id: UUID,
        *,
        limit_price: Price | None = None,
        stop_price: Price | None = None,
    ) -> Order:
        """Update a working order's price terms (local reflection, pending ack).

        Produces a new immutable `Order` with the new prices; publishes
        `OrderModified`. Broker confirmation of the replace is handled by M5.
        """
        order = self._require(client_order_id)
        if order.is_terminal or order.status in (
            OrderStatus.PENDING_SUBMIT,
            OrderStatus.PENDING_CANCEL,
        ):
            raise OrderStateError(
                f"cannot modify order in state {order.status.value}",
                detail="invalid modification transition",
            )
        new_order = Order.model_validate(
            {
                **order.model_dump(),
                "limit_price": limit_price if limit_price is not None else order.limit_price,
                "stop_price": stop_price if stop_price is not None else order.stop_price,
            }
        )
        self._repo.save(new_order)
        await self._bus.publish(OrderModified(order=new_order), source="oms")
        return new_order

    # -- queries ---------------------------------------------------------------
    def get_order(self, client_order_id: UUID) -> Order:
        return self._require(client_order_id)

    def get_by_idempotency_key(self, key: str) -> Order | None:
        """Idempotent-replay lookup (TS-004): the order bound to `key`, if any."""
        return self._repo.get_by_idempotency_key(key)

    def list_orders(self, account_id: str | None = None) -> list[Order]:
        return self._repo.list(account_id)

    # -- internals -------------------------------------------------------------
    def _require(self, client_order_id: UUID) -> Order:
        order = self._repo.get(client_order_id)
        if order is None:
            raise OrderNotFoundError(f"order {client_order_id} not found")
        return order

    def _transition(self, fn: Callable[[Order], Order], order: Order) -> Order:
        try:
            return fn(order)
        except ValueError as exc:
            raise OrderStateError(str(exc), detail="invalid order state transition") from exc

    def _apply_report(self, order: Order, report: ExecutionReport) -> Order:
        rt = report.report_type
        try:
            if rt in (ExecutionReportType.SUBMITTED, ExecutionReportType.ACCEPTED):
                return order.mark_submitted(report.broker_order_id)
            if rt is ExecutionReportType.REJECTED:
                return order.mark_rejected(report.rejection_reason)
            if rt is ExecutionReportType.CANCELLED:
                return order.mark_cancelled()
            if rt is ExecutionReportType.PENDING_CANCEL:
                return order.mark_pending_cancel()
            if rt is ExecutionReportType.EXPIRED:
                return order.mark_expired()
            if rt in _FILL_REPORT_TYPES:
                return self._apply_fill(order, report)
            if rt is ExecutionReportType.REPLACED:
                # Modification already reflected locally; ack is a no-op.
                return order
        except ValueError as exc:
            raise OrderStateError(
                str(exc), detail="execution report rejected the transition"
            ) from exc
        raise InvalidArgumentError(f"unhandled execution report type: {rt.value}")

    def _apply_fill(self, order: Order, report: ExecutionReport) -> Order:
        if report.fill is None:
            raise InvalidArgumentError("fill report is missing a fill")
        new_total = order.filled_quantity + report.fill.quantity
        if new_total > order.quantity:
            raise OrderStateError(
                "fill exceeds remaining order quantity",
                detail="cannot overfill the order",
            )
        order = order.apply_fill_quantity(new_total)
        if report.report_type is ExecutionReportType.PARTIAL_FILL:
            if new_total == order.quantity:
                # A partial report that completes the order -> filled.
                return order.mark_filled()
            return order.mark_partially_filled()
        # FILL must complete the order.
        if new_total != order.quantity:
            raise OrderStateError(
                "FILL report does not complete the order",
                detail="filled quantity must equal order quantity",
            )
        return order.mark_filled()

    async def _publish_for_report(self, order: Order, report: ExecutionReport) -> None:
        rt = report.report_type
        if rt in (ExecutionReportType.SUBMITTED, ExecutionReportType.ACCEPTED):
            await self._bus.publish(OrderAccepted(order=order), source="oms")
        elif rt is ExecutionReportType.REJECTED:
            await self._bus.publish(
                OrderRejected(order=order, reason=report.rejection_reason or ""),
                source="oms",
            )
        elif rt is ExecutionReportType.CANCELLED:
            await self._bus.publish(OrderCancelled(order=order), source="oms")
        elif rt in _FILL_REPORT_TYPES:
            fill = report.fill
            if fill is None:
                return
            if rt is ExecutionReportType.PARTIAL_FILL:
                await self._bus.publish(OrderPartiallyFilled(order=order, fill=fill), source="oms")
            else:
                await self._bus.publish(OrderFilled(order=order, fill=fill), source="oms")
        elif rt is ExecutionReportType.EXPIRED:
            await self._bus.publish(OrderExpired(order=order), source="oms")
        # PENDING_CANCEL and REPLACED emit no dedicated event here (PENDING_CANCEL
        # has no M2 event; REPLACED was already published by modify_order).
