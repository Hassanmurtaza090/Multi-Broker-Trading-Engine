/**
 * Dashboard (M2) — orders summary card.
 *
 * Combines the two honest lenses the backend supports: the count of WORKING
 * orders (the same primitive the sidebar badge uses) and a read-only list of
 * the most recent orders (any status — the M11 order store IS the activity
 * log; no separate executions endpoint exists). Read-only by design: no
 * cancel/modify/submit from the Dashboard (M2 rule).
 */

import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { useOpenOrderCount } from "../../hooks/useOpenOrderCount";
import { ordersStore, uiStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { formatDecimal } from "../../utils/decimal";
import { orderStatusTone } from "../../utils/statusTone";

const MAX_ROWS = 5;

export function OrdersSummaryCard() {
  const { byId, ids, loadState, errorMessage } = useStoreState(ordersStore);
  const openCount = useOpenOrderCount();

  const recent = ids.slice(0, MAX_ROWS).map((id) => byId[id]);

  return (
    <Panel
      title="Orders"
      subtitle="Working orders and recent activity"
      actions={
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => uiStore.update((s) => ({ ...s, view: "orders" }))}
          title="Open the full Orders view"
        >
          View orders
        </button>
      }
    >
      {loadState === "idle" || (loadState === "loading" && ids.length === 0) ? (
        <LoadingState label="Loading orders…" />
      ) : loadState === "error" && ids.length === 0 ? (
        <ErrorState message={errorMessage ?? "Could not load orders."} />
      ) : ids.length === 0 ? (
        <EmptyState
          message="No orders yet."
          detail="Submit an order from the Trade screen to see it here."
        />
      ) : (
        <>
          <p className="snapshot-count">
            <b>{openCount}</b> working · {ids.length} total
          </p>
          <ul className="snapshot-list">
            {recent.map((order) => (
              <li key={order.client_order_id} className="snapshot-row">
                <span>
                  <span className={`snapshot-side ${order.side === "BUY" ? "pos" : "neg"}`}>
                    {order.side}
                  </span>{" "}
                  <span className="symbol">{order.symbol}</span>
                </span>
                <span className="num">
                  {formatDecimal(order.filled_quantity)}/{formatDecimal(order.quantity)}
                </span>
                <span className="snapshot-meta">
                  <StatusBadge
                    tone={orderStatusTone(order.status)}
                    label={order.status}
                    title={order.rejection_reason ?? undefined}
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
