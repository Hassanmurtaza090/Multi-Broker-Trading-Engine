/**
 * Frontend configuration (M11).
 *
 * Values come from Vite env vars (VITE_*); every value has a safe default so
 * the terminal runs against a same-origin API with no configuration at all.
 * No secrets are ever stored here — authentication lands in M12.
 */

function numberFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultWsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/ws`;
}

export const config = {
  /** Base URL for the M10 REST API ("" = same origin, Vite proxy in dev). */
  apiBaseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? "",
  /** WebSocket endpoint for the M10 event stream. */
  wsUrl: defaultWsUrl(),
  /** Default account to trade (the M10 runtime binds ONE broker/account). */
  defaultAccountId: (import.meta.env.VITE_ACCOUNT_ID as string | undefined) ?? "ACC-001",
  /** REST quote polling interval for watchlist instruments (no server-side
   *  subscribe endpoint exists in M10 — see PROJECT_STATUS limitations). */
  quotePollMs: numberFromEnv(import.meta.env.VITE_QUOTE_POLL_MS as string | undefined, 5000),
  /** Display staleness window — mirrors the backend default
   *  `price_max_age` of 10s (backend/portfolio/service.py). */
  staleWindowMs: numberFromEnv(import.meta.env.VITE_STALE_MS as string | undefined, 10_000),
  /** WebSocket reconnect policy (capped exponential backoff). */
  wsReconnect: {
    baseDelayMs: 500,
    maxDelayMs: 15_000,
    /** 0 = retry forever (a trading terminal must keep trying to reconnect). */
    maxAttempts: 0,
  },
  /** Ping keepalive to detect half-open connections. */
  wsPingIntervalMs: 15_000,
} as const;

export type TerminalConfig = typeof config;
