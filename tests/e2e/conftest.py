"""M16 end-to-end validation — LIVE production-stack scenarios.

Drives the DEPLOYED stack (docker-compose.prod.yml, project `mtbe-prod`,
TLS edge on https://localhost:8443) exactly like an operator: TLS, REST,
WebSocket — no in-process seams. The suite is broker-parameterized: the
stack is deployed once per BROKER_ADAPTER (IBKR, SAXO) and the SAME
scenarios run against each, proving the broker-independent workflow twice.
Saxo-specific data (SAXO_UIC identifiers) rides the broker-neutral field
exactly like production integrations would. Executions on the live stack
are produced by the SIMULATION-ONLY auto-fill driver (paper trading,
ADR-014/015) — the real adapter callback path: sim client -> adapter
mapping/dedup -> OMS -> portfolio -> events -> WS -> REST.

Evidence: every scenario appends a structured record (case, environment,
input/action, expected, actual, pass/fail) to JSON + markdown artifacts
under tests/e2e/artifacts/ (written at session end).

Runbook: tests/e2e/README.md.
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

BASE = os.environ.get("E2E_BASE_URL", "https://localhost:8443")
TRADER = {
    "username": "trader",
    "password": os.environ.get("E2E_TRADER_PASSWORD", "e2e-trader-pass"),
}
ADMIN = {"username": "admin", "password": os.environ.get("E2E_ADMIN_PASSWORD", "e2e-admin-pass")}
OUTSIDER = {
    "username": "outsider",
    "password": os.environ.get("E2E_OUTSIDER_PASSWORD", "e2e-outsider-pass"),
}
ACCOUNT = os.environ.get("E2E_ACCOUNT", "ACC-001")
BROKER = os.environ.get("E2E_BROKER", "IBKR").upper()
# Saxo orders MUST carry the broker-neutral SAXO_UIC (ADR-015).
IDENTIFIERS = {"SAXO_UIC": "211"} if BROKER == "SAXO" else {}
SYMBOL = "AAPL"

EVIDENCE: list[dict[str, object]] = []


def record(case: str, action: str, expected: str, actual: str, ok: bool) -> bool:
    EVIDENCE.append(
        {
            "case": case,
            "environment": f"live stack, broker={BROKER}",
            "input_action": action,
            "expected": expected,
            "actual": actual,
            "status": "PASS" if ok else "FAIL",
        }
    )
    return ok


def pytest_sessionfinish(session, exitstatus):  # noqa: ANN001
    out_dir = REPO_ROOT / "tests" / "e2e" / "artifacts"
    out_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "broker": BROKER,
        "base_url": BASE,
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "results": EVIDENCE,
        "totals": {
            "total": len(EVIDENCE),
            "passed": sum(1 for e in EVIDENCE if e["status"] == "PASS"),
            "failed": sum(1 for e in EVIDENCE if e["status"] == "FAIL"),
        },
    }
    (out_dir / f"e2e-{BROKER.lower()}-results.json").write_text(
        json.dumps(data, indent=2), encoding="utf-8"
    )
    rows = [
        "| Case | Input/Action | Expected | Actual | Status |",
        "| --- | --- | --- | --- | --- |",
    ]
    for e in EVIDENCE:
        rows.append(
            f"| {e['case']} | {e['input_action']} | {e['expected']} | {e['actual']} | {e['status']} |"
        )
    (out_dir / f"e2e-{BROKER.lower()}-results.md").write_text("\n".join(rows), encoding="utf-8")


class Client:
    """Minimal TLS REST client for the live stack."""

    def __init__(self) -> None:
        self._ctx = ssl.create_default_context()
        self._ctx.check_hostname = False
        self._ctx.verify_mode = ssl.CERT_NONE
        self.token: str | None = None
        self.user: dict | None = None

    def login(self, creds: dict) -> tuple[int, dict]:
        status, _, body = self.http("POST", "/api/v1/auth/login", creds)
        if status == 200 and isinstance(body, dict):
            self.token = body["access_token"]
            self.user = body["user"]
        return status, body if isinstance(body, dict) else {}

    def http(self, method: str, path: str, body=None) -> tuple[int, dict, object]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, context=self._ctx, timeout=30) as resp:
                raw = resp.read()
                return resp.status, dict(resp.headers), _maybe_json(raw)
        except urllib.error.HTTPError as e:
            raw = e.read()
            return e.code, dict(e.headers), _maybe_json(raw)

    def ws_ticket(self) -> str:
        _, _, body = self.http("POST", "/api/v1/auth/ws-ticket")
        assert isinstance(body, dict)
        return body["ticket"]


def _maybe_json(raw: bytes):
    try:
        return json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return raw[:80].decode("utf-8", errors="replace")


def order_body(key: str, *, side="BUY", quantity="10", limit="150.25",
               account=ACCOUNT, order_type="LIMIT", sim_action: str | None = None) -> dict:
    identifiers = dict(IDENTIFIERS)
    if sim_action is not None:
        # The simulated paper-trading driver reads its deterministic
        # directive from the broker-neutral identifiers channel.
        identifiers["SIM_ACTION"] = sim_action
    return {
        "account_id": account,
        "instrument": {
            "symbol": SYMBOL,
            "asset_class": "EQUITY",
            "currency": "USD",
            "exchange": "NASDAQ",
            "identifiers": identifiers,
        },
        "side": side,
        "order_type": order_type,
        "quantity": quantity,
        "limit_price": limit if order_type == "LIMIT" else None,
        "idempotency_key": key,
    }


def wait_ready(client: Client, timeout: float = 120.0) -> dict:
    deadline = time.time() + timeout
    last: object = None
    while time.time() < deadline:
        try:
            _, _, last = client.http("GET", "/ready")
            if isinstance(last, dict) and last.get("status") == "ready":
                return last
        except Exception:  # noqa: BLE001 — waiting for the stack
            pass
        time.sleep(3)
    return last if isinstance(last, dict) else {}


def wait_for(predicate, timeout: float = 30.0, interval: float = 1.0):
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(interval)
    return result


def backend_container() -> str:
    import subprocess

    return subprocess.run(
        ["docker", "compose", "-f", "docker-compose.prod.yml", "ps", "-q", "backend"],
        capture_output=True,
        text=True, cwd=REPO_ROOT,
    ).stdout.strip()


def restart_backend() -> None:
    import subprocess

    subprocess.run(
        ["docker", "restart", backend_container()],
        capture_output=True, timeout=180,
    )


def restart_postgres() -> None:
    import subprocess

    container = subprocess.run(
        ["docker", "compose", "-f", "docker-compose.prod.yml", "ps", "-q", "postgres"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    ).stdout.strip()
    subprocess.run(["docker", "restart", container], capture_output=True, timeout=180)

# --- logged-in clients (module-scoped) --------------------------------------

import pytest  # noqa: E402


@pytest.fixture(scope="module")
def trader() -> Client:
    client = Client()
    status, body = client.login(TRADER)
    assert status == 200, f"trader login failed: {status} {body}"
    return client


@pytest.fixture(scope="module")
def admin() -> Client:
    client = Client()
    status, body = client.login(ADMIN)
    assert status == 200, f"admin login failed: {status} {body}"
    return client
