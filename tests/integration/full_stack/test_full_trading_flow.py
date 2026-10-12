"""M13 golden path: the complete documented trading flow, on BOTH brokers.

API -> auth -> risk -> OMS -> execution -> broker adapter -> fills ->
portfolio/P&L -> events -> WebSocket -> REST reads. Every step is driven
through the public surface only; fills are simulated (paper mode).
"""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import UUID

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import pytest


def run(coro):
    import asyncio
    return asyncio.run(coro)


def _receive_json(ws) -> dict:
    import json

    return json.loads(ws.receive_text())


class TestFullTradingFlow:
    def test_complete_authenticated_flow(self, stack):
        """Login -> quote -> dry-run -> submit -> partial -> fill -> P&L."""
        # 1. Session identity (M12 boundary).
        me = stack.client.get("/api/v1/auth/me")
        assert me.status_code == 200
        assert me.json()["subject"] == "trader"
        assert "orders:write" in me.json()["permissions"]

        # 2. Balances: the broker reports account data; the adapter relabels
        #    it to the internal account and M7 publishes the balance.
        stack.push_balance()
        balance = stack.client.get("/api/v1/accounts/ACC-001/balance")
        assert balance.status_code == 200
        cash = balance.json()["cash"]
        assert any(entry["currency"] == "USD" for entry in cash)

        # 3. Market data flows to the authoritative store and REST reads.
        stack.push_quote(bid="99", ask="101", last="100")
        quote = stack.client.get(
            "/api/v1/market/quote?symbol=AAPL&asset_class=EQUITY&currency=USD&exchange=NASDAQ"
        )
        assert quote.status_code == 200
        assert quote.json()["bid"] == "99"
        assert quote.json()["stale"] is False

        # 4. Risk dry-run approves the intended order (M6 through the API).
        dry = stack.client.post("/api/v1/accounts/ACC-001/risk/evaluate",
                                json=stack.aapl_body())
        assert dry.status_code == 200
        assert dry.json()["approved"] is True

        # 5. Submit through the mandatory risk gate -> broker ack.
        with stack.ws_connect() as ws:
            hello = _receive_json(ws)
            assert hello["control"] == "hello"

            created = stack.submit(idempotency_key="FS-1")
            assert created.status_code == 201, created.text
            order = created.json()
            assert order["status"] == "SUBMITTED"
            assert order["broker_order_id"] is not None

            # 6. The WS client observes the lifecycle in engine order.
            submitted = _receive_json(ws)
            assert submitted["event_type"] == "order.submitted"
            assert submitted["payload"]["order"]["client_order_id"] == order["client_order_id"]
            accepted = _receive_json(ws)
            assert accepted["event_type"] == "order.accepted"

            # 7. Partial fill (4/10): broker execution -> OMS -> portfolio.
            domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
            stack.push_fill(int(order["broker_order_id"]), domain_order,
                            quantity="4", cum="4")

            partial = _receive_json(ws)
            assert partial["event_type"] in {"order.partially_filled", "position.opened"}
            if partial["event_type"] == "position.opened":
                # Documented cross-topic interleave (ADR-016): per-topic order
                # still holds; the fill event follows its nested reaction.
                fill_event = _receive_json(ws)
                assert fill_event["event_type"] == "order.partially_filled"
            else:
                position_event = _receive_json(ws)
                assert position_event["event_type"] == "position.opened"

            # 8. REST reads see the authoritative mid-flight state.
            mid = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
            assert mid["status"] == "PARTIALLY_FILLED"
            assert mid["filled_quantity"].rstrip("0").rstrip(".") in {"4", "4.0"}
            assert mid["remaining_quantity"].rstrip("0").rstrip(".") in {"6", "6.0"}

            positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
            assert len(positions) == 1
            position = positions[0]
            assert position["symbol"] == "AAPL"
            assert position["quantity"].rstrip("0").rstrip(".") in {"4", "4.0"}
            # Fresh quote is present -> unrealized is priced, market price set.
            assert position["market_price"] == "100"
            assert position["unrealized_pnl"] is not None

            # 9. Completing fill (6/10) -> FILLED + final position.
            stack.push_fill(int(order["broker_order_id"]), domain_order,
                            quantity="6", cum="10")
            updated = _receive_json(ws)
            assert updated["event_type"] in {"position.updated", "order.filled"}
            filled = _receive_json(ws)
            assert filled["event_type"] in {"position.updated", "order.filled"}

            final = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
            assert final["status"] == "FILLED"
            assert final["filled_quantity"].rstrip("0").rstrip(".") in {"10", "10.0"}

            final_positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
            assert final_positions[0]["quantity"].rstrip("0").rstrip(".") in {"10", "10.0"}

            # 10. Summary reflects the position (M7 valuation through REST).
            summary = stack.client.get("/api/v1/accounts/ACC-001/summary").json()
            assert summary["market_value"]  # the position is priced
            assert summary["exposure"]

        # 11. Idempotent replay through the whole stack: same key, same order.
        replay = stack.submit(idempotency_key="FS-1")
        assert replay.status_code == 200
        assert replay.json()["client_order_id"] == order["client_order_id"]
        listed = stack.client.get("/api/v1/orders").json()
        assert len([o for o in listed if o["client_order_id"] == order["client_order_id"]]) == 1

    def test_sell_side_closes_the_position(self, stack):
        """A SELL flow nets the long back to flat; P&L is realized (M7)."""
        created = stack.submit(side="SELL", order_type="MARKET",
                               quantity="5", limit_price=None)
        assert created.status_code == 201
        order = created.json()

        domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
        stack.push_fill(int(order["broker_order_id"]), domain_order,
                        quantity="5", cum="5")

        positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert len(positions) == 1
        assert positions[0]["quantity"].startswith("-5")

        # Buy it back in and confirm realized P&L appears on the summary.
        buy = stack.submit(side="BUY", order_type="MARKET",
                           quantity="5", limit_price=None)
        buy_order = buy.json()
        domain_buy = run(stack.runtime.oms.get_order(UUID(buy_order["client_order_id"])))
        stack.push_fill(int(buy_order["broker_order_id"]), domain_buy,
                        quantity="5", cum="5")

        # Flat: the position closed (M7 publishes position.closed).
        after = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert len(after) == 0
        summary = stack.client.get("/api/v1/accounts/ACC-001/summary").json()
        assert list(summary["realized_pnl"].values())  # some realized P&L


@pytest.mark.parametrize("broker", ["ibkr", "saxo"])
class TestBothBrokersSameWorkflow:
    """Explicitly prove the SAME broker-independent workflow on each adapter
    (distinct stacks, not the shared fixture, to keep failures attributable)."""

    def test_risk_gated_order_reaches_broker_and_fills(self, broker):
        from tests.integration.full_stack.conftest import make_stack, teardown_stack

        stack = make_stack(broker)
        try:
            created = stack.submit(idempotency_key=f"PARITY-{broker}")
            assert created.status_code == 201, created.text
            order = created.json()
            assert order["status"] == "SUBMITTED"
            assert order["broker_order_id"]

            domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
            stack.push_fill(int(order["broker_order_id"]), domain_order,
                            quantity="3", cum="3")

            state = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
            assert state["status"] == "PARTIALLY_FILLED"

            positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
            assert positions[0]["quantity"].rstrip("0").rstrip(".") in {"3", "3.0"}

            # Balance is broker-sourced but relabeled to the internal account.
            stack.push_balance()
            balance = stack.client.get("/api/v1/accounts/ACC-001/balance")
            assert balance.status_code == 200
        finally:
            teardown_stack(stack)
