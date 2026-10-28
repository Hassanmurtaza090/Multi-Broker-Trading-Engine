/**
 * Executions store unit tests (M5).
 *
 * The store is the only place fills exist on the client (the backend persists
 * none), so its guarantees are asserted directly: idempotent capture by
 * fill_id, newest-first ordering, bounded memory, and per-order lookup.
 */

import { describe, expect, it } from "vitest";

import { fillJ } from "../test/mocks";
import {
  createExecutionsStore,
  fillsForOrder,
  MAX_CAPTURED_EXECUTIONS,
  recordFill,
} from "./executionsStore";

describe("executionsStore", () => {
  it("captures a fill and records the capture start", () => {
    const store = createExecutionsStore();
    const next = recordFill(store.getSnapshot(), fillJ({ fill_id: "f1" }));
    expect(next.ids).toEqual(["f1"]);
    expect(next.hasCapture).toBe(true);
    expect(next.capturedFrom).toBe("2026-09-27T10:00:02+00:00");
  });

  it("is idempotent by fill_id — at-least-once delivery cannot duplicate a row", () => {
    const store = createExecutionsStore();
    const fill = fillJ({ fill_id: "f1" });
    const once = recordFill(store.getSnapshot(), fill);
    const twice = recordFill(once, fill);
    expect(twice).toBe(once); // no-op state, not a re-inserted row
    expect(twice.ids).toEqual(["f1"]);
  });

  it("keeps newest-first ordering by executed_at regardless of arrival order", () => {
    const store = createExecutionsStore();
    let state = store.getSnapshot();
    state = recordFill(
      state,
      fillJ({ fill_id: "older", executed_at: "2026-09-27T10:00:01+00:00" }),
    );
    state = recordFill(
      state,
      fillJ({ fill_id: "newest", executed_at: "2026-09-27T10:05:00+00:00" }),
    );
    state = recordFill(
      state,
      fillJ({ fill_id: "middle", executed_at: "2026-09-27T10:02:00+00:00" }),
    );
    expect(state.ids).toEqual(["newest", "middle", "older"]);
  });

  it("preserves multiple fills for one order as distinct records", () => {
    const store = createExecutionsStore();
    let state = store.getSnapshot();
    state = recordFill(
      state,
      fillJ({ fill_id: "f1", order_client_id: "order-1", quantity: { value: "4" } }),
    );
    state = recordFill(
      state,
      fillJ({
        fill_id: "f2",
        order_client_id: "order-1",
        quantity: { value: "6" },
        executed_at: "2026-09-27T10:00:05+00:00",
      }),
    );
    expect(state.ids).toHaveLength(2);
    expect(fillsForOrder(state, "order-1").map((f) => f.fill_id)).toEqual(["f2", "f1"]);
    expect(fillsForOrder(state, "order-2")).toEqual([]);
  });

  it("bounds memory at MAX_CAPTURED_EXECUTIONS, dropping the oldest fills", () => {
    const store = createExecutionsStore();
    let state = store.getSnapshot();
    for (let i = 0; i < MAX_CAPTURED_EXECUTIONS + 5; i += 1) {
      // Ascending timestamps so the oldest are at the front of the trim.
      const seconds = String(i % 60).padStart(2, "0");
      state = recordFill(
        state,
        fillJ({
          fill_id: `f${i}`,
          executed_at: `2026-09-27T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${seconds}+00:00`,
        }),
      );
    }
    expect(state.ids).toHaveLength(MAX_CAPTURED_EXECUTIONS);
    expect(state.byId["f0"]).toBeUndefined(); // oldest evicted
    expect(state.byId[`f${MAX_CAPTURED_EXECUTIONS + 4}`]).toBeDefined();
  });
});
