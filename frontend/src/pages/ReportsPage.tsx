/**
 * Reports & performance analytics (FE-M10) — the Figma sidebar's "Reports".
 *
 * DESIGN SOURCE: the retrieved Figma Make project
 * "Multi-Broker-Trading-Engine-UI" (`src/App.tsx`): the sidebar lists Reports
 * under PLATFORM, and the Reports screen is a single `panel("Generate a
 * report")` holding a date-range select ("Last 30 days / Last 7 days / This
 * year"), a format select ("CSV / PDF preview") and a five-card `report-grid`
 * (Account Statement, Trade History, P&L Report, Risk Report, Custom Report)
 * whose handlers build a hardcoded CSV blob. The card shell, the `report-grid`
 * layout, the range options and the five report names are taken from that
 * design. The hardcoded rows are NOT: every value below comes from the read
 * models this terminal actually holds.
 *
 * VERIFIED BACKEND REALITY (read before writing this page):
 *   - There is NO reporting/analytics/export endpoint and no persisted
 *     history. `GET /orders` accepts only an optional `account_id`: no date
 *     range, no status filter, no pagination.
 *   - Risk violations live in client memory only (`riskStore`).
 *   - Fills exist as a domain object but are streamed once over the
 *     WebSocket and never replayed (`executionsStore`, session capture).
 * So every report here is a CLIENT-SIDE export of already-fetched data, and
 * every card says which set it exports and whether the period applies.
 *
 * HONESTY RULES APPLIED ON THIS PAGE:
 *   - No fabricated figures, no demo rows, and no fallback data: a failed
 *     source disables the card with the reason (never a plausible-looking
 *     substitute). Generating performs no network call at all.
 *   - Realized vs unrealized, gross vs net, orders vs executions, snapshot vs
 *     period are kept distinct everywhere and labelled in place.
 *   - Never summed across currencies, and never netted across bases
 *     (ADR-013: there is no FX conversion and no exchange-rate timestamp).
 *   - A metric that cannot be computed correctly (slippage without a
 *     benchmark, latency without trusted timestamps, net P&L without complete
 *     cost data, day P&L without a start-of-day equity, VaR without a model)
 *     is listed as NOT COMPUTED with the reason, instead of approximated.
 *   - Derived figures are enumerated in the calculation table with formula,
 *     inputs, where they are computed, and their limits.
 */

import { useMemo, useState } from "react";

import { MoneyText } from "../components/MoneyText";
import { Panel } from "../components/Panel";
import { EmptyState, ErrorState, LoadingState } from "../components/Status";
import { ReportCard } from "../features/reports/ReportCard";
import { SignedBarList } from "../features/reports/SignedBarList";
import {
  buildAccountStatement,
  buildCustomReport,
  buildPnlReport,
  buildRiskReport,
  buildTradeHistory,
  DEFAULT_ORDER_COLUMN_KEYS,
  DEFAULT_POSITION_COLUMN_KEYS,
  ORDER_COLUMNS,
  POSITION_COLUMNS,
  selectColumns,
  type CsvTable,
} from "../features/reports/builders";
import { toCsv } from "../features/reports/csv";
import { reportFilename } from "../features/reports/download";
import {
  commissionCoverage,
  countOrderOutcomes,
  notionalByCurrency,
  pnlContributions,
  summaryCurrencies,
} from "../features/reports/metrics";
import {
  DEFAULT_REPORT_PERIOD,
  filterFillsByPeriod,
  filterOrdersByPeriod,
  REPORT_PERIODS,
  resolvePeriodRange,
  type ReportPeriod,
} from "../features/reports/period";
import {
  accountStore,
  brokersStore,
  executionsStore,
  ordersStore,
  positionsStore,
  riskStore,
  uiStore,
} from "../stores";
import { useStoreState } from "../stores/store";
import { formatDecimal } from "../utils/decimal";

/** One row of the calculation-methodology table. */
interface MethodologyRow {
  figure: string;
  formula: string;
  computedIn: string;
  limits: string;
}

const METHODOLOGY: readonly MethodologyRow[] = [
  {
    figure: "Portfolio equity",
    formula: "summary.equity, verbatim",
    computedIn: "Backend (portfolio service)",
    limits:
      "Account-level aggregate. Blank when the account is multi-currency or has no reported balances (ADR-013); the API reports no currency for it.",
  },
  {
    figure: "Gross exposure",
    formula: "summary.exposure, verbatim",
    computedIn: "Backend (portfolio service)",
    limits: "Same blanking condition as equity; no currency reported.",
  },
  {
    figure: "Realized P&L",
    formula: "summary.realized_pnl[currency], verbatim",
    computedIn: "Backend (portfolio service)",
    limits:
      "CUMULATIVE since engine start — not a daily or per-period figure. Per currency; never summed.",
  },
  {
    figure: "Unrealized P&L",
    formula: "summary.unrealized_pnl[currency], verbatim",
    computedIn: "Backend (portfolio service)",
    limits: "Marks as last reported; a stale mark is badged but not corrected.",
  },
  {
    figure: "Market value",
    formula: "summary.market_value[currency], verbatim",
    computedIn: "Backend (portfolio service)",
    limits: "Per-currency total across open positions; never summed across currencies.",
  },
  {
    figure: "Cash, available cash, buying power",
    formula: "balance.cash[] fields, verbatim",
    computedIn: "Backend (broker-reported balance)",
    limits: "Buying power is blank when the broker omits it — never shown as zero.",
  },
  {
    figure: "Per-position market value",
    formula: "quantity × market price (exact decimal strings)",
    computedIn: "Frontend (reports/builders.ts)",
    limits:
      "The only derived money value in this build. Blank without a market price; the same derivation the M3 allocation uses.",
  },
  {
    figure: "Order outcome counts",
    formula: "Count of orders grouped by the backend's own status field",
    computedIn: "Frontend (reports/metrics.ts)",
    limits: "One row per ORDER: a partially filled order counts once, never once per execution.",
  },
  {
    figure: "Fills captured",
    formula: "Count of fills received on order.partially_filled / order.filled",
    computedIn: "Frontend session memory",
    limits:
      "Not history: lost on reload, newest 500 kept, no replay on reconnect (backend ask B5).",
  },
  {
    figure: "Gross traded notional",
    formula: "Σ (quantity × executed price), per currency",
    computedIn: "Frontend (reports/metrics.ts, exact)",
    limits:
      "TURNOVER, not profit: no fees, no reference price, no FX, and buys add exactly like sells.",
  },
  {
    figure: "Commission coverage",
    formula: "Fills carrying a non-null commission or fee",
    computedIn: "Frontend (reports/metrics.ts)",
    limits:
      "Commission and fees are optional per fill in the domain model, so coverage is reported instead of a total cost.",
  },
  {
    figure: "CSV injection guard",
    formula: "Cells starting with = + @ TAB CR prefixed with ' (and - when not a plain decimal)",
    computedIn: "Frontend (reports/csv.ts)",
    limits:
      "A plain negative number such as -12.34 is left intact so the financial value is not corrupted.",
  },
  {
    figure: "Net P&L (gross − costs)",
    formula: "NOT COMPUTED",
    computedIn: "—",
    limits:
      "Costs are optional per fill, so a net figure would be silently understated. Needs complete cost data (B5).",
  },
  {
    figure: "Slippage",
    formula: "NOT COMPUTED",
    computedIn: "—",
    limits:
      "Needs a named benchmark reference price and the order side; no reference price is stored anywhere in the read models.",
  },
  {
    figure: "Execution latency",
    formula: "NOT COMPUTED",
    computedIn: "—",
    limits:
      "Needs trusted submission and acknowledgement/execution timestamps; the DTOs carry no accepted-at timestamp.",
  },
  {
    figure: "Day P&L, drawdown, VaR, leverage",
    formula: "NOT COMPUTED",
    computedIn: "—",
    limits:
      "No start-of-day equity and no equity series (B3); VaR and leverage need a model and inputs the API does not expose.",
  },
];

const UNSUPPORTED: readonly { element: string; reason: string; ask: string }[] = [
  {
    element: '"PDF preview" (the design\u2019s second format)',
    reason:
      "No report-generation endpoint exists. Rendering a document in the browser from a print stylesheet is not a report and would not be reproducible or auditable.",
    ask: "B4 — report generation",
  },
  {
    element: "Scheduled, emailed or branded statements",
    reason: "Nothing in the platform schedules work or stores a rendered document.",
    ask: "B4 — report generation",
  },
  {
    element: 'Historical statements ("as of" a past date)',
    reason: "No portfolio or order history is persisted — only current read models.",
    ask: "B4 / B5",
  },
  {
    element: "Server-side aggregation, filtering and pagination",
    reason:
      "GET /orders takes only account_id. Every filter here narrows the set the terminal already loaded, so an unbounded account's history is not fully represented.",
    ask: "B5 — executions read model with from/to and paging",
  },
  {
    element: "True trade history with execution prices and commissions",
    reason:
      "OrderOut carries no per-fill records; fills are not persisted and arrive once over the WebSocket.",
    ask: "B5 — executions read model",
  },
  {
    element: "Risk-violation history",
    reason: "Violations exist only in this tab's memory for the current session.",
    ask: "B6 — risk-violation history",
  },
  {
    element: "Date-filtered / per-period P&L and realized-P&L-by-day",
    reason:
      "P&L has no period attribution: realized P&L is a single cumulative per-currency figure.",
    ask: "B3 — equity/P&L time series",
  },
  {
    element: "Cross-currency totals and FX-converted P&L",
    reason: "No FX conversion and no exchange-rate timestamp (ADR-013).",
    ask: "ADR-013 revision plus an FX source",
  },
];

export function ReportsPage({ now }: { now?: Date } = {}) {
  const { accountId } = useStoreState(uiStore);
  const account = useStoreState(accountStore);
  const ordersState = useStoreState(ordersStore);
  const positionsState = useStoreState(positionsStore);
  const executions = useStoreState(executionsStore);
  const risk = useStoreState(riskStore);
  const { brokers } = useStoreState(brokersStore);

  const [period, setPeriod] = useState<ReportPeriod>(DEFAULT_REPORT_PERIOD);
  const [customSource, setCustomSource] = useState<"orders" | "positions">("orders");
  const [orderColumnKeys, setOrderColumnKeys] =
    useState<readonly string[]>(DEFAULT_ORDER_COLUMN_KEYS);
  const [positionColumnKeys, setPositionColumnKeys] = useState<readonly string[]>(
    DEFAULT_POSITION_COLUMN_KEYS,
  );

  // The clock is read once per mount (and is injectable for deterministic
  // tests). Re-reading it every render would move the period window under the
  // user while they are reading the page.
  const [clock] = useState<Date>(() => now ?? new Date());
  const range = useMemo(() => resolvePeriodRange(period, clock), [period, clock]);

  const orders = useMemo(() => ordersState.ids.map((id) => ordersState.byId[id]), [ordersState]);
  const positions = useMemo(
    () => positionsState.keys.map((key) => positionsState.byKey[key]),
    [positionsState],
  );
  const fills = useMemo(() => executions.ids.map((id) => executions.byId[id]), [executions]);

  const ordersInPeriod = useMemo(() => filterOrdersByPeriod(orders, range), [orders, range]);
  const fillsInPeriod = useMemo(() => filterFillsByPeriod(fills, range), [fills, range]);

  const summary = account.summary;
  const brokerName = brokers.length > 0 ? brokers[0].name : null;

  // --- blocked reasons: stated up front, never a hidden retry --------------
  const ordersUnavailable = ordersState.loadState === "error" && orders.length === 0;
  const statementBlocked =
    summary === null
      ? account.summaryState === "error"
        ? (account.errorMessage ?? "The account summary request failed — there is no snapshot.")
        : "No account snapshot has loaded yet."
      : null;
  const tradeHistoryBlocked = ordersUnavailable
    ? (ordersState.errorMessage ?? "The order list could not be loaded.")
    : ordersInPeriod.length === 0
      ? `No orders submitted in ${range.label}.`
      : null;
  const pnlBlocked =
    summary === null && positions.length === 0
      ? account.summaryState === "error"
        ? (account.errorMessage ?? "The P&L sources could not be loaded.")
        : "No P&L sources have loaded yet."
      : null;
  const riskBlocked =
    summary === null && positions.length === 0 && account.killSwitchActive === null
      ? "No risk state has loaded yet."
      : null;

  const customColumnCount =
    customSource === "orders"
      ? selectColumns(ORDER_COLUMNS, orderColumnKeys).length
      : selectColumns(POSITION_COLUMNS, positionColumnKeys).length;
  const customRowCount = customSource === "orders" ? ordersInPeriod.length : positions.length;
  const customBlocked =
    customColumnCount === 0
      ? "Select at least one column."
      : customRowCount === 0
        ? customSource === "orders"
          ? `No orders submitted in ${range.label}.`
          : "No positions are open."
        : null;

  // --- snapshot metrics ---------------------------------------------------
  const pnlRows = useMemo(() => {
    if (summary === null) return [];
    const rows: { label: string; currency: string; value: string | null }[] = [];
    for (const currency of summaryCurrencies(summary)) {
      rows.push({
        label: "Realized P&L",
        currency,
        value: summary.realized_pnl[currency] ?? null,
      });
      rows.push({
        label: "Unrealized P&L",
        currency,
        value: summary.unrealized_pnl[currency] ?? null,
      });
      rows.push({
        label: "Market value",
        currency,
        value: summary.market_value[currency] ?? null,
      });
    }
    return rows;
  }, [summary]);

  const contributionBars = useMemo(
    () =>
      pnlContributions(summary).map((item) => ({
        label: item.label,
        value: item.value,
        display: `${formatDecimal(item.value)} ${item.currency}`,
      })),
    [summary],
  );

  // --- period-scoped executions ------------------------------------------
  const outcomeCounts = useMemo(() => countOrderOutcomes(ordersInPeriod), [ordersInPeriod]);
  const outcomeBars = useMemo(
    () =>
      (
        [
          ["Filled", outcomeCounts.filled],
          ["Partially filled", outcomeCounts.partiallyFilled],
          ["Cancelled", outcomeCounts.cancelled],
          ["Rejected", outcomeCounts.rejected],
          ["Expired", outcomeCounts.expired],
          ["Working", outcomeCounts.working],
        ] as const
      ).map(([label, count]) => ({
        label,
        value: String(count),
        display: String(count),
        // Counts are not signed quantities: a neutral tone is the honest one.
        tone: "flat" as const,
      })),
    [outcomeCounts],
  );

  const notional = useMemo(() => notionalByCurrency(fillsInPeriod), [fillsInPeriod]);
  const coverage = useMemo(() => commissionCoverage(fillsInPeriod), [fillsInPeriod]);

  /** Wrap a table in the card's build contract (pure; no I/O). */
  function buildFor(slug: string, table: CsvTable) {
    return () => ({
      filename: reportFilename(slug, accountId, clock),
      csv: toCsv(table.headers, table.rows),
      rowCount: table.rows.length,
    });
  }

  const periodApplied = `Period applied: ${range.label}.`;

  return (
    <div className="workspace reports-page">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Trading workspace</p>
          <h1>Reports</h1>
          <p className="page-subtitle">
            {accountId} · client-side exports and statistics from the data this terminal holds
          </p>
        </div>
        <div className="title-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => uiStore.update((s) => ({ ...s, view: "activity" }))}
            title="Order history and session executions"
          >
            Open Activity
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => uiStore.update((s) => ({ ...s, view: "portfolio" }))}
            title="Equity, P&L and allocation"
          >
            Open Portfolio
          </button>
        </div>
      </section>

      <Panel
        title="Generate a report"
        subtitle="Every file is built from the loaded read models — no request is made when you download"
      >
        <div className="report-controls" role="group" aria-label="Report options">
          <label className="report-control">
            <span>Date range</span>
            <select
              className="input input-sm table-toolbar-select"
              aria-label="Report date range"
              value={period}
              onChange={(event) => setPeriod(event.target.value as ReportPeriod)}
            >
              {REPORT_PERIODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="report-control">
            <span>Format</span>
            <select
              className="input input-sm table-toolbar-select"
              aria-label="Report format"
              value="CSV"
              disabled
              title="CSV is the only format this terminal can produce — PDF needs a backend endpoint"
            >
              <option value="CSV">CSV</option>
            </select>
          </label>
          <p className="report-period-label" role="note">
            {range.label}
          </p>
        </div>
        <p className="report-note" role="note">
          The period applies only to records that carry a timestamp: orders by their UTC submission
          day and session-captured fills by their execution day. The account snapshot has no period
          attribution in the API, so the reports that use it are exported as point-in-time state and
          say so on the card.
        </p>

        <div className="report-grid">
          <ReportCard
            slug="account-statement"
            title="Account Statement"
            icon="briefcase"
            description="Point-in-time snapshot: equity, exposure, per-currency cash and P&L, plus position rows."
            scopeNote="Snapshot at export time — the period filter does not apply."
            blockedReason={statementBlocked}
            build={buildFor(
              "account-statement",
              buildAccountStatement({
                accountId,
                asOfIso: clock.toISOString(),
                summary,
                balance: account.balance,
                positions,
              }),
            )}
          />
          <ReportCard
            slug="trade-history"
            title="Trade History"
            icon="orders"
            description="One row per order exactly as the OMS reports it: ids, side, type, status, quantities, prices, timestamps."
            scopeNote={periodApplied}
            blockedReason={tradeHistoryBlocked}
            build={buildFor("trade-history", buildTradeHistory(ordersInPeriod, brokerName))}
          />
          <ReportCard
            slug="pnl-report"
            title="P&L Report"
            icon="chart"
            description="Per-currency realized and unrealized totals with per-position contributions, kept in separate columns."
            scopeNote="Snapshot — P&L carries no period attribution, so the period filter does not apply."
            blockedReason={pnlBlocked}
            build={buildFor("pnl-report", buildPnlReport(summary, positions))}
          />
          <ReportCard
            slug="risk-report"
            title="Risk Report"
            icon="shield"
            description="Kill-switch state, gross exposure, open positions and the risk violations captured this session."
            scopeNote={`Period not applicable. ${risk.violations.length} violation(s) captured since this terminal opened${
              risk.violations.length === 0 ? " — the violation section is empty, not filled in" : ""
            }.`}
            blockedReason={riskBlocked}
            build={buildFor(
              "risk-report",
              buildRiskReport({
                accountId,
                killSwitchActive: account.killSwitchActive,
                exposure: summary?.exposure ?? null,
                positions,
                violations: risk.violations,
              }),
            )}
          />
          <ReportCard
            slug="custom-report"
            title="Custom Report"
            icon="layers"
            description="Pick the columns you want from the order or the position field set."
            scopeNote={
              customSource === "orders"
                ? periodApplied
                : "Open positions snapshot — the period filter does not apply."
            }
            blockedReason={customBlocked}
            build={buildFor(
              "custom-report",
              customSource === "orders"
                ? buildCustomReport(ordersInPeriod, selectColumns(ORDER_COLUMNS, orderColumnKeys))
                : buildCustomReport(positions, selectColumns(POSITION_COLUMNS, positionColumnKeys)),
            )}
          />
        </div>

        <div className="report-custom" role="group" aria-label="Custom report columns">
          <div className="report-controls">
            <label className="report-control">
              <span>Custom report data set</span>
              <select
                className="input input-sm table-toolbar-select"
                aria-label="Custom report data set"
                value={customSource}
                onChange={(event) =>
                  setCustomSource(event.target.value === "positions" ? "positions" : "orders")
                }
              >
                <option value="orders">Orders (trade history)</option>
                <option value="positions">Positions (open holdings)</option>
              </select>
            </label>
          </div>
          {customSource === "orders" ? (
            <ColumnPicker
              columns={ORDER_COLUMNS.map((column) => ({ key: column.key, label: column.label }))}
              selected={orderColumnKeys}
              onChange={setOrderColumnKeys}
            />
          ) : (
            <ColumnPicker
              columns={POSITION_COLUMNS.map((column) => ({
                key: column.key,
                label: column.label,
              }))}
              selected={positionColumnKeys}
              onChange={setPositionColumnKeys}
            />
          )}
          <p className="report-note" role="note">
            Columns are written in the canonical field order, not the order you ticked them — a CSV
            whose column order depends on click history is not reviewable.
          </p>
        </div>
      </Panel>

      <Panel
        title="Performance summary"
        subtitle="Point-in-time account state — the period filter cannot scope it (no period attribution in the API)"
      >
        {summary === null ? (
          account.summaryState === "error" ? (
            <ErrorState
              message={account.errorMessage ?? "The account summary could not be loaded."}
            />
          ) : (
            <LoadingState label="Loading the account snapshot…" />
          )
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table report-summary-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Currency</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      Equity
                      <span className="cell-muted">account-level aggregate</span>
                    </td>
                    <td className="cell-muted">not reported by the API</td>
                    <td className="num">
                      <MoneyText value={summary.equity} />
                    </td>
                  </tr>
                  <tr>
                    <td>
                      Gross exposure
                      <span className="cell-muted">open positions</span>
                    </td>
                    <td className="cell-muted">not reported by the API</td>
                    <td className="num">
                      <MoneyText value={summary.exposure} />
                    </td>
                  </tr>
                  {pnlRows.map((row) => (
                    <tr key={`${row.label}-${row.currency}`}>
                      <td>
                        {row.label}
                        <span className="cell-muted">
                          {row.label === "Realized P&L"
                            ? "cumulative since engine start"
                            : row.label === "Unrealized P&L"
                              ? "last reported marks"
                              : "open positions"}
                        </span>
                      </td>
                      <td>{row.currency}</td>
                      <td className="num">
                        <MoneyText value={row.value} signed />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="report-note" role="note">
              Realized P&amp;L is cumulative since engine start — it is not a daily or per-period
              figure, and it is not netted against unrealized P&amp;L or costs.
            </p>

            <h3 className="section-title">P&amp;L contribution</h3>
            <SignedBarList
              aria-label="Per-currency P&L contribution"
              items={contributionBars}
              emptyMessage="The account summary reports no per-currency P&L."
              scaleNote="Bars are scaled to the largest absolute value in this list. Realized and unrealized are separate series and are never netted; each value is the backend's own per-currency figure."
            />
          </>
        )}
      </Panel>

      <Panel
        title="Execution statistics"
        subtitle={`Derived from the read models this terminal holds — ${range.label}`}
      >
        <h3 className="section-title">Order outcomes (orders, not executions)</h3>
        <p className="report-note" role="note">
          {outcomeCounts.total} order(s) submitted in this period. Counts use the backend&apos;s own
          status field, and a partially filled order counts once — it is never expanded into one row
          per execution.
        </p>
        <SignedBarList
          aria-label="Order outcome counts"
          items={outcomeBars}
          emptyMessage={`No orders submitted in ${range.label}.`}
          scaleNote="Bars are scaled to the largest count in this list. A count carries no sign, so the bars are intentionally neutral."
        />

        <h3 className="section-title">Session execution capture</h3>
        {fillsInPeriod.length === 0 ? (
          <EmptyState
            message={`No fills captured in ${range.label}.`}
            detail="Fills are captured only while this terminal is connected: the backend persists no execution history (backend ask B5). A fill is matched on the broker's own execution timestamp, so a fill stamped outside the period is never counted — the simulated broker currently stamps executions at the Unix epoch (1970-01-01), which is why the Activity screen can show fills that this period-filtered panel excludes."
          />
        ) : (
          <>
            <div className="activity-stats">
              <div className="activity-stat">
                <span className="activity-stat-value num">{fillsInPeriod.length}</span>
                <span className="activity-stat-label">Fills captured</span>
              </div>
              <div className="activity-stat">
                <span className="activity-stat-value num">{coverage.reported}</span>
                <span className="activity-stat-label">With cost data</span>
              </div>
              <div className="activity-stat">
                <span className="activity-stat-value num">{notional.length}</span>
                <span className="activity-stat-label">Currencies traded</span>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table report-summary-table">
                <thead>
                  <tr>
                    <th>Gross traded notional</th>
                    <th>Currency</th>
                    <th className="num">Σ quantity × price</th>
                  </tr>
                </thead>
                <tbody>
                  {notional.map((entry) => (
                    <tr key={entry.currency}>
                      <td>
                        Turnover
                        <span className="cell-muted">buys and sells both add to it</span>
                      </td>
                      <td>{entry.currency}</td>
                      <td className="num">
                        <MoneyText value={entry.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="report-note" role="note">
              Commission or fee data was reported on {coverage.reported} of {coverage.total}{" "}
              captured fill(s), so no net (after-cost) figure is produced — an incomplete total
              would be silently understated. Per currency, never summed.
            </p>
          </>
        )}
        <p className="report-note" role="note">
          {`Session memory only: ${executions.ids.length} fill(s) arrived over the WebSocket since this terminal opened${
            executions.capturedFrom === null
              ? " (nothing captured yet)"
              : ` (first captured ${executions.capturedFrom})`
          }, of which ${fillsInPeriod.length} fall inside the selected period. Reloading the page loses them, at most the newest 500 are kept, and nothing is replayed after a reconnect.`}
        </p>
      </Panel>

      <Panel
        title="How these figures are calculated"
        subtitle="Formula, inputs, where each value is computed, and its limits"
      >
        <div className="table-scroll">
          <table className="data-table gap-table report-methodology-table">
            <thead>
              <tr>
                <th>Figure</th>
                <th>Formula / source</th>
                <th>Computed in</th>
                <th>Assumptions and limits</th>
              </tr>
            </thead>
            <tbody>
              {METHODOLOGY.map((row) => (
                <tr key={row.figure}>
                  <td>{row.figure}</td>
                  <td>
                    <code>{row.formula}</code>
                  </td>
                  <td>{row.computedIn}</td>
                  <td>{row.limits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Not available in this build"
        subtitle="Design elements and metrics with no data source — stated, not simulated"
      >
        <div className="table-scroll">
          <table className="data-table gap-table">
            <thead>
              <tr>
                <th>Element or metric</th>
                <th>Why it is not built</th>
                <th>Backend work required</th>
              </tr>
            </thead>
            <tbody>
              {UNSUPPORTED.map((row) => (
                <tr key={row.element}>
                  <td>{row.element}</td>
                  <td>{row.reason}</td>
                  <td>
                    <code>{row.ask}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/** Checkbox column picker for the Custom Report (orders or positions). */
function ColumnPicker({
  columns,
  selected,
  onChange,
}: {
  columns: readonly { key: string; label: string }[];
  selected: readonly string[];
  onChange: (keys: string[]) => void;
}) {
  return (
    <fieldset className="report-columns">
      <legend>Columns</legend>
      {columns.map((column) => (
        <label key={column.key} className="report-column">
          <input
            type="checkbox"
            checked={selected.includes(column.key)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, column.key]
                  : selected.filter((key) => key !== column.key),
              )
            }
          />
          <span>{column.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
