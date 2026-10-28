/**
 * Store registry + test/reset helpers (M11/M12).
 *
 * Feature modules consume the singleton stores exported from their modules;
 * tests call `resetAllStores()` to isolate scenarios. Resetting also clears
 * the in-memory auth session (tokens never persist anywhere else).
 */

import { authService } from "../services/auth";
import { accountStore } from "./accountStore";
import { authStore } from "./authStore";
import { brokersStore } from "./brokersStore";
import { connectionStore } from "./connectionStore";
import { executionsStore } from "./executionsStore";
import { marketStore } from "./marketStore";
import { ordersStore } from "./ordersStore";
import { positionsStore } from "./positionsStore";
import { riskStore } from "./riskStore";
import { uiStore } from "./uiStore";
import { watchlistActions } from "./watchlistsStore";

export { accountStore } from "./accountStore";
export { authStore } from "./authStore";
export { brokersStore } from "./brokersStore";
export { connectionStore } from "./connectionStore";
export { executionsStore } from "./executionsStore";
export { marketStore } from "./marketStore";
export { ordersStore } from "./ordersStore";
export { positionsStore } from "./positionsStore";
export { riskStore } from "./riskStore";
export { uiStore } from "./uiStore";
export { watchlistsStore, watchlistActions } from "./watchlistsStore";

export function resetAllStores(): void {
  authService.expire(); // clears tokens + flips the auth store to logged_out
  accountStore.reset();
  authStore.reset();
  brokersStore.reset();
  connectionStore.reset();
  executionsStore.reset();
  watchlistActions.reset();
  marketStore.reset();
  ordersStore.reset();
  positionsStore.reset();
  riskStore.reset();
  uiStore.reset();
}
