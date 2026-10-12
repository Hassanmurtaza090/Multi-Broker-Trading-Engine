"""Order persistence port + in-memory implementation.

The OMS depends on the `OrderRepository` protocol (a port), not on any storage.
The port is ASYNC (ADR-020, M15): repositories perform I/O (PostgreSQL), and
the OMS runs on the event loop — a synchronous port would block it. The
PostgreSQL implementation arrives with the infrastructure milestone; the
in-memory repository supports M4 and testing.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol
from uuid import UUID

from domain.orders import Order


class OrderRepository(Protocol):
    """Persists and retrieves orders and idempotency keys (async port)."""

    async def save(self, order: Order) -> None: ...

    async def get(self, client_order_id: UUID) -> Order | None: ...

    async def get_by_idempotency_key(self, key: str) -> Order | None: ...

    async def bind_idempotency_key(self, key: str, client_order_id: UUID) -> None: ...

    async def list(self, account_id: str | None = None) -> list[Order]: ...

    async def delete(self, client_order_id: UUID) -> None: ...


class InMemoryOrderRepository:
    """In-memory async `OrderRepository` (M4 / tests)."""

    def __init__(self) -> None:
        self._orders: dict[UUID, Order] = {}
        self._idempotency: dict[str, UUID] = {}

    async def save(self, order: Order) -> None:
        self._orders[order.client_order_id] = order

    async def get(self, client_order_id: UUID) -> Order | None:
        return self._orders.get(client_order_id)

    async def get_by_idempotency_key(self, key: str) -> Order | None:
        cid = self._idempotency.get(key)
        if cid is None:
            return None
        return self._orders.get(cid)

    async def bind_idempotency_key(self, key: str, client_order_id: UUID) -> None:
        """Associate an idempotency key with an order id (for dedup)."""
        self._idempotency[key] = client_order_id

    async def list(self, account_id: str | None = None) -> list[Order]:
        orders = list(self._orders.values())
        if account_id is not None:
            orders = [o for o in orders if o.account_id == account_id]
        return orders

    async def delete(self, client_order_id: UUID) -> None:
        order = self._orders.pop(client_order_id, None)
        if order is not None:
            for key, cid in list(self._idempotency.items()):
                if cid == client_order_id:
                    del self._idempotency[key]

    def __len__(self) -> int:
        return len(self._orders)

    @property
    def idempotency_keys(self) -> Iterable[str]:
        return self._idempotency.keys()
