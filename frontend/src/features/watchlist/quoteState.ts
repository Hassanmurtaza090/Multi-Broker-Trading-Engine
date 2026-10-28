/**
 * Quote-state badge mapping (M2) — shared by the Markets card (M11/M1) and
 * the Dashboard's watchlist snapshot so both render identical state badges
 * from the same store inputs.
 */

import type { StatusTone } from "../../utils/statusTone";
import type { QuoteView } from "../../stores/marketStore";

export interface QuoteStateBadge {
  tone: StatusTone;
  label: string;
  title?: string;
}

/** Derive the honest quote state: loading / missing / error / stale / live / polled. */
export function quoteStateBadge(
  quote: QuoteView | undefined,
  fetchState: string,
  stale: boolean,
): QuoteStateBadge {
  if (fetchState === "loading" && !quote) return { tone: "muted", label: "…" };
  if (fetchState === "missing") {
    return {
      tone: "muted",
      label: "No data",
      title: "The engine has no quote for this instrument yet",
    };
  }
  if (fetchState === "error") return { tone: "danger", label: "Error" };
  if (stale) {
    return {
      tone: "warn",
      label: "Stale",
      title: "No fresh data within the staleness window",
    };
  }
  if (quote) {
    return { tone: "ok", label: quote.lastStreamAt !== null ? "Live" : "Polled" };
  }
  return { tone: "muted", label: "—" };
}
