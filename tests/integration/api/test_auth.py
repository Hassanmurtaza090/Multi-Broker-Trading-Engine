"""Integration tests — authentication endpoints (M12).

Drives the REAL app (runtime + auth service) through HTTP only: login,
refresh rotation, logout, /me, ws-ticket issuance, and failure semantics
(generic 401s — no user enumeration).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.integration.api.conftest import TEST_PASSWORDS, login


def no_auth_client(app):
    from fastapi.testclient import TestClient

    return TestClient(app)


class TestLogin:
    def test_success_returns_credential_pair_and_identity(self, app):
        pair = login(app, "trader", TEST_PASSWORDS["trader"])
        assert pair["token_type"] == "bearer"
        assert pair["access_token"].count(".") == 2  # JWT shape
        assert pair["refresh_token"].startswith("rt_")
        assert pair["expires_in"] > 0
        assert pair["refresh_expires_in"] >= pair["expires_in"]
        assert pair["user"]["subject"] == "trader"
        assert "trader" in pair["user"]["roles"]
        assert pair["user"]["accounts"] == ["ACC-001"]
        assert "orders:write" in pair["user"]["permissions"]
        assert "risk:admin" not in pair["user"]["permissions"]

    def test_wrong_password_401_generic(self, app):
        client = no_auth_client(app)
        response = client.post(
            "/api/v1/auth/login", json={"username": "trader", "password": "wrong"}
        )
        assert response.status_code == 401
        body = response.json()
        assert body["error"]["code"] == "UNAUTHENTICATED"
        assert "password" not in body["error"]["message"].lower()

    def test_unknown_user_same_401_as_wrong_password(self, app):
        client = no_auth_client(app)
        unknown = client.post(
            "/api/v1/auth/login", json={"username": "ghost", "password": "wrong"}
        ).json()
        wrong = client.post(
            "/api/v1/auth/login", json={"username": "trader", "password": "wrong"}
        ).json()
        # Indistinguishable failure (no user enumeration).
        assert unknown == wrong

    def test_malformed_body_422(self, app):
        client = no_auth_client(app)
        response = client.post("/api/v1/auth/login", json={"username": "trader"})
        assert response.status_code == 422
        response = client.post(
            "/api/v1/auth/login", json={"username": "x", "password": "y", "extra": 1}
        )
        assert response.status_code == 422  # unknown field rejected


class TestRefreshAndLogout:
    def test_refresh_rotates_tokens(self, app):
        client = no_auth_client(app)
        first = login(app, "trader", TEST_PASSWORDS["trader"])
        response = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]}
        )
        assert response.status_code == 200
        second = response.json()
        assert second["access_token"] != first["access_token"]
        assert second["refresh_token"] != first["refresh_token"]

        # The superseded refresh token now fails (reuse → session revoked).
        replay = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]}
        )
        assert replay.status_code == 401
        # ...and the rotated token is dead as well (theft response).
        dead = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": second["refresh_token"]}
        )
        assert dead.status_code == 401

    def test_logout_revokes_session(self, app):
        client = no_auth_client(app)
        pair = login(app, "trader", TEST_PASSWORDS["trader"])
        auth = {"Authorization": f"Bearer {pair['access_token']}"}
        response = client.post(
            "/api/v1/auth/logout", json={"refresh_token": pair["refresh_token"]}, headers=auth
        )
        assert response.status_code == 204
        refresh = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": pair["refresh_token"]}
        )
        assert refresh.status_code == 401

    def test_refresh_requires_valid_token(self, app):
        client = no_auth_client(app)
        response = client.post("/api/v1/auth/refresh", json={"refresh_token": "rt_forged"})
        assert response.status_code == 401

    def test_me_requires_bearer(self, app):
        client = no_auth_client(app)
        assert client.get("/api/v1/auth/me").status_code == 401
        assert (
            client.get(
                "/api/v1/auth/me", headers={"Authorization": "Bearer garbage"}
            ).status_code
            == 401
        )

    def test_me_returns_identity(self, app):
        client = no_auth_client(app)
        pair = login(app, "admin", TEST_PASSWORDS["admin"])
        response = client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {pair['access_token']}"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["subject"] == "admin"
        assert "admin" in body["roles"]
        assert "*" in body["accounts"]
        assert "risk:admin" in body["permissions"]


class TestWsTicketEndpoint:
    def test_ticket_requires_auth(self, app):
        client = no_auth_client(app)
        assert client.post("/api/v1/auth/ws-ticket").status_code == 401

    def test_ticket_issued_for_any_authenticated_user(self, client):
        response = client.post("/api/v1/auth/ws-ticket")
        assert response.status_code == 200
        assert response.json()["ticket"].startswith("wst_")
        assert response.json()["expires_in"] == 30


@pytest.mark.parametrize(
    "path,method",
    [
        ("/api/v1/health", "GET"),
        ("/api/v1/orders", "GET"),
        ("/api/v1/accounts/ACC-001/positions", "GET"),
        ("/api/v1/accounts/ACC-001/summary", "GET"),
        ("/api/v1/market/quote?symbol=AAPL&asset_class=EQUITY&currency=USD", "GET"),
        ("/api/v1/brokers", "GET"),
        ("/api/v1/orders", "POST"),
    ],
)
class TestEverythingRequiresAuthentication:
    def test_no_token_is_401(self, app, path, method):
        client = no_auth_client(app)
        response = client.request(method, path, json={} if method == "POST" else None)
        assert response.status_code == 401, path
        assert response.json()["error"]["code"] == "UNAUTHENTICATED"

    def test_garbage_token_is_401(self, app, path, method):
        client = no_auth_client(app)
        response = client.request(
            method,
            path,
            json={} if method == "POST" else None,
            headers={"Authorization": "Bearer not.a.jwt"},
        )
        assert response.status_code == 401, path
