/**
 * Portfolio (M3) — accounts & connection card.
 *
 * Shows the accounts the signed-in user may access (server-scoped), the
 * ACTIVE account, and switching via the EXISTING uiStore.accountId
 * mechanism (the terminal re-syncs all account-scoped data on change —
 * that resync is the supported refresh path; no decorative refresh button).
 *
 * Honesty notes (documented, not hidden):
 * - The M10 gateway binds ONE broker account per runtime (ADR-016): there is
 *   no cross-account aggregation endpoint, so this is account-level view
 *   with switching — never a fabricated "consolidated total".
 * - Wildcard-scope admins get the same free-entry selector the header has.
 * - Broker identity + connection state come from the real brokers store.
 */

import { useState } from "react";

import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import { brokersStore, uiStore } from "../../stores";
import { userAllowedAccounts } from "../../stores/authStore";
import { useStoreState } from "../../stores/store";

export function AccountsCard() {
  const { accountId } = useStoreState(uiStore);
  const { brokers } = useStoreState(brokersStore);
  const allowedAccounts = userAllowedAccounts();
  const [draft, setDraft] = useState(accountId);
  const [editing, setEditing] = useState(false);

  const connectedBrokers = brokers.filter((b) => b.connected);
  const disconnectedBrokers = brokers.filter((b) => !b.connected);

  return (
    <Panel title="Accounts" subtitle="Your scope and the active account">
      {allowedAccounts !== null ? (
        <ul className="account-chip-list">
          {allowedAccounts.map((account) => (
            <li key={account}>
              <button
                type="button"
                className={`account-chip${account === accountId ? " account-chip-active" : ""}`}
                aria-current={account === accountId ? "true" : undefined}
                onClick={() => uiStore.update((s) => ({ ...s, accountId: account }))}
                title={
                  account === accountId
                    ? "Active account — account-scoped panels re-sync on switch"
                    : "Switch the active account (re-syncs all account-scoped data)"
                }
              >
                <span className="account-chip-id">{account}</span>
                {account === accountId ? <span className="account-chip-state">ACTIVE</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : editing ? (
        <form
          className="account-freeform"
          onSubmit={(e) => {
            e.preventDefault();
            const next = draft.trim();
            if (next !== "" && next.length <= 128) {
              uiStore.update((s) => ({ ...s, accountId: next }));
            }
            setEditing(false);
          }}
        >
          <input
            className="input input-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Account id"
            maxLength={128}
            autoFocus
          />
          <button type="submit" className="btn btn-primary btn-sm">
            Set
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="account-chip account-chip-active"
          onClick={() => {
            setDraft(accountId);
            setEditing(true);
          }}
          title="Switch account (wildcard scope — the server re-checks every request)"
        >
          <span className="account-chip-id">{accountId}</span>
          <span className="account-chip-state">ACTIVE</span>
        </button>
      )}

      <p
        className="portfolio-note"
        title="The gateway binds one broker account per runtime (ADR-016). Switching re-syncs positions, orders, balance, and risk for the selected account."
      >
        The gateway binds one broker account per runtime — switching re-syncs all account-scoped
        data. No cross-account aggregation exists.
      </p>

      <h3 className="section-title">Broker connections</h3>
      {brokers.length === 0 ? (
        <p className="state-detail">No brokers reported by the gateway.</p>
      ) : (
        <ul className="snapshot-list">
          {connectedBrokers.map((broker) => (
            <li key={broker.name} className="snapshot-row">
              <span>
                <span className="symbol">{broker.name}</span>
              </span>
              <StatusBadge tone="ok" label="Connected" />
            </li>
          ))}
          {disconnectedBrokers.map((broker) => (
            <li key={broker.name} className="snapshot-row">
              <span>
                <span className="symbol">{broker.name}</span>
              </span>
              <StatusBadge
                tone="danger"
                label="Disconnected"
                title="Data for this broker may be stale — panels show their own sync states"
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
