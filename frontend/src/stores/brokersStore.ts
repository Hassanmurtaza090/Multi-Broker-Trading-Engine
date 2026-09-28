/**
 * Broker connectivity store (M11).
 *
 * Multiple broker entries are rendered when the runtime provides them
 * (`GET /brokers` returns a list; the M10 runtime binds one broker — see
 * ADR-016). `broker.connected` / `broker.disconnected` WS events update the
 * list; a REST resync stays authoritative for entries the events never saw.
 */

import type { BrokerStatusOut } from "../types/api";
import { createStore, type Store } from "./store";

export type LoadState = "idle" | "loading" | "ready" | "error";

export interface BrokersViewState {
  brokers: BrokerStatusOut[];
  loadState: LoadState;
  errorMessage: string | null;
}

const initialState: BrokersViewState = {
  brokers: [],
  loadState: "idle",
  errorMessage: null,
};

export function createBrokersStore(): Store<BrokersViewState> {
  return createStore(initialState);
}

export function applyBrokerEvent(
  state: BrokersViewState,
  name: string,
  connected: boolean,
): BrokersViewState {
  const index = state.brokers.findIndex((b) => b.name === name);
  if (index === -1) {
    return {
      ...state,
      brokers: [...state.brokers, { name, connected }],
    };
  }
  const brokers = state.brokers.slice();
  brokers[index] = { name, connected };
  return { ...state, brokers };
}

export const brokersStore = createBrokersStore();
