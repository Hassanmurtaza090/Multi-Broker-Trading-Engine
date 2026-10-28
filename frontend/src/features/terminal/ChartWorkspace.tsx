/**
 * Chart workspace (M1) — the Figma terminal's central chart card, rendered
 * from the REAL per-instrument last-price ring buffer (marketStore history:
 * WS quote pushes; REST polls seed the current quote).
 *
 * Honesty rules (AGENTS):
 * - The chart draws only observed prices — no synthetic candles, no
 *   extrapolation. (The backend exposes no bar/interval endpoint; the
 *   Figma's candlesticks cannot be reproduced truthfully, so the real price
 *   line is drawn over the design's grid/axis/footer furniture.)
 * - Timeframe and indicator controls render DISABLED: no subscribe API
 *   exists (documented M10 limitation). A disabled, titled control is
 *   honest; a fake working one is not.
 * - The footer's data note is the REAL staleness state (TS-007): FRESH with
 *   an age readout, or STALE — never a decorative "fresh · 32ms".
 */

import { EmptyState } from "../../components/Status";
import { config } from "../../config";
import { marketStore, uiStore } from "../../stores";
import { isQuoteStale } from "../../stores/marketStore";
import { useStoreState } from "../../stores/store";
import { formatDecimal } from "../../utils/decimal";
import { instrumentKey, instrumentLabel } from "../../utils/instrument";

const VIEW_W = 720;
const VIEW_H = 204;
const PAD_TOP = 18;
const PAD_BOTTOM = 16;
const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"] as const;

const axisFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function ChartWorkspace() {
  const { selectedInstrument } = useStoreState(uiStore);
  const { quotes, history, clockTick } = useStoreState(marketStore);

  if (selectedInstrument === null) {
    return (
      <section className="chart-workspace panel" aria-label="Chart">
        <EmptyState
          message="No instrument selected."
          detail="Select a Markets row to chart its recent prices."
        />
      </section>
    );
  }

  const key = instrumentKey(selectedInstrument);
  const quote = quotes[key];
  const points = history[key] ?? [];
  const stale = quote !== undefined && isQuoteStale(quote, clockTick, config.staleWindowMs);

  const prices = points.map((p) => p.price);
  const min = prices.length > 0 ? Math.min(...prices) : 0;
  const max = prices.length > 0 ? Math.max(...prices) : 0;
  const span = max - min || 1;

  const hasLine = points.length >= 2;
  const path = hasLine
    ? points
        .map((p, i) => {
          const x = (i / (points.length - 1)) * VIEW_W;
          const y =
            VIEW_H - PAD_BOTTOM - ((p.price - min) / span) * (VIEW_H - PAD_TOP - PAD_BOTTOM);
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ")
    : "";
  const lastPoint = hasLine ? points[points.length - 1] : null;
  const lastY =
    lastPoint !== null
      ? VIEW_H - PAD_BOTTOM - ((lastPoint.price - min) / span) * (VIEW_H - PAD_TOP - PAD_BOTTOM)
      : 0;

  const gridLines = [0.125, 0.375, 0.625, 0.875].map(
    (frac) => PAD_TOP + frac * (VIEW_H - PAD_TOP - PAD_BOTTOM),
  );
  const axisValues = [1, 0.75, 0.5, 0.25, 0].map((frac) => min + span * frac);

  const ageSeconds =
    quote !== undefined ? Math.max(0, Math.floor((clockTick - quote.timestampMs) / 1000)) : null;

  return (
    <section
      className="chart-workspace panel"
      aria-label={`Chart — ${instrumentLabel(selectedInstrument)}`}
    >
      <div className="chart-toolbar">
        <div className="chart-symbol">
          <i className="coin" aria-hidden="true">
            {selectedInstrument.symbol.charAt(0).toUpperCase()}
          </i>
          <div className="chart-name">
            <strong>{selectedInstrument.symbol.toUpperCase()}</strong>
            <small>
              {selectedInstrument.asset_class} · {selectedInstrument.exchange}
            </small>
          </div>
          <b className="chart-price">
            {formatDecimal(quote?.last ?? null)}
            <span className={stale ? "" : undefined}>{stale ? "STALE" : "LIVE"}</span>
          </b>
        </div>
        <div
          className="timeframes"
          role="group"
          aria-label="Chart timeframes (unavailable — no market-data subscribe API)"
        >
          {TIMEFRAMES.map((time) => (
            <button
              key={time}
              type="button"
              disabled
              title="Interval selection requires a market-data subscribe API (deferred — see PROJECT_STATUS)"
            >
              {time}
            </button>
          ))}
        </div>
        <div className="chart-controls" role="group" aria-label="Chart tools (unavailable)">
          <button type="button" disabled title="Indicators are not implemented in this milestone">
            Indicators
          </button>
        </div>
      </div>

      <div className="chart-body">
        {hasLine ? (
          <svg
            className="terminal-chart"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Recent ${selectedInstrument.symbol.toUpperCase()} price chart`}
          >
            {gridLines.map((y) => (
              <line key={y} className="chart-grid-line" x1="0" x2={VIEW_W} y1={y} y2={y} />
            ))}
            <path className="chart-line" d={path} />
          </svg>
        ) : (
          <div className="chart-empty">
            <p className="state-detail">
              Waiting for price data — the line appears as quotes stream in.
            </p>
          </div>
        )}
        <div className="chart-labels" aria-hidden="true">
          {axisValues.map((value) => (
            <span key={value}>{axisFormatter.format(value)}</span>
          ))}
        </div>
        {hasLine && quote !== null ? (
          <div
            className="last-price"
            style={{ top: `${Math.max(2, Math.min(VIEW_H - 16, lastY - 8))}px` }}
          >
            {formatDecimal(quote.last)}
          </div>
        ) : null}
      </div>

      <div className="chart-footer">
        {points.length > 0 ? (
          <>
            <span>{new Date(points[0].t).toLocaleTimeString()}</span>
            <span>{new Date(points[points.length - 1].t).toLocaleTimeString()}</span>
          </>
        ) : (
          <span>—</span>
        )}
        <span>
          Bid {formatDecimal(quote?.bid ?? null)} · Ask {formatDecimal(quote?.ask ?? null)}
        </span>
        <b className={stale ? "stale" : undefined}>
          MARKET DATA: <i aria-hidden="true" />
          {quote === undefined
            ? " NO DATA"
            : stale
              ? ` STALE · ${ageSeconds}s old`
              : ` FRESH · ${ageSeconds}s old`}
        </b>
      </div>
    </section>
  );
}
