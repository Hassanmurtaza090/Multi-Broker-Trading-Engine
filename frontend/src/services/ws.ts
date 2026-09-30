/**
 * WebSocket client (M11) for the M10 event stream (`/ws`, ADR-016).
 *
 * Implements the documented sync contract:
 * - At-least-once delivery: every event envelope carries `event_id`; this
 *   client dedupes with a bounded LRU set before dispatching.
 * - Reconnect: unexpected closes retry with capped exponential backoff. Every
 *   successful (re)connect triggers `onResync` so stores can reconcile from
 *   REST (the authoritative read models) — the documented client recovery.
 * - Backpressure close (server code 1013) and invalid-topic close (4400) are
 *   handled distinctly: 1013 reconnects + resyncs; 4400 is a client bug and
 *   surfaces as fatal.
 * - Keepalive: periodic "ping" (the hub answers `{"control":"pong"}`).
 */

import type { ControlMessage, EventEnvelopeJ } from "../types/events";

export type ConnectionState = "CONNECTING" | "CONNECTED" | "RECONNECTING" | "DISCONNECTED";

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const defaultFactory: WebSocketFactory = (url) => new WebSocket(url) as WebSocketLike;

/** WebSocket.OPEN without depending on the WebSocket global in tests/jsdom. */
const READY_STATE_OPEN = 1;

export interface TerminalSocketOptions {
  /** Fixed URL, or a provider resolved fresh before EVERY connection (used
   *  for single-use WS tickets — each attempt needs a new ticket, M12). */
  url: string | (() => string | Promise<string>);
  onEvent: (envelope: EventEnvelopeJ) => void;
  onStateChange?: (state: ConnectionState) => void;
  /** Called once per successful connection (initial + every reconnect). */
  onResync?: () => void;
  /** Called when the server rejects the connection (e.g. code 4400). */
  onFatal?: (reason: string) => void;
  factory?: WebSocketFactory;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 0 = retry forever. */
  maxAttempts?: number;
  dedupeCapacity?: number;
  pingIntervalMs?: number;
}

export class TerminalSocket {
  private socket: WebSocketLike | null = null;
  private state: ConnectionState = "DISCONNECTED";
  private attempts = 0;
  private stoppedByUser = true;
  private opening = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private readonly dedupeCapacity: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;
  private readonly pingIntervalMs: number;

  constructor(private readonly options: TerminalSocketOptions) {
    this.dedupeCapacity = options.dedupeCapacity ?? 5000;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 15_000;
    this.maxAttempts = options.maxAttempts ?? 0;
    this.pingIntervalMs = options.pingIntervalMs ?? 15_000;
  }

  getState(): ConnectionState {
    return this.state;
  }

  /** Open the connection (idempotent). Resets the retry budget. */
  connect(): void {
    this.stoppedByUser = false;
    this.attempts = 0;
    this.clearReconnectTimer();
    if (this.socket !== null || this.opening) return; // connecting/connected
    void this.open();
  }

  /** Permanently close: no reconnect will be scheduled. */
  close(): void {
    this.stoppedByUser = true;
    this.clearReconnectTimer();
    this.clearPingTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(1000, "client closing");
      } catch {
        // best effort
      }
    }
    this.setState("DISCONNECTED");
  }

  private async open(): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    const factory = this.options.factory ?? defaultFactory;
    let socket: WebSocketLike;
    try {
      // Fresh URL per attempt: single-use WS tickets (M12) must never be
      // replayed across reconnects.
      const url =
        typeof this.options.url === "function"
          ? await this.options.url()
          : this.options.url;
      socket = factory(url);
    } catch {
      this.opening = false;
      this.scheduleReconnect(); // ticket fetch failed (e.g. expired session)
      return;
    }
    this.opening = false;
    this.socket = socket;
    this.setState(this.attempts === 0 ? "CONNECTING" : "RECONNECTING");

    socket.onopen = () => {
      this.attempts = 0;
      this.setState("CONNECTED");
      this.startPingTimer();
      // (Re)connected: reconcile from the authoritative REST read models —
      // the documented at-least-once recovery path (ADR-016).
      this.options.onResync?.();
    };
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onclose = (event) => {
      this.socket = null;
      this.clearPingTimer();
      if (this.stoppedByUser) {
        this.setState("DISCONNECTED");
        return;
      }
      if (event.code === 4400) {
        // Server rejected the connection (e.g. unknown topics) — client bug.
        this.setState("DISCONNECTED");
        this.options.onFatal?.(event.reason ?? "connection rejected");
        return;
      }
      // Any other close (incl. 1013 slow-consumer backpressure): reconnect;
      // the resync after reconnection restores authoritative state.
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // The subsequent onclose drives the reconnect; nothing to do here.
    };
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // malformed frame — ignore, never crash the terminal
    }
    if (parsed === null || typeof parsed !== "object") return;
    const record = parsed as Record<string, unknown>;
    if (typeof record.control === "string") {
      // hello / pong control frames — connection bookkeeping, not events.
      void (record as unknown as ControlMessage);
      return;
    }
    if (typeof record.event_id !== "string" || typeof record.event_type !== "string") {
      return; // not an envelope we understand
    }
    if (this.isDuplicate(record.event_id)) return;
    this.options.onEvent(record as unknown as EventEnvelopeJ);
  }

  private isDuplicate(eventId: string): boolean {
    if (this.seen.has(eventId)) return true;
    this.seen.add(eventId);
    this.seenOrder.push(eventId);
    while (this.seenOrder.length > this.dedupeCapacity) {
      const oldest = this.seenOrder.shift();
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return false;
  }

  private scheduleReconnect(): void {
    if (this.stoppedByUser) {
      this.setState("DISCONNECTED");
      return;
    }
    if (this.maxAttempts > 0 && this.attempts >= this.maxAttempts) {
      this.setState("DISCONNECTED");
      return;
    }
    this.attempts += 1;
    const delay = Math.min(this.baseDelayMs * 2 ** (this.attempts - 1), this.maxDelayMs);
    this.setState("RECONNECTING");
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stoppedByUser) void this.open();
    }, delay);
  }

  private startPingTimer(): void {
    this.clearPingTimer();
    this.pingTimer = setInterval(() => {
      const socket = this.socket;
      if (socket !== null && socket.readyState === READY_STATE_OPEN) {
        try {
          socket.send("ping");
        } catch {
          // A broken socket errors/closes itself; the close path reconnects.
        }
      }
    }, this.pingIntervalMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}
