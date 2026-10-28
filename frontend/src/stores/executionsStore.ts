/**
 * Executions (fills) store — M5.
 *
 * DATA REALITY (verified against the backend before writing this):
 * there is NO executions/fills REST endpoint. `backend/api/rest.py` exposes
 * `/orders`, `/orders/{id}`, `/accounts/{id}/positions|balance|summary`,
 * `/market/quote`, `/risk/*` and `/brokers` — nothing that returns fills.
 * `OrderOut` carries `filled_quantity` but no per-fill records, no execution
 * price, no commission and no fee.
 *
 * Fills DO exist as a domain object (`backend/domain/fills.py`) and are
 * streamed once inside the `order.partially_filled` / `order.filled`
 * WebSocket payloads (`events/types.py` → `fill`), but they are neither
 * persisted for querying nor replayed on reconnect.
 *
 * Consequently this store is an EXPLICITLY SESSION-SCOPED capture: it holds
 * only the fills this terminal personally received since the page opened.
 * It is not a history substitute, it never derives a record from an order's
 * status, and the UI states the limitation at the point of display. If a
 * `GET /executions` endpoint is added later, this store is replaced wholesale
 * by a REST-fed read model without touching the components' contracts.
 *
 * Dedupe (ADR-016 at-least-once delivery): fills are keyed by `fill_id`, so a
 * replayed envelope, a reconnect overlap, or the same fill arriving on both
 * the orders and positions topics can only ever produce one row.
 */

import type { FillJ } from "../types/events";
import { createStore, type Store } from "./store";

/** Bounded memory: a terminal left open for days must not grow unboundedly. */
export const MAX_CAPTURED_EXECUTIONS = 500;

export interface ExecutionsViewState {
  byId: Record<string, FillJ>;
  /** fill_ids, newest first (by `executed_at`). */
  ids: string[];
  /** ISO timestamp of the first captured fill, or null when nothing captured. */
  capturedFrom: string | null;
  /** True once any fill has been captured (drives the honest session label). */
  hasCapture: boolean;
}

const initialState: ExecutionsViewState = {
  byId: {},
  ids: [],
  capturedFrom: null,
  hasCapture: false,
};

export function createExecutionsStore(): Store<ExecutionsViewState> {
  return createStore(initialState);
}

/**
 * Insert one fill. Idempotent by `fill_id`; keeps newest-first ordering and
 * trims the oldest beyond `MAX_CAPTURED_EXECUTIONS`.
 */
export function recordFill(state: ExecutionsViewState, fill: FillJ): ExecutionsViewState {
  if (state.byId[fill.fill_id]) return state; // replay — already captured
  const byId = { ...state.byId, [fill.fill_id]: fill };
  const ids = [fill.fill_id, ...state.ids].sort((a, b) =>
    // ISO-8601 UTC timestamps sort lexicographically; equal stamps fall back
    // to insertion order, which is already newest-first.
    (byId[b]?.executed_at ?? "").localeCompare(byId[a]?.executed_at ?? ""),
  );
  const trimmed =
    ids.length > MAX_CAPTURED_EXECUTIONS ? ids.slice(0, MAX_CAPTURED_EXECUTIONS) : ids;
  if (trimmed.length < ids.length) {
    const kept: Record<string, FillJ> = {};
    for (const id of trimmed) kept[id] = byId[id];
    return {
      byId: kept,
      ids: trimmed,
      capturedFrom: state.capturedFrom ?? fill.executed_at,
      hasCapture: true,
    };
  }
  return {
    byId,
    ids: trimmed,
    capturedFrom: state.capturedFrom ?? fill.executed_at,
    hasCapture: true,
  };
}

/** Fills captured for one order, newest first (for the order detail panel). */
export function fillsForOrder(state: ExecutionsViewState, orderId: string): FillJ[] {
  return state.ids
    .map((id) => state.byId[id])
    .filter((fill): fill is FillJ => fill !== undefined && fill.order_client_id === orderId);
}

export const executionsStore = createExecutionsStore();
