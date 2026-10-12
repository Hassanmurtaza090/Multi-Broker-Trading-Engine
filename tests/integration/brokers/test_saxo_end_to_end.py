"""End-to-end: Saxo adapter wired into the full engine (M3/M4/M5/M7)."""

from __future__ import annotations

import asyncio
from decimal import Decimal

from domain.fills import ExecutionReportType
from domain.orders import OrderSide, OrderStatus, OrderType
from domain.money import Price, Quantity
from events import BalanceUpdated, BrokerConnected, MarketQuoteUpdated, OrderFilled, PositionOpened
from execution import ExecutionEngine
from market_data import MarketDataEngine
from order_management import InMemoryOrderRepository, OrderManager
from portfolio import PortfolioService
from brokers.saxo import SaxoAdapter, SimulatedSaxoClient
from tests.unit.brokers.conftest import (
    SAXO_AAPL_UIC,
    make_saxo_execution,
    make_saxo_quote,
    saxo_aapl,
    saxo_balance_usd,
    saxo_position_aapl,
)


def run(coro):
    return asyncio.run(coro)


def make_request(instrument, usd, *, quantity="10", limit_price="100", side=OrderSide.BUY):
    from domain.orders import OrderRequest

    return OrderRequest(
        account_id="ACC-001",
        instrument=instrument,
        side=side,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value=quantity),
        limit_price=Price(value=limit_price, currency=usd),
    )


class TestSaxoEndToEnd:
    def test_full_stack_on_one_bus(self, saxo_client, bus, usd):
        # The adapter serves the INTERNAL account "ACC-001": broker-reported
        # data (labeled "SAXO-ACC" at Saxo) is relabeled by the adapter.
        adapter = SaxoAdapter(saxo_client, bus=bus, account_id="ACC-001", auto_drain=False)
        market = MarketDataEngine(adapter, bus)
        oms = OrderManager(InMemoryOrderRepository(), bus)
        executor = ExecutionEngine(adapter, oms)
        portfolio = PortfolioService(bus=bus)
        aapl = saxo_aapl(usd)

        connected, quotes, balances, positions, fills = [], [], [], [], []
        bus.subscribe("broker.connected", lambda env: connected.append(env.payload))
        bus.subscribe("market.quote.updated", lambda env: quotes.append(env.payload))
        bus.subscribe("balance.updated", lambda env: balances.append(env.payload))
        bus.subscribe("position.opened", lambda env: positions.append(env.payload))
        bus.subscribe("order.filled", lambda env: fills.append(env.payload))

        # 1. Connect (M3 engine start drives the feed -> adapter authorizes).
        run(market.start())
        run(adapter.drain())
        assert adapter.is_connected
        assert len(connected) == 1 and isinstance(connected[0], BrokerConnected)
        assert connected[0].broker == "SAXO"

        # 2. Market data: subscribe -> Saxo tick -> quote event on the bus.
        run(market.subscribe(aapl))
        assert len(saxo_client.subscriptions) == 1
        saxo_client.emit_quote(make_saxo_quote())
        run(adapter.drain())
        assert len(quotes) == 1
        assert quotes[0].quote.last is not None

        # 3. Account data: Saxo balance snapshot -> balance event -> portfolio.
        saxo_client.balances = [saxo_balance_usd()]
        saxo_client.request_account_summary()
        run(adapter.drain())
        assert balances and isinstance(balances[0], BalanceUpdated)
        balance = portfolio.balance("ACC-001")
        assert balance is not None
        assert balance.cash["USD"].total.amount == Decimal("10000")

        # 4. Order: submit through M5 -> Saxo ack -> OMS SUBMITTED.
        order = run(oms.create_order(make_request(aapl, usd, quantity="10")))
        run(executor.submit(order.client_order_id))
        cur = run(oms.get_order(order.client_order_id))
        assert cur.status == OrderStatus.SUBMITTED
        assert cur.broker_order_id is not None

        # 5. Fill: Saxo execution -> report -> OMS FILLED -> portfolio position.
        saxo_order_id = int(cur.broker_order_id)
        saxo_client.emit_execution(
            make_saxo_execution(saxo_order_id, cur, execution_id="SE-1", quantity="10", cum="10")
        )
        run(adapter.drain())
        assert run(oms.get_order(order.client_order_id)).status == OrderStatus.FILLED
        assert len(fills) == 1 and isinstance(fills[0], OrderFilled)
        pos = portfolio.position("ACC-001", aapl)
        assert pos is not None and pos.quantity.value == Decimal("10")
        assert len(positions) == 1 and isinstance(positions[0], PositionOpened)

        # 6. Broker-reported positions feed the M7 reconciliation boundary
        #    (application layer wires adapter.snapshot -> portfolio). The
        #    broker reports 100 — deliberately different from the fill-derived
        #    10 — demonstrating broker-authoritative reconciliation.
        saxo_client.positions = [saxo_position_aapl()]
        saxo_client.request_positions()
        portfolio.apply_broker_snapshot("ACC-001", adapter.position_snapshot())
        assert portfolio.position("ACC-001", aapl).quantity.value == Decimal("100")

        run(market.stop())
        run(adapter.drain())

    def test_token_expiry_recovers_mid_session(self, saxo_client, bus, usd):
        adapter = SaxoAdapter(saxo_client, bus=bus, account_id="ACC-001", auto_drain=False)
        market = MarketDataEngine(adapter, bus)
        oms = OrderManager(InMemoryOrderRepository(), bus)
        executor = ExecutionEngine(adapter, oms)
        aapl = saxo_aapl(usd)

        run(market.start())
        run(adapter.drain())

        # Token expires mid-session; Saxo notifies; the adapter refreshes and
        # the session keeps working without any visible disconnect.
        disconnected = []
        bus.subscribe("broker.disconnected", lambda env: disconnected.append(env.payload))
        saxo_client.expire_session()
        run(market.subscribe(aapl))
        assert len(saxo_client.subscriptions) == 1

        order = run(oms.create_order(make_request(aapl, usd)))
        run(executor.submit(order.client_order_id))
        assert run(oms.get_order(order.client_order_id)).status == OrderStatus.SUBMITTED
        assert disconnected == []  # no disconnect: transparent refresh
        run(market.stop())

    def test_reconnect_recovers_broker_side_cancel(self, saxo_client, bus, usd):
        adapter = SaxoAdapter(saxo_client, bus=bus, account_id="ACC-001", auto_drain=False)
        oms = OrderManager(InMemoryOrderRepository(), bus)
        executor = ExecutionEngine(adapter, oms)
        aapl = saxo_aapl(usd)

        run(adapter.start())
        order = run(oms.create_order(make_request(aapl, usd)))
        run(executor.submit(order.client_order_id))
        run(adapter.drain())
        cur = run(oms.get_order(order.client_order_id))
        assert cur.status == OrderStatus.SUBMITTED

        # Connection drops; the broker cancels the order while we are away.
        saxo_client.simulate_unexpected_disconnect()
        saxo_client.force_status(int(cur.broker_order_id), "Cancelled")

        # Reconnect: the status replay delivers CANCELLED -> OMS applies it.
        run(adapter.reconnect())
        run(adapter.drain())
        assert run(oms.get_order(order.client_order_id)).status == OrderStatus.CANCELLED
        # Reconcile finds nothing new (the adapter already delivered it).
        assert run(executor.reconcile()) == []
        run(adapter.stop())

    def test_reconcile_delivers_broker_side_expiry_without_replay(self, saxo_client, bus, usd):
        adapter = SaxoAdapter(saxo_client, bus=bus, account_id="ACC-001", auto_drain=False)
        oms = OrderManager(InMemoryOrderRepository(), bus)
        executor = ExecutionEngine(adapter, oms)
        aapl = saxo_aapl(usd)

        run(adapter.start())
        order = run(oms.create_order(make_request(aapl, usd)))
        run(executor.submit(order.client_order_id))
        run(adapter.drain())
        cur = run(oms.get_order(order.client_order_id))

        # Broker-side expiry with NO callback delivery; M5 reconcile polls.
        saxo_client.force_status(int(cur.broker_order_id), "Expired")
        updated = run(executor.reconcile())
        assert len(updated) == 1
        assert run(oms.get_order(order.client_order_id)).status == OrderStatus.EXPIRED
        # A second reconcile finds nothing new (idempotent).
        assert run(executor.reconcile()) == []
        run(adapter.stop())