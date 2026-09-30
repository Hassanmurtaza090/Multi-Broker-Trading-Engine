"""Integration tests — authorization matrix (M12): role permissions, account
scope, and IDOR guards. All enforcement is server-side; these tests prove
the boundary holds even for a fully authenticated caller.

Principals:
- trader   : trader role, ACC-001
- viewer   : viewer role, ACC-001 (read-only)
- outsider : trader role, ACC-OTHER (authenticated, different account)
- admin    : admin role, wildcard
"""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.integration.api.conftest import aapl_body


class TestRoleBoundaries:
    """Viewer is read-only; trader trades but never admins; admin does all."""

    def test_viewer_reads_positions(self, viewer_client):
        assert viewer_client.get("/api/v1/accounts/ACC-001/positions").status_code == 200

    def test_viewer_cannot_submit_orders(self, viewer_client):
        response = viewer_client.post("/api/v1/orders", json=aapl_body())
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
        assert "orders:write" in response.json()["error"]["message"]

    def test_viewer_cannot_cancel_or_modify(self, client, viewer_client):
        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="A-V1"))
        order_id = created.json()["client_order_id"]
        assert (
            viewer_client.post(f"/api/v1/orders/{order_id}/cancel").status_code == 403
        )
        assert (
            viewer_client.post(
                f"/api/v1/orders/{order_id}/modify", json={"limit_price": "99"}
            ).status_code
            == 403
        )

    def test_viewer_cannot_dry_run_risk(self, viewer_client):
        response = viewer_client.post(
            "/api/v1/accounts/ACC-001/risk/evaluate", json=aapl_body()
        )
        assert response.status_code == 403

    def test_trader_cannot_activate_kill_switch(self, client):
        response = client.post(
            "/api/v1/accounts/ACC-001/risk/kill-switch", json={"active": True}
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
        assert "risk:admin" in response.json()["error"]["message"]
        # State is untouched: still inactive.
        assert client.get("/api/v1/accounts/ACC-001/risk/kill-switch").json()["active"] is False

    def test_trader_can_read_kill_switch(self, client):
        assert client.get("/api/v1/accounts/ACC-001/risk/kill-switch").status_code == 200

    def test_admin_can_activate_and_deactivate_kill_switch(self, admin_client):
        activated = admin_client.post(
            "/api/v1/accounts/ACC-001/risk/kill-switch", json={"active": True}
        )
        assert activated.status_code == 200
        assert activated.json()["active"] is True
        deactivated = admin_client.post(
            "/api/v1/accounts/ACC-001/risk/kill-switch", json={"active": False}
        )
        assert deactivated.json()["active"] is False

    def test_unknown_role_cannot_even_be_provisioned(self):
        """RBAC is fail-closed at BOTH layers: unknown roles are rejected at
        provisioning time, and even if one slipped through, it grants no
        permissions (verified at the unit layer below)."""
        import pytest

        from api.auth import UserDirectory, demo_record
        from api.security import permissions_for_roles

        with pytest.raises(ValueError, match="unknown roles"):
            UserDirectory(
                [demo_record("mallory", "pw", roles=["superuser"], accounts=["ACC-001"])]
            )
        # Defense in depth: the role→permission map itself grants nothing
        # for unknown roles.
        assert permissions_for_roles(frozenset({"superuser"})) == frozenset()


class TestAccountIsolation:
    """Cross-account access is impossible even with a valid token (IDOR)."""

    def test_outsider_cannot_read_other_account_positions(self, outsider_client):
        response = outsider_client.get("/api/v1/accounts/ACC-001/positions")
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"

    def test_outsider_cannot_read_balance_or_summary(self, outsider_client):
        assert outsider_client.get("/api/v1/accounts/ACC-001/balance").status_code == 403
        assert outsider_client.get("/api/v1/accounts/ACC-001/summary").status_code == 403

    def test_outsider_cannot_submit_order_on_other_account(self, outsider_client):
        response = outsider_client.post("/api/v1/orders", json=aapl_body())
        assert response.status_code == 403

    def test_outsider_cannot_read_kill_switch_of_other_account(self, outsider_client):
        response = outsider_client.get("/api/v1/accounts/ACC-001/risk/kill-switch")
        assert response.status_code == 403

    def test_idor_cancel_order_of_other_account(self, client, outsider_client):
        """Outsider knows a valid order id but must NOT be able to act on it."""
        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="A-IDOR"))
        order_id = created.json()["client_order_id"]
        assert (
            outsider_client.post(f"/api/v1/orders/{order_id}/cancel").status_code == 403
        )
        # Untouched: still SUBMITTED.
        order = client.get(f"/api/v1/orders/{order_id}").json()
        assert order["status"] == "SUBMITTED"

    def test_idor_get_and_modify_order_of_other_account(self, client, outsider_client):
        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="A-IDOR2"))
        order_id = created.json()["client_order_id"]
        assert outsider_client.get(f"/api/v1/orders/{order_id}").status_code == 403
        assert (
            outsider_client.post(
                f"/api/v1/orders/{order_id}/modify", json={"limit_price": "1"}
            ).status_code
            == 403
        )

    def test_listing_filters_to_caller_scope(self, client, admin_client):
        client.post("/api/v1/orders", json=aapl_body(idempotency_key="A-SCOPE"))
        other = aapl_body(idempotency_key="A-SCOPE2")
        other["account_id"] = "OTHER"
        admin_client.post("/api/v1/orders", json=other)

        # Trader (ACC-001) sees only ACC-001 orders without a filter.
        listed = client.get("/api/v1/orders").json()
        assert {o["account_id"] for o in listed} == {"ACC-001"}

        # Explicit request for the other account is a 403, not a filtered 200.
        assert client.get("/api/v1/orders?account_id=OTHER").status_code == 403

        # Admin sees both.
        assert len(admin_client.get("/api/v1/orders").json()) >= 2

    def test_idempotent_replay_cannot_cross_accounts(self, admin_client, outsider_client):
        """Replaying another account's idempotency key must not leak the order."""
        created = admin_client.post(
            "/api/v1/orders", json=aapl_body(idempotency_key="A-XKEY")
        )
        assert created.status_code == 201
        replay = outsider_client.post(
            "/api/v1/orders",
            json={**aapl_body(idempotency_key="A-XKEY"), "account_id": "ACC-OTHER"},
        )
        assert replay.status_code == 403
        assert "client_order_id" not in replay.json()

    def test_admin_wildcard_reaches_all_accounts(self, admin_client):
        assert admin_client.get("/api/v1/accounts/ACC-001/positions").status_code == 200
        assert admin_client.get("/api/v1/accounts/ANY-OTHER/positions").status_code == 200

    def test_unknown_order_id_is_404_for_authorized_caller(self, client):
        assert client.get(f"/api/v1/orders/{uuid4()}").status_code == 404
