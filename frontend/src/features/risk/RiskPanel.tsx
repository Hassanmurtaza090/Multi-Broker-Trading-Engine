/**
 * Risk panel (M11): the M6 kill switch control (confirmed, error-safe) and
 * the live risk-violation feed (TS-009 audit visibility).
 *
 * The toggle never pretends success: on API failure the store keeps its prior
 * value and the error is surfaced. Risk enforcement lives ONLY on the server
 * (M6); this control merely drives it.
 */

import { useState } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Panel } from "../../components/Panel";
import { EmptyState, LoadingState } from "../../components/Status";
import { StatusBadge } from "../../components/StatusBadge";
import { useServices } from "../../services/context";
import { accountStore, riskStore, uiStore } from "../../stores";
import { isApiError } from "../../services/api";
import { useStoreState } from "../../stores/store";

export function RiskPanel() {
  const { api } = useServices();
  const { accountId } = useStoreState(uiStore);
  const { killSwitchActive, killSwitchState } = useStoreState(accountStore);
  const { violations } = useStoreState(riskStore);

  const [pendingTarget, setPendingTarget] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function confirmToggle() {
    if (pendingTarget === null) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.setKillSwitch(accountId, pendingTarget);
      // Discard the result if the user switched accounts mid-toggle.
      if (uiStore.getSnapshot().accountId === accountId) {
        accountStore.update((s) => ({ ...s, killSwitchActive: result.active }));
      }
      setPendingTarget(null);
    } catch (error) {
      setActionError(isApiError(error) ? error.userMessage : "Kill-switch update failed.");
      setPendingTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const switchActive = killSwitchActive === true;

  return (
    <Panel
      title="Risk"
      actions={
        killSwitchActive !== null ? (
          <StatusBadge
            tone={switchActive ? "danger" : "ok"}
            label={switchActive ? "KILL SWITCH ACTIVE" : "Trading enabled"}
          />
        ) : undefined
      }
    >
      <div className="risk-controls">
        {killSwitchState === "idle" || killSwitchState === "loading" ? (
          <LoadingState label="Loading risk state…" />
        ) : killSwitchActive === null ? (
          <EmptyState message="Kill-switch state unavailable." />
        ) : (
          <button
            type="button"
            className={`btn ${switchActive ? "btn-primary" : "btn-danger"}`}
            onClick={() => setPendingTarget(!switchActive)}
          >
            {switchActive ? "Deactivate kill switch" : "Activate kill switch"}
          </button>
        )}
        {actionError ? (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>

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

      {pendingTarget !== null ? (
        <ConfirmDialog
          title={pendingTarget ? "Activate kill switch" : "Deactivate kill switch"}
          message={
            pendingTarget
              ? "All new orders for this account will be rejected by the risk engine until the kill switch is deactivated."
              : "Orders for this account will be evaluated by the configured risk rules again."
          }
          confirmLabel={pendingTarget ? "Activate" : "Deactivate"}
          danger={pendingTarget}
          busy={busy}
          onConfirm={() => void confirmToggle()}
          onCancel={() => setPendingTarget(null)}
        />
      ) : null}
    </Panel>
  );
}
