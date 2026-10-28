/**
 * Watchlist persistence note (M6).
 *
 * Kept in its own module (not next to the rail component) so the component file
 * only exports components, and because both the rail and the price page's
 * "limitations" panel must state the SAME thing about where lists live.
 *
 * The backend has no watchlist capability (`stores/watchlistsStore.ts` explains
 * the verified absence), so the honest claim is "this browser only".
 */

import type { StorageHealth } from "../../stores/watchlistsStore";

/** Honest description of where the lists are stored, per storage health. */
export function storageNote(health: StorageHealth): string {
  switch (health) {
    case "unavailable":
      return "Browser storage is unavailable (private mode or policy). Lists work for this session only and are lost on reload — nothing is saved to the server.";
    case "error":
      return "The last save to browser storage failed (quota or blocked storage). Lists may be lost on reload — nothing is saved to the server.";
    case "ok":
    default:
      return "Saved in this browser only (localStorage). The API has no watchlist endpoints, so these lists do not sync across devices, browsers, or users.";
  }
}
