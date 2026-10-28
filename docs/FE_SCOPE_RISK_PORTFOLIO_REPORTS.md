# Frontend Scope Spec — Risk Management, Portfolio, Reports

| Field | Value |
| --- | --- |
| Status | PROPOSED SCOPE — not implemented |
| Date | 2026-10-28 |
| Branch | `feat/m1-figma-terminal` |
| Baseline commit | `595710d` (FE-M6) + documentation correction |
| Precedes | FE-M7 (Strategy Management, in progress) |
| Scope owner | Frontend |
| Candidate milestone | FE-M8 (Risk Management + Portfolio promotion + Reports), or split as FE-M8/FE-M9 |

This document specifies the next three Figma destinations that **are backed by
existing backend capability** and therefore can be built honestly now. It
deliberately excludes Strategies (FE-M7, being built as an explicit
"capability not present" module), Administration and Settings (no backend
support — see §8).

---

## 0. Provenance and method

Every claim below is traceable to one of two sources.

**Design source (Figma Make, read-only).** File key `u7bqch89fB2Z6UtUbHSVB3`,
read as MCP resources:

| Path | What it establishes |
| --- | --- |
| `src/App.tsx:40-49` | Sidebar WORKSPACE list: Overview, Trade, Orders, Positions, Accounts, Activity, **Portfolio**, **Market Data** |
| `src/App.tsx:99` | Sidebar PLATFORM list: Strategies, **Risk Management**, **Reports**, Administration, Settings, Login |
| `src/App.tsx:205` | Portfolio screen body |
| `src/App.tsx:207` | Risk Management screen body |
| `src/App.tsx:208` | Reports screen body |
| `src/App.tsx:211` | Market Data screen body (already partly covered by FE-M6) |
| `src/index.css` | Design tokens / class vocabulary reused by FE-M1 |

**Limitation:** Figma MCP access is text/source only. I cannot list the Make
project tree and cannot view rendered images. All design statements below are
**structural** (markup, copy, layout composition, interaction handlers), never
pixel-level. Any visual-fidelity claim requires the user to confirm against the
rendered prototype.

**Backend source (authoritative).** `backend/api/rest.py` route decorators,
`backend/api/schemas.py` DTOs, `backend/risk/*.py`, `backend/api/ws.py`
`_TOPIC_EVENTS`, `backend/api/auth.py` `READ_PERMISSIONS` /
`ROLE_PERMISSIONS`.

---

## 1. Current frontend state

| Destination | Today | Gap |
| --- | --- | --- |
| Accounts (`accounts` view) | `pages/PortfolioPage.tsx` renders metrics + `AllocationCard` + `AccountsCard` (cash balances, brokers) | Portfolio is **folded into** the Accounts destination |
| Portfolio | not a destination | design has a separate Portfolio screen |
| Risk Management | `features/risk/RiskPanel.tsx` (kill switch + violation feed) mounted inside the Trade screen only | no destination, no exposure/equity surface, no ticket dry-run, configured limits invisible |
| Reports | none | no destination |

Existing primitives to reuse, no new ones required: `Panel`, `StatusBadge`,
`Status` (`LoadingState`, `EmptyState`, `ErrorState`), `MoneyText`,
`ConfirmDialog`, `SegmentedControl`, `Sparkline`, `Icon` (`layers`, `chart`,
`briefcase`, `wallet`, `history`, `settings` all exist).

---

## 2. Hard rules for all three screens

These repeat `AGENTS.md` because these screens are the ones most likely to
tempt fabrication.

1. **No invented numbers.** If the API does not report a figure, the cell shows
   `—`; it never shows `0`, and it never shows a plausible-looking demo value.
2. **The backend is authoritative.** Frontend arithmetic is presentation only
   (already the rule in `features/portfolio/allocation.ts`). No frontend
   recomputation may contradict a server-reported total; if they differ, show
   the server value and flag the difference.
3. **No cross-currency totals.** `account/summary` returns `dict[str, str]`
   keyed by currency and there is **no FX conversion** (ADR-013 limitation).
   Totals are per-currency or absent — never summed.
4. **No silent demo data.** Demo/mock content may exist only in tests/fixtures,
   never as a fallback when an API call fails.
5. **Every control performs a real action** or is rendered disabled with a
   stated reason.
6. **Permissions are server-enforced**; the UI gate is UX only and must mirror
   the real permission (`risk:admin` for kill-switch writes).

---

## 3. Screen A — Risk Management

### 3.1 Design content (structural, `App.tsx:207`)

- Three metrics: **Total exposure** (`52.2% of equity`), **Daily drawdown**
  (`Limit 5.0%`), **Margin level** (`Healthy`).
- Panel "Risk metrics": table with **Position concentration**, **VaR (95%)**,
  **Max drawdown**, **Leverage**.
- Panel "Risk alerts": timestamped list of coloured alert strings.

### 3.2 Backed by the API today

| Design element | Backed? | Source | Notes |
| --- | --- | --- | --- |
| Total exposure | ✅ | `GET /api/v1/accounts/{id}/summary` → `AccountSummaryOut.exposure` (`str \| None`) | `None` → `—`. Single value, no currency key on the field; derive currency from `market_value` keys only if unambiguous, else show bare number with a "currency not reported per field" note |
| Exposure as % of equity | ⚠️ derivable | `exposure` ÷ `equity` | **Presentation-only** ratio of two server values; must be labelled "derived from server equity/exposure", and suppressed if either is `None` or equity is 0 |
| Position concentration | ⚠️ derivable | `GET /accounts/{id}/positions` → existing `computeAllocation()` gross shares | Per-currency; label "largest position share of gross exposure (per currency)" — **not** "concentration" in the regulatory sense |
| Risk violations / alerts feed | ✅ | WS `risk.violation` (`_TOPIC_EVENTS["risk"]`) + `riskStore.violations` | Already implemented in `RiskPanel`; move/extend, do not duplicate the store |
| Kill-switch state | ✅ | `GET /accounts/{id}/risk/kill-switch` (`risk:read`) | already wired via `accountStore` |
| Kill-switch toggle | ✅ | `POST /accounts/{id}/risk/kill-switch` (`risk:admin`, audit-logged) | already wired; keep `ConfirmDialog` + pending/error states |
| Pre-trade dry run | ✅ | `POST /accounts/{id}/risk/evaluate` body `OrderCreateIn` → `RiskDecisionOut` (`orders:write`) | currently only reachable inside the ticket; expose as an explicit "Test an order against risk" panel |
| Configured limits | ❌ | limits live in `RiskLimits` env config; **no endpoint exposes them** | show "Not exposed by the API" + backend ask B1 |

### 3.3 Not backed — must **not** be built

| Design element | Why not |
| --- | --- |
| Daily drawdown (`2.8%`, `Limit 5.0%`) | no equity time series, no start-of-day equity, no exposure of `max_daily_loss`. A drawdown requires a persisted equity curve. |
| Margin level (`412.5%`) | no margin/requirement data in any DTO. |
| VaR (95%) | no returns series, no covariance, no risk model. Computing one from a handful of session quotes would be statistically meaningless and would look authoritative. |
| Max drawdown | requires the same equity curve as above. |
| Leverage (`1.4×`) | requires equity **and** gross exposure in one currency plus a regulatory definition; cross-currency makes it unavailable. |
| Threshold-based "alerts" with severity semantics | only *rejections* (`risk.violation`) exist. Presenting rejections as "warnings" would misrepresent a hard gate as a soft alert. |

If the UI shows these at all, it shows them as an explicit
"Not reported by this platform" list **inside** the page (the FE-M6
`limitations panel` pattern), never as empty tiles that look like loading.

### 3.4 Proposed implementation

| File | Change |
| --- | --- |
| `frontend/src/stores/uiStore.ts` | add `"risk"` to `TerminalView` |
| `frontend/src/layouts/TerminalLayout.tsx` | `VIEWS` gains `{ id: "risk", label: "Risk Management", icon: "shield" }` (new icon) placed per design order (PLATFORM section) |
| `frontend/src/App.tsx` | render `<RiskPage />` for `view === "risk"` |
| `frontend/src/pages/RiskPage.tsx` (NEW) | composition only: metrics row + `ExposurePanel` + `RiskLimitsCard` + `RiskTestPanel` + existing `RiskPanel` (kill switch + violations) |
| `frontend/src/features/risk/RiskMetricsCard.tsx` (NEW) | total exposure, exposure/equity (derived, labelled), concentration (from `computeAllocation`), `—` when unavailable |
| `frontend/src/features/risk/RiskLimitsCard.tsx` (NEW) | renders the 8 rule names with values `—` and a one-line "limits are server configuration and not exposed by the API" note (flips to real values when B1 lands) |
| `frontend/src/features/risk/RiskTestPanel.tsx` (NEW) | reuses `OrderCreateIn` fields + `api.evaluateRisk(...)`, renders `approved` + per-rule `RuleResultOut` incl. `data_unavailable`; **no mutation** |
| `frontend/src/services/api.ts` | **only if** `evaluateRisk` is absent — reuse the existing typed client, do not add a second client |

Design inference to record: the design's alert list is replaced by the
violation feed (same visual slot, honest semantics). Screen is rendered for
read-only roles with the toggle gated exactly as `RiskPanel` does today.

### 3.5 Tests

- Metrics render server values verbatim; `None` → `—`, never `0`.
- Derived exposure % is suppressed when equity is `None` or `0`.
- Limits card shows all 8 rule names with `—` and the unavailability note.
- Dry run: success renders `approved: true`; rejection renders each violation
  reason; `data_unavailable` is surfaced distinctly, not as a soft warning.
- Dry run never calls `POST /orders` (assert on the mocked client).
- Kill-switch toggle: confirmation required, pending disables the button
  (duplicate-submit guard), API failure keeps prior state and shows the error.
- Non-admin sees state + explanation, no toggle.
- Loading / error / retry for `summary` and `positions`.

---

## 4. Screen B — Portfolio

### 4.1 Design content (structural, `App.tsx:205`)

- Metrics: **Portfolio equity**, **Day P&L**, **Unrealized P&L**.
- Panel "Asset allocation": donut with total equity + static class shares
  (Cash / Stocks / Forex / Options / Others).
- Panel "Account balances": table Broker | Balance | Available with IBKR /
  Saxo Bank / OANDA rows.
- Panel "Portfolio holdings": Symbol | Quantity | Average | Last | P&L | %.

### 4.2 Backed by the API today

| Design element | Backed? | Source | Notes |
| --- | --- | --- | --- |
| Portfolio equity | ✅ | `summary.equity` (`str \| None`) | single value |
| Unrealized P&L | ✅ | `summary.unrealized_pnl` (`dict[currency → str]`) | **per currency**, render one line per currency |
| Realized P&L | ✅ (add) | `summary.realized_pnl` | not in the design; include it, it is free and real |
| Day P&L | ❌ | no start-of-day equity / no prior close | replace with realized + unrealized split (real, honest) and state the substitution |
| Account balances (Balance / Available) | ✅ | `GET /accounts/{id}/balance` → `BalanceOut.cash[] { currency, total, available, buying_power }` | **per account, per currency**; `buying_power` is nullable |
| Broker list | ✅ | `GET /brokers` → `[{ name, connected }]` | names + connection state only, no balances per broker |
| Holdings table | ✅ | `GET /accounts/{id}/positions` | Symbol, Quantity, Average (`average_price`, nullable), Last (`market_price`, nullable), P&L (`unrealized_pnl`, nullable, per row currency), % → `—` |
| Asset allocation | ⚠️ partial | `computeAllocation()` over positions | allocation is **per instrument, per currency**, not by asset class; there is no asset-class bucket in any DTO for positions |
| Multi-account / multi-broker balances in one table | ❌ | **no `GET /accounts`**; the client only knows the account ids in its token scope | one account at a time via the existing header selector |

### 4.3 Not backed — must **not** be built

- **Donut by asset class** (Cash/Stocks/Forex/Options/Others): no asset-class
  field on `PositionOut`; the engine is broker-agnostic and positions carry
  symbol/exchange/currency only.
- **Cross-broker balance table** (IBKR + Saxo + OANDA in one view): requires
  `GET /accounts` (B2). Until then, show the current account only, clearly.
- **Cross-currency portfolio total**: forbidden by §2.3.
- **Day P&L**: no prior-close / SOD equity (B3).

### 4.4 Proposed implementation

Promote Portfolio to its own destination **without removing the Accounts
view**; Accounts keeps cash/brokers, Portfolio owns equity/P&L/allocation.

| File | Change |
| --- | --- |
| `uiStore.ts` / `App.tsx` / `TerminalLayout.tsx` | add `"portfolio"` view, label "Portfolio", icon `briefcase`, positioned after Accounts per design |
| `frontend/src/pages/PortfolioViewPage.tsx` (NEW, or rename if `PortfolioPage` is repurposed) | metrics + allocation + balances + holdings |
| `frontend/src/features/portfolio/PortfolioMetricsCard.tsx` | extend: realized/unrealized per currency; remove the "Day P&L" slot or label it unavailable |
| `frontend/src/features/portfolio/AllocationCard.tsx` | reuse as-is |
| `frontend/src/features/portfolio/BalancesCard.tsx` (NEW) | `BalanceOut.cash[]` table with `—` for null `buying_power` |
| `frontend/src/features/positions/PositionsTable.tsx` | reuse for holdings (do not fork a second table) |

Naming note: `pages/PortfolioPage.tsx` already exists and renders the Accounts
destination. Rename it to `AccountsPage.tsx` as part of this milestone (small,
mechanical, test-covered) so the names stop lying.

### 4.5 Tests

- Per-currency P&L rendered as separate rows; never summed.
- `equity: null` → `—`; no `0`.
- Balance rows: null `buying_power` → `—`.
- Allocation groups stay currency-scoped (existing allocation tests cover the
  math; add a rendering test for the new page).
- Account switch re-fetches and never mixes two accounts' rows.
- Loading / error / empty (no positions, no cash rows) states.
- Nav: Portfolio enabled, Accounts still enabled.

---

## 5. Screen C — Reports

### 5.1 Design content (structural, `App.tsx:208`)

- "Generate a report": date-range select (Last 30 days / Last 7 days / This
  year), format select (**CSV** / **PDF preview**).
- Five report cards: Account Statement, Trade History, P&L Report, Risk Report,
  Custom Report. Each handler builds a hardcoded CSV string and downloads it.

### 5.2 Reality

There is **no reporting endpoint**. `GET /orders` accepts **only** an optional
`account_id` query parameter — no date range, no status filter, no pagination.
Executions are not persisted (no read model; already documented as the FE-M5
gap). Reports must therefore be **client-side exports of data already fetched**,
with the source of each row made explicit.

### 5.3 Supported reports (real data only)

| Report | Data source | Honest content | Constraints to surface in the UI |
| --- | --- | --- | --- |
| **Trade History** | `GET /orders?account_id=…` | every `OrderOut` field (ids, side, type, status, qty, filled, remaining, limit/stop, TIF, broker id, rejection reason, timestamps) | date range filters **client-side** on `created_at`; the set is what the OMS returns for this account — say so |
| **Account Statement** | `summary` + `balance` + `positions` | equity, exposure, per-currency realized/unrealized, cash rows, position rows | a point-in-time snapshot at export time, **not** a periodic statement |
| **P&L Report** | `summary` (+ per-position `unrealized_pnl`) | per-currency realized and unrealized totals and per-position contributions | no fees/commissions (not modelled in `OrderOut`), no FX conversion |
| **Risk Report** | current kill-switch state, `summary.exposure`, current positions, **the violation list currently held in the session** | exposure + rule names (values unavailable) + session violations | violations are **session-only** (client memory, no persistence); label as such |
| **Custom Report** | user picks columns from the Trade History / positions field sets | the selected columns only | column picker is a UI convenience, not a server query |

Formats: **CSV only**. "PDF preview" is removed from the select; if the PDF
requirement matters, it is a backend ask (B4), not a client-side canvas hack.

### 5.4 Not backed — must **not** be built

- PDF/HTML rendered reports, branded statements, scheduled/emailed reports.
- Server-side aggregation, pagination or historical statements ("as of" dates).
- Any report whose rows would be synthesised because a fetch failed: on error
  the card shows an error state and the download stays disabled.

### 5.5 Proposed implementation

| File | Change |
| --- | --- |
| `uiStore.ts` / `App.tsx` / `TerminalLayout.tsx` | add `"reports"` view, label "Reports", icon `orders` or new `download` |
| `frontend/src/pages/ReportsPage.tsx` (NEW) | range control + report cards + limitation panel |
| `frontend/src/features/reports/csv.ts` (NEW) | pure: `toCsv(headers, rows)` with RFC-4180 quoting, CRLF, deterministic column order — unit-tested including commas/quotes/newlines/injection (`=`, `+`, `-`, `@` prefix guard) |
| `frontend/src/features/reports/builders.ts` (NEW) | pure per-report row builders over already-fetched typed data → `{ headers, rows }` |
| `frontend/src/features/reports/download.ts` (NEW) | `Blob` + `URL.createObjectURL` + revoke, filename includes account + timestamp; no-op-safe in jsdom |
| `frontend/src/features/reports/ReportCard.tsx` (NEW) | per-card loading / error / disabled-with-reason states |

CSV injection guard is mandatory: cell values beginning with `=`, `+`, `-`,
`@`, tab or CR are prefixed with `'`. Values are never trusted because broker
rejection reasons and symbols come from outside.

### 5.6 Tests

- `toCsv` quoting/CRLF/escaping/injection-prefix (pure, exhaustive).
- Each builder maps real DTOs to the documented columns; nulls → empty cell,
  not `0`.
- Date-range filter is client-side and inclusive/exclusive at the documented
  boundaries (fixed fixture timestamps, no `Date.now()` dependence).
- Download disabled while loading, on error, and when there are zero rows
  (with reason), enabled on success.
- Session-violations report states "session only"; empty violations produce a
  header-only CSV, not a fabricated row.
- No network call is made by the download handler (assert on mocked client).
- Csv blob content asserted by capturing `URL.createObjectURL` input.

---

## 6. Shared navigation and IA changes

All three screens are additive to `TerminalView`:

```ts
export type TerminalView =
  | "overview" | "dashboard" | "markets" | "orders" | "positions"
  | "accounts" | "activity" | "strategies"
  | "portfolio" | "risk" | "reports";
```

Ordering follows the prototype: WORKSPACE = Overview, Trade, Orders, Positions,
Accounts, **Portfolio**, Market Data; PLATFORM = **Strategies**, **Risk
Management**, **Reports**, Administration, Settings (last two remain visibly
disabled).

Deferred, tracked separately: renaming `markets` → `marketData` / label
"Market Data" (see the FE-M6 correction in `PROJECT_STATUS.md`).

---

## 7. Backend asks (exact, minimal)

| ID | Need | Proposed contract | Unlocks |
| --- | --- | --- | --- |
| B1 | Expose effective risk limits | `GET /api/v1/accounts/{account_id}/risk/limits` → `{ account_id, limits: { max_order_quantity: str\|null, position_limit: str\|null, max_notional_exposure: str\|null, max_daily_orders: int\|null, max_daily_loss: str\|null, trading_window: {start,end}\|null, require_available_funds: bool } }`, `risk:read` | Risk limits card shows real values + per-rule configured/not-configured |
| B2 | Account registry | `GET /api/v1/accounts` → `[{ account_id, broker, label, currency }]` scoped by `principal.account_ids_visible()` | multi-account Portfolio table, honest "+ Add account" (read-only) |
| B3 | Equity/P&L time series | `GET /api/v1/accounts/{id}/equity?from=&to=&interval=` → `[{ at, equity, realized, unrealized }]` | Day P&L, drawdown, max drawdown, equity sparkline beyond the session |
| B4 | Report generation | `POST /api/v1/accounts/{id}/reports` → `{ report_id, format }` + `GET .../reports/{id}` download | PDF, server-side aggregation, historical statements |
| B5 | Executions read model | `GET /api/v1/executions?account_id=&from=&to=` → `Fill` rows | true historical Trade History / P&L with commissions |
| B6 | Risk-violation history | `GET /api/v1/accounts/{id}/risk/violations?from=&to=` | Risk Report beyond session memory |

None of B1–B6 is required to ship the three screens; each one upgrades a
documented "unavailable" cell to real data without changing a component
contract, exactly like the FE-M6 watchlist-storage flip.

---

## 8. Explicitly out of scope

- **Strategies**, **Administration**, **Settings** — no backend capability.
  Strategies is FE-M7 and is implemented as a documented capability matrix.
  Administration needs user CRUD, and the design's "Risk Manager" role does not
  exist (`risk:admin` is a permission of `admin`). Settings persistence needs a
  server-side preferences resource; only theme/default-view local prefs are
  honest, and they already exist where applicable.
- Close-all / cancel-all bulk actions: no such endpoints (individual cancel
  only). Not introduced here.
- Any new charting dependency; `Sparkline` and `ChartWorkspace` cover the need.

---

## 9. Sequencing and acceptance

Recommended split (each independently shippable and verifiable):

1. **FE-M8 — Risk Management** (§3). Highest value: surfaces the only
   compliance-critical engine the UI barely shows, all backed.
2. **FE-M9 — Portfolio promotion + Reports** (§4, §5). Pure read/export, no
   new backend.

Acceptance for each: implementation + the §tests added + `npm run
format/lint/typecheck/test/build` green + one added `scripts/visual-check.mjs`
step verified against the sim stack + `PROJECT_STATUS.md` and `TEST_STATUS.md`
records updated with **executed** results.

`PortfolioPage.tsx` → `AccountsPage.tsx` rename lands with FE-M9 step 1 (Portfolio
promotion) to keep the diff reviewable.
