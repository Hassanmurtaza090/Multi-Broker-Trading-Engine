"""M13 recovery scenarios across boundaries, on BOTH brokers.

Broker disconnection mid-flight -> reconnect -> reconciliation; broker-side
state changes picked up by polling; WS client reconnect with a fresh ticket
and continued event flow (the documented client resync path).
"""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import UUID

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import json


def run(coro):
    import asyncio
    return asyncio.run(coro)


def _receive_json(ws) -> dict:
    return json.loads(ws.receive_text())


class TestBrokerRecovery:
    def test_disconnect_and_reconnect_with_working_order(self, stack):
        """A working order survives a broker outage: the disconnect is
        published, health degrades, and after reconnect the state replay
        keeps the order intact and the balance restored."""
        created = stack.submit(idempotency_key="REC-1")
        order = created.json()

        with stack.ws_connect() as ws:
            _receive_json(ws)  # hello
            stack.sim.simulate_unexpected_disconnect()
            stack.drain()

            disconnected = _receive_json(ws)
            assert disconnected["event_type"] == "broker.disconnected"
            health = stack.client.get("/api/v1/health").json()
            assert health["broker_connected"] is False
            assert health["status"] == "degraded"

            stack.reconnect_broker()
            stack.drain()

            reconnected = _receive_json(ws)
            assert reconnected["event_type"] == "broker.connected"
            health = stack.client.get("/api/v1/health").json()
            assert health["broker_connected"] is True

        # The working order is untouched by the outage (state replay).
        state = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
        assert state["status"] == "SUBMITTED"
        assert state["broker_order_id"] == order["broker_order_id"]

        # Balance was replayed on reconnect (broker account snapshot).
        balance = stack.client.get("/api/v1/accounts/ACC-001/balance")
        assert balance.status_code == 200

        # Fills still flow after recovery.
        domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
        stack.push_fill(int(order["broker_order_id"]), domain_order,
                        quantity="10", cum="10")
        final = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
        assert final["status"] == "FILLED"

    def test_broker_side_cancellation_detected_via_reconciliation(self, stack):
        """The broker cancels out-of-band (no callback delivery — the
        documented poll/replay design, ADR-014/015); M5 reconciliation
        detects it on the next sweep and the OMS state follows (TS-006)."""
        created = stack.submit(idempotency_key="REC-2")
        order = created.json()
        broker_order_id = int(order["broker_order_id"])

        stack.sim.force_status(broker_order_id, "Cancelled")
        stack.reconcile()

        state = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
        assert state["status"] == "CANCELLED"

    def test_duplicate_state_replay_after_reconnect_delivers_once(self, stack):
        """The adapter's reconnect state replay must not double-apply: after
        reconnect, the order state is consistent and repeat replays are
        deduped (M8/M9 dedup guarantees at the stack level)."""
        created = stack.submit(idempotency_key="REC-3")
        order = created.json()
        broker_order_id = int(order["broker_order_id"])

        # A fill lands, then the broker drops and reconnects (replay includes
        # the execution we already applied).
        domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
        stack.push_fill(broker_order_id, domain_order, quantity="4", cum="4")

        stack.sim.simulate_unexpected_disconnect()
        stack.drain()
        stack.reconnect_broker()
        stack.drain()
        # Some clients replay open orders/executions on reconnect — do it
        # twice to prove idempotent handling.
        stack.reconnect_broker()
        stack.drain()

        state = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
        assert state["status"] == "PARTIALLY_FILLED"
        assert state["filled_quantity"].rstrip("0").rstrip(".") in {"4", "4.0"}
        positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert positions[0]["quantity"].rstrip("0").rstrip(".") in {"4", "4.0"}


class TestWsClientRecovery:
    def test_client_reconnect_with_fresh_ticket_continues_stream(self, stack):
        """The documented client recovery (ADR-016): a WS client that drops
        reconnects with a NEW single-use ticket and receives subsequent
        events; REST resync fills anything missed."""
        created = stack.submit(idempotency_key="WS-REC-1")
        order_id = created.json()["client_order_id"]

        with stack.ws_connect() as first:
            _receive_json(first)  # hello

        # Connection lost client-side; a NEW ticket is required (single-use).
        with stack.ws_connect() as second:
            hello = _receive_json(second)
            assert hello["control"] == "hello"

            # New activity streams to the RECONNECTED client.
            cancel = stack.client.post(f"/api/v1/orders/{order_id}/cancel")
            assert cancel.status_code == 200
            event = _receive_json(second)
            assert event["event_type"] == "order.cancelled"
            assert event["payload"]["order"]["client_order_id"] == order_id

        # REST resync is authoritative for anything missed while offline.
        state = stack.client.get(f"/api/v1/orders/{order_id}").json()
        assert state["status"] == "CANCELLED"


class TestErrorPropagation:
    def test_api_error_shape_is_stable_across_boundaries(self, stack):
        """Errors from every layer surface with the stable envelope and
        code — no internals leak regardless of where the failure happened."""
        # Domain validation (M1) -> 400
        zero = stack.submit(quantity="0")
        assert zero.json()["error"]["code"] == "INVALID_ARGUMENT"
        # Unknown resource -> 404 (the stable order code)
        missing = stack.client.get(f"/api/v1/orders/{UUID(int=0)}")
        assert missing.json()["error"]["code"] == "ORDER_NOT_FOUND"
        # Unauthorized (M12) -> 401 with a generic message
        from fastapi.testclient import TestClient

        anon = TestClient(stack.app)
        denied = anon.get("/api/v1/orders")
        assert denied.status_code == 401
        assert denied.json()["error"]["code"] == "UNAUTHENTICATED"
        assert denied.json()["error"]["message"] == "authentication required"
