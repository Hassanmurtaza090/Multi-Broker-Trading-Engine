/**
 * Lightweight sparkline chart (M11).
 *
 * Intentionally dependency-free: a small SVG polyline over the per-instrument
 * last-price ring buffer kept by the market store. Float conversion happens
 * here only (pixel coordinates — precision is irrelevant, ADR-017).
 */

import type { PricePoint } from "../stores/marketStore";
import { decimalToNumber, formatDecimal } from "../utils/decimal";

interface SparklineProps {
  points: PricePoint[];
  width?: number;
  height?: number;
  /** Latest exact-decimal last price (for the header readout). */
  last: string | null;
  /**
   * Compact mode (M1): renders the bare chart only — no header/readout and
   * no placeholder text — for the Figma market-table row sparkline cell.
   */
  showHeader?: boolean;
}

export function Sparkline({
  points,
  width = 280,
  height = 72,
  last,
  showHeader = true,
}: SparklineProps) {
  const trend =
    points.length >= 2
      ? points[points.length - 1].price > points[0].price
        ? "up"
        : points[points.length - 1].price < points[0].price
          ? "down"
          : "flat"
      : "flat";

  let path = "";
  if (points.length >= 2) {
    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || 1;
    path = points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * width;
        const y = height - 4 - ((p.price - min) / span) * (height - 8);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  const lastNumber = decimalToNumber(last);

  if (!showHeader && points.length < 2) {
    return <span aria-hidden="true">—</span>;
  }

  return (
    <div className="sparkline" data-testid="sparkline">
      {showHeader ? (
        <div className="sparkline-header">
          <span className={`sparkline-last sparkline-${trend}`}>
            {lastNumber === null ? "—" : formatDecimal(last)}
          </span>
          <span className="sparkline-count">{points.length} pts</span>
        </div>
      ) : null}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="recent price chart"
      >
        {path ? <path d={path} className={`sparkline-path sparkline-${trend}`} /> : null}
        {!path ? (
          <text x={width / 2} y={height / 2} textAnchor="middle" className="sparkline-empty">
            waiting for price data
          </text>
        ) : null}
      </svg>
    </div>
  );
}
