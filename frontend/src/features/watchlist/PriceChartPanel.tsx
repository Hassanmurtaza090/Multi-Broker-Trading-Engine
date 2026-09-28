/**
 * Price chart panel (M11): recent last-price history for the selected
 * watchlist instrument (fed by WS quote pushes; REST polls seed the current
 * quote when streaming is absent).
 */

import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/Status";
import { Sparkline } from "../../components/Sparkline";
import { marketStore, uiStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { instrumentKey, instrumentLabel } from "../../utils/instrument";

export function PriceChartPanel() {
  const { selectedInstrument } = useStoreState(uiStore);
  const { quotes, history } = useStoreState(marketStore);

  if (selectedInstrument === null) {
    return (
      <Panel title="Chart">
        <EmptyState
          message="No instrument selected."
          detail="Select a watchlist row to chart its recent prices."
        />
      </Panel>
    );
  }

  const key = instrumentKey(selectedInstrument);
  const quote = quotes[key];
  const points = history[key] ?? [];

  return (
    <Panel title={`Chart — ${instrumentLabel(selectedInstrument)}`}>
      <Sparkline points={points} last={quote?.last ?? null} />
      {quote ? (
        <div className="chart-quote-row">
          <span>
            Bid <strong>{quote.bid ?? "—"}</strong>
          </span>
          <span>
            Ask <strong>{quote.ask ?? "—"}</strong>
          </span>
          <span>
            Last <strong>{quote.last ?? "—"}</strong>
          </span>
        </div>
      ) : (
        <p className="state-detail">No quote received yet.</p>
      )}
    </Panel>
  );
}
