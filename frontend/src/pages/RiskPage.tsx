/**
 * Risk Management workspace (FE-M8).
 *
 * Data model: this page is a PROJECTION of state the terminal already holds —
 * `accountStore` (equity / exposure / P&L / kill switch), `positionsStore`,
 * `riskStore` (live gate rejections) and `brokersStore`. It issues no request
 * of its own and opens no socket; `useTerminal` performs every fetch on login,
 * reconnect, account switch and after fills. That keeps one authoritative read
 * path (ADR-016) and prevents a second, divergent source of truth.
 *
 * Honesty contract (the reason this module exists):
 *  - The eight pre-trade rules are ENFORCED server-side on every order. This
 *    page reports that fact; it never performs or relaxes a check.
 *  - Thresholds are NOT readable through the API, so they show "Not exposed".
 *    No default is invented and no edit control is offered.
 *  - Metrics with no data behind them (drawdown, margin, VaR, leverage) are
 *    listed as "Not reported" WITH the reason, instead of a plausible number.
 *  - The only writable control is the kill switch, which has a real endpoint
 *    and a readable state.
 *
 * Design source: Figma Make `u7bqch89fB2Z6UtUbHSVB3` (`src/App.tsx:207`,
 * `RiskScreen`). Figma access was read-only and text-only, so fidelity is
 * STRUCTURAL: the prototype's page header, the four metric tiles, "Risk
 * metrics" table, "Risk limits" list, risk-alert rows and pre-trade check are
 * all preserved as regions. Tile/column CONTENT is substituted wherever the
 * prototype shows figures this platform cannot source (drawdown, margin level,
 * VaR, max drawdown, leverage) — each substitution is labelled in the UI.
 */

import { Panel } from "../components/Panel";
import { useStoreState } from "../stores/store";
import { brokersStore, uiStore } from "../stores";
import { KillSwitchControl } from "../features/risk/KillSwitchControl";
import { PositionRiskCard } from "../features/risk/PositionRiskCard";
import { RiskLimitsCard } from "../features/risk/RiskLimitsCard";
import { RiskMetricsCard } from "../features/risk/RiskMetricsCard";
import { RiskOverviewCards } from "../features/risk/RiskOverviewCards";
import { RiskTestPanel } from "../features/risk/RiskTestPanel";
import { RiskViolationsCard } from "../features/risk/RiskViolationsCard";

interface BackendGap {
  capability: string;
  effect: string;
  requiredWork: string;
}

/**
 * Capabilities this page cannot provide because the backend does not expose
 * them. Stated in the product, not only in a commit message.
 */
const BACKEND_GAPS: readonly BackendGap[] = [
  {
    capability: "Readable risk limits",
    effect:
      "Every threshold in “Risk limits” reads “Not exposed”. The rule set and its enforcement are real; the configured numbers are not readable.",
    requiredWork:
      "GET /api/v1/accounts/{id}/risk/limits with permission risk:read, returning the RiskLimits fields (max_order_quantity, position_limit, max_notional_exposure, max_daily_orders, max_daily_loss, require_available_funds, trading_window) plus their currency/units.",
  },
  {
    capability: "Limit utilisation / remaining capacity",
    effect:
      "Utilisation cannot be computed without both the threshold and the current measured value in a matching unit.",
    requiredWork:
      "The limits endpoint above plus a current-measurement endpoint (e.g. per-rule observed value: today's order count, daily realized loss, net position per instrument) so utilisation is a server fact rather than a frontend guess.",
  },
  {
    capability: "Persisted violation history and acknowledgement",
    effect:
      "The alerts list is session-only and newest-first; it disappears on reload. There is no severity field and no resolution state.",
    requiredWork:
      "A persisted risk-event store plus GET /risk/violations (filter, paginate) and POST /risk/violations/{id}/acknowledge with an audit trail. The current risk.violation payload carries account_id, instrument, rule, message and order only.",
  },
  {
    capability: "Margin and leverage",
    effect:
      "Used/available margin, margin level and leverage are “Not reported”. `AccountSummaryOut` carries equity and exposure only.",
    requiredWork:
      "Broker-reported margin balances plus per-instrument margin requirements in the account/position contracts, with an explicit account currency so ratios are well-defined.",
  },
  {
    capability: "Drawdown and VaR",
    effect:
      "Daily drawdown, max drawdown and VaR are “Not reported”. No equity time series or start-of-day equity exists anywhere in the API.",
    requiredWork:
      "Persisted equity snapshots (start-of-day and periodic) and a valuation series; VaR additionally needs a historical return window and a documented methodology.",
  },
  {
    capability: "Protective-stop display / risk-to-stop",
    effect: "No stop level is shown for any position, and risk-to-stop is not estimated.",
    requiredWork:
      "A position→protective-order linkage (or a `protective_orders` field on the position read model) plus contract specifications (multiplier, tick value) and FX conversion for a cross-currency risk figure.",
  },
  {
    capability: "Editable risk configuration",
    effect: "No edit control is rendered; no frontend-only rule is ever stored.",
    requiredWork:
      "PUT /api/v1/accounts/{id}/risk/limits with permission risk:admin, server-side validation of every field, optimistic-concurrency (ETag/version) and an audit record — then a form with save/cancel/pending/error states.",
  },
  {
    capability: "Account-level timestamps",
    effect:
      "The summary, positions and kill-switch responses carry no `as_of`, so this page cannot state when a figure was measured; connection state is the only freshness signal.",
    requiredWork: "An `as_of` timestamp on AccountSummaryOut and PositionOut (broker mark time).",
  },
];

export function RiskPage() {
  const { accountId } = useStoreState(uiStore);
  const { brokers, loadState: brokersState } = useStoreState(brokersStore);

  const brokerLabel =
    brokers.length === 0
      ? brokersState === "loading"
        ? "loading broker status…"
        : "broker not reported"
      : brokers
          .map((broker) => `${broker.name} (${broker.connected ? "connected" : "disconnected"})`)
          .join(" · ");

  return (
    <div className="workspace risk-page">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Platform · {accountId}</p>
          <h1>Risk Management</h1>
          <p className="page-subtitle">
            Pre-trade enforcement, live gate rejections and position exposure for {accountId}.
            Enforcement is server-side; this workspace observes it and cannot weaken it.
          </p>
        </div>
        <div className="title-actions">
          <span
            className="badge badge-muted"
            title="Account/broker context. The risk endpoints return no timestamp, so no measurement time can be shown."
          >
            {brokerLabel}
          </span>
        </div>
      </section>

      <section className="risk-context" aria-label="Data provenance">
        <p className="state-detail">
          <b>Scope and provenance.</b> Figures below are account-scoped (the selected account only)
          and come from the terminal&apos;s existing read models —{" "}
          <code>GET /accounts/&#123;id&#125;/summary</code>, <code>/positions</code> and{" "}
          <code>/risk/kill-switch</code>. Nothing is aggregated across accounts or currencies, and
          no value is fabricated when a request fails: it renders as “—” with the reason. The API
          reports no per-response timestamp, so freshness is bounded by the live connection state
          rather than asserted.
        </p>
      </section>

      <RiskOverviewCards />

      <div className="risk-grid">
        <RiskMetricsCard />
        <Panel
          title="Emergency controls"
          subtitle="The only risk control with a readable and writable state in this API"
        >
          <KillSwitchControl />
          <ul className="markets-notes-list risk-notes">
            <li>
              <b>Real and enforced.</b> The flag is stored in the risk engine and checked on every
              order evaluation; <code>GET</code>/
              <code>POST /accounts/&#123;id&#125;/risk/kill-switch</code> require{" "}
              <code>risk:read</code> / <code>risk:admin</code>.
            </li>
            <li>
              <b>It only blocks new orders.</b> It does not cancel working orders, close positions
              or liquidate anything — this platform performs none of those actions automatically,
              and this page offers no such button.
            </li>
            <li>
              <b>Activation asks for confirmation</b> and the result is discarded if you switch
              account mid-request, so the badge can never describe a different account.
            </li>
          </ul>
        </Panel>
      </div>

      <RiskLimitsCard />

      <div className="risk-grid">
        <RiskViolationsCard />
        <RiskTestPanel />
      </div>

      <PositionRiskCard />

      <Panel
        title="Not supported by this backend"
        subtitle="Exact gaps behind every “Not reported”, “Not exposed” or missing control on this page"
      >
        <div className="table-scroll">
          <table className="data-table risk-gap-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Effect on this page</th>
                <th scope="col">Required backend work</th>
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
            <b>Informational on this page:</b> the rule catalogue, every metric, every exposure
            figure and the alert list. They REPORT what the server does or reports.
          </li>
          <li>
            <b>Enforced by the backend:</b> the eight pre-trade rules and the kill switch, applied
            to every <code>POST /orders</code> by <code>RiskGatedExecutor</code>. A rejection is
            returned as an explainable decision (<code>422</code> with per-rule results) and cannot
            be bypassed from the browser.
          </li>
          <li>
            <b>No automatic action exists here:</b> this page never cancels, closes, liquidates,
            disables a strategy or changes a live setting. The single write it can perform is the
            kill switch, after confirmation.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
