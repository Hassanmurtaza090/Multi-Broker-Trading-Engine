# Frontend

React 18 + TypeScript trading terminal (Vite) for the Multi-Broker Trading
Engine. Presentation-only: it consumes the M10/M12 gateway over REST
(`/api/v1`) and WebSocket (`/ws`) and holds no business, risk, or broker
logic. See `../docs/ARCHITECTURE.md` (Trading Terminal Architecture +
Authentication & Authorization) and `../docs/DECISIONS.md` (ADR-017/018).

## Authentication (M12)

- The terminal is login-gated: unauthenticated users see only the sign-in
  view; the WS/REST wiring mounts after login and unmounts on expiry.
- Tokens live in memory only (never localStorage/cookies) — a page reload
  requires signing in again (documented tradeoff, ADR-018).
- The API client attaches the bearer token and performs exactly one
  single-flight refresh + retry on 401; WebSocket connections exchange a
  fresh single-use ticket (`POST /auth/ws-ticket`) per connect.
- Role-aware rendering (viewers get a read-only ticket, kill-switch control
  is admin-only, scoped users choose accounts from their allowed list) is
  UX only — every rule is enforced server-side.

## Views

- **Dashboard** — watchlist + price chart, positions, order blotter, order
  ticket, account summary, risk (kill switch + violation feed), broker status.
- **Orders** — order ticket (with server-side risk dry-run) + full blotter with
  confirmed cancel/modify.
- **Positions** — positions table + account balances / P&L summary.

## Setup

```bash
npm install
npm run dev        # http://localhost:5173 (proxies /api and /ws to :8000)
```

Start the backend first (simulated broker stack, no live trading) with at
least one user provisioned (env-driven demo users or an `AUTH_USERS_FILE`):

```powershell
cd ../backend
$env:AUTH_DEMO_TRADER_PASSWORD = "choose-a-dev-password"   # demo user: trader
$env:AUTH_DEMO_ADMIN_PASSWORD  = "choose-an-admin-password" # demo user: admin
python main.py     # serves http://127.0.0.1:8000 (docs at /docs)
```

Sign in with the provisioned username/password in the terminal.

## Configuration (Vite env vars; all optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `` (same origin) | REST API base URL |
| `VITE_WS_URL` | derived from location | WebSocket endpoint |
| `VITE_ACCOUNT_ID` | `ACC-001` | Initial account (editable in the header) |
| `VITE_QUOTE_POLL_MS` | `5000` | Watchlist quote polling interval |
| `VITE_STALE_MS` | `10000` | Staleness window (mirrors backend `price_max_age`) |

## Checks

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test
npm run build
```
