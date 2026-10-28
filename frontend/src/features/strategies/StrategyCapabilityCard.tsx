/**
 * Capability cards for the Strategies screen (FE-M7).
 *
 * One card per capability the Figma prototype presents: what the design
 * shows, why this deployment cannot show it, and the exact backend work that
 * would make it real. Purely presentational — all facts come from
 * `capabilities.ts`, which is unit-tested.
 */

import { Panel } from "../../components/Panel";
import type { StrategyCapability } from "./capabilities";

export function StrategyCapabilityCard({ capability }: { capability: StrategyCapability }) {
  return (
    <article className="strategy-capability" data-testid={`strategy-capability-${capability.id}`}>
      <header className="strategy-capability-head">
        <h3>{capability.title}</h3>
        {/*
          A plain badge, not the shared StatusBadge: StatusBadge carries
          role="status" (a polite live region), and seven static "unavailable"
          badges would announce themselves as if they were changing state.
        */}
        <span
          className="badge badge-muted"
          title="No backend capability exists for this feature in the current engine"
        >
          Unavailable
        </span>
      </header>

      <p className="strategy-capability-design">
        <b>Design shows</b> — {capability.design}
      </p>
      <p className="strategy-capability-reason">
        <b>Why it is unavailable</b> — {capability.reason}
      </p>

      <p className="strategy-capability-requires-label">Backend work required</p>
      <ul className="strategy-capability-requires">
        {capability.requires.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

/** Records table with the prototype's columns and an honest absent state. */
export function StrategyRecordsTable() {
  return (
    <Panel
      title="Strategy records"
      subtitle="The prototype's strategy table — columns are shown so the missing capability is visible, not so an empty table can pass as data"
    >
      <div className="table-scroll">
        <table className="data-table strategies-table">
          <thead>
            <tr>
              <th scope="col">Strategy name</th>
              <th scope="col">Symbol</th>
              <th scope="col">Status</th>
              <th scope="col">Last run</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4}>
                <div className="state state-empty" role="note">
                  <p>No strategy records — this platform has no strategy service.</p>
                  <p className="state-detail">
                    The engine exposes zero strategy endpoints, so there is nothing to list and
                    nothing that could be created, started or stopped from here. This is not an
                    empty portfolio of strategies; it is an absent capability.
                  </p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
