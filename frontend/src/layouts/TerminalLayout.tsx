/**
 * Terminal layout (M11 → M1 Figma re-theme).
 *
 * The Figma shell: a fixed sidebar (brand, workspace/platform navigation,
 * user chip) + a sticky translucent header (search, market status, broker
 * chip, connection/broker/kill-switch badges, account selector, log out).
 *
 * Preserved M11/M12 behavior: view navigation stays store-driven (no router
 * — ADR-017), the account selector keeps the scoped/free-entry logic, the
 * stream badge keeps its exact tested text ("Stream: CONNECTED"), and the
 * broker/kill-switch badges remain the honest connection surfaces.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "../components/Icon";
import { StatusBadge } from "../components/StatusBadge";
import { ConnectionBanner } from "../features/connection/ConnectionBanner";
import { useOpenOrderCount } from "../hooks/useOpenOrderCount";
import { authService } from "../services/auth";
import { authStore } from "../stores/authStore";
import { accountStore, brokersStore, connectionStore, uiStore } from "../stores";
import { userAllowedAccounts } from "../stores/authStore";
import { useStoreState } from "../stores/store";
import type { TerminalView } from "../stores/uiStore";

/** Real, implemented destinations (store-driven navigation). */
const VIEWS: { id: TerminalView; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "dashboard", label: "Trade", icon: "chart" },
  { id: "orders", label: "Orders", icon: "orders" },
  { id: "positions", label: "Positions", icon: "briefcase" },
  { id: "accounts", label: "Accounts", icon: "wallet" },
  { id: "activity", label: "Activity", icon: "history" },
];

/**
 * Figma navigation destinations that have no implementation yet — rendered
 * disabled (never dead links that pretend to work). ("Accounts" moved to the
 * real views in M3; "Activity" in M5 — order history + executions.)
 */
const COMING_SOON: { label: string; icon: IconName; section: "workspace" | "platform" }[] = [
  { label: "Strategies", icon: "layers", section: "platform" },
  { label: "Settings", icon: "settings", section: "platform" },
];

export function TerminalLayout({ children }: { children: ReactNode }) {
  const { view, accountId, watchFilter } = useStoreState(uiStore);
  const { state: connectionState, lastEventAt } = useStoreState(connectionStore);
  const { brokers } = useStoreState(brokersStore);
  const { killSwitchActive } = useStoreState(accountStore);
  const { user } = useStoreState(authStore);
  const allowedAccounts = userAllowedAccounts();
  const [editingAccount, setEditingAccount] = useState(false);
  const [accountDraft, setAccountDraft] = useState(accountId);
  const searchRef = useRef<HTMLInputElement>(null);

  const connectedCount = brokers.filter((b) => b.connected).length;
  const openOrderCount = useOpenOrderCount();
  const primaryBroker = brokers[0] ?? null;

  // ⌘K / Ctrl+K focuses the header search (the Figma kbd hint, made real).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const userInitials = (user?.subject ?? "?").slice(0, 2).toUpperCase();
  const userRole = user !== null && user.roles.length > 0 ? user.roles[0] : "user";

  return (
    <div className="terminal">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <strong>
            Multi-Broker<span> Trading Engine</span>
          </strong>
        </div>
        <nav aria-label="Views">
          <p className="snav-section">WORKSPACE</p>
          {VIEWS.map((v) => (
            <NavButton
              key={v.id}
              label={v.label}
              icon={v.icon}
              active={view === v.id}
              badge={v.id === "orders" ? openOrderCount : 0}
              onClick={() => uiStore.update((s) => ({ ...s, view: v.id }))}
            />
          ))}
          {COMING_SOON.filter((item) => item.section === "workspace").map((item) => (
            <NavButton
              key={item.label}
              label={item.label}
              icon={item.icon}
              disabled
              title="Not implemented in this milestone"
            />
          ))}
          <p className="snav-section">PLATFORM</p>
          {COMING_SOON.filter((item) => item.section === "platform").map((item) => (
            <NavButton
              key={item.label}
              label={item.label}
              icon={item.icon}
              disabled
              title="Not implemented in this milestone"
            />
          ))}
        </nav>
        <div className="sidebar-user" title={`Signed in as ${user?.subject ?? "user"}`}>
          <div className="avatar" aria-hidden="true">
            {userInitials}
          </div>
          <div className="sidebar-user-name">
            <strong>{user?.subject ?? "User"}</strong>
            <small>
              {userRole} · {accountId}
            </small>
          </div>
          <Icon name="chevron" size={14} />
        </div>
      </aside>

      <div className="terminal-main">
        <header className="terminal-header">
          <div className="mobile-logo brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="header-search">
            <Icon name="search" size={16} />
            <input
              ref={searchRef}
              aria-label="Search instruments"
              placeholder="Search markets, orders…"
              value={watchFilter}
              onChange={(e) => uiStore.update((s) => ({ ...s, watchFilter: e.target.value }))}
            />
            <kbd className="search-kbd">⌘ K</kbd>
          </div>
          <div className="header-actions">
            <div
              className="market-status"
              role="status"
              title={
                brokers.length === 0
                  ? "Broker status unknown"
                  : `${connectedCount}/${brokers.length} broker${brokers.length === 1 ? "" : "s"} connected`
              }
            >
              <i aria-hidden="true" />
              {brokers.length === 0
                ? "Brokers unknown"
                : `Brokers ${connectedCount}/${brokers.length}`}
            </div>
            <div
              className="broker-chip"
              title={
                primaryBroker === null
                  ? "No broker reported by the gateway"
                  : `${primaryBroker.name} — ${primaryBroker.connected ? "connected" : "disconnected"} (simulated transport)`
              }
            >
              <span className="ib-square" aria-hidden="true">
                {(primaryBroker?.name ?? "??").slice(0, 2).toUpperCase()}
              </span>
              <span className="broker-chip-text">
                <small>{primaryBroker?.connected ? "Connected broker" : "Broker"}</small>
                {primaryBroker?.name ?? "None"}
              </span>
            </div>
            {killSwitchActive ? (
              <StatusBadge tone="danger" label="KILL SWITCH" title="New orders are rejected" />
            ) : null}
            <StatusBadge
              tone={connectionState === "CONNECTED" ? "ok" : "warn"}
              label={`Stream: ${connectionState}`}
            />
            <div className="account-selector">
              <span className="account-label">Account</span>
              {allowedAccounts !== null ? (
                // Scoped users choose from THEIR accounts only. The server
                // re-checks every request regardless (IDOR tests on backend).
                <select
                  className="input input-sm"
                  aria-label="Account"
                  value={allowedAccounts.includes(accountId) ? accountId : allowedAccounts[0]}
                  onChange={(e) => uiStore.update((s) => ({ ...s, accountId: e.target.value }))}
                >
                  {allowedAccounts.map((account) => (
                    <option key={account} value={account}>
                      {account}
                    </option>
                  ))}
                </select>
              ) : editingAccount ? (
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
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void authService.logout()}
              title="End the session and sign out"
            >
              Log out
            </button>
          </div>
        </header>

        <ConnectionBanner />

        {children}

        <footer className="terminal-footer">
          <span>
            Last event: {lastEventAt !== null ? new Date(lastEventAt).toLocaleTimeString() : "—"} ·
            simulated brokers · demo data — no live trading
          </span>
          <span className="footer-right">Multi-Broker Trading Engine</span>
        </footer>
      </div>
    </div>
  );
}

interface NavButtonProps {
  label: string;
  icon: IconName;
  active?: boolean;
  disabled?: boolean;
  badge?: number;
  title?: string;
  onClick?: () => void;
}

function NavButton({
  label,
  icon,
  active = false,
  disabled = false,
  badge = 0,
  title,
  onClick,
}: NavButtonProps) {
  return (
    <button
      type="button"
      className={`snav-btn${active ? " snav-btn-active" : ""}`}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="snav-label">{label}</span>
      {badge > 0 ? (
        <em className="snav-badge" aria-hidden="true">
          {badge}
        </em>
      ) : null}
    </button>
  );
}
