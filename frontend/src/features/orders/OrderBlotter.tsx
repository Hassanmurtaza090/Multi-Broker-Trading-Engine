/**
 * Order blotter (M11): the live list of orders with cancel/modify actions.
 *
 * - Actionability follows the backend state machine: only non-terminal orders
 *   can be cancelled; only working orders with price terms can be modified.
 * - Server errors surface per-row-context in an action banner (409 double
 *   cancel, 503 broker down, 504 timeout, …) — never silently swallowed.
 * - Cancel is confirmed; modify opens a small dialog (prices only, per M10).
 */

import { useMemo, useState } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Panel } from "../../components/Panel";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { orderStatusTone } from "../../utils/statusTone";
import { StatusBadge } from "../../components/StatusBadge";
import { isApiError } from "../../services/api";
import { useServices } from "../../services/context";
import { ordersStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { TERMINAL_STATUSES, type OrderOut } from "../../types/api";
import { formatDecimal, isValidDecimalInput } from "../../utils/decimal";

type StatusFilter = "ALL" | "OPEN" | "TERMINAL";

export function OrderBlotter({ initialFilter = "ALL" }: { initialFilter?: StatusFilter }) {
  const { api } = useServices();
  const { byId, ids, loadState, errorMessage } = useStoreState(ordersStore);

  const [filter, setFilter] = useState<StatusFilter>(initialFilter);
  const [cancelTarget, setCancelTarget] = useState<OrderOut | null>(null);
  const [modifyTarget, setModifyTarget] = useState<OrderOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = ids.map((id) => byId[id]);
    if (filter === "OPEN") return all.filter((o) => !TERMINAL_STATUSES.has(o.status));
    if (filter === "TERMINAL") return all.filter((o) => TERMINAL_STATUSES.has(o.status));
    return all;
  }, [byId, ids, filter]);

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

  return (
    <Panel
      title="Orders"
      actions={
        <select
          aria-label="Filter orders by status"
          className="input input-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as StatusFilter)}
        >
          <option value="ALL">All</option>
          <option value="OPEN">Open</option>
          <option value="TERMINAL">Done</option>
        </select>
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
          message={filter === "ALL" ? "No orders yet." : `No ${filter.toLowerCase()} orders.`}
          detail="Submit an order from the ticket to see it here."
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Type</th>
              <th className="num">Qty</th>
              <th className="num">Filled</th>
              <th className="num">Limit</th>
              <th className="num">Stop</th>
              <th>Status</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((order) => (
              <OrderRow
                key={order.client_order_id}
                order={order}
                onCancel={() => setCancelTarget(order)}
                onModify={() => setModifyTarget(order)}
              />
            ))}
          </tbody>
        </table>
      )}

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
  onCancel,
  onModify,
}: {
  order: OrderOut;
  onCancel: () => void;
  onModify: () => void;
}) {
  const terminal = TERMINAL_STATUSES.has(order.status);
  const modifiable = !terminal && order.order_type !== "MARKET";
  return (
    <tr>
      <td>
        <span className="symbol">{order.symbol}</span>
      </td>
      <td className={order.side === "BUY" ? "pos" : "neg"}>{order.side}</td>
      <td>{order.order_type}</td>
      <td className="num">{formatDecimal(order.quantity)}</td>
      <td className="num">{formatDecimal(order.filled_quantity)}</td>
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
