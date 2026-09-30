"""Security tests (M12) — adversarial checks beyond the functional suites.

Covers: authentication bypass attempts, credential/secret leakage (responses
AND logs), user-enumeration resistance, CORS posture, and identity-source
configuration hardening. Uses the REAL engine + app stack.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient

from api.auth import UserDirectory, demo_record
from api.tokens import TokenService
from tests.integration.api.conftest import TEST_PASSWORDS, make_auth_service


@pytest.fixture()
def anon(app):
    return TestClient(app)


@pytest.fixture()
def cors_app(runtime):
    from api.app import create_app

    return create_app(
        runtime,
        auth=make_auth_service(),
        ws_account_id="ACC-001",
        allowed_origins=["http://localhost:5173"],
    )


class TestAuthenticationBypass:
    """Every malformed/missing/abusive credential shape must yield 401."""

    HEADERS = [
        {},
        {"Authorization": ""},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer "},
        {"Authorization": "bearer token-with-wrong-case-scheme"},
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"Authorization": "Bearer not.a.jwt"},
        {"Authorization": "Bearer a.b.c"},
        {"Authorization": "Bearer null"},
        {"X-Auth-Token": "some-token"},  # wrong header entirely
    ]

    @pytest.mark.parametrize("headers", HEADERS)
    def test_bearer_shape_enforcement(self, anon, headers):
        response = anon.get("/api/v1/health", headers=headers)
        assert response.status_code == 401, headers
        assert response.json()["error"]["code"] == "UNAUTHENTICATED"

    def test_token_from_another_secret_is_rejected(self, runtime):
        """Forge a token signed by a DIFFERENT secret — must not authenticate."""
        from api.app import create_app

        foreign = TokenService(secret_key="attacker-controlled-secret-0123456789")
        access, _ = foreign.issue_access(
            subject="trader",
            roles=frozenset({"admin"}),
            accounts=frozenset({"*"}),
            sid="s",
        )
        app = create_app(
            runtime, auth=make_auth_service(), ws_account_id="ACC-001"
        )
        client = TestClient(app, headers={"Authorization": f"Bearer {access}"})
        assert client.get("/api/v1/health").status_code == 401

    def test_refresh_token_cannot_be_used_as_access_token(self, anon, app):
        pair = anon.post(
            "/api/v1/auth/login",
            json={"username": "trader", "password": TEST_PASSWORDS["trader"]},
        ).json()
        response = anon.get(
            "/api/v1/health", headers={"Authorization": f"Bearer {pair['refresh_token']}"}
        )
        assert response.status_code == 401

    def test_access_token_cannot_be_used_as_refresh_token(self, anon, app):
        pair = anon.post(
            "/api/v1/auth/login",
            json={"username": "trader", "password": TEST_PASSWORDS["trader"]},
        ).json()
        response = anon.post(
            "/api/v1/auth/refresh", json={"refresh_token": pair["access_token"]}
        )
        assert response.status_code == 401

    def test_logout_with_garbage_refresh_is_a_safe_204(self, client):
        # Logout must be idempotent and never confirm/refute token validity.
        response = client.post("/api/v1/auth/logout", json={"refresh_token": "rt_garbage"})
        assert response.status_code == 204


class TestSensitiveDataLeakage:
    def test_login_response_has_only_documented_fields(self, anon):
        pair = anon.post(
            "/api/v1/auth/login",
            json={"username": "trader", "password": TEST_PASSWORDS["trader"]},
        ).json()
        assert set(pair) == {
            "access_token",
            "token_type",
            "expires_in",
            "refresh_token",
            "refresh_expires_in",
            "user",  # identity (subject/roles/accounts/permissions) — no secrets
        }
        assert set(pair["user"]) == {"subject", "roles", "accounts", "permissions"}

    def test_error_bodies_never_echo_credentials(self, anon):
        response = anon.post(
            "/api/v1/auth/login", json={"username": "trader", "password": "Sup3rS3cret!"}
        )
        text = response.text
        assert "Sup3rS3cret" not in text
        # 403s must not leak other accounts or principals.
        denied = anon.get("/api/v1/accounts/ACC-001/positions")
        assert "ACC-001" not in denied.text or denied.status_code == 401
        assert denied.json() == {
            "error": {"code": "UNAUTHENTICATED", "message": "authentication required", "detail": None}
        }

    def test_failed_logins_never_log_credentials_or_tokens(self, anon, caplog):
        with caplog.at_level(logging.INFO, logger="mtbe.api.auth"):
            anon.post(
                "/api/v1/auth/login",
                json={"username": "trader", "password": "Leaked-Password-123"},
            )
            anon.post(
                "/api/v1/auth/refresh", json={"refresh_token": "rt_leaked_token_probe"}
            )
        logged = caplog.text
        assert "Leaked-Password-123" not in logged
        assert "rt_leaked_token_probe" not in logged
        # ...but the audit events (identifiers only) ARE logged.
        assert "auth_login_failed" in logged
        assert "auth_refresh_failed" in logged

    def test_me_never_exposes_password_hashes(self, client):
        body = client.get("/api/v1/auth/me").json()
        assert "password_hash" not in body
        assert "pbkdf2" not in str(body)


class TestUserEnumerationResistance:
    def test_identical_error_body_and_status(self, anon):
        unknown = anon.post(
            "/api/v1/auth/login", json={"username": "no-such-user", "password": "x"}
        )
        wrong = anon.post(
            "/api/v1/auth/login", json={"username": "trader", "password": "x"}
        )
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json() == wrong.json()


class TestCorsPosture:
    def test_allowed_origin_preflight_passes(self, cors_app):
        client = TestClient(cors_app)
        response = client.options(
            "/api/v1/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        # Credentials mode must never be enabled (bearer-header auth); the
        # header may be absent entirely when disabled.
        assert response.headers.get("access-control-allow-credentials") in (None, "false")

    def test_disallowed_origin_preflight_rejected(self, cors_app):
        client = TestClient(cors_app)
        response = client.options(
            "/api/v1/health",
            headers={
                "Origin": "http://evil.example",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 400
        assert "access-control-allow-origin" not in response.headers

    def test_no_wildcard_origin_is_ever_allowed(self, cors_app):
        client = TestClient(cors_app)
        response = client.options(
            "/api/v1/health",
            headers={
                "Origin": "*",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers.get("access-control-allow-origin") != "*"


class TestIdentitySourceHardening:
    """Configuration is the trust boundary for the identity source: fail closed."""

    def test_wildcard_accounts_require_admin_role(self):
        with pytest.raises(ValueError, match="wildcard"):
            UserDirectory(
                [demo_record("sneaky", "pw", roles=["trader"], accounts=["*"])]
            )

    def test_duplicate_usernames_rejected(self):
        with pytest.raises(ValueError, match="duplicate"):
            UserDirectory(
                [
                    demo_record("dup", "pw", roles=["trader"], accounts=["ACC-001"]),
                    demo_record("dup", "pw", roles=["viewer"], accounts=["ACC-001"]),
                ]
            )

    def test_unknown_role_rejected_at_load(self):
        with pytest.raises(ValueError, match="unknown roles"):
            UserDirectory(
                [demo_record("root", "pw", roles=["superuser"], accounts=["ACC-001"])]
            )

    def test_user_without_accounts_rejected(self):
        with pytest.raises(ValueError, match="no accounts"):
            UserDirectory([demo_record("nop", "pw", roles=["trader"], accounts=[])])

    def test_records_shape_validated(self):
        with pytest.raises(ValueError):
            UserDirectory.from_records([{"username": "x"}])  # missing hash
        with pytest.raises(ValueError):
            UserDirectory.from_records(
                [{"username": "x", "password_hash": "h", "roles": "trader"}]
            )  # roles not a list


class TestSessionScopingIntegrity:
    def test_refresh_preserves_server_side_scope(self, runtime):
        """Refresh derives identity from the SERVER session, not the token —
        a user's scope changes can never be smuggled through refresh."""
        from api.app import create_app

        auth = make_auth_service()
        app = create_app(runtime, auth=auth, ws_account_id="ACC-001")
        client = TestClient(app)
        pair = client.post(
            "/api/v1/auth/login",
            json={"username": "outsider", "password": TEST_PASSWORDS["outsider"]},
        ).json()
        refreshed = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": pair["refresh_token"]}
        ).json()
        headers = {"Authorization": f"Bearer {refreshed['access_token']}"}
        assert client.get("/api/v1/accounts/ACC-001/positions", headers=headers).status_code == 403
        me = client.get("/api/v1/auth/me", headers=headers).json()
        assert me["accounts"] == ["ACC-OTHER"]
