/**
 * Kill-switch control (M6/M11, extracted for FE-M8 reuse).
 *
 * The ONLY risk control this platform exposes a readable AND writable state
 * for: `GET`/`POST /accounts/{id}/risk/kill-switch` (`risk:read` /
 * `risk:admin`). The toggle is confirmation-gated, in-flight safe, and never
 * pretends success — on failure the store keeps its prior value and the error
 * is surfaced. Enforcement itself is entirely server-side (RiskEngine sees the
 * flag on the next evaluation).
 *
 * Extracted from `RiskPanel` so the Risk workspace can host the same control
 * without duplicating the confirmation/error logic. The rendered DOM is the
 * same, so existing tests keep covering it.
 */

import { useState } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyState, LoadingState } from "../../components/Status";
import { StatusBadge } from "../../components/StatusBadge";
import { isApiError } from "../../services/api";
import { useServices } from "../../services/context";
import { accountStore, uiStore } from "../../stores";
import { userCanAdminRisk } from "../../stores/authStore";
import { useStoreState } from "../../stores/store";

export function KillSwitchControl() {
  const { api } = useServices();
  const { accountId } = useStoreState(uiStore);
  const { killSwitchActive, killSwitchState } = useStoreState(accountStore);

  const [pendingTarget, setPendingTarget] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const switchActive = killSwitchActive === true;

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

  return (
    <div className="risk-controls">
      {killSwitchState === "idle" || killSwitchState === "loading" ? (
        <LoadingState label="Loading risk state…" />
      ) : killSwitchActive === null ? (
        <EmptyState message="Kill-switch state unavailable." />
      ) : (
        <div className="risk-control-row">
          <StatusBadge
            tone={switchActive ? "danger" : "ok"}
            label={switchActive ? "KILL SWITCH ACTIVE" : "Trading enabled"}
          />
          {!userCanAdminRisk() ? (
            // UX-only gate: the server rejects non-admin toggles regardless
            // (verified by the M12 backend authorization suite).
            <p className="state-detail">
              Kill-switch control requires administrator permissions. You can view its state;
              enforcement is server-side.
            </p>
          ) : (
            <button
              type="button"
              className={`btn ${switchActive ? "btn-primary" : "btn-danger"}`}
              onClick={() => setPendingTarget(!switchActive)}
            >
              {switchActive ? "Deactivate kill switch" : "Activate kill switch"}
            </button>
          )}
        </div>
      )}
      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}

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
    </div>
  );
}
