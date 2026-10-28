/**
 * Order blotter (M11 → M4 upgrade).
 *
 * Full mode (Orders view): the Figma bottom-card tabs (Positions / Open
 * orders / Order history) drive the STATUS SEGMENTED FILTER (All / Working /
 * Done — working orders are never displayed as historical or vice versa);
 * sortable columns (newest-first by default); order identifier (truncated,
 * full id on hover), remaining quantity, and submission time columns.
 * Compact mode (the Trading Terminal's tabs card): the dense table only.
 *
 * Actions (M4 §4 safety): Cancel and Modify reuse the M11 flows UNCHANGED —
 * confirmed dialogs, per-action in-flight guard (no duplicate requests),
 * server-error surfacing (409 double-cancel, 503, 504), and store refresh
 * from the server response. UX-only gating hides the controls for users
 * without orders:write (the server rejects them regardless — M12 tests).
 * No close-position action exists (no backend endpoint) and none is faked.
 */

import { useMemo, useState } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Panel } from "../../components/Panel";
import { SegmentedControl } from "../../components/SegmentedControl";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { StatusBadge } from "../../components/StatusBadge";
import { isApiError } from "../../services/api";
import { useServices } from "../../services/context";
import { ordersStore } from "../../stores";
import { userCanTrade } from "../../stores/authStore";
import { useStoreState } from "../../stores/store";
import { orderStatusTone } from "../../utils/statusTone";
import { TERMINAL_STATUSES, type OrderOut } from "../../types/api";
import { decimalToNumber, formatDecimal, isValidDecimalInput } from "../../utils/decimal";

type StatusFilter = "ALL" | "OPEN" | "TERMINAL";
type SortKey = "default" | "created" | "symbol" | "quantity" | "filled";

const FILTER_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Working" },
  { value: "TERMINAL", label: "Done" },
] as const;

export function OrderBlotter({
  initialFilter = "ALL",
  compact = false,
}: {
  initialFilter?: StatusFilter;
  compact?: boolean;
}) {
  const { api } = useServices();
  const { byId, ids, loadState, errorMessage } = useStoreState(ordersStore);

  const [filter, setFilter] = useState<StatusFilter>(initialFilter);
  const [cancelTarget, setCancelTarget] = useState<OrderOut | null>(null);
  const [modifyTarget, setModifyTarget] = useState<OrderOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDesc, setSortDesc] = useState(true);

  const canAct = userCanTrade();

  const rows = useMemo(() => {
    const all = ids.map((id) => byId[id]);
    const filtered = all.filter((order) =>
      filter === "ALL"
        ? true
        : filter === "OPEN"
          ? !TERMINAL_STATUSES.has(order.status)
          : TERMINAL_STATUSES.has(order.status),
    );
    if (sortKey === "default") return filtered;
    const sorted = filtered.slice();
    sorted.sort((a, b) => {
      let result = 0;
      if (sortKey === "created") {
        result = a.created_at.localeCompare(b.created_at); // ISO timestamps sort correctly as strings
      } else if (sortKey === "symbol") {
        result = a.symbol.localeCompare(b.symbol);
      } else if (sortKey === "quantity") {
        // Decimal strings must compare NUMERICALLY ("10" > "9"), not lexicographically.
        result = (decimalToNumber(a.quantity) ?? 0) - (decimalToNumber(b.quantity) ?? 0);
      } else {
        result =
          (decimalToNumber(a.filled_quantity) ?? 0) - (decimalToNumber(b.filled_quantity) ?? 0);
      }
      if (result === 0) result = a.created_at.localeCompare(b.created_at);
      return sortDesc ? -result : result;
    });
    return sorted;
  }, [byId, ids, filter, sortKey, sortDesc]);

  async function confirmCancel() {
    if (cancelTarget === null) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await api.cancelOrder(cancelTarget.client_order_id);
      ordersStore.update((s) => ({
        ...s,
        byId: { ...s.byId, [updated.client_order_id]: updated },
      }));
      setCancelTarget(null);
    } catch (error) {
      setActionError(isApiError(error) ? error.userMessage : "Cancel failed.");
      setCancelTarget(null);
    } finally {
      setBusy(false);
    }
  }

  function toggleSort(key: Exclude<SortKey, "default">) {
    if (sortKey === key) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(false); // consistent with the positions table: new column → ascending first
    }
  }

  const header = (key: Exclude<SortKey, "default">, label: string, extraClass = "") =>
    compact ? (
      <th className={extraClass}>{label}</th>
    ) : (
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
      title="Orders"
      subtitle={compact ? undefined : "Working and historical orders"}
      actions={
        compact ? undefined : (
          <SegmentedControl
            aria-label="Filter orders by status"
            name="orders-status"
            value={filter}
            onChange={setFilter}
            options={FILTER_OPTIONS.map((option) => ({
              value: option.value as StatusFilter,
              label: option.label,
            }))}
          />
        )
      }
    >
      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {loadState === "idle" || (loadState === "loading" && ids.length === 0) ? (
        <LoadingState label="Loading orders…" />
      ) : loadState === "error" && ids.length === 0 ? (
        <ErrorState message={errorMessage ?? "Could not load orders."} />
      ) : rows.length === 0 ? (
        <EmptyState
          message={
            filter === "ALL"
              ? "No orders yet."
              : filter === "OPEN"
                ? "No working orders."
                : "No done orders."
          }
          detail="Submit an order from the ticket to see it here."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {!compact ? <th title="Client order identifier">ID</th> : null}
                {header("symbol", "Symbol")}
                <th>Side</th>
                {!compact ? <th>Type</th> : null}
                {header("quantity", "Qty", "num")}
                {header("filled", "Filled", "num")}
                {!compact ? <th className="num">Remaining</th> : null}
                <th className="num">Limit</th>
                <th className="num">Stop</th>
                {!compact ? <th>Created</th> : null}
                <th>Status</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <OrderRow
                  key={order.client_order_id}
                  order={order}
                  compact={compact}
                  canAct={canAct}
                  onCancel={() => setCancelTarget(order)}
                  onModify={() => setModifyTarget(order)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!compact && !canAct && rows.length > 0 ? (
        <p className="state-detail">
          Read-only access — your role does not include order actions. The server enforces this
          regardless.
        </p>
      ) : null}

      {cancelTarget !== null ? (
        <ConfirmDialog
          title="Cancel order"
          message={`Cancel the ${cancelTarget.side} ${formatDecimal(cancelTarget.quantity)} ${cancelTarget.symbol} ${cancelTarget.order_type} order?`}
          confirmLabel="Cancel order"
          danger
          busy={busy}
          onConfirm={() => void confirmCancel()}
          onCancel={() => setCancelTarget(null)}
        />
      ) : null}
      {modifyTarget !== null ? (
        <ModifyDialog
          order={modifyTarget}
          api={api}
          onClose={() => setModifyTarget(null)}
          onError={(message) => setActionError(message)}
        />
      ) : null}
    </Panel>
  );
}

function OrderRow({
  order,
  compact,
  canAct,
  onCancel,
  onModify,
}: {
  order: OrderOut;
  compact: boolean;
  canAct: boolean;
  onCancel: () => void;
  onModify: () => void;
}) {
  const terminal = TERMINAL_STATUSES.has(order.status);
  const modifiable = !terminal && order.order_type !== "MARKET";
  return (
    <tr>
      {!compact ? (
        <td>
          <span className="order-id" title={order.client_order_id}>
            {order.client_order_id.slice(0, 8)}
          </span>
        </td>
      ) : null}
      <td>
        <span className="symbol">{order.symbol}</span>
      </td>
      <td className={order.side === "BUY" ? "pos" : "neg"}>{order.side}</td>
      {!compact ? <td>{order.order_type}</td> : null}
      <td className="num">{formatDecimal(order.quantity)}</td>
      <td className="num">{formatDecimal(order.filled_quantity)}</td>
      {!compact ? <td className="num">{formatDecimal(order.remaining_quantity)}</td> : null}
      <td className="num">{formatDecimal(order.limit_price)}</td>
      <td className="num">{formatDecimal(order.stop_price)}</td>
      {!compact ? (
        <td>
          <span className="order-time" title={order.created_at}>
            {new Date(order.created_at).toLocaleTimeString()}
          </span>
        </td>
      ) : null}
      <td>
        <StatusBadge
          tone={orderStatusTone(order.status)}
          label={order.status}
          title={order.rejection_reason ?? undefined}
        />
      </td>
      <td className="row-actions">
        {canAct ? (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={onCancel}
              disabled={terminal}
              title={terminal ? "Order is in a terminal state" : "Cancel this order"}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={onModify}
              disabled={!modifiable}
              title={modifiable ? "Modify prices" : "Only working priced orders can be modified"}
            >
              Modify
            </button>
          </>
        ) : null}
      </td>
    </tr>
  );
}

function ModifyDialog({
  order,
  api,
  onClose,
  onError,
}: {
  order: OrderOut;
  api: ReturnType<typeof useServices>["api"];
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [limitPrice, setLimitPrice] = useState(order.limit_price ?? "");
  const [stopPrice, setStopPrice] = useState(order.stop_price ?? "");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const limitValid = limitPrice === "" || isValidDecimalInput(limitPrice);
  const stopValid = stopPrice === "" || isValidDecimalInput(stopPrice);
  const anyProvided = limitPrice !== "" || stopPrice !== "";

  async function submit() {
    setBusy(true);
    setLocalError(null);
    try {
      const updated = await api.modifyOrder(order.client_order_id, {
        limit_price: limitPrice === "" ? null : limitPrice,
        stop_price: stopPrice === "" ? null : stopPrice,
      });
      ordersStore.update((s) => ({
        ...s,
        byId: { ...s.byId, [updated.client_order_id]: updated },
      }));
      onClose();
    } catch (error) {
      if (isApiError(error)) {
        setLocalError(error.userMessage);
        onError(error.userMessage);
      } else {
        setLocalError("Modify failed.");
        onError("Modify failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Modify order ${order.symbol}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="dialog-title">
          Modify {order.side} {formatDecimal(order.quantity)} {order.symbol}
        </h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (limitValid && stopValid && anyProvided && !busy) void submit();
          }}
        >
          <label className="field">
            <span>Limit price</span>
            <input
              className="input"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={order.limit_price ?? "unchanged"}
            />
          </label>
          <label className="field">
            <span>Stop price</span>
            <input
              className="input"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              placeholder={order.stop_price ?? "unchanged"}
            />
          </label>
          {!limitValid || !stopValid ? (
            <p className="form-error">Prices must be decimal numbers.</p>
          ) : null}
          {!anyProvided ? <p className="form-error">Provide at least one price.</p> : null}
          {localError ? (
            <p className="form-error" role="alert">
              {localError}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Back
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!limitValid || !stopValid || !anyProvided || busy}
            >
              {busy ? "Modifying…" : "Modify order"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
