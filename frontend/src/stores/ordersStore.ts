/**
 * Orders store (M11): the order blotter state.
 *
 * Merge semantics (ADR-016): WS order events carry the FULL order snapshot in
 * the new lifecycle state, so an event idempotently UPSERTS by
 * `client_order_id` — replays and cross-topic interleaves cannot corrupt the
 * view, and a later REST resync is authoritative for anything missed.
 */

import type { OrderOut } from "../types/api";
import type { LoadState } from "./brokersStore";
import { createStore, type Store } from "./store";

export interface OrdersViewState {
  byId: Record<string, OrderOut>;
  /** client_order_ids, newest first (by created_at then arrival). */
  ids: string[];
  loadState: LoadState;
  errorMessage: string | null;
}

const initialState: OrdersViewState = {
  byId: {},
  ids: [],
  loadState: "idle",
  errorMessage: null,
};

export function createOrdersStore(): Store<OrdersViewState> {
  return createStore(initialState);
}

export function upsertOrder(state: OrdersViewState, order: OrderOut): OrdersViewState {
  const byId = { ...state.byId, [order.client_order_id]: order };
  if (state.byId[order.client_order_id]) {
    return { ...state, byId };
  }
  return { ...state, byId, ids: [order.client_order_id, ...state.ids] };
}

export function replaceOrders(state: OrdersViewState, orders: OrderOut[]): OrdersViewState {
  const byId: Record<string, OrderOut> = {};
  for (const order of orders) byId[order.client_order_id] = order;
  // Newest first so the blotter reads naturally.
  const ids = orders
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => o.client_order_id);
  return { ...state, byId, ids, loadState: "ready", errorMessage: null };
}

export const ordersStore = createOrdersStore();
