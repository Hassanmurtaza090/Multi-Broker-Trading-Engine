# M16 — End-to-End Validation (live production stack)

Full-system scenarios driving the DEPLOYED stack (TLS edge -> frontend ->
backend -> PostgreSQL -> simulated broker) exactly like an operator. Runs
per broker adapter — the SAME scenarios against IBKR and SAXO — proving the
broker-independent workflow twice (ADR-014/015 paper/sim mode; **no live
trading ever**).

## What runs where

| Tier | What | Where |
| --- | --- | --- |
| **Live stack E2E** (this directory) | TLS, auth, REST, WebSocket, lifecycle, failures, security, perf smoke | docker-compose.prod.yml, project `mtbe-prod` |
| In-process full-stack (regression) | broker disconnect/reconcile, duplicate WS events, out-of-order events, stale market data, engine-level invariants | `tests/integration/full_stack/` (M13) |
| Frontend terminal | component/flow tests incl. the login->submit->WS->cancel flow | `frontend/src/**/*.test.tsx` |

Scenarios that need in-process control (e.g. broker disconnect mid-flight,
duplicate event injection) are covered by the M13 in-process suite and are
NOT duplicated here; this directory validates the platform AS DEPLOYED.

## How to run

```bash
# 0. Prerequisites: docker engine; a .env with the required secrets (see the
#    M15 runbook) PLUS the e2e demo users and the simulation knobs:
#        AUTH_DEMO_TRADER_PASSWORD=<choose-a-password>
#        AUTH_DEMO_ADMIN_PASSWORD=<choose-a-password>
#        AUTH_DEMO_OUTSIDER_PASSWORD=<choose-a-password>
#        AUTH_DEMO_VIEWER_PASSWORD=<choose-a-password>
#        BROKER_ADAPTER=IBKR|SAXO
#        MARKET_SUBSCRIPTIONS="AAPL|EQUITY|USD|NASDAQ"        # IBKR
#        MARKET_SUBSCRIPTIONS="AAPL|EQUITY|USD|NASDAQ|SAXO_UIC=211"  # SAXO
#        SIM_TICK_SECONDS=1
#        SIM_AUTO_FILL=true
#        SIM_FILL_DELAY_SECONDS=1

# 1. Deploy fresh (validated M15 procedure)
docker compose -f docker-compose.prod.yml up -d --build

# 2. Run the scenarios against the live stack (pick the broker via the same
#    BROKER_ADAPTER the stack runs with)
cd backend
E2E_BROKER=IBKR python -m pytest ../tests/e2e -q

# 3. Saxo pass: redeploy with BROKER_ADAPTER=SAXO +
#    MARKET_SUBSCRIPTIONS="AAPL|EQUITY|USD|NASDAQ|SAXO_UIC=211", then
E2E_BROKER=SAXO python -m pytest ../tests/e2e -q
```

## Evidence artifacts

Each run writes `artifacts/e2e-<broker>-results.{json,md}` — the full
evidence table (case, environment, input/action, expected, actual,
pass/fail) required by the milestone. These are recorded in
`docs/TEST_STATUS.md`.

## Deterministic sim directives

The paper-trading auto-fill driver (ADR-021) reads its directive from the
broker-neutral instrument identifiers — the same channel production
integrations use for broker metadata:

| Directive | Behavior |
| --- | --- |
| `SIM_ACTION=PARTIAL` | 40% fill, then (after the delay) the remainder |
| `SIM_ACTION=REJECT` | broker-side rejection through the M5 reconcile path |

## Validated results (2026-10-11)

| Broker | Tests | Evidence records | Result |
| --- | --- | --- | --- |
| IBKR | 8/8 | 34/34 PASS | `artifacts/e2e-ibkr-results.*` |
| SAXO | 8/8 | 34/34 PASS | `artifacts/e2e-saxo-results.*` |
