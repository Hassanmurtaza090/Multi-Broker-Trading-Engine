/**
 * Minimal typed store primitive (M11).
 *
 * The project intentionally avoids a state-management framework (ADR-017):
 * React 18's `useSyncExternalStore` over small, focused external stores gives
 * predictable updates, trivial testability (plain objects + pure reducers),
 * and exact control over merge/dedupe semantics required by the at-least-once
 * WS contract.
 */

import { useSyncExternalStore } from "react";

export type Listener = () => void;

export interface Store<T> {
  getSnapshot(): T;
  /** Set the next state (object identity change notifies subscribers). */
  setState(next: T): void;
  /** Set state only when it actually changed (prevents render churn). */
  update(updater: (previous: T) => T): void;
  /** Replace with the initial state (used by tests and full resets). */
  reset(): void;
  subscribe(listener: Listener): () => void;
}

export function createStore<T>(initialState: T): Store<T> {
  let state = initialState;
  const listeners = new Set<Listener>();
  return {
    getSnapshot: () => state,
    setState(next: T): void {
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of listeners) listener();
    },
    update(updater: (previous: T) => T): void {
      this.setState(updater(state));
    },
    reset(): void {
      this.setState(initialState);
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe a component to a whole store; derive slices with useMemo. */
export function useStoreState<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
