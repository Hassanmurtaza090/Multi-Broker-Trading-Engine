# Frontend

React 18 + TypeScript trading terminal (Vite) for the Multi-Broker Trading
Engine. Presentation-only: it consumes the M10 gateway over REST (`/api/v1`)
and WebSocket (`/ws`) and holds no business, risk, or broker logic.
See `../docs/ARCHITECTURE.md` (Trading Terminal Architecture) and
`../docs/DECISIONS.md` (ADR-017).

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

Start the backend first (simulated broker stack, no live trading):

```bash
cd ../backend
python main.py     # serves http://127.0.0.1:8000 (docs at /docs)
```

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
