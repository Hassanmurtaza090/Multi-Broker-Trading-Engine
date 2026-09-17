"""Unit tests for event types."""

from __future__ import annotations

import pytest

from events import (
    MarketQuoteUpdated,
    OrderSubmitted, OrderAccepted, OrderRejected, OrderCancelled,
    OrderPartiallyFilled, OrderFilled, OrderExpired,
    PositionOpened, PositionUpdated, PositionClosed,
    AccountUpdated, BalanceUpdated,
    BrokerConnected, BrokerDisconnected,
    RiskViolation,
)
from domain.money import Price, Quantity
from domain.orders import Order, OrderRequest, OrderSide, OrderStatus, OrderType
from domain.instrument import AssetClass, Exchange, Instrument
from domain.fills import Fill
from domain.account import Balance, CashBalance
from decimal import Decimal
from uuid import uuid4


class TestEventTypes:
    def test_all_events_have_unique_types(self):
        types = [
            MarketQuoteUpdated.__event_type__,
            OrderSubmitted.__event_type__, OrderAccepted.__event_type__,
            OrderRejected.__event_type__, OrderCancelled.__event_type__,
            OrderPartiallyFilled.__event_type__, OrderFilled.__event_type__,
            OrderExpired.__event_type__,
            PositionOpened.__event_type__, PositionUpdated.__event_type__,
            PositionClosed.__event_type__,
            AccountUpdated.__event_type__, BalanceUpdated.__event_type__,
            BrokerConnected.__event_type__, BrokerDisconnected.__event_type__,
            RiskViolation.__event_type__,
        ]
        assert len(types) == len(set(types))

    def test_event_version_defaults_to_1(self, usd, aapl):
        event = OrderFilled(
            order=Order(
                account_id="ACC-001",
                instrument=aapl,
                side=OrderSide.BUY,
                order_type=OrderType.LIMIT,
                quantity=Quantity(value="10"),
                limit_price=Price(value="100", currency=usd),
                status=OrderStatus.FILLED,
            ),
            fill=Fill(
                fill_id="F-1",
                order_client_id=uuid4(),
                account_id="ACC-001",
                instrument=aapl,
                side=OrderSide.BUY,
                quantity=Quantity(value="10"),
                price=Price(value="100", currency=usd),
            ),
        )
        assert event.event_version == 1

    def test_market_quote_updated(self, usd, aapl):
        from events import MarketQuoteUpdated
        from domain.market import MarketQuote
        quote = MarketQuote(instrument=aapl, bid=Price(value="99", currency=usd), ask=Price(value="101", currency=usd))
        event = MarketQuoteUpdated(quote=quote)
        assert event.quote == quote

    def test_order_rejected_carries_reason(self, usd, aapl):
        order = Order(
            account_id="ACC-001",
            instrument=aapl,
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=Quantity(value="10"),
            status=OrderStatus.REJECTED,
        )
        event = OrderRejected(order=order, reason="insufficient margin")
        assert event.reason == "insufficient margin"

    def test_risk_violation(self, usd, aapl):
        event = RiskViolation(
            account_id="ACC-001",
            instrument=aapl,
            rule="max_position",
            message="exceeds limit",
            order=None,
        )
        assert event.rule == "max_position"
        assert event.message == "exceeds limit"

    def test_broker_connected(self):
        event = BrokerConnected(broker="IBKR", account_id="ACC-001")
        assert event.broker == "IBKR"
        assert event.account_id == "ACC-001"