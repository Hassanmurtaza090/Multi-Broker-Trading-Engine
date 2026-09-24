"""API integration tests - WebSocket event streaming.

All events are driven through REST (deterministic within the TestClient's
portal loop), so the tests assert real end-to-end synchronization: REST
action, then engine events, then hub fan-out, then WS message.
"""

from __future__ import annotations

import json
from uuid import UUID

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.integration.api.conftest import aapl_body, push_fill


def _receive_json(ws) -> dict:
    return json.loads(ws.receive_text())


class TestWebSocketConnection:
    def test_hello_contract(self, client):
        with client.websocket_connect("/ws") as ws:
            hello = _receive_json(ws)
            assert hello["control"] == "hello"
            assert hello["delivery"] == "at-least-once"
            assert hello["dedupe_key"] == "event_id"
            assert "all" in hello["topics"]

    def test_ping_pong(self, client):
        with client.websocket_connect("/ws") as ws:
            _receive_json(ws)  # hello
            ws.send_text("ping")
            assert _receive_json(ws) == {"control": "pong"}

    def test_invalid_topic_closes_4400(self, client):
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with client.websocket_connect("/ws?topics=warp") as ws:
                _receive_json(ws)
        assert excinfo.value.code == 4400


class TestWebSocketOrderEvents:
    def test_order_lifecycle_streamed_in_order(self, client):
        """REST submit + cancel -> the WS client observes the full sequence."""
        with client.websocket_connect("/ws?topics=orders") as ws:
            hello = _receive_json(ws)
            assert hello["control"] == "hello"

            created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="WS-1"))
            assert created.status_code == 201
            order_id = created.json()["client_order_id"]

            cancelled = client.post(f"/api/v1/orders/{order_id}/cancel")
            assert cancelled.status_code == 200

            submitted = _receive_json(ws)
            assert submitted["event_type"] == "order.submitted"
            assert submitted["payload"]["order"]["client_order_id"] == order_id
            assert submitted["event_id"]  # dedupe key present

            accepted = _receive_json(ws)
            assert accepted["event_type"] == "order.accepted"

            cancelled_event = _receive_json(ws)
            assert cancelled_event["event_type"] == "order.cancelled"

            # Ordering guarantee (ADR-007): submitted -> accepted -> cancelled.
            assert submitted["timestamp"] <= accepted["timestamp"] <= cancelled_event["timestamp"]

    def test_topic_filtering_excludes_other_streams(self, client):
        """An orders-only client never sees risk violations; an all-client does."""
        with client.websocket_connect("/ws?topics=orders") as orders_ws:
            with client.websocket_connect("/ws") as all_ws:
                _receive_json(orders_ws)
                _receive_json(all_ws)

                client.post("/api/v1/accounts/ACC-001/risk/kill-switch", json={"active": True})
                rejected = client.post("/api/v1/orders", json=aapl_body(idempotency_key="WS-R"))
                assert rejected.status_code == 422

                # The all-client sees the risk violation event.
                all_first = _receive_json(all_ws)
                assert all_first["event_type"] == "risk.violation"
                assert all_first["payload"]["rule"] == "kill_switch"

                # The orders-only client sees nothing: no order events exist in
                # this flow (the order was rejected before submission), and the
                # risk violation is filtered out by topic. Ping-pong proves no
                # other message is waiting.
                orders_ws.send_text("ping")
                assert _receive_json(orders_ws) == {"control": "pong"}

    def test_fan_out_to_multiple_clients(self, client):
        """Both connected clients receive the same event (identical event_id)."""
        with client.websocket_connect("/ws") as ws1:
            with client.websocket_connect("/ws") as ws2:
                _receive_json(ws1)
                _receive_json(ws2)

                created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="WS-F"))
                assert created.status_code == 201
                order_id = created.json()["client_order_id"]

                e1 = _receive_json(ws1)
                e2 = _receive_json(ws2)
                assert e1["event_type"] == "order.submitted"
                assert e2["event_type"] == "order.submitted"
                # Same engine event, same identity: clients dedupe by event_id.
                assert e1["event_id"] == e2["event_id"]
                assert e1["payload"]["order"]["client_order_id"] == order_id

    def test_positions_streamed_on_fill(self, client, sim_client, adapter, runtime):
        """Fills reach WS clients; cross-topic interleaving is the documented
        bus semantics (ADR-007): the portfolio is registered before the hub,
        so its nested reaction (position events) is queued during the dispatch
        of the fill event itself. Within each topic, engine publish order is
        preserved; clients reconcile by `event_id` and REST resync.
        """
        with client.websocket_connect("/ws?topics=positions,orders") as ws:
            _receive_json(ws)
            created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="WS-P"))
            body = created.json()
            order = runtime.oms.get_order(UUID(body["client_order_id"]))

            # Submission-driven events first (single topic: strict order).
            submitted = _receive_json(ws)
            assert submitted["event_type"] == "order.submitted"
            accepted = _receive_json(ws)
            assert accepted["event_type"] == "order.accepted"

            # Partial fill (4): the portfolio's nested reaction is queued
            # during the dispatch of order.partially_filled, so the position
            # event arrives first — the documented cross-topic interleave.
            push_fill(
                client,
                sim_client,
                adapter,
                int(body["broker_order_id"]),
                order,
                quantity="4",
                cum="4",
            )
            opened = _receive_json(ws)
            assert opened["event_type"] == "position.opened"
            partial = _receive_json(ws)
            assert partial["event_type"] == "order.partially_filled"

            # Completing fill (6): same documented interleave.
            push_fill(
                client,
                sim_client,
                adapter,
                int(body["broker_order_id"]),
                order,
                quantity="6",
                cum="10",
            )
            updated = _receive_json(ws)
            assert updated["event_type"] == "position.updated"
            filled = _receive_json(ws)
            assert filled["event_type"] == "order.filled"

            # Within-topic order is engine-consistent (timestamps monotonic
            # per topic). Cross-topic delivery interleaves nested reactions by
            # design, so only per-topic monotonicity is guaranteed.
            order_stamps = [
                submitted["timestamp"],
                accepted["timestamp"],
                partial["timestamp"],
                filled["timestamp"],
            ]
            position_stamps = [opened["timestamp"], updated["timestamp"]]
            assert order_stamps == sorted(order_stamps)
            assert position_stamps == sorted(position_stamps)
