/**
 * Activity page (M5) — the Figma sidebar's "Activity" destination.
 *
 * The design prototype lists Activity in the sidebar (Overview, Trade, Orders,
 * Positions, Accounts, Activity) and labels the third bottom-card tab "Order
 * history", but ships no frames for either screen; the layout below therefore
 * follows the established FE-M1 design system (page title → status strip →
 * panel with toolbar and table). This is recorded in the completion notes.
 *
 * Two read-only sections, switchable by a segmented control:
 *   1. Order history — finished orders from the authoritative `GET /orders`
 *      read model (client-side filtering; the backend filters by account only).
 *   2. Executions — fills this terminal received live, explicitly labelled as a
 *      session capture because the backend persists no execution history.
 *
 * Nothing on this page can submit, modify or cancel an order.
 */

import { useMemo, useState } from "react";

import { Panel } from "../components/Panel";
import { SegmentedControl } from "../components/SegmentedControl";
import { executionsStore, ordersStore, uiStore } from "../stores";
import { useStoreState } from "../stores/store";
import { ExecutionsTable } from "../features/history/ExecutionsTable";
import { OrderHistoryTable } from "../features/history/OrderHistoryTable";
import { summarize } from "../features/history/orderHistoryFilters";

type ActivityTab = "orders" | "executions";

const TABS = [
  { value: "orders" as const, label: "Order history" },
  { value: "executions" as const, label: "Executions" },
];

export function ActivityPage() {
  const { accountId } = useStoreState(uiStore);
  const { byId, ids } = useStoreState(ordersStore);
  const executions = useStoreState(executionsStore);
  const [tab, setTab] = useState<ActivityTab>("orders");

  const summary = useMemo(() => summarize(ids.map((id) => byId[id])), [byId, ids]);

  return (
    <div className="workspace">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Trading workspace</p>
          <h1>Activity</h1>
          <p className="page-subtitle">{accountId} · order history and executions — read-only</p>
        </div>
        <div className="title-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => uiStore.update((s) => ({ ...s, view: "orders" }))}
            title="Back to the working-order blotter"
          >
            Working orders
          </button>
        </div>
      </section>

      <Panel
        title="Session summary"
        subtitle="Counts from the orders this terminal holds — never derived from fills"
      >
        <div className="activity-stats">
          {(
            [
              ["Filled", summary.filled],
              ["Partially filled", summary.partiallyFilled],
              ["Cancelled", summary.cancelled],
              ["Rejected", summary.rejected],
              ["Expired", summary.expired],
              ["Working", summary.working],
              ["Captured fills", executions.ids.length],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="activity-stat">
              <span className="activity-stat-value num">{value}</span>
              <span className="activity-stat-label">{label}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="activity-tabs">
        <SegmentedControl
          aria-label="Activity section"
          name="activity-section"
          value={tab}
          onChange={setTab}
          options={TABS}
        />
      </div>

      {tab === "orders" ? <OrderHistoryTable /> : <ExecutionsTable />}
    </div>
  );
}
