/**
 * Positions table (M11 → M4 upgrade).
 *
 * Full mode (Positions view): sortable columns, direction + symbol filters,
 * LONG/SHORT direction chips, the Figma mock's Broker column (runtime broker
 * identity — the gateway binds ONE broker per instance, ADR-016), per-
 * currency unrealized totals (summed WITHIN a currency only — never across
 * currencies), and row-click → chart the instrument on the Trade screen.
 * Compact mode (the Trading Terminal's tabs card): the dense table only —
 * no toolbar, no sorting, no summary line.
 *
 * Data policy unchanged (ADR-013): unpriced values render "—", never an
 * invented zero; stale marks are badged, never silently current.
 *
 * DESIGN NOTE (documented): the Figma prototype has no positions screen;
 * the bottom-card mock's column set (Asset | Broker | Size | Avg. price |
 * Market value | P&L) is honored where the data model supports it. "Market
 * value" per position is NOT a backend field — the authoritative per-row
 * price field (market_price) is shown instead; derived value views live in
 * the Portfolio allocation. Direction (LONG/SHORT) is derived from the
 * signed quantity — the backend's own representation.
 */

import { useMemo, useState } from "react";

import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { brokersStore, marketStore, positionsStore, uiStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { addDecimal, decimalSign, decimalToNumber, formatDecimal } from "../../utils/decimal";
import type { InstrumentDescriptor } from "../../utils/instrument";

type Direction = "all" | "long" | "short";
type SortKey = "default" | "symbol" | "quantity" | "market" | "unrealized";

export function PositionsTable({ compact = false }: { compact?: boolean }) {
  const { byKey, keys, loadState, errorMessage } = useStoreState(positionsStore);
  const { brokers } = useStoreState(brokersStore);

  const [direction, setDirection] = useState<Direction>("all");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDesc, setSortDesc] = useState(false);

  const brokerName = brokers.length > 0 ? brokers[0].name : null;

  const rows = useMemo(() => {
    const all = keys.map((key) => byKey[key]);
    const query = symbolQuery.trim().toUpperCase();
    const filtered = all.filter((position) => {
      if (direction !== "all") {
        const sign = decimalSign(position.quantity);
        if (direction === "long" && sign <= 0) return false;
        if (direction === "short" && sign >= 0) return false;
      }
      if (query !== "" && !position.symbol.toUpperCase().includes(query)) return false;
      return true;
    });
    if (sortKey === "default") return filtered;
    const sorted = filtered.slice();
    sorted.sort((a, b) => {
      let result = 0;
      switch (sortKey) {
        case "symbol":
          result = a.symbol.localeCompare(b.symbol);
          break;
        case "quantity":
          result = (decimalToNumber(a.quantity) ?? 0) - (decimalToNumber(b.quantity) ?? 0);
          break;
        case "market":
          result =
            (decimalToNumber(a.market_price) ?? Number.NEGATIVE_INFINITY) -
            (decimalToNumber(b.market_price) ?? Number.NEGATIVE_INFINITY);
          break;
        case "unrealized":
          result =
            (decimalToNumber(a.unrealized_pnl) ?? Number.NEGATIVE_INFINITY) -
            (decimalToNumber(b.unrealized_pnl) ?? Number.NEGATIVE_INFINITY);
          break;
        default:
          break;
      }
      if (result === 0) result = a.symbol.localeCompare(b.symbol);
      return sortDesc ? -result : result;
    });
    return sorted;
  }, [byKey, keys, direction, symbolQuery, sortKey, sortDesc]);

  // Per-currency unrealized totals for the CURRENT filter — exact string
  // sums WITHIN each currency (cross-currency sums are structurally absent).
  const unrealizedByCcy = useMemo(() => {
    const totals = new Map<string, string>();
    for (const row of rows) {
      if (row.unrealized_pnl === null) continue;
      const current = totals.get(row.currency) ?? "0";
      const next = addDecimal(current, row.unrealized_pnl);
      if (next !== null) totals.set(row.currency, next);
    }
    return totals;
  }, [rows]);

  const longCount = rows.filter((p) => decimalSign(p.quantity) > 0).length;
  const shortCount = rows.filter((p) => decimalSign(p.quantity) < 0).length;

  function onRowClick(position: (typeof rows)[number]) {
    // Positions carry no asset_class; prefer the matching WATCHED instrument
    // (correct identity for quotes/chart). Otherwise construct a descriptor —
    // the chart then shows its honest "waiting for price data" state until
    // the instrument is watched.
    const watched = marketStore
      .getSnapshot()
      .watchlist.find(
        (descriptor) =>
          descriptor.symbol.toUpperCase() === position.symbol.toUpperCase() &&
          descriptor.exchange === position.exchange &&
          descriptor.currency === position.currency,
      );
    const descriptor: InstrumentDescriptor = watched ?? {
      symbol: position.symbol,
      asset_class: "UNKNOWN",
      currency: position.currency,
      exchange: position.exchange,
    };
    uiStore.update((s) => ({ ...s, selectedInstrument: descriptor, view: "dashboard" }));
  }

  function toggleSort(key: Exclude<SortKey, "default">) {
    if (sortKey === key) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(false);
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
    <Panel title="Positions" subtitle={compact ? undefined : "Open exposure with live marks"}>
      {!compact && (
        <div className="table-toolbar" role="group" aria-label="Position filters">
          <div
            className="segmented segmented-inline"
            role="radiogroup"
            aria-label="Filter positions by direction"
          >
            {(
              [
                { value: "all", label: "All" },
                { value: "long", label: "Long" },
                { value: "short", label: "Short" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={direction === option.value}
                className={direction === option.value ? "seg-active" : undefined}
                onClick={() => setDirection(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            className="input input-sm table-toolbar-search"
            aria-label="Filter positions by symbol"
            placeholder="Filter symbol…"
            value={symbolQuery}
            onChange={(e) => setSymbolQuery(e.target.value)}
            maxLength={20}
          />
          {rows.length > 0 ? (
            <span className="table-toolbar-summary">
              {longCount} long · {shortCount} short
              {[...unrealizedByCcy].map(([ccy, total]) => (
                <span key={`u-${ccy}`} className="num">
                  {" "}
                  Unrealized {ccy} <b>{formatDecimal(total)}</b>
                </span>
              ))}
            </span>
          ) : null}
        </div>
      )}

      {loadState === "idle" || (loadState === "loading" && keys.length === 0) ? (
        <LoadingState label="Loading positions…" />
      ) : loadState === "error" && keys.length === 0 ? (
        <ErrorState message={errorMessage ?? "Could not load positions."} />
      ) : keys.length === 0 ? (
        <EmptyState
          message="No open positions."
          detail="Positions appear after your first executed fill."
        />
      ) : rows.length === 0 ? (
        <EmptyState message="No positions match the current filters." />
      ) : (
        <div className="table-scroll">
          <table className="data-table watchlist-table">
            <thead>
              <tr>
                {header("symbol", "Symbol")}
                <th title="The gateway binds one broker account per runtime (ADR-016) — every position executes through this broker.">
                  Broker
                </th>
                <th>Direction</th>
                {header("quantity", "Qty", "num")}
                <th className="num">Avg Price</th>
                {header("market", "Market", "num")}
                <th className="num">Realized</th>
                {header("unrealized", "Unrealized", "num")}
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((position) => (
                <PositionRow
                  key={`${position.account_id}|${position.symbol}`}
                  position={position}
                  brokerName={brokerName}
                  onClick={() => onRowClick(position)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function PositionRow({
  position,
  brokerName,
  onClick,
}: {
  position: {
    account_id: string;
    symbol: string;
    exchange: string;
    currency: string;
    quantity: string;
    average_price: string | null;
    realized_pnl: string | null;
    unrealized_pnl: string | null;
    market_price: string | null;
    stale: boolean;
  };
  brokerName: string | null;
  onClick: () => void;
}) {
  const sign = decimalSign(position.quantity);
  const direction = sign > 0 ? "long" : sign < 0 ? "short" : "flat";
  return (
    <tr
      onClick={onClick}
      title="Chart this instrument on the Trade screen"
      style={{ cursor: "pointer" }}
      data-testid={`position-${position.symbol}`}
    >
      <td>
        <span className="symbol">{position.symbol}</span>
        <span className="symbol-venue">{position.exchange}</span>
      </td>
      <td>
        <span className="broker-tag" title={brokerName ?? "Runtime broker not reported yet"}>
          <b className="ib-mini" aria-hidden="true">
            {(brokerName ?? "??").slice(0, 2).toUpperCase()}
          </b>{" "}
          {brokerName ?? "—"}
        </span>
      </td>
      <td>
        <span className={`dir-chip dir-${direction}`}>
          {direction === "long" ? "LONG" : direction === "short" ? "SHORT" : "FLAT"}
        </span>
      </td>
      <td className={`num ${sign > 0 ? "pos" : sign < 0 ? "neg" : ""}`}>
        {formatDecimal(position.quantity)}
      </td>
      <td className="num">{formatDecimal(position.average_price)}</td>
      <td className="num">{formatDecimal(position.market_price)}</td>
      <td className="num">
        <MoneyText value={position.realized_pnl} currency={position.currency} signed />
      </td>
      <td className="num">
        <MoneyText value={position.unrealized_pnl} currency={position.currency} signed />
      </td>
      <td>
        {position.stale ? (
          <StatusBadge
            tone="warn"
            label="Stale"
            title="Market data is stale — values may not reflect current prices"
          />
        ) : (
          <StatusBadge tone="ok" label="Fresh" />
        )}
      </td>
    </tr>
  );
}
