/**
 * Connection banner (M11): a persistent, unmissable indicator whenever the
 * real-time stream is not live. While disconnected/reconnecting the terminal
 * must visually flag that data may be stale (NFR-001 / ADR-016 recovery).
 */

import { connectionStore } from "../../stores";
import { useStoreState } from "../../stores/store";

export function ConnectionBanner() {
  const { state, attempt, fatalReason } = useStoreState(connectionStore);

  if (state === "CONNECTED") return null;

  const message =
    fatalReason !== null
      ? `Real-time stream rejected by server: ${fatalReason}`
      : state === "DISCONNECTED"
        ? "Real-time stream disconnected. Data shown may be stale."
        : state === "CONNECTING"
          ? "Connecting to the real-time stream…"
          : `Real-time connection lost — reconnecting (attempt ${attempt})… data may be stale.`;

  const tone = fatalReason !== null || state === "DISCONNECTED" ? "danger" : "warn";

  return (
    <div className={`connection-banner connection-${tone}`} role="alert">
      {message}
    </div>
  );
}
