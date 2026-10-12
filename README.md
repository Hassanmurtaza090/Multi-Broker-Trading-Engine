# Multi-Broker Trading Engine

A professional, **broker-agnostic** trading platform for multi-broker trading
with a web terminal, an independent Python trading-engine core, and adapters for
Interactive Brokers and Saxo Bank.

> **Status: RELEASED — M17 signed off (2026-10-12).** The full platform is
> implemented and verified end to end against **simulated** brokers: engine
> core (domain, events, market data, OMS, execution, risk, portfolio),
> IBKR/Saxo adapters, the FastAPI gateway (REST + WebSocket), the React
> trading terminal with JWT authentication and role-based authorization,
> security hardening, and a production-shaped deployment (TLS edge +
> PostgreSQL order persistence) validated from scratch with live E2E on
> both brokers.
> **No live trading has occurred.** Real broker transports and controlled
> sandbox validation are recorded deferrals (ADR-014/015) — see the release
> record and the mandatory pre-real-money checklist in
> `docs/RELEASE.md`.

---

## Purpose

Provide a modular, extensible trading engine where the core is independent of
the UI framework, the API framework, and any specific broker. New brokers are
added by writing adapters — no core changes required.

## Architecture Overview

```text
React (frontend)
      ↓
FastAPI / API Layer
      ↓
Application Layer
      ↓
Trading Domain / Core   (broker-agnostic)
      ↓
Broker Abstraction      (interfaces)
      ↓
Broker Adapters  ├── IBKR └── Saxo
```

Dependencies flow downward only. The core never depends on React, FastAPI, or a
specific broker. Full details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | React + TypeScript + Vite |
| API | Python + FastAPI |
| Core | Python (framework-independent) |
| Brokers | IBKR, Saxo (via adapters) |
| Database | PostgreSQL |
| Messaging/Realtime | WebSocket (+ Redis pub/sub where needed) |
| Tooling | uv/pip, ruff, mypy, pytest · ESLint, Prettier, Vitest |
| Deployment | Docker, Nginx |

## Repository Structure

```text
AGENTS.md · README.md · .gitignore · .env.example · docker-compose.yml
docs/           # project memory & status docs
backend/        # api, application, domain, infrastructure, brokers,
                #   market_data, execution, risk, portfolio, events, config
frontend/       # React + TypeScript terminal (src/{components,pages,...})
tests/          # unit, integration, e2e, security, performance, fixtures
scripts/        # dev/test helper scripts
infrastructure/ # docker, nginx, deployment
.github/        # CI workflows
```

## Development Setup

Prerequisites: Python 3.13+, Node 20+, Docker.

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -e ".[dev]"
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Production Deployment (M15)

```bash
cp .env.example .env               # fill in the required secrets
./scripts/generate_tls_certs.sh    # staging certs (production mounts real ones)
docker compose -f docker-compose.prod.yml up -d --build
curl -k https://localhost:8443/ready
```

Orders persist in PostgreSQL across backend restarts; only the nginx TLS
edge is exposed. See `infrastructure/deployment/RUNBOOK.md` for the full
operational documentation (monitoring, backup/restore, failure behavior).

## Testing

```bash
# Backend
cd backend && pytest

# Frontend
cd frontend && npm run test
```

Test results must be recorded per `docs/TEST_STATUS.md`. Do not report `PASS`
unless tests were actually executed.

## Environment Configuration

Copy `.env.example` → `.env` and fill in real values. Never commit `.env`.
All broker credentials are placeholders in the template.

## Current Project Status

See [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md). Current milestone:
**M11 — React Trading Terminal (complete)**.

## Roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the milestone plan (M0 → M17).

## Security Notice

- Authentication is REQUIRED (M12): JWT bearer + rotating refresh sessions;
  role-based authorization (viewer/trader/admin) with per-user account
  scoping enforced server-side.
- Do not commit secrets or `.env` files; user files (`AUTH_USERS_FILE`)
  contain password hashes only (see `scripts/hash_password.py`).
- No live trading occurs during development; broker integrations are paper/sim
  tested first.
- Login rate limiting is fail-closed (429 after repeated failures); shared
  infrastructure throttling and a public-facing reverse proxy arrive in M15.