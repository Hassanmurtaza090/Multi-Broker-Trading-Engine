/**
 * Navigation destinations (FE-M11) — the single label/icon table for the
 * sidebar and for the Settings screen's default-workspace preference.
 *
 * Kept out of `TerminalLayout.tsx` so that layout file only exports a
 * component (Fast Refresh) and so the labels have one source of truth.
 * Every entry is a real, implemented destination: no disabled placeholders.
 */

import type { IconName } from "../components/Icon";
import type { TerminalView } from "../stores/uiStore";

export interface NavView {
  id: TerminalView;
  label: string;
  icon: IconName;
  section: "workspace" | "platform";
}

/**
 * Order follows the Figma Make sidebar. ("Market Data" in the prototype is
 * this terminal's "Markets"; the rename is a tracked follow-up.)
 */
export const VIEWS: readonly NavView[] = [
  { id: "overview", label: "Overview", icon: "grid", section: "workspace" },
  { id: "dashboard", label: "Trade", icon: "chart", section: "workspace" },
  { id: "markets", label: "Markets", icon: "markets", section: "workspace" },
  { id: "orders", label: "Orders", icon: "orders", section: "workspace" },
  { id: "positions", label: "Positions", icon: "briefcase", section: "workspace" },
  { id: "accounts", label: "Accounts", icon: "wallet", section: "workspace" },
  { id: "activity", label: "Activity", icon: "history", section: "workspace" },
  // M10: Portfolio follows Activity (equity/P&L/allocation live here;
  // Accounts keeps cash and broker status).
  { id: "portfolio", label: "Portfolio", icon: "briefcase", section: "workspace" },
  // M9: honest broker capability reporting (single-broker runtime).
  { id: "brokers", label: "Brokers", icon: "wallet", section: "workspace" },
  // M7: strategy management is capability state, not strategy execution.
  { id: "strategies", label: "Strategies", icon: "layers", section: "platform" },
  // M8: every risk control reported here is enforced by the server.
  { id: "risk", label: "Risk Management", icon: "shield", section: "platform" },
  // M10: reports export only what this terminal actually holds.
  { id: "reports", label: "Reports", icon: "orders", section: "platform" },
  // FE-M11: the design lists Administration then Settings after Reports.
  { id: "administration", label: "Administration", icon: "layers", section: "platform" },
  { id: "settings", label: "Settings", icon: "settings", section: "platform" },
];
