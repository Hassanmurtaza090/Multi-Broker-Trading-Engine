/**
 * Terminal layout (M11): header (identity, brokers, connection, account),
 * view navigation, content outlet, and a status bar.
 */

import { useState, type ReactNode } from "react";

import { StatusBadge } from "../components/StatusBadge";
import { ConnectionBanner } from "../features/connection/ConnectionBanner";
import { accountStore, brokersStore, connectionStore, uiStore } from "../stores";
import { useStoreState } from "../stores/store";
import type { TerminalView } from "../stores/uiStore";

const VIEWS: { id: TerminalView; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "orders", label: "Orders" },
  { id: "positions", label: "Positions" },
];

export function TerminalLayout({ children }: { children: ReactNode }) {
  const { view, accountId } = useStoreState(uiStore);
  const { state: connectionState, lastEventAt } = useStoreState(connectionStore);
  const { brokers } = useStoreState(brokersStore);
  const { killSwitchActive } = useStoreState(accountStore);
  const [editingAccount, setEditingAccount] = useState(false);
  const [accountDraft, setAccountDraft] = useState(accountId);

  const connectedCount = brokers.filter((b) => b.connected).length;

  return (
    <div className="terminal">
      <header className="terminal-header">
        <div className="terminal-brand">
          <h1>Multi-Broker Trading Engine</h1>
          <span className="terminal-subtitle">Trading Terminal</span>
        </div>

        <nav className="terminal-nav" aria-label="Views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`nav-tab${view === v.id ? " nav-tab-active" : ""}`}
              aria-current={view === v.id ? "page" : undefined}
              onClick={() => uiStore.update((s) => ({ ...s, view: v.id }))}
            >
              {v.label}
            </button>
          ))}
        </nav>

        <div className="terminal-header-right">
          {killSwitchActive ? (
            <StatusBadge tone="danger" label="KILL SWITCH" title="New orders are rejected" />
          ) : null}
          <StatusBadge
            tone={connectedCount > 0 ? "ok" : "danger"}
            label={
              brokers.length === 0
                ? "Broker: unknown"
                : `Broker: ${connectedCount}/${brokers.length} connected`
            }
          />
          <StatusBadge
            tone={connectionState === "CONNECTED" ? "ok" : "warn"}
            label={`Stream: ${connectionState}`}
          />
          <div className="account-selector">
            <span className="account-label">Account</span>
            {editingAccount ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = accountDraft.trim();
                  if (next !== "" && next.length <= 128) {
                    uiStore.update((s) => ({ ...s, accountId: next }));
                  }
                  setEditingAccount(false);
                }}
              >
                <input
                  className="input input-sm"
                  value={accountDraft}
                  onChange={(e) => setAccountDraft(e.target.value)}
                  aria-label="Account id"
                  maxLength={128}
                  autoFocus
                />
              </form>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setAccountDraft(accountId);
                  setEditingAccount(true);
                }}
                title="Switch account"
              >
                {accountId}
              </button>
            )}
          </div>
        </div>
      </header>

      <ConnectionBanner />

      <main className="terminal-main">{children}</main>

      <footer className="terminal-footer">
        <span>
          Last event: {lastEventAt !== null ? new Date(lastEventAt).toLocaleTimeString() : "—"}
        </span>
        <span className="footer-right">API v1 · simulated brokers · no live trading</span>
      </footer>
    </div>
  );
}
