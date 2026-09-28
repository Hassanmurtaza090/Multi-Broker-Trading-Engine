/**
 * Watchlist panel (M11): watched instruments with live/polled quotes.
 *
 * Quotes come from WS pushes (when the engine is subscribed) and from REST
 * polling (M10 has no subscribe endpoint — see PROJECT_STATUS limitations).
 * Stale data is always badged (TS-007); missing quotes are an explicit state,
 * never a silent blank.
 */

import { useState } from "react";

import { Panel } from "../../components/Panel";
import { MoneyText } from "../../components/MoneyText";
import { StatusBadge } from "../../components/StatusBadge";
import { config } from "../../config";
import { marketStore, uiStore } from "../../stores";
import { isQuoteStale, removeWatch, type QuoteView } from "../../stores/marketStore";
import { useStoreState } from "../../stores/store";
import { ASSET_CLASSES, EXCHANGES } from "../../types/api";
import { instrumentKey, type InstrumentDescriptor } from "../../utils/instrument";

const DEFAULT_WATCH: InstrumentDescriptor = {
  symbol: "AAPL",
  asset_class: "EQUITY",
  currency: "USD",
  exchange: "NASDAQ",
};

export function WatchlistPanel() {
  const { watchlist, quotes, quoteFetch, clockTick } = useStoreState(marketStore);
  const { selectedInstrument } = useStoreState(uiStore);

  const selectedKey = selectedInstrument ? instrumentKey(selectedInstrument) : null;

  return (
    <Panel title="Watchlist" actions={<AddWatchForm />}>
      {watchlist.length === 0 ? (
        <div className="state state-empty" role="note">
          <p>Watchlist is empty.</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => marketStore.update((s) => ({ ...s, watchlist: [DEFAULT_WATCH] }))}
          >
            Add AAPL (demo)
          </button>
        </div>
      ) : (
        <table className="data-table watchlist-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="num">Bid</th>
              <th className="num">Ask</th>
              <th className="num">Last</th>
              <th>State</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {watchlist.map((descriptor) => {
              const key = instrumentKey(descriptor);
              const quote = quotes[key];
              const fetchState = quoteFetch[key] ?? "idle";
              const stale = quote ? isQuoteStale(quote, clockTick, config.staleWindowMs) : false;
              return (
                <WatchRow
                  key={key}
                  descriptor={descriptor}
                  quote={quote}
                  fetchState={fetchState}
                  stale={stale}
                  selected={selectedKey === key}
                  onSelect={() => uiStore.update((s) => ({ ...s, selectedInstrument: descriptor }))}
                  onRemove={() => marketStore.update((s) => removeWatch(s, descriptor))}
                />
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

interface WatchRowProps {
  descriptor: InstrumentDescriptor;
  quote: QuoteView | undefined;
  fetchState: string;
  stale: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

function WatchRow({
  descriptor,
  quote,
  fetchState,
  stale,
  selected,
  onSelect,
  onRemove,
}: WatchRowProps) {
  return (
    <tr
      className={selected ? "row-selected" : undefined}
      onClick={onSelect}
      data-testid={`watch-${descriptor.symbol}`}
    >
      <td>
        <span className="symbol">{descriptor.symbol.toUpperCase()}</span>
        <span className="symbol-venue">{descriptor.exchange}</span>
      </td>
      <td className="num">{quote ? <MoneyText value={quote.bid} /> : "—"}</td>
      <td className="num">{quote ? <MoneyText value={quote.ask} /> : "—"}</td>
      <td className="num">{quote ? <MoneyText value={quote.last} /> : "—"}</td>
      <td>
        {fetchState === "loading" && !quote ? (
          <StatusBadge tone="muted" label="…" />
        ) : fetchState === "missing" ? (
          <StatusBadge
            tone="muted"
            label="No data"
            title="The engine has no quote for this instrument yet"
          />
        ) : fetchState === "error" ? (
          <StatusBadge tone="danger" label="Error" />
        ) : stale ? (
          <StatusBadge
            tone="warn"
            label="Stale"
            title="No fresh data within the staleness window"
          />
        ) : quote ? (
          <StatusBadge tone="ok" label={quote.lastStreamAt !== null ? "Live" : "Polled"} />
        ) : (
          <StatusBadge tone="muted" label="—" />
        )}
      </td>
      <td>
        <button
          type="button"
          className="btn btn-icon"
          aria-label={`Remove ${descriptor.symbol} from watchlist`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </td>
    </tr>
  );
}

function AddWatchForm() {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [assetClass, setAssetClass] = useState<string>("EQUITY");
  const [currency, setCurrency] = useState("USD");
  const [exchange, setExchange] = useState<string>("UNKNOWN");

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        + Watch
      </button>
    );
  }

  const trimmed = symbol.trim();
  const valid = trimmed.length > 0 && /^[A-Z0-9./-]{1,20}$/i.test(trimmed);

  function submit() {
    if (!valid) return;
    const descriptor: InstrumentDescriptor = {
      symbol: trimmed.toUpperCase(),
      asset_class: assetClass,
      currency: currency.toUpperCase(),
      exchange,
    };
    marketStore.update((s) => ({
      ...s,
      watchlist: s.watchlist.some((d) => instrumentKey(d) === instrumentKey(descriptor))
        ? s.watchlist
        : [...s.watchlist, descriptor],
    }));
    uiStore.update((s) => ({ ...s, selectedInstrument: descriptor }));
    setOpen(false);
    setSymbol("");
  }

  return (
    <form
      className="watch-add-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        aria-label="Symbol"
        placeholder="Symbol"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        className="input input-sm"
        maxLength={20}
      />
      <select
        aria-label="Asset class"
        value={assetClass}
        onChange={(e) => setAssetClass(e.target.value)}
        className="input input-sm"
      >
        {ASSET_CLASSES.map((ac) => (
          <option key={ac} value={ac}>
            {ac}
          </option>
        ))}
      </select>
      <input
        aria-label="Currency"
        placeholder="CCY"
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        className="input input-sm input-ccy"
        maxLength={3}
      />
      <select
        aria-label="Exchange"
        value={exchange}
        onChange={(e) => setExchange(e.target.value)}
        className="input input-sm"
      >
        {EXCHANGES.map((ex) => (
          <option key={ex} value={ex}>
            {ex}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-primary" disabled={!valid}>
        Add
      </button>
    </form>
  );
}
