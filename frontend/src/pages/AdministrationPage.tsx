/**
 * Administration (FE-M11) — the Figma Make "Administration" screen.
 *
 * The prototype shows a user-management table (name, email, role, status, last
 * login) with an "Add user" action, and its own copy admits the demo: "requires
 * a connected authentication service". The backend here has NO user-management
 * API at all — no list, no detail, no activation, no role assignment, no audit
 * trail, no administrative statistics (verified against `backend/api/*`: the
 * only identity endpoints are login, refresh, logout, me, ws-ticket).
 *
 * So this screen shows what the API REALLY discloses about authorization —
 * the caller's own principal and session, plus a labelled reference for what
 * each permission grants (compiled from the backend routes) — and states every
 * administrative operation the backend does not support. It never renders a
 * fabricated user directory, role table or activity feed.
 *
 * The administrative section is gated on the backend-defined `admin` role. That
 * gate is UX only: there is no admin endpoint for it to protect, and the only
 * administrative permission that exists (`risk:admin`, for the kill switch) is
 * enforced server-side on its own route (Risk Management screen).
 */

import { Panel } from "../components/Panel";
import { EmptyState } from "../components/Status";
import { authService, canAdminRisk } from "../services/auth";
import { authStore, userIsAdmin } from "../stores/authStore";
import { useStoreState } from "../stores/store";
import { formatTimestamp } from "../utils/time";

/**
 * Display labels for the permissions the backend defines (mirror of
 * `backend/api/security.py::ROLE_PERMISSIONS`, each verified against the route
 * that enforces it). Rows are rendered ONLY for permissions the server actually
 * sent; an unknown permission shows its raw string instead of a guessed label.
 */
const PERMISSION_LABELS: Record<string, string> = {
  "orders:read": "Read orders and executions (the whole order resource is read-scoped)",
  "orders:write": "Submit, modify and cancel orders — always through the risk gate",
  "positions:read": "Read positions and per-position P&L",
  "account:read": "Read balances and account summaries",
  "market:read": "Read market quotes",
  "risk:read": "Read risk state and kill-switch status",
  "risk:admin": "Activate/deactivate the kill switch (privileged)",
  "brokers:read": "Read broker connectivity",
};

interface AdminGap {
  capability: string;
  effect: string;
  requiredWork: string;
}

/** Administrative operations this backend does not support. */
const BACKEND_GAPS: readonly AdminGap[] = [
  {
    capability: "User directory (list / search / filter / paginate)",
    effect:
      "No user table is rendered. There is no endpoint that lists users, so any row count, registration trend or 'last login' would be invented.",
    requiredWork:
      "GET /api/v1/admin/users?query=&role=&status=&page= returning sanitized records only (subject, roles, accounts, status, created_at) — never password hashes — with server-side pagination and a total count.",
  },
  {
    capability: "User detail & registration timestamps",
    effect:
      "Only the signed-in principal can be inspected (GET /auth/me). Provisioned records carry no created_at/updated_at, so no registration date can be shown even for that user.",
    requiredWork:
      "Timestamps on the user record, plus GET /api/v1/admin/users/{subject} that enforces the admin permission.",
  },
  {
    capability: "Activate / deactivate / suspend accounts",
    effect:
      "No status field exists and no write endpoint does. Deactivating an account must also revoke its sessions; nothing to call.",
    requiredWork:
      "A user status field, PATCH /api/v1/admin/users/{subject} (status) with validation, session revocation on deactivation, and an audit entry per change.",
  },
  {
    capability: "Roles & permissions administration",
    effect:
      "No role catalogue, no per-role permission view and no role assignment. The matrix lives in backend code and the API does not serve it; this page lists only the caller's own permissions.",
    requiredWork:
      "GET /api/v1/admin/roles (roles + their permission sets), PUT /api/v1/admin/users/{subject}/roles, and a guard that refuses to remove the caller's own last administrative role.",
  },
  {
    capability: "Password change / reset / MFA",
    effect:
      "No password workflow and no MFA. Users are provisioned from a JSON file of PBKDF2 hashes (or at startup); raw passwords are never stored, so the frontend cannot and must not write them.",
    requiredWork:
      "POST /api/v1/auth/password (current password required, policy-checked, rehash server-side), a reset flow with delivery, and MFA enrolment/verification endpoints before any MFA UI is built.",
  },
  {
    capability: "Session listing & revocation",
    effect:
      "The token service tracks sessions in memory but exposes no list, and revocation only works with that session's own refresh token. This terminal can end its OWN session (Log out) and nothing else.",
    requiredWork:
      "GET /api/v1/auth/sessions (current user, no token material) + DELETE /api/v1/auth/sessions/{sid}, and an admin-scoped equivalent for other users.",
  },
  {
    capability: "Audit log / administrative activity",
    effect:
      "Nothing to display. Login, logout and kill-switch events are structured log lines only; they are not stored in a queryable audit table and no endpoint returns them.",
    requiredWork:
      "An append-only audit store written on every privileged operation, with GET /api/v1/admin/audit?from=&to=&actor=&category=&outcome= plus pagination; read-only for every role, never deletable through the API.",
  },
  {
    capability: "Administrative statistics",
    effect:
      "No user counts, registration trends or admin dashboard — no endpoint provides them. GET /metrics exists but is NOT admin-gated (any authenticated principal can read infrastructure counters), so it is an operator surface, not an administrative one, and is not presented here as admin data.",
    requiredWork:
      "GET /api/v1/admin/stats (users total/active, per-role counts, broker connection state) restricted to the admin role, and a permission check on /metrics if it should stay operator-only.",
  },
  {
    capability: "Application-level settings & feature flags",
    effect:
      "No global settings surface. Configuration is environment/startup (`backend/config/settings.py`) and changing it requires a restart.",
    requiredWork:
      "An authenticated, audited settings resource with server-side validation and change history, and an explicit list of flags the runtime reads per request.",
  },
];

export function AdministrationPage() {
  const { user } = useStoreState(authStore);
  const isAdmin = userIsAdmin();
  const expiry = authService.getSessionExpiry();
  const permissions = user?.permissions ?? [];

  return (
    <div className="workspace administration-page">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Platform · Administration</p>
          <h1>Administration</h1>
          <p className="page-subtitle">
            The authorization state of this session, and every administrative capability the backend
            does not expose. No user directory is shown because none exists to read.
          </p>
        </div>
      </section>

      <section className="risk-context" aria-label="Data provenance">
        <p className="state-detail">
          <b>Scope and provenance.</b> Identity and permission data come from{" "}
          <code>GET /api/v1/auth/me</code> (the same record the login response carries). The
          capability notes describe the backend as implemented — no administrative endpoint exists
          beyond authentication and the risk kill switch.
        </p>
      </section>

      <Panel
        title="Current principal"
        subtitle="The only user record this API discloses — your own"
      >
        <dl className="facts-grid">
          <div>
            <dt>Subject</dt>
            <dd>
              <code>{user?.subject ?? "unknown"}</code>
            </dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd>
              {user && user.roles.length > 0 ? (
                user.roles.map((role) => (
                  <span key={role} className="badge badge-info">
                    {role}
                  </span>
                ))
              ) : (
                <span className="cell-muted">none</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Account scope</dt>
            <dd>
              {user === null ? (
                <span className="cell-muted">unknown</span>
              ) : user.accounts.includes("*") ? (
                <>
                  <span className="badge badge-muted">*</span> All accounts — the wildcard is
                  reserved for the admin role by the identity store
                </>
              ) : (
                user.accounts.join(", ")
              )}
            </dd>
          </div>
        </dl>

        <h3 className="section-title">Effective permissions</h3>
        {permissions.length === 0 ? (
          <EmptyState
            message="This session holds no permissions."
            detail="Every endpoint would answer 403; the terminal is read-only by default."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table permissions-table">
              <thead>
                <tr>
                  <th scope="col">Permission</th>
                  <th scope="col">Grants in this terminal</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr key={permission}>
                    <td>
                      <code>{permission}</code>
                    </td>
                    <td>
                      {PERMISSION_LABELS[permission] ?? (
                        <span className="cell-muted">
                          No display label mapped for this permission — shown as reported.
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ul className="markets-notes-list risk-notes">
          <li>
            <b>Derived, not decided, here.</b> Roles and permissions come from the server; the
            frontend computes none of its own. Hiding a control is UX only — every endpoint
            re-checks the permission and the account scope server-side.
          </li>
          <li>
            <b>Privileged action in this build:</b>{" "}
            {canAdminRisk(user)
              ? "your session may activate the kill switch (risk:admin) — the control lives on the Risk Management screen."
              : "none from this page; risk:admin is not in your permission set."}
          </li>
        </ul>
      </Panel>

      <Panel title="Session" subtitle="Read-only facts about this signed-in session">
        <dl className="facts-grid">
          <div>
            <dt>Signed in as</dt>
            <dd>{user?.subject ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Access token expires</dt>
            <dd>
              {expiry === null
                ? "unknown"
                : `${formatTimestamp(new Date(expiry).toISOString())} (browser local time)`}
            </dd>
          </div>
          <div>
            <dt>Sign out</dt>
            <dd>
              The <b>Log out</b> control in the header calls <code>POST /api/v1/auth/logout</code>,
              which revokes this session server-side; local tokens are dropped even if that call
              fails.
            </dd>
          </div>
        </dl>
        <ul className="markets-notes-list risk-notes">
          <li>
            <b>One visible session.</b> An access token lives one hour; a refresh token rotates on
            every refresh and presenting a superseded one revokes the session. Tokens are held in
            memory only and are never rendered or persisted.
          </li>
          <li>
            <b>Other sessions cannot be listed or revoked.</b> The token service tracks them
            in-memory but exposes no endpoint; the gap table below records the required API.
          </li>
        </ul>
      </Panel>

      <Panel
        title="Administrative workspace"
        subtitle={
          isAdmin
            ? "What an administrator can actually do in this build"
            : "Restricted to the admin role — nothing to disclose in this build"
        }
      >
        {isAdmin ? (
          <>
            <EmptyState
              message="No administrative operation is available in this build."
              detail="The identity store is loaded from a JSON users file (PBKDF2 hashes) or provisioned at startup and held in memory. It has no CRUD API, no timestamps and no status field — so there is no user to create, activate, suspend or re-role. The kill switch (risk:admin) is the only privileged operation in the API, and it lives on the Risk Management screen."
            />
            <ul className="markets-notes-list risk-notes">
              <li>
                <b>Compiled from backend source, not from an endpoint:</b> identity records (
                <code>api/auth.py</code>), the fixed role → permission matrix (
                <code>api/security.py</code>) and session handling (<code>api/tokens.py</code>). No
                API serves these, so they can drift from what is shown elsewhere on this page — the
                rows above always reflect the live <code>/auth/me</code> response.
              </li>
              <li>
                <b>Audit trail:</b> privileged actions are structured log lines (
                <code>auth_login_success</code>, <code>auth_login_failed</code>,{" "}
                <code>auth_session_revoked</code>, <code>risk_kill_switch_set</code>). Nothing is
                queryable from the terminal, so no activity feed is shown.
              </li>
            </ul>
          </>
        ) : (
          <EmptyState
            message={`Administrator access required. This session holds the role(s): ${
              user && user.roles.length > 0 ? user.roles.join(", ") : "none"
            }.`}
            detail="The user directory, role editor and audit trail are administrator functions. None of them is implemented by this backend, so nothing is withheld from you here — the gap table below states what an administrator would need. The gate is UX only; every server operation re-checks permissions on its own."
          />
        )}
      </Panel>

      <Panel
        title="Not supported by this backend"
        subtitle="Exact gaps behind every missing administrative control or figure"
      >
        <div className="table-scroll">
          <table className="data-table gap-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Effect on This Page</th>
                <th scope="col">Required Backend Work</th>
              </tr>
            </thead>
            <tbody>
              {BACKEND_GAPS.map((gap) => (
                <tr key={gap.capability}>
                  <td>
                    <span className="cell-primary">{gap.capability}</span>
                  </td>
                  <td>{gap.effect}</td>
                  <td>{gap.requiredWork}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="markets-notes-list risk-notes">
          <li>
            <b>Informational on this page:</b> the principal, its roles, account scope and
            permissions, and the session expiry. They report what the server issued.
          </li>
          <li>
            <b>Never rendered:</b> password hashes, access or refresh tokens, WebSocket tickets, or
            any credential — the API never returns them and this page reads nothing else.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

export { AdministrationPage as default };
