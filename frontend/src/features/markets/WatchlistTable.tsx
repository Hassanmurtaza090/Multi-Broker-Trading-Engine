/**
 * Active watchlist — instruments, quotes, and list management (M6).
 *
 * Data provenance (see `stores/watchlistsStore.ts` and `stores/marketStore.ts`):
 * the instrument set is the user's own list; every price comes from the ONE
 * market-data pipeline the terminal already owns — `GET /market/quote` polled
 * per instrument plus `market.quote.updated` pushes on the existing WebSocket.
 * This screen opens no second connection, starts no additional polling, and
 * performs no market-data arithmetic of its own.
 *
 * Honest quote semantics, all visible in the UI:
 * - Live / Polled / Stale / No data / Error come from the shared
 *   `quoteStateBadge` mapping, so this table can never disagree with the
 *   dashboard card about freshness.
 * - "Session Δ" is the change across the quotes THIS terminal received in this
 *   session (see `sessionChange.ts`) — explicitly not a daily/24H change,
 *   which the provider does not report.
 * - Missing bid/ask/last render "—" through `MoneyText`; a missing value is
 *   never a zero.
 * - No market-session ("open/closed") indicator exists: the API exposes none.
 */

import { useMemo, useState } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState } from "../../components/Status";
import { config } from "../../config";
import { marketStore, uiStore } from "../../stores";
import { isQuoteStale, type QuoteFetchState, type QuoteView } from "../../stores/marketStore";
import { useStoreState } from "../../stores/store";
import {
  MAX_INSTRUMENTS_PER_LIST,
  MAX_LIST_NAME_LENGTH,
  watchlistActions,
  type NamedWatchlist,
} from "../../stores/watchlistsStore";
import { ASSET_CLASSES, EXCHANGES } from "../../types/api";
import { compareDecimal } from "../../utils/decimal";
import {
  instrumentKey,
  normalizeDescriptor,
  type InstrumentDescriptor,
} from "../../utils/instrument";
import { toneForAssetClass } from "../../utils/instrumentTone";
import { formatTimeOfDay } from "../../utils/time";
import { quoteStateBadge } from "../watchlist/quoteState";
import {
  formatSignedNumber,
  formatSignedPercent,
  sessionChange,
  type SessionChange,
} from "./sessionChange";

/** Demo instrument that the simulated engine actually quotes (NASDAQ venue). */
const DEMO_INSTRUMENT: InstrumentDescriptor = {
  symbol: "AAPL",
  asset_class: "EQUITY",
  currency: "USD",
  exchange: "NASDAQ",
  name: null,
};

type SortKey = "symbol" | "last" | "bid" | "ask" | "change";

interface Row {
  descriptor: InstrumentDescriptor;
  key: string;
  quote: QuoteView | undefined;
  name: string | null;
  fetchState: QuoteFetchState;
  stale: boolean;
  change: SessionChange | null;
}

const SYMBOL_PATTERN = /^[A-Z0-9./-]{1,20}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/i;

/** Numeric decimal ordering; unknown values always sort last (either direction). */
function orderedDecimal(a: string | null, b: string | null, desc: boolean): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = compareDecimal(a, b);
  return desc ? -cmp : cmp;
}

function orderedNumber(a: number | null, b: number | null, desc: boolean): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return desc ? b - a : a - b;
}

export function WatchlistTable({
  list,
  listCount,
}: {
  list: NamedWatchlist | undefined;
  listCount: number;
}) {
  const { quotes, quoteFetch, history, clockTick } = useStoreState(marketStore);
  const { watchFilter, selectedInstrument } = useStoreState(uiStore);

  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDesc, setSortDesc] = useState(false);
  const [assetFilter, setAssetFilter] = useState<string>("ALL");
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; message: string } | null>(null);

  const instruments = useMemo<InstrumentDescriptor[]>(() => list?.instruments ?? [], [list]);
  const listName = list?.name ?? "";
  const selectedKey = selectedInstrument ? instrumentKey(selectedInstrument) : null;

  const assetClassOptions = useMemo(() => {
    const present = new Set(instruments.map((instrument) => instrument.asset_class));
    return [...present].sort();
  }, [instruments]);

  const allRows = useMemo<Row[]>(() => {
    return instruments.map((descriptor) => {
      const key = instrumentKey(descriptor);
      const quote = quotes[key];
      return {
        descriptor,
        key,
        quote,
        // A name is displayed only when a payload carried one; it is never
        // synthesized from the symbol.
        name: quote?.descriptor.name ?? descriptor.name ?? null,
        fetchState: quoteFetch[key] ?? "idle",
        stale: quote ? isQuoteStale(quote, clockTick, config.staleWindowMs) : false,
        change: sessionChange(history[key] ?? []),
      };
    });
  }, [instruments, quotes, quoteFetch, history, clockTick]);

  const rows = useMemo(() => {
    const query = watchFilter.trim().toUpperCase();
    const filtered = allRows.filter((row) => {
      if (assetFilter !== "ALL" && row.descriptor.asset_class !== assetFilter) return false;
      if (query === "") return true;
      return (
        row.descriptor.symbol.toUpperCase().includes(query) ||
        row.descriptor.exchange.toUpperCase().includes(query) ||
        row.descriptor.asset_class.toUpperCase().includes(query) ||
        (row.name ?? "").toUpperCase().includes(query)
      );
    });
    const sorted = filtered.slice();
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "last":
          cmp = orderedDecimal(a.quote?.last ?? null, b.quote?.last ?? null, sortDesc);
          break;
        case "bid":
          cmp = orderedDecimal(a.quote?.bid ?? null, b.quote?.bid ?? null, sortDesc);
          break;
        case "ask":
          cmp = orderedDecimal(a.quote?.ask ?? null, b.quote?.ask ?? null, sortDesc);
          break;
        case "change":
          cmp = orderedNumber(a.change?.absolute ?? null, b.change?.absolute ?? null, sortDesc);
          break;
        case "symbol":
        default:
          cmp = a.descriptor.symbol.localeCompare(b.descriptor.symbol);
          if (sortDesc) cmp = -cmp;
          break;
      }
      if (cmp === 0) cmp = a.descriptor.symbol.localeCompare(b.descriptor.symbol);
      return cmp;
    });
    return sorted;
  }, [allRows, assetFilter, watchFilter, sortKey, sortDesc]);

  const quoted = allRows.filter((row) => row.fetchState === "ready").length;
  const staleCount = allRows.filter((row) => row.stale).length;
  const missing = allRows.filter((row) => row.fetchState === "missing").length;
  const errored = allRows.filter((row) => row.fetchState === "error").length;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc((previous) => !previous);
    } else {
      setSortKey(key);
      // Text sorts ascending first; numeric columns most useful descending.
      setSortDesc(key !== "symbol");
    }
  }

  function report(tone: "ok" | "error", message: string) {
    setFeedback({ tone, message });
  }

  function addInstrument(descriptor: InstrumentDescriptor): void {
    const result =
      list === undefined ? "no-list" : watchlistActions.addInstrument(descriptor, list.id);
    if (result === "added") {
      report("ok", `${descriptor.symbol} · ${descriptor.exchange} added to ${listName}.`);
      return;
    }
    if (result === "duplicate") {
      report("error", `${descriptor.symbol} · ${descriptor.exchange} is already in ${listName}.`);
      return;
    }
    if (result === "limit") {
      report("error", `A watchlist holds at most ${MAX_INSTRUMENTS_PER_LIST} instruments.`);
      return;
    }
    report("error", "The selected watchlist no longer exists.");
  }

  function removeInstrument(descriptor: InstrumentDescriptor): void {
    if (list === undefined) return;
    const removed = watchlistActions.removeInstrument(descriptor, list.id);
    report(
      removed ? "ok" : "error",
      removed
        ? `${descriptor.symbol} removed from ${listName}.`
        : `${descriptor.symbol} was not in ${listName}.`,
    );
  }

  function submitRename(event: React.FormEvent) {
    event.preventDefault();
    if (list === undefined) return;
    const result = watchlistActions.rename(list.id, renameValue);
    if (result.ok) {
      setRenaming(false);
      setRenameError(null);
      report("ok", "Watchlist renamed.");
      return;
    }
    setRenameError(
      result.reason === "blank"
        ? "Enter a name for the watchlist."
        : result.reason === "duplicate"
          ? "Another watchlist already uses that name."
          : "That watchlist no longer exists.",
    );
  }

  function header(key: SortKey, label: string, extraClass = "", title?: string) {
    return (
      <th className={extraClass} title={title}>
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
  }

  if (list === undefined) {
    return (
      <Panel title="No watchlist selected" subtitle="Nothing is being quoted on this screen">
        <EmptyState
          message={listCount === 0 ? "No watchlists exist." : "Select a watchlist to view it."}
          detail="Create one from the Watchlists panel to start collecting instruments. Lists are stored in this browser only."
        />
      </Panel>
    );
  }

  return (
    <Panel
      title={listName}
      subtitle={`${instruments.length} instrument${
        instruments.length === 1 ? "" : "s"
      } · this device only`}
      actions={
        <>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => setAdding((previous) => !previous)}
            aria-expanded={adding}
          >
            {adding ? "Close add" : "+ Add instrument"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => {
              setRenameValue(listName);
              setRenameError(null);
              setRenaming(true);
            }}
            title="Rename this watchlist"
          >
            Rename
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => setConfirmDelete(true)}
            title="Delete this watchlist (this browser only)"
          >
            Delete
          </button>
        </>
      }
    >
      {renaming ? (
        <form className="rail-create" onSubmit={submitRename}>
          <input
            className="input input-sm"
            aria-label="Watchlist name"
            value={renameValue}
            maxLength={MAX_LIST_NAME_LENGTH}
            onChange={(event) => setRenameValue(event.target.value)}
            autoFocus
          />
          <div className="rail-create-actions">
            <button type="submit" className="btn btn-primary btn-xs">
              Save
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => {
                setRenaming(false);
                setRenameError(null);
              }}
            >
              Cancel
            </button>
          </div>
          {renameError !== null ? (
            <p className="form-error" role="alert">
              {renameError}
            </p>
          ) : null}
        </form>
      ) : null}

      {adding ? (
        <AddInstrumentForm
          listName={listName}
          existing={instruments}
          onAdd={addInstrument}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {feedback !== null ? (
        <p
          className={`markets-feedback${feedback.tone === "error" ? " markets-feedback-error" : ""}`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}

      {instruments.length === 0 ? (
        <EmptyState
          message="This watchlist is empty."
          detail="Add an instrument by symbol, asset class, currency and venue. The engine only quotes instruments it subscribes to, so an unquoted instrument shows “No data”."
        />
      ) : (
        <>
          <div className="table-toolbar" role="group" aria-label="Instrument filters">
            <input
              className="input input-sm table-toolbar-search"
              aria-label="Filter instruments"
              placeholder="Symbol, venue or name…"
              value={watchFilter}
              onChange={(event) =>
                uiStore.update((s) => ({ ...s, watchFilter: event.target.value }))
              }
              maxLength={40}
            />
            <select
              className="input input-sm table-toolbar-select"
              aria-label="Filter by asset class"
              value={assetFilter}
              onChange={(event) => setAssetFilter(event.target.value)}
            >
              <option value="ALL">All asset classes</option>
              {assetClassOptions.map((assetClass) => (
                <option key={assetClass} value={assetClass}>
                  {assetClass}
                </option>
              ))}
            </select>
            <span className="table-toolbar-summary">
              {rows.length} of {instruments.length} instruments · {quoted} quoted · {staleCount}{" "}
              stale · {missing} no data
              {errored > 0 ? ` · ${errored} error` : ""}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="state state-empty" role="note">
              <p>No instruments match the current filters.</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setAssetFilter("ALL");
                  uiStore.update((s) => ({ ...s, watchFilter: "" }));
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table markets-table">
                <thead>
                  <tr>
                    {header("symbol", "Instrument")}
                    {header("last", "Last", "num")}
                    {header("bid", "Bid", "num")}
                    {header("ask", "Ask", "num")}
                    {header(
                      "change",
                      "Session Δ",
                      "num",
                      "Change across the quotes this terminal received this session — NOT a daily/24H change (the provider reports none).",
                    )}
                    <th className="num" title="Timestamp of the latest quote for this instrument">
                      Updated
                    </th>
                    <th>State</th>
                    <th aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      data-testid={`market-row-${row.descriptor.symbol}`}
                      className={row.key === selectedKey ? "row-selected" : undefined}
                    >
                      <td>
                        <span className="instrument">
                          <i
                            className={`instrument-icon ${toneForAssetClass(
                              row.descriptor.asset_class,
                            )}`}
                            aria-hidden="true"
                          >
                            {row.descriptor.symbol.charAt(0).toUpperCase()}
                          </i>
                          <span className="instrument-id">
                            <strong>{row.descriptor.symbol.toUpperCase()}</strong>
                            <small>
                              {row.name !== null && row.name !== "" ? `${row.name} · ` : ""}
                              {row.descriptor.asset_class} · {row.descriptor.exchange} ·{" "}
                              {row.descriptor.currency}
                            </small>
                          </span>
                        </span>
                      </td>
                      <td className="num">
                        {row.quote ? <MoneyText value={row.quote.last} /> : "—"}
                      </td>
                      <td className="num">
                        {row.quote ? <MoneyText value={row.quote.bid} /> : "—"}
                      </td>
                      <td className="num">
                        {row.quote ? <MoneyText value={row.quote.ask} /> : "—"}
                      </td>
                      <td className="num">
                        <SessionChangeCell change={row.change} />
                      </td>
                      <td className="num">
                        {row.quote ? (
                          <span
                            className="quote-time"
                            title={`Quote timestamp (exchange/origin): ${new Date(
                              row.quote.timestampMs,
                            ).toISOString()}`}
                          >
                            {formatTimeOfDay(new Date(row.quote.timestampMs).toISOString())}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <StatusBadge {...quoteStateBadge(row.quote, row.fetchState, row.stale)} />
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          aria-label={`Open ${row.descriptor.symbol} in Trade`}
                          title="Select this instrument for the Trade screen chart"
                          onClick={() =>
                            uiStore.update((s) => ({
                              ...s,
                              selectedInstrument: row.descriptor,
                              view: "dashboard",
                            }))
                          }
                        >
                          Trade
                        </button>
                        <button
                          type="button"
                          className="btn btn-icon"
                          aria-label={`Remove ${row.descriptor.symbol} from ${listName}`}
                          onClick={() => removeInstrument(row.descriptor)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete watchlist"
          message={`Delete “${listName}” and its ${instruments.length} instrument${
            instruments.length === 1 ? "" : "s"
          }? This removes the list from this browser only — no broker or server data is affected.`}
          confirmLabel="Delete list"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            watchlistActions.remove(list.id);
            setConfirmDelete(false);
            setFeedback(null);
          }}
        />
      ) : null}
    </Panel>
  );
}

function SessionChangeCell({ change }: { change: SessionChange | null }) {
  if (change === null) {
    return (
      <span
        className="quote-time"
        title="No change can be shown until this terminal has received at least two quotes for the instrument. The provider reports no daily/24H change."
      >
        —
      </span>
    );
  }
  const tone = change.absolute > 0 ? "pos" : change.absolute < 0 ? "neg" : undefined;
  return (
    <span
      className={tone}
      title={`Change across the ${change.samples} quotes this terminal received between ${new Date(
        change.fromMs,
      ).toISOString()} and ${new Date(change.toMs).toISOString()}. Not a daily/24H change.`}
    >
      {formatSignedNumber(change.absolute)}
      {change.percent === null ? null : (
        <span className="change-pct"> ({formatSignedPercent(change.percent)})</span>
      )}
    </span>
  );
}

function AddInstrumentForm({
  listName,
  existing,
  onAdd,
  onClose,
}: {
  listName: string;
  existing: InstrumentDescriptor[];
  onAdd: (descriptor: InstrumentDescriptor) => void;
  onClose: () => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [assetClass, setAssetClass] = useState<string>("EQUITY");
  const [currency, setCurrency] = useState("USD");
  const [exchange, setExchange] = useState("UNKNOWN");
  const [error, setError] = useState<string | null>(null);

  const trimmedSymbol = symbol.trim();
  const symbolValid = SYMBOL_PATTERN.test(trimmedSymbol);
  const currencyValid = CURRENCY_PATTERN.test(currency.trim());
  const valid = symbolValid && currencyValid;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) {
      setError("Enter a symbol (letters, digits, . / -) and a 3-letter currency.");
      return;
    }
    const descriptor = normalizeDescriptor({
      symbol: trimmedSymbol,
      asset_class: assetClass,
      currency,
      exchange,
      name: null,
    });
    const duplicate = existing.some(
      (instrument) => instrumentKey(instrument) === instrumentKey(descriptor),
    );
    if (duplicate) {
      setError(`${descriptor.symbol} · ${descriptor.exchange} is already in ${listName}.`);
      return;
    }
    setError(null);
    onAdd(descriptor);
    setSymbol("");
  }

  return (
    <form className="watch-add-form markets-add-form" onSubmit={submit}>
      <input
        className="input input-sm"
        aria-label="Symbol"
        placeholder="Symbol"
        value={symbol}
        onChange={(event) => setSymbol(event.target.value)}
        maxLength={20}
      />
      <select
        className="input input-sm"
        aria-label="Asset class"
        value={assetClass}
        onChange={(event) => setAssetClass(event.target.value)}
      >
        {ASSET_CLASSES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <input
        className="input input-sm input-ccy"
        aria-label="Currency"
        placeholder="CCY"
        value={currency}
        onChange={(event) => setCurrency(event.target.value)}
        maxLength={3}
      />
      <select
        className="input input-sm"
        aria-label="Exchange"
        value={exchange}
        onChange={(event) => setExchange(event.target.value)}
        title="Venue is part of the instrument identity the engine quotes by"
      >
        {EXCHANGES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-primary" disabled={!valid}>
        Add
      </button>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        Done
      </button>
      {symbolValid && symbol.trim().toUpperCase() === "AAPL" && exchange === "UNKNOWN" ? (
        <p className="markets-hint">
          The simulated engine quotes AAPL on NASDAQ — pick that venue to see live quotes.
        </p>
      ) : null}
      {error !== null ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export { DEMO_INSTRUMENT };
