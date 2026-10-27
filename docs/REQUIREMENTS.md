# Requirements

Initial requirements specification for the **Multi-Broker Trading Engine**.

Requirements marked `TBD` are not yet fully specified and must be refined in the
relevant milestone. This document intentionally avoids inventing requirements;
items are added only as they become real.

> **M17 FINAL STATUS:** every requirement below is implemented and validated,
> or explicitly deferred with a recorded ADR. See `docs/RELEASE.md` for the
> release record and the pre-real-money checklist. No release blockers.

---

## Functional Requirements

| ID | Requirement | Status |
| --- | --- | --- |
| FR-001 | Support multiple broker accounts (IBKR, Saxo) behind a unified abstraction. | ✅ Complete — one abstraction, both adapters verified (simulated transports; real transports deferred per ADR-014/015) |
| FR-002 | Receive and normalize market data (ticks / bars) from connected brokers. | ✅ Complete (M3; feeds through both adapters M8/M9; live market-data E2E M16) |
| FR-003 | Submit orders through the broker abstraction. | ✅ Complete (M3–M5; both brokers E2E M16) |
| FR-004 | Cancel orders. | ✅ Complete (broker-confirmed; E2E validated) |
| FR-005 | Modify open orders. | ✅ Complete (price terms; API + integration tested) |
| FR-006 | Track positions per account. | ✅ Complete (M7; position lifecycle E2E M16) |
| FR-007 | Retrieve account information (cash, buying power, etc.). | ✅ Complete (balances relabeled from brokers; REST endpoints) |
| FR-008 | Compute realized and unrealized P&L. | ✅ Complete (M7; independently recomputed in the M16 E2E) |
| FR-009 | Enforce pre-trade risk controls. | ✅ Complete (M6 fail-closed gate — unbypassable; E2E kill-switch + risk rejection) |
| FR-010 | Deliver real-time updates over WebSocket. | ✅ Complete (M10 hub; ticket-gated; order-lifecycle streaming E2E M16) |
| FR-011 | Provide a web trading terminal (React). | ✅ Complete (M11; auth/RBAC integration M12; identifiers field M16) |
| FR-012 | Maintain audit logs of orders and critical actions. | ✅ Complete (structured identifier-only logs: order lifecycle, auth, kill switch, risk rejections) |
| FR-013 | Authenticate and authorize users (roles/permissions). | ✅ Complete (M12 — JWT + RBAC + account scoping, ADR-018; hardened M14; re-verified live M16) |

---

## Non-Functional Requirements

| ID | Requirement | Status |
| --- | --- | --- |
| NFR-001 | Reliability — correct behavior under failure. | ✅ Complete (broker disconnect/reconnect, DB restart, backend restart persistence — all validated live M15/M16) |
| NFR-002 | Maintainability — clear module boundaries, readable code. | ✅ Complete (layered architecture enforced + verified by grep every milestone) |
| NFR-003 | Security — secrets, least privilege, input validation. | ✅ Complete (M12 authN/Z, M14 hardening, M17 secrets scan; all boundaries re-verified live) |
| NFR-004 | Observability — structured logs, metrics. | ✅ Complete (JSON logs, authenticated in-cluster /metrics, /ready gating) |
| NFR-005 | Testability — core testable without brokers/DB. | ✅ Complete (696 backend tests run without external dependencies; DB tests skip cleanly) |
| NFR-006 | Extensibility — new brokers via adapters. | ✅ Complete (Saxo reused the abstraction unchanged — parity proven twice) |
| NFR-007 | Recovery / reconnection — survive broker disconnects. | ✅ Complete (adapter reconnect + reconcile; E2E restart recovery) |
| NFR-008 | Performance — acceptable latency for trading. | ✅ Smoke-validated (M16: risk-gated submit p95 well under the 1500 ms regression gate; 5 parallel submissions consistent). Full load testing is future enhancement scope. |

---

## Trading-Specific Requirements

| ID | Requirement | Status |
| --- | --- | --- |
| TS-001 | Order lifecycle correctness (state machine transitions). | ✅ Complete (M1/M4; M13 late/conflicting-report integrity) |
| TS-002 | Position reconciliation with broker state. | ✅ Complete (`apply_broker_snapshot` + adapter replay) |
| TS-003 | Duplicate-order protection. | ✅ Complete (idempotent replay E2E: 201→200, one row, survives restart) |
| TS-004 | Idempotency of order submission. | ✅ Complete (binding persisted in PostgreSQL; E2E replay across restart) |
| TS-005 | Risk validation before execution — never bypassed. | ✅ Complete (mandatory gate; no API path bypasses; E2E kill switch) |
| TS-006 | Broker state reconciliation after reconnect. | ✅ Complete (M5 reconcile; broker-side cancel/reject via reconcile E2E) |
| TS-007 | Market-data consistency / stale-data detection. | ✅ Complete (staleness monitor; never-silently-zero policy; stale quotes live-badged) |
| TS-008 | Kill switch to halt trading. | ✅ Complete (admin-only, audited; E2E block + release) |
| TS-009 | Full auditability of order and risk decisions. | ✅ Complete (ordered typed events + identifier-only structured logs) |

---

## Notes

- Requirements are validated and refined in the milestone that addresses them.
- No live trading requirement exists for development milestones; paper/sim
  testing is mandatory (see ROADMAP). Real-broker transports and controlled
  sandbox validation are recorded deferrals (ADR-014/015) with the
  pre-real-money checklist in `docs/RELEASE.md`.
