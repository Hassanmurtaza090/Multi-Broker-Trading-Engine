"""OMS creation, validation, and idempotency/duplicate tests."""

from __future__ import annotations

import pytest

from domain.errors import DuplicateOrderError
from domain.orders import OrderStatus
from order_management import OrderManager
from tests.unit.order_management.conftest import make_request


class TestCreateOrder:
    def test_creates_new_order(self, manager, aapl, usd):
        order = manager.create_order(make_request(aapl, usd))
        assert order.status == OrderStatus.NEW
        assert order.filled_quantity.value == 0
        assert manager.get_order(order.client_order_id) == order

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
        first = manager.create_order(req)
        second = manager.create_order(make_request(aapl, usd, client_order_id=cid))
        assert second.client_order_id == first.client_order_id
        assert second is not None
        assert manager.list_orders() == [first]

    def test_idempotency_key_returns_same_order(self, manager, aapl, usd):
        req = make_request(aapl, usd, idempotency_key="KEY-1")
        first = manager.create_order(req)
        second = manager.create_order(make_request(aapl, usd, idempotency_key="KEY-1"))
        assert second.client_order_id == first.client_order_id
        assert len(manager.list_orders()) == 1

    def test_idempotency_key_collision_raises(self, manager, aapl, usd):
        from uuid import uuid4

        cid = uuid4()
        req = make_request(aapl, usd, idempotency_key="KEY-C")
        manager.create_order(req)
        # Same key, different client_order_id -> conflict.
        with pytest.raises(DuplicateOrderError):
            manager.create_order(make_request(aapl, usd, idempotency_key="KEY-C", client_order_id=cid))

    def test_list_filters_by_account(self, manager, aapl, usd):
        manager.create_order(make_request(aapl, usd, idempotency_key="K1"))
        assert len(manager.list_orders(account_id="ACC-001")) == 1
        assert manager.list_orders(account_id="OTHER") == []