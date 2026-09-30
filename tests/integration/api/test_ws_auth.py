"""Integration tests — WebSocket authorization (M12).

A valid REST session does NOT imply stream access: the WS endpoint demands a
fresh single-use ticket, checks the runtime's account scope, and closes with
4401/4403 otherwise. Validated AFTER accept (the M10 4xxx close pattern).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from starlette.websockets import WebSocketDisconnect

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.integration.api.conftest import ws_connect


def _receive_json(ws) -> dict:
    import json

    return json.loads(ws.receive_text())


class TestWsAuthentication:
    def test_no_ticket_closes_4401(self, client):
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with client.websocket_connect("/ws") as ws:
                _receive_json(ws)
        assert excinfo.value.code == 4401

    def test_garbage_ticket_closes_4401(self, client):
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with client.websocket_connect("/ws?ticket=wst_forged") as ws:
                _receive_json(ws)
        assert excinfo.value.code == 4401

    def test_ticket_is_single_use(self, client):
        ticket = client.post("/api/v1/auth/ws-ticket").json()["ticket"]
        with client.websocket_connect(f"/ws?ticket={ticket}") as ws:
            hello = _receive_json(ws)
            assert hello["control"] == "hello"
        # Replay of the SAME ticket is rejected even after a clean disconnect.
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with client.websocket_connect(f"/ws?ticket={ticket}") as ws:
                _receive_json(ws)
        assert excinfo.value.code == 4401

    def test_expired_ticket_closes_4401(self, client, app):
        from datetime import timedelta

        from api.tokens import TokenService

        # Issue a ticket, then expire it by moving the service clock.
        service = app.state.auth.tokens
        clock = service._clock  # test seam: deterministic expiry
        original = clock
        ticket = client.post("/api/v1/auth/ws-ticket").json()["ticket"]

        class Advanced:
            def __call__(self):
                return original() + timedelta(seconds=60)

        service._clock = Advanced()  # type: ignore[assignment]
        try:
            with pytest.raises(WebSocketDisconnect) as excinfo:
                with client.websocket_connect(f"/ws?ticket={ticket}") as ws:
                    _receive_json(ws)
            assert excinfo.value.code == 4401
        finally:
            service._clock = original  # type: ignore[assignment]


class TestWsAccountScope:
    def test_outsider_cannot_connect_to_runtime_account(self, outsider_client):
        # Authenticated with trader role — but scoped to ACC-OTHER, while the
        # runtime's stream belongs to ACC-001. Close 4403, never registered.
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with ws_connect(outsider_client) as ws:
                _receive_json(ws)
        assert excinfo.value.code == 4403

    def test_viewer_with_scope_can_connect(self, viewer_client):
        with ws_connect(viewer_client) as ws:
            hello = _receive_json(ws)
            assert hello["control"] == "hello"

    def test_authorization_precedes_topic_validation(self, outsider_client):
        # A bad topic on an unauthorized connection still yields the AUTH
        # close code (auth is checked first), proving order of enforcement.
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with ws_connect(outsider_client, "/ws?topics=warp") as ws:
                _receive_json(ws)
        assert excinfo.value.code == 4403

    def test_authorized_flow_still_streams_events(self, client):
        from tests.integration.api.conftest import aapl_body

        with ws_connect(client, "/ws?topics=orders") as ws:
            _receive_json(ws)  # hello
            created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="W-AUTH-1"))
            assert created.status_code == 201
            event = _receive_json(ws)
            assert event["event_type"] == "order.submitted"
            assert event["event_id"]
