/**
 * Risk data selectors (FE-M8).
 *
 * The Risk workspace is a pure projection of state the terminal already holds:
 * `accountStore` (equity/exposure/P&L + kill switch), `positionsStore`,
 * `riskStore` (live violations) and `ordersStore`. It issues NO fetch of its
 * own and opens NO socket — `useTerminal` owns every request (login, account
 * switch, reconnect, fill-driven resync), so this module cannot introduce a
 * duplicate API client or a second source of truth.
 */

import { useMemo } from "react";

import { positionsStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import type { PositionOut } from "../../types/api";

/** Position rows in store order (stable, not re-sorted here). */
export function usePositionsList(): PositionOut[] {
  const { byKey, keys } = useStoreState(positionsStore);
  return useMemo(
    () => keys.map((key) => byKey[key]).filter((row): row is PositionOut => row !== undefined),
    [byKey, keys],
  );
}
