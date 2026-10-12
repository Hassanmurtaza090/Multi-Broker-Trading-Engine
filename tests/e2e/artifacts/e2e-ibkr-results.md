| Case | Input/Action | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| stack readiness | GET /ready | status=ready, database=ok | {'status': 'ready', 'broker': 'IBKR', 'database': 'ok'} | PASS |
| broker status | GET /brokers | one broker (IBKR), connected | [{'name': 'IBKR', 'connected': True}] | PASS |
| market data | GET /market/quote | fresh quote from the startup subscription + sim ticks | {'symbol': 'AAPL', 'exchange': 'NASDAQ', 'currency': 'USD', 'bid': '106.20', 'ask': '106.42', 'last': '106.31', 'mid': ' | PASS |
| risk dry-run | POST /risk/evaluate | approved with zero violations | {'approved': True, 'violations': []} | PASS |
| order submission (risk-gated) | POST /orders (full-fill order) | 201 SUBMITTED with broker_order_id | status=201 in 114ms: {'client_order_id': '4b9994ff-f2f2-44ea-a355-4d072f8f806e', 'account_id': 'ACC-001', 'symbol': 'AAPL | PASS |
| full execution | auto-fill on key E2E-FULL-340cd71e (sim broker -> adapter -> OMS) | FILLED with quantity == filled_quantity == 10 | {'client_order_id': '4b9994ff-f2f2-44ea-a355-4d072f8f806e', 'account_id': 'ACC-001', 'symbol': 'AAPL', 'exchange': 'NASD | PASS |
| position creation | GET /positions after the full fill | qty=10, avg=150.25 (VWAP == single fill price) | {'account_id': 'ACC-001', 'symbol': 'AAPL', 'exchange': 'NASDAQ', 'currency': 'USD', 'quantity': '10.00000000', 'average | PASS |
| partial execution | auto-fill SIM_ACTION=PARTIAL (key E2E-PARTIAL-fea71ac6) | PARTIALLY_FILLED with filled=4 (40%) | intermediate_seen=True: {'client_order_id': '7969b53f-2bc9-405a-b98b-8e81223ea7b6', 'account_id': 'ACC-001', 'symbol': 'AAPL', 'exchan | PASS |
| partial -> full fill positions | GET /positions after the completing fill | qty=20 (10+10), avg=150.25 | {'account_id': 'ACC-001', 'symbol': 'AAPL', 'exchange': 'NASDAQ', 'currency': 'USD', 'quantity': '20.00000000', 'average | PASS |
| broker rejection | auto-fill SIM_ACTION=REJECT (key E2E-REJECT-a6e91e8b) | REJECTED (never assumed executed; no position impact) | {'client_order_id': 'c536e4d0-37a9-46be-9ce8-e33ffe3942c9', 'account_id': 'ACC-001', 'symbol': 'AAPL', 'exchan | PASS |
| cancellation | POST /orders/{id}/cancel on a working order | CANCELLED (or FILLED when the sim fill raced the cancel — both terminal) | status=CANCELLED (http 200) | PASS |
| position closure | SELL 20 (fills) -> GET /positions | flat (position closed; rows removed) | [] | PASS |
| realized P&L accounting | summary after buy@150.25 x20 then sell@150.25 x20 | realized P&L == 0.00 (independent exact-decimal recomputation) | realized_pnl USD=0.00 | PASS |
| market-value consistency | summary market_value after closure | flat position -> no market value exposure | {} | PASS |
| duplicate order protection | POST /orders twice with the SAME idempotency key | 201 then 200, identical order id, exactly one row | 201 then 200; rows=1 | PASS |
| kill switch blocks trading | admin activates kill switch; trader submits an order | 422 RISK_REJECTED with rule=kill_switch (no bypass) | activate=True; status=422; rules=['kill_switch'] | PASS |
| kill switch release | admin deactivates; trader resubmits | trading restored (201) | status=201 | PASS |
| websocket handshake (WSS through the edge) | WSS connect with a single-use ticket | HTTP 101 upgrade | HTTP/1.1 101 Switching Protocols | PASS |
| websocket hello contract | first frame | control=hello, dedupe_key=event_id | {'control': 'hello', 'client_id': '370e8d2b-df09-41f6-81e8-86e2b39c94b0', 'topics': ['all'], 'delive | PASS |
| websocket order lifecycle streaming | submit an order while streaming topics=all | order.submitted then order.accepted, in engine order | events=['order.submitted', 'order.accepted'] | PASS |
| backend restart recovery | docker restart backend; GET /ready | healthy again with database ok | {'status': 'ready', 'broker': 'IBKR', 'database': 'ok'} | PASS |
| orders persist across backend restart | GET /orders/{id} after restart (same bearer) | 200, FILLED, quantities intact | status=200: {'client_order_id': 'ab2b8328-9b3e-414a-b152-af1c3c8fb7db', 'account_id': 'ACC-001', 'symbol': 'AAPL | PASS |
| idempotency binding survives restart | POST the SAME idempotency key after restart | 200 replay, same order id | status=200; ids_match=True | PASS |
| database restart: readiness degradation | docker restart postgres; GET /ready | database=unavailable + status=starting while down | {'status': 'starting', 'broker': 'IBKR', 'database': 'unavailable'} | PASS |
| database restart: recovery | GET /ready after the DB is back | database=ok + status=ready | {'status': 'ready', 'broker': 'IBKR', 'database': 'ok'} | PASS |
| unauthenticated access denied | GET /api/v1/health with no token | 401 UNAUTHENTICATED | status=401: {'error': {'code': 'UNAUTHENTICATED', 'message': 'authentication required', 'det | PASS |
| tampered token rejected | GET /orders with a corrupted signature | 401 (signature verification) | status=401 | PASS |
| viewer role cannot trade | viewer (read-only role) POST /orders | 403 FORBIDDEN (missing orders:write) | status=403 | PASS |
| cross-account isolation (REST) | outsider (ACC-OTHER) GET /accounts/ACC-001/positions | 403 (no cross-account reads) | status=403 | PASS |
| IDOR protection (order actions) | outsider cancels another account's order id | 403 (resource-level authorization) | status=403 | PASS |
| cross-account isolation (WebSocket) | outsider opens /ws with a valid ticket (ACC-OTHER scope) | 101 upgrade then CLOSE 4403 (no registration) | handshake=HTTP/1.1 101 Switching Protocols; close_code=4403 | PASS |
| edge posture: operational surfaces unreachable | GET /metrics and /docs through the TLS edge | 404 for both (in-cluster only) | metrics=404, docs=404 | PASS |
| performance smoke: submit latency p95 | 10 sequential risk-gated submissions | p95 < 1500ms (local containerized stack, regression gate) | p95=184ms over 10 samples | PASS |
| performance smoke: 5 concurrent submissions | parallel POST /orders with distinct keys | all 201/200, 5 distinct ids, no corruption | statuses=[201, 201, 201, 201, 201]; distinct_ids=5 | PASS |