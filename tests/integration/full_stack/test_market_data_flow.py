"""M13 market-data flow across boundaries, on BOTH brokers.

Simulated feed -> adapter -> M3 engine -> events -> WS client + REST reads;
staleness semantics (TS-007) through the whole stack; portfolio valuation
behavior with fresh vs stale quotes.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import json


def run(coro):
    import asyncio
    return asyncio.run(coro)


def _receive_json(ws) -> dict:
    return json.loads(ws.receive_text())


class TestMarketDataFlow:
    def test_quote_flows_to_ws_and_rest_and_valuation(self, stack):
        """Feed -> WS market events + REST quote + priced positions."""
        with stack.ws_connect() as ws:
            _receive_json(ws)  # hello

            stack.push_quote(bid="99.25", ask="100.75", last="100")
            event = _receive_json(ws)
            assert event["event_type"] == "market.quote.updated"
            quote = event["payload"]["quote"]
            assert quote["bid"]["value"].startswith("99.25")
            assert quote["ask"]["value"].startswith("100.75")
            assert quote["last"]["value"].startswith("100")

        rest_quote = stack.client.get(
            "/api/v1/market/quote?symbol=AAPL&asset_class=EQUITY&currency=USD&exchange=NASDAQ"
        ).json()
        assert rest_quote["bid"].startswith("99.25")
        assert rest_quote["stale"] is False

        # Valuation: a filled position with a FRESH quote is priced.
        created = stack.submit(idempotency_key="MD-1")
        order = created.json()
        from uuid import UUID

        domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
        stack.push_fill(int(order["broker_order_id"]), domain_order,
                        quantity="10", cum="10")

        positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert positions[0]["market_price"].startswith("100")
        assert positions[0]["unrealized_pnl"] is not None
        assert positions[0]["stale"] is False

    def test_stale_quote_flags_degrade_gracefully_never_invent_values(self, stack):
        """TS-007 through the API: a stale quote is flagged, and unrealized
        P&L reads null (never an invented zero) while market_price still
        shows the last observed print."""
        created = stack.submit(idempotency_key="MD-STALE-1")
        order = created.json()
        from uuid import UUID

        domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
        stack.push_fill(int(order["broker_order_id"]), domain_order,
                        quantity="10", cum="10")

        # A quote timestamped far outside the 10 s freshness window.
        stack.push_quote(last="77", at=1_700_000_000)
        rest_quote = stack.client.get(
            "/api/v1/market/quote?symbol=AAPL&asset_class=EQUITY&currency=USD&exchange=NASDAQ"
        ).json()
        assert rest_quote["stale"] is True
        assert rest_quote["last"].startswith("77")

        positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert positions[0]["stale"] is True
        # The NEVER-silently-zero policy (ADR-013) through REST:
        assert positions[0]["unrealized_pnl"] is None

    def test_quote_recovery_refreshes_valuation(self, stack):
        """Stale -> fresh transition re-prices the position."""
        created = stack.submit(idempotency_key="MD-REC-1")
        order = created.json()
        from uuid import UUID

        domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
        stack.push_fill(int(order["broker_order_id"]), domain_order,
                        quantity="10", cum="10")

        stack.push_quote(last="77", at=1_700_000_000)  # stale
        before = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert before[0]["unrealized_pnl"] is None

        stack.push_quote(last="120")  # fresh
        after = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert after[0]["stale"] is False
        assert after[0]["unrealized_pnl"] is not None
        assert after[0]["market_price"].startswith("120")

    def test_quote_missing_before_any_data_is_404(self, stack):
        response = stack.client.get(
            "/api/v1/market/quote?symbol=AAPL&asset_class=EQUITY&currency=USD&exchange=NASDAQ"
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"
