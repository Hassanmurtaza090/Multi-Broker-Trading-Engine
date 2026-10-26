/**
 * Portfolio (M3) — instrument allocation card.
 *
 * Renders the currency-grouped gross allocation derived by computeAllocation
 * (pure, unit-tested): per-currency groups of instrument market values with
 * share bars, explicit exclusions (unpriced positions are COUNTED, never
 * zero-filled), and staleness visibility. Derived from the backend's
 * authoritative position marks (quantity × market price, exact string
 * arithmetic); floats only for bar widths (ADR-017).
 */

import { useMemo } from "react";

import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { positionsStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { computeAllocation } from "./allocation";

export function AllocationCard() {
  const { byKey, keys, loadState, errorMessage } = useStoreState(positionsStore);
  const positions = useMemo(() => keys.map((key) => byKey[key]), [byKey, keys]);
  const allocation = useMemo(() => computeAllocation(positions), [positions]);

  return (
    <Panel title="Allocation" subtitle="Gross exposure by instrument (derived from position marks)">
      {loadState === "idle" || (loadState === "loading" && keys.length === 0) ? (
        <LoadingState label="Loading positions…" />
      ) : loadState === "error" && keys.length === 0 ? (
        <ErrorState message={errorMessage ?? "Could not load positions."} />
      ) : keys.length === 0 ? (
        <EmptyState
          message="No positions to allocate."
          detail="Allocation appears after your first executed fill."
        />
      ) : allocation.groups.length === 0 ? (
        <EmptyState
          message="No priced positions."
          detail={
            allocation.unpricedTotal > 0
              ? `${allocation.unpricedTotal} position(s) have no market price yet — excluded rather than shown as zero.`
              : "Waiting for market prices."
          }
        />
      ) : (
        <>
          {allocation.groups.map((group) => (
            <section key={group.currency} className="alloc-group">
              <header className="alloc-group-head">
                <span className="metric-ccy">{group.currency}</span>
                <span className="alloc-gross">
                  Gross <MoneyText value={group.gross} />
                </span>
                {group.staleCount > 0 ? (
                  <StatusBadge
                    tone="warn"
                    label={`${group.staleCount} stale`}
                    title="Some marks are outside the staleness window — values may not reflect current prices"
                  />
                ) : null}
              </header>
              <ul className="alloc-list">
                {group.rows.map((row) => (
                  <li key={`${group.currency}-${row.symbol}`} className="alloc-row">
                    <span className="alloc-symbol">
                      <span className="symbol">{row.symbol}</span>
                      <span className="symbol-venue">{row.exchange}</span>
                    </span>
                    <span className="alloc-bar">
                      <span
                        className="alloc-bar-fill"
                        style={{ width: `${Math.max(row.share * 100, 1.5)}%` }}
                      />
                    </span>
                    <span className="alloc-percent num">{row.percent}%</span>
                    <MoneyText value={row.value} signed />
                  </li>
                ))}
              </ul>
              <p className="portfolio-note">
                {group.rowCount > group.rows.length
                  ? `Showing top ${group.rows.length} of ${group.rowCount} instruments. `
                  : ""}
                {group.unpricedCount > 0
                  ? `${group.unpricedCount} unpriced position(s) excluded. `
                  : ""}
                Shares are within this currency only — never across currencies.
              </p>
            </section>
          ))}
        </>
      )}
    </Panel>
  );
}
