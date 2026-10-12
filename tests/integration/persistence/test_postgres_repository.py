"""M15 integration tests — PostgreSQL OrderRepository (ADR-010/020).

Runs against a REAL PostgreSQL instance when `TEST_DATABASE_URL` is set
(SQLAlchemy async URL, e.g. postgresql+asyncpg://...). Skipped otherwise —
CI runs the in-memory suites; the DB-backed tests run where a database
exists (deployment validation, M15).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from uuid import uuid4

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL not set — PostgreSQL-backed tests run only "
    "against a provisioned database (M15 deployment validation)",
)


def run(coro):
    import asyncio

    return asyncio.run(coro)


@pytest.fixture()
def repository():
    from sqlalchemy.pool import NullPool

    from infrastructure.persistence import create_order_repository

    # NullPool: fresh connection per operation — safe across the multiple
    # event loops that per-test asyncio.run() creates (loop-bound pooled
    # connections are a production concern, where the process runs on ONE
    # loop for its lifetime).
    repo = create_order_repository(TEST_DATABASE_URL, poolclass=NullPool)
    run(repo.initialize())
    yield repo
    # Isolation: drop all rows between tests (never the schema itself).
    run(_clear(repo))
    run(repo.close())


async def _clear(repo) -> None:
    from sqlalchemy import delete

    from infrastructure.persistence import OrderRow

    async with repo._sessions() as session:  # noqa: SLF001 — test seam
        async with session.begin():
            await session.execute(delete(OrderRow))


@pytest.fixture()
def usd():
    from domain.money import Currency

    return Currency(code="USD")


@pytest.fixture()
def aapl(usd):
    from domain.instrument import AssetClass, Exchange, Instrument

    return Instrument(
        symbol="AAPL",
        asset_class=AssetClass.EQUITY,
        currency=usd,
        exchange=Exchange.NASDAQ,
    )


def _new_order(request):
    """Construct a fresh domain Order from a request exactly like the OMS
    (M4 create_order's domain construction), for direct repository tests."""
    from domain.orders import Order, OrderStatus

    return Order(
        account_id=request.account_id,
        instrument=request.instrument,
        side=request.side,
        order_type=request.order_type,
        quantity=request.quantity,
        time_in_force=request.time_in_force,
        limit_price=request.limit_price,
        stop_price=request.stop_price,
        status=OrderStatus.NEW,
    )



def make_request(aapl, usd, *, idempotency_key=None):
    from decimal import Decimal

    from domain.money import Price, Quantity
    from domain.orders import OrderRequest, OrderSide, OrderType

    return OrderRequest(
        account_id="ACC-001",
        instrument=aapl,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value=Decimal("10.00000001")),  # exact decimal round-trip
        limit_price=Price(value=Decimal("150.25"), currency=usd),
        idempotency_key=idempotency_key,
    )


class TestPostgresOrderRepository:
    def test_save_get_round_trip_preserves_exact_decimals(self, repository, aapl, usd):
        order = _new_order(make_request(aapl, usd))
        run(repository.save(order))

        loaded = run(repository.get(order.client_order_id))
        assert loaded is not None
        assert loaded == order  # pydantic equality: full domain round-trip
        assert str(loaded.quantity.value) == "10.00000001"
        assert str(loaded.limit_price.value) == "150.25"
        assert loaded.status is order.status

    def test_idempotency_binding_and_replay_lookup(self, repository, aapl, usd):
        order = _new_order(make_request(aapl, usd, idempotency_key="K-DB-1"))
        run(repository.save(order))
        run(repository.bind_idempotency_key("K-DB-1", order.client_order_id))

        replay = run(repository.get_by_idempotency_key("K-DB-1"))
        assert replay == order
        assert run(repository.get_by_idempotency_key("missing")) is None

    def test_latest_binding_wins_no_duplicate_keys(self, repository, aapl, usd):
        from domain.orders import Order

        first = _new_order(make_request(aapl, usd))
        second = _new_order(make_request(aapl, usd))
        run(repository.save(first))
        run(repository.save(second))
        run(repository.bind_idempotency_key("K-SHARED", first.client_order_id))
        run(repository.bind_idempotency_key("K-SHARED", second.client_order_id))

        assert run(repository.get_by_idempotency_key("K-SHARED")) == second

    def test_upsert_updates_status_without_clobbering_key(self, repository, aapl, usd):
        from domain.orders import OrderStatus

        order = _new_order(make_request(aapl, usd, idempotency_key="K-UP-1"))
        run(repository.save(order))
        run(repository.bind_idempotency_key("K-UP-1", order.client_order_id))

        submitted = run(  # simulate the lifecycle transition
            _transition_and_reload(repository, order)
        )
        assert submitted.status is OrderStatus.SUBMITTED

        replay = run(repository.get_by_idempotency_key("K-UP-1"))
        assert replay is not None and replay.status is OrderStatus.SUBMITTED

    def test_account_filtered_listing_and_delete(self, repository, aapl, usd):
        one = _new_order(make_request(aapl, usd))
        other = _new_order(make_request(aapl, usd))
        # Hand-build a second-account order via model_copy on the request.
        two_req = make_request(aapl, usd).model_copy(
            update={"account_id": "ACC-OTHER"}
        )
        two = _new_order(two_req)
        for order in (one, other, two):
            run(repository.save(order))

        listed = run(repository.list("ACC-001"))
        assert {o.client_order_id for o in listed} == {one.client_order_id, other.client_order_id}
        assert len(run(repository.list(None))) == 3

        run(repository.delete(one.client_order_id))
        assert run(repository.get(one.client_order_id)) is None
        assert len(run(repository.list("ACC-001"))) == 1

    def test_ping_reports_connectivity(self, repository):
        assert run(repository.ping()) is True

    def test_restart_simulation_orders_survive(self, repository, aapl, usd):
        """The M15 recovery property: a NEW repository instance over the
        same database sees the persisted orders (backend restart recovery).
        """
        from infrastructure.persistence import create_order_repository

        order = _new_order(make_request(aapl, usd, idempotency_key="K-RESTART"))
        run(repository.save(order))
        run(repository.bind_idempotency_key("K-RESTART", order.client_order_id))

        from sqlalchemy.pool import NullPool

        fresh = create_order_repository(
            TEST_DATABASE_URL, poolclass=NullPool
        )
        try:
            assert run(fresh.get(order.client_order_id)) == order
            assert (
                run(fresh.get_by_idempotency_key("K-RESTART")) == order
            )
        finally:
            run(fresh.close())

    def test_oms_full_lifecycle_on_postgres(self, repository, aapl, usd):
        """The OMS drives the DB-backed repository through a complete order
        lifecycle — proving the port implementation composes (M4 contract
        over real persistence)."""
        from events import InProcessEventBus
        from order_management import OrderManager

        bus = InProcessEventBus()
        oms = OrderManager(repository, bus)
        order = run(oms.create_order(make_request(aapl, usd, idempotency_key="K-OMS")))
        run(oms.submit_order(order.client_order_id))
        current = run(oms.get_order(order.client_order_id))
        assert current.status.value == "PENDING_SUBMIT"

        # Broker acceptance arrives as an execution report (M4 contract).
        run(oms.on_execution_report(_report(current, "ACCEPTED", broker_order_id="B-DB")))

        current = run(oms.get_order(order.client_order_id))
        assert current.status.value == "SUBMITTED"
        assert current.broker_order_id == "B-DB"

        # Idempotent replay reads through the DB binding.
        replay = run(oms.get_by_idempotency_key("K-OMS"))
        assert replay.client_order_id == order.client_order_id

        listed = run(oms.list_orders("ACC-001"))
        assert len(listed) == 1

        run(oms.cancel_order(order.client_order_id))
        # Broker cancellation confirms via report (M4 contract).
        current = run(oms.get_order(order.client_order_id))
        assert current.status.value == "PENDING_CANCEL"
        run(oms.on_execution_report(_report(current, "CANCELLED", broker_order_id="B-DB")))
        assert run(oms.get_order(order.client_order_id)).status.value == "CANCELLED"


async def _transition_and_reload(repository, order):
    submitted = order.mark_submitted(broker_order_id="B-1")
    await repository.save(submitted)
    return submitted



def _report(order, report_type, *, broker_order_id=None):
    from domain.fills import ExecutionReport, ExecutionReportType

    return ExecutionReport(
        report_id=f"R-{uuid4()}",
        order_client_id=order.client_order_id,
        broker_order_id=broker_order_id,
        account_id=order.account_id,
        report_type=ExecutionReportType(report_type),
    )
