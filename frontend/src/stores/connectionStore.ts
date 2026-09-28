/**
 * Connection state store (M11): WebSocket lifecycle visibility for the UI.
 */

import { createStore, type Store } from "./store";
import type { ConnectionState } from "../services/ws";

export interface ConnectionViewState {
  state: ConnectionState;
  /** Number of the current reconnect attempt (0 when connected). */
  attempt: number;
  /** Epoch ms of the last event received (null = none yet). */
  lastEventAt: number | null;
  /** Fatal connection failure message (e.g. server reject 4400), if any. */
  fatalReason: string | null;
}

const initialState: ConnectionViewState = {
  state: "DISCONNECTED",
  attempt: 0,
  lastEventAt: null,
  fatalReason: null,
};

export function createConnectionStore(): Store<ConnectionViewState> {
  return createStore(initialState);
}

export const connectionStore = createConnectionStore();
