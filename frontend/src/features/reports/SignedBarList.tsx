/**
 * Signed bar list (FE-M10) — dependency-free horizontal bars.
 *
 * Real data only: every row's printed value is the exact decimal string the
 * caller passed (formatted, units and currency included), and the bar is a
 * magnitude cue on a scale the component states in writing. There are no
 * axes, no interpolation and no smoothing — a bar list is the honest chart
 * shape when the backend offers a handful of per-currency figures rather than
 * a time series (a series is backend ask B3, not something to invent).
 *
 * Accessibility: `role="list"` / `role="listitem"` give the rows their own
 * names; the track is decorative (`aria-hidden`) so a screen reader hears the
 * label and the exact value, never a percentage it cannot verify.
 */

import { EmptyState } from "../../components/Status";
import { buildBars, type BarItem } from "./bars";

interface SignedBarListProps {
  "aria-label": string;
  items: readonly BarItem[];
  emptyMessage: string;
  /** States the scale in words — required, so the bars are never ambiguous. */
  scaleNote: string;
}

export function SignedBarList({
  "aria-label": ariaLabel,
  items,
  emptyMessage,
  scaleNote,
}: SignedBarListProps) {
  const rows = buildBars(items);

  if (rows.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <>
      <div className="pnl-bars" role="list" aria-label={ariaLabel}>
        {rows.map((row) => (
          <div className="pnl-bar-row" role="listitem" key={row.label}>
            <span className="pnl-bar-label" title={row.label}>
              {row.label}
            </span>
            <span className="pnl-bar-track" aria-hidden="true">
              <span className={`pnl-bar-fill ${row.tone}`} style={{ width: `${row.percent}%` }} />
            </span>
            <span
              className={`pnl-bar-value num ${row.tone}`}
              data-testid={`bar-value-${row.label}`}
            >
              {row.display}
            </span>
          </div>
        ))}
      </div>
      <p className="pnl-bars-scale" role="note">
        {scaleNote}
      </p>
    </>
  );
}
