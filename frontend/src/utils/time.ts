/**
 * Shared timestamp formatting (M5).
 *
 * The terminal shows two granularities: a compact time-of-day for dense table
 * cells, and a full date+time for detail views. Both keep the raw ISO string
 * in a `title` attribute at the call site, so the exact server timestamp is
 * always recoverable and never silently reinterpreted.
 */

/** Full local date + time with seconds; returns the raw input if unparseable. */
export function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Compact local time-of-day (dense table cells); raw input if unparseable. */
export function formatTimeOfDay(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString();
}

/** `YYYY-MM-DD` UTC day of an ISO timestamp (date-range filter display). */
export function formatUtcDay(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}
