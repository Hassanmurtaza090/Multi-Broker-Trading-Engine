/**
 * REST API client (M11) — typed surface over the M10 gateway.
 *
 * Contract (backend/api, ADR-016):
 * - Errors are `{ error: { code, message, detail? } }` with stable codes.
 * - Risk rejections are HTTP 422 with `{ approved: false, violations, error }`.
 * - 504 = broker timeout (outcome UNKNOWN — never resubmit blindly; the
 *   idempotency key makes a retry safe), 503 = broker connection lost.
 *
 * The client is transport-only: no business logic, no broker knowledge.
 */

import type {
  AccountSummaryOut,
  BalanceOut,
  BrokerStatusOut,
  HealthOut,
  KillSwitchOut,
  OrderCreateIn,
  OrderModifyIn,
  OrderOut,
  PositionOut,
  QuoteOut,
  RiskDecisionOut,
  RuleResultOut,
} from "../types/api";

export type ApiErrorKind =
  | "risk" // 422 risk-gate rejection (violations attached)
  | "validation" // 400/422 request or domain validation
  | "not_found" // 404
  | "conflict" // 409 (duplicate/state conflict)
  | "timeout" // 504 broker timeout — outcome unknown
  | "connection_lost" // 503 broker disconnected
  | "broker_error" // 502 other broker failure
  | "server" // 5xx unexpected
  | "network" // fetch itself failed (API unreachable)
  | "http"; // anything else

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | null;
  readonly violations: RuleResultOut[];
  readonly kind: ApiErrorKind;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    detail?: string | null;
    violations?: RuleResultOut[];
  }) {
    super(args.message);
    this.name = "ApiError";
    this.status = args.status;
    this.code = args.code;
    this.detail = args.detail ?? null;
    this.violations = args.violations ?? [];
    this.kind = ApiError.kindFor(args.status, args.violations);
  }

  private static kindFor(status: number, violations?: RuleResultOut[]): ApiErrorKind {
    if (status === 422 && violations && violations.length > 0) return "risk";
    if (status === 504) return "timeout";
    if (status === 503) return "connection_lost";
    if (status === 502) return "broker_error";
    if (status === 404) return "not_found";
    if (status === 409) return "conflict";
    if (status === 400 || status === 422) return "validation";
    if (status >= 500) return "server";
    if (status === 0) return "network";
    return "http";
  }

  /** Human-facing summary; never contains stack traces or internals. */
  get userMessage(): string {
    switch (this.kind) {
      case "risk":
        return "Rejected by risk controls";
      case "timeout":
        return "Broker timed out — the outcome is unknown. Check the order list before retrying (a safe retry reuses the same idempotency key).";
      case "connection_lost":
        return "Broker connection lost — try again after reconnection.";
      case "network":
        return "Cannot reach the trading API. Check the connection.";
      case "server":
        return "Unexpected server error.";
      default:
        return this.message;
    }
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function networkError(cause: unknown): ApiError {
  return new ApiError({
    status: 0,
    code: "NETWORK_ERROR",
    message: cause instanceof Error ? cause.message : "network request failed",
  });
}

export class ApiClient {
  constructor(private readonly baseUrl: string = "") {}

  private url(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(`${this.baseUrl}/api/v1${path}`, window.location.origin);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  /** Path parameters are untrusted (e.g. the account selector input). */
  private static seg(value: string): string {
    return encodeURIComponent(value);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url(path), {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw networkError(error);
    }
    if (response.ok) {
      return (await response.json()) as T;
    }
    throw await this.toApiError(response);
  }

  private async get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url(path, query));
    } catch (error) {
      throw networkError(error);
    }
    if (response.ok) {
      return (await response.json()) as T;
    }
    throw await this.toApiError(response);
  }

  private async toApiError(response: Response): Promise<ApiError> {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // Non-JSON error body (e.g. proxy HTML) — fall through to generic mapping.
    }
    const record =
      payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const errorRecord =
      record.error !== null && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : null;
    const violations = Array.isArray(record.violations)
      ? (record.violations as RuleResultOut[])
      : undefined;
    return new ApiError({
      status: response.status,
      code: typeof errorRecord?.code === "string" ? errorRecord.code : String(response.status),
      message:
        typeof errorRecord?.message === "string"
          ? errorRecord.message
          : `request failed with status ${response.status}`,
      detail: typeof errorRecord?.detail === "string" ? errorRecord.detail : null,
      violations,
    });
  }

  // --- endpoints (mirror of backend/api/rest.py) --------------------------------

  health(): Promise<HealthOut> {
    return this.get("/health");
  }

  listBrokers(): Promise<BrokerStatusOut[]> {
    return this.get("/brokers");
  }

  listOrders(accountId?: string): Promise<OrderOut[]> {
    return this.get("/orders", { account_id: accountId });
  }

  createOrder(body: OrderCreateIn): Promise<OrderOut> {
    return this.request("POST", "/orders", body);
  }

  cancelOrder(clientOrderId: string): Promise<OrderOut> {
    return this.request("POST", `/orders/${ApiClient.seg(clientOrderId)}/cancel`);
  }

  modifyOrder(clientOrderId: string, body: OrderModifyIn): Promise<OrderOut> {
    return this.request("POST", `/orders/${ApiClient.seg(clientOrderId)}/modify`, body);
  }

  listPositions(accountId: string): Promise<PositionOut[]> {
    return this.get(`/accounts/${ApiClient.seg(accountId)}/positions`);
  }

  getBalance(accountId: string): Promise<BalanceOut> {
    return this.get(`/accounts/${ApiClient.seg(accountId)}/balance`);
  }

  getAccountSummary(accountId: string): Promise<AccountSummaryOut> {
    return this.get(`/accounts/${ApiClient.seg(accountId)}/summary`);
  }

  getQuote(query: {
    symbol: string;
    asset_class: string;
    currency: string;
    exchange?: string;
  }): Promise<QuoteOut> {
    return this.get("/market/quote", {
      symbol: query.symbol,
      asset_class: query.asset_class,
      currency: query.currency,
      exchange: query.exchange,
    });
  }

  getKillSwitch(accountId: string): Promise<KillSwitchOut> {
    return this.get(`/accounts/${ApiClient.seg(accountId)}/risk/kill-switch`);
  }

  setKillSwitch(accountId: string, active: boolean): Promise<KillSwitchOut> {
    return this.request("POST", `/accounts/${ApiClient.seg(accountId)}/risk/kill-switch`, {
      active,
    });
  }

  evaluateRisk(accountId: string, body: OrderCreateIn): Promise<RiskDecisionOut> {
    return this.request("POST", `/accounts/${ApiClient.seg(accountId)}/risk/evaluate`, body);
  }
}
