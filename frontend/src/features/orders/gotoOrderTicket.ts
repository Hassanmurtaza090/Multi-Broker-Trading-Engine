/**
 * Order-ticket navigation (M2) — shared by the Trade screen's "New order"
 * title action and the Dashboard: jump to the Trade view and focus the
 * ticket's symbol input after the view mounts.
 */

import { uiStore } from "../../stores";

export function gotoOrderTicket(): void {
  uiStore.update((s) => ({ ...s, view: "dashboard" }));
  requestAnimationFrame(() => {
    const input = document.getElementById("ticket-symbol");
    if (input === null) return;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
  });
}
