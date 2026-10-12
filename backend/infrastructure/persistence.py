"""PostgreSQL persistence (M15) — the infrastructure milestone's repository.

Implements the async M4 `OrderRepository` port (ADR-010/ADR-020) with
SQLAlchemy 2 async + asyncpg, exactly as the architecture documents:
the domain never imports the ORM; the repository is a port implementation.

Design:
- `orders` table: one row per order. Queryable columns (client_order_id PK,
  idempotency_key, account_id, status, created_at, updated_at) + a JSON
  `payload` holding the full serialized domain `Order` (the exact-decimal
  values travel as strings, per ADR-016). Pydantic round-trips the payload
  losslessly — the domain model remains the single source of truth.
- Upserts via INSERT ... ON CONFLICT DO UPDATE (no read-modify-write race).
- `bind_idempotency_key` mirrors the in-memory semantics (latest binding
  wins) by clearing the key from any other row first.
- Portfolio/auth state stays in memory BY DESIGN (ADR-013: portfolio is
  rebuildable from broker snapshots; sessions are short-lived — see the
  M15 ADR). No destructive migrations: `create_all` only adds tables.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    JSON,
    DateTime,
    String,
    delete,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from domain.errors import BrokerError, ErrorCode
from domain.orders import Order

logger = logging.getLogger("mtbe.infrastructure")


class Base(DeclarativeBase):
    pass


class OrderRow(Base):
    __tablename__ = "orders"

    client_order_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    idempotency_key: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True, index=True
    )
    account_id: Mapped[str] = mapped_column(String(128), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    payload: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PostgresOrderRepository:
    """Async `OrderRepository` backed by PostgreSQL (ADR-010/020)."""

    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine
        self._sessions = async_sessionmaker(engine, expire_on_commit=False)

    # -- lifecycle ---------------------------------------------------------------

    async def initialize(self) -> None:
        """Create tables if absent (create-only; no destructive migrations)."""
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("persistence_ready", extra={"operation": "persistence.init"})

    async def close(self) -> None:
        await self._engine.dispose()

    async def ping(self) -> bool:
        """Connectively check for health endpoints/readiness gates.

        Bounded (M15 review finding): an unreachable/paused database must
        produce a fast negative answer — an unbounded connect would hang
        the readiness probe and every healthcheck relying on it.
        """
        import asyncio

        try:
            async with asyncio.timeout(2):
                async with self._engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))
            return True
        except (DBAPIError, TimeoutError, OSError):
            return False

    # -- OrderRepository port ------------------------------------------------------

    async def save(self, order: Order) -> None:
        payload = order.model_dump(mode="json")
        async with self._sessions() as session:
            async with session.begin():
                stmt = pg_insert(OrderRow).values(
                    client_order_id=str(order.client_order_id),
                    idempotency_key=None,  # never clobber the binding on upsert
                    account_id=order.account_id,
                    status=order.status.value,
                    payload=payload,
                    created_at=_utc(order.created_at),
                    updated_at=_utc(order.updated_at),
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=[OrderRow.client_order_id],
                    set_={
                        "status": stmt.excluded.status,
                        "payload": stmt.excluded.payload,
                        "updated_at": stmt.excluded.updated_at,
                    },
                )
                await session.execute(stmt)

    async def get(self, client_order_id: UUID) -> Order | None:
        async with self._sessions() as session:
            row = await session.scalar(
                select(OrderRow).where(OrderRow.client_order_id == str(client_order_id))
            )
        return _to_order(row)

    async def get_by_idempotency_key(self, key: str) -> Order | None:
        async with self._sessions() as session:
            row = await session.scalar(select(OrderRow).where(OrderRow.idempotency_key == key))
        return _to_order(row)

    async def bind_idempotency_key(self, key: str, client_order_id: UUID) -> None:
        """Latest binding wins (mirrors in-memory semantics): clear the key
        from any other row, then bind it to this order."""
        cid = str(client_order_id)
        async with self._sessions() as session:
            async with session.begin():
                await session.execute(
                    update(OrderRow)
                    .where(OrderRow.idempotency_key == key)
                    .where(OrderRow.client_order_id != cid)
                    .values(idempotency_key=None)
                )
                await session.execute(
                    update(OrderRow)
                    .where(OrderRow.client_order_id == cid)
                    .values(idempotency_key=key)
                )

    async def list(self, account_id: str | None = None) -> list[Order]:
        async with self._sessions() as session:
            stmt = select(OrderRow).order_by(OrderRow.created_at)
            if account_id is not None:
                stmt = stmt.where(OrderRow.account_id == account_id)
            rows = (await session.scalars(stmt)).all()
        return [order for row in rows if (order := _to_order(row)) is not None]

    async def delete(self, client_order_id: UUID) -> None:
        async with self._sessions() as session:
            async with session.begin():
                await session.execute(
                    delete(OrderRow).where(OrderRow.client_order_id == str(client_order_id))
                )

    def __len__(self) -> int:
        # Protocol convenience only (never used on the hot path).
        raise NotImplementedError("len() is not supported on the DB repository")


def _to_order(row: OrderRow | None) -> Order | None:
    if row is None:
        return None
    try:
        return Order.model_validate(row.payload)
    except Exception as exc:  # noqa: BLE001 — corrupt payload must not crash reads
        logger.error(
            "persistence_payload_rejected",
            extra={"operation": "persistence.read"},
        )
        raise BrokerError(
            "stored order payload is invalid",
            code=ErrorCode.UNAVAILABLE,
        ) from exc


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def create_order_repository(
    database_url: str, *, poolclass: type | None = None
) -> PostgresOrderRepository:
    """Build the repository from a SQLAlchemy async URL (env-driven).

    `poolclass` lets tests use `NullPool` (fresh connection per operation —
    loop-safe under per-call `asyncio.run`, at the cost of latency that is
    irrelevant in tests). Production keeps the default pool: the engine
    runs on one loop for the process lifetime.
    """
    engine = create_async_engine(database_url, pool_pre_ping=True, poolclass=poolclass)
    return PostgresOrderRepository(engine)
