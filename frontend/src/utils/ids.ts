/**
 * Client-side idempotency key generation (TS-004, M11).
 *
 * The order ticket generates one key per "order entry" and only regenerates
 * after a definitive outcome, so a retry after a timeout/network failure
 * replays idempotently on the server (HTTP 200 with the original order)
 * instead of creating a duplicate (M4/M10 contract).
 */

export function newIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  // Deterministic-shape fallback for environments without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
