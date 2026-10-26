/**
 * Dashboard (M2) — watchlist snapshot card.
 *
 * Read-only quote glance (the interactive Markets card with its add/remove
 * forms stays on the Trade screen). Selecting a row jumps to the Trade view
 * with that instrument charted — the only interaction, and it is real.
 */

import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import { config } from "../../config";
import { marketStore, uiStore } from "../../stores";
import { isQuoteStale } from "../../stores/marketStore";
import { useStoreState } from "../../stores/store";
import { instrumentKey } from "../../utils/instrument";
import { quoteStateBadge } from "../watchlist/quoteState";

const MAX_ROWS = 6;

export function WatchlistSnapshot() {
  const { watchlist, quotes, quoteFetch, clockTick } = useStoreState(marketStore);

  return (
    <Panel
      title="Watchlist"
      subtitle="Live quote snapshot"
      actions={
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => uiStore.update((s) => ({ ...s, view: "dashboard" }))}
          title="Open the Trade screen"
        >
          Open Trade
        </button>
      }
    >
      {watchlist.length === 0 ? (
        <div className="state state-empty" role="note">
          <p>Watchlist is empty.</p>
          <p className="state-detail">Add instruments from the Markets card on the Trade screen.</p>
        </div>
      ) : (
        <ul className="snapshot-list snapshot-selectable">
          {watchlist.slice(0, MAX_ROWS).map((descriptor) => {
            const key = instrumentKey(descriptor);
            const quote = quotes[key];
            const fetchState = quoteFetch[key] ?? "idle";
            const stale =
              quote !== undefined && isQuoteStale(quote, clockTick, config.staleWindowMs);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="snapshot-row snapshot-row-btn"
                  onClick={() =>
                    uiStore.update((s) => ({
                      ...s,
                      selectedInstrument: descriptor,
                      view: "dashboard",
                    }))
                  }
                  title={`Chart ${descriptor.symbol} on the Trade screen`}
                >
                  <span>
                    <span className="symbol">{descriptor.symbol.toUpperCase()}</span>
                    <span className="symbol-venue">{descriptor.exchange}</span>
                  </span>
                  <MoneyText value={quote?.last ?? null} />
                  <StatusBadge {...quoteStateBadge(quote, fetchState, stale)} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
