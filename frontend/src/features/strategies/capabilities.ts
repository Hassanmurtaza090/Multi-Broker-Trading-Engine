/**
 * Strategy capability registry (FE-M7).
 *
 * WHY THIS FILE IS DATA AND NOT UI: this deployment has NO strategy service.
 * A repository-wide search for "strateg" across `backend/` (sources, tests,
 * config, migrations, OpenAPI) returns zero matches: there is no strategy
 * domain package, no route in `backend/api/rest.py`, no schema in
 * `backend/api/schemas.py`, no event in `backend/events/types.py`, and no
 * `strategy_id` anywhere on `OrderRequest` / `Order` / `Fill`.
 *
 * Therefore the Strategies screen cannot list, create, start, stop or
 * backtest a strategy — every one of those actions would have to fabricate
 * its data or its success. Instead this module records, per capability the
 * Figma prototype shows, (a) what the design displays, (b) why the platform
 * cannot do it today, and (c) the exact backend work that would make it real.
 *
 * Keeping it as plain data means the grid, the counts and the required-work
 * list are unit-testable without rendering, and that flipping a capability to
 * "available" later is a one-line change that must be backed by a real
 * endpoint and a real test — not by editing JSX.
 *
 * Figma reference: Make file `u7bqch89fB2Z6UtUbHSVB3`, `src/App.tsx:206`
 * (the "Strategies" screen body: metrics + tabs "Active strategies" /
 * "Backtest" / "Library" + DataTable + Pause/Resume + Create + Run backtest).
 */

export type StrategyCapabilityId =
  "listing" | "configuration" | "lifecycle" | "attribution" | "deployment" | "backtest" | "library";

/** The prototype's three tabs; used to group capabilities in the UI. */
export type StrategyArea = "active" | "backtest" | "library";

/**
 * `unavailable` is the only status this deployment can honestly report today;
 * `available` exists in the union so a future milestone must also supply the
 * real data source (and tests) in the same change that flips a capability.
 */
export type StrategyCapabilityStatus = "unavailable" | "available";

export interface StrategyCapability {
  id: StrategyCapabilityId;
  /** Prototype tab this capability belongs to. */
  area: StrategyArea;
  /** Human title for the capability row. */
  title: string;
  /** What the Figma prototype displays for this capability. */
  design: string;
  status: StrategyCapabilityStatus;
  /** Why it cannot be built against the current backend. */
  reason: string;
  /** Exact backend work required (endpoints / contracts / services). */
  requires: readonly string[];
}

export const STRATEGY_AREAS: readonly { value: StrategyArea; label: string }[] = [
  { value: "active", label: "Active strategies" },
  { value: "backtest", label: "Backtest" },
  { value: "library", label: "Library" },
];

export const STRATEGY_CAPABILITIES: readonly StrategyCapability[] = [
  {
    id: "listing",
    area: "active",
    title: "Strategy list & overview",
    design:
      "Metrics “Active strategies / Strategy P&L / Execution health” and a table of Strategy name | Symbol | Status | Last run.",
    status: "unavailable",
    reason:
      "No strategy resource exists: there is no strategy route, no strategy schema and no strategy store, so any row — or even an honest “0 strategies” count — would have to be invented.",
    requires: [
      "GET /api/v1/strategies?account_id= → [{ strategy_id, name, type, status, account_id, symbols[], created_at, updated_at }] (permission `strategies:read`, account-scoped like orders).",
      "Status values from a server-defined enum (e.g. draft | configured | running | stopped | failed). The client must never invent lifecycle states.",
    ],
  },
  {
    id: "configuration",
    area: "active",
    title: "Strategy configuration",
    design: "Per-strategy parameter editing with defaults and constraints.",
    status: "unavailable",
    reason:
      "There are no strategy parameter definitions to validate against. The terminal's existing validation (`features/orders/ticketValidation.ts`) describes order fields only and cannot be reused for strategy parameters.",
    requires: [
      "GET /api/v1/strategies/{strategy_id} → typed parameter descriptors { name, type, default, min, max, enum[], required } so the form can be schema-driven instead of hardcoded.",
      "PUT /api/v1/strategies/{strategy_id}/config with server-side validation returning per-field 422 errors the form can render.",
      "An optimistic-concurrency token (version or updated_at) so a stale edit cannot silently overwrite a newer configuration.",
    ],
  },
  {
    id: "lifecycle",
    area: "active",
    title: "Lifecycle controls (start / stop / pause / resume)",
    design: "“Pause” / “Resume” buttons that change a strategy's status.",
    status: "unavailable",
    reason:
      "Nothing can be started: there is no strategy runtime, scheduler or execution service in the engine. With no endpoint and no runtime, a Pause/Resume control would fake both the request and the resulting state.",
    requires: [
      "A strategy runtime that owns strategy state (a backend feature, not an endpoint).",
      "POST /api/v1/strategies/{strategy_id}:start | :stop | :pause | :resume, each returning the authoritative new state and idempotent per transition.",
      "An audit record per transition (subject, strategy, from, to) matching the existing kill-switch audit pattern.",
      "Orders produced by a strategy MUST pass the existing risk gate (`backend/risk/gate.py`); no bypass path may be introduced.",
    ],
  },
  {
    id: "attribution",
    area: "active",
    title: "Per-strategy P&L",
    design: "A per-strategy P&L metric with a period return.",
    status: "unavailable",
    reason:
      "Attribution is structurally impossible today: `OrderRequest` carries no strategy reference, so an order — and therefore a fill — cannot be tied to a strategy. No aggregation by strategy exists in the portfolio accounting.",
    requires: [
      "An optional `strategy_id` on OrderRequest, propagated to Order and Fill, validated server-side against the account's strategies.",
      "GET /api/v1/strategies/{strategy_id}/performance → realized/unrealized per currency and fill count.",
      "Attribution must reuse the existing portfolio accounting rather than adding a second P&L implementation.",
    ],
  },
  {
    id: "deployment",
    area: "active",
    title: "Deployment to a broker account",
    design: "Running strategies are implicitly bound to accounts/brokers.",
    status: "unavailable",
    reason:
      "Deployment means a strategy placing real orders. The engine's execution path exists for MANUAL orders only (risk-gated submit through the OMS); there is no strategy→account binding and no execution service to deploy.",
    requires: [
      "Explicit per-strategy account binding enforced with the same account-scope authorization used by orders.",
      "A deployment record (account_id, config_version, deployed_at) plus an explicit undeploy transition.",
      "Server-side confirmation that strategy orders pass the risk gate before any UI may claim a strategy is “deployed”.",
    ],
  },
  {
    id: "backtest",
    area: "backtest",
    title: "Backtesting",
    design:
      "Strategy + period selectors and a “Run backtest” button that reports trades, win rate and return.",
    status: "unavailable",
    reason:
      "There is no backtest engine and — critically — no historical bars to run one on: `market.bar.updated` exists and the market-data engine can publish it, but nothing in the repository ever produces a bar (`emit_bar` has no caller outside its definition), so even a client-side simulation would have zero inputs.",
    requires: [
      "A bars producer/source and a historical bar store (bars are currently never emitted).",
      "POST /api/v1/backtests → { backtest_id } plus GET /api/v1/backtests/{backtest_id} → status, metrics (trades, win_rate, return, max_drawdown, sharpe) and an equity curve.",
      "Persisted runs that snapshot the exact configuration used, so a result is reproducible and auditable.",
    ],
  },
  {
    id: "library",
    area: "library",
    title: "Strategy library & creation",
    design: "“+ Create new strategy” opening a library of strategy types.",
    status: "unavailable",
    reason:
      "There are no strategy types or templates to create from, so a creation form would have no fields and no valid choices.",
    requires: [
      "GET /api/v1/strategy-types → [{ type, display_name, description, parameters[] }].",
      "POST /api/v1/strategies validating the type and its parameters server-side.",
      "A response shape that lets the UI distinguish “no strategies yet” from “no strategy service” — the two states must never look alike.",
    ],
  },
];

export interface CapabilitySummary {
  total: number;
  available: number;
  unavailable: number;
}

/** Counts for the page header and the metrics row. */
export function summarizeCapabilities(
  capabilities: readonly StrategyCapability[] = STRATEGY_CAPABILITIES,
): CapabilitySummary {
  const available = capabilities.filter((item) => item.status === "available").length;
  return {
    total: capabilities.length,
    available,
    unavailable: capabilities.length - available,
  };
}

/** Capabilities for one prototype tab, in registry order. */
export function capabilitiesByArea(
  area: StrategyArea,
  capabilities: readonly StrategyCapability[] = STRATEGY_CAPABILITIES,
): StrategyCapability[] {
  return capabilities.filter((item) => item.area === area);
}

/**
 * System-level gaps that are not a per-capability endpoint: they explain why
 * the strategy feature is absent by construction rather than merely unwired.
 */
export const STRATEGY_SYSTEM_GAPS: readonly { title: string; detail: string }[] = [
  {
    title: "No strategy domain",
    detail:
      "The engine has order, position, portfolio, risk, market-data, execution and broker packages — no strategy package, no strategy entity, no strategy tests.",
  },
  {
    title: "No runtime to run a strategy",
    detail:
      "Order flow is driven by API submissions through the risk gate. There is no scheduler or loop that would evaluate a strategy on market data and generate orders.",
  },
  {
    title: "No bars are ever produced",
    detail:
      "`market.bar.updated` is defined and plumbed, but no producer calls `emit_bar`, so OHLCV history does not exist for charting or backtesting.",
  },
  {
    title: "No attribution key on orders",
    detail:
      "`OrderRequest` has no strategy field, so even a manually-run strategy's orders could not be separated from discretionary ones afterwards.",
  },
];

/**
 * Building blocks that ALREADY exist and that a future strategy service must
 * reuse rather than re-implement. Recorded so the backend work is scoped
 * honestly (strategy support = wiring into these, not a parallel stack).
 */
export const STRATEGY_REUSABLE_FOUNDATIONS: readonly { title: string; detail: string }[] = [
  {
    title: "Risk gate",
    detail:
      "`backend/risk/gate.py` is the single submit path, enforcing 8 pre-trade rules and the kill switch. Strategy orders must go through it unchanged.",
  },
  {
    title: "OMS + idempotency",
    detail:
      "Orders carry client-generated ids and idempotency keys; a retrying strategy would inherit duplicate-submission protection.",
  },
  {
    title: "Event bus",
    detail:
      "`order.*`, `position.*`, `market.quote.updated` and `risk.violation` already stream on the terminal's single WebSocket — strategy status would be one more topic, not a new connection.",
  },
  {
    title: "Portfolio accounting",
    detail:
      "Realized/unrealized P&L per currency already exists; per-strategy performance should be a projection over it, not new math.",
  },
];
