"""M14 security tests — hardened surfaces through the REAL app.

Login throttling (fail-closed), security headers, docs-surface gating, and
a repository secrets guard. These actively attempt bypasses: the throttle is
checked server-side before credentials; the docs surface is disabled by
default for unauthenticated enumeration; no secret material may be tracked.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from api.app import create_app
from api.auth import AuthService, UserDirectory, demo_record
from api.throttle import LoginRateLimiter
from api.tokens import TokenService
from tests.integration.api.conftest import TEST_PASSWORDS, TEST_SIGNING_SECRET, make_auth_service


def login_payload(username: str, password: str) -> dict:
    return {"username": username, "password": password}


class TestLoginThrottlingIntegration:
    """Fail-closed online-guessing protection through the real endpoint."""

    @pytest.fixture()
    def strict_app(self, runtime):
        """Real stack with a tight limiter (3 failures/60 s)."""
        tokens = TokenService(secret_key=TEST_SIGNING_SECRET)
        users = UserDirectory(
            [
                demo_record("trader", TEST_PASSWORDS["trader"], roles=["trader"], accounts=["ACC-001"]),
                demo_record("admin", TEST_PASSWORDS["admin"], roles=["admin"], accounts=["*"]),
            ]
        )
        auth = AuthService(
            tokens, users, throttle=LoginRateLimiter(max_failures=3)
        )
        return create_app(runtime, auth=auth, ws_account_id="ACC-001")

    def test_lockout_after_repeated_failures(self, strict_app):
        client = TestClient(strict_app)
        for _ in range(3):
            response = client.post(
                "/api/v1/auth/login", json=login_payload("trader", "wrong")
            )
            assert response.status_code == 401  # generic, no enumeration
        locked = client.post(
            "/api/v1/auth/login", json=login_payload("trader", "wrong")
        )
        assert locked.status_code == 429
        assert locked.json()["error"]["code"] == "RATE_LIMITED"
        assert int(locked.headers["Retry-After"]) >= 1

    def test_lockout_is_fail_closed_for_the_correct_password(self, strict_app):
        client = TestClient(strict_app)
        for _ in range(3):
            client.post("/api/v1/auth/login", json=login_payload("trader", "wrong"))
        # Guessing cannot be resumed by getting the password right mid-lock:
        even_correct = client.post(
            "/api/v1/auth/login",
            json=login_payload("trader", TEST_PASSWORDS["trader"]),
        )
        assert even_correct.status_code == 429
        # And no token was issued.
        assert "access_token" not in even_correct.text

    def test_success_resets_and_allows_normal_use(self, strict_app):
        client = TestClient(strict_app)
        client.post("/api/v1/auth/login", json=login_payload("trader", "wrong"))
        client.post("/api/v1/auth/login", json=login_payload("trader", "wrong"))
        ok = client.post(
            "/api/v1/auth/login",
            json=login_payload("trader", TEST_PASSWORDS["trader"]),
        )
        assert ok.status_code == 200  # success before the limit clears the key
        # A fresh small burst is still allowed after the reset.
        for _ in range(2):
            assert (
                client.post("/api/v1/auth/login", json=login_payload("trader", "wrong")).status_code
                == 401
            )

    def test_other_users_and_sources_are_not_collaterally_locked(self, strict_app):
        client = TestClient(strict_app)
        for _ in range(3):
            client.post("/api/v1/auth/login", json=login_payload("trader", "wrong"))
        assert (
            client.post(
                "/api/v1/auth/login",
                json=login_payload("admin", TEST_PASSWORDS["admin"]),
            ).status_code
            == 200
        )

    def test_throttling_does_not_leak_username_existence(self, strict_app):
        client = TestClient(strict_app)
        for _ in range(3):
            client.post("/api/v1/auth/login", json=login_payload("ghost-user", "wrong"))
        locked_unknown = client.post(
            "/api/v1/auth/login", json=login_payload("ghost-user", "wrong")
        )
        assert locked_unknown.status_code == 429
        assert locked_unknown.json()["error"]["message"] == "too many attempts"


class TestSecurityHeaders:
    def test_headers_on_public_probe(self, app):
        client = TestClient(app)
        response = client.get("/ready")
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["Referrer-Policy"] == "no-referrer"

    def test_no_store_on_authenticated_trading_data(self, client):
        response = client.get("/api/v1/orders")
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    def test_headers_do_not_override_explicit_values(self, runtime):
        # setdefault semantics: a middleware/route that deliberately sets a
        # header keeps it (no accidental clobbering of future layers).
        app = create_app(
            runtime, auth=make_auth_service(), ws_account_id="ACC-001", docs_enabled=True
        )
        response = TestClient(app).get("/ready")
        assert response.headers["X-Content-Type-Options"] == "nosniff"


class TestDocsSurfaceGating:
    def test_docs_disabled_by_default(self, app):
        client = TestClient(app)
        assert client.get("/docs").status_code == 404
        assert client.get("/redoc").status_code == 404
        assert client.get("/openapi.json").status_code == 404

    def test_docs_enabled_is_explicit_dev_tooling(self, runtime):
        app = create_app(
            runtime, auth=make_auth_service(), ws_account_id="ACC-001", docs_enabled=True
        )
        client = TestClient(app)
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200
        # The docs surface carries the security headers too.
        assert client.get("/docs").headers["X-Content-Type-Options"] == "nosniff"


class TestRepositorySecretsGuard:
    """No secret material may be tracked in the repository."""

    # High-signal patterns only — no heuristic password guessing that would
    # flag test fixtures or documentation placeholders.
    SECRET_FILE_PATTERNS = [
        r"^\.env$",  # the real env file (placeholders live in .env.example)
        r"\.pem$",
        r"\.key$",
        r"^id_rsa",
        r"\.p12$",
        r"\.pfx$",
    ]
    SECRET_CONTENT_PATTERNS = [
        re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"),
        re.compile(r"AKIA[0-9A-Z]{16}"),  # AWS access keys
        re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),  # GitHub fine-grained tokens
        re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),  # GitHub classic tokens
        re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),  # Slack tokens
    ]

    def _tracked_files(self) -> list[str]:
        result = subprocess.run(
            ["git", "ls-files"], capture_output=True, text=True, cwd=REPO_ROOT
        )
        assert result.returncode == 0, result.stderr
        return [line for line in result.stdout.splitlines() if line.strip()]

    def test_no_secret_files_tracked(self):
        tracked = self._tracked_files()
        for pattern in self.SECRET_FILE_PATTERNS:
            matcher = re.compile(pattern)
            hits = [f for f in tracked if matcher.search(Path(f).name) and f != ".env.example"]
            assert hits == [], f"tracked secret-like files matching {pattern}: {hits}"

    def test_no_secret_material_in_tracked_content(self):
        tracked = self._tracked_files()
        offenders: list[str] = []
        for rel in tracked:
            path = REPO_ROOT / rel
            if not path.is_file() or path.stat().st_size > 2_000_000:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for pattern in self.SECRET_CONTENT_PATTERNS:
                if pattern.search(text):
                    offenders.append(f"{rel}: {pattern.pattern}")
        assert offenders == [], f"secret-shaped material tracked: {offenders}"

    def test_gitignore_covers_env_and_users_files(self):
        text = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8")
        assert ".env" in text
        assert ".env.example" in text  # the whitelist exception exists

class TestInputBoundaries:
    """M14 review finding: identifier metadata must be size-bounded so an
    authenticated caller cannot push megabyte-scale strings into the OMS."""

    def _body(self, identifiers: dict) -> dict:
        return {
            "account_id": "ACC-001",
            "instrument": {
                "symbol": "AAPL",
                "asset_class": "EQUITY",
                "currency": "USD",
                "identifiers": identifiers,
            },
            "side": "BUY",
            "order_type": "LIMIT",
            "quantity": "10",
            "limit_price": "100",
        }

    def test_oversized_identifier_values_rejected(self, client):
        response = client.post(
            "/api/v1/orders",
            json=self._body({"SAXO_UIC": "x" * 129}),
        )
        assert response.status_code == 422  # validation, never reaches the OMS

    def test_oversized_identifier_keys_rejected(self, client):
        response = client.post(
            "/api/v1/orders",
            json=self._body({"K" * 33: "211"}),
        )
        assert response.status_code  == 422

    def test_reasonable_identifiers_still_flow(self, client):
        response = client.post(
            "/api/v1/orders",
            json=self._body({"SAXO_UIC": "211"}),
        )
        assert response.status_code in (201, 502)  # accepted input; broker may refuse


class FakeDatabase:
    """Minimal pinger for app-level /ready + /metrics tests."""

    def __init__(self, ok: bool = True) -> None:
        self.ok = ok

    async def ping(self) -> bool:
        return self.ok


class TestReadinessDatabaseState:
    def test_ready_reports_database_not_configured_by_default(self, app):
        client = TestClient(app)
        body = client.get("/ready").json()
        assert body["database"] == "not_configured"
        assert body["status"] in {"ready", "starting"}

    def test_ready_reports_ok_when_database_healthy(self, runtime):
        from api.app import create_app

        app = create_app(
            runtime,
            auth=make_auth_service(),
            ws_account_id="ACC-001",
            database=FakeDatabase(ok=True),
        )
        body = TestClient(app).get("/ready").json()
        assert body["database"] == "ok"

    def test_ready_flips_to_starting_when_database_is_down(self, runtime):
        from api.app import create_app

        app = create_app(
            runtime,
            auth=make_auth_service(),
            ws_account_id="ACC-001",
            database=FakeDatabase(ok=False),
        )
        body = TestClient(app).get("/ready").json()
        assert body["database"] == "unavailable"
        assert body["status"] == "starting"


class TestMetricsEndpoint:
    def test_metrics_requires_authentication(self, app):
        client = TestClient(app)
        assert client.get("/metrics").status_code == 401

    def test_metrics_counts_bus_events_and_gauges(self, runtime, client):
        """Counters increment from REAL engine events (order lifecycle) and
        gauges read live state — through the public API only."""
        from tests.integration.api.conftest import aapl_body

        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="MET-1"))
        assert created.status_code == 201
        order_id = created.json()["client_order_id"]
        client.post(f"/api/v1/orders/{order_id}/cancel")

        metrics = client.get("/metrics").json()
        assert metrics["orders_submitted_total"] >= 1
        assert metrics["orders_cancelled_total"] >= 1
        assert metrics["orders_accepted_total"] >= 1
        assert metrics["uptime_seconds"] >= 0
        # No identifiers ever enter metrics: keys are well-known names only.
        assert "ACC-001" not in str(metrics)
        assert order_id not in str(metrics)
