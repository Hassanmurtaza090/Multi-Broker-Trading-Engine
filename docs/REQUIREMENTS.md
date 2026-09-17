# Requirements

Initial requirements specification for the **Multi-Broker Trading Engine**.

Requirements marked `TBD` are not yet fully specified and must be refined in the
relevant milestone. This document intentionally avoids inventing requirements;
items are added only as they become real.

---

## Functional Requirements

| ID | Requirement | Status |
| --- | --- | --- |
| FR-001 | Support multiple broker accounts (IBKR, Saxo) behind a unified abstraction. | Defined |
| FR-002 | Receive and normalize market data (ticks / bars) from connected brokers. | Defined |
| FR-003 | Submit orders through the broker abstraction. | Defined |
| FR-004 | Cancel orders. | Defined |
| FR-005 | Modify open orders. | Defined |
| FR-006 | Track positions per account. | Defined |
| FR-007 | Retrieve account information (cash, buying power, etc.). | Defined |
| FR-008 | Compute realized and unrealized P&L. | Defined |
| FR-009 | Enforce pre-trade risk controls. | Defined |
| FR-010 | Deliver real-time updates over WebSocket. | Defined |
| FR-011 | Provide a web trading terminal (React). | Defined |
| FR-012 | Maintain audit logs of orders and critical actions. | Defined |
| FR-013 | Authenticate and authorize users (roles/permissions). | TBD (M12) |

---

## Non-Functional Requirements

| ID | Requirement | Status |
| --- | --- | --- |
| NFR-001 | Reliability — correct behavior under failure. | Defined |
| NFR-002 | Maintainability — clear module boundaries, readable code. | Defined |
| NFR-003 | Security — secrets, least privilege, input validation. | Defined |
| NFR-004 | Observability — structured logs, metrics. | Defined |
| NFR-005 | Testability — core testable without brokers/DB. | Defined |
| NFR-006 | Extensibility — new brokers via adapters. | Defined |
| NFR-007 | Recovery / reconnection — survive broker disconnects. | Defined |
| NFR-008 | Performance — acceptable latency for trading. | TBD (targets) |

---

## Trading-Specific Requirements

| ID | Requirement | Status |
| --- | --- | --- |
| TS-001 | Order lifecycle correctness (state machine transitions). | Defined |
| TS-002 | Position reconciliation with broker state. | Defined |
| TS-003 | Duplicate-order protection. | Defined |
| TS-004 | Idempotency of order submission. | Defined |
| TS-005 | Risk validation before execution — never bypassed. | Defined |
| TS-006 | Broker state reconciliation after reconnect. | Defined |
| TS-007 | Market-data consistency / stale-data detection. | Defined |
| TS-008 | Kill switch to halt trading. | Defined |
| TS-009 | Full auditability of order and risk decisions. | Defined |

---

## Notes

- Requirements are validated and refined in the milestone that addresses them.
- No live trading requirement exists for development milestones; paper/sim
  testing is mandatory (see ROADMAP).