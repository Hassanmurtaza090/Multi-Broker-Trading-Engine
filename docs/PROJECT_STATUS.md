# Project Status

> **Live project-state document.** Keep this file current after every milestone
> or significant change. Never claim work is complete without verification.

---

## Overview

| Field | Value |
| --- | --- |
| Project | Multi-Broker Trading Engine |
| Status | Active Development |
| Current Milestone | M11 — React Trading Terminal |
| Current Phase | Trading terminal implemented + verified |
| Implementation Status | Completed (M1-M11) |
| Testing Status | Backend 482/482 pass; Frontend 89/89 pass (M0-M10 regression included) |
| Broker Integrations | IBKR + Saxo adapters complete (simulated clients; real transports deferred) |
| API Gateway | Complete (REST + WebSocket; auth enforcement deferred to M12) |
| Frontend | Complete (M11 — React trading terminal on the M10 gateway) |
| Production Deployment | Not Started |
| Last Updated | 2026-09-27 |

---

## Completed Work

- Repository directory structure created (monorepo layout).
- Root `AGENTS.md` (permanent agent rules) authored.
- `.gitignore` and `.env.example` (placeholders only) authored.
- Project memory documentation authored (this file, ROADMAP, ARCHITECTURE,
  REQUIREMENTS, DECISIONS, TEST_STATUS, CHANGELOG, DEVELOPMENT_WORKFLOW).
- Backend foundation scaffolded (package layout, dependency management,
  lint/format/type-check/test configuration).
- Frontend foundation scaffolded (React + TypeScript + Vite, lint/format/test
  configuration).
- Docker foundation scaffolded (compose + backend/frontend/postgres structure).
- Initial test infrastructure created (tests validate the project foundation
  only — no application behavior yet).
- Backend foundation verified (pytest, ruff, mypy all pass).
- Frontend foundation verified (vitest, tsc, ESLint, vite build all pass).
- **M1 — Core Domain Model implemented** in `backend/domain`:
  - `money.py` — `Currency`, `Money`, `Quantity`, `Price` (Decimal-based,
    immutable value objects).
  - `instrument.py` — `Instrument`, `AssetClass`, `Exchange`, `InstrumentType`.
  - `orders.py` — `OrderSide`, `OrderType`, `TimeInForce`, `OrderStatus`
    (lifecycle state machine), `Order`, `OrderRequest`.
  - `account.py` — `Account`, `Balance`, `CashBalance`.
  - `position.py` — `Position` (signed quantity, VWAP via `apply_fill`).
  - `fills.py` — `Fill`, `ExecutionReport`, `ExecutionReportType`.
  - `portfolio.py` — `Portfolio` aggregation.
  - `market.py` — `MarketQuote`, `QuoteType`.
  - `errors.py` — typed `DomainError` hierarchy + stable error codes.
- **M2 — Event System implemented** in `backend/events`:
  - `base.py` — `DomainEvent` base (stable `__event_type__`, `__event_version__`).
  - `envelope.py` — `EventEnvelope` (`event_id`, `event_type`, `event_version`,
    timezone-aware `timestamp`, `source`, `correlation_id`, `causation_id`,
    typed `payload`).
  - `bus.py` — `EventBus` protocol + `InProcessEventBus` (reentrancy-safe
    per-bus total ordering, sequential handler dispatch, handler isolation,
    structured observability).
  - `registry.py` — `EventRegistry` (version-keyed `(event_type, version)` → class).
  - `serialization.py` — `EventSerializer` (envelope ↔ JSON-safe dict).
  - `types.py` — concrete event types (market data, order lifecycle,
    position lifecycle, account, broker connectivity, risk).
  - `docs/EVENTS.md` — full event catalog with per-event semantics.
- **M3 — Market Data Engine implemented**:
  - `domain/market.py` — added `MarketTick`, `Bar`, `BarInterval` (OHLCV bar
    invariants, non-negative volume, single-currency checks).
  - `brokers/base/market_data.py` — `MarketDataFeed` port with `RawQuote`,
    `RawTick`, `RawBar` payloads (implemented by IBKR/Saxo in M8/M9).
  - `market_data/engine.py` — `MarketDataEngine`: normalizes/validates raw
    feed payloads into domain value objects and publishes
    `MarketQuoteUpdated` / `MarketTickUpdated` / `MarketBarUpdated` on the M2
    event bus.
  - `market_data/subscription.py` — `SubscriptionManager`: idempotent,
    ref-counted feed subscriptions.
  - `market_data/staleness.py` — `StalenessMonitor`: stale-data detection
    (TS-007) with injectable clock.
  - `events/` — added `MarketTickUpdated` and `MarketBarUpdated` event types.
- **M4 — Order Management System implemented**:
  - `domain/orders.py` — added `Order.filled_quantity` (M1-deferred),
    `remaining_quantity`, `apply_fill_quantity`, `mark_pending_submit`.
  - `domain/errors.py` — added `OrderStateError` (code `CONFLICT`).
  - `order_management/manager.py` — `OrderManager`: create/submit/cancel/
    modify/apply execution reports with event publication, idempotency
    (`client_order_id` / `idempotency_key`) and duplicate-`report_id`
    protection.
  - `order_management/repository.py` — `OrderRepository` port +
    `InMemoryOrderRepository`.
  - `events/` — added `OrderModified` event type.
- **M5 — Execution Engine implemented**:
  - `brokers/base/execution.py` — `ExecutionBroker` port +
    `ExecutionReportHandler` (implemented by IBKR/Saxo in M8/M9).
  - `execution/engine.py` — `ExecutionEngine`: submit/cancel/modify through the
    broker, apply reports to the OMS (which publishes `order.*` events), handle
    timeouts (state unchanged), bounded connection-loss retry, and
    `reconcile()` for reconnection (TS-006).
- **M6 — Risk Engine implemented**:
  - `risk/engine.py` — `RiskEngine`: deterministic pre-trade evaluation,
    kill switch (global + per-account), daily order counts (dedup by
    `event_id`), publishes `RiskViolation` on rejection.
  - `risk/rules.py` — configurable rules (kill switch, order size, position,
    notional exposure, available funds, daily order count, daily loss, trading
    session); fail-closed when required data is unavailable.
  - `risk/policy.py` — `RiskPolicy` / `RiskLimits` / `TradingWindow`.
  - `risk/gate.py` — `RiskGatedExecutor`: mandatory pre-execution checkpoint
    (no order bypasses risk).
  - `risk/views.py` — read-model ports (`PortfolioView`, `AccountView`,
    `MarketDataView`, `DailyPnlProvider`) for state ownership (M7 supplies the
    portfolio view).
- **M7 — Portfolio & P&L implemented**:
  - `portfolio/accounting.py` — pure average-cost functions (open/increase/
    reduce/close/reverse with realized P&L, immediate fee recognition,
    unrealized/market-value/exposure math).
  - `portfolio/service.py` — `PortfolioService`: authoritative fill-driven
    positions and P&L (cumulative + daily), valuation with a staleness policy
    (`price_max_age`), balance/equity/exposure, duplicate-fill dedup,
    `position.opened/updated/closed` publishing, the M6 read-model ports, and
    `apply_broker_snapshot` reconciliation for M8/M9 adapters.
- **M8 — IBKR adapter implemented**:
  - `brokers/ibkr/contracts.py` — IBKR-shaped DTOs (contract, order, execution,
    account value, position, quote, bar, order status) + error/status codes.
  - `brokers/ibkr/mapping.py` — pure IBKR↔internal translation (instruments ↔
    contracts incl. FOREX pairs, orders → IBKR orders, statuses → report types,
    executions → fills, account values → balances, positions, errors).
  - `brokers/ibkr/client.py` — `IbkrClient`/`IbkrCallbacks` transport protocols
    (EClient/EWrapper shapes) + `SimulatedIbkrClient` (paper/test mode).
  - `brokers/ibkr/adapter.py` — `IbkrAdapter`: implements the M3
    `MarketDataFeed` and M5 `ExecutionBroker` ports; connection lifecycle with
    `BrokerConnected`/`BrokerDisconnected`; reconnect with deduplicated
    re-subscription and state replay; status/execution dedup; `balance.updated`
    publication and internal-account relabeling; `position_snapshot()` for the
    M7 reconciliation boundary.
- **M9 — Saxo adapter implemented**:
  - `brokers/saxo/contracts.py` — Saxo-shaped DTOs (session, instrument, order,
    order status, execution, quote, bar, balance, position) + status/error
    codes.
  - `brokers/saxo/mapping.py` — pure Saxo↔internal translation (UIC/AssetType
    instruments via `SAXO_UIC` identifiers, orders → Saxo orders, statuses →
    report types incl. Expired→EXPIRED, executions → fills, balance snapshots
    → balances, positions with venues, errors).
  - `brokers/saxo/client.py` — `SaxoClient`/`SaxoCallbacks` transport
    protocols with an OAuth session lifecycle
    (`authorize`/`refresh_session`/`logout`) + `SimulatedSaxoClient`
    (sim/paper mode).
  - `brokers/saxo/adapter.py` — `SaxoAdapter`: implements the SAME M3/M5 ports
    as IBKR (abstraction reused unchanged); proactive + reactive token refresh;
    streaming-registry quote resolution; connection lifecycle, reconnect
    re-subscription + state replay; status/execution dedup;
    `balance.updated` publication and internal-account relabeling;
    `position_snapshot()` for the M7 reconciliation boundary.

- **M10 - API gateway implemented**:
  - `application/runtime.py` - `EngineRuntime`: composition root wiring bus,
    OMS, execution, market data, portfolio, risk, and the risk-gated executor
    on one M2 bus behind injected ports.
  - `api/schemas.py` - API DTOs + exact-decimal (fixed-point string)
    serialization.
  - `api/errors.py` - DomainError to HTTP mapping (stable codes; generic 500
    without internals).
  - `api/rest.py` - thin REST router (orders via the M6 gate, cancel/modify
    via M5, reads via M4/M7, risk + kill-switch via M6, market quotes,
    broker status, health).
  - `api/ws.py` - `WebSocketHub`: at-least-once M2-envelope streaming with
    topic filtering, `event_id` dedupe, bounded backpressure (1013 close).
  - `api/app.py` - `create_app` factory (OpenAPI docs at /docs).
  - `api/security.py` - auth hook (M12 placeholder, anonymous principal).
  - `main.py` - composition boundary (simulated adapters; no live trading).

- **M11 — React trading terminal implemented** in `frontend/src`:
  - `services/api.ts` — typed REST client over `/api/v1` (all M10 endpoints)
    with stable-error mapping: risk 422 (violations attached), 404/409/400,
    504 timeout ("outcome unknown — safe idempotent retry"), 503 connection
    lost, network errors; exact-decimal strings passed through verbatim;
    untrusted path segments URL-encoded.
  - `services/ws.ts` — `TerminalSocket` implementing the ADR-016 client
    contract: bounded-LRU `event_id` dedupe, capped exponential reconnect
    (retry forever for a terminal), full REST resync after every successful
    (re)connect, distinct 1013 (reconnect+resync) vs 4400 (fatal) close
    handling, ping keepalive, malformed-frame isolation.
  - `stores/` — minimal typed external stores on React 18
    `useSyncExternalStore` (no state-management framework — ADR-017):
    connection, brokers, orders, positions, account, market, risk, ui.
    Idempotent event merges keyed by `client_order_id` / position identity;
    WS payloads reconcile with REST rows (same identity key); REST reads
    stay authoritative (debounced resync after fills).
  - `hooks/useTerminal.ts` — the single wiring hook: initial REST load
    independent of WS, WS event routing, account-switch resync with
    stale-result discard, watchlist quote polling (M10 has no subscribe
    endpoint), 1 Hz staleness tick (TS-007 display).
  - Terminal UI (`layouts/`, `pages/`, `features/`, `components/`):
    Dashboard / Orders / Positions views; order ticket (server-side risk
    dry-run, kill-switch warning, in-flight submit guard, idempotency-key
    lifecycle: kept across uncertain outcomes — 504/5xx/network — rotated
    after definitive ones); order blotter (state-machine-driven
    cancel/modify with confirmation, 409/504 error surfacing); positions
    table (signed qty, "—" for unpriced values — never invented zeros,
    stale badges); account panel (balances, equity/exposure, P&L summary;
    404 balance = explicit "not reported" state); watchlist + SVG
    sparkline chart; broker status (multi-broker capable list); risk panel
    (confirmed kill-switch control + bounded violation feed); connection
    banner; loading/error/empty states everywhere.
  - `config.ts` (VITE_* env with safe defaults), `vite.config.ts` dev proxy
    to the M10 gateway, dark terminal theme (`styles.css`).

> M10 itself contains no frontend logic; the M11 terminal above consumes it
> over REST + WS only.
> ibapi-backed IBKR and OpenAPI-backed Saxo transports are deferred
> (ADR-014/ADR-015); M8/M9 are verified against simulated clients only.

---

## In-Progress Work

- None — M1-M11 implementation and verification complete (awaiting entry to M12).

---

## Planned Work

| Milestone | Name | Status |
| --- | --- | --- |
| M1 | Core Domain Model | ✅ Complete (verified) |
| M2 | Event System | ✅ Complete (verified) |
| M3 | Market Data | ✅ Complete (verified) |
| M4 | Order Management | ✅ Complete (verified) |
| M5 | Execution Engine | ✅ Complete (verified) |
| M6 | Risk Engine | ✅ Complete (verified) |
| M7 | Portfolio & P&L | ✅ Complete (verified) |
| M8 | IBKR Integration | ✅ Complete (verified) |
| M9 | Saxo Integration | ✅ Complete (verified) |
| M10 | FastAPI Gateway | ✅ Complete (verified) |
| M11 | React Trading Terminal | ✅ Complete (verified) |
| M12 | Authentication & Authorization | Pending |
| M13 | Integration Testing | Pending |
| M14 | Security Hardening | Pending |
| M15 | Production Infrastructure | Pending |
| M16 | End-to-End Validation | Pending |
| M17 | Production Readiness | Pending |

---

## Blockers

- None.

## Known Technical Debt

- None at this stage (M1–M8 have no known defects; the OMS/portfolio/adapter
  in-memory state is an intentional, documented deferral — see below).
- `frontend` npm dependencies report 4 advisories from the deprecated ESLint 8
  toolchain (build-time only); to be addressed when tooling is upgraded.
- The OMS uses an in-memory `OrderRepository`; a PostgreSQL implementation
  arrives with the infrastructure milestone (ADR-010).
- The Portfolio service is in-memory (state rebuildable from events and/or a
  broker snapshot); PostgreSQL persistence arrives with the infrastructure
  milestone (ADR-013).
- Event bus ordering is guaranteed only within a single `InProcessEventBus`
  instance on a single event loop. Cross-process/distributed ordering and a
  retry/dead-letter mechanism are intentionally deferred (ADR-007).
- The M8/M9 adapters (IBKR, Saxo) are verified against their simulated
  clients (paper/sim mode). The real ibapi/ib_insync and OpenAPI transports,
  session/credential handling, and controlled live/sim validation are deferred
  to credentialed environments (ADR-014/ADR-015); adapter dedup state is
  in-memory across restarts.
- Multi-currency portfolio aggregates (exposure/equity/daily P&L) return `None`
  pending an FX-conversion design (ADR-013); single-currency accounts are fully
  functional.
- The M10 runtime binds ONE broker account (M5 design; ADR-016); the terminal's
  account selector re-syncs account-scoped data on change and is forward-
  compatible with multi-account deployments, but only one account exists on the
  gateway today.
- M10 exposes no market-data subscribe endpoint; the terminal therefore POLLS
  `GET /market/quote` for watchlisted instruments and additionally renders
  `market.quote.updated` events when the engine has subscriptions. A subscribe
  API is future gateway work (noted for M13 integration scope).
- Frontend state is in-memory (no persistence between reloads — acceptable for
  a terminal; REST resync rebuilds everything on load). The watchlist is
  session-scoped (one demo default available).
- Browser-based E2E (Playwright/Cypress) is deliberately deferred to M13/M16
  per the roadmap; M11 verification is component/hook tests plus a live
  contract smoke against the real gateway (see TEST_STATUS).

---

## Current Architecture State

M1 domain model is implemented in `backend/domain` (broker-agnostic, no
infrastructure/framework imports — enforced by tests). The M2 event system in
`backend/events` is broker- and framework-agnostic: domain logic depends on the
`EventBus` protocol, and the `InProcessEventBus` transport is swappable without
rewriting domain/application layers. The M3 market-data engine in
`backend/market_data` depends only on the `MarketDataFeed` port
(`backend/brokers/base`), the domain, and the event system. The M4 OMS in
`backend/order_management` depends only on the domain (`Order` state machine),
the event bus, and its `OrderRepository` port. The M5 Execution Engine in
`backend/execution` depends only on the `ExecutionBroker` port, the domain, and
the OMS. The M6 Risk Engine in `backend/risk` depends only on the domain, the
event bus, and read-model ports. The M7 Portfolio service in `backend/portfolio`
depends only on the domain and the event bus, and implements the M6 read-model
ports so Risk consumes authoritative state. The M8 IBKR adapter
(`backend/brokers/ibkr`) and M9 Saxo adapter (`backend/brokers/saxo`) implement
the SAME broker ports against their respective transport ports, proving the
abstraction reusable with no core changes (broker parity review recorded); all
broker-specific code is confined to those packages (grep-verified: no
`brokers.ibkr`/`brokers.saxo` import exists outside them). The M10 gateway
(`backend/api`) is a pure delegation/serialization surface over the
`EngineRuntime` composition root (`backend/application`), which depends only on
ports; adapters are imported solely by `backend/main.py` (grep-verified).
The M11 terminal (`frontend/src`) is presentation-only: it consumes the gateway
exclusively over REST `/api/v1` + WS `/ws`, holds no business/risk/broker logic,
keeps every financial value as an exact-decimal string (floats only for chart
pixels), and synchronizes via the ADR-016 at-least-once contract (event_id
dedupe + REST resync; ADR-017). Architecture
boundaries hold: domain, events, market_data, order_management, execution,
risk, and portfolio do not import FastAPI, React, SQLAlchemy, or any broker.
See `docs/ARCHITECTURE.md`, `docs/EVENTS.md`, and `docs/DECISIONS.md`.

---

## Last Verified Test Status

See `docs/TEST_STATUS.md` for the authoritative record.

- Latest result (M11, 2026-09-27): frontend 89/89 tests pass; `tsc -b`,
  ESLint, Prettier check, and `vite build` all clean. Backend regression
  482/482 pass; `ruff check`, `mypy` (strict, 62 files) clean. Live contract
  smoke against the real M10 gateway (REST + WS): PASS (10/10). Frontend/QA
  and Security/Architecture reviews: PASS (all findings fixed and re-verified).