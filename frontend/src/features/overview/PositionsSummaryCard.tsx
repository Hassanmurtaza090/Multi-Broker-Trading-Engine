/**
 * Dashboard (M2) — open-positions summary card.
 *
 * Read-only at-a-glance list (the full Positions view keeps the detail
 * table); every value is the exact-decimal store data, "—" when unreported.
 * No order execution lives on the Dashboard (M2 rule) — the only interaction
 * is the navigation shortcut.
 */

import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { positionsStore, uiStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { formatDecimal, decimalSign } from "../../utils/decimal";

const MAX_ROWS = 5;

export function PositionsSummaryCard() {
  const { byKey, keys, loadState, errorMessage } = useStoreState(positionsStore);

  const openCount = keys.filter((key) => decimalSign(byKey[key].quantity) !== 0).length;
  const rows = keys
    .filter((key) => decimalSign(byKey[key].quantity) !== 0)
    .slice(0, MAX_ROWS)
    .map((key) => byKey[key]);

  return (
    <Panel
      title="Positions"
      subtitle="Open exposure across your account"
      actions={
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => uiStore.update((s) => ({ ...s, view: "positions" }))}
          title="Open the full Positions view"
        >
          View positions
        </button>
      }
    >
      {loadState === "idle" || (loadState === "loading" && keys.length === 0) ? (
        <LoadingState label="Loading positions…" />
      ) : loadState === "error" && keys.length === 0 ? (
        <ErrorState message={errorMessage ?? "Could not load positions."} />
      ) : openCount === 0 ? (
        <EmptyState
          message="No open positions."
          detail="Positions appear after your first executed fill."
        />
      ) : (
        <>
          <p className="snapshot-count">
            <b>{openCount}</b> open position{openCount === 1 ? "" : "s"}
          </p>
          <ul className="snapshot-list">
            {rows.map((position) => (
              <li key={`${position.account_id}|${position.symbol}`} className="snapshot-row">
                <span>
                  <span className="symbol">{position.symbol}</span>
                  <span className="symbol-venue">{position.exchange}</span>
                </span>
                <span
                  className={`num ${decimalSign(position.quantity) > 0 ? "pos" : decimalSign(position.quantity) < 0 ? "neg" : ""}`}
                >
                  {formatDecimal(position.quantity)}
                </span>
                <MoneyText value={position.unrealized_pnl} currency={position.currency} signed />
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
