/**
 * Order history table (M5) — READ-ONLY.
 *
 * Data source: the same authoritative `GET /orders` list the terminal keeps
 * (`ordersStore`, refreshed on login, on broker reconnect and after every
 * order event). The backend's list endpoint filters by `account_id` only, so
 * status/side/date/search narrowing happens client-side in the pure helpers of
 * `orderHistoryFilters.ts` — the order status itself is always the backend's
 * value, never re-derived from quantities.
 *
 * The default filter is "All finished" (terminal statuses: FILLED, CANCELLED,
 * REJECTED, EXPIRED). Working orders are reachable deliberately via
 * "Everything" or their explicit status, so a history screen never passes a
 * working order off as a completed one.
 *
 * No submit/modify/cancel control exists here: M5 is an inspection module.
 */

import { useMemo, useState } from "react";

import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { isApiError } from "../../services/api";
import { useServices } from "../../services/context";
import { brokersStore, ordersStore } from "../../stores";
import { replaceOrders } from "../../stores/ordersStore";
import { useStoreState } from "../../stores/store";
import type { OrderOut } from "../../types/api";
import { formatDecimal } from "../../utils/decimal";
import { orderStatusTone } from "../../utils/statusTone";
import { formatTimeOfDay, formatUtcDay } from "../../utils/time";
import { OrderDetailDialog } from "./OrderDetailDialog";
import {
  countByStatus,
  distinctAccounts,
  EMPTY_HISTORY_FILTERS,
  filterOrders,
  sortOrders,
  summarize,
  type HistoryFilters,
  type HistorySortKey,
  type HistoryStatusFilter,
} from "./orderHistoryFilters";

const STATUS_OPTIONS: { value: HistoryStatusFilter; label: string }[] = [
  { value: "FINISHED", label: "All finished" },
  { value: "FILLED", label: "Filled" },
  { value: "PARTIALLY_FILLED", label: "Partially filled" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REJECTED", label: "Rejected" },
  { value: "EXPIRED", label: "Expired" },
  { value: "ALL", label: "Everything" },
];

const SIDE_OPTIONS = [
  { value: "ALL", label: "Both sides" },
  { value: "BUY", label: "Buy only" },
  { value: "SELL", label: "Sell only" },
] as const;

export function OrderHistoryTable() {
  const { api } = useServices();
  const { byId, ids, loadState, errorMessage } = useStoreState(ordersStore);
  const { brokers } = useStoreState(brokersStore);

  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [sortKey, setSortKey] = useState<HistorySortKey>("created");
  const [sortDesc, setSortDesc] = useState(true);
  const [detail, setDetail] = useState<OrderOut | null>(null);
  const [retrying, setRetrying] = useState(false);

  const orders = useMemo(() => ids.map((id) => byId[id]), [byId, ids]);
  const accounts = useMemo(() => distinctAccounts(orders), [orders]);
  const counts = useMemo(() => countByStatus(orders), [orders]);
  const summary = useMemo(() => summarize(orders), [orders]);
  const rows = useMemo(
    () => sortOrders(filterOrders(orders, filters), sortKey, sortDesc),
    [orders, filters, sortKey, sortDesc],
  );

  const brokerName = brokers.length > 0 ? brokers[0].name : null;
  const filtersActive =
    filters.search !== "" ||
    filters.status !== EMPTY_HISTORY_FILTERS.status ||
    filters.side !== "ALL" ||
    filters.account !== "ALL" ||
    filters.from !== "" ||
    filters.to !== "";

  function patch(next: Partial<HistoryFilters>) {
    setFilters((prev) => ({ ...prev, ...next }));
  }

  function toggleSort(key: HistorySortKey) {
    if (sortKey === key) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(false);
    }
  }

  /** Real retry: re-reads the authoritative list through the same API client. */
  async function retry() {
    setRetrying(true);
    ordersStore.update((s) => ({ ...s, loadState: "loading", errorMessage: null }));
    try {
      const latest = await api.listOrders();
      ordersStore.update((s) => replaceOrders(s, latest));
    } catch (error) {
      ordersStore.update((s) => ({
        ...s,
        loadState: "error",
        errorMessage: isApiError(error)
          ? error.userMessage
          : "Could not load order history from the trading API.",
      }));
    } finally {
      setRetrying(false);
    }
  }

  const header = (key: HistorySortKey, label: string, extraClass = "") => (
    <th className={extraClass}>
      <button
        type="button"
        className={`th-sort${sortKey === key ? " th-sort-active" : ""}`}
        onClick={() => toggleSort(key)}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        {sortKey === key ? <span aria-hidden="true">{sortDesc ? " ↓" : " ↑"}</span> : null}
      </button>
    </th>
  );

  return (
    <Panel
      title="Order history"
      subtitle="Finished orders as reported by the backend — statuses are never inferred from quantities"
      actions={
        <button
          type="button"
          className="btn btn-secondary btn-xs"
          onClick={() => void retry()}
          disabled={retrying}
          title="Re-read the order list from the trading API"
        >
          {retrying ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="table-toolbar" role="group" aria-label="Order history filters">
        <input
          className="input input-sm table-toolbar-search"
          aria-label="Search order history"
          placeholder="Symbol or order id…"
          value={filters.search}
          onChange={(event) => patch({ search: event.target.value })}
          maxLength={40}
        />
        <select
          className="input input-sm table-toolbar-select"
          aria-label="Filter by status"
          value={filters.status}
          onChange={(event) => patch({ status: event.target.value as HistoryStatusFilter })}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
              {counts[option.value as keyof typeof counts] !== undefined &&
              option.value !== "FINISHED" &&
              option.value !== "ALL"
                ? ` (${counts[option.value as keyof typeof counts]})`
                : ""}
            </option>
          ))}
        </select>
        <select
          className="input input-sm table-toolbar-select"
          aria-label="Filter by side"
          value={filters.side}
          onChange={(event) => patch({ side: event.target.value as HistoryFilters["side"] })}
        >
          {SIDE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {accounts.length > 1 ? (
          <select
            className="input input-sm table-toolbar-select"
            aria-label="Filter by account"
            value={filters.account}
            onChange={(event) => patch({ account: event.target.value })}
          >
            <option value="ALL">All accounts</option>
            {accounts.map((account) => (
              <option key={account} value={account}>
                {account}
              </option>
            ))}
          </select>
        ) : null}
        <label className="table-toolbar-date">
          <span>From</span>
          <input
            className="input input-sm"
            type="date"
            aria-label="From date (UTC)"
            value={filters.from}
            max={filters.to === "" ? undefined : filters.to}
            onChange={(event) => patch({ from: event.target.value })}
          />
        </label>
        <label className="table-toolbar-date">
          <span>To</span>
          <input
            className="input input-sm"
            type="date"
            aria-label="To date (UTC)"
            value={filters.to}
            min={filters.from === "" ? undefined : filters.from}
            onChange={(event) => patch({ to: event.target.value })}
          />
        </label>
        {filtersActive ? (
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => setFilters(EMPTY_HISTORY_FILTERS)}
          >
            Clear filters
          </button>
        ) : null}
        <span className="table-toolbar-summary">
          {rows.length} of {orders.length} orders
          {orders.length > 0 ? (
            <>
              {" · "}
              {summary.filled} filled · {summary.partiallyFilled} partial · {summary.cancelled}{" "}
              cancelled · {summary.rejected} rejected · {summary.expired} expired
            </>
          ) : null}
        </span>
      </div>

      {loadState === "idle" || (loadState === "loading" && orders.length === 0) ? (
        <LoadingState label="Loading order history…" />
      ) : loadState === "error" && orders.length === 0 ? (
        <ErrorState message={errorMessage ?? "Could not load order history."} />
      ) : orders.length === 0 ? (
        <EmptyState
          message="No order history yet."
          detail="Orders appear here once the engine reports their final state (filled, cancelled, rejected or expired)."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          message="No orders match the current filters."
          detail="Dates are compared against the UTC calendar day of the submission timestamp."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {header("created", "Submitted")}
                <th>Order id</th>
                {header("symbol", "Symbol")}
                <th>Broker</th>
                <th>Account</th>
                <th>Side</th>
                <th>Type</th>
                {header("quantity", "Qty", "num")}
                {header("filled", "Filled", "num")}
                <th className="num">Remaining</th>
                <th className="num">Limit</th>
                <th className="num">Stop</th>
                {header("status", "Status")}
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr
                  key={order.client_order_id}
                  onClick={() => setDetail(order)}
                  className="row-clickable"
                  data-testid={`history-${order.client_order_id}`}
                >
                  <td>
                    <span
                      className="order-time"
                      title={`${order.created_at} (UTC day ${formatUtcDay(order.created_at)})`}
                    >
                      {formatTimeOfDay(order.created_at)}
                    </span>
                  </td>
                  <td>
                    <code className="order-id" title={order.client_order_id}>
                      {order.client_order_id.slice(0, 8)}
                    </code>
                  </td>
                  <td>
                    <span className="symbol">{order.symbol}</span>
                    <span className="symbol-venue">{order.exchange}</span>
                  </td>
                  <td>
                    <span
                      className="broker-tag"
                      title={brokerName ?? "Runtime broker not reported yet"}
                    >
                      <b className="ib-mini" aria-hidden="true">
                        {(brokerName ?? "??").slice(0, 2).toUpperCase()}
                      </b>{" "}
                      {brokerName ?? "—"}
                    </span>
                  </td>
                  <td className="account-cell" title={order.account_id}>
                    {order.account_id}
                  </td>
                  <td className={order.side === "BUY" ? "pos" : "neg"}>{order.side}</td>
                  <td>{order.order_type}</td>
                  <td className="num">{formatDecimal(order.quantity)}</td>
                  <td className="num">{formatDecimal(order.filled_quantity)}</td>
                  <td className="num">{formatDecimal(order.remaining_quantity)}</td>
                  <td className="num">{formatDecimal(order.limit_price)}</td>
                  <td className="num">{formatDecimal(order.stop_price)}</td>
                  <td>
                    <StatusBadge
                      tone={orderStatusTone(order.status)}
                      label={order.status}
                      title={order.rejection_reason ?? undefined}
                    />
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetail(order);
                      }}
                      title="Inspect this order and its executions"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail !== null ? (
        <OrderDetailDialog order={detail} onClose={() => setDetail(null)} />
      ) : null}
    </Panel>
  );
}
