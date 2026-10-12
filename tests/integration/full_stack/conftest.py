"""M13 full-stack integration harness.

Composes EVERY boundary on one bus and drives it only through the public
surface (authenticated REST + ticket-gated WS):

    FastAPI + auth (M10/M12)
          |
    EngineRuntime (M10)  -> risk gate (M6) / OMS (M4) / execution (M5)
          |                  market data (M3) / portfolio (M7)
    broker adapter  ->  SimulatedIbkrClient (M8)  |  SimulatedSaxoClient (M9)

Parameterized over BOTH brokers so the same broker-independent workflow is
proven on each (legitimate capability differences are handled in helpers,
not by forcing parity). Deterministic: `auto_drain=False` — every broker
callback burst is drained ON THE APP LOOP via the TestClient portal.

No real broker, no live trading: simulated/paper clients only (roadmap).
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.app import create_app
from application.runtime import EngineRuntime
from brokers.ibkr import IbkrAdapter, SimulatedIbkrClient
from brokers.saxo import SaxoAdapter, SimulatedSaxoClient
from events import InProcessEventBus
from tests.integration.api.conftest import TEST_PASSWORDS, make_auth_service
from tests.unit.brokers.conftest import (
    aapl_contract,
    account_values_usd,
    make_execution,
    make_quote,
    make_saxo_execution,
    make_saxo_quote,
    saxo_balance_usd,
    SAXO_AAPL_UIC,
)

ACCOUNT = "ACC-001"


def run(coro):
    return asyncio.run(coro)


def _aapl_instrument_body(broker: str) -> dict[str, Any]:
    """The AAPL instrument as the REST API accepts it (broker-neutral).

    The Saxo adapter REQUIRES the broker-neutral `SAXO_UIC` identifier and
    never guesses (ADR-015); IBKR resolves by contract fields and adds
    CON_ID from its own side. This is a documented capability difference,
    handled here rather than forced into parity.
    """
    body: dict[str, Any] = {
        "symbol": "AAPL",
        "asset_class": "EQUITY",
        "currency": "USD",
        "exchange": "NASDAQ",
    }
    if broker == "saxo":
        body["identifiers"] = {"SAXO_UIC": str(SAXO_AAPL_UIC)}
    return body


@dataclass
class Stack:
    """One running engine + API + simulated broker, plus drive helpers."""

    broker: str
    sim: Any
    adapter: Any
    runtime: EngineRuntime
    app: FastAPI
    client: TestClient  # authenticated trader (context-managed: has .portal)
    admin: TestClient  # authenticated admin (wildcard scope)
    outsider: TestClient  # authenticated trader scoped to ACC-OTHER
    _subscribed: set[str] = field(default_factory=set)
    _owned_clients: list[TestClient] = field(default_factory=list)

    # -- lifecycle helpers ------------------------------------------------------

    def drain(self) -> None:
        """Flush queued broker callbacks ON THE APP LOOP (deterministic)."""
        self.client.portal.call(self.adapter.drain)

    def reconnect_broker(self) -> None:
        """Reconnect after an unexpected disconnect (state replay happens)."""
        self.client.portal.call(partial(self.adapter.reconnect))

    def reconcile(self) -> None:
        """Drive M5 reconciliation (TS-006): poll the broker for outstanding
        orders and apply changes (used after out-of-band broker actions)."""
        self.client.portal.call(partial(self.runtime.executor.reconcile))

    def push_balance(self) -> None:
        """Ask the (simulated) broker to report account data; the adapter
        relabels it to the internal account and M7 publishes the balance."""
        self.sim.request_account_summary()
        self.drain()

    # -- market data -----------------------------------------------------------

    def ensure_subscription(self) -> None:
        """Register the market-data subscription the API cannot express yet
        (documented M11 limitation). Saxo resolves streamed quotes by UIC via
        this registry (and REQUIRES the SAXO_UIC identifier, ADR-015);
        IBKR maps contracts directly."""
        key = "AAPL"
        if key in self._subscribed:
            return
        from domain.instrument import AssetClass, Exchange, Instrument
        from domain.money import Currency

        identifiers = (
            {"SAXO_UIC": str(SAXO_AAPL_UIC)} if self.broker == "saxo" else {}
        )
        aapl = Instrument(
            symbol="AAPL",
            asset_class=AssetClass.EQUITY,
            currency=Currency(code="USD"),
            exchange=Exchange.NASDAQ,
            identifiers=identifiers,
        )
        self.client.portal.call(partial(self.runtime.market.subscribe, aapl))
        self._subscribed.add(key)

    def push_quote(self, *, bid: str = "99", ask: str = "101", last: str = "100",
                   at: int | None = None) -> None:
        """Push a broker quote (unix SECONDS timestamp; None = now so the
        portfolio's 10 s freshness window sees it as fresh — use an old
        `at` to test staleness)."""
        import time as _time

        effective_at = at if at is not None else int(_time.time())
        if self.broker == "ibkr":
            quote = make_quote(aapl_contract(), bid=bid, ask=ask, last=last,
                               at=effective_at)
            self.sim.emit_quote(quote)
        else:
            self.ensure_subscription()
            quote = make_saxo_quote(bid=bid, ask=ask, last=last, at=effective_at)
            self.sim.emit_quote(quote)
        self.drain()

    # -- executions ------------------------------------------------------------

    def make_fill(self, broker_order_id: int, order, *, quantity: str, cum: str,
                  price: str = "100", execution_id: str | None = None):
        """Build a broker execution DTO (no emission)."""
        exec_id = execution_id or f"F-{uuid4()}"
        if self.broker == "ibkr":
            return make_execution(
                broker_order_id, order, execution_id=exec_id,
                quantity=quantity, cum=cum, price=price,
            )
        return make_saxo_execution(
            broker_order_id, order, execution_id=exec_id,
            quantity=quantity, cum=cum, price=price,
        )

    def push_fill(self, broker_order_id: int, order, *, quantity: str, cum: str,
                  price: str = "100", execution_id: str | None = None) -> None:
        """Emit a broker execution for an order and drain on the app loop."""
        self.sim.emit_execution(
            self.make_fill(
                broker_order_id, order, quantity=quantity, cum=cum,
                price=price, execution_id=execution_id,
            )
        )
        self.drain()

    # -- orders ----------------------------------------------------------------

    def aapl_body(self, **overrides) -> dict[str, Any]:
        body: dict[str, Any] = {
            "account_id": ACCOUNT,
            "instrument": _aapl_instrument_body(self.broker),
            "side": "BUY",
            "order_type": "LIMIT",
            "quantity": "10",
            "limit_price": "100",
        }
        body.update(overrides)
        return body

    def submit(self, client: TestClient | None = None, **overrides):
        return (client or self.client).post(
            "/api/v1/orders", json=self.aapl_body(**overrides)
        )

    # -- websocket ---------------------------------------------------------------

    def ws_connect(self, client: TestClient | None = None, path: str = "/ws?topics=all"):
        """Open an authorized WS connection (fresh single-use ticket)."""
        active = client or self.client
        ticket = active.post("/api/v1/auth/ws-ticket").json()["ticket"]
        sep = "&" if "?" in path else "?"
        return active.websocket_connect(f"{path}{sep}ticket={ticket}")


def _login_client(app: FastAPI, username: str, *, portal: bool) -> TestClient:
    """Log a user in through the real endpoint; return a headered client.

    portal=True yields a CONTEXT-MANAGED client (has `.portal` for app-loop
    drains); ownership is tracked so the stack fixture can close it.
    """
    with TestClient(app) as tc:
        response = tc.post(
            "/api/v1/auth/login",
            json={"username": username, "password": TEST_PASSWORDS[username]},
        )
        assert response.status_code == 200, response.text
        headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    if not portal:
        return TestClient(app, headers=headers)
    managed = TestClient(app, headers=headers)
    managed.__enter__()
    return managed


def make_stack(broker: str) -> Stack:
    """Build and start a full stack for one broker."""
    bus = InProcessEventBus()
    if broker == "ibkr":
        sim: Any = SimulatedIbkrClient()
        sim.account_values = account_values_usd()
        adapter: Any = IbkrAdapter(sim, bus=bus, account_id=ACCOUNT, auto_drain=False)
    else:
        sim = SimulatedSaxoClient()
        sim.balances = [saxo_balance_usd()]
        adapter = SaxoAdapter(sim, bus=bus, account_id=ACCOUNT, auto_drain=False)
    runtime = EngineRuntime(
        feed=adapter, broker=adapter, broker_name=broker.upper(), bus=bus
    )
    run(runtime.start())  # connects the feed (also replays balances)

    auth = make_auth_service()
    app = create_app(runtime, auth=auth, ws_account_id=ACCOUNT)

    trader = _login_client(app, "trader", portal=True)
    # Drain connect-time deliveries (broker.connected, balance replay) ON
    # THE APP LOOP so the stack starts in a settled, observable state.
    trader.portal.call(adapter.drain)
    stack = Stack(
        broker=broker,
        sim=sim,
        adapter=adapter,
        runtime=runtime,
        app=app,
        client=trader,
        admin=_login_client(app, "admin", portal=False),
        outsider=_login_client(app, "outsider", portal=False),
    )
    stack._owned_clients.append(trader)
    return stack


def teardown_stack(stack: Stack) -> None:
    for tc in stack._owned_clients:
        try:
            tc.__exit__(None, None, None)
        except Exception:  # noqa: BLE001 — best-effort cleanup
            pass
    stack._owned_clients.clear()
    run(stack.runtime.stop())


@pytest.fixture(params=["ibkr", "saxo"])
def stack(request) -> Stack:
    """Full stack, parameterized over both simulated brokers."""
    built = make_stack(request.param)
    yield built
    teardown_stack(built)


__all__ = [
    "Stack",
    "make_stack",
    "stack",
    "ACCOUNT",
    "run",
]
