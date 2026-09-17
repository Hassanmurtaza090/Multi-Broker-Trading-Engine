# Test Status

Tracks the actual state of testing. **Never record `PASS` unless the test was
actually executed.** Test results are recorded only after real execution.

---

## Current Summary

| Category | Status |
| --- | --- |
| Unit Tests | ACTIVE — M0–M5 suites (see Results Log) |
| Integration Tests | ACTIVE — M2 event + M3 market-data + M4 OMS + M5 execution (see Results Log) |
| E2E Tests | NOT STARTED |
| Security Tests | NOT STARTED |
| Performance Tests | NOT STARTED |
| Broker Simulation Tests | NOT STARTED (simulated feeds for M3; mock reports for M4; simulated broker for M5) |
| Quant Validation | PASS (M1–M5 trading semantics) |

> Note: M0 includes a minimal set of **foundation validation tests** (recorded
> below). Full unit/integration suites begin in later milestones.

---

## Recording Format

Every test report **must** include:

```text
- Date:
- Commit/version:
- Test category:      (unit | integration | e2e | security | performance | ...)
- Test command:
- Tests executed:
- Passed:
- Failed:
- Skipped:
- Failure details:
- Reviewer:
- Status:             (PASS | FAIL | PARTIAL)
```

Rules:

- Only append real results.
- Do not fabricate numbers.
- Do not create tests that merely assert `True`; tests must validate behavior.
- Record the exact command and tool versions when relevant.

---

## Results Log

### 2026-09-10 — Foundation Validation (M0) — Backend

| Field | Value |
| --- | --- |
| Date | 2026-09-10 |
| Commit/version | pre-commit (bootstrap) |
| Test category | foundation (unit — backend structure/boundaries) |
| Test command | `python -m pytest ../tests` (from `backend/`) |
| Tests executed | 29 |
| Passed | 29 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed (1 auto-fixed newline issue resolved).
- `mypy .` → Success: no issues found in 15 source files.

### 2026-09-10 — Foundation Validation (M0) — Frontend

| Field | Value |
| --- | --- |
| Date | 2026-09-10 |
| Commit/version | pre-commit (bootstrap) |
| Test category | foundation (unit — React render) |
| Test command | `npm run test` (from `frontend/`) |
| Tests executed | 1 |
| Passed | 1 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect |
| Status | PASS |

Additional frontend checks (same date):

- `npm run typecheck` → clean (tsc -b --noEmit).
- `npm run lint` → clean (ESLint).
- `npm run build` → success (vite production build).

> Note: `npm install` reported 4 npm dependency advisories (2 moderate, 1 high,
> 1 critical) originating from the deprecated ESLint 8 toolchain. Tracking as
> known issue to resolve when tooling is upgraded (non-runtime, build-only).

### 2026-09-13 — M1 Core Domain Model — Backend Unit Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-13 |
| Commit/version | M1 (pre-commit) |
| Test category | unit — domain model (money, instrument, orders, position, fills, portfolio, market, errors, serialization) |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 113 |
| Passed | 113 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA + Quant review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed.
- `mypy .` (strict) → Success: no issues found in 24 source files.
- `ruff format --check .` → all files formatted.

Coverage breakdown of the 113 tests: 29 M0 foundation tests + 84 M1 domain
tests (money 22, instrument 7, orders 24, domain models 16, serialization 15).

### 2026-09-13 — M1 Quant Review

| Field | Value |
| --- | --- |
| Date | 2026-09-13 |
| Review scope | Financial/trading correctness of domain model |
| Reviewer | Quant (lead architect acting) |
| Verdict | PASS WITH NOTES |
| Notes | (1) Position VWAP flip-to-opposite-side correctly resets average to fill price. (2) Reducing within same direction correctly retains average. (3) `gross_value` quantized via `Money` (2dp) — acceptable for notional at M1; revisit for high-precision FX before M7. (4) Realized P&L intentionally deferred to M7. (5) `Order.filled_quantity` is an explicit M1 placeholder for M4. |
| Status | PASS |

### 2026-09-15 — M2 Event System — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Commit/version | M2 (pre-commit) |
| Test category | unit + integration + async/concurrency — event system |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 156 |
| Passed | 156 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA + Quant + Security review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed.
- `mypy .` (strict) → Success: no issues found in 30 source files.
- `ruff format --check .` → all files formatted.

Coverage breakdown of the 156 tests: 29 M0 foundation + 75 M1 domain +
52 M2 event tests (unit 41: types 6, envelope 8, registry 10, serialization 6,
bus 11; integration 11: lifecycle 5, concurrency 6).

### 2026-09-15 — M2 Regression (M0 + M1)

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Test category | regression — M0 foundation + M1 domain |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 104 |
| Passed | 104 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

### 2026-09-15 — M2 Quant Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Order lifecycle, execution/fill, position, balance, market-data, and risk event semantics |
| Reviewer | Quant |
| Verdict | PASS |
| Notes | Order lifecycle events correctly separate submitted → accepted → partially_filled → filled, with explicit failure paths (rejected, cancelled, expired). Fill-carrying events (`OrderPartiallyFilled`/`OrderFilled`) include the full domain `Fill` (no duplication of order/fill types). Position events reflect open/updated/closed against `quantity` invariants. `BalanceUpdated`/`MarketQuoteUpdated` reuse domain value objects. `RiskViolation` is a notification, not a state transition. Events imply no transition the domain did not already make (transport-only semantics). |
| Status | PASS |

### 2026-09-15 — M2 Security Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Payload exposure, serialization, logging, untrusted event data, sensitive-info leakage |
| Reviewer | Security |
| Verdict | PASS |
| Notes | No secrets are logged: `HandlerError.message` is bounded (200 chars) and payload echoes are excluded; event/error logs carry identifiers only (`event_id`, `event_type`, `handler`, `exception_type`). `EventEnvelope` is `frozen` + `extra="forbid"`; `DomainEvent` is `frozen` + `extra="forbid"`, so unknown fields are rejected. Deserialization validates against the typed registry (unknown type/version raise). `source`/`correlation_id`/`causation_id` are length-bounded. No credentials or tokens exist in the event package. |
| Status | PASS |

### 2026-09-15 — M2 QA Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Test adequacy: unit, integration, async/concurrency, edge cases, regression |
| Reviewer | QA |
| Verdict | PASS |
| Notes | Coverage includes event creation/validation, unique IDs, timestamps (tz-aware enforced), versions, serialization round-trip, unknown types, missing/invalid payloads, subscribe/unsubscribe, multiple/no subscribers, handler exceptions, ordering, mid-dispatch (un)subscribe snapshot, concurrent publishes (no interleaving), reentrant nested publish (no deadlock), and duplicate-event delivery. One prior test that asserted nothing was removed and replaced with a real interleaving assertion. |
| Status | PASS |

### 2026-09-15 — M3 Market Data Engine — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Commit/version | M3 (pre-commit) |
| Test category | unit + integration + async — market-data engine |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 191 |
| Passed | 191 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA + Quant + Security review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed.
- `mypy .` (strict) → Success: no issues found in 34 source files.
- `ruff format --check .` → all files formatted.

Coverage breakdown of the 191 tests: 29 M0 + 75 M1 + 52 M2 + 35 M3 (domain
market models 9, subscription 6, staleness 8, engine 7, engine integration 5).

### 2026-09-15 — M3 Regression (M0 + M1 + M2)

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Test category | regression — M0 + M1 + M2 |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 156 |
| Passed | 156 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

### 2026-09-15 — M3 Quant Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Market-data semantics: quotes, ticks, bars, normalization, staleness |
| Reviewer | Quant |
| Verdict | PASS |
| Notes | All price/quantity math is Decimal-backed (no float error). `Bar` invariants are correct OHLCV semantics (high ≥ max(open,close), low ≤ min(open,close), non-negative volume, single currency). `MarketTick`/`MarketQuote` reuse domain value objects; no duplicated models. Normalization from raw feed payloads is lossless for validated input. Staleness (TS-007) is conservative: never-observed data is stale, and freshness is restored on new data. `mid` = (bid+ask)/2 computed on Decimal, acceptable at M3. No execution/P&L logic introduced (correct scope). |
| Status | PASS |

### 2026-09-15 — M3 Security Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Untrusted feed input validation, logging, payload exposure |
| Reviewer | Security |
| Verdict | PASS |
| Notes | Broker feed payloads are validated at the normalization boundary (bid>ask rejected, negative volume rejected, mixed-currency bars rejected, naive timestamps rejected). A malformed payload cannot crash the engine — `_on_feed_event` isolates and logs exceptions. Logs carry instrument identifiers only (`market_stale`, `market_subscribe`, `market_unsubscribe`, `market_data_drop`); no payload echoes or credentials. No secrets stored in `market_data` or `brokers/base`. |
| Status | PASS |

### 2026-09-15 — M3 QA Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Test adequacy: unit, integration, async, edge cases, regression |
| Reviewer | QA |
| Verdict | PASS |
| Notes | Coverage: valid/invalid bars (high/low/volume/currency), ticks, subscription idempotency/refcount/last-ref-cancel, staleness (fresh/stale/clear/reset/independent, naive-ts rejected), engine normalization (quote/tick/bar), invalid quote dropped without crash, subscribe forwarding + idempotency, stop cancels feed subscriptions, feed→bus→multiple consumers, multi-instrument routing, bar/tick consumers, deterministic stale detection (injectable clock), handler isolation. One flaky real-clock staleness test was replaced with a deterministic injectable-clock test. |
| Status | PASS |

### 2026-09-15 — M4 Order Management System — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Commit/version | M4 (pre-commit) |
| Test category | unit + integration — order management (OMS) |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 217 |
| Passed | 217 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA + Quant + Security review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed.
- `mypy .` (strict) → Success: no issues found in 37 source files.
- `ruff format --check .` → all files formatted.

Coverage breakdown of the 217 tests: 29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4
(OMS creation 6, OMS lifecycle 16, OMS integration 4).

### 2026-09-15 — M4 Regression (M0 + M1 + M2 + M3)

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Test category | regression — M0 + M1 + M2 + M3 |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 191 |
| Passed | 191 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

### 2026-09-15 — M4 Quant Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Order lifecycle, fills, idempotency, execution-report semantics |
| Reviewer | Quant |
| Verdict | PASS |
| Notes | Lifecycle matches the M1 state machine: NEW → PENDING_SUBMIT → SUBMITTED → PARTIALLY_FILLED → FILLED, with REJECTED/CANCELLED/EXPIRED terminal paths. Fills are applied only on confirmed `ExecutionReport` (no unconfirmed execution assumption); overfill and FILL-not-completing reports are rejected. A PARTIAL_FILL that completes the order correctly becomes FILLED. Cumulative `filled_quantity` (M1-deferred) and `remaining_quantity` are correct. Idempotency via `client_order_id` / `idempotency_key` and duplicate `report_id` protection are sound. Modification reflects locally with broker ack deferred to M5 (documented). |
| Status | PASS |

### 2026-09-15 — M4 Security Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Validation, unsafe input/state transitions, logging, broker trust boundary |
| Reviewer | Security |
| Verdict | PASS |
| Notes | All order requests and execution reports are domain-validated; invalid transitions raise `OrderStateError` (409). Fill quantity cannot exceed remaining; FILL must complete the order; missing-fill fill reports are rejected. No secrets are logged (identifiers only). Note: the OMS treats an `ExecutionReport` as broker-confirmed — in production the broker adapter is the trust boundary that authenticates/validates the report before handing it to the OMS (M5/M8). In-process M4 is acceptable. |
| Status | PASS |

### 2026-09-15 — M4 QA Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Test adequacy: lifecycle, edge cases, idempotency, regression |
| Reviewer | QA |
| Verdict | PASS |
| Notes | Coverage: creation (valid, invalid request, duplicate client id, idempotency key reuse + collision, account filter), lifecycle (submit, accept, reject, partial→full, overfill, FILL-not-completing, partial-completes→filled, missing-fill, duplicate report), cancel (unsent immediate, working pending, terminal rejected), expire, modify (price update, terminal rejected), integration (ordered event sequence, unknown order, consumer observes final state, rejection emits no phantom fill). Addressed the standalone-run import issue via root `tests/conftest.py` path fix. |
| Status | PASS |

### 2026-09-15 — M5 Execution Engine — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Commit/version | M5 (pre-commit) |
| Test category | unit + integration — execution engine |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 232 |
| Passed | 232 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA + Quant + Security review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed.
- `mypy .` (strict) → Success: no issues found in 39 source files.
- `ruff format --check .` → all files formatted.

Coverage breakdown of the 232 tests: 29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 +
15 M5 (execution engine unit 11, execution integration 4).

### 2026-09-15 — M5 Regression (M0 + M1 + M2 + M3 + M4)

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Test category | regression — M0 + M1 + M2 + M3 + M4 |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 217 |
| Passed | 217 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

### 2026-09-15 — M5 Quant Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Execution workflow, partial/multiple fills, timeout/retry, reconciliation |
| Reviewer | Quant |
| Verdict | PASS |
| Notes | Workflow is correct: submit → PENDING_SUBMIT → broker ack → SUBMITTED (OrderAccepted); partial/multiple fills accumulate to FILLED; reject/cancel/expire paths align with M4. No unconfirmed execution assumption: a submit/cancel/modify timeout raises `BrokerError(TIMEOUT)` leaving order state unchanged (never assumes rejection), resolved later by reconciliation. Retry is limited to transient `CONNECTION_LOST` and bounded by `submit_max_attempts`; it is safe only because `client_order_id` is the idempotency key and adapters must propagate it (documented). `reconcile()` (TS-006) re-syncs outstanding orders after reconnect. |
| Status | PASS |

### 2026-09-15 — M5 Security Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Execution authorization boundary, validation, failure handling, logging |
| Reviewer | Security |
| Verdict | PASS |
| Notes | The engine validates through the OMS/domain; broker failures map to `BrokerError` with stable codes; logs carry identifiers only (no secrets). Timeouts do not corrupt state (no unconfirmed rejection). Trust boundary: the engine accepts `ExecutionReport`s from the broker adapter — the adapter must authenticate/validate at M8/M9. No credentials stored. |
| Status | PASS |

### 2026-09-15 — M5 QA Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Execution lifecycle, concurrency, failure and retry, regression |
| Reviewer | QA |
| Verdict | PASS |
| Notes | Coverage: submit (accept, reject, timeout keeps state, retry succeeds, retry exhausted), cancel (unsent local, working via broker, terminal rejected), modify (working, terminal rejected), reconcile (async report applied), integration (ordered event sequence, multiple fills accumulate, duplicate report id ignored, consumer sees final state). Simulated-broker failure/timeout/retry scenarios covered. Renamed the execution unit test module to avoid a `test_engine` basename collision with M3. |
| Status | PASS |