# Test Status

Tracks the actual state of testing. **Never record `PASS` unless the test was
actually executed.** Test results are recorded only after real execution.

---

## Current Summary

| Category | Status |
| --- | --- |
| Unit Tests | ACTIVE — M0–M12 backend suites + M11/M12/M13 frontend unit suites (see Results Log) |
| Integration Tests | ACTIVE — M2–M12 component/integration suites + the M13 dual-broker FULL-STACK suite (API→auth→risk→OMS→execution→adapter→fills→portfolio→events→WS→REST, parameterized over IBKR and Saxo) |
| E2E Tests | IN-PROCESS ACTIVE — M13 full-stack + terminal-boundary flow tests drive the whole system end-to-end inside the test process; BROWSER-driven E2E (real Chrome) remains M16 scope; live REST+WS contract smokes recorded under M11/M12 |
| Security Tests | ACTIVE — M12 authn/authz suite + M14 hardening suites (login throttling incl. fail-closed lockout, security headers, docs gating, WS-ticket caps, session sweeps, input bounds, repository secrets guard, frontend static-security guards); adversarial re-review PASS |
| Performance Tests | NOT STARTED |
| Broker/Sandbox Tests | SIMULATED — both adapters + the full stack run against SimulatedIbkrClient / SimulatedSaxoClient (paper/sim; no live trading). EXTERNAL sandbox/paper validation (real TWS/Saxo sim): NOT EXECUTED — no credentialed environment exists (documented since M8/M9, ADR-014/015) |
| Dependency Scans | ACTIVE (M14) — `npm audit`: 16 advisories → 0 after the dev-toolchain upgrade (ESLint 9 / Vite 8 / Vitest 5; none were runtime deps); `pip-audit` (project venv): 0 known vulnerabilities; system-wide packages outside the venv are not shipped in any artifact |
| Quant Validation | PASS (M1–M9 trading/accounting/broker-mapping semantics; M10 delegation-only; M11 presentation-only; M12 transport/security-only; M13 re-verified fills→positions→P&L consistency through the whole stack on BOTH brokers) |

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

### 2026-09-15 — M6 Risk Engine — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Commit/version | M6 (pre-commit) |
| Test category | unit + integration — risk engine |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 269 |
| Passed | 269 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA + Quant + Security review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed.
- `mypy .` (strict) → Success: no issues found in 45 source files.
- `ruff format --check .` → all files formatted.

Coverage breakdown of the 269 tests: 29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 +
15 M5 + 37 M6 (risk unit 32, risk integration 5).

### 2026-09-15 — M6 Regression (M0 + M1 + M2 + M3 + M4 + M5)

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Test category | regression — M0–M5 |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 232 |
| Passed | 232 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

### 2026-09-15 — M6 Quant Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Risk rules, position/exposure/cash math, kill switch, fail-safe semantics |
| Reviewer | Quant |
| Verdict | PASS |
| Notes | Rules are deterministic and configurable (limit `None` = not enforced): kill switch, order size, position limit (signed long/short), notional exposure (current exposure + order notional), available funds (buy-side, buying power/cash), daily order count, daily loss (fail-closed if configured but P&L unavailable), trading session. Position math uses signed quantities; SELL is not cash-gated. State ownership is clean: risk owns kill switch + order counts; reads positions/exposure (M7), balance (account), quotes (M3), P&L (M7) — no duplicate portfolio. |
| Status | PASS |

### 2026-09-15 — M6 Security Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Fail-safe behavior, kill switch, authorization boundary, abuse scenarios |
| Reviewer | Security |
| Verdict | PASS |
| Notes | Fail-closed by design: when a required safety condition cannot be evaluated (no balance, no/stale quote, P&L unavailable), the affected rule rejects with `data_unavailable=True` — no silent approval. Kill switch is effective and blocks even when no limits are configured. Duplicate `OrderSubmitted` events are deduped by `event_id` (no order-count inflation). `RiskViolation` events carry only account/instrument/rule/message (no sensitive internals). Decisions are deterministic and explainable. Broker-independent; no credentials. |
| Status | PASS |

### 2026-09-15 — M6 QA Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Risk rules, edge cases, fail-safe, concurrency, gate integration |
| Reviewer | QA |
| Verdict | PASS |
| Notes | Coverage: each rule approve/reject, kill switch (per-account + global), fail-safe (no quote, no balance, stale), duplicate events (dedup), concurrency (concurrent evaluations serialize order counts; concurrent submits counted once), determinism, explainability, violation-event publishing (reject publishes, approve does not), risk-gated execution (approved → broker; rejected/kill-switch → no broker call, no bypass), reactivity (position/quote updates affect the next evaluation). Renamed the risk unit test module to avoid a `test_engine` basename collision with M3. |
| Status | PASS |

### 2026-09-15 — M7 Portfolio & P&L — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Commit/version | M7 (pre-commit) |
| Test category | unit + integration — portfolio & P&L |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 310 |
| Passed | 310 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA + Quant + Security review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed.
- `mypy .` (strict) → Success: no issues found in 47 source files.
- `ruff format --check .` → all files formatted.

Coverage breakdown of the 310 tests: 29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 +
15 M5 + 39 M6 + 39 M7 (portfolio accounting 14, portfolio service 22, portfolio
integration 3). Note: the M6 count grew from 37 to 39 via two new M6 regression
tests added during M7 (see Defect Fix below).

### 2026-09-15 — M7 Regression (M0–M6)

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Test category | regression — M0–M6 (includes the M6 daily-loss fix) |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 271 |
| Passed | 271 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

### 2026-09-15 — M7 Defect Fix (M6 daily-loss sign semantics)

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Found by | M7 integration testing (realized-loss → risk daily-limit flow) |
| Defect | M6 `DailyLossLimitRule` treated `max_daily_loss` as a signed value while negating it, so a negative configuration (e.g. -50) rejected even zero-P&L orders; the M6 unit fixture also never wired the `DailyPnlProvider`, so the exceed test passed for the wrong reason. |
| Fix | `max_daily_loss` is now documented and validated as a POSITIVE loss magnitude (floor = -(max_daily_loss)); a negative configuration fails closed. The M6 risk test fixture wires the provider; new regressions cover zero-P&L approval, negative-limit rejection, and the unavailable-provider path (269 → 271 M0–M6 tests). |
| Reviewer | Quant + QA |
| Status | RESOLVED (verified by the full 310-test run) |

### 2026-09-15 — M7 Quant Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Position accounting, realized/unrealized P&L, valuation, equity |
| Reviewer | Quant |
| Verdict | PASS |
| Notes | Average-cost accounting verified against hand-calculated values: open (avg = fill price), increase (VWAP), reduce (realized = (exit−avg)×closed, average retained), close (flat, average cleared), reversal (closing portion realizes; opposite side opens at the fill price), shorts symmetric. Fees (domain `commission`/`fees`) reduce realized P&L immediately; currency guarded, no invented FX. Unrealized P&L is sign-aware and returns None when unpriced (never silently zero). Exposure is gross notional with a documented entry-price fallback when the quote is stale; equity = cash + signed market value and is None without a known balance. Duplicate fills deduped by `fill_id`; fill order preserved per ADR-007. Multi-currency aggregates return None instead of cross-currency sums. |
| Status | PASS |

### 2026-09-15 — M7 Security Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Data integrity, untrusted inputs, sensitive information |
| Reviewer | Security |
| Verdict | PASS |
| Notes | Stale/missing market data is never used as a valid current price for unrealized P&L (None), with a documented entry-price fallback for exposure/equity. Duplicate fill delivery cannot double-apply (fill_id dedup, tested for both same-envelope and same-fill-id-new-envelope). Currency mismatches and foreign-account snapshot positions are rejected. Logs carry account identifiers and counts only; no credentials. Broker-independent (imports verified: domain + events only). |
| Status | PASS |

### 2026-09-15 — M7 QA Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Accounting scenarios, edge cases, concurrency, integration |
| Reviewer | QA |
| Verdict | PASS |
| Notes | Coverage: open/increase/reduce/close/reverse, partial and multiple fills, VWAP, realized (per-fill, cumulative, daily), unrealized, exposure, equity, balance events, position lifecycle events (opened/updated/closed, reversal = update), duplicates, stale/missing quotes, entry-price fallback, concurrent fills and fill+quote races, broker snapshot reconciliation (+ foreign-account rejection), risk integration (position limit via `PortfolioView`, daily loss via `DailyPnlProvider`, violation events). Two test-authoring arithmetic errors were corrected against implementation-verified expectations, and the M6 daily-loss sign defect plus its fixture gap were found and fixed with new regressions. |
| Status | PASS |

### 2026-09-15 — M8 IBKR Adapter — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Commit/version | M8 (pre-commit) |
| Test category | unit + integration + broker simulation — IBKR adapter |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 368 |
| Passed | 368 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (Backend + QA + Quant + Security review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed.
- `mypy .` (strict) → Success: no issues found in 51 source files.
- `ruff format --check .` → all files formatted.

Coverage breakdown of the 368 tests: 29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 +
15 M5 + 39 M6 + 39 M7 + 58 M8 (IBKR mapping 24, IBKR adapter 31, IBKR
end-to-end 3).

### 2026-09-15 — M8 Regression (M0–M7)

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Test category | regression — M0–M7 |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 310 |
| Passed | 310 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

### 2026-09-15 — M8 Live/Paper Validation

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Category | broker integration validation |
| Result | NOT PERFORMED — no TWS/IBKR Gateway or credentials exist in this environment, and the roadmap forbids live trading during development milestones. All M8 behavior is verified against the in-memory `SimulatedIbkrClient` (paper/simulation mode, ADR-014). Controlled connection/contract/market-data/paper-order validation against a real paper account is a documented follow-up for a credentialed environment; no credentials are committed anywhere. |
| Status | DEFERRED (documented) |

### 2026-09-15 — M8 Backend Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Broker boundary, port conformance, core isolation |
| Reviewer | Backend / Architect |
| Verdict | PASS |
| Notes | `IbkrAdapter` implements the M3 `MarketDataFeed` and M5 `ExecutionBroker` ports (verified structurally: it is passed directly to `MarketDataEngine` and `ExecutionEngine` in the end-to-end test). IBKR imports exist only inside `backend/brokers/ibkr` (grep-verified); the core never sees IBKR types. The adapter returns reports/pushes callbacks only — it never bypasses OMS/Execution semantics. Broker-side account data is relabeled to the internal account id by the adapter. |
| Status | PASS |

### 2026-09-15 — M8 Quant Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Instrument/order/execution/account mapping semantics |
| Reviewer | Quant |
| Verdict | PASS |
| Notes | Instrument mapping: EQUITY↔STK; FOREX pairs ↔ CASH (EUR/USD → base EUR / quote USD on IDEALPRO) with round-trip tests; CON_ID preserved both ways; unknown venues route SMART (documented). Order mapping: side, MKT/LMT/STP/STP LMT, TIF matrix; quantities preserved exactly as Decimal strings. Execution mapping: BOT/SLD → BUY/SELL, unix seconds → tz-aware UTC, execution_id → fill_id, orderRef → client_order_id; partial vs full determined by cumulative vs order quantity (OMS double-checks completion). Statuses: Submitted/PreSubmitted → ACCEPTED, Cancelled/ApiCancelled → CANCELLED, Inactive → REJECTED; fill statuses intentionally unmapped (executions carry the fills) — correct. Account: TotalCashValue/AvailableFunds/BuyingPower per currency; positions carry avg_cost → average_price. |
| Status | PASS |

### 2026-09-15 — M8 Security Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Credentials, error exposure, untrusted broker responses, redelivery |
| Reviewer | Security |
| Verdict | PASS |
| Notes | No credentials/secrets exist in the adapter or simulated client; the adapter receives only a client port, bus, and account id. Real-client credential handling belongs to the future ibapi-backed client (documented in ADR-014; nothing committed). IBKR errors map to the internal `BrokerError` hierarchy with raw codes preserved for diagnostics — no raw IBKR exceptions leak into the core; logs carry identifiers/codes only. Untrusted responses are hardened: malformed quotes/bars/positions are dropped without crashing (pydantic/ValueError covered), unmapped sec types rejected, duplicate status/execution callbacks deduped so redelivery cannot double-apply fills or state changes, and executions for unknown orders are dropped. |
| Status | PASS |

### 2026-09-15 — M8 QA Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Connection, market data, orders, executions, duplicates, reconciliation |
| Reviewer | QA |
| Verdict | PASS |
| Notes | Connection: success/failure, idempotent start, clean stop ("shutdown"), unexpected disconnect ("connection lost"), reconnect re-subscribes exactly once (client drops subs on disconnect), idempotent reconnect. Market data: subscribe/unsubscribe, duplicate subscribe deduped, quote push (bid/ask/last/sizes/UTC timestamp), malformed quote dropped, bar push with interval mapping, historical request validated, subscribe requires connection. Orders: submit accept, submit rejection returned, cancel confirmed via callback, modify confirmed (REPLACED), unknown-order cancel raises, not-connected rejections. Dedup: repeated Submitted/Cancelled statuses never double-push; duplicate executions (same execution_id) never double-fill; status replay after reconnect delivers new information exactly once. Reconciliation: poll-based (`fetch_order_status` returns None when unchanged; broker-side cancel detected) and replay-based (reconnect status replay) both covered end-to-end. Account/positions: balance publish with per-currency aggregation; position snapshot relabeled to the internal account. |
| Status | PASS |

### 2026-09-15 — M9 Saxo Adapter — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Commit/version | M9 (pre-commit) |
| Test category | unit + integration + broker simulation — Saxo adapter |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 432 |
| Passed | 432 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (Backend + QA + Quant + Security review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed.
- `mypy .` (strict) → Success: no issues found in 55 source files.
- `ruff format --check .` → all files formatted.

Coverage breakdown of the 432 tests: 29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 +
15 M5 + 39 M6 + 39 M7 + 58 M8 + 64 M9 (Saxo mapping 24, Saxo adapter 36, Saxo
end-to-end 4).

### 2026-09-15 — M9 Regression (M0–M8)

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Test category | regression — M0–M8 |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 368 |
| Passed | 368 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

### 2026-09-15 — M9 Sandbox/Live Validation

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Category | broker integration validation |
| Result | NOT PERFORMED — no Saxo simulation-environment credentials exist in this repository, and the roadmap forbids live trading during development milestones. All M9 behavior is verified against the in-memory `SimulatedSaxoClient` (sim/paper mode, ADR-015): unit tests (mock-level) and mock integration/end-to-end tests on the real engine stack. Controlled sim-environment validation (OAuth flow, account retrieval, instrument lookup, market-data subscription, historical data, paper orders) is a documented follow-up for a credentialed environment. No credentials or tokens are committed. |
| Status | DEFERRED (documented) |

### 2026-09-15 — M9 Backend Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Broker abstraction reuse, port conformance, core isolation, parity |
| Reviewer | Backend / Architect |
| Verdict | PASS |
| Notes | `SaxoAdapter` implements the SAME M3 `MarketDataFeed` and M5 `ExecutionBroker` ports as the IBKR adapter — proven structurally in the end-to-end tests, where both adapters plug into `MarketDataEngine`/`ExecutionEngine`/`OrderManager`/`PortfolioService` on one bus without core changes. The abstraction was NOT extended: every Saxo difference (OAuth session lifecycle, UIC identifiers, Expired status, full balance snapshots) is handled inside the adapter. Grep-verified: no `brokers.saxo` import exists outside `backend/brokers/saxo`; no Saxo types reach the core. OMS/Execution semantics never bypassed. |
| Status | PASS |

### 2026-09-15 — M9 Quant Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Instrument, order, execution, balance, position mapping semantics |
| Reviewer | Quant |
| Verdict | PASS |
| Notes | UIC/AssetType instrument mapping with round-trips (Stock↔EQUITY, FxSpot↔FOREX with "EUR/USD" pairs); the adapter requires the broker-neutral `SAXO_UIC` identifier and never guesses. Order mapping: buy/sell, Market/Limit/Stop/StopLimit, Day/Gtc/Ioc/Fok/Gtd durations, ExternalReference = client_order_id, exact Decimal quantities. Executions: buy/sell → BUY/SELL, unix → tz-aware UTC, execution_id → fill_id, partial vs full from cumulative vs order quantity (OMS double-checks completion). Statuses: Working/WaitingConfirmation → ACCEPTED, Cancelled → CANCELLED, Rejected → REJECTED, and Saxo's additional Expired → EXPIRED; Received/Suspended/ fill statuses intentionally unmapped (executions carry fills). Balances: full snapshots (cash/available/margin→buying power) per currency. Positions: signed position sizes with average open price. |
| Status | PASS |

### 2026-09-15 — M9 Security Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | OAuth/token handling, credentials, error exposure, untrusted responses |
| Reviewer | Security |
| Verdict | PASS |
| Notes | No credentials or tokens exist in code; `SaxoSession` holds opaque simulated tokens that are never logged or committed. Real credential/token acquisition (client secret, OAuth redirect) belongs to the future real transport reading `.env` (never committed) — documented in ADR-015. Token expiry handled without exposing tokens: proactive refresh on the broker's expiry notification; reactive refresh-and-retry safe because an auth-rejected request was not processed; refresh failure maps to UNAUTHORIZED and drops the session. Errors mapped to the internal `BrokerError` hierarchy (401/403 → UNAUTHORIZED, 404 → NOT_FOUND, 429 → RATE_LIMITED, 503 → CONNECTION_LOST) with codes only in logs — no raw Saxo exceptions leak into the core. Malformed prices (incl. Decimal conversion failures), unmappable instruments, and untracked-UIC quotes are dropped without crashing; duplicate status/execution redelivery cannot double-apply. |
| Status | PASS |

### 2026-09-15 — M9 QA Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Session/auth, connection, market data, orders, dedup, reconciliation |
| Reviewer | QA |
| Verdict | PASS |
| Notes | Session: authorize success/failure (UNAUTHORIZED), idempotent start, proactive refresh on token expiry (mid-session recovery without disconnect), reactive refresh-and-retry on a silently expired token, refresh failure → disconnect event + UNAUTHORIZED on requests. Connection: stop ("shutdown"), unexpected disconnect ("connection lost"), reconnect re-subscribes exactly once, idempotent reconnect. Market data: subscribe/unsubscribe, duplicate subscribe deduped, quote push (bid/ask/last/sizes/UTC), untracked-UIC quote dropped, malformed quote dropped (non-numeric price), bars, historical request validated, not-connected rejection. Orders: accept/reject/cancel (CANCELLED)/modify (REPLACED)/unknown-order raises. Dedup: status repeats never double-push, duplicate executions never double-fill, replay-after-reconnect delivers exactly once. Account/positions: full balance snapshot relabeled to the internal account, aggregated `account_balance()`, positions relabeled. Reconciliation: unchanged → None, broker-side cancel via poll, broker-side Expired via poll, replay dedup. End-to-end: full stack on one bus (connect event, quote event, balance event → portfolio, submit → ack → fill → OMS FILLED → position opened, broker-authoritative snapshot reconciliation), transparent token-expiry recovery mid-session, reconnect recovery, reconcile-poll. |
| Status | PASS |

### 2026-09-15 — M9 Broker Parity Review (IBKR vs Saxo)

| Area | IBKR | Saxo | Verdict |
| --- | --- | --- | --- |
| Ports | `MarketDataFeed` + `ExecutionBroker` | same | Common interface ✓ |
| Lifecycle events | `BrokerConnected`/`BrokerDisconnected` | same | Common ✓ |
| Dedup semantics | last-status per order; executions by id | same | Common ✓ |
| Reconnect | registry re-subscribe + state replay | same | Common ✓ |
| Account relabeling / M7 boundary | yes / `position_snapshot` | same | Common ✓ |
| Authentication | none (TWS session) | OAuth tokens, proactive + reactive refresh | Legitimate difference (ADR-015) |
| Instrument ids | `CON_ID` in `identifiers` | `SAXO_UIC` in `identifiers` | Broker-neutral field reused ✓ |
| Order types/TIF | MKT/LMT/STP/STP LMT; DAY/GTC | Market/Limit/Stop/StopLimit; Day/Gtc | Spelling differences mapped ✓ |
| Status vocab | Submitted/PreSubmitted/Inactive | Working/WaitingConfirmation/Rejected; Expired | Mapped to common report types; Saxo adds EXPIRED ✓ |
| Account data | incremental key/value pairs | full balance snapshots | Handled inside adapters ✓ |
| Quote resolution | contract → instrument | UIC via subscription registry (untracked dropped) | Legitimate difference ✓ |

Reviewers: Architect + Backend. Verdict: **PASS** — a common trading interface
with explicit capability differences; the abstraction required no extension.
### 2026-09-15 — M10 API Gateway — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Commit/version | M10 (pre-commit) |
| Test category | unit + integration + API endpoint + WebSocket |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 482 |
| Passed | 482 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (Backend + QA + Security review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` -> All checks passed.
- `mypy .` (strict) -> Success: no issues found in 62 source files.
- `ruff format --check .` -> all files formatted.

Coverage breakdown of the 482 tests: 29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 +
15 M5 + 39 M6 + 39 M7 + 58 M8 + 64 M9 + 50 M10 (API schemas 8, WS hub 9,
REST endpoint 26, WebSocket 7).

### 2026-09-15 — M10 Regression (M0–M9)

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Test category | regression — M0–M9 (includes the OrderManager idempotency-key lookup addition) |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 432 |
| Passed | 432 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

### 2026-09-15 — M10 Backend Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | API/business separation, composition, event reuse, broker independence |
| Reviewer | Backend / Architect |
| Verdict | PASS |
| Notes | Every endpoint is thin delegation: order creation goes through the M6 `RiskGatedExecutor` (risk cannot be bypassed via the API); cancel/modify delegate to the M5 Execution Engine; reads delegate to OMS/portfolio read models; kill-switch to the M6 Risk Engine. No business logic lives in `backend/api` — only DTO mapping and error translation. `EngineRuntime` (application) depends solely on ports; concrete adapters are injected ONLY at `backend/main.py` (the composition boundary, grep-verified: zero adapter imports in `api/` or `application/`). The WS hub reuses the M2 bus + registry-driven `EventSerializer` — no second event system. Single-broker runtime documented (the M5 Execution Engine binds one broker; multi-broker routing is future work). |
| Status | PASS |

### 2026-09-15 — M10 Security Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Input validation, error leakage, WS handling, auth boundary |
| Reviewer | Security |
| Verdict | PASS |
| Notes | Input validation: strict DTOs (`extra="forbid"`, no mass assignment), domain-level financial validation (400 on invariant violations), validated query params, WS topic validation (close 4400 on unknown topics). Error leakage: stable internal error codes only; unhandled exceptions return a generic 500 with full context logged server-side only — no tracebacks, internals, or broker specifics. No secrets/tokens in code. Auth: the M12 hook (`get_current_principal`) is applied router-wide; M10 admits an anonymous principal (documented development posture, ADR-016) — the kill-switch control is privileged and becomes enforcement-backed in M12. WS: bounded per-client queues (reserved sentinel slot) close slow clients with 1013 instead of silently dropping events or growing memory; clean disconnect cleanup cancels sender tasks. |
| Status | PASS |

### 2026-09-15 — M10 QA Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | REST/WS surface, validation and error paths, concurrency, lifecycle |
| Reviewer | QA |
| Verdict | PASS |
| Notes | REST: health, broker status (connect/drop), create 201 (exact-decimal strings), idempotent replay 200 (same order, no duplicate), domain-invariant 400, body-validation 422, unknown-field 422, zero-quantity 400, unknown order 404, account-filtered listing, cancel 200 / double-cancel 409, modify 200 / no-prices 400, full lifecycle with broker fills, balance 404 then 200, positions after fill (unpriced unrealized is null, never zero), summary (equity/exposure/market value per currency), quote 404 then 200 with staleness flag, invalid asset class 400, risk dry-run, kill-switch activate/status/block-orders/deactivate, risk-limit rejection 422 with rule details, and 5 parallel submissions (distinct idempotency keys, all 201, no interleaving corruption). WS: hello contract, ping-pong, invalid-topic close 4400, order lifecycle in engine order (submitted->accepted->cancelled with monotonic timestamps), topic filtering (orders-only client excluded risk violations; all-client received them), fan-out to two clients with identical event_id, and fill-driven streaming asserting the documented cross-topic interleave (nested position reactions) with per-topic monotonicity. Unit: schema mapping/exact decimals/mass-assignment rejection; hub topics/fan-out/filtering/unregister/backpressure sentinel/sender close 1013. Issues found and fixed during testing: hub sentinel-slot race, "0E-8" scientific-notation serialization, GET-with-body smell, cross-event-loop drain (now drained on the app loop via the TestClient portal). |
| Status | PASS |

### 2026-09-15 — M10 Race/Event-Sync Review

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Review scope | Concurrency, duplicate/stale events, event-to-client synchronization |
| Reviewer | Architect + QA |
| Verdict | PASS |
| Notes | Hub fan-out is atomic per delivery (handler only does `put_nowait`; no awaits), registration is confined to the WS endpoint coroutine, and queues are bounded with a reserved close sentinel — no unbounded growth, no silent drops. WS delivery is at-least-once with `event_id` on every message; clients dedupe and resync via REST. Duplicate events: idempotent order creation by key; bus-level dedup remains upstream (ADR-012/013). Documented ordering discovery (ADR-016): within a topic the engine publish order is preserved; across topics, nested reactions interleave by subscriber registration order (e.g. `position.opened` queued during the dispatch of `order.partially_filled` arrives before it) — tested and asserted as designed behavior; timestamps are creation-ordered so cross-topic streams can legitimately go backwards. |
| Status | PASS |
### 2026-09-27 — M11 React Trading Terminal — Frontend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-27 |
| Commit/version | M11 (pre-commit) |
| Test category | unit + component + hook-integration (frontend) |
| Test command | `npm run test` (from `frontend/`) |
| Tests executed | 89 |
| Passed | 89 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (Frontend + QA review) |
| Status | PASS |

Additional frontend checks (same date):

- `npm run typecheck` → clean (`tsc -b --noEmit`).
- `npm run lint` → clean (ESLint).
- `npm run format:check` → clean (Prettier).
- `npm run build` → success (`tsc -b && vite build`).

Coverage breakdown of the 89 tests: unit 44 (decimal utils 10, stores/merge
semantics 15, API client error mapping 9, WS client sync/reconnect 10),
hook-integration 8 (`useTerminal` resync/event-routing/reconnect/account-switch
against mock API + MockWebSocket), component 37 (order ticket 9 — validation,
submit, risk-rejection rendering, idempotency-key lifecycle incl. timeout-retry
replay and post-success rotation, dry-run, kill-switch warning; order blotter 8
— filters, terminal-state action disabling, confirmed cancel, 409 surfacing,
modify dialog; panels 17 — positions empty/stale/unpriced states, account
missing-balance vs error, kill-switch confirm + failure handling, watchlist
add/remove/quote/stale badges, broker list, connection banner states; App 3 —
terminal chrome, WS connect, view switching, WS-driven blotter updates).

### 2026-09-27 — M11 Backend Regression (M0–M10)

| Field | Value |
| --- | --- |
| Date | 2026-09-27 |
| Test category | regression — full backend suite after M11 frontend work (no backend changes) |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 482 |
| Passed | 482 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

Additional backend checks (same date, unchanged from M10):

- `ruff check .` → All checks passed. `mypy .` (strict) → clean (62 files).

### 2026-09-27 — M11 Live Contract Smoke (real M10 gateway, REST + WS)

| Field | Value |
| --- | --- |
| Date | 2026-09-27 |
| Test category | integration (live gateway) — frontend contract verification |
| Test command | `python main.py` (backend, simulated stack) + ad-hoc HTTP/WS client exercising the exact frontend contract |
| Tests executed | 10 contract points |
| Passed | 10 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA + Backend) |
| Status | PASS |

Verified against the RUNNING M10 gateway: health/brokers/summary shapes;
balance-404 error-code contract; WS hello control frame + order events carrying
`event_id`; POST /orders 201 with exact-decimal strings (server quantizes
quantities to 8dp — opaque to the frontend, which renders strings verbatim);
idempotent replay 200 with the same `client_order_id`; risk kill-switch
rejection as 422 with `violations[]`; cancel 200 → CANCELLED. Confirms the
frontend's API/WS clients consume the real server contract end-to-end.

### 2026-09-27 — M11 Frontend/QA Review

| Field | Value |
| --- | --- |
| Date | 2026-09-27 |
| Review scope | State consistency, real-time sync, races, error handling, test adequacy |
| Reviewer | Frontend + QA |
| Verdict | PASS (after fixes) |
| Notes | Found and fixed during review: (1) the terminal performed its initial REST load only after the WS connected — a WS-only failure left panels in permanent loading; initial load is now independent of WS. (2) `isValidDecimalInput` accepted the empty string as a valid decimal (regex required no digits) — tightened to require at least one digit; regression added. (3) A WS reconnect test asserted the wrong backoff semantics (attempts reset on successful connect, then double per consecutive failure) — corrected. (4) `act`-ordering issues in tests (store populated after render without act). Verified passing: idempotent order/position event merges (WS replay cannot duplicate rows); WS↔REST position identity reconciliation; account-switch stale-result discard; StrictMode double-mount (socket cleanup); dedupe LRU bounded; debounce timers cleaned; getSnapshot stability; idempotency-key lifecycle on uncertain (504/5xx/network — key kept) vs definitive (2xx/400/422/409 — key rotated) outcomes; unpriced values never rendered as invented zeros. |
| Status | PASS |

### 2026-09-27 — M11 Security / Architecture Review

| Field | Value |
| --- | --- |
| Date | 2026-09-27 |
| Review scope | Secrets, injection, input validation, API-boundary compliance, dependency surface |
| Reviewer | Security + Architect |
| Verdict | PASS (after fixes) |
| Notes | Found and fixed during review: (1) untrusted path parameters (account id from the account selector, order ids) were interpolated into request paths unencoded — now `encodeURIComponent`-encoded (`ApiClient.seg`). (2) A kill-switch toggle result could land after an account switch mid-flight and be applied to the wrong account — result application now guards on the current account id. Verified passing: no secrets/tokens/credentials in code or tests; nothing persisted to localStorage/cookies; no `dangerouslySetInnerHTML`/`eval`/string-built URLs (all URLs via `URL` + `searchParams`); React-escaped text rendering only; user-facing errors carry stable server codes + generic messages (no stack traces/internals); client-side ticket validation is input-shape only — all trading/risk validation remains server-side (M1 domain + M6 gate); frontend talks only to `/api/v1` + `/ws` (no broker SDKs, no backend imports); the only new dependency is `@testing-library/user-event` (dev-only, testing-library family); WS malformed frames are isolated (never crash the terminal); dedupe set is bounded; the kill switch requires explicit confirmation and its failure path keeps prior state. |
| Status | PASS |

### 2026-09-30 — M12 Authentication & Authorization — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-30 |
| Commit/version | M12 (partial mid-flight commit 2223069 + working tree) |
| Test category | unit + integration + security — authN/AuthZ |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 586 |
| Passed | 586 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (Security + Backend + QA review) |
| Status | PASS |

Additional backend checks (same date):

- `ruff check .` → All checks passed. `ruff format --check .` → clean.
- `mypy .` (strict) → Success: no issues found in 66 source files.

Coverage breakdown of the 104 new M12 tests: unit 42 (passwords 11,
tokens 31 — JWT round-trip/tamper/wrong-secret/expiry/wrong-typ/wrong-iss,
rotation, reuse-theft, logout, session expiry, WS ticket single-use/TTL,
config validation incl. ≥32-byte key enforcement); integration 32 (auth
endpoints 25: login/refresh/logout/me/ws-ticket + parametrized
fail-closed-401 matrix; authorization 7 under `test_authorization.py` —
viewer read-only, trader/admin kill-switch, IDOR on get/cancel/modify/
replay, scope-filtered listings, wildcard admin); WS auth 7 (no/garbage/
expired ticket → 4401, single-use replay, outsider scope → 4403, authz
precedes topic validation, authorized stream flow); security suite 23
(bypass shapes incl. refresh-as-access/access-as-refresh confusion,
foreign-secret forgery, response/log leakage scans via caplog, user
enumeration resistance, CORS posture incl. no-wildcard-with-credentials,
identity-source hardening, refresh scope integrity). Existing M0–M11
regression (482) unchanged and green; two M10 WS/kill-switch tests were
updated to the now-correct admin role without weakening their assertions.

### 2026-09-30 — M12 Frontend Tests

| Field | Value |
| --- | --- |
| Date | 2026-09-30 |
| Test category | unit + component + hook-integration (frontend auth) |
| Test command | `npm run test` (from `frontend/`) |
| Tests executed | 109 |
| Passed | 109 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (Frontend + QA review) |
| Status | PASS |

Additional frontend checks (same date): `tsc -b`, ESLint, Prettier check,
`vite build` all clean. New M12 coverage (20 tests): session lifecycle
(in-memory-only storage asserted), single-flight refresh, failed-refresh
clears session, logout survives unreachable server; ApiClient interceptor
(bearer attach, 401→refresh→single retry with fresh token, dead-session 401
with no retry loop, auth endpoints never loop, 403 mapping); RBAC helpers
(viewer/trader/admin, wildcard vs scoped accounts); login view (generic
credential error — no enumeration, success mounts terminal); auth-gated App
(no socket pre-login, unmount on session expiry, logout control, admin
free-entry account selector); WS ticket flow (fresh ticket per connect,
URL contains ticket, new ticket after reconnect); viewer read-only order
ticket + admin-only kill-switch UX gating.

### 2026-09-30 — M12 Live Contract Smoke (real gateway, REST + WS)

| Field | Value |
| --- | --- |
| Date | 2026-09-30 |
| Test category | integration (live gateway) — authN/AuthZ contract verification |
| Test command | `python main.py` (AUTH_DEMO_* env-provisioned users) + ad-hoc HTTP/WS client driving the exact frontend flows |
| Tests executed | 19 contract points |
| Passed | 19 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (Security + QA) |
| Status | PASS |

Verified against the RUNNING M12-enabled gateway: fail-closed 401 on
unauthenticated /health (public /ready probe retained); generic 401 on
wrong password; trader login returns pair + identity; authenticated reads;
IDOR 403 on another-account order creation; trader 403 vs admin 200 on the
kill switch (and the kill switch genuinely blocks orders, 422 risk
rejection); WS refused without ticket (4401), ticket-gated hello + event
streaming, ticket replay refused (4401); refresh rotation with superseded
replay → 401 AND rotated-token death (theft response); logout revokes the
session.

### 2026-09-30 — M12 Security Review

| Field | Value |
| --- | --- |
| Date | 2026-09-30 |
| Review scope | Authentication bypass, broken authz/privilege escalation, IDOR, cross-account access, sensitive-data leakage, token/session weaknesses, WS authz gaps, insecure logging, frontend-only authz, CORS, committed secrets |
| Reviewer | Security + Architect |
| Verdict | PASS (after fixes) |
| Notes | Found and fixed during testing/review: (1) dev-bootstrap records passed frozensets into a list-expecting loader (crash on startup — fixed to plain dicts). (2) The refresh schema's 256-char cap turned JWT-confusion probes into 422 instead of reaching the auth layer — raised so confusion attacks get a real 401. (3) PyJWT's InsecureKeyLengthWarning surfaced a genuine gap — the TokenService now REJECTS signing keys < 32 bytes (RFC 7518) instead of warning. (4) An early-return before useMemo in the order ticket (conditional-hook violation) — gate moved after all hooks. Verified passing: all bypass token shapes → generic 401; foreign-secret forgery rejected; refresh-as-access and access-as-refresh confusion rejected; RBAC/IDOR matrix incl. loaded order resources and idempotent-replay cross-account; scope-filtered listings; response field-set exactness (no hash/token echoes); caplog-scanned audit events carry identifiers only; WS tickets single-use + account-scoped + authz-precedes-topics; CORS explicit-origin, credentials off, wildcard never allowed; unknown roles rejected at provisioning AND grant nothing; wildcard accounts require admin; refresh derives identity from the server session; user enumeration indistinguishable (status, body, cost); ephemeral dev secret never logged; no secrets/tokens/passwords in code, logs, or repo (fixture values clearly labeled; .env/user files gitignored and absent). |
| Status | PASS |

### 2026-10-01 — M13 Integration Testing — Backend Full-Stack Suite (dual broker)

| Field | Value |
| --- | --- |
| Date | 2026-10-01 |
| Commit/version | M13 (working tree) |
| Test category | integration + e2e (in-process full stack) — simulated brokers |
| Test command | `python -m pytest ../tests/integration/full_stack -q` (from `backend/`) |
| Tests executed | 56 |
| Passed | 56 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none (3 earlier failures investigated and resolved: drain-timing harness fix, poll-vs-replay reconciliation semantics, stable ORDER_NOT_FOUND/UNAVAILABLE error codes — see Integration Findings below) |
| Reviewer | Architect (QA + Backend + Quant review) |
| Status | PASS |

Scenario matrix (every test runs on BOTH the IBKR and Saxo simulated
stacks — parameterized 2x): golden trading flow (login, balance, quote,
risk dry-run, submit, WS-ordered lifecycle, partial + completing fills,
REST positions/P&L/summary, idempotent replay), sell-side close with
realized P&L, broker rejection surfacing, invalid input (zero quantity,
unknown fields), missing SAXO_UIC identifier (typed 502 on Saxo; 201 on
IBKR — legitimate capability difference), order-size and notional risk
rejections (the notional rule fail-closed on missing AND stale quotes,
approved on a fresh quote), kill-switch block + admin-only control,
duplicate execution applied once, overfill isolation (pipeline keeps
flowing — regression), double-cancel 409, unknown-order 404, cross-account
isolation (REST + IDOR on cancel + WS 4403), quote flows to WS+REST with
fresh/stale/missing semantics and valuation degradation/recovery (never an
invented zero), broker disconnect → reconnect with working order intact
and balance replayed, broker-side cancellation via M5 reconciliation,
duplicate state replay after double reconnect, WS client reconnect with a
fresh single-use ticket and continued streaming, stable error envelopes
(400/401/404 across layers), 5 parallel submissions with independent fills,
burst fill accumulation in bus order, and conflicting-report terminal-state
integrity.

### 2026-10-01 — M13 Backend Full Suite (regression + new unit regressions)

| Field | Value |
| --- | --- |
| Date | 2026-10-01 |
| Test category | regression — full backend suite (M0–M12 + M13 additions) |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 647 |
| Passed | 647 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

Additional backend checks (same date): `ruff check`, `ruff format --check`,
`mypy` (strict, 66 files) all clean. The 61 new M13 tests = 56 full-stack +
3 `InstrumentIn.identifiers` schema regressions + 2 execution-engine
report-isolation regressions (async delivery + reconcile paths). One
collection collision was fixed by renaming the new module
(`test_full_stack_concurrency.py`) — matching the repo's documented
basename-uniqueness convention.

### 2026-10-01 — M13 Frontend Terminal-Boundary Flow Test

| Field | Value |
| --- | --- |
| Date | 2026-10-01 |
| Test category | integration/e2e (frontend, transport-mocked) |
| Test command | `npm run test` (from `frontend/`) |
| Tests executed | 110 |
| Passed | 110 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

The new `App.flow.test.tsx` drives the REAL app (auth gate, stores,
useTerminal, panels) with only the transport mocked: login → live terminal →
order submission through the ticket UI → WS-driven blotter updates
(accepted → partially filled, no manual refresh) → confirmed cancel →
connection-loss banner → fresh-ticket reconnect (second WS ticket consumed).
`tsc -b`, ESLint, Prettier check, `vite build` all clean.

### 2026-10-01 — M13 Integration Findings (defects found and resolved)

| Field | Value |
| --- | --- |
| Date | 2026-10-01 |
| Found by | M13 full-stack integration testing |
| Defect 1 | The REST `InstrumentIn` DTO could not express the broker-neutral instrument `identifiers` (ADR-015). The Saxo adapter requires `SAXO_UIC` and never guesses, so a Saxo-backed runtime was unreachable through the documented API flow (orders failed with a typed broker error, and market-data subscriptions could not register the UIC). |
| Fix 1 | `InstrumentIn.identifiers: dict[str, str]` (default empty — backward compatible) now passes through `build_order_request` into the domain `Instrument`. Regression coverage: 3 schema tests (pass-through, no shared-mutable-default, string-only values) + the entire Saxo half of the full-stack suite (submission, quotes, valuation now flow end-to-end). |
| Defect 2 | An invalid asynchronously-delivered broker report (e.g. an overfill) raised `OrderStateError` through `ExecutionEngine._on_broker_report` into the adapter's delivery loop — aborting the drain and wedging every subsequent queued report (one bad report could poison the pipeline). The same exposure existed in the reconcile sweep. |
| Fix 2 | The engine boundary now isolates invalid reports: logged (`execution_report_rejected`, identifiers only) and dropped, in BOTH the async-delivery and reconcile paths. OMS rejection semantics are unchanged (the OMS still refuses the bad report; state is untouched). Regression coverage: 2 engine tests (invalid async report dropped + pipeline continues; reconcile skips invalid poll + continues) + the full-stack overfill test proving a valid report queued BEHIND the bad one still delivers. |
| Reviewer | Architect + Backend + QA |
| Status | RESOLVED (verified by the 647-test run) |

### 2026-10-01 — M13 Integration / Architecture Review

| Field | Value |
| --- | --- |
| Date | 2026-10-01 |
| Review scope | Cross-boundary consistency, hidden coupling, broker-specific leakage, test-boundary discipline |
| Reviewer | Architect (+ Backend, QA) |
| Verdict | PASS |
| Notes | Grep-verified after M13 changes: no `brokers.ibkr`/`brokers.saxo` import exists outside the adapter packages, `main.py`, and tests; domain/events import no framework or broker (the single grep hit was the docstring stating the rule); the only broker token in `backend/api` is a comment documenting the broker-neutral identifiers field. Instrument identity is resolved through the domain's `primary_identifier` (exchange:symbol), which absorbs legitimate per-adapter enrichment (Saxo sets instrument_type + SAXO_UIC, IBKR sets CON_ID, REST DTOs set neither) — verified by quote/position/valuation lookups working identically on both stacks. The full-stack suite drives the system ONLY through authenticated REST + ticketed WS for all BEHAVIORAL assertions (direct OMS access is fixture construction for simulated executions, matching the established M10 conftest pattern). The two defects above were the only cross-boundary findings; both were fixed at the correct layer (API DTO / engine trust boundary) rather than worked around in tests. |
| Status | PASS |

### 2026-10-08 — M14 Security Hardening — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-10-08 |
| Commit/version | M14 (working tree) |
| Test category | unit + security — hardening controls |
| Test command | `python -m pytest ../tests -q` (from `backend/`) |
| Tests executed | 677 |
| Passed | 677 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (Security review) |
| Status | PASS |

Additional backend checks (same date): `ruff check`, `ruff format --check`,
`mypy` (strict, 67 files) all clean. The 30 new M14 tests: login-throttle
units (window slide, per-key isolation, success reset, fail-closed,
thread-safety, stale-key bounding, spray housekeeping), WS-ticket cap
(flood eviction, per-subject isolation, expired eviction), session sweep
(expired-only removal), adversarial surface tests through the real app
(lockout + fail-closed-for-correct-password, no username-existence leak,
security headers on public and authenticated responses, docs gated by
default/enabled explicitly), input-boundary regressions (oversized
identifier keys/values rejected 422), and the repository secrets guard
(no secret-like tracked files, no private-key/token-shaped content,
gitignore coverage).

### 2026-10-08 — M14 Frontend Security Tests

| Field | Value |
| --- | --- |
| Date | 2026-10-08 |
| Test category | unit (static security guards) + full suite |
| Test command | `npm run test` (from `frontend/`) |
| Tests executed | 116 |
| Passed | 116 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (Security review) |
| Status | PASS |

The 6 new static guards assert the terminal's XSS/exfiltration posture
across the entire source tree: no raw-HTML injection sinks, no
localStorage/sessionStorage persistence, no credential/token logging, no
dynamic code execution, no hardcoded secrets — plus a non-empty-tree
sanity check. Toolchain upgraded to run them: ESLint 9 (flat config),
Vite 8, Vitest 5 — the entire frontend suite (110 existing tests)
passes unmodified under the new stack.

### 2026-10-08 — M14 Dependency / Configuration Checks

| Field | Value |
| --- | --- |
| Date | 2026-10-08 |
| Check | `npm audit` (frontend, post-upgrade) |
| Result | **0 vulnerabilities** (was 16: 2 moderate, 10 high incl. chains through the old ESLint 8/braces/glob toolchain, 2 critical in the old vitest tinypool chain). All were dev/build-time only — never runtime dependencies of the served bundle. Remediation: toolchain upgrade (ESLint 9, Vite 8, Vitest 5, typescript-eslint 8) rather than acceptance. |
| Check | `pip-audit` (backend, project venv) |
| Result | **No known vulnerabilities** in the project's dependency surface. A first run against the machine's system-wide Python (django, sqlparse, urllib3, pip, setuptools, uv) is out of scope: none are project dependencies and none ship in the backend image (which installs only pyproject deps). |
| Check | `docker compose config` (with placeholder .env) |
| Result | Valid; required-variable enforcement confirmed (POSTGRES_PASSWORD / JWT_SECRET_KEY fail-fast when unset), healthchecks resolve, loopback binds default. |
| Check | Repository secrets guard (automated test) |
| Result | PASS — no secret-like tracked files; no private-key/token-shaped content in tracked text. |
| Reviewer | Security |
| Status | PASS |

### 2026-10-08 — M14 Live Hardened-Surface Smoke (real server)

| Field | Value |
| --- | --- |
| Date | 2026-10-08 |
| Test category | integration (live gateway) — hardened surfaces |
| Test command | `python main.py` (APP_ENV=production, demo users via env) + ad-hoc HTTP client |
| Tests executed | 6 contract points |
| Passed | 6 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (Security) |
| Status | PASS |

Verified live: security headers on the public probe; /docs disabled in
the production posture; five failed logins → 401s then **429 with
Retry-After**; the lockout is **fail-closed for the correct password**
(no token issued); a different user logs in normally; authenticated data
carries Cache-Control: no-store.

### 2026-10-08 — M14 Adversarial Security Review

| Field | Value |
| --- | --- |
| Date | 2026-10-08 |
| Review scope | Auth bypass, privilege escalation, IDOR, secret exposure, token/session security, WS authz, input validation, injection, deserialization, error/log leakage, CORS/headers, abuse protection, Docker/runtime, debug settings, trading abuse, security-relevant races |
| Reviewer | Security + Architect (independent pass after remediation) |
| Verdict | PASS (after fixes) |
| Notes | The reviewer actively attempted bypasses rather than re-reading the diff. Found and fixed during review: (1) the login throttle's failure table could grow without bound under random-username sprays — keys with no in-window failures are now dropped on touch and a size-triggered sweep bounds the table; (2) an unused dataclass in the throttle module; (3) `InstrumentIn.identifiers` bounded the entry COUNT but not key/value LENGTH — oversized identifier strings (megabyte-scale) could be pushed into the OMS by an authenticated user; now 422-rejected (32/128-char bounds) with regressions. Verified holding: all M12 bypass/IDOR/enumeration suites re-run green under the new middleware; the 429 path reveals throttling only (never username existence); headers middleware does not participate in the WS handshake (WS authz unchanged); docs default OFF with dev-only opt-in; rate limiting is fail-closed even for correct credentials; secrets cannot enter images (.dockerignore) or the repo (secrets guard); no eval/pickle/dangerouslySetInnerHTML anywhere (automated guards); CSP serves from the hardened frontend image; uvicorn serves the added headers (verified live, lowercase). Accepted/documented (ADR-019): distributed rate-limit evasion and general endpoint throttling need shared infrastructure (M15); access-log WS-ticket note unchanged from ADR-018 (single-use, consumed-or-expired). |
| Status | PASS |

### 2026-10-09 — M15 Production Infrastructure — Backend Tests

| Field | Value |
| --- | --- |
| Date | 2026-10-09 |
| Commit/version | M15 (working tree) |
| Test category | unit + integration + persistence (live PostgreSQL) + security |
| Test command | `python -m pytest ../tests -q` (from `backend/`, TEST_DATABASE_URL set) |
| Tests executed | 690 |
| Passed | 690 |
| Failed | 0 |
| Skipped | 0 (with TEST_DATABASE_URL; without it the 8 DB tests skip — 682 run) |
| Failure details | none |
| Reviewer | Architect (DevOps + Backend + QA review) |
| Status | PASS |

Additional backend checks (same date): `ruff check`, `ruff format --check`,
`mypy` (strict, 69 files) all clean. The 13 new M15 tests: 8
live-PostgreSQL tests (save/get exact-decimal round-trip, idempotency
binding + latest-binding-wins, upsert status transition without clobbering
the key, account-filtered listing + delete, bounded ping, RESTART
SIMULATION — a fresh repository over the same DB sees the orders — and a
full OMS lifecycle on PostgreSQL: create → submit → accepted-report →
read → replay → account listing → cancel), plus app-level tests:
/ready database state (not_configured/ok/unavailable with gating to
`starting`), and /metrics (401 unauthenticated; counters increment from
REAL engine events through the public API; identifiers never appear in
metrics).

### 2026-10-09 — M15 Deployment Validation (live production-like stack)

| Field | Value |
| --- | --- |
| Date | 2026-10-09 |
| Test category | deployment validation (live docker compose stack, project mtbe-prod) |
| Test command | `docker compose -f docker-compose.prod.yml up -d --build` + scripted HTTP/TLS validation (13 checks) |
| Tests executed | 13 checks + failure/recovery scenarios |
| Passed | 13 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (DevOps + Security + QA) |
| Status | PASS |

Validated on the LIVE stack (unprivileged nginx TLS edge → hardened
frontend → DB-backed backend → postgres; only :8443 published): frontend
served over TLS with CSP; HTTP→HTTPS redirect; unauthenticated REST →
401; login over TLS; a risk-gated order accepted AND an idempotent replay
served through the proxy; a fresh order created (201); in-cluster
authenticated /metrics counting engine events (identifiers absent); WS
ticket issued through TLS; backend SIGTERM → graceful shutdown (exit 0,
no OOM) → auto-restart → healthy; the earlier-submitted order PERSISTED
across the restart AND its idempotency binding still replays 200;
/ready reports database ok. Failure/recovery: postgres PAUSED → /ready
degrades to `starting` + `database: unavailable` within the bounded ping
and recovers to ready on resume; `docker compose config` validates with
required-secret fail-fast verified (missing POSTGRES_PASSWORD/JWT_SECRET
_KEY refuse to start); invalid configuration
(ORDER_REPOSITORY=postgres without DATABASE_URL) fails fast at startup.
Backup/restore: truncate → restore → API reads the restored orders
(pg_dump --clean --if-exists round-trip).

### 2026-10-09 — M15 Production Infrastructure Review

| Field | Value |
| --- | --- |
| Date | 2026-10-09 |
| Review scope | Secret exposure, network exposure, TLS, container security, persistent storage, DB security, resource limits, restart policies, health checks, logging/observability, backup/recovery, config separation, reproducibility, unnecessary services |
| Reviewer | DevOps + Security + Architect (independent pass after remediation) |
| Verdict | PASS (after fixes) |
| Notes | Verified holding: only the proxy publishes host ports (backend/postgres/frontend confirmed unreachable from the host); TLS is 1.2/1.3-only with ECDHE ciphers + HSTS; certs and .env gitignored and never baked into images; required secrets fail-fast in compose; no secrets in container logs (verified by scanning for the actual validation secret values); backend runs as uid 10001 and BOTH nginx layers run unprivileged; resource limits + restart policies + log rotation on every service; healthchecks gate startup ordering and drive restarts; graceful shutdown verified (exit 0); named volume + verified backup/restore; dev and prod configurations are separate compose files with an explicit prod project id; from-scratch reproducible deploy proven twice (the second after final config changes). Findings found and fixed during validation/review (all re-verified): (1) the DB readiness ping was UNBOUNDED — a paused database hung the probe; now 2 s-bounded with fast degradation. (2) the backend bound to loopback INSIDE its container (proxy got 502); the bind is env-driven and the container default is 0.0.0.0 (the compose network is the isolation boundary; no ports are published). (3) dev and prod compose shared a default project name — their postgres volumes could collide (observed live); prod now uses `name: mtbe-prod`. (4) the proxy conf was mounted at /etc/nginx/nginx.conf (wrong scope — limit_req_zone requires http context); now conf.d/default.conf replacing the stock server. (5) `eslint@latest` had pulled v10, breaking strict `npm ci` in the image; pinned to ^9 (0 npm advisories retained). (6) `@eslint/js` v10 peer conflict; pinned ^9. (7) frontend nginx add_header inheritance dropped the CSP on /index.html; the full header set is now repeated in that block (verified live). (8) pg_dump needed --clean --if-exists for an idempotent restore. Accepted/documented: uvicorn's own startup lines stay text (application logs are JSON — LOG_FORMAT=json); broker adapters remain simulated in every environment (ADR-014/015 — no credentials exist, no live trading). |
| Status | PASS |

### 2026-10-11 — M16 End-to-End Validation — LIVE Stack (IBKR)

| Field | Value |
| --- | --- |
| Date | 2026-10-11 |
| Commit/version | M16 (working tree) |
| Test category | E2E — live production stack (docker compose mtbe-prod: nginx TLS edge, backend, frontend, PostgreSQL; simulated IBKR adapter; SIM_AUTO_FILL + SIM_TICKS enabled, ADR-021) |
| Test command | `docker compose -f docker-compose.prod.yml up -d --build` (BROKER_ADAPTER=IBKR) + `E2E_BROKER=IBKR python -m pytest ../tests/e2e -q` (from `backend/`) |
| Tests executed | 8 tests / 34 evidence records |
| Passed | 34 records (all); 8/8 tests |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none (4 earlier finding-driven fixes re-verified: see the M16 E2E Review below) |
| Reviewer | Architect (QA + Quant + Backend + DevOps review) |
| Status | PASS |

Evidence: `tests/e2e/artifacts/e2e-ibkr-results.{json,md}` — the complete
34-record table (case, environment, input/action, expected, actual,
pass/fail): readiness (broker + database), broker status, live market data
(fresh quote from the startup subscription + sim ticks), risk dry-run,
risk-gated submission (201 with broker id), FULL execution through the
real adapter path, position creation with exact VWAP, PARTIAL execution
(40% observed intermediate state) then completing fill, broker-side
REJECTION via the M5 reconcile path, cancellation, position closure
(flat), realized P&L == 0.00 by independent exact-decimal recomputation,
market-value consistency, duplicate-order idempotent replay (201->200,
one row), kill-switch block + release, WSS handshake + hello contract +
order-lifecycle streaming in engine order, backend SIGTERM restart with
orders PERSISTED and idempotency binding surviving, database-restart
readiness degradation ("starting"/"unavailable") + recovery, 401s
(unauthenticated + tampered token), viewer 403, cross-account isolation
(REST + IDOR-cancel + WS close 4403), edge 404s (/metrics, /docs),
performance smoke (submission p95 well under the 1500ms gate; 5 parallel
submissions all accepted, 5 distinct rows).

### 2026-10-11 — M16 End-to-End Validation — LIVE Stack (SAXO)

| Field | Value |
| --- | --- |
| Date | 2026-10-11 |
| Test category | E2E — live production stack (same stack redeployed with BROKER_ADAPTER=SAXO; SAXO_UIC=211 rides the broker-neutral identifiers on subscriptions and orders) |
| Test command | `docker compose -f docker-compose.prod.yml up -d --build` (BROKER_ADAPTER=SAXO, MARKET_SUBSCRIPTIONS with SAXO_UIC) + `E2E_BROKER=SAXO python -m pytest ../tests/e2e -q` |
| Tests executed | 8 tests / 34 evidence records |
| Passed | 34 records (all); 8/8 tests |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (QA + Quant + Backend + DevOps review) |
| Status | PASS |

Evidence: `tests/e2e/artifacts/e2e-saxo-results.{json,md}` — the SAME
34 scenarios with ZERO scenario-code changes between brokers: the
broker-independent workflow (lifecycle, accounting, failures, security,
performance) is proven twice on the live stack; the only per-broker
difference is the broker-neutral `SAXO_UIC` identifier the Saxo adapter
requires (ADR-015), demonstrating the abstraction holds end-to-end in the
production deployment.

### 2026-10-11 — M16 Full Regression

| Field | Value |
| --- | --- |
| Date | 2026-10-11 |
| Test category | regression — complete backend + frontend suites after all M16 changes |
| Test command | backend: `python -m pytest ../tests -q --ignore=../tests/e2e` (with TEST_DATABASE_URL against a provisioned PostgreSQL; frontend: `npm run test`) |
| Tests executed | 695 backend + 116 frontend |
| Passed | 695 + 116 |
| Failed | 0 |
| Skipped | 0 (DB tests run against the provisioned database) |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

New M16 tests: 5 composition-helper units (MARKET_SUBSCRIPTIONS parsing).
Hygiene: ruff/format/mypy (strict, 69 files) clean; tsc/ESLint(9)/
Prettier/vite build clean; npm audit 0. The M13 in-process full-stack
suites (56 dual-broker tests incl. broker disconnect -> reconnect ->
reconcile, duplicate events, stale data, out-of-order handling) all pass
unchanged — the in-process tier remains the engine-level regression
backbone while `tests/e2e` validates the deployed platform.

### 2026-10-11 — M16 E2E / Architecture Review (independent)

| Field | Value |
| --- | --- |
| Date | 2026-10-11 |
| Review scope | Platform behavior verification on the LIVE stack (not just test re-reads): broker parity, state consistency, security boundaries, trading invariants, evidence quality |
| Reviewer | QA + Quant + Backend + DevOps + Architect |
| Verdict | PASS (after fixes) |
| Notes | Verified live: the identical scenario suite passed on BOTH adapters with zero code differences — no broker-specific leakage anywhere in the E2E layer (only the broker-neutral SAXO_UIC identifier varies). Accounting: realized P&L == 0.00 was verified by recomputing independently in exact decimals (not by trusting the API), and the flat-position/market-value consistency closed the loop; fill quantities, position quantities, and VWAP asserted on every step. State consistency: backend restart preserved orders AND the idempotency binding (PostgreSQL); the duplicate replay 200'd against the restored state; DB restart degraded readiness within the bounded ping and recovered without data loss. Security: every boundary re-verified through the TLS edge exactly as an external actor would see it. Findings found and fixed during validation (all re-run green): (1) the sim driver's deterministic-marker design initially read `order.idempotency_key` — a field the domain Order does NOT carry, so PARTIAL/REJECT never triggered; fixed by moving the directives to the broker-neutral identifiers channel (ADR-015) and the REJECT delivery to the M5 reconcile path (force_status is poll-based, TS-006). (2) The WS-isolation scenario asserted on the 101 handshake only — accept-then-close is the M12 DESIGN; the test now reads the close frame and asserts code 4403. (3) The auto-fill emitted a zero-quantity second chunk that relied on validation dropping it — now never emitted. (4) The viewer demo user (role-boundary scenario) was not provisioned in the demo environment — added. Documented limitations (ADR-021): real-browser automation (Playwright) is unavailable in this headless environment — the terminal row is validated by the in-process App flow test + the identifiers-field work; external sandbox/paper environments remain deferred (no credentials exist; simulated adapters only, no live trading). |
| Status | PASS |

### 2026-10-12 — M17 Final Baseline + Full Regression

| Field | Value |
| --- | --- |
| Date | 2026-10-12 |
| Commit/version | M17 (working tree) |
| Test category | final regression — complete suites |
| Test command | backend: `python -m pytest ../tests -q --ignore=../tests/e2e` (TEST_DATABASE_URL against provisioned PostgreSQL); frontend: `npm run test` |
| Tests executed | 695 backend + 116 frontend |
| Passed | 695 + 116 |
| Failed | 0 |
| Skipped | 0 (DB tests executed against the provisioned database) |
| Failure details | none |
| Reviewer | Architect (QA) |
| Status | PASS |

Hygiene: `ruff check`, `ruff format --check`, `mypy` (strict, 69 files)
clean; `tsc -b`, ESLint 9, Prettier, `vite build` clean; `npm audit` 0;
project-venv `pip-audit` 0. The M16 live-stack E2E results (34/34 IBKR,
34/34 SAXO, artifacts committed) remain the authoritative live evidence.

### 2026-10-12 — M17 Deployment + Operational Procedures (live)

| Field | Value |
| --- | --- |
| Date | 2026-10-12 |
| Test category | deployment validation + operational procedures (live mtbe-prod stack, from-scratch) |
| Test command | documented RUNBOOK procedure + scripted procedure checks |
| Tests executed | 12 procedures |
| Passed | 12 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | none |
| Reviewer | Architect (DevOps + QA) |
| Status | PASS |

Validated: from-scratch deploy (compose build + healthcheck-gated
startup; /ready ready+database ok); startup; graceful shutdown
(`docker compose stop` → exit 0, no OOM); restart with an order
persisted across it (PostgreSQL; status preserved); database restart
readiness behavior; JWT SECRET ROTATION (old-secret token 401 after
recreate, fresh login 200 — rotation procedure works and invalidates
outstanding tokens as documented); JSON application-log inspection;
health monitoring (/ready public + authenticated in-cluster /metrics);
backup (pg_dump --clean) and restore round-trip (truncate → restore →
row count verified); rollback procedure documented in the RUNBOOK; the
full stack torn down cleanly at the end.

### 2026-10-12 — M17 Secrets Audit (tracked repository files)

| Field | Value |
| --- | --- |
| Date | 2026-10-12 |
| Test category | security — repository secrets scan |
| Test command | `git grep` for every live validation credential used across M14-M16 (12 distinct values: validation DB/JWT secrets, demo user passwords) + gitignore verification + the automated secrets-guard suite (re-run in the final regression) |
| Tests executed | full tracked-file sweep |
| Passed | clean after one fix |
| Failure details | FINDING (fixed): `tests/e2e/README.md` documented example credentials that matched the actual validation values verbatim — substituted with placeholders and re-scanned clean. No other tracked file contained any validation credential, private key, or token-shaped material. `.env`, `infrastructure/nginx/certs/`, and `backups/` confirmed gitignored. |
| Reviewer | Security + Architect |
| Status | PASS (finding remediated and re-verified) |

### 2026-10-12 — M17 Final Multi-Perspective Review (independent)

| Field | Value |
| --- | --- |
| Date | 2026-10-12 |
| Review scope | Production-readiness challenge across architecture, security, QA, DevOps, and trading integrity — reviewers actively looked for blockers rather than confirming the claim |
| Reviewer | Architect + Security + QA + DevOps (+ Quant for trading integrity) |
| Verdict | PASS — **PRODUCTION READY** for the validated scope, zero release blockers |
| Notes | **Architect:** layering re-grep-verified (no broker imports outside adapters; no framework in core); the M15 async-repository port and the M16 simulation drivers live exactly at the composition boundary; single-broker-per-instance is the documented deployment shape (ADR-016), not a defect. **Security:** every boundary re-verified live through the TLS edge (401 unauthenticated/tampered, viewer 403, cross-account REST+IDOR 403, WS 4403, edge 404s); no secrets tracked (one documentation finding fixed); distributed throttling and CA certs documented as future/pre-real-money items. **QA:** 695+116+68 live evidence records all pass; coverage traced to every requirement in the FR/NFR/TS tables; browser automation unavailability documented with the in-process terminal flow test as the standing evidence. **DevOps:** from-scratch deploy + 12 operational procedures validated; CI/CD gates all suites incl. the PostgreSQL-service job; rollback now documented; HA/multi-node and external monitoring stack classified as future enhancements. **Quant/Trading integrity:** risk gate unbypassable (mandatory; E2E kill switch); duplicates safe (replay 200 + execution dedup, both across restart); positions/P&L independently recomputed exactly; reconciliation via the M5 poll path; restart-safe persistence; stale-data never-silently-zero; broker failures fail safe (REJECTED never assumed executed, DB-down degrades readiness); account boundaries hold on every surface. **Classification:** release blockers — none; high risk — none in scope; known limitations — real transports/sandbox validation (ADR-014/015 with the pre-real-money checklist), in-memory portfolio/sessions (by design), distributed rate limiting, HA, browser E2E, load testing, create-only migrations — all documented in `docs/RELEASE.md`. |
| Status | PASS |

### 2026-10-12 — M17 Documentation Integrity Finding (ADR-018)

| Field | Value |
| --- | --- |
| Date | 2026-10-12 |
| Found by | M17 final consistency check (21-ADR sweep) |
| Defect | The full ADR-018 section (Authentication & Authorization, M12) was missing from `docs/DECISIONS.md` — its decision-log row and every cross-reference in PROJECT_STATUS/ARCHITECTURE/CHANGELOG and the code docstrings survived, but the ADR section itself had been lost in a later file rewrite. |
| Fix | The ADR-018 record was restored verbatim from the M12 session (decision, consequences, limitations — including the note that the M14-deferred rate limiting was subsequently delivered) in its correct position between ADR-017 and the Decision Log. Re-verified: 21 ADR sections (001-021) now present and in order. |
| Reviewer | Architect |
| Status | RESOLVED (verified by the 21-heading sweep) |

### 2026-10-23/24 — FE-M1 Frontend Full Regression + Playwright Live Visual Check — Frontend

| Field | Value |
| --- | --- |
| Date | 2026-10-23 / 2026-10-24 |
| Commit/version | c23d785 → 686d599 (`feat/m1-figma-terminal`) |
| Test category | unit / component / integration (frontend) + live browser visual check |
| Test command | `npm test` (vitest run); `npm run lint`; `npm run typecheck`; `npm run format:check`; `npm run build`; `TRADER_PASSWORD=… npm run visual:check` (Playwright, Chrome channel) |
| Tests executed | 147 (incl. 27 new/adjusted M1 tests + the `0E-8` scientific-notation regression suite) |
| Passed | 147 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | One real defect FOUND AND FIXED by the live check: `Cannot convert 0E-8 to a BigInt` — Python `Decimal` serializes scaled zeros as `0E-8` (e.g. `filled_quantity` pre-fill) and the M11 `orderFromJ` mapper crashed on every live order event; fixed by `expandScientificDecimal()` (utils/decimal) + the mappers crash site; regression tests added (368b9ce). Pre-existing intermittent: the M13 App.flow test needed a 15s timeout on the denser DOM (assertions unchanged). |
| Reviewer | Frontend (self) — specialist review pending per AGENTS (UI change → Frontend + QA) |
| Status | PASS (unit/component/integration 147/147; lint/typecheck/format/build green; live visual check completed with zero page errors — full flow login → live streaming chart → paper order → sim auto-fill → desktop+mobile screenshots) |

### 2026-10-26 — FE-M2 Frontend Full Regression + Playwright Live Dashboard Check — Frontend

| Field | Value |
| --- | --- |
| Date | 2026-10-26 |
| Commit/version | FE-M2 commit on `feat/m1-figma-terminal` (see git log; post-686d599) |
| Test category | unit / component / integration (frontend) + live browser visual check |
| Test command | `npm test` (vitest run); `npm run lint`; `npm run typecheck`; `npm run format:check`; `npm run build`; `TRADER_PASSWORD=… npm run visual:check` (Playwright, Chrome channel) |
| Tests executed | 158 (11 new Dashboard/navigation tests; 2 assertions legitimately updated — sidebar disabled-destination count 5→4 because Overview became a real destination) |
| Passed | 158 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | None. Backend intentionally untouched (695/695 stand). Live check verified the new navigation end-to-end: sidebar Overview → Dashboard greeting renders → desktop (1440px) + mobile (375px) full-page screenshots captured; only the documented benign 404s (favicon; balance-not-reported during initial sync). |
| Reviewer | Frontend (self) — specialist review pending per AGENTS (UI change → Frontend + QA) |
| Status | PASS (unit/component/integration 158/158; lint/typecheck/format/build green; live visual check green) |

### 2026-10-27 — FE-M3 Frontend Full Regression + Playwright Live Portfolio Check — Frontend

| Field | Value |
| --- | --- |
| Date | 2026-10-27 |
| Commit/version | FE-M3 commit on `feat/m1-figma-terminal` (post-0b3b664; see git log) |
| Test category | unit / component / integration (frontend) + live browser visual check |
| Test command | `npm test` (vitest run); `npm run lint`; `npm run typecheck`; `npm run format:check`; `npm run build`; `TRADER_PASSWORD=… npm run visual:check` (Playwright, Chrome channel) |
| Tests executed | 176 (18 new: 7 pure allocation unit tests covering the currency/aggregation/exclusion rules + 11 component/page tests incl. scoped vs wildcard account switching, NULL-equity handling, unpriced/stale states, read-only page contract) |
| Passed | 176 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | None. Backend intentionally untouched (695/695 stand). Live-check environment note: a user-launched backend instance (no demo credentials) held port 8000; with the user's explicit approval it was stopped and the sim stack relaunched with the documented dev demo env before the check. Playwright run verified: login → live chart → paper order auto-fill → Dashboard → Portfolio (07/08-portfolio-desktop/mobile screenshots); zero page errors; only the documented benign 404s (favicon; balance-not-reported during initial sync). |
| Reviewer | Frontend (self) — specialist review pending per AGENTS (UI change → Frontend + QA) |
| Status | PASS (unit/component/integration 176/176; lint/typecheck/format/build green; live visual check green) |

### 2026-10-27 — CI Collection Failure Fix (duplicate test module basename) — Backend

| Field | Value |
| --- | --- |
| Date | 2026-10-27 |
| Commit/version | Working tree on `feat/m1-figma-terminal` (post-643c27a; commit pending) |
| Test category | test infrastructure / CI regression (backend) |
| Defect | The CI `backend` job aborted during pytest COLLECTION with `import file mismatch` (exit code 2): `tests/unit/order_management/test_lifecycle.py` and `tests/e2e/test_lifecycle.py` share the basename `test_lifecycle`, and pytest imports test modules by basename — any run collecting both files dies before a single test executes. Every combined `python -m pytest ../tests` run (all PR pipelines and pushes to main) failed this way since both files coexisted. Why only CI: explicit-path invocations never load `backend/pyproject.toml` (config discovery starts at `../tests` and finds no configfile upward), so its `--import-mode=importlib` does not apply and the default prepend import mode makes duplicate basenames fatal; the per-suite runs in TESTING.md never collect both files. |
| Fix | (1) Renamed `tests/unit/order_management/test_lifecycle.py` → `test_oms_lifecycle.py` (16 tests; matches the `test_oms_integration.py` convention; nothing imports it by basename — the e2e file must keep its name because `tests/e2e/test_realtime_failures.py` imports helpers via `from test_lifecycle import …`). (2) Added the guard `test_test_module_basenames_are_unique` to the foundation suite — fails naming both offending paths if a duplicate basename ever reappears. (3) CI job now runs the README-documented `python -m pytest ../tests -q --ignore=../tests/e2e` — the live-stack E2E suite requires the deployed docker-compose.prod.yml stack (TESTING.md Step 13) and cannot run in the in-memory CI job. |
| Test command | `python -m pytest ../tests --collect-only -q`; `python -m pytest ../tests -q --ignore=../tests/e2e` (the CI command); `python -m pytest ../tests/unit -q`; `python -m pytest ../tests/unit/order_management -q`; `python -m pytest ../tests/e2e --collect-only -q` — all from `backend/` |
| Tests executed | 704 collected combined (0 collection errors); CI scope: 696 (688 passed + 8 skipped); `tests/unit`: 460; `tests/unit/order_management`: 22; e2e: 8 collected (import/collection verified — runtime requires the live deployed stack, not executable in this environment per TESTING.md Step 13) |
| Passed | 688 (CI scope); 460 (unit); 22 (order_management); guard negative-verified — fails naming both files when a duplicate is created, green after removal |
| Failed | 0 post-fix (pre-fix: collection itself aborted — 687 collected, 1 collection error, exit code 2) |
| Skipped | 8 (PostgreSQL persistence suite — by design: `TEST_DATABASE_URL` unset and no DB in this environment; they run in the `backend-persistence` CI job) |
| Failure details | Pre-fix reproduction (executed): `ERROR collecting tests/unit/order_management/test_lifecycle.py — import file mismatch: imported module 'test_lifecycle' has this __file__ attribute: …\tests\e2e\test_lifecycle.py … Interrupted: 1 error during collection`. Post-fix: all runs clean; full CI-scope suite green in 10:41. |
| Reviewer | Architect (self) — DevOps sign-off on the workflow change requested in the PR per AGENTS (CI change → DevOps review) |
| Status | PASS (collection fixed; CI-scope suite green: 688 passed / 8 skipped / 0 failed; e2e suite unaffected and live-validated separately per M16 records) |

### 2026-10-28 — FE-M4 Frontend Full Regression + Playwright Live Positions/Orders Check — Frontend

| Field | Value |
| --- | --- |
| Date | 2026-10-28 |
| Commit/version | FE-M4 working tree on `feat/m1-figma-terminal` (post-fc18f25; see git log) |
| Test category | unit / component / integration (frontend) + live browser visual check |
| Test command | `npm test` (vitest run); `npm run lint`; `npm run typecheck`; `npm run format`; `npm run build`; `TRADER_PASSWORD=… node scripts/visual-check.mjs --url http://localhost:5173` (Playwright, Chrome channel) |
| Tests executed | 188 (12 new: 8 positions-table tests — LONG/SHORT chips, numeric (non-lexicographic) sort of quantity/market, direction + symbol filters, no-match state, exact per-currency unrealized totals, row-click charting with watched-identity preference and honest UNKNOWN fallback, compact mode; 4 blotter tests — identifier/remaining/created columns, numeric sort regression for quantity 10 vs 9, viewer (no orders:write) action hiding with the server-enforced note, compact tabs-card contract) |
| Passed | 188 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | Two self-inflicted failures during development, both fixed before the recorded run and kept as regression coverage: (1) the sort test initially assumed descending-first for a newly selected column while the component (deliberately, matching the positions table) sorts ascending first — expectations corrected; (2) an identifier fixture (`ident01-aaaa`) produced `ident01-` for the 8-char truncation — fixture changed so the assertion is unambiguous. No production-behavior test was weakened or deleted; the M11 cancel/modify/double-cancel/modify-flow assertions are unchanged and still pass. Environment note: a user-launched backend instance (no demo credentials) again held port 8000; with the previously granted approval it was stopped and the sim stack relaunched with the documented dev demo env before the check. Live check verified all 10 steps incl. the new 09-positions-desktop.png / 10-orders-desktop.png captures with real auto-filled orders; zero page errors; only the documented benign 404s (favicon; balance not reported during initial sync). |
| Reviewer | Frontend (self) — specialist review pending per AGENTS (UI change → Frontend + QA) |
| Status | PASS (unit/component/integration 188/188; lint/typecheck/format/build green; 10-step live visual check green) |

### 2026-10-28 — FE-M5 Frontend Full Regression + Playwright Live Activity Check — Frontend

| Field | Value |
| --- | --- |
| Date | 2026-10-28 |
| Commit/version | FE-M5 working tree on `feat/m1-figma-terminal` (post-3b009cc; see git log) |
| Test category | unit / component / integration (frontend) + live browser visual check |
| Test command | `npm test` (vitest run); `npm run lint`; `npm run typecheck`; `npm run format:check`; `npm run build`; `TRADER_PASSWORD=… node scripts/visual-check.mjs --url http://localhost:5173` (Playwright, Chrome channel) |
| Tests executed | 223 (35 new: 17 pure order-history filter/sort/summary tests; 5 executions-store tests — fill_id idempotency, newest-first ordering, multi-fill preservation, bounded 500-record eviction; 17 component/integration tests — finished-vs-working default, exact-status/side/account/search narrowing, UTC date range, numeric decimal sorting, no-match + clear-filters, loading/error/real-retry states, read-only assertion (no cancel/modify/submit control), detail dialog open + refresh-failure fallback + related-fill listing, multi-fill rendering, '—' for unreported commission, side filter; plus an App-level WS→executionsStore→Activity assertions flow) |
| Passed | 223 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | Three test-side failures found and fixed during development (all were wrong expectations, not product defects): (1) a 503 `ApiError` surfaces the curated user message ('Broker connection lost — try again after reconnection.'), not the raw server string, so the assertion was corrected to the shipped copy; (2) `getByRole("note")` was ambiguous because the empty state also carries role=note — scoped to the callout text; (3) two accidental line-join edits in fixtures were repaired before the recorded run. No existing test was weakened or deleted: the M11/M12 App tests keep every assertion, with only the disabled-destination count updated from 3 to 2 because Activity is now a real destination (M5 scope). Backend untouched. Live check: 11 steps green; Activity showed 6 historical FILLED rows and captured 1 live fill (the order placed by the run itself); order-detail dialog opened. HTTP-failure evidence captured at URL level: the only 4xx is `GET /api/v1/accounts/ACC-001/balance → 404` (pre-existing, documented: `rest.py` returns 404 when the portfolio has no balance for the account yet; the UI renders '—' rather than zero). No page errors. |
| Reviewer | Frontend (self) — specialist review pending per AGENTS (UI change → Frontend + QA) |
| Status | PASS (unit/component/integration 223/223; lint/typecheck/format/build green; 11-step live visual check green) |

### 2026-10-28 — FE-M6 Frontend Full Regression + Playwright Live Markets Check — Frontend

| Field | Value |
| --- | --- |
| Date | 2026-10-28 |
| Commit/version | FE-M6 working tree on `feat/m1-figma-terminal` (parent commit `cc22a92`; this record's own commit is the FE-M6 commit in git log) |
| Test category | unit / component / integration (frontend) + live browser visual check |
| Test command | `npm test` (vitest run); `npm run lint`; `npm run typecheck`; `npm run format:check`; `npm run build`; `TRADER_PASSWORD=… node scripts/visual-check.mjs --url http://localhost:5173` (Playwright, Chrome channel) |
| Tests executed | 265 in 22 files (42 new: 23 `watchlistsStore` tests — pure reducers for create/rename/delete/select, 20-list and 100-instrument caps, blank/duplicate-name rejection, de-duplication by full identity (same symbol on two venues stays two instruments), identity normalization without a synthesized name, mirror-into-`marketStore` on every mutation, storage-error reporting instead of a false "saved", serialization round-trip, rejection of corrupt/wrong-version payloads, dropping of malformed entries + duplicate ids + duplicate instruments, unknown-active-id fallback, hydration on module load, and a no-credentials-in-payload assertion; 18 Markets-page tests — default empty list + storage note, create/duplicate-error/rename/confirmed-delete, no-watchlist state, add + duplicate feedback, venue-distinct rows, remove, search/asset-class filters with clear, shared Live/Polled/Stale/No-data/Error badges, "—" for missing bid/ask/last with no fabricated zero, session-Δ gating/tooltip/tone, numeric (non-lexicographic) price sorting, Trade-screen navigation, and the in-UI limitations panel; 1 App-level `market.quote.updated` → Markets-row flow that also asserts exactly one WebSocket instance) |
| Passed | 265 |
| Failed | 0 |
| Skipped | 0 |
| Failure details | Development-time failures, all fixed before the recorded run: (1) a serialization round-trip test built the fixture from two different default states, so the instrument landed in a list the assertion did not read — fixture now uses one base state (regression kept); (2) three ambiguous Testing Library queries — the persistence note is intentionally rendered in both the rail and the notes panel (`getAllByText`), quote-state badges are `role="status"` so feedback assertions were switched to the exact copy, and "—" is used by several columns so the session-Δ absence is asserted via its tooltip; (3) a sort test initially expected the price column to be descending-first on the default view — it is instrument-ordered until the header is clicked, so the test now clicks twice to prove numeric rather than lexicographic ordering. Guard changes: the M14 static guard "never persists tokens or credentials to web storage" now scans shipped files only (`*.test.ts(x)` excluded, with the reason documented in the guard), because the new store's own tests seed browser storage; a production file using `localStorage.setItem` still fails the check. One non-reproducible observation recorded for transparency: a full-suite run reported the "never logs credentials or tokens" guard as failed while the tree contains no `console.*` call anywhere in `src/`; the same guard then passed in isolation and in two subsequent full runs (`265/265`), with no source changes in between — treated as an environment-level transient, flagged here rather than silently dropped. Backend untouched. Live check: 12 steps green. Markets screen: 1 watchlist, 1 AAPL row, quote state LIVE, session-Δ cell populated, screenshots 15-markets-desktop.png / 16-markets-mobile.png; the run also re-captured the earlier screens (a paper order filled, Activity showed 8 FILLED rows + 1 live fill). HTTP evidence at URL level: 4 4xx responses, deduplicated to `GET /api/v1/accounts/ACC-001/balance → 404` (pre-existing and documented — the UI renders '—', never 0), plus 5 console "Failed to load resource … 404" entries whose fifth has no captured page response (consistent with the favicon request); zero `pageerror` entries. |
| Reviewer | Frontend (self) — specialist review pending per AGENTS (UI change → Frontend + QA) |
| Status | PASS (unit/component/integration 265/265; lint/typecheck/format/build green; 12-step live visual check green) |
