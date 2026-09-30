"""Shared fixtures for API gateway integration tests (M10 + M12 auth).

Builds the REAL engine stack (runtime + simulated IBKR adapter + FastAPI app +
AuthService) and drives it through the HTTP/WS surface only.

Every authenticated client fixture logs a user in through the real /auth/login
endpoint. The fixture credentials are TEST FIXTURES, not real secrets:

- trader  — trader role, scoped to ACC-001 (the runtime's account)
- viewer  — read-only role, scoped to ACC-001
- admin   — admin role, wildcard account scope
- outsider— trader role, scoped to ACC-OTHER (cross-account/IDOR tests)
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
from api.auth import AuthService, UserDirectory, demo_record
from api.tokens import TokenService
from application.runtime import EngineRuntime
from brokers.ibkr import IbkrAdapter, SimulatedIbkrClient
from events import InProcessEventBus
from risk import RiskLimits
from tests.unit.brokers.conftest import make_execution, make_quote

# Test-only signing secret (a fixture value, not a deployable credential).
TEST_SIGNING_SECRET = "test-signing-secret-not-a-real-credential"

TEST_PASSWORDS = {
    "trader": "trader-pass",
    "viewer": "viewer-pass",
    "admin": "admin-pass",
    "outsider": "outsider-pass",
}


def run(coro):
    return asyncio.run(coro)


from functools import lru_cache

from api.passwords import hash_password


@lru_cache(maxsize=32)
def _cached_hash(password: str) -> str:
    """PBKDF2 is expensive by design (~600k iterations); hash each distinct
    fixture password ONCE per process. Session/TokenService instances stay
    strictly per-test."""
    return hash_password(password)


def demo_record_fast(username: str, password: str, *, roles: list[str], accounts: list[str]):
    from api.auth import UserRecord

    return UserRecord(
        username=username,
        password_hash=_cached_hash(password),
        roles=frozenset(roles),
        accounts=frozenset(accounts),
    )


def make_auth_service() -> AuthService:
    tokens = TokenService(secret_key=TEST_SIGNING_SECRET)
    users = UserDirectory(
        [
            demo_record_fast("trader", TEST_PASSWORDS["trader"], roles=["trader"], accounts=["ACC-001"]),
            demo_record_fast("viewer", TEST_PASSWORDS["viewer"], roles=["viewer"], accounts=["ACC-001"]),
            demo_record_fast("admin", TEST_PASSWORDS["admin"], roles=["admin"], accounts=["*"]),
            demo_record_fast(
                "outsider", TEST_PASSWORDS["outsider"], roles=["trader"], accounts=["ACC-OTHER"]
            ),
        ]
    )
    return AuthService(tokens, users)


def login(app, username: str, password: str) -> dict:
    """Log in over the real endpoint; returns the credential-pair JSON."""
    with TestClient(app) as tc:
        response = tc.post("/api/v1/auth/login", json={"username": username, "password": password})
        assert response.status_code == 200, response.text
        return response.json()


def auth_headers(app, username: str) -> dict[str, str]:
    pair = login(app, username, TEST_PASSWORDS[username])
    return {"Authorization": f"Bearer {pair['access_token']}"}


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
def app(runtime) -> object:
    return create_app(runtime, auth=make_auth_service(), ws_account_id="ACC-001")


def _authed_client(app, username: str):
    headers = auth_headers(app, username)
    # Context-managed TestClient exposes `client.portal`, letting tests run
    # adapter drains ON THE APP'S EVENT LOOP (thread/loop-safe delivery).
    with TestClient(app, headers=headers) as test_client:
        test_client.username = username  # type: ignore[attr-defined]
        yield test_client


@pytest.fixture()
def client(app):
    """Authenticated as `trader` (trader role, ACC-001 scope)."""
    yield from _authed_client(app, "trader")


@pytest.fixture()
def admin_client(app):
    """Authenticated as `admin` (admin role, wildcard account scope)."""
    yield from _authed_client(app, "admin")


@pytest.fixture()
def viewer_client(app):
    """Authenticated as `viewer` (read-only role, ACC-001 scope)."""
    yield from _authed_client(app, "viewer")


@pytest.fixture()
def outsider_client(app):
    """Authenticated as `outsider` (trader role, ACC-OTHER scope)."""
    yield from _authed_client(app, "outsider")


def ws_connect(client, path: str = "/ws?topics=all"):
    """Open an authorized WS connection (fresh single-use ticket per call)."""
    ticket = client.post("/api/v1/auth/ws-ticket").json()["ticket"]
    sep = "&" if "?" in path else "?"
    return client.websocket_connect(f"{path}{sep}ticket={ticket}")


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
    "run", "sim_client", "bus", "adapter", "runtime", "app",
    "client", "admin_client", "viewer_client", "outsider_client",
    "login", "auth_headers", "ws_connect", "make_auth_service",
    "TEST_PASSWORDS", "TEST_SIGNING_SECRET",
    "aapl_body", "push_fill", "make_quote", "RiskLimits", "UUID",
]
