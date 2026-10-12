"""API integration tests — REST surface (orders, portfolio, risk, market, brokers)."""

from __future__ import annotations

from uuid import UUID, uuid4

from domain.instrument import AssetClass, Exchange, Instrument
from domain.money import Currency
from tests.integration.api.conftest import aapl_body, push_fill, run


def run(coro):
    import asyncio
    return asyncio.run(coro)


class TestSystem:
    def test_health_ok_when_connected(self, client):
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["broker"] == "IBKR"
        assert body["broker_connected"] is True

    def test_broker_status(self, client, sim_client):
        assert client.get("/api/v1/brokers").json()[0]["connected"] is True
        sim_client.simulate_unexpected_disconnect()
        assert client.get("/api/v1/brokers").json()[0]["connected"] is False


class TestOrderCreation:
    def test_create_order_201(self, client):
        response = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-1"))
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "SUBMITTED"
        assert body["quantity"] == "10.00000000"
        assert body["filled_quantity"] == "0.00000000"
        assert body["remaining_quantity"] == "10.00000000"
        assert body["symbol"] == "AAPL"
        assert body["broker_order_id"] is not None
        # Exact-decimal serialization: JSON strings, never floats.
        assert isinstance(body["limit_price"], str)

    def test_idempotent_replay_returns_same_order_200(self, client):
        first = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-REPLAY"))
        assert first.status_code == 201
        second = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-REPLAY"))
        assert second.status_code == 200
        assert second.json()["client_order_id"] == first.json()["client_order_id"]
        assert len(client.get("/api/v1/orders").json()) == 1  # no duplicate

    def test_domain_invariant_violation_400(self, client):
        # MARKET order with a limit price violates the domain invariant.
        response = client.post("/api/v1/orders", json=aapl_body(order_type="MARKET"))
        assert response.status_code == 400
        assert "MARKET" in response.json()["error"]["message"]

    def test_invalid_body_422(self, client):
        response = client.post("/api/v1/orders", json={"account_id": "ACC-001"})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_unknown_field_rejected_422(self, client):
        body = aapl_body()
        body["rogue_field"] = "x"
        response = client.post("/api/v1/orders", json=body)
        assert response.status_code == 422

    def test_zero_quantity_400(self, client):
        response = client.post("/api/v1/orders", json=aapl_body(quantity="0"))
        assert response.status_code == 400


class TestOrderReads:
    def test_get_unknown_order_404(self, client):
        response = client.get(f"/api/v1/orders/{uuid4()}")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "ORDER_NOT_FOUND"

    def test_list_orders_account_filter(self, admin_client):
        # Wildcard-scope admin creates + lists orders across BOTH accounts.
        admin_client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-A"))
        body = aapl_body(idempotency_key="K-B")
        body["account_id"] = "OTHER"
        admin_client.post("/api/v1/orders", json=body)
        assert len(admin_client.get("/api/v1/orders").json()) == 2
        assert len(admin_client.get("/api/v1/orders?account_id=ACC-001").json()) == 1
        assert len(admin_client.get("/api/v1/orders?account_id=OTHER").json()) == 1


class TestOrderLifecycle:
    def test_cancel_working_order(self, client):
        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-C"))
        order_id = created.json()["client_order_id"]
        response = client.post(f"/api/v1/orders/{order_id}/cancel")
        assert response.status_code == 200
        assert response.json()["status"] == "CANCELLED"

    def test_cancel_twice_409(self, client):
        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-D"))
        order_id = created.json()["client_order_id"]
        assert client.post(f"/api/v1/orders/{order_id}/cancel").status_code == 200
        response = client.post(f"/api/v1/orders/{order_id}/cancel")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "CONFLICT"

    def test_modify_order(self, client):
        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-E"))
        order_id = created.json()["client_order_id"]
        response = client.post(f"/api/v1/orders/{order_id}/modify", json={"limit_price": "95"})
        assert response.status_code == 200
        assert response.json()["limit_price"] == "95"

    def test_modify_without_prices_400(self, client):
        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-F"))
        order_id = created.json()["client_order_id"]
        response = client.post(f"/api/v1/orders/{order_id}/modify", json={})
        assert response.status_code == 400

    def test_full_lifecycle_with_fills(self, client, sim_client, adapter, runtime):
        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-G"))
        body = created.json()
        order_id = body["client_order_id"]
        broker_order_id = int(body["broker_order_id"])
        order = run(runtime.oms.get_order(UUID(order_id)))

        push_fill(client, sim_client, adapter, broker_order_id, order, quantity="10", cum="10")

        detail = client.get(f"/api/v1/orders/{order_id}").json()
        assert detail["status"] == "FILLED"
        assert detail["filled_quantity"] == "10.00000000"
        assert detail["remaining_quantity"] == "0.00000000"


class TestPortfolioEndpoints:
    def test_balance_404_without_data(self, client):
        response = client.get("/api/v1/accounts/ACC-001/balance")
        assert response.status_code == 404

    def test_balance_after_account_update(self, client, sim_client, adapter):
        from brokers.ibkr.contracts import IbkrAccountValue

        sim_client.account_values = [
            IbkrAccountValue(key="TotalCashValue", value="10000", currency="USD"),
            IbkrAccountValue(key="AvailableFunds", value="8000", currency="USD"),
            IbkrAccountValue(key="BuyingPower", value="40000", currency="USD"),
        ]
        sim_client.request_account_summary()
        client.portal.call(adapter.drain)
        response = client.get("/api/v1/accounts/ACC-001/balance")
        assert response.status_code == 200
        cash = response.json()["cash"][0]
        assert cash["currency"] == "USD"
        assert cash["total"] == "10000.00"
        assert cash["available"] == "8000.00"
        assert cash["buying_power"] == "40000.00"

    def test_positions_after_fill(self, client, sim_client, adapter, runtime):
        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-P"))
        body = created.json()
        order = run(runtime.oms.get_order(UUID(body["client_order_id"])))
        push_fill(client, sim_client, adapter, int(body["broker_order_id"]), order, quantity="10", cum="10"
        )

        positions = client.get("/api/v1/accounts/ACC-001/positions").json()
        assert len(positions) == 1
        position = positions[0]
        assert position["symbol"] == "AAPL"
        assert position["quantity"] == "10.00000000"
        assert position["average_price"] == "100"
        # No market price -> unrealized is null (never silently zero).
        assert position["unrealized_pnl"] is None

    def test_summary_after_fill(self, client, sim_client, adapter, runtime):
        created = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-S"))
        body = created.json()
        order = run(runtime.oms.get_order(UUID(body["client_order_id"])))
        push_fill(client, sim_client, adapter, int(body["broker_order_id"]), order, quantity="10", cum="10"
        )

        summary = client.get("/api/v1/accounts/ACC-001/summary").json()
        assert summary["market_value"] == {"USD": "1000.00"}  # entry-price fallback
        assert summary["exposure"] == "1000.00"
        assert summary["equity"] is None  # no cash balance known
        assert summary["realized_pnl"] == {}
        assert summary["unrealized_pnl"] == {}


class TestMarketDataEndpoints:
    def test_quote_404_without_data(self, client):
        response = client.get(
            "/api/v1/market/quote?symbol=AAPL&asset_class=EQUITY&currency=USD&exchange=NASDAQ"
        )
        assert response.status_code == 404

    def test_quote_after_tick(self, client, sim_client, adapter, runtime):
        import time

        from brokers.ibkr import mapping as ibkr_mapping
        from tests.integration.api.conftest import make_quote

        instrument = Instrument(
            symbol="AAPL",
            asset_class=AssetClass.EQUITY,
            currency=Currency(code="USD"),
            exchange=Exchange.NASDAQ,
        )
        run(runtime.market.subscribe(instrument))
        # Current timestamp so the quote is fresh (not stale under the
        # portfolio's price_max_age policy).
        sim_client.emit_quote(
            make_quote(ibkr_mapping.instrument_to_contract(instrument), at=int(time.time()))
        )
        client.portal.call(adapter.drain)

        response = client.get(
            "/api/v1/market/quote?symbol=AAPL&asset_class=EQUITY&currency=USD&exchange=NASDAQ"
        )
        assert response.status_code == 200
        body = response.json()
        assert body["bid"] == "99"
        assert body["ask"] == "101"
        assert body["mid"] == "100"
        assert body["stale"] is False

    def test_quote_invalid_asset_class_400(self, client):
        response = client.get(
            "/api/v1/market/quote?symbol=AAPL&asset_class=WARP&currency=USD"
        )
        assert response.status_code == 400


class TestRiskEndpoints:
    def test_evaluate_dry_run(self, client):
        response = client.post("/api/v1/accounts/ACC-001/risk/evaluate", json=aapl_body())
        assert response.status_code == 200
        body = response.json()
        assert body["approved"] is True
        assert body["violations"] == []

    def test_kill_switch_blocks_orders(self, admin_client):
        # Kill-switch control is admin-only (risk:admin); the admin also
        # creates the blocked order.
        activated = admin_client.post(
            "/api/v1/accounts/ACC-001/risk/kill-switch", json={"active": True}
        )
        assert activated.status_code == 200
        assert activated.json()["active"] is True

        status = admin_client.get("/api/v1/accounts/ACC-001/risk/kill-switch")
        assert status.json()["active"] is True

        response = admin_client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-K"))
        assert response.status_code == 422
        body = response.json()
        assert body["error"]["code"] == "RISK_REJECTED"
        assert body["violations"][0]["rule"] == "kill_switch"

        # Deactivate -> orders flow again.
        admin_client.post("/api/v1/accounts/ACC-001/risk/kill-switch", json={"active": False})
        ok = admin_client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-K2"))
        assert ok.status_code == 201

    def test_risk_limit_rejection_via_api(self, client, runtime):
        from domain.money import Quantity
        from risk import RiskLimits

        runtime.set_risk_limits("ACC-001", RiskLimits(max_order_quantity=Quantity(value="5")))
        response = client.post("/api/v1/orders", json=aapl_body(idempotency_key="K-R"))
        assert response.status_code == 422
        body = response.json()
        assert body["violations"][0]["rule"] == "order_size_limit"


class TestConcurrency:
    def test_parallel_submissions_distinct_orders(self, client):
        import concurrent.futures

        def submit(i: int) -> int:
            return client.post(
                "/api/v1/orders", json=aapl_body(idempotency_key=f"K-CC-{i}")
            ).status_code

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            statuses = list(pool.map(submit, range(5)))
        assert statuses == [201] * 5
        assert len(client.get("/api/v1/orders").json()) == 5
