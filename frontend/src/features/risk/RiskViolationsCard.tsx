/**
 * Risk alerts panel (FE-M8) — the Figma screen's "Risk alerts" list, backed by
 * the only risk events the platform emits: `risk.violation`.
 *
 * Semantics that must not be blurred:
 * - These are HARD GATE REJECTIONS, not soft warnings. Each entry corresponds
 *   to a rule that refused an order, so the panel is titled accordingly and
 *   never presented as advisory alerting.
 * - The feed is session-only: it is held in client memory by `riskStore` (the
 *   backend persists no violation history), so the panel says so and never
 *   implies durability.
 * - There is no acknowledge/resolve endpoint, so no such action is rendered.
 */

import { useMemo, useState } from "react";

import { EmptyState } from "../../components/Status";
import { Panel } from "../../components/Panel";
import { riskStore } from "../../stores";
import { useStoreState } from "../../stores/store";

export function RiskViolationsCard() {
  const { violations } = useStoreState(riskStore);
  const [ruleFilter, setRuleFilter] = useState<string>("all");

  const rules = useMemo(
    () => [...new Set(violations.map((item) => item.rule))].sort((a, b) => a.localeCompare(b)),
    [violations],
  );

  // A filter pointing at a rule that has since scrolled out of the bounded
  // feed must not hide everything silently.
  const activeRule = ruleFilter !== "all" && !rules.includes(ruleFilter) ? "all" : ruleFilter;
  const visible =
    activeRule === "all" ? violations : violations.filter((item) => item.rule === activeRule);

  return (
    <Panel
      title="Risk alerts"
      subtitle="Live order rejections from the risk gate — newest first"
      actions={
        rules.length > 0 ? (
          <label className="risk-filter">
            <span className="risk-filter-label">Rule</span>
            <select
              className="input input-sm"
              aria-label="Filter risk alerts by rule"
              value={activeRule}
              onChange={(event) => setRuleFilter(event.target.value)}
            >
              <option value="all">All rules ({violations.length})</option>
              {rules.map((rule) => (
                <option key={rule} value={rule}>
                  {rule} ({violations.filter((item) => item.rule === rule).length})
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
    >
      {violations.length === 0 ? (
        <EmptyState
          message="No risk violations this session."
          detail="Orders rejected by the risk gate appear here. The list is held in memory only — the backend keeps no violation history."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          message="No violations for this rule."
          detail="Change the filter to see others."
        />
      ) : (
        <ul className="violation-list">
          {visible.map((violation) => (
            <li key={violation.eventId} className="violation-item">
              <span className="violation-rule">{violation.rule}</span>
              <span className="violation-message">
                {violation.accountId}
                {violation.symbol ? ` · ${violation.symbol}` : ""} — {violation.message}
              </span>
              <time className="quote-time" dateTime={violation.timestamp}>
                {new Date(violation.timestamp).toLocaleTimeString()}
              </time>
            </li>
          ))}
        </ul>
      )}

      <p className="state-detail risk-notes">
        These are enforced rejections, not advisory warnings. Acknowledgement and violation history
        are not supported: the API exposes no such endpoints, so no action is offered here.
      </p>
    </Panel>
  );
}
