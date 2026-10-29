/**
 * UI store (M11): view navigation, the active account, and the instrument
 * selected for the dashboard chart / order ticket.
 *
 * The M10 runtime binds ONE broker account; the selector nevertheless supports
 * switching accounts so the terminal is correct for multi-account deployments
 * without redesign (all account-scoped panels re-sync on change).
 */

import { config } from "../config";
import type { InstrumentDescriptor } from "../utils/instrument";
import { createStore, type Store } from "./store";

export type TerminalView =
  | "dashboard"
  | "orders"
  | "positions"
  | "overview"
  | "accounts"
  | "activity"
  | "markets"
  | "strategies"
  | "risk";

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
