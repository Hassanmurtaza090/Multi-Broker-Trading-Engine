/**
 * Strategies screen tests (FE-M7).
 *
 * The module's contract is unusual: the correct behaviour is to implement
 * NOTHING that the backend cannot support. These tests therefore assert
 * absence and honesty as strictly as presence:
 *
 * - the capability registry is complete, consistent and entirely unavailable;
 * - the page renders "—" for every designed metric and never prints a
 *   fabricated figure (no design literals, no zeros, no strategy names);
 * - every designed control is disabled with a stated reason and does nothing;
 * - the page issues no network request and triggers no lifecycle action on
 *   mount (there is no strategy endpoint to call — a call would be a fictional
 *   interaction);
 * - the real adjacent workflows are reachable and navigate to their views;
 * - the exact backend work required is stated per capability.
 *
 * No strategy is created, started, stopped or backtested anywhere in this
 * file, and no broker/execution integration is contacted.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STRATEGY_AREAS,
  STRATEGY_CAPABILITIES,
  STRATEGY_REUSABLE_FOUNDATIONS,
  STRATEGY_SYSTEM_GAPS,
  capabilitiesByArea,
  summarizeCapabilities,
} from "./capabilities";
import { StrategiesPage } from "../../pages/StrategiesPage";
import { resetAllStores, uiStore } from "../../stores";

describe("strategy capability registry", () => {
  it("defines one entry per capability the prototype presents, with unique ids", () => {
    const ids = STRATEGY_CAPABILITIES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The prototype shows list, configuration, lifecycle, P&L, deployment,
    // backtest and a strategy library — seven areas of unimplemented product.
    expect(ids).toHaveLength(7);
  });

  it("reports zero available capabilities (nothing is claimed without an endpoint)", () => {
    expect(summarizeCapabilities()).toEqual({ total: 7, available: 0, unavailable: 7 });
    expect(STRATEGY_CAPABILITIES.every((item) => item.status === "unavailable")).toBe(true);
  });

  it("gives every capability a reason and at least one concrete backend requirement", () => {
    for (const capability of STRATEGY_CAPABILITIES) {
      expect(capability.title.trim().length).toBeGreaterThan(0);
      expect(capability.design.trim().length).toBeGreaterThan(0);
      // A reason must explain WHY, not just say "not implemented".
      expect(capability.reason.length).toBeGreaterThan(60);
      expect(capability.requires.length).toBeGreaterThan(0);
      for (const requirement of capability.requires) {
        expect(requirement.length).toBeGreaterThan(20);
      }
    }
  });

  it("groups capabilities into the prototype's three tabs, none empty", () => {
    expect(STRATEGY_AREAS.map((area) => area.value)).toEqual(["active", "backtest", "library"]);
    for (const area of STRATEGY_AREAS) {
      expect(capabilitiesByArea(area.value).length).toBeGreaterThan(0);
    }
    // Every capability lands in exactly one tab.
    const grouped = STRATEGY_AREAS.flatMap((area) => capabilitiesByArea(area.value));
    expect(grouped).toHaveLength(STRATEGY_CAPABILITIES.length);
  });

  it("records the structural gaps and the foundations a future service must reuse", () => {
    expect(STRATEGY_SYSTEM_GAPS.length).toBeGreaterThanOrEqual(4);
    expect(STRATEGY_REUSABLE_FOUNDATIONS.map((item) => item.title)).toContain("Risk gate");
    // The registry must not present a bypass: the gate statement is explicit.
    const gate = STRATEGY_CAPABILITIES.find((item) => item.id === "lifecycle");
    expect(gate?.requires.join(" ")).toMatch(/risk gate/i);
  });
});

describe("StrategiesPage — honest unavailable state", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetAllStores();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the page shell and states the capability gap up front", () => {
    render(<StrategiesPage />);
    expect(screen.getByRole("heading", { name: "Strategies", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("CAPABILITY NOT PRESENT")).toBeInTheDocument();
    expect(
      screen.getByText(/7 of 7 designed strategy capabilities are unavailable/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing on this page is simulated/)).toBeInTheDocument();
  });

  it("shows the prototype's three metrics as unavailable, never as zero or a number", () => {
    render(<StrategiesPage />);
    const metrics = screen.getByRole("region", { name: "Strategy metrics" });
    for (const label of ["Active strategies", "Strategy P&L", "Execution health"]) {
      const card = within(metrics).getByText(label).closest("article");
      expect(card).not.toBeNull();
      // The value slot is "—" (honest) and never "0".
      expect(within(card as HTMLElement).getByText("—")).toBeInTheDocument();
      expect(within(card as HTMLElement).getByText(/Not reported by the API/)).toBeInTheDocument();
    }
    // No fabricated figures anywhere in the metrics row.
    expect(within(metrics).queryByText(/\d/)).not.toBeInTheDocument();
  });

  it("does not render the prototype's demo numbers or strategy names as data", () => {
    render(<StrategiesPage />);
    for (const demo of ["1,842.60", "99.98", "Mean Reversion", "Trend Following", "Scalping"]) {
      expect(screen.queryByText(new RegExp(demo.replace(".", "\\.")))).toBeNull();
    }
  });

  it("shows the records table with an explicit absent-capability note, not an empty list", () => {
    render(<StrategiesPage />);
    for (const header of ["Strategy name", "Symbol", "Status", "Last run"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    const note = screen.getByText("No strategy records — this platform has no strategy service.");
    expect(note).toBeInTheDocument();
    expect(screen.getByText(/it is an absent capability/)).toBeInTheDocument();
    // Exactly one body row: the explanation itself. No fabricated rows.
    const table = screen.getAllByRole("table")[0];
    expect(within(table).getAllByRole("row")).toHaveLength(2); // header + note row
  });

  it("renders every designed control as disabled, with the reason attached", async () => {
    render(<StrategiesPage />);
    const pause = screen.getByRole("button", { name: "Pause / resume strategy" });
    const create = screen.getByRole("button", { name: "+ Create new strategy" });
    for (const button of [pause, create]) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      // The reason is the element's accessible description (tooltip) AND a
      // visible, linked reason — not hover-only.
      expect(button.getAttribute("title")?.length ?? 0).toBeGreaterThan(20);
      const describedBy = button.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const reason = document.getElementById(describedBy as string);
      expect(reason).not.toBeNull();
      expect((reason?.textContent ?? "").length).toBeGreaterThan(20);
    }

    // Clicking a disabled control changes nothing — no navigation, no request.
    const viewBefore = uiStore.getSnapshot().view;
    await userEvent.click(pause);
    await userEvent.click(create);
    expect(uiStore.getSnapshot().view).toBe(viewBefore);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("issues no network request and starts no lifecycle action on mount", () => {
    render(<StrategiesPage />);
    expect(fetchSpy).not.toHaveBeenCalled();
    // No strategy endpoint was even attempted, and the view is untouched.
    expect(uiStore.getSnapshot().view).toBe("dashboard");
    // The page never renders a control that would start real trading.
    expect(screen.queryByRole("button", { name: /^start/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^stop/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete/i })).toBeNull();
  });

  it("lists the exact backend work required for each visible capability", () => {
    render(<StrategiesPage />);
    const card = screen.getByTestId("strategy-capability-listing");
    expect(within(card).getByText("Strategy list & overview")).toBeInTheDocument();
    expect(within(card).getByText("Backend work required")).toBeInTheDocument();
    // The requirement names the real contract, not a vague promise.
    expect(within(card).getByText(/GET \/api\/v1\/strategies\?account_id=/)).toBeInTheDocument();
  });
});

describe("StrategiesPage — capability tabs", () => {
  beforeEach(() => resetAllStores());

  it("switches areas through the tab group (a real, working control)", async () => {
    render(<StrategiesPage />);
    const group = screen.getByRole("radiogroup", { name: "Strategy capability areas" });
    const active = within(group).getByRole("radio", { name: "Active strategies" });
    expect(active).toHaveAttribute("aria-checked", "true");

    await userEvent.click(within(group).getByRole("radio", { name: "Backtest" }));

    // Only backtest capabilities remain, and the backtest action appears.
    expect(screen.getByTestId("strategy-capability-backtest")).toBeInTheDocument();
    expect(screen.queryByTestId("strategy-capability-listing")).toBeNull();
    expect(screen.getByRole("button", { name: "Run backtest" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Pause / resume strategy" })).toBeNull();
  });

  it("shows the library area with its creation blocker", async () => {
    render(<StrategiesPage />);
    await userEvent.click(screen.getByRole("radio", { name: "Library" }));
    expect(screen.getByTestId("strategy-capability-library")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: "+ Create new strategy" });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute("title", expect.stringContaining("No strategy type library"));
  });

  it("keeps the backtest tab honest about missing historical bars", async () => {
    render(<StrategiesPage />);
    await userEvent.click(screen.getByRole("radio", { name: "Backtest" }));
    // The reason must name the real blocker (no bar producer), not just "soon".
    expect(screen.getByText(/nothing in the repository ever produces a bar/)).toBeInTheDocument();
  });
});

describe("StrategiesPage — routes to capabilities that do exist", () => {
  beforeEach(() => resetAllStores());

  it.each([
    ["Trade screen — manual, risk-gated order entry", "dashboard"],
    ["Orders — blotter, cancel and modify", "orders"],
    ["Activity — order history and live fills", "activity"],
    ["Positions — exposure and unrealized P&L", "positions"],
  ] as const)("navigates to %s", async (label, view) => {
    render(<StrategiesPage />);
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(uiStore.getSnapshot().view).toBe(view);
  });

  it("states that any future strategy must use the existing risk gate", () => {
    render(<StrategiesPage />);
    expect(
      screen.getByText(/Any future strategy must submit through the same gate/),
    ).toBeInTheDocument();
    expect(screen.getByText(/no path that bypasses it/)).toBeInTheDocument();
  });

  it("documents that this milestone implements the capability state only", () => {
    render(<StrategiesPage />);
    expect(screen.getByText(/Deliberately not implemented/)).toBeInTheDocument();
    expect(screen.getByText(/this page issues no REST request/i)).toBeInTheDocument();
  });
});
