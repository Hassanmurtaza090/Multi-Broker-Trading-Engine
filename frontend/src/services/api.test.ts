import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorBody, orderOut, quoteOut } from "../test/mocks";
import { ApiClient, ApiError, isApiError } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, orderOut())));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET /orders hits the M10 route and returns typed data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [orderOut()]));
    const api = new ApiClient();
    const result = await api.listOrders("ACC-001");
    expect(result[0].client_order_id).toBe(orderOut().client_order_id);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/v1/orders");
    expect(String(url)).toContain("account_id=ACC-001");
  });

  it("POST /orders sends exact-decimal string body", async () => {
    const api = new ApiClient();
    await api.createOrder({
      account_id: "ACC-001",
      instrument: { symbol: "AAPL", asset_class: "EQUITY", currency: "USD" },
      side: "BUY",
      order_type: "LIMIT",
      quantity: "10.00000001", // exact decimal — must pass through verbatim
      limit_price: "150.25",
      idempotency_key: "key-1",
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/v1/orders");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.quantity).toBe("10.00000001");
    expect(body.limit_price).toBe("150.25");
  });

  it("maps domain errors to typed ApiError with stable codes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(404, errorBody("ORDER_NOT_FOUND", "unknown order")),
    );
    const api = new ApiClient();
    const error = await api
      .cancelOrder("00000000-0000-4000-8000-000000000000")
      .catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).kind).toBe("not_found");
    expect((error as ApiError).code).toBe("ORDER_NOT_FOUND");
    expect((error as ApiError).status).toBe(404);
  });

  it("maps 422 risk rejections with violations attached", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(422, {
        approved: false,
        violations: [
          { rule: "kill_switch", reason: "kill switch active", data_unavailable: false },
        ],
        error: { code: "RISK_REJECTED", message: "order rejected by risk" },
      }),
    );
    const api = new ApiClient();
    const error = await api
      .createOrder({
        account_id: "ACC-001",
        instrument: { symbol: "AAPL", asset_class: "EQUITY", currency: "USD" },
        side: "BUY",
        order_type: "MARKET",
        quantity: "10",
      })
      .catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).kind).toBe("risk");
    expect((error as ApiError).violations[0].rule).toBe("kill_switch");
  });

  it("classifies timeout (504) and connection-lost (503) distinctly", async () => {
    const api = new ApiClient();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(504, errorBody("TIMEOUT", "timed out")));
    let error = await api.cancelOrder("x").catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe("timeout");

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(503, errorBody("CONNECTION_LOST", "down")));
    error = await api.cancelOrder("x").catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe("connection_lost");
  });

  it("maps fetch failure to a network error (never throws raw)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("fetch failed"));
    const api = new ApiClient();
    const error = await api.listBrokers().catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).kind).toBe("network");
    expect((error as ApiError).userMessage).toContain("Cannot reach");
  });

  it("survives non-JSON error bodies (proxy HTML etc.)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("<html>bad gateway</html>", { status: 502 }),
    );
    const api = new ApiClient();
    const error = await api.listBrokers().catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).kind).toBe("broker_error");
    expect((error as ApiError).message).toBe("request failed with status 502");
  });

  it("quote query passes instrument identity parameters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, quoteOut()));
    const api = new ApiClient();
    await api.getQuote({
      symbol: "AAPL",
      asset_class: "EQUITY",
      currency: "USD",
      exchange: "NASDAQ",
    });
    const [url] = vi.mocked(fetch).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/api/v1/market/quote");
    expect(parsed.searchParams.get("symbol")).toBe("AAPL");
    expect(parsed.searchParams.get("exchange")).toBe("NASDAQ");
  });

  it("kill-switch toggle POSTs the active flag", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { account_id: "ACC-001", active: true }),
    );
    const api = new ApiClient();
    const result = await api.setKillSwitch("ACC-001", true);
    expect(result.active).toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/v1/accounts/ACC-001/risk/kill-switch");
    expect(JSON.parse(String(init?.body))).toEqual({ active: true });
  });
});
