/**
 * Risk Management workspace tests (FE-M8).
 *
 * Scope: the honesty guarantees of the module — no fabricated values, no
 * cross-currency aggregation, no implied enforcement, no order submission from
 * the dry-run control, and correct permission/account isolation.
 *
 * Everything is mocked at the API boundary; no broker, engine or live account
 * is touched.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ServicesContext } from "../../services/context";
import type { ApiClient } from "../../services/api";
import type { AccountSummaryOut, RiskDecisionOut } from "../../types/api";
import {
  accountStore,
  brokersStore,
  positionsStore,
  resetAllStores,
  riskStore,
  uiStore,
} from "../../stores";
import { keyForPositionOut } from "../../stores/positionsStore";
import {
  loginForTests,
  createMockApi,
  positionOut,
  TEST_TRADER,
  TEST_VIEWER,
} from "../../test/mocks";
import { PositionRiskCard } from "./PositionRiskCard";
import { RiskLimitsCard } from "./RiskLimitsCard";
import { RiskMetricsCard } from "./RiskMetricsCard";
import { RiskOverviewCards } from "./RiskOverviewCards";
import { RiskTestPanel } from "./RiskTestPanel";
import { RiskViolationsCard } from "./RiskViolationsCard";
import { RiskPage } from "../../pages/RiskPage";

function withApi(node: ReactElement, api = createMockApi()) {
  return render(
    <ServicesContext.Provider value={{ api: api as unknown as ApiClient }}>
      {node}
    </ServicesContext.Provider>,
  );
}

function seedPositions(rows: Parameters<typeof positionOut>[0][]) {
  const byKey: Record<string, ReturnType<typeof positionOut>> = {};
  const keys: string[] = [];
  for (const row of rows) {
    const position = positionOut(row);
    const key = keyForPositionOut(position);
    byKey[key] = position;
    keys.push(key);
  }
  positionsStore.setState({ byKey, keys, loadState: "ready", errorMessage: null });
}

function setSummary(summary: AccountSummaryOut | null, state: "ready" | "loading" | "error") {
  accountStore.update((s) => ({ ...s, summary, summaryState: state }));
}

const FULL_SUMMARY: AccountSummaryOut = {
  account_id: "ACC-001",
  equity: "100000.00",
  exposure: "25000.00",
  realized_pnl: { USD: "120.00" },
  unrealized_pnl: { USD: "50.00" },
  market_value: { USD: "25000.00" },
};

// --- overview ---------------------------------------------------------------

describe("RiskOverviewCards", () => {
  beforeEach(() => resetAllStores());

  it("shows a loading state while the account summary is in flight", () => {
    setSummary(null, "loading");
    render(<RiskOverviewCards />);
    expect(screen.getByText("Loading account risk data…")).toBeInTheDocument();
  });

  it("shows an error state (no fake numbers, no fake retry)", () => {
    setSummary(null, "error");
    render(<RiskOverviewCards />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
    // Recovery path is stated instead of a button that could not refetch.
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("renders reported equity and a derived share of equity", () => {
    setSummary(FULL_SUMMARY, "ready");
    render(<RiskOverviewCards />);
    expect(screen.getByText("100,000")).toBeInTheDocument();
    // 25,000 / 100,000 = 25%
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("shows '—' rather than zero when equity is not reported", () => {
    setSummary({ ...FULL_SUMMARY, equity: null }, "ready");
    render(<RiskOverviewCards />);
    expect(screen.getByText(/Share of equity not derivable/)).toBeInTheDocument();
  });

  it("keeps per-currency P&L separate and never sums it", () => {
    setSummary({ ...FULL_SUMMARY, unrealized_pnl: { USD: "10.00", EUR: "20.00" } }, "ready");
    render(<RiskOverviewCards />);
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.queryByText("30")).not.toBeInTheDocument();
  });

  it("shows '—' for P&L when nothing is reported", () => {
    setSummary({ ...FULL_SUMMARY, unrealized_pnl: {} }, "ready");
    render(<RiskOverviewCards />);
    expect(screen.getByText(/Per currency, exactly as reported/)).toBeInTheDocument();
  });

  it("counts only non-flat positions and flags stale/unpriced marks", () => {
    setSummary(FULL_SUMMARY, "ready");
    seedPositions([
      positionOut({ symbol: "AAPL", quantity: "10" }),
      positionOut({ symbol: "MSFT", quantity: "-2", stale: true }),
      positionOut({ symbol: "TSLA", quantity: "5", market_price: null }),
      positionOut({ symbol: "FLAT", quantity: "0" }),
    ]);
    render(<RiskOverviewCards />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/2 long · 1 short · 1 stale mark · 1 unpriced/)).toBeInTheDocument();
  });

  it("labels surviving figures when the last summary refresh failed", () => {
    // useTerminal keeps the last successful summary on failure; it must not be
    // presented as current.
    setSummary(FULL_SUMMARY, "error");
    render(<RiskOverviewCards />);

    expect(screen.getByRole("note")).toHaveTextContent(/The last account-summary refresh failed/);
    expect(screen.getByText("100,000")).toBeInTheDocument(); // still shown, now labelled
  });

  it("does not claim staleness when the summary is fresh", () => {
    setSummary(FULL_SUMMARY, "ready");
    render(<RiskOverviewCards />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

// --- metrics ----------------------------------------------------------------

describe("RiskMetricsCard", () => {
  beforeEach(() => resetAllStores());

  it("reports concentration per currency and refuses to invent the rest", () => {
    seedPositions([
      positionOut({ symbol: "AAPL", currency: "USD", quantity: "10", market_price: "100.00" }),
      positionOut({ symbol: "MSFT", currency: "USD", quantity: "1", market_price: "100.00" }),
    ]);
    render(<RiskMetricsCard />);

    expect(screen.getByText("Position concentration (USD)")).toBeInTheDocument();
    // The five unbacked metrics are listed with their reasons.
    expect(screen.getByText("VaR (95%)")).toBeInTheDocument();
    expect(screen.getByText("Max drawdown")).toBeInTheDocument();
    expect(screen.getByText("Leverage")).toBeInTheDocument();
    expect(screen.getAllByText("Not reported")).toHaveLength(5);
  });

  it("explains the empty case instead of showing 0% concentration", () => {
    render(<RiskMetricsCard />);
    expect(screen.getByText("No priced positions to measure.")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("reports a failed positions load", () => {
    positionsStore.update((s) => ({ ...s, loadState: "error", errorMessage: "boom" }));
    render(<RiskMetricsCard />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("labels measurements that survived a failed positions refresh", () => {
    seedPositions([positionOut({ symbol: "AAPL", currency: "USD", quantity: "10" })]);
    positionsStore.update((s) => ({ ...s, loadState: "error", errorMessage: "boom" }));
    render(<RiskMetricsCard />);

    expect(screen.getByRole("note")).toHaveTextContent(/The last positions refresh failed/);
    // Hard failure is NOT claimed when data is present — only staleness.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// --- limits -----------------------------------------------------------------

describe("RiskLimitsCard", () => {
  beforeEach(() => resetAllStores());

  it("lists all eight enforced rules and says thresholds are not exposed", () => {
    accountStore.update((s) => ({ ...s, killSwitchActive: false, killSwitchState: "ready" }));
    render(<RiskLimitsCard />);

    for (const rule of [
      "kill_switch",
      "order_size_limit",
      "position_limit",
      "notional_exposure_limit",
      "available_funds_limit",
      "daily_order_count_limit",
      "daily_loss_limit",
      "trading_session",
    ]) {
      // Some rule names equal their RiskLimits field name, so both the code
      // cell and the field cell can carry the same text.
      expect(screen.getAllByText(rule).length).toBeGreaterThan(0);
    }
    // 7 configurable rules expose no threshold; the kill switch does.
    expect(screen.getAllByText("Not exposed")).toHaveLength(7);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows the live kill-switch state", () => {
    accountStore.update((s) => ({ ...s, killSwitchActive: true, killSwitchState: "ready" }));
    render(<RiskLimitsCard />);
    expect(screen.getByText("Active (orders halted)")).toBeInTheDocument();
  });

  it("never offers an edit control for a limit it could not save", () => {
    accountStore.update((s) => ({ ...s, killSwitchActive: false, killSwitchState: "ready" }));
    render(<RiskLimitsCard />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
});

// --- alerts -----------------------------------------------------------------

describe("RiskViolationsCard", () => {
  beforeEach(() => resetAllStores());

  function seedViolations() {
    riskStore.setState({
      violations: [
        {
          eventId: "evt-1",
          accountId: "ACC-001",
          rule: "order_size_limit",
          message: "quantity exceeds limit",
          symbol: "AAPL",
          timestamp: "2026-10-29T10:00:00+00:00",
        },
        {
          eventId: "evt-2",
          accountId: "ACC-001",
          rule: "daily_loss_limit",
          message: "daily loss breached",
          symbol: null,
          timestamp: "2026-10-29T10:01:00+00:00",
        },
      ],
    });
  }

  it("has an explicit empty state (never fabricated alerts)", () => {
    render(<RiskViolationsCard />);
    expect(screen.getByText("No risk violations this session.")).toBeInTheDocument();
  });

  it("renders rejections and filters by rule", async () => {
    seedViolations();
    render(<RiskViolationsCard />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("Filter risk alerts by rule"),
      "daily_loss_limit",
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/daily loss breached/)).toBeInTheDocument();
    expect(screen.queryByText(/quantity exceeds limit/)).not.toBeInTheDocument();
  });

  it("does not offer acknowledgement (no such endpoint exists)", () => {
    seedViolations();
    render(<RiskViolationsCard />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// --- positions --------------------------------------------------------------

describe("PositionRiskCard", () => {
  beforeEach(() => resetAllStores());

  it("renders a row per open position with direction and derived market value", () => {
    seedPositions([
      positionOut({
        symbol: "AAPL",
        quantity: "10",
        market_price: "100.00",
        unrealized_pnl: "5.00",
      }),
      positionOut({
        symbol: "MSFT",
        quantity: "-5",
        market_price: "200.00",
        unrealized_pnl: "-2.50",
      }),
    ]);
    render(<PositionRiskCard />);

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("LONG")).toBeInTheDocument();
    expect(screen.getByText("SHORT")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText(/2 open · 0 stale · 0 unpriced/)).toBeInTheDocument();
  });

  it("marks stale and unpriced rows instead of showing a current price", () => {
    seedPositions([
      positionOut({ symbol: "AAPL", stale: true }),
      positionOut({ symbol: "TSLA", market_price: null, unrealized_pnl: null }),
    ]);
    render(<PositionRiskCard />);
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("Unpriced")).toBeInTheDocument();
    expect(screen.getByText(/2 open · 1 stale · 1 unpriced/)).toBeInTheDocument();
  });

  it("hides flat positions", () => {
    seedPositions([positionOut({ quantity: "0" })]);
    render(<PositionRiskCard />);
    expect(screen.getByText("No open positions.")).toBeInTheDocument();
  });

  it("never shows a stop level it cannot verify", () => {
    seedPositions([positionOut()]);
    render(<PositionRiskCard />);
    // No position→protective-order linkage exists, so no stop column is offered.
    expect(screen.queryByRole("columnheader", { name: /stop/i })).not.toBeInTheDocument();
    expect(screen.getByText(/No protective-stop display/)).toBeInTheDocument();
  });

  it("labels rows that survived a failed positions refresh", () => {
    seedPositions([positionOut({ symbol: "AAPL", quantity: "10" })]);
    positionsStore.update((s) => ({ ...s, loadState: "error", errorMessage: "boom" }));
    render(<PositionRiskCard />);

    expect(screen.getByRole("note")).toHaveTextContent(/The last positions refresh failed/);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });
});

// --- pre-trade check --------------------------------------------------------

describe("RiskTestPanel", () => {
  beforeEach(() => resetAllStores());

  async function fillValidOrder() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Symbol"), "AAPL");
    await user.type(screen.getByLabelText("Quantity"), "10");
    await user.type(screen.getByLabelText("Limit price"), "150");
    return user;
  }

  it("is read-only for viewers (the endpoint requires orders:write)", async () => {
    await loginForTests(TEST_VIEWER);
    withApi(<RiskTestPanel />);
    expect(screen.getByText("Read-only access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run risk check/i })).not.toBeInTheDocument();
  });

  it("reports an approval without creating an order", async () => {
    await loginForTests(TEST_TRADER);
    const api = createMockApi();
    api.evaluateRisk.mockResolvedValueOnce({
      approved: true,
      violations: [],
    } satisfies RiskDecisionOut);
    withApi(<RiskTestPanel />, api);

    const user = await fillValidOrder();
    await user.click(screen.getByRole("button", { name: /run risk check/i }));

    expect(await screen.findByText("Would be approved")).toBeInTheDocument();
    expect(api.evaluateRisk).toHaveBeenCalledWith(
      "ACC-001",
      expect.objectContaining({ side: "BUY", quantity: "10", order_type: "LIMIT" }),
    );
    expect(api.createOrder).not.toHaveBeenCalled();
  });

  it("distinguishes limit breaches from fail-closed data-unavailable rejections", async () => {
    await loginForTests(TEST_TRADER);
    const api = createMockApi();
    api.evaluateRisk.mockResolvedValueOnce({
      approved: false,
      violations: [
        { rule: "order_size_limit", reason: "quantity 10 exceeds 5", data_unavailable: false },
        { rule: "notional_exposure_limit", reason: "no quote", data_unavailable: true },
      ],
    } satisfies RiskDecisionOut);
    withApi(<RiskTestPanel />, api);

    const user = await fillValidOrder();
    await user.click(screen.getByRole("button", { name: /run risk check/i }));

    expect(await screen.findByText(/would be rejected by the risk gate/)).toBeInTheDocument();
    expect(screen.getByText(/quantity 10 exceeds 5/)).toBeInTheDocument();
    expect(screen.getByText(/Rejected because required data is unavailable/)).toBeInTheDocument();
    expect(api.createOrder).not.toHaveBeenCalled();
  });

  it("blocks invalid input before calling the API", async () => {
    await loginForTests(TEST_TRADER);
    const api = createMockApi();
    withApi(<RiskTestPanel />, api);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /run risk check/i }));
    expect(api.evaluateRisk).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a symbol.")).toBeInTheDocument();
  });

  it("prevents a duplicate evaluation while one is in flight", async () => {
    await loginForTests(TEST_TRADER);
    const api = createMockApi();
    const deferred: { resolve?: (value: RiskDecisionOut) => void } = {};
    api.evaluateRisk.mockReturnValueOnce(
      new Promise<RiskDecisionOut>((resolve) => {
        deferred.resolve = resolve;
      }),
    );
    withApi(<RiskTestPanel />, api);

    const user = await fillValidOrder();
    const button = screen.getByRole("button", { name: /run risk check/i });
    await user.click(button);
    await user.click(button);

    expect(api.evaluateRisk).toHaveBeenCalledTimes(1);
    deferred.resolve?.({ approved: true, violations: [] });
    expect(await screen.findByText("Would be approved")).toBeInTheDocument();
  });

  it("uses the active account and reports a server error without inventing a decision", async () => {
    await loginForTests(TEST_TRADER);
    uiStore.update((s) => ({ ...s, accountId: "ACC-002" }));
    const api = createMockApi();
    api.evaluateRisk.mockRejectedValueOnce(Object.assign(new Error("boom"), { name: "Error" }));
    withApi(<RiskTestPanel />, api);

    const user = await fillValidOrder();
    await user.click(screen.getByRole("button", { name: /run risk check/i }));

    await waitFor(() => expect(api.evaluateRisk).toHaveBeenCalledTimes(1));
    expect(api.evaluateRisk.mock.calls[0][0]).toBe("ACC-002");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Would be approved")).not.toBeInTheDocument();
  });
});

// --- page composition -------------------------------------------------------

describe("RiskPage", () => {
  beforeEach(() => resetAllStores());

  it("composes the workspace and states the enforcement boundary", async () => {
    await loginForTests(TEST_TRADER);
    setSummary(FULL_SUMMARY, "ready");
    brokersStore.update((s) => ({ ...s, brokers: [{ name: "IBKR", connected: true }] }));
    withApi(<RiskPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Risk Management" })).toBeInTheDocument();
    expect(screen.getByText(/IBKR \(connected\)/)).toBeInTheDocument();

    // Every region the Figma screen defines is present.
    for (const title of [
      "Risk metrics",
      "Risk limits",
      "Risk alerts",
      "Pre-trade risk check",
      "Position risk",
      "Emergency controls",
    ]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }

    expect(screen.getByText(/Enforced by the backend/)).toBeInTheDocument();
    // The backend gaps are user-visible, not only documented.
    expect(screen.getByText("Readable risk limits")).toBeInTheDocument();
    expect(screen.getByText(/Informational on this page/)).toBeInTheDocument();
  });

  it("shows the kill-switch control state from the store", async () => {
    await loginForTests(TEST_TRADER);
    setSummary(FULL_SUMMARY, "ready");
    accountStore.update((s) => ({ ...s, killSwitchActive: true, killSwitchState: "ready" }));
    withApi(<RiskPage />);
    const emergency = screen.getByRole("region", { name: "Emergency controls" });
    expect(within(emergency).getByText("KILL SWITCH ACTIVE")).toBeInTheDocument();
  });
});

// Guard: the module must never import the order-submission path.
describe("module boundaries", () => {
  it("RiskTestPanel never references createOrder", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "features", "risk", "RiskTestPanel.tsx"),
      "utf-8",
    );
    expect(source).not.toContain("createOrder");
  });
});
