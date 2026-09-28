/**
 * Broker connectivity panel (M11) — renders every broker the runtime reports.
 */

import { Panel } from "../../components/Panel";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { StatusBadge } from "../../components/StatusBadge";
import { brokersStore } from "../../stores";
import { useStoreState } from "../../stores/store";

export function BrokerStatusPanel() {
  const { brokers, loadState, errorMessage } = useStoreState(brokersStore);

  return (
    <Panel title="Brokers">
      {loadState === "idle" || (loadState === "loading" && brokers.length === 0) ? (
        <LoadingState label="Contacting gateway…" />
      ) : loadState === "error" ? (
        <ErrorState message={errorMessage ?? "Could not load broker status."} />
      ) : brokers.length === 0 ? (
        <EmptyState message="No brokers configured." />
      ) : (
        <ul className="broker-list">
          {brokers.map((broker) => (
            <li key={broker.name} className="broker-item">
              <span className="broker-name">{broker.name}</span>
              <StatusBadge
                tone={broker.connected ? "ok" : "danger"}
                label={broker.connected ? "Connected" : "Disconnected"}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
