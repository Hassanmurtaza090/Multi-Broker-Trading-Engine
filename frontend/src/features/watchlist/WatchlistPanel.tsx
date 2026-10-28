/**
 * Markets panel (M11 watchlist → M1 Figma "Markets" card).
 *
 * The Figma markets card: asset-class tabs, instrument rows with coin icons,
 * per-row sparkline, live/stale badges — all driven by the REAL quote store
 * (WS pushes + REST polling; no subscribe endpoint exists in M10).
 *
 * Honesty deltas vs. the Figma mock (documented):
 * - No "24H change" column: the API exposes no day-open/change data.
 *   Bid/Ask columns show real quote fields instead.
 * - The asset-class tabs are real client-side filters (Watchlist / Crypto /
 *   Stocks / Forex), not decorative; the header search filters this list too.
 * - No "View all markets" link: no markets catalogue endpoint exists.
 */

import { useMemo, useState } from "react";

import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { Sparkline } from "../../components/Sparkline";
import { StatusBadge } from "../../components/StatusBadge";
import { config } from "../../config";
import { marketStore, uiStore } from "../../stores";
import { isQuoteStale, removeWatch, type QuoteView } from "../../stores/marketStore";
import { useStoreState } from "../../stores/store";
import { DEFAULT_LIST_NAME, watchlistActions } from "../../stores/watchlistsStore";
import { ASSET_CLASSES, EXCHANGES } from "../../types/api";
import { instrumentKey, type InstrumentDescriptor } from "../../utils/instrument";
import { toneForAssetClass } from "../../utils/instrumentTone";
import { quoteStateBadge } from "./quoteState";

const DEFAULT_WATCH: InstrumentDescriptor = {
  symbol: "AAPL",
  asset_class: "EQUITY",
  currency: "USD",
  exchange: "NASDAQ",
};

const MARKET_TABS = [
  { id: "all", label: "Watchlist", assetClass: null },
  { id: "crypto", label: "Crypto", assetClass: "CRYPTO" },
  { id: "stocks", label: "Stocks", assetClass: "EQUITY" },
  { id: "forex", label: "Forex", assetClass: "FOREX" },
] as const;

type MarketTabId = (typeof MARKET_TABS)[number]["id"];

/**
 * M6: the dashboard card edits the ACTIVE named watchlist (the store that owns
 * the lists and persists them) rather than poking `marketStore.watchlist`
 * directly — otherwise a list mutation elsewhere would silently overwrite an
 * instrument added here. If every list was deleted, a default list is created
 * first so the action always succeeds on screen.
 */
function addToActiveWatchlist(descriptor: InstrumentDescriptor): void {
  const result = watchlistActions.addInstrument(descriptor);
  if (result === "no-list") {
    watchlistActions.create(DEFAULT_LIST_NAME);
    watchlistActions.addInstrument(descriptor);
  }
}

export function WatchlistPanel() {
  const { watchlist, quotes, history, quoteFetch, clockTick } = useStoreState(marketStore);
  const { selectedInstrument, watchFilter } = useStoreState(uiStore);
  const [activeTab, setActiveTab] = useState<MarketTabId>("all");

  const selectedKey = selectedInstrument ? instrumentKey(selectedInstrument) : null;

  const filtered = useMemo(() => {
    const tab = MARKET_TABS.find((t) => t.id === activeTab);
    const query = watchFilter.trim().toUpperCase();
    return watchlist.filter((descriptor) => {
      if (tab?.assetClass !== null && descriptor.asset_class !== tab?.assetClass) return false;
      if (query === "") return true;
      return (
        descriptor.symbol.toUpperCase().includes(query) ||
        descriptor.exchange.toUpperCase().includes(query)
      );
    });
  }, [watchlist, activeTab, watchFilter]);

  function clearFilters() {
    setActiveTab("all");
    uiStore.update((s) => ({ ...s, watchFilter: "" }));
  }

  return (
    <Panel
      title="Markets"
      subtitle="Live quotes across connected venues"
      className="panel-flush"
      actions={<AddWatchForm />}
    >
      {watchlist.length === 0 ? (
        <div className="state state-empty" role="note">
          <p>Watchlist is empty.</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => addToActiveWatchlist(DEFAULT_WATCH)}
          >
            Add AAPL (demo)
          </button>
        </div>
      ) : (
        <>
          <div className="market-tabs" role="tablist" aria-label="Market groups">
            {MARKET_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? "mt-btn-active" : undefined}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="state state-empty" role="note">
              <p>No instruments match.</p>
              <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          ) : (
            <table className="data-table watchlist-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th className="num">Last</th>
                  <th className="num">Bid</th>
                  <th className="num">Ask</th>
                  <th>Chart</th>
                  <th>State</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((descriptor) => {
                  const key = instrumentKey(descriptor);
                  const quote = quotes[key];
                  const fetchState = quoteFetch[key] ?? "idle";
                  const stale = quote
                    ? isQuoteStale(quote, clockTick, config.staleWindowMs)
                    : false;
                  return (
                    <WatchRow
                      key={key}
                      descriptor={descriptor}
                      quote={quote}
                      points={history[key] ?? []}
                      fetchState={fetchState}
                      stale={stale}
                      selected={selectedKey === key}
                      onSelect={() =>
                        uiStore.update((s) => ({ ...s, selectedInstrument: descriptor }))
                      }
                      onRemove={() => {
                        const removed = watchlistActions.removeInstrument(descriptor);
                        // Defensive: a row that belongs to no list (e.g. state
                        // seeded by a test or another view) can still be
                        // removed from the rendered quote table.
                        if (!removed) {
                          marketStore.update((s) => removeWatch(s, descriptor));
                        }
                      }}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </Panel>
  );
}

interface WatchRowProps {
  descriptor: InstrumentDescriptor;
  quote: QuoteView | undefined;
  points: { t: number; price: number }[];
  fetchState: string;
  stale: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

function WatchRow({
  descriptor,
  quote,
  points,
  fetchState,
  stale,
  selected,
  onSelect,
  onRemove,
}: WatchRowProps) {
  const tone = toneForAssetClass(descriptor.asset_class);
  return (
    <tr
      className={selected ? "row-selected" : undefined}
      onClick={onSelect}
      data-testid={`watch-${descriptor.symbol}`}
    >
      <td>
        <span className="instrument">
          <i className={`instrument-icon ${tone}`} aria-hidden="true">
            {descriptor.symbol.charAt(0).toUpperCase()}
          </i>
          <span className="instrument-id">
            <strong>{descriptor.symbol.toUpperCase()}</strong>
            <small>
              {descriptor.asset_class} · {descriptor.exchange}
            </small>
          </span>
        </span>
      </td>
      <td className="num">{quote ? <MoneyText value={quote.last} /> : "—"}</td>
      <td className="num">{quote ? <MoneyText value={quote.bid} /> : "—"}</td>
      <td className="num">{quote ? <MoneyText value={quote.ask} /> : "—"}</td>
      <td>
        <span className="row-spark">
          <Sparkline
            showHeader={false}
            width={72}
            height={27}
            points={points}
            last={quote?.last ?? null}
          />
        </span>
      </td>
      <td>
        <StatusBadge {...quoteStateBadge(quote, fetchState, stale)} />
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
    addToActiveWatchlist(descriptor);
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
