/**
 * Positions / orders tabs card (M1) — the Figma terminal's bottom card.
 *
 * Tabs: Positions | Orders | Order history — real content from the existing
 * components (PositionsTable, OrderBlotter with a fixed filter).
 *
 * Deviations from the Figma mock (deliberate):
 * - The middle tab is "Orders" (the live blotter, ALL statuses) rather than
 *   the mock's "Open orders": working-AND-terminal visibility is the tested
 *   terminal contract — after a confirmed cancel, the CANCELLED row must
 *   stay visible. The tab badge is the REAL working-order count; the
 *   blotter's own select narrows to Open/Done when wanted.
 * - "Order history" shows terminal (filled/cancelled/rejected/expired) rows.
 * - The Figma's single mock position row is replaced by live data (or the
 *   existing explicit empty states — never invented rows).
 */

import { useState } from "react";

import { Icon } from "../../components/Icon";
import { PositionsTable } from "../positions/PositionsTable";
import { OrderBlotter } from "../orders/OrderBlotter";
import { useOpenOrderCount } from "../../hooks/useOpenOrderCount";
import { uiStore } from "../../stores";

type PositionsTab = "positions" | "orders" | "history";

const TABS: { id: PositionsTab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "orders", label: "Orders" },
  { id: "history", label: "Order history" },
];

export function PositionsTabsCard() {
  const [activeTab, setActiveTab] = useState<PositionsTab>("orders");
  const openCount = useOpenOrderCount();

  function onExpand() {
    uiStore.update((s) => ({
      ...s,
      view: activeTab === "positions" ? "positions" : "orders",
    }));
  }

  return (
    <section className="positions-card" aria-label="Positions and orders">
      <div className="bottom-tabs" role="tablist" aria-label="Positions and orders">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "bt-btn-active" : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === "orders" && openCount > 0 ? (
              <i className="bt-count" aria-hidden="true">
                {openCount}
              </i>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          className="bt-expand"
          onClick={onExpand}
          title="Open the full-screen view"
        >
          Expand view <Icon name="chevron" size={14} />
        </button>
      </div>
      {activeTab === "positions" ? (
        <PositionsTable />
      ) : (
        // key: switching tabs must remount the blotter so the fixed filter
        // actually applies (React would otherwise preserve internal state).
        <OrderBlotter key={activeTab} initialFilter={activeTab === "orders" ? "ALL" : "TERMINAL"} />
      )}
    </section>
  );
}
