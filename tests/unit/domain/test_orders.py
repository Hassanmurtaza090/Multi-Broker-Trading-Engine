"""Unit tests for the order model and lifecycle state machine."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

import pytest

from domain.instrument import Instrument
from domain.money import Price, Quantity
from domain.orders import (
    OPEN_STATUSES,
    TERMINAL_STATUSES,
    Order,
    OrderRequest,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)


def _limit_order(
    instrument: Instrument,
    account_id: str = "ACC-001",
    price: str = "100.00",
    quantity: str = "10",
) -> Order:
    return Order(
        account_id=account_id,
        instrument=instrument,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value=quantity),
        limit_price=Price(value=price, currency=instrument.currency),
    )


class TestOrderValidation:
    def test_new_order_defaults(self, aapl: Instrument) -> None:
        o = _limit_order(aapl)
        assert o.status == OrderStatus.NEW
        assert isinstance(o.client_order_id, UUID)
        assert o.is_open is True
        assert o.is_terminal is False

    def test_limit_requires_limit_price(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            Order(
                account_id="ACC-001",
                instrument=aapl,
                side=OrderSide.BUY,
                order_type=OrderType.LIMIT,
                quantity=Quantity(value="10"),
            )

    def test_stop_requires_stop_price(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            Order(
                account_id="ACC-001",
                instrument=aapl,
                side=OrderSide.BUY,
                order_type=OrderType.STOP,
                quantity=Quantity(value="10"),
            )

    def test_stop_limit_requires_both(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            Order(
                account_id="ACC-001",
                instrument=aapl,
                side=OrderSide.BUY,
                order_type=OrderType.STOP_LIMIT,
                quantity=Quantity(value="10"),
                limit_price=Price(value="100", currency=aapl.currency),
            )

    def test_market_must_not_have_prices(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            Order(
                account_id="ACC-001",
                instrument=aapl,
                side=OrderSide.BUY,
                order_type=OrderType.MARKET,
                quantity=Quantity(value="10"),
                limit_price=Price(value="100", currency=aapl.currency),
            )

    def test_zero_quantity_rejected(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            Order(
                account_id="ACC-001",
                instrument=aapl,
                side=OrderSide.BUY,
                order_type=OrderType.MARKET,
                quantity=Quantity(value="0"),
            )

    def test_negative_quantity_rejected(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            Order(
                account_id="ACC-001",
                instrument=aapl,
                side=OrderSide.BUY,
                order_type=OrderType.MARKET,
                quantity=Quantity(value="-10"),
            )

    def test_empty_account_rejected(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            Order(
                account_id="",
                instrument=aapl,
                side=OrderSide.BUY,
                order_type=OrderType.MARKET,
                quantity=Quantity(value="10"),
            )


class TestLifecycle:
    def test_market_valid_no_prices(self, aapl: Instrument) -> None:
        o = Order(
            account_id="ACC-001",
            instrument=aapl,
            side=OrderSide.SELL,
            order_type=OrderType.MARKET,
            quantity=Quantity(value="10"),
        )
        assert o.order_type == OrderType.MARKET

    def test_submit_then_fill(self, aapl: Instrument) -> None:
        o = _limit_order(aapl)
        sub = o.mark_submitted("BROKER-1")
        assert sub.status == OrderStatus.SUBMITTED
        assert sub.broker_order_id == "BROKER-1"
        assert o.status == OrderStatus.NEW  # original unchanged (immutability)

        partial = sub.mark_partially_filled()
        assert partial.status == OrderStatus.PARTIALLY_FILLED

        filled = partial.mark_filled()
        assert filled.status == OrderStatus.FILLED
        assert filled.is_terminal is True

    def test_reject_from_new(self, aapl: Instrument) -> None:
        o = _limit_order(aapl)
        rej = o.mark_rejected("risk limit")
        assert rej.status == OrderStatus.REJECTED
        assert rej.rejection_reason == "risk limit"

    def test_cancel_from_submitted(self, aapl: Instrument) -> None:
        o = _limit_order(aapl).mark_submitted()
        pending = o.mark_pending_cancel()
        assert pending.status == OrderStatus.PENDING_CANCEL
        cancelled = pending.mark_cancelled()
        assert cancelled.status == OrderStatus.CANCELLED

    def test_expire_transitions(self, aapl: Instrument) -> None:
        o = _limit_order(aapl)
        assert o.mark_expired().status == OrderStatus.EXPIRED

    def test_terminal_order_cannot_transition(self, aapl: Instrument) -> None:
        filled = _limit_order(aapl).mark_submitted().mark_filled()
        with pytest.raises(ValueError):
            filled.mark_cancelled()

    def test_invalid_transition_new_to_filled(self, aapl: Instrument) -> None:
        o = _limit_order(aapl)
        with pytest.raises(ValueError):
            o.mark_filled()  # cannot go NEW -> FILLED directly

    def test_immutability_of_transitions(self, aapl: Instrument) -> None:
        o = _limit_order(aapl)
        o.mark_submitted()
        assert o.status == OrderStatus.NEW


class TestStatusGroups:
    def test_terminal_statuses(self) -> None:
        assert OrderStatus.FILLED in TERMINAL_STATUSES
        assert OrderStatus.CANCELLED in TERMINAL_STATUSES
        assert OrderStatus.REJECTED in TERMINAL_STATUSES
        assert OrderStatus.EXPIRED in TERMINAL_STATUSES
        assert OrderStatus.SUBMITTED not in TERMINAL_STATUSES

    def test_open_statuses(self) -> None:
        assert OrderStatus.NEW in OPEN_STATUSES
        assert OrderStatus.SUBMITTED in OPEN_STATUSES
        assert OrderStatus.PARTIALLY_FILLED in OPEN_STATUSES
        assert OrderStatus.FILLED not in OPEN_STATUSES


class TestOrderRequest:
    def test_to_order_assigns_client_id(self, aapl: Instrument) -> None:
        req = OrderRequest(
            account_id="ACC-001",
            instrument=aapl,
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            quantity=Quantity(value="10"),
            limit_price=Price(value="100", currency=aapl.currency),
        )
        order = req.to_order()
        assert isinstance(order.client_order_id, UUID)
        assert order.status == OrderStatus.NEW

    def test_preserves_supplied_client_id(self, aapl: Instrument) -> None:
        cid = UUID("00000000-0000-0000-0000-000000000001")
        req = OrderRequest(
            account_id="ACC-001",
            instrument=aapl,
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=Quantity(value="10"),
            client_order_id=cid,
        )
        assert req.to_order().client_order_id == cid

    def test_quantity_must_be_positive(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            OrderRequest(
                account_id="ACC-001",
                instrument=aapl,
                side=OrderSide.BUY,
                order_type=OrderType.MARKET,
                quantity=Quantity(value="-10"),
            )

    def test_serialization_roundtrip(self, aapl: Instrument) -> None:
        req = OrderRequest(
            account_id="ACC-001",
            instrument=aapl,
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            quantity=Quantity(value="10"),
            limit_price=Price(value="100", currency=aapl.currency),
            idempotency_key="key-123",
        )
        data = req.model_dump(mode="json")
        restored = OrderRequest.model_validate(data)
        assert restored == req