/**
 * Open-order count hook (M1) — a PRIMITIVE store subscription.
 *
 * `useSyncExternalStore` bails out with Object.is: returning a NUMBER means
 * subscribed chrome (the sidebar badge, the bottom tabs card) re-renders only
 * when the WORKING-ORDER COUNT actually changes — not on every order event
 * or REST resync. Keeps high-frequency order updates from re-rendering the
 * whole shell during bursts (partial fills, reconnect replays).
 */

import { useSyncExternalStore } from "react";

import { ordersStore } from "../stores";
import { TERMINAL_STATUSES } from "../types/api";

function openOrderCount(): number {
  const { byId, ids } = ordersStore.getSnapshot();
  return ids.filter((id) => !TERMINAL_STATUSES.has(byId[id].status)).length;
}

export function useOpenOrderCount(): number {
  return useSyncExternalStore(ordersStore.subscribe, openOrderCount, openOrderCount);
}
