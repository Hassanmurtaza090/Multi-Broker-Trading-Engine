# Test Status

Tracks the actual state of testing. **Never record `PASS` unless the test was
actually executed.** Test results are recorded only after real execution.

---

## Current Summary

| Category | Status |
| --- | --- |
| Unit Tests | ACTIVE — M0–M9 suites (see Results Log) |
| Integration Tests | ACTIVE — M2–M9 integration suites (see Results Log) |
| E2E Tests | NOT STARTED |
| Security Tests | NOT STARTED |
| Performance Tests | NOT STARTED |
| Broker Simulation Tests | ACTIVE — IBKR and Saxo adapters tested against simulated clients (paper/sim mode; no live trading) |
| Quant Validation | PASS (M1–M9 trading/accounting/broker-mapping semantics) |

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