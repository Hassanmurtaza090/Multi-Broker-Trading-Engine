/**
 * Shared test infrastructure (M11/M12): MockWebSocket, fixtures, test users,
 * login helper, mock API builder.
 */

import { vi } from "vitest";

import type { ApiClient } from "../services/api";
import { authService } from "../services/auth";
import type { WebSocketLike } from "../services/ws";
import type {
  BalanceOut,
  ErrorResponseOut,
  OrderOut,
  PositionOut,
  QuoteOut,
  TokenPairOut,
  UserOut,
} from "../types/api";
import type {
  EventEnvelopeJ,
  FillJ,
  InstrumentJ,
  OrderJ,
  PositionJ,
  QuoteJ,
} from "../types/events";

// --- test users (M12 fixtures) ------------------------------------------------------

const TRADER_PERMISSIONS = [
  "orders:read",
  "orders:write",
  "positions:read",
  "account:read",
  "market:read",
  "risk:read",
  "brokers:read",
];
const VIEWER_PERMISSIONS = TRADER_PERMISSIONS.filter((p) => p !== "orders:write");
const ADMIN_PERMISSIONS = [...TRADER_PERMISSIONS, "risk:admin"];

export const TEST_TRADER: UserOut = {
  subject: "trader",
  roles: ["trader"],
  accounts: ["ACC-001"],
  permissions: TRADER_PERMISSIONS,
};
export const TEST_VIEWER: UserOut = {
  subject: "viewer",
  roles: ["viewer"],
  accounts: ["ACC-001"],
  permissions: VIEWER_PERMISSIONS,
};
export const TEST_ADMIN: UserOut = {
  subject: "admin",
  roles: ["admin"],
  accounts: ["*"],
  permissions: ADMIN_PERMISSIONS,
};

export function tokenPairFor(user: UserOut): TokenPairOut {
  return {
    access_token: `test-access-${user.subject}`,
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: `rt_test-refresh-${user.subject}`,
    refresh_expires_in: 604800,
    user,
  };
}

/** Log a user in through the REAL authService by stubbing the login fetch —
 *  exercises the actual session-management path (store sync, token state). */
export async function loginForTests(user: UserOut = TEST_TRADER): Promise<void> {
  const pair = tokenPairFor(user);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/v1/auth/login")) {
        return Promise.resolve(
          new Response(JSON.stringify(pair), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }),
  );
  await authService.login({ username: user.subject, password: "test-password" });
}

// --- MockWebSocket --------------------------------------------------------------

export class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = [];

  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  readonly sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }

  static latest(): MockWebSocket {
    const latest = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!latest) throw new Error("no MockWebSocket instance created");
    return latest;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(data: unknown): void {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }

  serverClose(code = 1006, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

export function mockSocketFactory(url: string): WebSocketLike {
  return new MockWebSocket(url);
}

// --- fixtures --------------------------------------------------------------------

export function instrumentJ(overrides: Partial<InstrumentJ> = {}): InstrumentJ {
  return {
    symbol: "AAPL",
    asset_class: "EQUITY",
    currency: { code: "USD" },
    instrument_type: null,
    exchange: "NASDAQ",
    description: null,
    identifiers: {},
    ...overrides,
  };
}

export function orderJ(overrides: Partial<OrderJ> = {}): OrderJ {
  return {
    client_order_id: "11111111-1111-4111-8111-111111111111",
    account_id: "ACC-001",
    instrument: instrumentJ(),
    side: "BUY",
    order_type: "LIMIT",
    quantity: { value: "10" },
    status: "SUBMITTED",
    time_in_force: "DAY",
    limit_price: { value: "150.25", currency: { code: "USD" } },
    stop_price: null,
    broker_order_id: "1001",
    rejection_reason: null,
    filled_quantity: { value: "0" },
    created_at: "2026-09-27T10:00:00+00:00",
    updated_at: "2026-09-27T10:00:01+00:00",
    ...overrides,
  };
}

export function orderOut(overrides: Partial<OrderOut> = {}): OrderOut {
  return {
    client_order_id: "11111111-1111-4111-8111-111111111111",
    account_id: "ACC-001",
    symbol: "AAPL",
    exchange: "NASDAQ",
    currency: "USD",
    side: "BUY",
    order_type: "LIMIT",
    status: "SUBMITTED",
    quantity: "10",
    filled_quantity: "0",
    remaining_quantity: "10",
    limit_price: "150.25",
    stop_price: null,
    time_in_force: "DAY",
    broker_order_id: "1001",
    rejection_reason: null,
    created_at: "2026-09-27T10:00:00+00:00",
    updated_at: "2026-09-27T10:00:01+00:00",
    ...overrides,
  };
}

/** One execution fill as serialized in `order.filled` / `order.partially_filled`. */
export function fillJ(overrides: Partial<FillJ> = {}): FillJ {
  return {
    fill_id: "fill-0001",
    order_client_id: "11111111-1111-4111-8111-111111111111",
    broker_order_id: "1001",
    account_id: "ACC-001",
    instrument: instrumentJ(),
    side: "BUY",
    quantity: { value: "10" },
    price: { value: "150.25", currency: { code: "USD" } },
    commission: null,
    fees: null,
    executed_at: "2026-09-27T10:00:02+00:00",
    ...overrides,
  };
}

export function positionJ(overrides: Partial<PositionJ> = {}): PositionJ {
  return {
    account_id: "ACC-001",
    instrument: instrumentJ(),
    quantity: { value: "10" },
    average_price: { value: "150.25", currency: { code: "USD" } },
    realized_pnl: null,
    unrealized_pnl: { amount: "0.00", currency: { code: "USD" } },
    updated_at: "2026-09-27T10:00:01+00:00",
    ...overrides,
  };
}

export function positionOut(overrides: Partial<PositionOut> = {}): PositionOut {
  return {
    account_id: "ACC-001",
    symbol: "AAPL",
    exchange: "NASDAQ",
    currency: "USD",
    quantity: "10",
    average_price: "150.25",
    realized_pnl: null,
    unrealized_pnl: "0.00",
    market_price: "151.00",
    stale: false,
    ...overrides,
  };
}

export function quoteOut(overrides: Partial<QuoteOut> = {}): QuoteOut {
  return {
    symbol: "AAPL",
    exchange: "NASDAQ",
    currency: "USD",
    bid: "150.00",
    ask: "150.50",
    last: "150.25",
    mid: "150.25",
    timestamp: "2026-09-27T10:00:00+00:00",
    stale: false,
    ...overrides,
  };
}

export function quoteJ(overrides: Partial<QuoteJ> = {}): QuoteJ {
  return {
    instrument: instrumentJ(),
    bid: { value: "150.00", currency: { code: "USD" } },
    ask: { value: "150.50", currency: { code: "USD" } },
    last: { value: "150.25", currency: { code: "USD" } },
    bid_size: null,
    ask_size: null,
    timestamp: "2026-09-27T10:00:00+00:00",
    ...overrides,
  };
}

export function balanceOut(): BalanceOut {
  return {
    account_id: "ACC-001",
    cash: [
      { currency: "USD", total: "100000.00", available: "99000.00", buying_power: "200000.00" },
    ],
  };
}

export function envelope(
  eventType: string,
  payload: EventEnvelopeJ["payload"],
  eventId = `evt-${eventType}-1`,
): EventEnvelopeJ {
  return {
    event_id: eventId,
    event_type: eventType,
    event_version: 1,
    timestamp: "2026-09-27T10:00:02+00:00",
    source: "test",
    payload,
  };
}

export function errorBody(code: string, message: string): ErrorResponseOut {
  return { error: { code, message, detail: null } };
}

// --- mock ApiClient ---------------------------------------------------------------

export type ApiMock = {
  [K in keyof ApiClient]: ReturnType<typeof vi.fn>;
};

export function createMockApi(): ApiMock {
  return {
    health: vi.fn().mockResolvedValue({ status: "ok", broker: "IBKR", broker_connected: true }),
    listBrokers: vi.fn().mockResolvedValue([{ name: "IBKR", connected: true }]),
    listOrders: vi.fn().mockResolvedValue([]),
    getOrder: vi.fn(),
    createOrder: vi.fn(),
    cancelOrder: vi.fn(),
    modifyOrder: vi.fn(),
    listPositions: vi.fn().mockResolvedValue([]),
    getBalance: vi.fn().mockResolvedValue(balanceOut()),
    getAccountSummary: vi.fn().mockResolvedValue({
      account_id: "ACC-001",
      equity: "100000.00",
      exposure: "0.00",
      realized_pnl: {},
      unrealized_pnl: {},
      market_value: {},
    }),
    getQuote: vi.fn(),
    getKillSwitch: vi.fn().mockResolvedValue({ account_id: "ACC-001", active: false }),
    setKillSwitch: vi.fn(),
    evaluateRisk: vi.fn(),
    // --- M12 auth surface ----------------------------------------------------------
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    logoutWith: vi.fn().mockResolvedValue(undefined),
    me: vi.fn(),
    createWsTicket: vi.fn().mockResolvedValue({ ticket: "wst-mock-ticket", expires_in: 30 }),
  };
}
