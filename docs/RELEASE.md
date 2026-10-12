# Release Record — Multi-Broker Trading Engine

**Milestone:** M17 — Production Readiness (final planned milestone)
**Date:** 2026-10-12
**Decision:** **PRODUCTION READY** — for the validated scope: the deployable,
production-shaped platform running simulated/paper broker adapters.

This record is the signed-off release state per the M17 completion criteria.

---

## Scope of the readiness claim

The platform — core engine, risk, market data, OMS, execution, portfolio,
IBKR/Saxo adapters (simulated transports), API gateway (REST + WS),
authentication/authorization, React terminal, PostgreSQL order persistence,
TLS-edge deployment, CI/CD, and operational tooling — is validated end to end
against the **simulated broker clients** in a production-like deployed stack.
The project's roadmap never included live trading during development;
paper/sim validation is the mandated posture (ROADMAP, ADR-014/015).
Real-broker transports and real-money operation require the checklist below.

## Evidence summary

| Area | Evidence |
| --- | --- |
| Full regression | 695/695 backend (incl. 8 live-PostgreSQL persistence tests, 56 dual-broker in-process full-stack, security suites); 116/116 frontend; ruff/mypy(strict)/tsc/ESLint(9)/Prettier/build clean; npm + pip-audit 0 vulnerabilities |
| Live-stack E2E (M16) | 34/34 evidence records PASS on **IBKR** AND 34/34 on **SAXO** — the identical scenario suite on the deployed mtbe-prod stack (`tests/e2e/artifacts/`) |
| Deployment (M15/M17) | From-scratch deploy via the documented RUNBOOK, re-validated in M17; readiness (broker + database), TLS edge, persistence across backend restarts, backup/restore round-trip |
| Operational procedures (M17) | Startup/shutdown (SIGTERM exit 0)/restart, broker reconnect behavior, database restart degradation + recovery, application recovery, JWT secret rotation (old tokens 401, fresh login 200), log inspection (JSON), health monitoring (/ready + authenticated /metrics), backup, restore, rollback procedure, incident handling (kill switch documented) |
| Security | M12 authN/Z suites + M14 hardening suites re-run green; boundaries re-verified live (401/tampered/viewer-403/IDOR-403/WS-4403/edge-404s); M17 tracked-file secrets scan clean (one documentation finding fixed); `.env`/certs/backups gitignored; the automated repository secrets guard ships in the suite |
| Trading integrity | Risk gate unbypassable (E2E); duplicate orders/executions safe (replay + dedup across restart); positions/P&L consistent with independent exact-decimal recomputation; reconciliation via M5; restart-safe persisted orders; stale-data never-silently-zero; broker failures fail safe; account boundaries held everywhere |
| CI/CD | 5-job pipeline: backend quality, PostgreSQL-service persistence job, frontend quality, container/compose builds, dependency audits |

## M0–M16 verification

Every milestone has implementation evidence, executed tests, and recorded
results in `docs/TEST_STATUS.md` (29+ test reports) and `docs/CHANGELOG.md`;
the milestone table in `docs/PROJECT_STATUS.md` is all ✅. Architectural
decisions are recorded as ADR-001…021. No unresolved critical dependency.

## Pre-real-money operation checklist (MUST be completed before live trading)

The following were explicitly deferred by ADR-014/015 and the roadmap, and
**must** be validated before any real-money operation:

1. **Real broker transports** — implement the ibapi/ib_insync-backed
   `IbkrClient` and the OpenAPI-backed `SaxoClient` behind the existing
   transport ports (adapters, mapping, and core are transport-ready and
   unchanged by this work).
2. **Controlled paper/sandbox validation** — connect to IBKR paper and the
   Saxo sim environment; re-run the M13 in-process suites and the M16 live
   E2E suites against the real transports.
3. **Credential provisioning** — broker credentials via environment/secret
   store only (never committed; `.dockerignore` and the secrets guard
   already enforce this).
4. **CA-issued TLS certificates** — replace the staging self-signed certs
   mounted at the edge.
5. **Rehearsed incident response** — kill-switch drill, broker-disconnect
   drill, and restore drill with the production credentials and runbook.
6. **External legal/compliance review** of the deployment (jurisdiction
   dependent; out of engineering scope).

## Remaining risks & classification

**Release blockers:** none.

**High risk:** none within the validated scope.

**Medium/low risk + known limitations (documented, accepted):**
- Real broker transports deferred (ADR-014/015) — the pre-checklist above.
- External sandbox/paper validation deferred — no credentials exist in the
  development environment; simulated-client evidence stands in.
- In-memory portfolio and auth-session state (ADR-013/020, by design):
  portfolio rebuilds from broker reconciliation; sessions are short-lived —
  users re-login after backend restarts; access JWTs survive restarts.
- Distributed rate limiting / shared-infrastructure throttling (M15 edge
  `limit_req` + M14 in-process throttles exist; multi-node shared state is
  future).
- High availability / multi-node deployment: single-instance posture.
- Browser-automation E2E (Playwright): unavailable in the headless validation
  environment; terminal coverage is the in-process App flow test + live HTTP
  verification.
- Performance: smoke-validated regression gates only; full load testing is
  future scope.
- PostgreSQL migrations: create-only today; schema evolution uses the
  backup/restore procedure (runbook).

**Future enhancements:** real transports (checklist item 1), subscribe-API
endpoint (M11-documented gap), Prometheus metrics export, cookie-based
session persistence, multi-node HA, multi-broker runtime routing.

## Recommended immediate operational steps after release

1. Deploy via the RUNBOOK to the target host; mount CA certificates; set
   `APP_ENV=production`, strong `POSTGRES_PASSWORD` +
   `JWT_SECRET_KEY` (≥32 bytes), and provision real users via
   `AUTH_USERS_FILE` (never demo users in production).
2. Verify `GET /ready` reports `{"status":"ready","database":"ok"}` and take
   the first backup (`scripts/backup_db.sh`).
3. Run a kill-switch drill (activate → confirm 422 rejections → deactivate).
4. Schedule daily backups and periodically verify restores.
5. Monitor via the authenticated in-cluster `/metrics` and the JSON
   application logs; alert on `"broker_disconnects_total"` growth and
   `/ready` leaving `ready`.
6. Begin the pre-real-money checklist (above) before connecting any real
   broker transport.
