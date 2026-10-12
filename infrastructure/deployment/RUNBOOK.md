# Deployment Runbook (M15 — Production Infrastructure)

Operational documentation for deploying, monitoring, and recovering the
Multi-Broker Trading Engine. Development uses `docker-compose.yml` (memory
repositories, plain HTTP); **production uses `docker-compose.prod.yml`**.

## Architecture

```text
            :8443 (TLS)
                |
          nginx proxy (infrastructure/nginx/nginx.conf)
          |  rate limiting, TLS termination, HSTS
          |  forwards ONLY /api, /ws, /ready  (never /metrics or /docs)
    +-------+-------------------+
    |       |                   |
  /api /ws              /  (static terminal bundle)
    |                   |
 backend:8000       frontend:8080 (unprivileged nginx, CSP)
    |
 postgres:5432  (orders volume: postgres_data)
```

- **Only the proxy is exposed.** Backend, frontend, and PostgreSQL live on
  the internal compose network — direct access from the host network is
  impossible.
- **Persistence (ADR-010/020):** the backend starts with
  `ORDER_REPOSITORY=postgres` and the SQLAlchemy async URL; orders survive
  backend restarts and are visible to the OMS on startup. Portfolio and
  auth-session state stay in-memory BY DESIGN (ADR-013: portfolio rebuilds
  from broker reconciliation; sessions are short-lived — users re-login
  after a backend restart; access JWTs stay valid across restarts because
  the signing secret is stable).
- **Startup ordering:** postgres healthcheck → backend (`initialize()`
  creates missing tables, fail-fast on unreachable DB) → broker feed
  connects → uvicorn serves. `/ready` reports `database: ok` only when the
  DB answers `SELECT 1`.
- **Graceful shutdown:** SIGTERM → uvicorn stops accepting, in-flight
  requests drain, the broker feed disconnects (publishing
  `broker.disconnected`), then the DB engine is disposed. `stop_grace_period`
  is 30 s.

## Prerequisites

- Docker Engine with compose v2, OpenSSL (for staging certs).
- A `.env` file (gitignored) in the repository root with AT LEAST:

```dotenv
POSTGRES_PASSWORD=<strong password>
JWT_SECRET_KEY=<random >=32 bytes>     # e.g. from: openssl rand -base64 48
AUTH_DEMO_TRADER_PASSWORD=<password>  # or AUTH_USERS_FILE for real accounts
AUTH_DEMO_ADMIN_PASSWORD=<password>
HTTPS_PORT=8443
```

## Deploy from scratch

```bash
# 1. TLS certificates (staging only — production mounts real certs)
./scripts/generate_tls_certs.sh          # or the .ps1 on Windows

# 2. Build and start the whole stack
docker compose -f docker-compose.prod.yml up -d --build

# 3. Watch it become ready
docker compose -f docker-compose.prod.yml logs -f backend   # JSON logs
curl -k https://localhost:8443/ready
#   -> {"status":"ready","broker":"IBKR","database":"ok"}

# 4. Smoke the full surface through the proxy
#    (REST + auth + WS; see "Validation checklist" below)
```

## Validation checklist (post-deploy)

| Check | Command / expectation |
| --- | --- |
| Frontend served | `curl -k https://localhost:8443/` → terminal HTML with CSP header |
| Redirect to TLS | `curl -I http://localhost:8443/` → `301 https` |
| REST auth | unauthenticated `GET /api/v1/health` → 401 |
| Login | `POST /api/v1/auth/login` → token pair |
| Authenticated REST | `GET /api/v1/orders` with bearer → `200` + `Cache-Control: no-store` |
| WebSocket | ticket then `wss://localhost:8443/ws?...&ticket=...` → hello |
| Metrics NOT public | `GET /metrics` through the proxy → **404** (not forwarded) |
| Docs NOT public | `GET /docs` → 404 |
| Health | `GET /ready` → `database: "ok"`, `status: "ready"` |

## Monitoring

- **Logs:** backend emits single-line JSON (`LOG_FORMAT=json`): engine
  events, auth audit trail, risk rejections — identifiers only, never
  credentials (M12/M14 guarantees). `docker compose logs` or ship the
  json-file logs (rotation: 10 MB × 5 per container).
- **Health:** `/ready` (public through the proxy) reports broker AND
  database state; container healthchecks drive `restart: unless-stopped`.
- **Metrics:** authenticated `GET /api/v1/metrics` (in-cluster only) —
  order-lifecycle counters, risk violations, broker connection state,
  WS client count, active sessions, uptime. No account/user identifiers.
- **Broker state:** `broker.connected` / `broker.disconnected` events are
  visible on the WS stream and in the metrics counters; adapter
  reconnection behavior is automatic (M8/M9).

## Backup / recovery

```bash
./scripts/backup_db.sh                 # -> backups/mtbe-orders-<UTC>.sql.gz
docker compose -f docker-compose.prod.yml stop backend
./scripts/restore_db.sh backups/mtbe-orders-<UTC>.sql.gz
docker compose -f docker-compose.prod.yml start backend
```

Backups are plain `pg_dump` output — restorable into any PostgreSQL 16
instance. The orders table is the persisted state; portfolio positions are
reconciled from the broker on startup (ADR-013).

## Restart / failure behavior

| Scenario | Behavior | Verified |
| --- | --- | --- |
| Backend crash/restart | `restart: unless-stopped`; orders reload from PostgreSQL; access JWTs stay valid (stable secret); users re-login (sessions in-memory) | M15 deployment tests |
| PostgreSQL restart | backend healthcheck fails → `/ready` reports `database: unavailable`/`status: starting`; engine keeps serving from memory; recovers automatically | M15 deployment tests |
| Broker connection drop | adapter reconnect + state replay (M8/M9), `broker.disconnected/connected` events; reconcile() re-syncs outstanding orders | M13 suites |
| WebSocket drop | terminal reconnects with a fresh ticket and REST-resyncs (ADR-016/018) | M13 suites |
| Missing required secret | compose refuses to start (fail-fast interpolation) | M14/M15 checks |
| Invalid configuration | backend exits at startup with a typed message (e.g. `ORDER_REPOSITORY=postgres requires DATABASE_URL`) | M15 checks |

## Production hardening reminders

- Mount CA-issued certificates in production; the self-signed script is for
  staging only. Never commit certs (gitignored).
- Set `API_DOCS_ENABLED=false` (default) in production.
- `JWT_SECRET_KEY` must be ≥32 bytes (RFC 7518, enforced) and stable across
  restarts (or every session is invalidated on deploy).
- Broker credentials (when real transports arrive, ADR-014/015) come from
  the environment/compose secrets — never from the repo or image layers
  (.dockerignore excludes `.env`).
- Edge rate limiting (nginx `limit_req`, M15) complements the in-process
  M14 login throttle; distributed-layer protections arrive with a shared
  infrastructure provider (documented in ADR-019).

## Rollback

Deployments are image-tagged and state is PostgreSQL — rollback is
"previous image + restore the matching backup":

```bash
# 1. Stop the app tier (keep postgres running for the restore)
docker compose -f docker-compose.prod.yml stop backend proxy frontend

# 2. Restore the pre-deploy backup (idempotent pg_dump --clean output)
./scripts/restore_db.sh backups/mtbe-orders-<UTC>.sql.gz

# 3. Redeploy the previous image tag and bring the stack back
docker compose -f docker-compose.prod.yml up -d
```

Notes:

- Container images are rebuildable from the repository at any commit
  (`docker compose -f docker-compose.prod.yml build`); pin production
  images by tagging (`docker tag <img> mtbe-backend:<version>`) before
  deploying so the previous version is always one tag away.
- The orders schema is create-only (`create_all`); a rollback to an
  OLDER backend image is safe — newer columns are simply ignored by
  SQLAlchemy only if models tolerate them. For schema-affecting changes,
  restore the matching backup (the documented procedure) rather than
  mixing image versions across schema changes.
- JWT secret rotation (change `JWT_SECRET_KEY` + recreate the backend)
  invalidates all outstanding tokens — every user re-logs in. Orders
  persist; sessions are in-memory by design (ADR-020).
