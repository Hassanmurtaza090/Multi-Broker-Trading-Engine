"""Shared fixtures for API gateway integration tests.

Builds the REAL engine stack (runtime + simulated IBKR adapter + FastAPI app)
and drives it through the HTTP/WS surface only.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from uuid import UUID, uuid4

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient

from api.app import create_app
from application.runtime import EngineRuntime
from brokers.ibkr import IbkrAdapter, SimulatedIbkrClient
from events import InProcessEventBus
from risk import RiskLimits
from tests.unit.brokers.conftest import make_execution, make_quote


def run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def sim_client():
    return SimulatedIbkrClient()


@pytest.fixture()
def bus():
    return InProcessEventBus()


@pytest.fixture()
def adapter(sim_client, bus) -> IbkrAdapter:
    # auto_drain=False: tests drain queued adapter deliveries explicitly.
    return IbkrAdapter(sim_client, bus=bus, account_id="ACC-001", auto_drain=False)


@pytest.fixture()
def runtime(adapter, bus) -> EngineRuntime:
    rt = EngineRuntime(feed=adapter, broker=adapter, broker_name="IBKR", bus=bus)
    run(rt.start())
    return rt


@pytest.fixture()
def app(runtime):
    return create_app(runtime)


@pytest.fixture()
def client(app):
    # Context-managed TestClient exposes `client.portal`, letting tests run
    # adapter drains ON THE APP'S EVENT LOOP (thread/loop-safe delivery).
    with TestClient(app) as test_client:
        yield test_client


def aapl_body(**overrides) -> dict:
    body = {
        "account_id": "ACC-001",
        "instrument": {
            "symbol": "AAPL",
            "asset_class": "EQUITY",
            "currency": "USD",
            "exchange": "NASDAQ",
        },
        "side": "BUY",
        "order_type": "LIMIT",
        "quantity": "10",
        "limit_price": "100",
    }
    body.update(overrides)
    return body


def push_fill(
    client,
    sim_client,
    adapter,
    broker_order_id: int,
    order,
    *,
    quantity: str,
    cum: str,
    price: str = "100",
):
    """Simulate a broker execution and drain the adapter ON the app's loop.

    Draining through the TestClient portal guarantees every engine publish
    and hub fan-out happens on the application's event loop (deterministic,
    loop-safe) instead of a throwaway loop in the test thread.
    """
    fill = make_execution(
        broker_order_id,
        order,
        execution_id=f"F-{uuid4()}",
        quantity=quantity,
        cum=cum,
        price=price,
    )
    sim_client.emit_execution(fill)
    client.portal.call(adapter.drain)


__all__ = [
    "run", "sim_client", "bus", "adapter", "runtime", "app", "client",
    "aapl_body", "push_fill", "make_quote", "RiskLimits", "UUID",
]