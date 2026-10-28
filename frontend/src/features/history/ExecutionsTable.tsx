/**
 * Executions table (M5) — READ-ONLY.
 *
 * HONEST DATA STATEMENT (the reason this component exists in this shape):
 * the backend exposes NO execution/fill history endpoint. Fills exist in the
 * domain and travel once inside the `order.partially_filled` / `order.filled`
 * WebSocket payloads, but they are not persisted for querying. What is shown
 * here is therefore exactly what this terminal received live during this
 * session (`stores/executionsStore.ts`) — every row is a real `Fill` the engine
 * published, nothing is derived from an order's status, and the panel says so
 * up front rather than implying a durable execution blotter.
 *
 * A fill per row: a partially filled order that receives three executions
 * produces three rows (the backend sends one Fill per report). Commission and
 * fees are displayed only when the broker supplied them — an absent value is
 * "—", never 0.00, because "not reported" and "free" are different facts.
 */

import { useMemo, useState } from "react";

import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/Status";
import { brokersStore, executionsStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { compareDecimal, formatDecimal, multiplyDecimal } from "../../utils/decimal";
import { formatTimestamp } from "../../utils/time";

type SideFilter = "ALL" | "BUY" | "SELL";
type SortKey = "time" | "quantity" | "price";

export function ExecutionsTable() {
  const { byId, ids, capturedFrom, hasCapture } = useStoreState(executionsStore);
  const { brokers } = useStoreState(brokersStore);

  const [search, setSearch] = useState("");
  const [side, setSide] = useState<SideFilter>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDesc, setSortDesc] = useState(true);

  const brokerName = brokers.length > 0 ? brokers[0].name : null;

  const rows = useMemo(() => {
    const all = ids.map((id) => byId[id]).filter((fill) => fill !== undefined);
    const query = search.trim().toUpperCase();
    const filtered = all.filter((fill) => {
      if (side !== "ALL" && fill.side !== side) return false;
      if (query === "") return true;
      return (
        fill.instrument.symbol.toUpperCase().includes(query) ||
        fill.fill_id.toUpperCase().includes(query) ||
        fill.order_client_id.toUpperCase().includes(query)
      );
    });
    const sorted = filtered.slice();
    sorted.sort((a, b) => {
      let result = 0;
      if (sortKey === "time") {
        result = a.executed_at.localeCompare(b.executed_at); // ISO-8601 UTC
      } else if (sortKey === "quantity") {
        result = compareDecimal(a.quantity.value, b.quantity.value);
      } else {
        result = compareDecimal(a.price.value, b.price.value);
      }
      if (result === 0) result = a.executed_at.localeCompare(b.executed_at);
      return sortDesc ? -result : result;
    });
    return sorted;
  }, [byId, ids, search, side, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(false);
    }
  }

  const header = (key: SortKey, label: string, extraClass = "") => (
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
      title="Executions"
      subtitle="Fills delivered by the trading engine to this terminal — one row per fill"
    >
      <p className="history-callout" role="note">
        <b>Session capture, not persisted history.</b> The backend exposes no execution-history
        endpoint, so fills are captured only while this terminal is connected and reset on reload.
        An order that filled before this session shows no executions here — its{" "}
        <code>filled_quantity</code> is the only surviving record. Absent commission or fees are
        shown as “—” (not reported), never as zero.
      </p>

      <div className="table-toolbar" role="group" aria-label="Execution filters">
        <div
          className="segmented segmented-inline"
          role="radiogroup"
          aria-label="Filter executions by side"
        >
          {(
            [
              { value: "ALL", label: "All" },
              { value: "BUY", label: "Buy" },
              { value: "SELL", label: "Sell" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={side === option.value}
              className={side === option.value ? "seg-active" : undefined}
              onClick={() => setSide(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          className="input input-sm table-toolbar-search"
          aria-label="Search executions"
          placeholder="Symbol, exec or order id…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          maxLength={40}
        />
        <span className="table-toolbar-summary">
          {rows.length} of {ids.length} fills
          {hasCapture && capturedFrom !== null ? (
            <span title={capturedFrom}> · capturing since {formatTimestamp(capturedFrom)}</span>
          ) : null}
        </span>
      </div>

      {ids.length === 0 ? (
        <EmptyState
          message="No executions captured in this session yet."
          detail="A fill appears the moment the engine reports one. Earlier fills are not retrievable — the backend keeps no execution history."
        />
      ) : rows.length === 0 ? (
        <EmptyState message="No executions match the current filters." />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Exec id</th>
                {header("time", "Time")}
                <th>Symbol</th>
                <th>Broker</th>
                <th>Account</th>
                <th>Side</th>
                {header("quantity", "Qty", "num")}
                {header("price", "Price", "num")}
                <th className="num">Notional</th>
                <th className="num">Commission</th>
                <th className="num">Fees</th>
                <th>Order id</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((fill) => {
                const notional = multiplyDecimal(fill.quantity.value, fill.price.value);
                return (
                  <tr key={fill.fill_id} data-testid={`execution-${fill.fill_id}`}>
                    <td>
                      <code className="order-id" title={fill.fill_id}>
                        {fill.fill_id.slice(0, 8)}
                      </code>
                    </td>
                    <td title={fill.executed_at}>{formatTimestamp(fill.executed_at)}</td>
                    <td>
                      <span className="symbol">{fill.instrument.symbol}</span>
                      <span className="symbol-venue">{fill.instrument.exchange}</span>
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
                    <td className="account-cell" title={fill.account_id}>
                      {fill.account_id}
                    </td>
                    <td className={fill.side === "BUY" ? "pos" : "neg"}>{fill.side}</td>
                    <td className="num">{formatDecimal(fill.quantity.value)}</td>
                    <td className="num">{formatDecimal(fill.price.value)}</td>
                    <td className="num">{notional === null ? "—" : formatDecimal(notional)}</td>
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
                    <td>
                      <code className="order-id" title={fill.order_client_id}>
                        {fill.order_client_id.slice(0, 8)}
                      </code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
