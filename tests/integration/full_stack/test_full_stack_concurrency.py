"""M13 concurrency across boundaries, on BOTH brokers.

Parallel submissions through the API, burst fill delivery on one order, and
conflicting-report integrity (fill vs cancel) — with final-state assertions
(never assumed, always read back).
"""

from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import UUID


def run(coro):
    import asyncio
    return asyncio.run(coro)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class TestConcurrentOperations:
    def test_parallel_submissions_all_reach_the_broker(self, stack):
        """5 concurrent REST submissions with distinct idempotency keys:
        all created exactly once, all acked by the broker (M10 pattern,
        now with fills across the whole stack)."""
        keys = [f"CONC-{stack.broker}-{i}" for i in range(5)]

        def submit(key: str):
            return stack.client.post("/api/v1/orders", json=stack.aapl_body(idempotency_key=key))

        with ThreadPoolExecutor(max_workers=5) as pool:
            responses = list(pool.map(submit, keys))
        assert all(r.status_code == 201 for r in responses)

        listed = stack.client.get("/api/v1/orders").json()
        assert len(listed) == 5
        ids = {o["client_order_id"] for o in listed}
        assert len(ids) == 5  # no duplicates, no interleaving corruption
        assert all(o["status"] == "SUBMITTED" for o in listed)

        # Fill each order independently; states stay isolated per order.
        for order in listed:
            domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
            stack.push_fill(int(order["broker_order_id"]), domain_order,
                            quantity="2", cum="2")
        final = stack.client.get("/api/v1/orders").json()
        assert all(o["status"] == "PARTIALLY_FILLED" for o in final)
        positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        total = sum(_num(p["quantity"]) for p in positions)
        assert total == 10  # 5 orders x 2

    def test_burst_fill_delivery_accumulates_in_order(self, stack):
        """Two executions queued in one burst: the M2 bus total ordering
        applies them sequentially — cumulative 4 then 10 (never interleaved
        or dropped)."""
        created = stack.submit(idempotency_key="BURST-1")
        order = created.json()
        domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))
        broker_order_id = int(order["broker_order_id"])

        exec_a = stack.make_fill(broker_order_id, domain_order,
                                  execution_id="F-BURST-A", quantity="4", cum="4")
        exec_b = stack.make_fill(broker_order_id, domain_order,
                                 execution_id="F-BURST-B", quantity="6", cum="10")
        stack.sim.emit_execution(exec_a)
        stack.sim.emit_execution(exec_b)
        stack.drain()  # ONE drain for the whole burst

        state = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
        assert state["status"] == "FILLED"
        assert state["filled_quantity"].rstrip("0").rstrip(".") in {"10", "10.0"}
        positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert positions[0]["quantity"].rstrip("0").rstrip(".") in {"10", "10.0"}

    def test_fill_then_cancel_report_keeps_terminal_state(self, stack):
        """Conflicting reports: once FILLED (terminal), a late cancel report
        from the broker cannot corrupt the state machine (M1/M4)."""
        created = stack.submit(idempotency_key="CONFLICT-1")
        order = created.json()
        broker_order_id = int(order["broker_order_id"])
        domain_order = run(stack.runtime.oms.get_order(UUID(order["client_order_id"])))

        stack.push_fill(broker_order_id, domain_order, quantity="10", cum="10")
        assert (
            stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()["status"]
            == "FILLED"
        )

        # The broker emits a late CANCELLED status anyway.
        stack.sim.force_status(broker_order_id, "Cancelled")
        stack.drain()

        state = stack.client.get(f"/api/v1/orders/{order['client_order_id']}").json()
        assert state["status"] == "FILLED"  # terminal state wins
        # And the position is untouched by the late cancel.
        positions = stack.client.get("/api/v1/accounts/ACC-001/positions").json()
        assert positions[0]["quantity"].rstrip("0").rstrip(".") in {"10", "10.0"}


def _num(decimal_string: str) -> float:
    return float(decimal_string)
