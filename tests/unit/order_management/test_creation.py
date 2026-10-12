"""OMS creation, validation, and idempotency/duplicate tests."""

from __future__ import annotations

import pytest

from domain.errors import DuplicateOrderError
from domain.orders import OrderStatus
from order_management import OrderManager
from tests.unit.order_management.conftest import make_request


def run(coro):
    import asyncio
    return asyncio.run(coro)


class TestCreateOrder:
    def test_creates_new_order(self, manager, aapl, usd):
        order = run(manager.create_order(make_request(aapl, usd)))
        assert order.status == OrderStatus.NEW
        assert order.filled_quantity.value == 0
        assert run(manager.get_order(order.client_order_id)) == order

    def test_invalid_request_rejected(self, manager, aapl, usd):
        # MARKET order must not carry a limit price -> construction is rejected.
        from domain.orders import OrderRequest, OrderType
        from domain.money import Quantity, Price

        with pytest.raises(Exception):
            OrderRequest(
                account_id="ACC-001",
                instrument=aapl,
                side="BUY",
                order_type=OrderType.MARKET,
                quantity=Quantity(value="10"),
                limit_price=Price(value="100", currency=usd),
            )

    def test_duplicate_client_order_id_idempotent(self, manager, aapl, usd):
        from uuid import uuid4

        cid = uuid4()
        req = make_request(aapl, usd, client_order_id=cid)
        first = run(manager.create_order(req))
        second = run(manager.create_order(make_request(aapl, usd, client_order_id=cid)))
        assert second.client_order_id == first.client_order_id
        assert second is not None
        assert run(manager.list_orders()) == [first]

    def test_idempotency_key_returns_same_order(self, manager, aapl, usd):
        req = make_request(aapl, usd, idempotency_key="KEY-1")
        first = run(manager.create_order(req))
        second = run(manager.create_order(make_request(aapl, usd, idempotency_key="KEY-1")))
        assert second.client_order_id == first.client_order_id
        assert len(run(manager.list_orders())) == 1

    def test_idempotency_key_collision_raises(self, manager, aapl, usd):
        from uuid import uuid4

        cid = uuid4()
        req = make_request(aapl, usd, idempotency_key="KEY-C")
        run(manager.create_order(req))
        # Same key, different client_order_id -> conflict.
        with pytest.raises(DuplicateOrderError):
            run(manager.create_order(make_request(aapl, usd, idempotency_key="KEY-C", client_order_id=cid)))

    def test_list_filters_by_account(self, manager, aapl, usd):
        run(manager.create_order(make_request(aapl, usd, idempotency_key="K1")))
        assert len(run(manager.list_orders(account_id="ACC-001"))) == 1
        assert run(manager.list_orders(account_id="OTHER")) == []