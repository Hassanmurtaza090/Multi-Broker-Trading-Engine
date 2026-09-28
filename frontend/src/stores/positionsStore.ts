/**
 * Positions store (M11).
 *
 * Merge semantics (ADR-016): `position.opened`/`position.updated` upsert by
 * (account, instrument); `position.closed` removes the row. WS position
 * payloads lack the REST-only fields (market price, server staleness), so
 * event handlers preserve those and the terminal additionally performs a
 * debounced REST resync — REST list responses remain authoritative.
 */

import type { PositionOut } from "../types/api";
import type { LoadState } from "./brokersStore";
import type { PositionJ } from "../types/events";
import { positionFromJ } from "./mappers";
import { createStore, type Store } from "./store";

export type PositionKey = string;

export interface PositionsViewState {
  byKey: Record<PositionKey, PositionOut>;
  keys: PositionKey[];
  loadState: LoadState;
  errorMessage: string | null;
}

const initialState: PositionsViewState = {
  byKey: {},
  keys: [],
  loadState: "idle",
  errorMessage: null,
};

export function keyForPositionOut(position: PositionOut): PositionKey {
  // PositionOut has no asset_class, so the identity is symbol|exchange|currency.
  return `${position.account_id}|${position.symbol}|${position.exchange}|${position.currency}`;
}

export function createPositionsStore(): Store<PositionsViewState> {
  return createStore(initialState);
}

export function applyPositionEvent(
  state: PositionsViewState,
  position: PositionJ,
  closed: boolean,
): PositionsViewState {
  // Same key shape as keyForPositionOut so WS events reconcile with REST rows.
  const key = `${position.account_id}|${position.instrument.symbol}|${position.instrument.exchange}|${position.instrument.currency.code}`;
  if (closed) {
    if (!(key in state.byKey)) return state;
    const byKey = { ...state.byKey };
    delete byKey[key];
    return { ...state, byKey, keys: state.keys.filter((k) => k !== key) };
  }
  const previous = state.byKey[key];
  const byKey = { ...state.byKey, [key]: positionFromJ(position, previous) };
  const keys = previous ? state.keys : [...state.keys, key];
  return { ...state, byKey, keys };
}

export function replacePositions(
  state: PositionsViewState,
  positions: PositionOut[],
): PositionsViewState {
  const byKey: Record<PositionKey, PositionOut> = {};
  const keys: PositionKey[] = [];
  for (const position of positions) {
    const key = keyForPositionOut(position);
    byKey[key] = position;
    keys.push(key);
  }
  keys.sort();
  return { ...state, byKey, keys, loadState: "ready", errorMessage: null };
}

export const positionsStore = createPositionsStore();
