# Testing Guide — Multi-Broker Trading Engine

A complete, beginner-friendly, step-by-step guide to test **the entire project**
from a fresh machine. Follow it top-to-bottom; every step lists the exact
command, what it does, and the expected result.

> **Absolute basics:** if you can open a terminal, you can run these tests.
> No prior knowledge of this codebase is required.

---

## Table of Contents

1. [What you are testing](#1-what-you-are-testing)
2. [Prerequisites](#2-prerequisites)
3. [Step 1 — Get the code](#3-step-1--get-the-code)
4. [Step 2 — Backend: install and verify it imports](#4-step-2--backend-install-and-verify-it-imports)
5. [Step 3 — Backend unit tests (no database needed)](#5-step-3--backend-unit-tests-no-database-needed)
6. [Step 4 — Backend integration tests (no database needed)](#6-step-4--backend-integration-tests-no-database-needed)
7. [Step 5 — Backend security tests](#7-step-5--backend-security-tests)
8. [Step 6 — Backend database tests (PostgreSQL required)](#8-step-6--backend-database-tests-postgresql-required)
9. [Step 7 — Backend code-quality checks](#9-step-7--backend-code-quality-checks)
10. [Step 8 — Frontend: install and test](#10-step-8--frontend-install-and-test)
11. [Step 9 — Frontend code-quality checks](#11-step-9--frontend-code-quality-checks)
12. [Step 10 — Run the app locally (development mode)](#12-step-10--run-the-app-locally-development-mode)
13. [Step 11 — Manual smoke test in your browser](#13-step-11--manual-smoke-test-in-your-browser)
14. [Step 12 — Full production-like deployment (Docker)](#14-step-12--full-production-like-deployment-docker)
15. [Step 13 — End-to-end scenario suite (live stack)](#15-step-13--end-to-end-scenario-suite-live-stack)
16. [Step 14 — Manual API smoke test with curl](#16-step-14--manual-api-smoke-test-with-curl)
17. [Step 15 — Backup and restore](#17-step-15--backup-and-restore)
18. [Troubleshooting](#troubleshooting)
19. [What each test layer actually proves](#what-each-test-layer-actually-proves)

---

## 1. What you are testing

The Multi-Broker Trading Engine is a **broker-agnostic trading platform**:

```text
React Terminal  (frontend/ — the web UI you see in a browser)
      |
FastAPI Gateway (backend/api — REST + WebSocket)
      |
Core Engine     (backend/domain, events, market_data, order_management,
      |           execution, risk, portfolio — all business logic)
      |
Broker Adapters (backend/brokers/ibkr, backend/brokers/saxo)
      |
Simulated brokers (fake IBKR/Saxo — no real money, ever)
```

**Important:** everything runs against **simulated (paper) brokers**. No real
financial orders are ever placed. This is by design (see `docs/ROADMAP.md`).

---

## 2. Prerequisites

| Tool | Version | Check with | Where to get |
| --- | --- | --- | --- |
| Python | 3.13+ | `python --version` | [python.org](https://python.org) |
| Node.js | 20+ | `node --version` | [nodejs.org](https://nodejs.org) |
| Docker Desktop | any recent | `docker --version` | [docker.com](https://docker.com) |
| Git | any | `git --version` | [git-scm.com](https://git-scm.com) |
| OpenSSL | any | `openssl version` | bundled with Git / most OSes |

> **Do you need Docker?** Only for Steps 6, 12, 13, and 15.
> Steps 3-11 run without Docker.

---

## 3. Step 1 — Get the code

```bash
git clone <repository-url>
cd "Multi-Broker Trading Engine Development"
```

**Expected result:** you are inside the repository. You should see folders
like `backend/`, `frontend/`, `docs/`, `tests/`, `infrastructure/`.

---

## 4. Step 2 — Backend: install and verify it imports

Open a terminal **inside the `backend/` folder**:

```bash
cd backend
python -m venv .venv

# Windows:
.venv\Scripts\activate
# Mac/Linux:
# source .venv/bin/activate

pip install -e ".[dev]"
```

**What this does:** installs the trading engine plus all test tools
(pytest, ruff, mypy, httpx).

**Verify it worked** (sanity check — the engine starts):

```bash
python -c "import sys; sys.path.insert(0, '.'); import main; print('engine imports OK')"
```

**Expected result:**

```text
engine imports OK
```

---

## 5. Step 3 — Backend unit tests (no database needed)

These test the individual building blocks: money math, order state machine,
event bus, risk rules, position accounting, password hashing, JWT tokens.

```bash
# From backend/ with the venv active
python -m pytest ../tests/unit -q
```

**Expected result:**

```text
........  [lots of dots]
459 passed in ~20s
```

**If you see even ONE `F` or `E`** — scroll up to the failure, it will show
exactly which test and why. See [Troubleshooting](#troubleshooting).

---

## 6. Step 4 — Backend integration tests (no database needed)

These test components **working together**: the full engine on one event bus,
both broker adapters end-to-end, the REST API, the WebSocket hub, and the
complete cross-boundary suite (M13) that runs on **both** IBKR and Saxo.

```bash
# Split into two runs to keep each under a couple of minutes:

# 6a. Everything except the full-stack suite:
python -m pytest ../tests/integration/api ../tests/integration/brokers \
    ../tests/integration/events ../tests/integration/execution \
    ../tests/integration/market_data ../tests/integration/order_management \
    ../tests/integration/portfolio ../tests/integration/risk -q

# 6b. The dual-broker full-stack suite (slower, ~3 min):
python -m pytest ../tests/integration/full_stack -q
```

**Expected result:**

```text
# 6a:  123 passed
# 6b:  56 passed
```

**What 6b proves:** the same trading workflow (order → risk → broker → fill →
position → P&L → events → WebSocket → REST) works identically on the **IBKR**
adapter and the **Saxo** adapter — the platform is genuinely broker-agnostic.

---

## 7. Step 5 — Backend security tests

These try to break the system: authentication bypass, cross-account access,
credential leakage, login brute-force, user-enumeration, CORS abuse.

```bash
python -m pytest ../tests/security -q
```

**Expected result:**

```text
49 passed
```

---

## 8. Step 6 — Backend database tests (PostgreSQL required)

These 8 tests verify orders **persist in PostgreSQL** and survive a restart.
They need a running PostgreSQL — the easiest way is a throwaway Docker
container:

```bash
# 1. Start a temporary PostgreSQL (Docker must be running)
docker run --rm -d --name mtbe-test-pg -p 15433:5432 \
    -e POSTGRES_PASSWORD=test-pass -e POSTGRES_DB=trading_engine \
    postgres:16-alpine

# 2. Wait ~10 seconds for it to start, then run the tests:
#    (Windows PowerShell)
$env:TEST_DATABASE_URL = "postgresql+asyncpg://postgres:test-pass@127.0.0.1:15433/trading_engine"
python -m pytest ../tests/integration/persistence -q

#    (Mac/Linux)
# TEST_DATABASE_URL="postgresql+asyncpg://postgres:test-pass@127.0.0.1:15433/trading_engine" \
#     python -m pytest ../tests/integration/persistence -q

# 3. Clean up the container when done:
docker rm -f mtbe-test-pg
```

**Expected result:**

```text
8 passed
```

> **No Docker?** Skip this step — the suite automatically skips these tests
> when `TEST_DATABASE_URL` is not set. Everything else still works.

---

## 9. Step 7 — Backend code-quality checks

Three automated quality gates — all must pass:

```bash
# 7a. Lint (code style + common bugs):
python -m ruff check .

# 7b. Formatting (consistent style):
python -m ruff format --check .

# 7c. Type checking (strict mode — catches type errors before runtime):
python -m mypy .
```

**Expected result for all three:**

```text
All checks passed!                          # ruff check
70 files already formatted                  # ruff format
Success: no issues found in 69 source files # mypy
```

---

## 10. Step 8 — Frontend: install and test

Open a **new terminal** inside the `frontend/` folder:

```bash
cd frontend
npm install
npm run test
```

**What this does:** installs the React terminal and runs 116 tests covering
the login screen, order ticket, blotter, positions, WebSocket client,
authentication, RBAC UX, and the full terminal flow (login → place order →
watch it fill → cancel → reconnect).

**Expected result:**

```text
Test Files  12 passed (12)
     Tests  116 passed (116)
```

---

## 11. Step 9 — Frontend code-quality checks

```bash
npm run typecheck    # TypeScript strict mode
npm run lint         # ESLint
npm run format:check # Prettier
npm run build        # production build (proves the app compiles)
npm audit            # dependency vulnerability scan
```

**Expected result:**

```text
# typecheck: (no output = success)
# lint: (no output = success)
# format:check: All matched files use Prettier code style!
# build: ✓ built in ~1s
# audit: found 0 vulnerabilities
```

---

## 12. Step 10 — Run the app locally (development mode)

This starts the real backend + the real frontend in dev mode so you can
click around.

```bash
# Terminal 1 — the backend (from backend/ with venv active):
#    Set at least one demo user so you can log in:
#    (Windows PowerShell)
$env:AUTH_DEMO_TRADER_PASSWORD = "dev-pass-123"
$env:APP_ENV = "development"
python main.py

#    (Mac/Linux)
# AUTH_DEMO_TRADER_PASSWORD="dev-pass-123" APP_ENV=development python main.py

# Terminal 2 — the frontend (from frontend/):
npm run dev
```

**Expected result:**

- Backend: `Uvicorn running on http://127.0.0.1:8000`
- Frontend: `Local: http://localhost:5173`

---

## 13. Step 11 — Manual smoke test in your browser

Open **http://localhost:5173** in your browser and walk through this
checklist:

| # | Action | What you should see |
| --- | --- | --- |
| 1 | The page loads | A login screen ("Sign in to the trading terminal") |
| 2 | Type a wrong password, submit | Error: "Invalid username or password." |
| 3 | Log in as `trader` / `dev-pass-123` | The trading terminal appears (Dashboard) |
| 4 | Check the header | "Stream: CONNECTED" badge turns green |
| 5 | Add a symbol to the watchlist (e.g., AAPL) | A watchlist row appears |
| 6 | Fill the order ticket: AAPL, qty `10`, limit `150.25`, click "Submit BUY" | Green success: "Order SUBMITTED — BUY 10 AAPL" |
| 7 | Look at the Orders panel below | Your order appears with status SUBMITTED |
| 8 | Click "Cancel" on the order, confirm in the dialog | Status changes to CANCELLED |
| 9 | Switch to the "Positions" tab | Empty state: "No open positions." |
| 10 | Click "Log out" (top right) | You return to the login screen |
| 11 | Log in again, check the blotter | The order is still there — state is server-side |

> The backend here runs with `SIM_AUTO_FILL` **off**, so orders stay in
> SUBMITTED until cancelled. To see automatic fills, set
> `$env:SIM_AUTO_FILL = "true"` and `$env:SIM_TICK_SECONDS = "1"` before
> starting the backend — orders will fill after ~1 second and positions
> appear.

---

## 14. Step 12 — Full production-like deployment (Docker)

This deploys the **complete production stack**: nginx TLS proxy → frontend →
backend → PostgreSQL. This is the real deployment shape.

```bash
# From the repository root:

# 12a. Create a .env with required secrets (never commit this file):
#    (Windows PowerShell)
@'
POSTGRES_PASSWORD=my-local-pass
JWT_SECRET_KEY=my-local-signing-secret-0123456789abcdef
AUTH_DEMO_TRADER_PASSWORD=deploy-pass-123
AUTH_DEMO_ADMIN_PASSWORD=deploy-admin-123
AUTH_DEMO_OUTSIDER_PASSWORD=deploy-outsider-123
AUTH_DEMO_VIEWER_PASSWORD=deploy-viewer-123
BROKER_ADAPTER=IBKR
BROKER_ACCOUNT=ACC-001
MARKET_SUBSCRIPTIONS=AAPL|EQUITY|USD|NASDAQ
SIM_TICK_SECONDS=1
SIM_AUTO_FILL=true
SIM_FILL_DELAY_SECONDS=1
APP_ENV=production
HTTPS_PORT=8443
'@ | Set-Content .env -NoNewline

# 12b. Generate staging TLS certificates:
docker run --rm -v "${PWD}\infrastructure\nginx\certs:/certs" alpine:3.19 sh -c "chmod 755 /certs 2>/dev/null; ls /certs" 2>$null
# If no certs exist yet:
docker run --rm -v "${PWD}\infrastructure\nginx\certs:/certs" alpine/openssl req -x509 -nodes -newkey rsa:2048 -days 825 -keyout /certs/server.key -out /certs/server.crt -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
docker run --rm -v "${PWD}\infrastructure\nginx\certs:/certs" alpine:3.19 sh -c "chmod 644 /certs/server.key /certs/server.crt"

# 12c. Deploy (build takes a few minutes the first time):
docker compose -f docker-compose.prod.yml up -d --build

# 12d. Wait ~40 seconds, then check:
docker compose -f docker-compose.prod.yml ps
```

**Expected result:** all four services healthy:

```text
mtbe-prod-backend-1    Up (healthy)
mtbe-prod-frontend-1   Up
mtbe-prod-postgres-1  Up (healthy)
mtbe-prod-proxy-1     Up
```

**Verify the deployment is serving:**

```bash
curl -k https://localhost:8443/ready
```

**Expected result:**

```json
{"status":"ready","broker":"IBKR","database":"ok"}
```

> You can also open **https://localhost:8443** in a browser (accept the
> self-signed certificate warning) and repeat the Step 11 smoke test — this
> time over TLS through the production proxy.

**When finished, tear down:**

```bash
docker compose -f docker-compose.prod.yml down -v
```

---

## 15. Step 13 — End-to-end scenario suite (live stack)

With the production stack from Step 12 still running, execute the automated
34-scenario E2E suite (the same one used for the project's final validation):

```bash
# From backend/ with the venv active:
$env:E2E_BROKER = "IBKR"
$env:E2E_TRADER_PASSWORD  = "deploy-pass-123"
$env:E2E_ADMIN_PASSWORD   = "deploy-admin-123"
$env:E2E_OUTSIDER_PASSWORD = "deploy-outsider-123"
$env:E2E_VIEWER_PASSWORD  = "deploy-viewer-123"
python -m pytest ../tests/e2e -q
```

**Expected result:**

```text
........  [100%]
8 passed in ~90s
```

This suite exercises **the entire platform through the deployed stack**:
login → market data → order submission → risk approval → broker
acknowledgement → full fill → partial fill → broker rejection →
cancellation → position closure → P&L verification → duplicate-order
protection → kill-switch → WebSocket streaming → backend restart with data
persistence → database restart recovery → every security boundary.

**Evidence:** results are written to `tests/e2e/artifacts/e2e-ibkr-results.md`
— open it to see the full 34-row pass/fail table.

**To test the SAXO broker instead:** tear down, change `BROKER_ADAPTER=SAXO`
and `MARKET_SUBSCRIPTIONS=AAPL|EQUITY|USD|NASDAQ|SAXO_UIC=211` in `.env`,
redeploy, then run with `$env:E2E_BROKER = "SAXO"`.

---

## 16. Step 14 — Manual API smoke test with curl

With the stack running, verify the API surface by hand:

```bash
# 1. Unauthenticated access is rejected:
curl -k https://localhost:8443/api/v1/health
# Expect: 401 {"error":{"code":"UNAUTHENTICATED",...}}

# 2. Log in:
curl -sk -X POST https://localhost:8443/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"trader","password":"deploy-pass-123"}'
# Expect: 200 with an "access_token" in the response

# 3. Use the token (paste it from step 2):
curl -sk -H "Authorization: Bearer <paste-token-here>" \
    https://localhost:8443/api/v1/orders
# Expect: 200 with a list of orders (possibly empty: [])

# 4. The docs surface is NOT publicly reachable:
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:8443/docs
# Expect: 404

# 5. Metrics are NOT publicly reachable:
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:8443/metrics
# Expect: 404
```

---

## 17. Step 15 — Backup and restore

With the stack running (from the repository root):

```bash
# Back up the orders database:
docker compose -f docker-compose.prod.yml exec -T postgres \
    pg_dump --clean --if-exists -U postgres trading_engine > backup.sql

# Verify the backup has content:
#   (Windows) — check the file size is > 0 bytes

# Restore it (idempotent — safe to run twice):
Get-Content backup.sql -Raw | docker compose -f docker-compose.prod.yml exec -T \
    postgres psql -U postgres -d trading_engine
```

**Expected result:** the restore prints SQL commands with no `ERROR` lines.
Any orders that existed at backup time are back in the database.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `pip install -e ".[dev]"` fails | Python < 3.13 | Install Python 3.13+ and recreate the venv |
| `ModuleNotFoundError: No module named 'api'` | Wrong directory | Tests must run **from `backend/`** |
| `ConnectionRefused` on port 8000/5173 | Backend/frontend not started | Re-run the Step 10 commands |
| `docker: failed to connect to the docker API` | Docker Desktop not running | Start Docker Desktop, wait for the whale icon |
| Port 8443 already in use | Another container/service holds it | Change `HTTPS_PORT` in `.env`, or `docker compose -f docker-compose.prod.yml down -v` |
| Postgres tests show `8 errors` | PostgreSQL container not up | Re-run Step 6 — the container takes ~10s to accept connections |
| Frontend login fails | Demo user not provisioned | Ensure `AUTH_DEMO_TRADER_PASSWORD` was set **before** starting the backend |
| `limit_req` 429 responses in the browser | nginx edge rate limiting during rapid manual testing | Normal — wait a few seconds; it resets |
| Backend 502 after restart | Backend still starting | Wait 20–30s; check `docker compose -f docker-compose.prod.yml ps` shows `(healthy)` |
| E2E suite "fixture trader not found" | Wrong E2E_*_PASSWORD values | The E2E passwords must match the AUTH_DEMO_* values in `.env` |
| `npm audit` shows vulnerabilities | Node modules out of date | `npm install` refreshes; the project pins clean versions |

---

## What each test layer actually proves

| Layer | Command | Tests | Proves |
| --- | --- | --- | --- |
| **Unit** | Step 3 | 459 | Every building block is mathematically correct: exact-decimal money, order state machine, event ordering, risk rules, P&L accounting, password hashing, JWT security |
| **Integration** | Step 4 | 123 | Components work together: the full engine on one event bus, both broker adapters, the REST API, the WebSocket hub |
| **Full-stack (M13)** | Step 4b | 56 | The complete flow works **identically on IBKR and Saxo** — broker parity |
| **Security** | Step 5 | 49 | No authentication bypass, no cross-account access, no credential leakage, brute-force protection, CORS posture |
| **Database** | Step 6 | 8 | Orders survive restarts in PostgreSQL; idempotency bindings persist |
| **Frontend** | Step 8 | 116 | The terminal UI renders, logs in, submits orders, streams updates, cancels, reconnects — with exact-decimal handling |
| **Quality gates** | Steps 7, 9 | — | Code is lint-clean, format-clean, strictly type-checked, and builds |
| **Live deployment** | Steps 12–15 | 34 E2E records | The whole platform works as a deployed system: TLS, auth, trading lifecycle, failure recovery, security boundaries, performance smoke |

**Total: 695 backend + 116 frontend + 68 live E2E records = ~880 automated checks.**

---

## Quick reference — one-liner for each step

```bash
# Backend (from backend/ with venv active):
python -m pytest ../tests/unit -q                                # 1. unit
python -m pytest ../tests/integration/full_stack -q              # 2. full-stack
python -m pytest ../tests/security -q                            # 3. security
python -m ruff check . && python -m mypy .                       # 4. quality

# Frontend (from frontend/):
npm run test && npm run build && npm audit                       # 5. all frontend

# Production stack (from repo root, Docker running):
docker compose -f docker-compose.prod.yml up -d --build          # 6. deploy
curl -k https://localhost:8443/ready                              # 7. health check

# E2E (from backend/, with the stack up):
E2E_BROKER=IBKR python -m pytest ../tests/e2e -q                 # 8. full validation
```
