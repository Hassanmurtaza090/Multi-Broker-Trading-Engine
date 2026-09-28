# Multi-Broker Trading Engine

A professional, **broker-agnostic** trading platform for multi-broker trading
with a web terminal, an independent Python trading-engine core, and adapters for
Interactive Brokers and Saxo Bank.

> **Status: Active development (M11 complete).** The engine core (domain,
> events, market data, OMS, execution, risk, portfolio), IBKR/Saxo adapters
> (simulated transports), the FastAPI gateway, and the React trading terminal
> are implemented and verified against simulated brokers.
> **It is NOT production-ready.** No live trading has occurred; real broker
> transports, persistence, and auth land in later milestones.

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

- Do not commit secrets or `.env` files.
- No live trading occurs during development; broker integrations are paper/sim
  tested first.
- Authentication/authorization hardening lands in M12/M14.