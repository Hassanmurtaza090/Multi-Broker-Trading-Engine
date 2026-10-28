/**
 * Order detail dialog (M5) — read-only inspection of one order.
 *
 * The dialog opens from the order-history row with the snapshot the terminal
 * already holds, then refreshes it from `GET /orders/{client_order_id}` (the
 * backend's single-order endpoint, M13) so the inspection is not stale. If the
 * refresh fails, the cached snapshot is shown with an explicit warning — never
 * silently presented as fresh.
 *
 * The executions section shows only fills this terminal actually received
 * (see `stores/executionsStore.ts`): the backend persists no per-fill records,
 * so for an order filled before this session the honest answer is "no
 * execution records available", not a synthesized row from `filled_quantity`.
 *
 * This module is READ-ONLY: no submit/modify/cancel control exists here.
 */

import { useEffect, useState } from "react";

import { MoneyText } from "../../components/MoneyText";
import { StatusBadge } from "../../components/StatusBadge";
import { isApiError } from "../../services/api";
import { useServices } from "../../services/context";
import { brokersStore, executionsStore } from "../../stores";
import { fillsForOrder } from "../../stores/executionsStore";
import { useStoreState } from "../../stores/store";
import type { OrderOut } from "../../types/api";
import { formatDecimal, multiplyDecimal } from "../../utils/decimal";
import { orderStatusTone } from "../../utils/statusTone";
import { formatTimestamp } from "../../utils/time";

export function OrderDetailDialog({ order, onClose }: { order: OrderOut; onClose: () => void }) {
  const { api } = useServices();
  const { brokers } = useStoreState(brokersStore);
  const executions = useStoreState(executionsStore);

  const [current, setCurrent] = useState<OrderOut>(order);
  const [refreshing, setRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    setRefreshError(null);
    void (async () => {
      try {
        const latest = await api.getOrder(order.client_order_id);
        // Guard against a mock/transport returning nothing usable.
        if (!cancelled && latest && typeof latest.client_order_id === "string") {
          setCurrent(latest);
        }
      } catch (error) {
        if (!cancelled) {
          setRefreshError(
            isApiError(error) ? error.userMessage : "Could not refresh this order from the server.",
          );
        }
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, order.client_order_id]);

  const relatedFills = fillsForOrder(executions, current.client_order_id);
  const brokerName = brokers.length > 0 ? brokers[0].name : null;
  const notional =
    current.limit_price === null
      ? null
      : multiplyDecimal(current.limit_price, current.filled_quantity);

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Order ${current.symbol} details`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <h3 className="dialog-title">
            {current.side} {formatDecimal(current.quantity)} {current.symbol}
            <span className="dialog-title-sub">
              {current.order_type} · {current.time_in_force} · {current.exchange}
            </span>
          </h3>
          <StatusBadge
            tone={orderStatusTone(current.status)}
            label={current.status}
            title={current.rejection_reason ?? undefined}
          />
        </div>

        <p className="detail-id">
          Order id <code title={current.client_order_id}>{current.client_order_id}</code>
        </p>

        {refreshing ? <p className="detail-note">Refreshing from the server…</p> : null}
        {refreshError !== null ? (
          <p className="form-error" role="alert">
            {refreshError} Showing the last snapshot this terminal received.
          </p>
        ) : null}

        <dl className="detail-grid">
          <div>
            <dt>Account</dt>
            <dd>{current.account_id}</dd>
          </div>
          <div>
            <dt>Broker</dt>
            <dd>{brokerName ?? "—"}</dd>
          </div>
          <div>
            <dt>Filled</dt>
            <dd className="num">{formatDecimal(current.filled_quantity)}</dd>
          </div>
          <div>
            <dt>Remaining</dt>
            <dd className="num">{formatDecimal(current.remaining_quantity)}</dd>
          </div>
          <div>
            <dt>Limit price</dt>
            <dd className="num">{formatDecimal(current.limit_price)}</dd>
          </div>
          <div>
            <dt>Stop price</dt>
            <dd className="num">{formatDecimal(current.stop_price)}</dd>
          </div>
          <div>
            <dt>Filled notional (at limit)</dt>
            <dd className="num">{notional === null ? "—" : formatDecimal(notional)}</dd>
          </div>
          <div>
            <dt>Broker order id</dt>
            <dd>
              <code>{current.broker_order_id ?? "—"}</code>
            </dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd title={current.created_at}>{formatTimestamp(current.created_at)}</dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd title={current.updated_at}>{formatTimestamp(current.updated_at)}</dd>
          </div>
        </dl>

        {current.rejection_reason !== null ? (
          <section className="detail-section" aria-label="Rejection reason">
            <h4>Rejection reason</h4>
            <p className="detail-reject">{current.rejection_reason}</p>
          </section>
        ) : null}

        <section className="detail-section" aria-label="Executions for this order">
          <h4>Executions ({relatedFills.length})</h4>
          {relatedFills.length === 0 ? (
            <p className="detail-note">
              No execution records received for this order in this session. The backend does not
              persist per-fill records, so fills that happened before this terminal connected (or
              before a reload) cannot be listed — the order's filled quantity is the only surviving
              evidence.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Exec id</th>
                    <th>Time</th>
                    <th>Side</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th className="num">Commission</th>
                    <th className="num">Fees</th>
                  </tr>
                </thead>
                <tbody>
                  {relatedFills.map((fill) => (
                    <tr key={fill.fill_id}>
                      <td>
                        <code className="order-id" title={fill.fill_id}>
                          {fill.fill_id.slice(0, 8)}
                        </code>
                      </td>
                      <td title={fill.executed_at}>{formatTimestamp(fill.executed_at)}</td>
                      <td className={fill.side === "BUY" ? "pos" : "neg"}>{fill.side}</td>
                      <td className="num">{formatDecimal(fill.quantity.value)}</td>
                      <td className="num">{formatDecimal(fill.price.value)}</td>
                      <td className="num">
                        <MoneyText
                          value={fill.commission?.amount ?? null}
                          currency={fill.commission?.currency.code ?? fill.price.currency.code}
                        />
                      </td>
                      <td className="num">
                        <MoneyText
                          value={fill.fees?.amount ?? null}
                          currency={fill.fees?.currency.code ?? fill.price.currency.code}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
