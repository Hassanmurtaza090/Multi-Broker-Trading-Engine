/**
 * UI store (M11): view navigation, the active account, and the instrument
 * selected for the dashboard chart / order ticket.
 *
 * The M10 runtime binds ONE broker account; the selector nevertheless supports
 * switching accounts so the terminal is correct for multi-account deployments
 * without redesign (all account-scoped panels re-sync on change).
 *
 * FE-M11: two browser-local preferences (default workspace + default account)
 * live here because this store owns the two values they seed. Persistence
 * mirrors `watchlistsStore`: validated JSON in localStorage, real storage
 * health reported back, and nothing ever written to the server (the API has no
 * preferences resource). Settings that cannot be applied honestly are NOT
 * offered — see `pages/SettingsPage.tsx`.
 */

import { config } from "../config";
import type { InstrumentDescriptor } from "../utils/instrument";
import { createStore, type Store } from "./store";
import type { StorageHealth } from "./watchlistsStore";

/** Every destination the app can render (one per `<TerminalView>` branch). */
export const TERMINAL_VIEWS = [
  "dashboard",
  "orders",
  "positions",
  "overview",
  "accounts",
  "activity",
  "markets",
  "strategies",
  "risk",
  "brokers",
  // FE-M10: the Figma sidebar's "Portfolio" destination (after Activity) and
  // the PLATFORM "Reports" destination (after Risk Management).
  "portfolio",
  "reports",
  // FE-M11: the PLATFORM "Administration" and "Settings" destinations the
  // Figma Make sidebar lists after Reports.
  "administration",
  "settings",
] as const;

export type TerminalView = (typeof TERMINAL_VIEWS)[number];

export interface UiViewState {
  view: TerminalView;
  accountId: string;
  selectedInstrument: InstrumentDescriptor | null;
  /**
   * Header search text — one global instrument filter, applied by the Markets
   * (watchlist) card and the Markets screen's instrument table.
   */
  watchFilter: string;
}

const initialState: UiViewState = {
  view: "dashboard",
  accountId: config.defaultAccountId,
  selectedInstrument: null,
  watchFilter: "",
};

export function createUiStore(): Store<UiViewState> {
  return createStore(initialState);
}

export const uiStore = createUiStore();

// --- browser-local preferences (default workspace + default account) ---------------

export const PREFERENCES_STORAGE_KEY = "mbt.preferences.v1";
export const MAX_ACCOUNT_ID_LENGTH = 128;

export interface StoredPreferences {
  /** Landing destination when the terminal loads. */
  defaultView: TerminalView;
  /** Preferred account id; null = use the configured `VITE_ACCOUNT_ID` default. */
  defaultAccountId: string | null;
}

export type PreferencesSaveResult = { ok: true } | { ok: false; reason: "unavailable" | "error" };

export const DEFAULT_PREFERENCES: StoredPreferences = {
  defaultView: "dashboard",
  defaultAccountId: null,
};

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Access itself can throw when storage is blocked (private mode, policy).
    return localStorage;
  } catch {
    return null;
  }
}

function isTerminalView(value: unknown): value is TerminalView {
  return typeof value === "string" && (TERMINAL_VIEWS as readonly string[]).includes(value);
}

function normalizeAccountId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_ACCOUNT_ID_LENGTH) return null;
  return trimmed;
}

export function serializePreferences(prefs: StoredPreferences): string {
  return JSON.stringify({
    version: 1,
    defaultView: prefs.defaultView,
    defaultAccountId: prefs.defaultAccountId,
  });
}

/** Parse a stored payload; `null` when nothing usable was stored. */
export function parsePreferences(raw: string | null): StoredPreferences | null {
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
  // An unknown destination is never trusted (the view set changes over time);
  // the account id falls back to the configured default when unusable.
  const defaultView = isTerminalView(payload.defaultView) ? payload.defaultView : null;
  if (defaultView === null) return null;
  return { defaultView, defaultAccountId: normalizeAccountId(payload.defaultAccountId) };
}

/** Stored preferences plus the REAL storage health (never assumed "ok"). */
export function loadPreferences(): { prefs: StoredPreferences; health: StorageHealth } {
  const backing = browserStorage();
  if (backing === null) return { prefs: DEFAULT_PREFERENCES, health: "unavailable" };
  let raw: string | null = null;
  try {
    raw = backing.getItem(PREFERENCES_STORAGE_KEY);
  } catch {
    return { prefs: DEFAULT_PREFERENCES, health: "unavailable" };
  }
  const parsed = parsePreferences(raw);
  if (parsed === null) return { prefs: DEFAULT_PREFERENCES, health: "ok" };
  return { prefs: parsed, health: "ok" };
}

/** Persist preferences, reporting the real outcome instead of assuming it. */
export function savePreferences(prefs: StoredPreferences): PreferencesSaveResult {
  const backing = browserStorage();
  if (backing === null) return { ok: false, reason: "unavailable" };
  try {
    backing.setItem(PREFERENCES_STORAGE_KEY, serializePreferences(prefs));
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Apply the stored preferences to the live store (called once at startup). */
export function hydrateUiPreferences(): void {
  const { prefs } = loadPreferences();
  uiStore.update((state) => {
    const next: UiViewState = {
      ...state,
      view: prefs.defaultView,
      accountId: prefs.defaultAccountId ?? state.accountId,
    };
    return next;
  });
}

// Same convention as `watchlistsStore`: hydrate once when the module loads.
// With nothing stored this is a no-op (both values already hold the defaults).
(function hydrate() {
  const { prefs } = loadPreferences();
  if (prefs.defaultView !== initialState.view || prefs.defaultAccountId !== null) {
    hydrateUiPreferences();
  }
})();
