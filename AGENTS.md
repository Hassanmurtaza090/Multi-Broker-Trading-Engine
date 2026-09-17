# AGENTS.md — Permanent Rules for OpenCode Agents

This file defines the permanent rules that **every** OpenCode agent working on
this repository must follow. These rules apply to all future milestones.

---

## Project

**Multi-Broker Trading Engine** — a professional, broker-agnostic trading
platform. The core trading engine must remain independent of React, FastAPI,
and any specific broker.

Current status is tracked in `docs/PROJECT_STATUS.md`. Read it before starting
work.

---

## General Rules

- Read relevant documentation before modifying code.
- Inspect existing implementation before creating new implementation.
- Do not duplicate existing functionality.
- Do not assume something is complete because code exists.
- Never fabricate test results.
- Never mark a feature complete without verification.
- Preserve backward compatibility unless a breaking change is explicitly
  approved and recorded as an ADR.
- Keep changes focused and reviewable.
- Do not introduce unnecessary dependencies.
- Do not expose secrets or credentials.
- Do not commit `.env` files containing secrets.

---

## Required Documentation Reading

Before substantial work, inspect:

```text
AGENTS.md
docs/PROJECT_STATUS.md
docs/ROADMAP.md
docs/ARCHITECTURE.md
docs/REQUIREMENTS.md
docs/TEST_STATUS.md
docs/DECISIONS.md
```

Then inspect the relevant source code and tests.

---

## Architecture Boundaries (Non-Negotiable)

```text
React (frontend)
      ↓
FastAPI / API layer (backend/api)
      ↓
Application layer (backend/application)
      ↓
Trading domain / core (backend/domain)
      ↓
Broker abstraction (backend/brokers/base)
      ↓
Broker adapters (backend/brokers/ibkr, backend/brokers/saxo)
```

- The trading core **must not** depend on React, FastAPI, or any specific
  broker.
- Broker-specific logic lives **only** in broker adapters.
- The core talks to brokers through interfaces defined in
  `backend/brokers/base`.
- Domain logic must not import infrastructure or API modules.

---

## Completion Rule

A task may be marked COMPLETE only when all of the following are satisfied:

```text
Implementation
      ↓
Tests
      ↓
Verification (tests actually executed)
      ↓
Required specialist review
      ↓
Documentation
      ↓
Status update (docs surrendered)
```

- **Trading / risk / financial logic** → Quant review required.
- **Security-sensitive changes** → Security review required.
- **Deployment / infrastructure changes** → DevOps review required.

Never mark a task COMPLETE based on intent or assumption. Verification must be
actual.

---

## Agent Collaboration Protocol

```text
Lead / Architect
        ↓
Planning
        ↓
Implementation Agent
        ↓
QA / Testing
        ↓
Specialist Review
        ↓
Security Review
        ↓
DevOps Review
        ↓
Architect Final Review
```

Do not invoke every specialist for trivial changes. Match specialists to the
change:

| Change | Specialists |
| --- | --- |
| UI change | Frontend + QA |
| Broker integration | Backend + Quant + QA + Security |
| Risk calculation | Quant + Backend + QA |
| Database migration | Backend + Security + QA |
| Deployment | DevOps + Security + QA |
| Architecture change | Architect + affected specialists |

---

## Testing Rules

- Every test report must record: date, commit/version, category, command, tests
  executed, passed, failed, skipped, failure details, reviewer, status.
- Never write `PASS` unless the test was actually executed.
- Do not create tests that merely assert `True`; tests must validate actual
  behavior.

---

## Security Rules

- Never hardcode secrets.
- Never expose credentials.
- Never commit `.env` files.
- Never log passwords, tokens, API keys, or sensitive data.
- Validate untrusted input.
- Follow least-privilege principles.

---

## Git Rules

- Work on feature branches.
- Write meaningful commits; keep changes small.
- No direct changes to production.
- Use pull-request-style review.
- Never commit secrets.
- Do not force-push, delete branches, or amend shared history without explicit
  confirmation.