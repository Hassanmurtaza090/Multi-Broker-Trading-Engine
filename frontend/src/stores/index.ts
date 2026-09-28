/**
 * Store registry + test/reset helpers (M11).
 *
 * Feature modules consume the singleton stores exported from their modules;
 * tests call `resetAllStores()` to isolate scenarios.
 */

import { accountStore } from "./accountStore";
import { brokersStore } from "./brokersStore";
import { connectionStore } from "./connectionStore";
import { marketStore } from "./marketStore";
import { ordersStore } from "./ordersStore";
import { positionsStore } from "./positionsStore";
import { riskStore } from "./riskStore";
import { uiStore } from "./uiStore";

export { accountStore } from "./accountStore";
export { brokersStore } from "./brokersStore";
export { connectionStore } from "./connectionStore";
export { marketStore } from "./marketStore";
export { ordersStore } from "./ordersStore";
export { positionsStore } from "./positionsStore";
export { riskStore } from "./riskStore";
export { uiStore } from "./uiStore";

export function resetAllStores(): void {
  accountStore.reset();
  brokersStore.reset();
  connectionStore.reset();
  marketStore.reset();
  ordersStore.reset();
  positionsStore.reset();
  riskStore.reset();
  uiStore.reset();
}
