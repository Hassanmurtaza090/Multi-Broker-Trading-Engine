/**
 * Market-data store (M11): the watchlist and latest quotes.
 *
 * M10 exposes quotes via `GET /market/quote` (the terminal polls watchlisted
 * instruments) and streams `market.quote.updated` over WS when the engine has
 * subscriptions. Both origins merge into the same quote table.
 *
 * Staleness (TS-007): the server flag (REST) is OR-ed with a client-side age
 * check (quote timestamp older than the configured window, recomputed on a
 * 1s tick) so data that stops flowing visibly degrades instead of looking live.
 */

import type { QuoteOut } from "../types/api";
import type { QuoteJ } from "../types/events";
import { descriptorFromJ, instrumentKey, type InstrumentDescriptor } from "../utils/instrument";
import { decimalToNumber } from "../utils/decimal";
import { createStore, type Store } from "./store";

export interface QuoteView {
  key: string;
  descriptor: InstrumentDescriptor;
  bid: string | null;
  ask: string | null;
  last: string | null;
  mid: string | null;
  /** Exchange/data origin time (epoch ms). */
  timestampMs: number;
  /** Server-side staleness flag from the last REST read (false for WS pushes). */
  serverStale: boolean;
  /** Receipt time of the last WS update (null when only REST-poll data exists). */
  lastStreamAt: number | null;
}

export interface PricePoint {
  t: number;
  price: number;
}

export type QuoteFetchState = "idle" | "loading" | "ready" | "missing" | "error";

export interface MarketViewState {
  watchlist: InstrumentDescriptor[];
  quotes: Record<string, QuoteView>;
  quoteFetch: Record<string, QuoteFetchState>;
  /** Rolling last-price history per key for the dashboard chart (capped). */
  history: Record<string, PricePoint[]>;
  /** 1 Hz clock tick used to re-evaluate quote age at render time. */
  clockTick: number;
}

const initialState: MarketViewState = {
  watchlist: [],
  quotes: {},
  quoteFetch: {},
  history: {},
  clockTick: Date.now(),
};

export const HISTORY_LIMIT = 240;

export function createMarketStore(): Store<MarketViewState> {
  return createStore(initialState);
}

export function isQuoteStale(quote: QuoteView, nowMs: number, staleWindowMs: number): boolean {
  if (quote.serverStale) return true;
  return nowMs - quote.timestampMs > staleWindowMs;
}

export function applyQuoteOut(
  state: MarketViewState,
  descriptor: InstrumentDescriptor,
  quote: QuoteOut,
): MarketViewState {
  const key = instrumentKey(descriptor);
  const existing = state.quotes[key];
  const view: QuoteView = {
    key,
    descriptor,
    bid: quote.bid,
    ask: quote.ask,
    last: quote.last,
    // The authoritative mid comes from the server (it owns Decimal arithmetic).
    mid: quote.mid,
    timestampMs: Date.parse(quote.timestamp) || Date.now(),
    serverStale: quote.stale,
    lastStreamAt: existing?.lastStreamAt ?? null,
  };
  return withQuote(state, key, view);
}

export function applyQuoteJ(state: MarketViewState, quote: QuoteJ, nowMs: number): MarketViewState {
  const descriptor = descriptorFromJ(quote.instrument);
  const key = instrumentKey(descriptor);
  const view: QuoteView = {
    key,
    descriptor,
    bid: quote.bid ? quote.bid.value : null,
    ask: quote.ask ? quote.ask.value : null,
    last: quote.last ? quote.last.value : null,
    mid: null, // server mid arrives on REST reads; WS payloads carry no mid
    timestampMs: Date.parse(quote.timestamp) || nowMs,
    serverStale: false, // a live push is definitionally fresh data
    lastStreamAt: nowMs,
  };
  return appendHistory(withQuote(state, key, view), key, view.last, nowMs);
}

function withQuote(state: MarketViewState, key: string, quote: QuoteView): MarketViewState {
  return {
    ...state,
    quotes: { ...state.quotes, [key]: quote },
    quoteFetch: { ...state.quoteFetch, [key]: "ready" },
  };
}

export function setQuoteFetchState(
  state: MarketViewState,
  key: string,
  fetchState: QuoteFetchState,
): MarketViewState {
  return { ...state, quoteFetch: { ...state.quoteFetch, [key]: fetchState } };
}

export function addWatch(
  state: MarketViewState,
  descriptor: InstrumentDescriptor,
): MarketViewState {
  const key = instrumentKey(descriptor);
  if (state.watchlist.some((d) => instrumentKey(d) === key)) return state;
  return { ...state, watchlist: [...state.watchlist, descriptor] };
}

export function removeWatch(
  state: MarketViewState,
  descriptor: InstrumentDescriptor,
): MarketViewState {
  const key = instrumentKey(descriptor);
  const quotes = { ...state.quotes };
  const quoteFetch = { ...state.quoteFetch };
  const history = { ...state.history };
  delete quotes[key];
  delete quoteFetch[key];
  delete history[key];
  return {
    ...state,
    watchlist: state.watchlist.filter((d) => instrumentKey(d) !== key),
    quotes,
    quoteFetch,
    history,
  };
}

/**
 * Replace the watched set with the active watchlist (M6).
 *
 * M6 introduced named, user-owned watchlists (`stores/watchlistsStore.ts`).
 * That store owns the lists; this function mirrors the ACTIVE list here so the
 * existing consumers keep working unchanged: the 5 s quote poller in
 * `useTerminal`, the dashboard Markets card, the price history behind the
 * chart, and position row-click selection.
 *
 * Quotes/history for instruments that leave the active list are deliberately
 * KEPT: the chart of a just-deselected instrument does not blank out mid-look,
 * polling simply stops for it, and the existing staleness rule labels the
 * frozen quote as stale instead of pretending it is live.
 */
export function replaceWatchlist(
  state: MarketViewState,
  watchlist: InstrumentDescriptor[],
): MarketViewState {
  const unchanged =
    state.watchlist.length === watchlist.length &&
    state.watchlist.every(
      (descriptor, index) =>
        instrumentKey(descriptor) === instrumentKey(watchlist[index]) &&
        (descriptor.name ?? null) === (watchlist[index].name ?? null),
    );
  if (unchanged) return state;
  return { ...state, watchlist };
}

function appendHistory(
  state: MarketViewState,
  key: string,
  last: string | null,
  nowMs: number,
): MarketViewState {
  const price = decimalToNumber(last);
  if (price === null) return state;
  const series = state.history[key] ?? [];
  const next = [...series, { t: nowMs, price }];
  return {
    ...state,
    history: { ...state.history, [key]: next.slice(-HISTORY_LIMIT) },
  };
}

export const marketStore = createMarketStore();
