/**
 * Watchlists store (M6): named, user-owned instrument lists.
 *
 * DATA REALITY (verified before writing this): the backend exposes NO
 * watchlist capability. `backend/api/rest.py` has no watchlist route and no
 * runtime subscribe endpoint — `GET /market/quote` is a read-only lookup and
 * the engine streams quotes only for the instruments configured by the
 * `MARKET_SUBSCRIPTIONS` environment variable at startup. There is therefore
 * no account-level list to read or write.
 *
 * Consequence, stated plainly and shown in the UI: watchlists are a
 * THIS-DEVICE-ONLY client implementation persisted in `localStorage`. They are
 * not synchronized across devices, browsers, or sessions of other users, and
 * nothing here is presented as server state. The store degrades to in-memory
 * operation (with an explicit "not saved" state) when storage is unavailable
 * or the quota is exhausted — it never silently pretends a save succeeded.
 *
 * Relationship to `marketStore`: `marketStore.watchlist` stays the set the
 * terminal polls and renders (dashboard Markets card, the poll loop in
 * `useTerminal`, chart history). This store owns the named lists and MIRRORS
 * the active list into `marketStore.watchlist` after every mutation, so there
 * is one quote pipeline, one connection, and no duplicated market-data logic.
 *
 * The reducers below are pure functions so list semantics (uniqueness, caps,
 * selection fallback, untrusted-storage validation) are unit-testable without
 * React or a browser.
 */

import { marketStore, replaceWatchlist } from "./marketStore";
import { createStore, type Store } from "./store";
import { instrumentKey, normalizeDescriptor, type InstrumentDescriptor } from "../utils/instrument";

export const WATCHLISTS_STORAGE_KEY = "mbt.watchlists.v1";
export const MAX_WATCHLISTS = 20;
export const MAX_INSTRUMENTS_PER_LIST = 100;
export const MAX_LIST_NAME_LENGTH = 40;
export const DEFAULT_LIST_NAME = "Watchlist";

export interface NamedWatchlist {
  id: string;
  name: string;
  instruments: InstrumentDescriptor[];
  createdAt: number;
}

/** Persistence health, surfaced in the UI so "saved" is never assumed. */
export type StorageHealth = "ok" | "unavailable" | "error";

export interface WatchlistsState {
  lists: NamedWatchlist[];
  /** Active list id, or "" when the user has deleted every list. */
  activeId: string;
  storage: StorageHealth;
}

// --- pure helpers -----------------------------------------------------------------

function makeId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `wl-${random}`;
}

/** Trim, collapse inner whitespace, and clamp to the stored maximum. */
export function sanitizeListName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LIST_NAME_LENGTH);
}

export function newWatchlist(name: string, now: number = Date.now()): NamedWatchlist {
  return {
    id: makeId(),
    name: sanitizeListName(name),
    instruments: [],
    createdAt: now,
  };
}

export function findList(state: WatchlistsState, id: string): NamedWatchlist | undefined {
  return state.lists.find((list) => list.id === id);
}

export function activeList(state: WatchlistsState): NamedWatchlist | undefined {
  return findList(state, state.activeId);
}

/** Instruments of the active list — the mirrored/polled set. */
export function activeInstruments(state: WatchlistsState): InstrumentDescriptor[] {
  return activeList(state)?.instruments ?? [];
}

export function isEmptyState(state: WatchlistsState): boolean {
  return state.lists.length === 0;
}

/** Add a list (becomes active). Blank and duplicate names are rejected. */
export function withListAdded(
  state: WatchlistsState,
  name: string,
  now: number = Date.now(),
): WatchlistsState {
  const clean = sanitizeListName(name);
  if (clean === "") return state;
  if (state.lists.length >= MAX_WATCHLISTS) return state;
  if (hasName(state, clean)) return state;
  const list = newWatchlist(clean, now);
  return { ...state, lists: [...state.lists, list], activeId: list.id };
}

export function hasName(state: WatchlistsState, name: string, exceptId?: string): boolean {
  const needle = name.trim().toLowerCase();
  return state.lists.some(
    (list) => list.id !== exceptId && list.name.trim().toLowerCase() === needle,
  );
}

export function withListRenamed(state: WatchlistsState, id: string, name: string): WatchlistsState {
  const clean = sanitizeListName(name);
  if (clean === "") return state;
  if (!findList(state, id)) return state;
  if (hasName(state, clean, id)) return state;
  return {
    ...state,
    lists: state.lists.map((list) => (list.id === id ? { ...list, name: clean } : list)),
  };
}

/**
 * Delete a list. The neighbouring list (the next one, else the previous)
 * becomes active so the screen never lands on a dangling id; deleting the last
 * list leaves `activeId` empty — the honest "no watchlists" state.
 */
export function withListDeleted(state: WatchlistsState, id: string): WatchlistsState {
  const index = state.lists.findIndex((list) => list.id === id);
  if (index === -1) return state;
  const lists = state.lists.filter((list) => list.id !== id);
  if (state.activeId !== id) return { ...state, lists };
  const next = lists[index] ?? lists[index - 1] ?? null;
  return { ...state, lists, activeId: next ? next.id : "" };
}

export function withActiveList(state: WatchlistsState, id: string): WatchlistsState {
  if (state.activeId === id) return state;
  if (!findList(state, id)) return state;
  return { ...state, activeId: id };
}

/** Add an instrument to a list, de-duplicated by full instrument identity. */
export function withInstrument(
  state: WatchlistsState,
  listId: string,
  descriptor: InstrumentDescriptor,
): WatchlistsState {
  const list = findList(state, listId);
  if (!list) return state;
  const normalized = normalizeDescriptor(descriptor);
  const key = instrumentKey(normalized);
  if (list.instruments.some((existing) => instrumentKey(existing) === key)) return state;
  if (list.instruments.length >= MAX_INSTRUMENTS_PER_LIST) return state;
  return {
    ...state,
    lists: state.lists.map((entry) =>
      entry.id === listId ? { ...entry, instruments: [...entry.instruments, normalized] } : entry,
    ),
  };
}

export function withoutInstrument(
  state: WatchlistsState,
  listId: string,
  descriptor: InstrumentDescriptor,
): WatchlistsState {
  const list = findList(state, listId);
  if (!list) return state;
  const key = instrumentKey(descriptor);
  if (!list.instruments.some((existing) => instrumentKey(existing) === key)) return state;
  return {
    ...state,
    lists: state.lists.map((entry) =>
      entry.id === listId
        ? {
            ...entry,
            instruments: entry.instruments.filter((existing) => instrumentKey(existing) !== key),
          }
        : entry,
    ),
  };
}

// --- persistence (untrusted input is validated, never trusted) ---------------------

interface StoredPayload {
  version: 1;
  lists: NamedWatchlist[];
  activeId: string;
}

export function serializeWatchlists(state: WatchlistsState): string {
  const payload: StoredPayload = {
    version: 1,
    lists: state.lists.map((list) => ({
      id: list.id,
      name: list.name,
      instruments: list.instruments.map((instrument) => ({
        symbol: instrument.symbol,
        asset_class: instrument.asset_class,
        currency: instrument.currency,
        exchange: instrument.exchange,
        // `name` is populated by the engine later; persisting it would freeze a
        // stale description into the user's list, so it is not stored.
      })),
      createdAt: list.createdAt,
    })),
    activeId: state.activeId,
  };
  return JSON.stringify(payload);
}

const SYMBOL_PATTERN = /^[A-Z0-9./-]{1,20}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/i;

function parseDescriptor(raw: unknown): InstrumentDescriptor | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const { symbol, asset_class, currency, exchange } = record;
  if (typeof symbol !== "string" || typeof asset_class !== "string") return null;
  if (typeof currency !== "string" || typeof exchange !== "string") return null;
  if (!SYMBOL_PATTERN.test(symbol.trim())) return null;
  if (!CURRENCY_PATTERN.test(currency.trim())) return null;
  if (asset_class.trim() === "" || exchange.trim() === "") return null;
  return normalizeDescriptor({
    symbol,
    asset_class,
    currency,
    exchange,
    name: null,
  });
}

/**
 * Parse a stored payload. Returns `null` when the value is unusable (bad JSON,
 * wrong version, no list array) — the caller then starts from the default
 * state. Individual malformed entries are dropped rather than poisoning the
 * whole list set, and duplicates (ids, instrument identities) are removed.
 */
export function parseWatchlists(
  raw: string | null,
): { lists: NamedWatchlist[]; activeId: string } | null {
  if (raw === null || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const payload = parsed as Record<string, unknown>;
  if (payload.version !== 1) return null;
  if (!Array.isArray(payload.lists)) return null;

  const lists: NamedWatchlist[] = [];
  const seenIds = new Set<string>();
  for (const entry of payload.lists) {
    if (lists.length >= MAX_WATCHLISTS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? sanitizeListName(record.name) : "";
    if (id === "" || id.length > 64 || seenIds.has(id) || name === "") continue;
    const createdAt =
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : 0;
    const instruments: InstrumentDescriptor[] = [];
    if (Array.isArray(record.instruments)) {
      for (const candidate of record.instruments) {
        if (instruments.length >= MAX_INSTRUMENTS_PER_LIST) break;
        const descriptor = parseDescriptor(candidate);
        if (descriptor === null) continue;
        const key = instrumentKey(descriptor);
        if (instruments.some((existing) => instrumentKey(existing) === key)) continue;
        instruments.push(descriptor);
      }
    }
    seenIds.add(id);
    lists.push({ id, name, instruments, createdAt });
  }

  const requestedActive = typeof payload.activeId === "string" ? payload.activeId.trim() : "";
  const activeId =
    requestedActive !== "" && lists.some((list) => list.id === requestedActive)
      ? requestedActive
      : (lists[0]?.id ?? "");
  return { lists, activeId };
}

// --- store + actions ---------------------------------------------------------------

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Access itself can throw when storage is blocked (private mode, policy).
    return localStorage;
  } catch {
    return null;
  }
}

/** The default state: one empty list, so the screen opens on a real list. */
export function defaultWatchlistsState(storage: StorageHealth = "ok"): WatchlistsState {
  const list = newWatchlist(DEFAULT_LIST_NAME);
  return { lists: [list], activeId: list.id, storage };
}

function persistedState(): WatchlistsState {
  const backing = browserStorage();
  if (backing === null) return defaultWatchlistsState("unavailable");
  let raw: string | null = null;
  try {
    raw = backing.getItem(WATCHLISTS_STORAGE_KEY);
  } catch {
    return defaultWatchlistsState("unavailable");
  }
  const parsed = parseWatchlists(raw);
  if (parsed === null) return defaultWatchlistsState("ok");
  return { lists: parsed.lists, activeId: parsed.activeId, storage: "ok" };
}

/** Write the lists back, reporting the real outcome instead of assuming it. */
function persist(state: WatchlistsState): WatchlistsState {
  const backing = browserStorage();
  if (backing === null) {
    return state.storage === "unavailable" ? state : { ...state, storage: "unavailable" };
  }
  try {
    backing.setItem(WATCHLISTS_STORAGE_KEY, serializeWatchlists(state));
    return state.storage === "ok" ? state : { ...state, storage: "ok" };
  } catch {
    return state.storage === "error" ? state : { ...state, storage: "error" };
  }
}

/**
 * Mirror the active list into the quote pipeline. `marketStore` keeps no list
 * authority — it only receives the set to poll and render.
 */
function mirrorActive(state: WatchlistsState): void {
  marketStore.update((snapshot) => replaceWatchlist(snapshot, activeInstruments(state)));
}

export const watchlistsStore: Store<WatchlistsState> =
  createStore<WatchlistsState>(defaultWatchlistsState());

function commit(updater: (previous: WatchlistsState) => WatchlistsState): WatchlistsState {
  const previous = watchlistsStore.getSnapshot();
  const updated = updater(previous);
  if (updated === previous) return updated;
  const next = persist(updated);
  watchlistsStore.setState(next);
  mirrorActive(next);
  return next;
}

export type CreateListResult =
  { ok: true; id: string } | { ok: false; reason: "blank" | "duplicate" | "limit" };

export type RenameListResult =
  { ok: true } | { ok: false; reason: "blank" | "duplicate" | "missing" };

export type AddInstrumentResult = "added" | "duplicate" | "no-list" | "limit";

export const watchlistActions = {
  create(name: string): CreateListResult {
    const clean = sanitizeListName(name);
    if (clean === "") return { ok: false, reason: "blank" };
    const before = watchlistsStore.getSnapshot();
    if (hasName(before, clean)) return { ok: false, reason: "duplicate" };
    if (before.lists.length >= MAX_WATCHLISTS) return { ok: false, reason: "limit" };
    const next = commit((state) => withListAdded(state, clean));
    const created = next.lists[next.lists.length - 1];
    if (created === undefined || next.lists.length === before.lists.length) {
      return { ok: false, reason: "limit" };
    }
    return { ok: true, id: created.id };
  },

  rename(id: string, name: string): RenameListResult {
    const clean = sanitizeListName(name);
    if (clean === "") return { ok: false, reason: "blank" };
    const before = watchlistsStore.getSnapshot();
    if (!findList(before, id)) return { ok: false, reason: "missing" };
    if (hasName(before, clean, id)) return { ok: false, reason: "duplicate" };
    commit((state) => withListRenamed(state, id, clean));
    return { ok: true };
  },

  remove(id: string): void {
    commit((state) => withListDeleted(state, id));
  },

  select(id: string): void {
    commit((state) => withActiveList(state, id));
  },

  /** Add to the active list unless an explicit listId is given. */
  addInstrument(descriptor: InstrumentDescriptor, listId?: string): AddInstrumentResult {
    const state = watchlistsStore.getSnapshot();
    const targetId = listId ?? state.activeId;
    const list = findList(state, targetId);
    if (list === undefined) return "no-list";
    const key = instrumentKey(normalizeDescriptor(descriptor));
    if (list.instruments.some((existing) => instrumentKey(existing) === key)) {
      return "duplicate";
    }
    if (list.instruments.length >= MAX_INSTRUMENTS_PER_LIST) return "limit";
    commit((previous) => withInstrument(previous, targetId, descriptor));
    return "added";
  },

  removeInstrument(descriptor: InstrumentDescriptor, listId?: string): boolean {
    const state = watchlistsStore.getSnapshot();
    const targetId = listId ?? state.activeId;
    const list = findList(state, targetId);
    if (list === undefined) return false;
    const key = instrumentKey(descriptor);
    if (!list.instruments.some((existing) => instrumentKey(existing) === key)) return false;
    commit((previous) => withoutInstrument(previous, targetId, descriptor));
    return true;
  },

  /** Test/reset helper: drop the persisted copy and return to the default. */
  reset(): void {
    const backing = browserStorage();
    if (backing !== null) {
      try {
        backing.removeItem(WATCHLISTS_STORAGE_KEY);
      } catch {
        // Ignore: nothing to clear if storage became unavailable.
      }
    }
    watchlistsStore.setState(defaultWatchlistsState());
    mirrorActive(watchlistsStore.getSnapshot());
  },
};

/** Apply the persisted lists on load so the terminal opens on the user's set. */
(function hydrate() {
  const hydrated = persistedState();
  watchlistsStore.setState(hydrated);
  mirrorActive(hydrated);
})();
