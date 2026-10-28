/**
 * Strategies page (FE-M7) — Strategy Management.
 *
 * HARD CONSTRAINT: this deployment has no strategy service. `backend/` has no
 * strategy package, route, schema, event or test, and `OrderRequest` carries no
 * strategy reference, so nothing here may list, create, start, stop, backtest
 * or report a strategy. Every value the prototype displays is therefore "—"
 * with the reason stated next to it, and every control the prototype offers is
 * disabled with a stated reason.
 *
 * What the page DOES do (all real):
 * - states the capability gap precisely, per designed feature, with the exact
 *   backend work required (see `features/strategies/capabilities.ts`);
 * - routes the user to the capabilities that genuinely exist today — manual
 *   risk-gated order entry, order history/fills, positions and portfolio;
 * - performs NO network request and triggers NO lifecycle action, on mount or
 *   otherwise. There is no strategy endpoint to call; calling one would be a
 *   fabricated interaction.
 *
 * Design source: Figma Make `u7bqch89fB2Z6UtUbHSVB3`, `src/App.tsx:206`
 * (metrics row, tabs "Active strategies" / "Backtest" / "Library", the
 * Strategy name | Symbol | Status | Last run table, Pause/Resume, "+ Create new
 * strategy", "Run backtest"). Layout is preserved; content is honest.
 */

import { useState } from "react";

import { Panel } from "../components/Panel";
import { SegmentedControl } from "../components/SegmentedControl";
import {
  STRATEGY_AREAS,
  STRATEGY_REUSABLE_FOUNDATIONS,
  STRATEGY_SYSTEM_GAPS,
  capabilitiesByArea,
  summarizeCapabilities,
  type StrategyArea,
} from "../features/strategies/capabilities";
import {
  StrategyCapabilityCard,
  StrategyRecordsTable,
} from "../features/strategies/StrategyCapabilityCard";
import { uiStore } from "../stores";
import { useStoreState } from "../stores/store";

/** The prototype's three metric slots, each unbacked. */
const DESIGN_METRICS: readonly { label: string; design: string; blocker: string }[] = [
  {
    label: "Active strategies",
    design: "an active/stopped strategy count",
    blocker: "No strategy resource is exposed by the API.",
  },
  {
    label: "Strategy P&L",
    design: "a monthly per-strategy P&L figure",
    blocker: "Orders carry no strategy reference, so fills cannot be attributed.",
  },
  {
    label: "Execution health",
    design: "an execution-health percentage",
    blocker: "No strategy execution service reports health.",
  },
];

/** Actions the prototype offers, all impossible today — disabled, never faked. */
const DESIGN_ACTIONS: readonly { area: StrategyArea; label: string; reason: string }[] = [
  {
    area: "active",
    label: "Pause / resume strategy",
    reason:
      "No lifecycle endpoint and no strategy runtime exist — the call and the resulting state would both be invented.",
  },
  {
    area: "active",
    label: "+ Create new strategy",
    reason: "No strategy types or parameter schemas exist to create from.",
  },
  {
    area: "backtest",
    label: "Run backtest",
    reason:
      "No backtest service exists, and no historical bars are ever produced — a result would have zero inputs.",
  },
  {
    area: "library",
    label: "+ Create new strategy",
    reason: "No strategy type library exists to choose from.",
  },
];

export function StrategiesPage() {
  const [area, setArea] = useState<StrategyArea>("active");
  const { accountId } = useStoreState(uiStore);
  const summary = summarizeCapabilities();
  const capabilities = capabilitiesByArea(area);
  const actions = DESIGN_ACTIONS.filter((action) => action.area === area);

  function goTo(view: "dashboard" | "orders" | "activity" | "positions") {
    uiStore.update((state) => ({ ...state, view }));
  }

  return (
    <div className="workspace">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Platform · {accountId}</p>
          <h1>Strategies</h1>
          <p className="page-subtitle">
            {summary.unavailable} of {summary.total} designed strategy capabilities are unavailable
            — this deployment runs no strategy service. Nothing on this page is simulated.
          </p>
        </div>
        <div className="title-actions">
          <span
            className="badge badge-warn"
            title="Verified against the repository: no strategy domain, route, schema, event or test exists in the backend"
          >
            CAPABILITY NOT PRESENT
          </span>
        </div>
      </section>

      <section className="stats-grid" aria-label="Strategy metrics">
        {DESIGN_METRICS.map((metric) => (
          <article className="stat-card" key={metric.label}>
            <div className="stat-head">
              <span>{metric.label}</span>
            </div>
            {/* "—" is the honest value: never 0, never a design placeholder. */}
            <h2 className="stat-value">—</h2>
            <p className="stat-sub">Not reported by the API. {metric.blocker}</p>
            <p className="stat-sub strategy-design-note">Design shows: {metric.design}</p>
          </article>
        ))}
      </section>

      <Panel
        title="Strategy management"
        subtitle="Capability state per prototype tab — what exists, what does not, and what the backend needs"
        actions={
          <SegmentedControl<StrategyArea>
            aria-label="Strategy capability areas"
            name="strategy-area"
            options={STRATEGY_AREAS}
            value={area}
            onChange={setArea}
          />
        }
      >
        <div className="strategy-capability-list">
          {capabilities.map((capability) => (
            <StrategyCapabilityCard key={capability.id} capability={capability} />
          ))}
        </div>

        {actions.length > 0 ? (
          <div className="title-actions strategy-actions">
            {actions.map((action, index) => {
              const reasonId = `strategy-action-reason-${action.area}-${index}`;
              return (
                // Disabled, not hidden: the control is advertised as unavailable
                // rather than silently missing. No handler is attached, and the
                // reason is LINKED (not hover-only) so keyboard and screen-reader
                // users receive it too.
                <button
                  key={`${action.area}-${action.label}`}
                  type="button"
                  className="btn btn-secondary"
                  disabled
                  aria-disabled="true"
                  aria-describedby={reasonId}
                  title={action.reason}
                >
                  {action.label}
                </button>
              );
            })}
            <p className="state-detail">
              These controls are disabled because the backend operations they would call do not
              exist:
            </p>
            <ul className="strategy-action-reasons">
              {actions.map((action, index) => (
                <li
                  key={`${action.area}-${action.label}-reason`}
                  id={`strategy-action-reason-${action.area}-${index}`}
                >
                  <b>{action.label}</b> — {action.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <StrategyRecordsTable />

      <Panel
        title="What this platform does today"
        subtitle="Real, risk-gated capabilities — the closest available workflows to strategy management"
      >
        <div className="strategy-links">
          <button type="button" className="btn btn-secondary" onClick={() => goTo("dashboard")}>
            Trade screen — manual, risk-gated order entry
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => goTo("orders")}>
            Orders — blotter, cancel and modify
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => goTo("activity")}>
            Activity — order history and live fills
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => goTo("positions")}>
            Positions — exposure and unrealized P&amp;L
          </button>
        </div>
        <ul className="markets-notes-list">
          <li>
            <b>Any future strategy must submit through the same gate</b> — every order is evaluated
            by the 8 pre-trade risk rules and the per-account kill switch before it reaches a
            broker. There is, and must remain, no path that bypasses it.
          </li>
          <li>
            <b>Automation is not implied by this screen.</b> Nothing here schedules, evaluates or
            executes anything; the terminal's automation surface is deliberately empty until a
            strategy service exists.
          </li>
        </ul>
      </Panel>

      <div className="strategy-gap-grid">
        <Panel
          title="Why this is not a UI-only gap"
          subtitle="Structural reasons the feature is absent, not merely unwired"
        >
          <ul className="markets-notes-list">
            {STRATEGY_SYSTEM_GAPS.map((gap) => (
              <li key={gap.title}>
                <b>{gap.title}</b> — {gap.detail}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Already built and reusable"
          subtitle="A future strategy service wires into these — it must not duplicate them"
        >
          <ul className="markets-notes-list">
            {STRATEGY_REUSABLE_FOUNDATIONS.map((item) => (
              <li key={item.title}>
                <b>{item.title}</b> — {item.detail}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Scope of this milestone"
        subtitle="FE-M7 implements what the backend supports, and documents the rest"
      >
        <ul className="markets-notes-list">
          <li>
            <b>Implemented</b> — this screen: an explicit capability registry ({summary.total}{" "}
            capabilities, {summary.available} available), per-capability backend requirements, an
            honest absent-state strategy table, and navigation to the workflows that do exist. No
            strategy data is fetched, stored, derived or displayed as if real.
          </li>
          <li>
            <b>Deliberately not implemented</b> — strategy list rows, configuration forms, lifecycle
            controls, backtests, per-strategy P&amp;L, deployment records, and any "create strategy"
            flow. Each would require fabricating data or a success response.
          </li>
          <li>
            <b>No network activity</b> — this page issues no REST request and subscribes to no
            additional WebSocket topic; it renders from the verified capability registry only.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
