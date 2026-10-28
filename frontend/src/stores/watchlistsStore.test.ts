/**
 * Watchlists store tests (M6).
 *
 * The store owns the user's named lists, their persistence, and the mirror into
 * the quote pipeline, so its guarantees are asserted directly: list uniqueness
 * and caps, selection fallback after deletion, instrument de-duplication by
 * full identity (symbol + asset class + currency + venue), validation of
 * untrusted localStorage content, honest storage-health reporting, and the
 * mirror that keeps the single market-data pipeline fed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketStore } from "./marketStore";
import {
  activeInstruments,
  activeList,
  defaultWatchlistsState,
  DEFAULT_LIST_NAME,
  MAX_INSTRUMENTS_PER_LIST,
  MAX_WATCHLISTS,
  parseWatchlists,
  serializeWatchlists,
  WATCHLISTS_STORAGE_KEY,
  watchlistActions,
  watchlistsStore,
  withActiveList,
  withInstrument,
  withListAdded,
  withListDeleted,
  withListRenamed,
  withoutInstrument,
} from "./watchlistsStore";
import type { InstrumentDescriptor } from "../utils/instrument";

function aapl(overrides: Partial<InstrumentDescriptor> = {}): InstrumentDescriptor {
  return {
    symbol: "AAPL",
    asset_class: "EQUITY",
    currency: "USD",
    exchange: "NASDAQ",
    ...overrides,
  };
}

function btc(overrides: Partial<InstrumentDescriptor> = {}): InstrumentDescriptor {
  return {
    symbol: "BTC",
    asset_class: "CRYPTO",
    currency: "USD",
    exchange: "UNKNOWN",
    ...overrides,
  };
}

describe("watchlistsStore — state and reducers", () => {
  beforeEach(() => {
    localStorage.clear();
    watchlistActions.reset();
  });

  it("starts with one empty default list that is selected", () => {
    const state = watchlistsStore.getSnapshot();
    expect(state.lists).toHaveLength(1);
    expect(state.lists[0].name).toBe(DEFAULT_LIST_NAME);
    expect(state.lists[0].instruments).toEqual([]);
    expect(state.activeId).toBe(state.lists[0].id);
    expect(activeInstruments(state)).toEqual([]);
  });

  it("adds a list, makes it active, and rejects blank or duplicate names", () => {
    const created = watchlistActions.create("  Crypto  ");
    expect(created.ok).toBe(true);
    const state = watchlistsStore.getSnapshot();
    expect(state.lists.map((list) => list.name)).toEqual([DEFAULT_LIST_NAME, "Crypto"]);
    expect(activeList(state)?.name).toBe("Crypto");

    expect(watchlistActions.create("   ")).toEqual({ ok: false, reason: "blank" });
    expect(watchlistActions.create("crypto")).toEqual({ ok: false, reason: "duplicate" });
    expect(watchlistsStore.getSnapshot().lists).toHaveLength(2);
  });

  it("caps the number of lists", () => {
    for (let i = 1; i < MAX_WATCHLISTS; i += 1) {
      expect(watchlistActions.create(`List ${i}`).ok).toBe(true);
    }
    expect(watchlistsStore.getSnapshot().lists).toHaveLength(MAX_WATCHLISTS);
    expect(watchlistActions.create("Overflow")).toEqual({ ok: false, reason: "limit" });
  });

  it("renames a list, rejecting blanks, duplicates and unknown ids", () => {
    const id = watchlistsStore.getSnapshot().activeId;
    watchlistActions.create("Crypto");

    expect(watchlistActions.rename(id, "Long term")).toEqual({ ok: true });
    expect(watchlistActions.rename(id, "   ")).toEqual({ ok: false, reason: "blank" });
    expect(watchlistActions.rename(id, "crypto")).toEqual({ ok: false, reason: "duplicate" });
    expect(watchlistActions.rename("missing-id", "Whatever")).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(watchlistsStore.getSnapshot().lists[0].name).toBe("Long term");
  });

  it("deletes a list and activates a neighbour, ending empty when the last goes", () => {
    const first = watchlistsStore.getSnapshot().activeId;
    const second = watchlistActions.create("Second");
    expect(second.ok).toBe(true);
    const secondId = second.ok ? second.id : "";

    watchlistActions.select(first);
    watchlistActions.remove(first);
    expect(activeList(watchlistsStore.getSnapshot())?.id).toBe(secondId);

    watchlistActions.remove(secondId);
    const state = watchlistsStore.getSnapshot();
    expect(state.lists).toEqual([]);
    expect(state.activeId).toBe("");
    expect(activeInstruments(state)).toEqual([]);
    expect(marketStore.getSnapshot().watchlist).toEqual([]);
  });

  it("adds instruments de-duplicated by full identity, not just symbol", () => {
    expect(watchlistActions.addInstrument(aapl())).toBe("added");
    expect(watchlistActions.addInstrument(aapl({ symbol: "aapl" }))).toBe("duplicate");
    // Same symbol, different venue → a different instrument.
    expect(watchlistActions.addInstrument(aapl({ exchange: "NYSE" }))).toBe("added");

    const stored = activeInstruments(watchlistsStore.getSnapshot());
    expect(stored.map((instrument) => `${instrument.symbol}|${instrument.exchange}`)).toEqual([
      "AAPL|NASDAQ",
      "AAPL|NYSE",
    ]);
  });

  it("normalizes stored identity fields without inventing a name", () => {
    watchlistActions.addInstrument({
      symbol: " msft ",
      asset_class: "equity",
      currency: "usd",
      exchange: "nasdaq",
    });
    const stored = activeInstruments(watchlistsStore.getSnapshot())[0];
    expect(stored).toMatchObject({
      symbol: "MSFT",
      asset_class: "EQUITY",
      currency: "USD",
      exchange: "NASDAQ",
      name: null,
    });
  });

  it("caps instruments per list", () => {
    for (let i = 0; i < MAX_INSTRUMENTS_PER_LIST; i += 1) {
      expect(watchlistActions.addInstrument(aapl({ symbol: `S${i}` }))).toBe("added");
    }
    expect(watchlistActions.addInstrument(aapl({ symbol: "ONEMORE" }))).toBe("limit");
    expect(activeInstruments(watchlistsStore.getSnapshot())).toHaveLength(MAX_INSTRUMENTS_PER_LIST);
  });

  it("removes instruments and reports whether anything was removed", () => {
    watchlistActions.addInstrument(aapl());
    expect(watchlistActions.removeInstrument(aapl())).toBe(true);
    expect(watchlistActions.removeInstrument(aapl())).toBe(false);
    expect(activeInstruments(watchlistsStore.getSnapshot())).toEqual([]);
  });

  it("mirrors the active list into the quote pipeline on every change", () => {
    const mainId = watchlistsStore.getSnapshot().activeId;
    watchlistActions.addInstrument(aapl());
    watchlistActions.addInstrument(btc());
    expect(marketStore.getSnapshot().watchlist.map((instrument) => instrument.symbol)).toEqual([
      "AAPL",
      "BTC",
    ]);

    const created = watchlistActions.create("Other");
    expect(created.ok).toBe(true);
    // A brand-new list is empty, so the polled set follows it.
    expect(marketStore.getSnapshot().watchlist).toEqual([]);

    watchlistActions.select(mainId);
    expect(marketStore.getSnapshot().watchlist.map((instrument) => instrument.symbol)).toEqual([
      "AAPL",
      "BTC",
    ]);
  });

  it("reports storage health instead of pretending a save succeeded", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      watchlistActions.addInstrument(aapl());
    } finally {
      spy.mockRestore();
    }
    const state = watchlistsStore.getSnapshot();
    expect(state.storage).toBe("error");
    // The in-memory list still took the change — it is simply not durable.
    expect(activeInstruments(state)).toHaveLength(1);
  });

  it("clears the persisted copy on reset", () => {
    watchlistActions.addInstrument(aapl());
    expect(localStorage.getItem(WATCHLISTS_STORAGE_KEY)).not.toBeNull();
    watchlistActions.reset();
    expect(localStorage.getItem(WATCHLISTS_STORAGE_KEY)).toBeNull();
    expect(activeInstruments(watchlistsStore.getSnapshot())).toEqual([]);
  });
});

describe("watchlistsStore — pure reducers", () => {
  it("withListDeleted keeps the active list when an inactive list is deleted", () => {
    const base = withListAdded(defaultWatchlistsState(), "Second");
    const first = base.lists[0];
    const state = withListDeleted(base, first.id);
    expect(state.lists).toHaveLength(1);
    expect(state.activeId).toBe(base.activeId);
  });

  it("withActiveList ignores unknown ids and no-ops on the current one", () => {
    const state = defaultWatchlistsState();
    expect(withActiveList(state, "nope")).toBe(state);
    expect(withActiveList(state, state.activeId)).toBe(state);
  });

  it("withListRenamed and withInstrument return the same object when rejected", () => {
    const state = defaultWatchlistsState();
    expect(withListRenamed(state, "nope", "Name")).toBe(state);
    expect(withInstrument(state, "nope", aapl())).toBe(state);
    expect(withoutInstrument(state, "nope", aapl())).toBe(state);
  });
});

describe("watchlistsStore — persistence format", () => {
  it("round-trips lists through serialization", () => {
    const base = defaultWatchlistsState();
    const state = withInstrument(withListAdded(base, "Crypto"), base.activeId, aapl());
    const parsed = parseWatchlists(serializeWatchlists(state));
    expect(parsed).not.toBeNull();
    expect(parsed?.lists.map((list) => list.name)).toEqual([DEFAULT_LIST_NAME, "Crypto"]);
    expect(parsed?.lists[0].instruments[0].symbol).toBe("AAPL");
    expect(parsed?.activeId).toBe(state.activeId);
  });

  it("persists only instrument identity — never credentials or tokens", () => {
    const base = defaultWatchlistsState();
    const state = withInstrument(withListAdded(base, "Crypto"), base.activeId, aapl());
    const serialized = serializeWatchlists(state);
    expect(serialized).not.toMatch(/token|password|secret|bearer|authorization/i);
    expect(JSON.parse(serialized)).toMatchObject({ version: 1 });
    // The storage key is namespaced to this feature, never a generic token slot.
    expect(WATCHLISTS_STORAGE_KEY).toBe("mbt.watchlists.v1");
  });

  it("rejects unusable payloads instead of trusting them", () => {
    expect(parseWatchlists(null)).toBeNull();
    expect(parseWatchlists("   ")).toBeNull();
    expect(parseWatchlists("{not json")).toBeNull();
    expect(parseWatchlists('{"version":2,"lists":[]}')).toBeNull();
    expect(parseWatchlists('{"version":1,"lists":{}}')).toBeNull();
  });

  it("keeps a valid empty list set (all lists deleted) distinct from 'no data'", () => {
    expect(parseWatchlists('{"version":1,"lists":[],"activeId":""}')).toEqual({
      lists: [],
      activeId: "",
    });
  });

  it("drops malformed entries, duplicate ids and duplicate instruments", () => {
    const raw = JSON.stringify({
      version: 1,
      activeId: "wl-b",
      lists: [
        {
          id: "wl-a",
          name: "  Watchlist  ",
          createdAt: 1,
          instruments: [
            { symbol: "AAPL", asset_class: "EQUITY", currency: "USD", exchange: "NASDAQ" },
            { symbol: "aapl", asset_class: "EQUITY", currency: "USD", exchange: "NASDAQ" },
            { symbol: "", asset_class: "EQUITY", currency: "USD", exchange: "NASDAQ" },
            { symbol: "BTC", asset_class: "CRYPTO", currency: "US", exchange: "UNKNOWN" },
            { symbol: "ETH", asset_class: 5, currency: "USD", exchange: "UNKNOWN" },
          ],
        },
        { id: "wl-a", name: "Duplicate id", createdAt: 2, instruments: [] },
        { id: "wl-b", name: "   ", createdAt: 3, instruments: [] },
        { id: "wl-b", name: "Real", createdAt: 4, instruments: [] },
      ],
    });
    const parsed = parseWatchlists(raw);
    expect(parsed?.lists.map((list) => list.name)).toEqual(["Watchlist", "Real"]);
    expect(parsed?.lists[0].instruments.map((instrument) => instrument.symbol)).toEqual(["AAPL"]);
    expect(parsed?.activeId).toBe("wl-b");
  });

  it("falls back to the first list when the stored active id is unknown", () => {
    const raw = JSON.stringify({
      version: 1,
      activeId: "gone",
      lists: [{ id: "wl-a", name: "Keep", createdAt: 1, instruments: [] }],
    });
    expect(parseWatchlists(raw)?.activeId).toBe("wl-a");
  });
});

describe("watchlistsStore — hydration", () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("loads persisted lists on a fresh module load and mirrors them into the poller set", async () => {
    localStorage.setItem(
      WATCHLISTS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeId: "wl-saved",
        lists: [
          {
            id: "wl-saved",
            name: "Saved list",
            createdAt: 1,
            instruments: [
              { symbol: "AAPL", asset_class: "EQUITY", currency: "USD", exchange: "NASDAQ" },
            ],
          },
        ],
      }),
    );
    vi.resetModules();
    const fresh = await import("./watchlistsStore");
    const freshMarket = await import("./marketStore");

    expect(fresh.watchlistsStore.getSnapshot().lists[0].name).toBe("Saved list");
    expect(fresh.watchlistsStore.getSnapshot().storage).toBe("ok");
    expect(
      freshMarket.marketStore.getSnapshot().watchlist.map((instrument) => instrument.symbol),
    ).toEqual(["AAPL"]);
  });

  it("starts from the default state when the stored payload is corrupt", async () => {
    localStorage.setItem(WATCHLISTS_STORAGE_KEY, "{corrupt");
    vi.resetModules();
    const fresh = await import("./watchlistsStore");
    const state = fresh.watchlistsStore.getSnapshot();
    expect(state.lists).toHaveLength(1);
    expect(state.lists[0].name).toBe(fresh.DEFAULT_LIST_NAME);
  });
});
