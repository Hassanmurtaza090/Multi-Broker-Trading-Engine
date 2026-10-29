/**
 * Risk panel (M11): the M6 kill switch control (confirmed, error-safe) and
 * the live risk-violation feed (TS-009 audit visibility).
 *
 * The toggle never pretends success: on API failure the store keeps its prior
 * value and the error is surfaced. Risk enforcement lives ONLY on the server
 * (M6); this control merely drives it.
 *
 * FE-M8: the toggle logic now lives in `KillSwitchControl` so the Risk
 * workspace can host the same control. This panel's DOM is unchanged.
 */

import { useStoreState } from "../../stores/store";
import { riskStore } from "../../stores";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/Status";
import { KillSwitchControl } from "./KillSwitchControl";

export function RiskPanel() {
  const { violations } = useStoreState(riskStore);

  return (
    <Panel title="Risk">
      <KillSwitchControl />

      <h3 className="section-title">Violations</h3>
      {violations.length === 0 ? (
        <EmptyState message="No risk violations." detail="Rejected orders appear here." />
      ) : (
        <ul className="violation-list">
          {violations.map((violation) => (
            <li key={violation.eventId} className="violation-item">
              <span className="violation-rule">{violation.rule}</span>
              <span className="violation-message">
                {violation.accountId}
                {violation.symbol ? ` · ${violation.symbol}` : ""} — {violation.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
