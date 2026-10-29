/**
 * Risk limits panel (FE-M8).
 *
 * This is the heart of the honesty requirement for this module:
 *
 * - ENFORCEMENT IS REAL AND SERVER-SIDE. Every `POST /api/v1/orders` is routed
 *   through `RiskGatedExecutor.submit` → `RiskEngine.evaluate` → the eight
 *   rules in `backend/risk/rules.py` (verified in the backend source and its
 *   test suite). The UI cannot bypass it and does not perform the check.
 * - THE THRESHOLDS ARE NOT READABLE. They are `RiskLimits` configuration
 *   (`backend/risk/policy.py`) with no read endpoint, so this panel reports the
 *   rule set and says "not exposed" for each threshold. It never invents a
 *   limit, and it never offers an edit control it could not save.
 * - ONE RULE HAS A VISIBLE STATE: the kill switch. That is a real boolean
 *   exposed by `GET /accounts/{id}/risk/kill-switch`, so it is shown live.
 */

import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import { accountStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { RISK_RULES } from "./riskMetrics";

export function RiskLimitsCard() {
  const { killSwitchActive, killSwitchState } = useStoreState(accountStore);

  return (
    <Panel
      title="Risk limits"
      subtitle="Enforced by the risk gate on every order submission — thresholds are server configuration"
    >
      <div className="table-scroll">
        <table className="data-table risk-limits-table">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Blocks</th>
              <th scope="col">Configured threshold</th>
            </tr>
          </thead>
          <tbody>
            {RISK_RULES.map((rule) => (
              <tr key={rule.rule}>
                <td>
                  <code>{rule.rule}</code>
                </td>
                <td>{rule.enforces}</td>
                <td>
                  {rule.limitField === null ? (
                    // The kill switch is the only configured value the API exposes.
                    killSwitchState === "loading" || killSwitchState === "idle" ? (
                      <span className="badge badge-muted">Loading…</span>
                    ) : killSwitchActive === null ? (
                      <span className="badge badge-muted">Unavailable</span>
                    ) : (
                      <StatusBadge
                        tone={killSwitchActive ? "danger" : "ok"}
                        label={killSwitchActive ? "Active (orders halted)" : "Inactive"}
                      />
                    )
                  ) : (
                    <span className="risk-limit-unexposed">
                      <span className="badge badge-muted">Not exposed</span>
                      <code>{rule.limitField}</code>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="markets-notes-list risk-notes">
        <li>
          <b>Enforcement is not up for debate.</b> The gate runs on the server for every order —
          manual or automated — and a rejection is returned as an explainable decision. This page
          only observes; it cannot enable, disable or weaken a rule.
        </li>
        <li>
          <b>Thresholds are configuration, not data.</b> Each limit is a field on the backend's
          <code> RiskLimits</code> object, loaded from environment configuration. There is no read
          endpoint for it, so every value here says “Not exposed” rather than a guess. Exposing them
          (<code>GET /accounts/&#123;id&#125;/risk/limits</code>, permission <code>risk:read</code>)
          is the single backend change that would turn this table into real numbers.
        </li>
        <li>
          <b>Read-only by design.</b> No edit control is rendered because no write endpoint exists.
          A form that appeared to save a limit the engine does not read would be worse than no form.
        </li>
      </ul>
    </Panel>
  );
}
