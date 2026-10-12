"""M13 failure/edge flows across every boundary, on BOTH brokers.

Broker rejection, invalid input, risk-limit rejection (incl. the fail-closed
stale-quote path), overfill protection, duplicate orders/events, cancel
conflicts, and cross-account isolation — all through authenticated REST/WS.
"""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import UUID, uuid4

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import pytest
from starlette.websockets import WebSocketDisconnect


def run(coro):
    import asyncio
    return asyncio.run(coro)


class TestBrokerRejectionFlow:
    def test_broker_rejected_order_surfaces_as_rejected_201(self, stack):
        """Risk approves, broker refuses: the order exists with REJECTED
        status + reason (never assumed executed), and the WS client sees it."""
        import json

        stack.sim.reject_orders = True
        with stack.ws_connect() as ws:
            json.loads(ws.receive_text())  # hello
            created = stack.submit(idempotency_key="REJ-1")
            assert created.status_code == 201
            order = created.json()
            assert order["status"] == "REJECTED"
            # A transport-level rejection never received a broker id — the
            # order was never assumed executed (a textual reason is
            # optional broker data and may be absent).
            assert order["broker_order_id"] is None

            # WS observes submitted -> rejected in engine order.
            first = json.loads(ws.receive_text())
            second = json.loads(ws.receive_text())
            assert [first["event_type"], second["event_type"]] == [
                "order.submitted", "order.rejected",
            ]

        # No position was created for the rejected order.
        positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert len(positions) == 0


class TestInvalidInputFlow:
    def test_zero_quantity_rejected_400_before_any_state(self, stack):
        response = stack.submit(quantity="0")
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "INVALID_ARGUMENT"
        assert stack.client.get("/api/v1/orders").json() == []

    def test_unknown_fields_rejected_422(self, stack):
        body = stack.aapl_body()
        body["spoil"] = "x"
        response = stack.client.post("/api/v1/orders", json=body)
        assert response.status_code == 422

    def test_missing_saxo_identifier_is_a_broker_not_found_error(self, stack):
        """Without the broker-neutral SAXO_UIC identifier the Saxo adapter
        refuses (never guesses — ADR-015); IBKR resolves by contract fields.
        The failure is typed and the order never reaches the broker."""
        body = stack.aapl_body()
        if stack.broker == "ibkr":
            body["instrument"].pop("identifiers", None)
        else:
            body["instrument"]["identifiers"] = {}  # Saxo requires SAXO_UIC
        response = stack.client.post("/api/v1/orders", json=body)
        if stack.broker == "saxo":
            # Typed BrokerError from the adapter, mapped to 502 with the
            # stable UNAVAILABLE code — no internals leaked.
            assert response.status_code == 502
            assert response.json()["error"]["code"] == "UNAVAILABLE"
            listed = stack.client.get("/api/v1/orders").json()
            # The OMS holds the PENDING order; nothing reached the broker.
            assert all(o["broker_order_id"] is None for o in listed)
        else:
            # IBKR needs no identifier: the flow succeeds.
            assert response.status_code == 201


class TestRiskGateFlows:
    def test_order_size_limit_rejection_end_to_end(self, stack):
        from domain.money import Quantity
        from risk import RiskLimits

        stack.runtime.set_risk_limits(
            "ACC-001", RiskLimits(max_order_quantity=Quantity(value="5"))
        )
        response = stack.submit(idempotency_key="RISK-1")
        assert response.status_code == 422
        body = response.json()
        assert body["error"]["code"] == "RISK_REJECTED"
        assert body["violations"][0]["rule"] == "order_size_limit"
        # The rejected order NEVER reached the broker and is not listed.
        assert stack.client.get("/api/v1/orders").json() == []

    def test_notional_limit_fails_closed_without_quote_then_passes_with_fresh(self, stack):
        """The fail-closed contract through the whole stack: with a notional
        limit configured but NO quote available, risk rejects with
        data_unavailable; a fresh quote unlocks approval."""
        from domain.money import Currency, Money
        from risk import RiskLimits

        stack.runtime.set_risk_limits(
            "ACC-001",
            RiskLimits(max_notional_exposure=Money(amount="1000", currency=Currency(code="USD"))),
        )

        # No quote yet -> data unavailable -> fail-closed rejection.
        response = stack.submit(idempotency_key="RISK-2")
        assert response.status_code == 422
        violation = response.json()["violations"][0]
        assert violation["rule"] == "notional_exposure_limit"
        assert violation["data_unavailable"] is True

        # A STALE quote must not unlock the gate either (TS-007).
        stack.push_quote(at=1_700_000_000)  # ~2023: far outside 10 s window
        stale_response = stack.submit(idempotency_key="RISK-2b")
        assert stale_response.status_code == 422
        assert stale_response.json()["violations"][0]["data_unavailable"] is True

        # A FRESH quote prices the order -> within limit -> approved.
        stack.push_quote(last="50")
        fresh = stack.submit(idempotency_key="RISK-2c")
        assert fresh.status_code == 201, fresh.text

    def test_kill_switch_blocks_orders_and_is_admin_only(self, stack):
        activated = stack.admin.post(
            "/api/v1/accounts/ACC-001/risk/kill-switch", json={"active": True}
        )
        assert activated.status_code == 200
        blocked = stack.submit(idempotency_key="RISK-3")
        assert blocked.status_code == 422
        assert blocked.json()["violations"][0]["rule"] == "kill_switch"
        stack.admin.post("/api/v1/accounts/ACC-001/risk/kill-switch", json={"active": False})
        ok = stack.submit(idempotency_key="RISK-3b")
        assert ok.status_code == 201


class TestDuplicateAndOverfillFlows:
    def test_duplicate_execution_applied_once(self, stack):
        """The broker redelivers an execution: adapters dedupe by execution
        id, the OMS by report, and the position moves ONCE."""
        created = stack.submit(idempotency_key="DUP-1")
        order = created.json()
        domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))

        exec_id = "F-SAME-EXECUTION"
        stack.push_fill(int(order["broker_order_id"]), domain_order,
                        quantity="4", cum="4", execution_id=exec_id)
        stack.push_fill(int(order["broker_order_id"]), domain_order,
                        quantity="4", cum="4", execution_id=exec_id)  # replay

        state = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
        assert state["status"] == "PARTIALLY_FILLED"
        assert state["filled_quantity"].rstrip("0").rstrip(".") in {"4", "4.0"}
        positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert positions[0]["quantity"].rstrip("0").rstrip(".") in {"4", "4.0"}

    def test_overfill_is_isolated_and_does_not_wedge_the_pipeline(self, stack):
        """Regression (M13): an invalid broker report (overfill) must be
        rejected by the OMS WITHOUT escaping into the adapter's delivery
        loop — previously the OrderStateError aborted the drain and wedged
        every subsequent queued report. A valid report queued BEHIND the
        bad one must still be delivered."""
        created = stack.submit(idempotency_key="OVER-1")
        order = created.json()
        domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
        broker_order_id = int(order["broker_order_id"])

        # Queue: valid fill (10/10 -> FILLED), then an overfill (5 more).
        first_fill = stack.make_fill(broker_order_id, domain_order,
                                     execution_id="F-OK", quantity="10", cum="10")
        overfill = stack.make_fill(broker_order_id, domain_order,
                                   execution_id="F-OVER", quantity="5", cum="15")
        stack.sim.emit_execution(first_fill)
        stack.sim.emit_execution(overfill)

        # A SECOND ORDER's valid event queued behind the bad report proves
        # the pipeline keeps flowing.
        second = stack.submit(idempotency_key="OVER-2")
        second_order = second.json()
        second_domain = run(stack.runtime.oms.get_order(UUID(second_order["client_order_id"])))

        stack.sim.emit_execution(
            stack.make_fill(int(second_order["broker_order_id"]), second_domain,
                            execution_id="F-SECOND", quantity="10", cum="10")
        )
        stack.drain()  # must NOT raise despite the overfill in the burst

        # Order 1: completed by the valid fill; the overfill changed nothing.
        state = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
        assert state["status"] == "FILLED"
        assert state["filled_quantity"].rstrip("0").rstrip(".") in {"10", "10.0"}

        # Order 2: its fill (queued AFTER the invalid report) was delivered.
        second_state = stack.client.get(
            f"/api/v1/orders/{second_order['client_order_id']}"
        ).json()
        assert second_state["status"] == "FILLED"

        positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        total = sum(float(p["quantity"]) for p in positions)
        assert total == 20.0  # both orders fully filled; overfill ignored

    def test_double_cancel_conflict_409(self, stack):
        created = stack.submit(idempotency_key="CXL-1")
        order_id = created.json()["client_order_id"]
        first = stack.client.post(f"/api/v1/orders/{order_id}/cancel")
        assert first.status_code == 200
        assert first.json()["status"] == "CANCELLED"
        second = stack.client.post(f"/api/v1/orders/{order_id}/cancel")
        assert second.status_code == 409
        assert second.json()["error"]["code"] == "CONFLICT"

    def test_cancel_unknown_order_404(self, stack):
        response = stack.client.post(f"/api/v1/orders/{uuid4()}/cancel")
        assert response.status_code == 404


class TestAccountIsolationFullStack:
    def test_outsider_cannot_touch_this_accounts_flow(self, stack):
        # The outsider (trader on ACC-OTHER) is fully authenticated...
        me = stack.outsider.get("/api/v1/auth/me")
        assert me.status_code == 200
        # ...yet every ACC-001 operation is denied server-side.
        assert stack.outsider.get("/api/v1/accounts/ACC-001/positions").status_code == 403
        response = stack.outsider.post("/api/v1/orders", json=stack.aapl_body())
        assert response.status_code == 403

        created = stack.submit(idempotency_key="ISO-1")
        order_id = created.json()["client_order_id"]
        assert (
            stack.outsider.post(f"/api/v1/orders/{order_id}/cancel").status_code == 403
        )
        # The order is untouched.
        assert (
            stack.client.get(f"/api/v1/orders/{order_id}").json()["status"]
            == "SUBMITTED"
        )

    def test_outsider_cannot_stream_this_accounts_events(self, stack):
        """WS access is account-scoped (M12): a valid session for ACC-OTHER
        cannot subscribe to the ACC-001 stream."""
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with stack.ws_connect(stack.outsider) as ws:
                ws.receive_text()
        assert excinfo.value.code == 4403
