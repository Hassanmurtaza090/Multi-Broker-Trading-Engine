/**
 * Report card (FE-M10) — one report with honest loading/success/failure states.
 *
 * Behaviour contract:
 * - The button is DISABLED with a stated reason while the source data is
 *   loading, in error, or empty. There is no "click and hope" path.
 * - Generating performs NO network call: the report is built from the data
 *   the terminal already holds (`build` is pure). A missing fetch is surfaced
 *   by the disabled state, never by a retry hidden inside the download.
 * - A refused/blocked download is reported as a failure. The card never says a
 *   file was written unless the browser accepted it.
 *
 * The layout follows the Figma "Generate a report" cards (icon + name +
 * one-line description + action) — but the whole card is not the button: a
 * card-as-button cannot express "disabled because the source failed".
 */

import { useState } from "react";

import { Icon, type IconName } from "../../components/Icon";
import { downloadCsv } from "./download";

export interface ReportCardBuild {
  filename: string;
  csv: string;
  rowCount: number;
}

interface ReportCardProps {
  slug: string;
  title: string;
  icon: IconName;
  description: string;
  /** Period scope statement for this report (applied / not applicable). */
  scopeNote: string;
  /** `null` when the report can be produced; otherwise why it cannot. */
  blockedReason: string | null;
  /** Builds the file from current store data. Performs no I/O. */
  build: () => ReportCardBuild;
}

type CardStatus =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function ReportCard({
  slug,
  title,
  icon,
  description,
  scopeNote,
  blockedReason,
  build,
}: ReportCardProps) {
  const [status, setStatus] = useState<CardStatus>({ kind: "idle" });
  const blocked = blockedReason !== null;

  async function handleGenerate() {
    if (blocked) return;
    setStatus({ kind: "generating" });
    // Yield once so the "Generating…" state is actually committed before the
    // synchronous build/download runs. No simulated progress is shown.
    await Promise.resolve();
    try {
      const { filename, csv, rowCount } = build();
      if (rowCount === 0) {
        setStatus({ kind: "error", message: "Nothing to export — the report would be empty." });
        return;
      }
      const written = downloadCsv(filename, csv);
      setStatus(
        written
          ? { kind: "success", message: `Downloaded ${filename}` }
          : {
              kind: "error",
              message: "This browser refused the file download — nothing was written.",
            },
      );
    } catch {
      setStatus({
        kind: "error",
        message: "The report could not be generated from the loaded data.",
      });
    }
  }

  return (
    <article className="report-card" data-testid={`report-card-${slug}`}>
      <div className="report-card-head">
        <Icon name={icon} size={16} />
        <strong className="report-card-title">{title}</strong>
      </div>
      <small className="report-card-description">{description}</small>
      <p className="report-card-scope" role="note">
        {scopeNote}
      </p>
      <div className="report-card-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void handleGenerate()}
          disabled={blocked || status.kind === "generating"}
          title={blockedReason ?? `Generate "${title}" as CSV from the loaded data`}
        >
          {status.kind === "generating" ? "Generating…" : "Download CSV"}
        </button>
        {blockedReason !== null ? (
          <span className="report-card-blocked" role="note">
            {blockedReason}
          </span>
        ) : null}
      </div>
      {status.kind === "success" ? (
        <p className="report-card-status" role="status">
          {status.message}
        </p>
      ) : null}
      {status.kind === "error" ? (
        <p className="report-card-status report-card-status-error" role="alert">
          {status.message}
        </p>
      ) : null}
    </article>
  );
}
