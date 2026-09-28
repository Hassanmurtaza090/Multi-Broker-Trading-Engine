import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { envelope, MockWebSocket, mockSocketFactory, orderJ } from "../test/mocks";
import { TerminalSocket } from "./ws";

function makeSocket(overrides: Partial<ConstructorParameters<typeof TerminalSocket>[0]> = {}) {
  const events: unknown[] = [];
  const states: string[] = [];
  let fatal: string | null = null;
  let resyncCount = 0;
  const socket = new TerminalSocket({
    url: "ws://test/ws?topics=all",
    factory: mockSocketFactory,
    onEvent: (e) => events.push(e),
    onStateChange: (s) => states.push(s),
    onResync: () => {
      resyncCount += 1;
    },
    onFatal: (reason) => {
      fatal = reason;
    },
    baseDelayMs: 100,
    maxDelayMs: 1000,
    pingIntervalMs: 60_000,
    ...overrides,
  });
  return {
    socket,
    events,
    states,
    get fatal() {
      return fatal;
    },
    get resyncCount() {
      return resyncCount;
    },
  };
}

describe("TerminalSocket", () => {
  beforeEach(() => {
    MockWebSocket.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects, reports CONNECTED, and triggers a resync", () => {
    const ctx = makeSocket();
    ctx.socket.connect();
    MockWebSocket.latest().open();
    expect(ctx.socket.getState()).toBe("CONNECTED");
    expect(ctx.resyncCount).toBe(1);
    expect(ctx.states).toContain("CONNECTING");
    expect(ctx.states).toContain("CONNECTED");
  });

  it("dispatches event envelopes and ignores control frames", () => {
    const ctx = makeSocket();
    ctx.socket.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive({ control: "hello", client_id: "c1", topics: ["all"] });
    ws.receive({ control: "pong" });
    ws.receive(envelope("order.submitted", { order: orderJ() }));
    expect(ctx.events).toHaveLength(1);
    expect((ctx.events[0] as { event_type: string }).event_type).toBe("order.submitted");
  });

  it("dedupes at-least-once redelivery by event_id", () => {
    const ctx = makeSocket();
    ctx.socket.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    const evt = envelope("order.accepted", { order: orderJ() }, "evt-dup-1");
    ws.receive(evt);
    ws.receive(evt);
    ws.receive(JSON.stringify(evt));
    expect(ctx.events).toHaveLength(1);
  });

  it("ignores malformed frames without crashing", () => {
    const ctx = makeSocket();
    ctx.socket.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive("not json {");
    ws.receive({ nope: true });
    ws.receive("null");
    expect(ctx.events).toHaveLength(0);
    expect(ctx.socket.getState()).toBe("CONNECTED");
  });

  it("reconnects with backoff after an unexpected close and resyncs on each connect", () => {
    const ctx = makeSocket();
    ctx.socket.connect();
    MockWebSocket.latest().open();
    MockWebSocket.latest().serverClose(1006, "abnormal");
    expect(ctx.socket.getState()).toBe("RECONNECTING");
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(100); // attempt 1: 100ms delay
    expect(MockWebSocket.instances).toHaveLength(2);
    // No successful open → the next failure lengthens the backoff.
    MockWebSocket.latest().serverClose(1006);
    vi.advanceTimersByTime(100); // attempt 2 needs 200ms
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(MockWebSocket.instances).toHaveLength(3);
    MockWebSocket.latest().open();
    expect(ctx.resyncCount).toBe(2); // every successful (re)connect resyncs
  });

  it("treats a 1013 slow-consumer close as reconnectable", () => {
    const ctx = makeSocket();
    ctx.socket.connect();
    MockWebSocket.latest().open();
    MockWebSocket.latest().serverClose(1013, "slow consumer");
    expect(ctx.socket.getState()).toBe("RECONNECTING");
  });

  it("treats 4400 (invalid topics) as fatal — no reconnect", () => {
    const ctx = makeSocket();
    ctx.socket.connect();
    MockWebSocket.latest().serverClose(4400, "unknown topics");
    expect(ctx.socket.getState()).toBe("DISCONNECTED");
    expect(ctx.fatal).toBe("unknown topics");
    vi.advanceTimersByTime(10_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("close() is final — no reconnect is scheduled", () => {
    const ctx = makeSocket();
    ctx.socket.connect();
    MockWebSocket.latest().open();
    ctx.socket.close();
    vi.advanceTimersByTime(30_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(ctx.socket.getState()).toBe("DISCONNECTED");
  });

  it("honours a bounded retry budget when maxAttempts > 0", () => {
    const ctx = makeSocket({ maxAttempts: 2 });
    ctx.socket.connect();
    MockWebSocket.latest().serverClose(1006);
    vi.advanceTimersByTime(100);
    MockWebSocket.latest().serverClose(1006);
    vi.advanceTimersByTime(200);
    MockWebSocket.latest().serverClose(1006);
    vi.advanceTimersByTime(10_000);
    expect(ctx.socket.getState()).toBe("DISCONNECTED");
    expect(MockWebSocket.instances).toHaveLength(3); // 1 initial + 2 retries
  });

  it("sends keepalive pings while connected", () => {
    const ctx = makeSocket({ pingIntervalMs: 1000 });
    ctx.socket.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    vi.advanceTimersByTime(2500);
    expect(ws.sent.filter((m) => m === "ping").length).toBeGreaterThanOrEqual(2);
  });
});
