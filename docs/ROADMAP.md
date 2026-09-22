# Roadmap

The project is delivered in milestones. Each milestone must satisfy its
acceptance criteria and pass required specialist reviews before the next
milestone begins. Milestones are sequential unless explicitly noted.

---

## M0 — Architecture & Foundation

- **Objective:** Establish repository structure, persistent documentation,
  agent workflow, testing conventions, and development rules. Establish
  minimal backend/frontend/Docker/test foundations.
- **Deliverables:**
  - Monorepo directory structure.
  - `AGENTS.md`, `PROJECT_STATUS.md`, `ROADMAP.md`, `ARCHITECTURE.md`,
    `REQUIREMENTS.md`, `DECISIONS.md`, `TEST_STATUS.md`, `CHANGELOG.md`,
    `DEVELOPMENT_WORKFLOW.md`, `README.md`.
  - Backend dependency/quality tooling (Pyproject, ruff, mypy, pytest).
  - Frontend tooling (React + TypeScript + Vite, ESLint, Prettier, Vitest).
  - Docker compose foundation (backend, frontend, PostgreSQL).
  - Initial test suite validating the foundation.
- **Dependencies:** None.
- **Acceptance Criteria:**
  - All documented files exist and are accurate.
  - Tooling commands run successfully.
  - Foundation tests pass (results recorded, not fabricated).
- **Testing Requirements:** Foundation validation tests executed and recorded.
- **Specialist Review:** Architect.

---

## M1 — Core Domain Model

- **Status:** ✅ Complete (verified 2026-09-13)
- **Objective:** Define the broker-agnostic core domain types (order, fill,
  position, account, instrument, execution report, broker error).
- **Deliverables:** Domain entities, value objects, invariants in
  `backend/domain`.
- **Dependencies:** M0.
- **Acceptance Criteria:** Domain model is testable, broker-agnostic, and
  documented; no infrastructure imports in domain.
- **Testing Requirements:** Unit tests for entities/invariants.
- **Specialist Review:** Quant (+ Backend).
- **Result:** Implemented `money`, `instrument`, `orders` (lifecycle state
  machine), `account`, `position` (VWAP), `fills`, `portfolio`, `market`,
  `errors`. 113 unit tests pass; ruff/mypy/format clean. Quant review: PASS
  WITH NOTES. Architecture boundary tests enforce no framework/broker imports.

## M2 — Event System

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Introduce a typed, ordered event bus (market data, order
  events, execution reports, risk events).
- **Deliverables:** Event definitions, bus, envelope/ordering.
- **Dependencies:** M1.
- **Acceptance Criteria:** Events are typed, replay/loggable, and decoupled
  from brokers.
- **Testing Requirements:** Unit + integration tests.
- **Specialist Review:** Backend (+ Architect).
- **Result:** Implemented `backend/events` (`DomainEvent`, `EventEnvelope`,
  `EventBus` protocol + `InProcessEventBus`, `EventRegistry`,
  `EventSerializer`, 16 event types). Per-bus total ordering with
  reentrancy-safe lock; timezone-aware timestamps; versioned events; at-least-
  once delivery with `event_id` idempotency contract. 156/156 tests pass
  (52 M2); ruff/mypy/format clean. Quant, Security, QA, Architect reviews:
  PASS. M0+M1 regression: PASS. See `docs/EVENTS.md`, ADR-006/007/008.

## M3 — Market Data

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Abstract market-data feed and subscription lifecycle.
- **Deliverables:** Market-data interfaces, tick/bar models, subscription
  manager.
- **Dependencies:** M2.
- **Acceptance Criteria:** Core subscribes via abstraction; no broker logic in
  core.
- **Testing Requirements:** Unit tests with simulated feeds.
- **Specialist Review:** Quant + Backend.
- **Result:** Implemented `MarketDataFeed` broker port
  (`backend/brokers/base/market_data.py`), domain `MarketTick`/`Bar`/
  `BarInterval`, and `MarketDataEngine` with `SubscriptionManager` (idempotent
  ref-counted) and `StalenessMonitor` (TS-007). Engine normalizes/validates
  raw payloads and publishes `MarketQuoteUpdated` / `MarketTickUpdated` /
  `MarketBarUpdated` on the M2 event bus. Broker-agnostic; simulated feed used
  in tests. 191/191 tests pass (35 M3); ruff/mypy/format clean. Quant,
  Security, QA, Architect reviews: PASS. M0+M1+M2 regression: PASS. See
  ADR-009, `docs/ARCHITECTURE.md`, `docs/EVENTS.md`.

## M4 — Order Management

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Order lifecycle state machine (new → submitted → filled /
  cancelled / rejected) with idempotency and duplicate-order protection.
- **Deliverables:** Order manager, order states, persistence interface.
- **Dependencies:** M2, M3 (partial).
- **Acceptance Criteria:** Correct lifecycle, idempotent submission, no
  unconfirmed execution assumptions.
- **Testing Requirements:** Unit + integration tests.
- **Specialist Review:** Quant + Backend + QA.
- **Result:** Implemented `backend/order_management` (`OrderManager`,
  `OrderRepository` port + `InMemoryOrderRepository`). Drives the M1 `Order`
  state machine, applies confirmed `ExecutionReport`s (filled-quantity
  tracking, overfill/non-completing-FILL rejection), enforces idempotency via
  `client_order_id` / `idempotency_key` and duplicate `report_id` protection,
  and publishes `order.*` events on the M2 bus. 217/217 tests pass (26 M4);
  ruff/mypy/format clean. Quant, Security, QA, Architect reviews: PASS.
  M0+M1+M2+M3 regression: PASS. See ADR-010, `docs/ARCHITECTURE.md`,
  `docs/EVENTS.md`.

## M5 — Execution Engine

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Route orders through the broker abstraction; handle partial
  fills, rejects, timeouts, reconnection.
- **Deliverables:** Execution service, routing logic, reconciliation hooks.
- **Dependencies:** M4.
- **Acceptance Criteria:** Execution via interfaces only; graceful handling of
  failure scenarios.
- **Testing Requirements:** Unit tests with simulated brokers; failure-scenario
  coverage.
- **Specialist Review:** Quant + Backend + QA.
- **Result:** Implemented `backend/execution` (`ExecutionEngine`) and an
  `ExecutionBroker` port in `backend/brokers/base/execution.py`. The engine
  drives the OMS and routes through the broker; applies reports to the OMS
  (which publishes `order.*` events); handles partial/multiple fills, rejects,
  cancels, timeouts (raises `BrokerError(TIMEOUT)`, state unchanged), bounded
  connection-loss retry, and `reconcile()` for reconnection (TS-006). No broker
  SDK logic. 232/232 tests pass (15 M5); ruff/mypy/format clean. Quant,
  Security, QA, Architect reviews: PASS. M0–M4 regression: PASS. See ADR-011,
  `docs/ARCHITECTURE.md`.

## M6 — Risk Engine

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Pre-trade risk validation, position/cash controls, kill switch.
- **Deliverables:** Risk checks, limits, kill-switch mechanism.
- **Dependencies:** M4, M5.
- **Acceptance Criteria:** Risk gates execution; no order bypasses risk;
  kill switch is effective.
- **Testing Requirements:** Unit + integration; risk-bypass must be impossible.
- **Specialist Review:** Quant + Backend + QA + Security.
- **Result:** Implemented `backend/risk` (`RiskEngine`, `RiskGatedExecutor`,
  `RiskPolicy`/`RiskLimits`, rules, kill switch) and read-model ports
  (`PortfolioView`, `AccountView`, `MarketDataView`, `DailyPnlProvider`).
  Deterministic, configurable, fail-closed pre-trade rules; risk-gated
  execution (no bypass); kill switch; EventBus integration (publishes
  `RiskViolation`, dedupes `OrderSubmitted` for counts). 269/269 tests pass
  (37 M6); ruff/mypy/format clean. Quant, Security, QA, Architect reviews:
  PASS. M0–M5 regression: PASS. See ADR-012, `docs/ARCHITECTURE.md`.

## M7 — Portfolio & P&L

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Position tracking, valuation, realized/unrealized P&L.
- **Deliverables:** Portfolio model, P&L calculations, reconciliation.
- **Dependencies:** M3, M4, M5.
- **Acceptance Criteria:** Positions reconcile with fills; P&L correct.
- **Testing Requirements:** Unit (financial correctness) + integration.
- **Specialist Review:** Quant + Backend + QA.
- **Result:** Implemented `backend/portfolio` (`PortfolioService` — authoritative
  fill-driven positions, realized P&L (cumulative + daily), unrealized P&L,
  exposure, equity; consumes `order.*` fills, quotes, and balance events;
  publishes `position.opened/updated/closed`; implements the M6 read-model
  ports so Risk consumes authoritative state; broker reconciliation via
  `apply_broker_snapshot`) plus pure average-cost `accounting` functions
  (open/increase/reduce/close/reverse, fee handling). 310/310 tests pass
  (39 M7); ruff/mypy/format clean. M7 integration testing found and fixed an
  M6 daily-loss sign defect (positive magnitude semantics + 2 regressions).
  Quant, Security, QA, Architect reviews: PASS. M0–M6 regression: PASS (271/271).
  See ADR-013, `docs/ARCHITECTURE.md`.

## M8 — IBKR Integration

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Broker adapter implementing the base interfaces for IBKR.
- **Deliverables:** `backend/brokers/ibkr` adapter; simulated/paper mode.
- **Dependencies:** M5, M6, M7.
- **Acceptance Criteria:** Adapter satisfies base contracts; paper-tested.
- **Testing Requirements:** Simulated broker tests; no live trading.
- **Specialist Review:** Backend + Quant + QA + Security.
- **Result:** Implemented `backend/brokers/ibkr`: `IbkrAdapter` implementing
  the M3 `MarketDataFeed` and M5 `ExecutionBroker` ports; pure IBKR↔internal
  `mapping` (contracts, orders, statuses, executions→fills, account values→
  balances, positions, error codes→`BrokerError`); `IbkrClient`/
  `IbkrCallbacks` transport protocols with `SimulatedIbkrClient` (paper mode).
  Connection lifecycle publishes `BrokerConnected`/`BrokerDisconnected`;
  reconnect re-subscribes exactly once and replays broker state for
  reconciliation; statuses/executions deduped; account data relabeled to the
  internal account and published as `balance.updated` for M7. 368/368 tests
  pass (58 M8); ruff/mypy/format clean. Backend, Quant, QA, Security reviews:
  PASS. M0–M7 regression: PASS (310/310). Live/paper validation against a real
  TWS/Gateway: DEFERRED (documented, ADR-014). See ADR-014,
  `docs/ARCHITECTURE.md`.

## M9 — Saxo Integration

- **Objective:** Broker adapter implementing the base interfaces for Saxo Bank.
- **Deliverables:** `backend/brokers/saxo` adapter (OAuth, sim environment).
- **Dependencies:** M5, M6, M7.
- **Acceptance Criteria:** Adapter satisfies base contracts; sim-tested.
- **Testing Requirements:** Simulated tests; no live trading.
- **Specialist Review:** Backend + Quant + QA + Security.

## M10 — FastAPI Gateway

- **Objective:** REST + WebSocket API exposing core capabilities (no core
  changes required).
- **Deliverables:** `backend/api` routes, WS channels, auth hooks.
- **Dependencies:** M3–M7.
- **Acceptance Criteria:** API cleanly delegates to application layer; core
  stays broker-agnostic.
- **Testing Requirements:** Integration + e2e API tests.
- **Specialist Review:** Backend + QA + Security.

## M11 — React Trading Terminal

- **Objective:** Web trading terminal UI (dashboard, orders, positions, P&L,
  charts).
- **Deliverables:** `frontend/src` features, stores, services, real-time
  wiring.
- **Dependencies:** M10.
- **Acceptance Criteria:** UI consumes API/WS; functional end-to-end.
- **Testing Requirements:** Component + e2e tests.
- **Specialist Review:** Frontend + QA.

## M12 — Authentication & Authorization

- **Objective:** AuthN/AuthZ (JWT), role/permission model, secure session.
- **Deliverables:** Auth service, token lifecycle, RBAC.
- **Dependencies:** M10.
- **Acceptance Criteria:** Least-privilege enforced; secrets not exposed.
- **Testing Requirements:** Security + integration tests.
- **Specialist Review:** Security + Backend + QA.

## M13 — Integration Testing

- **Objective:** Cross-component integration validation with simulated brokers.
- **Deliverables:** Integration test suite, fixtures, simulation harness.
- **Dependencies:** M8–M11.
- **Acceptance Criteria:** Integrated flows verified against simulated brokers.
- **Testing Requirements:** Integration + e2e suites.
- **Specialist Review:** QA + Quant + Backend.

## M14 — Security Hardening

- **Objective:** Harden secrets handling, input validation, dependency
  scanning, secure defaults.
- **Deliverables:** Security controls, audit, threat review.
- **Dependencies:** M12.
- **Acceptance Criteria:** Security review passed; no secrets, no injection.
- **Testing Requirements:** Security test suite.
- **Specialist Review:** Security.

## M15 — Production Infrastructure

- **Objective:** Production-grade Docker, Nginx, deployment, monitoring,
  logging.
- **Deliverables:** Deployment configs, observability stack, CI/CD.
- **Dependencies:** M13, M14.
- **Acceptance Criteria:** Repeatable deploy; monitoring active.
- **Testing Requirements:** Deployment validation.
- **Specialist Review:** DevOps + Security + QA.

## M16 — End-to-End Validation

- **Objective:** Full-system validation from UI to simulated brokers.
- **Deliverables:** E2E scenarios, reconciliation checks, performance smoke.
- **Dependencies:** M15.
- **Acceptance Criteria:** All critical flows verified end-to-end.
- **Testing Requirements:** E2E + performance smoke tests.
- **Specialist Review:** QA + Quant + Backend + DevOps.

## M17 — Production Readiness

- **Objective:** Final review, documentation, release readiness.
- **Deliverables:** Signed-off release, runbooks, final status.
- **Dependencies:** M16.
- **Acceptance Criteria:** All milestones accepted; no open blockers.
- **Testing Requirements:** Full regression suite green.
- **Specialist Review:** Architect (final) + all affected.

---

## Note

Broker integrations (M8/M9) must be paper/sim tested before any live
deployment. No live trading occurs during development milestones.