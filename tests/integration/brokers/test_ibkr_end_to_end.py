"""End-to-end: IBKR adapter -> M3 engine / M5 execution / M7 portfolio."""

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
from brokers.ibkr import IbkrAdapter, SimulatedIbkrClient
from tests.unit.brokers.conftest import (
    account_values_usd,
    aapl_contract,
    make_execution,
    make_quote,
)


def run(coro):
    return asyncio.run(coro)


def make_request(aapl, usd, *, quantity="10", limit_price="100", side=OrderSide.BUY):
    from domain.orders import OrderRequest

    return OrderRequest(
        account_id="ACC-001",
        instrument=aapl,
        side=side,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value=quantity),
        limit_price=Price(value=limit_price, currency=usd),
    )


class TestIbkrEndToEnd:
    def test_full_stack_on_one_bus(self, client, bus, aapl, usd):
        # The adapter serves the INTERNAL account "ACC-001": broker-reported
        # data (labeled "DU123456" at IBKR) is relabeled by the adapter.
        adapter = IbkrAdapter(client, bus=bus, account_id="ACC-001", auto_drain=False)
        market = MarketDataEngine(adapter, bus)
        oms = OrderManager(InMemoryOrderRepository(), bus)
        executor = ExecutionEngine(adapter, oms)
        portfolio = PortfolioService(bus=bus)

        connected, quotes, balances, positions, fills = [], [], [], [], []
        bus.subscribe("broker.connected", lambda env: connected.append(env.payload))
        bus.subscribe("market.quote.updated", lambda env: quotes.append(env.payload))
        bus.subscribe("balance.updated", lambda env: balances.append(env.payload))
        bus.subscribe("position.opened", lambda env: positions.append(env.payload))
        bus.subscribe("order.filled", lambda env: fills.append(env.payload))

        # 1. Connect (M3 engine start drives the feed -> adapter connects).
        run(market.start())
        run(adapter.drain())
        assert adapter.is_connected
        assert len(connected) == 1 and isinstance(connected[0], BrokerConnected)

        # 2. Market data: subscribe -> IBKR tick -> quote event on the bus.
        run(market.subscribe(aapl))
        assert len(client.subscriptions) == 1
        client.emit_quote(make_quote(aapl_contract()))
        run(adapter.drain())
        assert len(quotes) == 1
        assert quotes[0].quote.last is not None

        # 3. Account data: IBKR account values -> balance event -> portfolio.
        client.account_values = account_values_usd()
        client.request_account_summary()
        run(adapter.drain())
        assert balances and isinstance(balances[0], BalanceUpdated)
        balance = portfolio.balance("ACC-001")
        assert balance is not None
        assert balance.cash["USD"].total.amount == Decimal("10000")

        # 4. Order: submit through M5 -> IBKR ack -> OMS SUBMITTED.
        order = run(oms.create_order(make_request(aapl, usd, quantity="10")))
        run(executor.submit(order.client_order_id))
        cur = run(oms.get_order(order.client_order_id))
        assert cur.status == OrderStatus.SUBMITTED
        assert cur.broker_order_id is not None

        # 5. Fill: IBKR execution -> report -> OMS FILLED -> portfolio position.
        ibkr_order_id = int(cur.broker_order_id)
        client.emit_execution(
            make_execution(ibkr_order_id, cur, execution_id="E-1", quantity="10", cum="10")
        )
        run(adapter.drain())
        assert run(oms.get_order(order.client_order_id)).status == OrderStatus.FILLED
        assert len(fills) == 1 and isinstance(fills[0], OrderFilled)
        pos = portfolio.position("ACC-001", aapl)
        assert pos is not None and pos.quantity.value == Decimal("10")
        assert len(positions) == 1 and isinstance(positions[0], PositionOpened)

        # 6. Broker-reported positions feed the M7 reconciliation boundary
        #    (application layer wires adapter.snapshot -> portfolio).
        from brokers.ibkr.contracts import IbkrPosition

        client.positions = [
            IbkrPosition(account="DU123456", contract=aapl_contract(), position="10", avg_cost="100")
        ]
        client.request_positions()
        portfolio.apply_broker_snapshot("ACC-001", adapter.position_snapshot())
        assert portfolio.position("ACC-001", aapl).quantity.value == Decimal("10")

        run(market.stop())
        run(adapter.drain())

    def test_reconnect_recovers_broker_side_cancel(self, client, bus, aapl, usd):
        adapter = IbkrAdapter(client, bus=bus, account_id="DU123456", auto_drain=False)
        oms = OrderManager(InMemoryOrderRepository(), bus)
        executor = ExecutionEngine(adapter, oms)

        run(adapter.start())
        order = run(oms.create_order(make_request(aapl, usd, quantity="10")))
        run(executor.submit(order.client_order_id))
        run(adapter.drain())
        cur = run(oms.get_order(order.client_order_id))
        assert cur.status == OrderStatus.SUBMITTED

        # Connection drops; the broker cancels the order while we are away.
        client.simulate_unexpected_disconnect()
        client.force_status(int(cur.broker_order_id), "Cancelled")

        # Reconnect: the status replay delivers CANCELLED -> OMS applies it.
        run(adapter.reconnect())
        run(adapter.drain())
        assert run(oms.get_order(order.client_order_id)).status == OrderStatus.CANCELLED
        # Reconcile finds nothing new (the adapter already delivered it).
        assert run(executor.reconcile()) == []
        run(adapter.stop())

    def test_reconcile_delivers_broker_side_cancel_without_replay(self, client, bus, aapl, usd):
        adapter = IbkrAdapter(client, bus=bus, account_id="DU123456", auto_drain=False)
        oms = OrderManager(InMemoryOrderRepository(), bus)
        executor = ExecutionEngine(adapter, oms)

        run(adapter.start())
        order = run(oms.create_order(make_request(aapl, usd, quantity="10")))
        run(executor.submit(order.client_order_id))
        run(adapter.drain())
        cur = run(oms.get_order(order.client_order_id))

        # Broker-side cancel with NO callback delivery; M5 reconcile polls.
        client.force_status(int(cur.broker_order_id), "Cancelled")
        updated = run(executor.reconcile())
        assert len(updated) == 1
        assert run(oms.get_order(order.client_order_id)).status == OrderStatus.CANCELLED
        # A second reconcile finds nothing new (idempotent).
        assert run(executor.reconcile()) == []
        run(adapter.stop())
