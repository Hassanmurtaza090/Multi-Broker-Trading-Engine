"""M16 E2E — real-time WebSocket, failure/recovery, and security boundaries.

Runs on the LIVE production stack: WS streaming + client reconnect with a
fresh ticket, backend restart with persisted state (PostgreSQL), database
restart, authentication expiration, cross-account isolation, and the
edge posture (metrics/docs 404).
"""

from __future__ import annotations

import os
import socket
import ssl
import sys
import time
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import (  # noqa: E402
    ADMIN,
    ACCOUNT,
    BROKER,
    OUTSIDER,
    Client,
    backend_container,
    order_body,
    record,
    restart_backend,
    restart_postgres,
    wait_for,
    wait_ready,
)


def _ws_connect(ticket: str):
    """Raw WSS client (threading socket) sufficient for scenario asserts."""
    import base64
    import os

    from urllib.parse import urlparse

    parsed = urlparse(f"wss://localhost:8443/ws?topics=all&ticket={ticket}")
    host, port = parsed.hostname, parsed.port or 443
    raw = socket.create_connection((host, port), timeout=10)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    tls = ctx.wrap_socket(raw, server_hostname=host)
    key = base64.b64encode(os.urandom(16)).decode()
    request = (
        f"GET {parsed.path}?{parsed.query} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    tls.sendall(request.encode())
    response = tls.recv(2048).decode("utf-8", errors="replace")
    return tls, response


def _read_frame_raw(tls, timeout: float = 10.0):
    """(opcode, payload) for control/data frames; None on timeout/close."""
    tls.settimeout(timeout)
    try:
        header = tls.recv(2)
        if len(header) < 2:
            return None
        opcode = header[0] & 0x0F
        length = header[1] & 0x7F
        if length == 126:
            length = int.from_bytes(tls.recv(2), "big")
        elif length == 127:
            length = int.from_bytes(tls.recv(8), "big")
        payload = b""
        while len(payload) < length:
            chunk = tls.recv(length - len(payload))
            if not chunk:
                break
            payload += chunk
        return (opcode, payload)
    except (socket.timeout, OSError):
        return None


def _read_frame(tls, timeout: float = 10.0) -> str | None:
    """Minimal WS text-frame reader (server frames are unmasked, len<126
    or 126/127 extended; enough for scenario payloads)."""
    tls.settimeout(timeout)
    try:
        header = tls.recv(2)
        if len(header) < 2:
            return None
        opcode = header[0] & 0x0F
        length = header[1] & 0x7F
        if length == 126:
            length = int.from_bytes(tls.recv(2), "big")
        elif length == 127:
            length = int.from_bytes(tls.recv(8), "big")
        payload = b""
        while len(payload) < length:
            chunk = tls.recv(length - len(payload))
            if not chunk:
                break
            payload += chunk
        if opcode == 0x1:
            return payload.decode("utf-8", errors="replace")
        return None
    except (socket.timeout, OSError):
        return None


def test_e2e_ws_streaming(trader: Client) -> None:
    """Real-time updates reach an authorized WS client through the TLS
    edge: the hello contract, then a live order-lifecycle burst driven by a
    REAL submission."""
    import json as _json

    ticket = trader.ws_ticket()
    tls, handshake = _ws_connect(ticket)
    upgraded = "101" in handshake.split("\r\n")[0]
    record(
        "websocket handshake (WSS through the edge)",
        "WSS connect with a single-use ticket",
        "HTTP 101 upgrade",
        handshake.split("\r\n")[0],
        upgraded,
    )
    hello_raw = _read_frame(tls)
    hello = _json.loads(hello_raw) if hello_raw else {}
    record(
        "websocket hello contract",
        "first frame",
        "control=hello, dedupe_key=event_id",
        str(hello)[:100],
        hello.get("control") == "hello" and hello.get("dedupe_key") == "event_id",
    )

    key = f"E2E-WS-{uuid4().hex[:8]}"
    trader.http("POST", "/api/v1/orders", order_body(key))
    frames: list[str] = []
    deadline = time.time() + 25
    while time.time() < deadline:
        frame = _read_frame(tls, timeout=3.0)
        if frame is None:
            if frames:
                break
            continue
        frames.append(frame)
        if '"order.accepted"' in frame:
            break
    types = [_json.loads(f).get("event_type") for f in frames]
    record(
        "websocket order lifecycle streaming",
        "submit an order while streaming topics=all",
        "order.submitted then order.accepted, in engine order",
        f"events={types}",
        "order.submitted" in types and "order.accepted" in types
        and types.index("order.submitted") < types.index("order.accepted"),
    )
    tls.close()
    # Cancel to leave a clean ledger.
    from test_lifecycle import _get_order, _order_status  # noqa: E402

    order_id = None
    for f in frames:
        event = _json.loads(f)
        if event.get("event_type") == "order.submitted":
            order_id = event["payload"]["order"]["client_order_id"]
            break
    if order_id is not None:
        wait_for(lambda: _order_status(trader, order_id) in ("CANCELLED", "FILLED"),
                timeout=20, interval=1.0) or trader.http(
            "POST", f"/api/v1/orders/{order_id}/cancel")
        wait_for(lambda: _order_status(trader, order_id) in ("CANCELLED", "FILLED"),
                 timeout=20, interval=1.0)


def test_e2e_backend_restart_persistence(trader: Client) -> None:
    """Backend restart: the process dies and comes back healthy; orders
    PERSIST (PostgreSQL, ADR-010) and the API serves them; access JWTs stay
    valid (stable signing secret); users re-login (in-memory sessions by
    design)."""
    from test_lifecycle import _get_order  # noqa: E402

    key = f"E2E-RESTART-{uuid4().hex[:8]}"
    status, _, order = trader.http("POST", "/api/v1/orders", order_body(key))
    order_id = order["client_order_id"]
    # Let the sim fill it so the persisted state is terminal + interesting.
    wait_for(
        lambda: _get_order(trader, order_id).get("status") == "FILLED",
        timeout=30, interval=1.5,
    )

    restart_backend()
    ready = wait_ready(trader)
    record(
        "backend restart recovery",
        "docker restart backend; GET /ready",
        "healthy again with database ok",
        str(ready),
        ready.get("status") == "ready" and ready.get("database") == "ok",
    )

    # Access token still valid (stable secret) — read the persisted order.
    status, _, reloaded = trader.http("GET", f"/api/v1/orders/{order_id}")
    record(
        "orders persist across backend restart",
        "GET /orders/{id} after restart (same bearer)",
        "200, FILLED, quantities intact",
        f"status={status}: {str(reloaded)[:100]}",
        status == 200
        and reloaded.get("status") == "FILLED"
        and reloaded.get("filled_quantity") == reloaded.get("quantity"),
    )

    # A duplicate replay after the restart must still deduplicate.
    status_replay, _, replay = trader.http("POST", "/api/v1/orders", order_body(key))
    record(
        "idempotency binding survives restart",
        "POST the SAME idempotency key after restart",
        "200 replay, same order id",
        f"status={status_replay}; ids_match={replay.get('client_order_id') == order_id}",
        status_replay == 200 and replay.get("client_order_id") == order_id,
    )


def test_e2e_database_restart(trader: Client) -> None:
    """PostgreSQL restart: readiness degrades (database unavailable ->
    starting) and recovers; the engine keeps serving from memory."""
    restart_postgres()
    degraded = wait_for(
        _ready_degraded(trader), timeout=45, interval=2.0,
    )
    record(
        "database restart: readiness degradation",
        "docker restart postgres; GET /ready",
        "database=unavailable + status=starting while down",
        str(degraded)[:100],
        degraded is not None,
    )
    recovered = wait_ready(trader, timeout=90)
    record(
        "database restart: recovery",
        "GET /ready after the DB is back",
        "database=ok + status=ready",
        str(recovered),
        recovered.get("status") == "ready" and recovered.get("database") == "ok",
    )


def _ready_degraded(trader: Client):
    def check():
        _, _, ready = trader.http("GET", "/ready")
        if isinstance(ready, dict) and ready.get("database") == "unavailable":
            return ready
        return None
    return check


def test_e2e_authentication_and_isolation(trader: Client, admin: Client) -> None:
    """Security boundaries on the live stack: no-token 401s, tampered-token
    401s, viewer-role read-only, cross-account isolation (REST + IDOR),
    and the edge 404s for the metrics/docs surfaces."""
    anon = Client()
    status, _, body = anon.http("GET", "/api/v1/health")
    record(
        "unauthenticated access denied",
        "GET /api/v1/health with no token",
        "401 UNAUTHENTICATED",
        f"status={status}: {str(body)[:80]}",
        status == 401,
    )

    tampered = Client()
    tampered.token = (trader.token or "")[:-3] + "abc"
    status, _, _ = tampered.http("GET", "/api/v1/orders")
    record(
        "tampered token rejected",
        "GET /orders with a corrupted signature",
        "401 (signature verification)",
        f"status={status}",
        status == 401,
    )

    viewer = Client()
    viewer.login({"username": "viewer", "password": os.environ.get("E2E_VIEWER_PASSWORD", "e2e-viewer-pass")})
    status, _, _ = viewer.http("POST", "/api/v1/orders", order_body(f"E2E-VIEW-{uuid4().hex[:8]}"))
    record(
        "viewer role cannot trade",
        "viewer (read-only role) POST /orders",
        "403 FORBIDDEN (missing orders:write)",
        f"status={status}",
        status == 403,
    )

    outsider = Client()
    outsider.login(OUTSIDER)
    status, _, _ = outsider.http("GET", f"/api/v1/accounts/{ACCOUNT}/positions")
    record(
        "cross-account isolation (REST)",
        "outsider (ACC-OTHER) GET /accounts/ACC-001/positions",
        "403 (no cross-account reads)",
        f"status={status}",
        status == 403,
    )

    # IDOR via cancel: an outsider with a valid order id cannot act on it.
    key = f"E2E-IDOR-{uuid4().hex[:8]}"
    _, _, victim = trader.http("POST", "/api/v1/orders", order_body(key))
    status, _, _ = outsider.http(
        "POST", f"/api/v1/orders/{victim['client_order_id']}/cancel"
    )
    record(
        "IDOR protection (order actions)",
        "outsider cancels another account's order id",
        "403 (resource-level authorization)",
        f"status={status}",
        status == 403,
    )
    from test_lifecycle import _order_status  # noqa: E402

    if _order_status(trader, victim["client_order_id"]) in ("SUBMITTED", "PARTIALLY_FILLED"):
        wait_for(
            lambda: _order_status(trader, victim["client_order_id"]) in ("CANCELLED", "FILLED"),
            timeout=25, interval=1.0,
        ) or trader.http("POST", f"/api/v1/orders/{victim['client_order_id']}/cancel")
        wait_for(
            lambda: _order_status(trader, victim["client_order_id"]) in ("CANCELLED", "FILLED"),
            timeout=20, interval=1.0,
        )

    # Cross-account WS: the outsider's session cannot stream ACC-001 events.
    ticket = outsider.ws_ticket()
    tls, handshake = _ws_connect(ticket)
    # The authz close happens AFTER the 101 upgrade (accept-then-check, the
    # M12 design): read past the handshake to the close frame.
    frame = _read_frame_raw(tls, timeout=5.0)
    close_code = None
    if frame is not None and frame[0] == 0x8 and len(frame[1]) >= 2:
        close_code = int.from_bytes(frame[1][:2], "big")
    denied = close_code == 4403
    record(
        "cross-account isolation (WebSocket)",
        "outsider opens /ws with a valid ticket (ACC-OTHER scope)",
        "101 upgrade then CLOSE 4403 (no registration)",
        f"handshake={handshake.splitlines()[0]}; close_code={close_code}",
        denied,
    )
    tls.close()

    status, _, _ = trader.http("GET", "/metrics")
    edge = Client()
    status_m, _, _ = edge.http("GET", "/metrics")
    status_d, _, _ = edge.http("GET", "/docs")
    record(
        "edge posture: operational surfaces unreachable",
        "GET /metrics and /docs through the TLS edge",
        "404 for both (in-cluster only)",
        f"metrics={status_m}, docs={status_d}",
        status_m == 404 and status_d == 404,
    )


def test_e2e_performance_smoke(trader: Client) -> None:
    """Roadmap performance smoke (NOT load testing): submission latency
    through the full risk gate, and 5 concurrent submissions staying
    consistent. Thresholds are generous for a local containerized stack;
    they gate REGRESSIONS, not absolute speed."""
    # Warm the connection + login paths (PBKDF2 is deliberately expensive).
    trader.http("GET", "/api/v1/brokers")

    samples: list[float] = []
    for i in range(10):
        key = f"E2E-PERF-{uuid4().hex[:8]}-{i}"
        t0 = time.time()
        status, _, order = trader.http("POST", "/api/v1/orders", order_body(key))
        dt = (time.time() - t0) * 1000
        if status in (200, 201):
            samples.append(dt)
        # clean up immediately (no fill side effects needed for latency)
        trader.http("POST", f"/api/v1/orders/{order['client_order_id']}/cancel")
        wait_for(
            lambda oid=order["client_order_id"]: _terminal(trader, oid),
            timeout=20, interval=0.5,
        )
    samples.sort()
    p95 = samples[int(len(samples) * 0.95) - 1] if samples else 0
    record(
        "performance smoke: submit latency p95",
        "10 sequential risk-gated submissions",
        "p95 < 1500ms (local containerized stack, regression gate)",
        f"p95={p95:.0f}ms over {len(samples)} samples",
        p95 < 1500,
    )

    import concurrent.futures

    keys = [f"E2E-PERF-PAR-{uuid4().hex[:8]}-{i}" for i in range(5)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(
            pool.map(
                lambda k: trader.http("POST", "/api/v1/orders", order_body(k)),
                keys,
            )
        )
    statuses = [r[0] for r in results]
    _, _, listed = trader.http("GET", "/api/v1/orders")
    ids = [r[2]["client_order_id"] for r in results if isinstance(r[2], dict)]
    unique_ids = len(set(ids))
    record(
        "performance smoke: 5 concurrent submissions",
        "parallel POST /orders with distinct keys",
        "all 201/200, 5 distinct ids, no corruption",
        f"statuses={statuses}; distinct_ids={unique_ids}",
        all(s in (200, 201) for s in statuses) and unique_ids == 5,
    )
    for oid in ids:
        trader.http("POST", f"/api/v1/orders/{oid}/cancel")
        wait_for(lambda oid=oid: _terminal(trader, oid), timeout=20, interval=0.5)


def _terminal(trader: Client, order_id: str) -> bool:
    from test_lifecycle import _order_status  # noqa: E402

    return _order_status(trader, order_id) in ("CANCELLED", "FILLED")

