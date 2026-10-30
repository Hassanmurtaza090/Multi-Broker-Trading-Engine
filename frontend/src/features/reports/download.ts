/**
 * Report download (FE-M10) — Blob + object URL, no dependency, no network.
 *
 * The terminal generates reports from data it ALREADY holds, so this module
 * performs no request at all: a failed source fetch means the calling card
 * disables the button, and it is never retried from inside the download path.
 *
 * Failure is reported honestly: if the environment cannot create an object URL
 * (some sanitized/embedded browsers), the function returns `false` and the
 * card shows an error instead of claiming a file was written.
 */

export const CSV_MIME_TYPE = "text/csv;charset=utf-8";

/** `report-<slug>-<account>-YYYYMMDD-HHMMSSZ.csv`, filesystem-safe. */
export function reportFilename(slug: string, accountId: string, now: Date): string {
  const stamp = Number.isNaN(now.getTime())
    ? "unknown-time"
    : `${now.toISOString().slice(0, 10).replace(/-/g, "")}-${now
        .toISOString()
        .slice(11, 19)
        .replace(/:/g, "")}Z`;
  const safeAccount = accountId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40) || "account";
  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "report";
  return `report-${safeSlug}-${safeAccount}-${stamp}.csv`;
}

export function csvBlob(csv: string): Blob {
  return new Blob([csv], { type: CSV_MIME_TYPE });
}

/** Write `csv` to disk under `filename`. Returns false when the environment
 *  cannot do it — the caller must surface that rather than assume success. */
export function downloadCsv(filename: string, csv: string): boolean {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return false;
  }
  let url: string | null = null;
  try {
    url = URL.createObjectURL(csvBlob(csv));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch {
    // Includes "URL.createObjectURL was refused/not permitted".
    return false;
  } finally {
    if (url !== null && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  }
}
