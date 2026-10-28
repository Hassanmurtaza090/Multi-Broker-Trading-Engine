/**
 * Markets screen tests (M6).
 *
 * Covers the user-visible contract of the watchlist/market-data module:
 * list CRUD with confirmation, instrument add/remove with duplicate feedback,
 * search and asset-class narrowing, quote rendering with the shared
 * live/polled/stale/no-data/error badges, "—" for genuinely missing values,
 * the session-change metric (including its explicit "not a daily change"
 * labelling and its absence with a single observation), numeric sorting,
 * instrument navigation into the Trade screen, and the honest empty states.
 *
 * Quotes are always controlled fixtures; nothing here contacts a broker or a
 * live market-data source.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { MarketsPage } from "../../pages/MarketsPage";
import { marketStore, resetAllStores, uiStore, watchlistsStore } from "../../stores";
import { applyQuoteOut, setQuoteFetchState } from "../../stores/marketStore";
import { watchlistActions } from "../../stores/watchlistsStore";
import { quoteOut } from "../../test/mocks";
import type { InstrumentDescriptor } from "../../utils/instrument";
import { instrumentKey } from "../../utils/instrument";

function aapl(overrides: Partial<InstrumentDescriptor> = {}): InstrumentDescriptor {
  return {
    symbol: "AAPL",
    asset_class: "EQUITY",
    currency: "USD",
    exchange: "NASDAQ",
    ...overrides,
  };
}

function btc(): InstrumentDescriptor {
  return { symbol: "BTC", asset_class: "CRYPTO", currency: "USD", exchange: "UNKNOWN" };
}

/** Create a list (activating it) and add instruments to it. */
function seedList(name: string, instruments: InstrumentDescriptor[] = []): string {
  const created = watchlistActions.create(name);
  if (!created.ok) throw new Error(`could not create ${name}`);
  for (const instrument of instruments) watchlistActions.addInstrument(instrument);
  return created.id;
}

/** A quote whose origin timestamp is "now", so the staleness rule keeps it fresh. */
function freshQuote(overrides: Parameters<typeof quoteOut>[0] = {}) {
  return quoteOut({ timestamp: new Date().toISOString(), ...overrides });
}

function applyQuote(
  descriptor: InstrumentDescriptor,
  overrides: Parameters<typeof quoteOut>[0] = {},
) {
  marketStore.update((state) => applyQuoteOut(state, descriptor, freshQuote(overrides)));
}

function rowsOf(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("tbody tr")] as HTMLElement[];
}

describe("MarketsPage — watchlist management", () => {
  beforeEach(() => resetAllStores());

  it("opens on the default list with an explicit empty state and storage note", () => {
    render(<MarketsPage />);

    expect(screen.getByRole("heading", { name: "Markets", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Watchlist", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("This watchlist is empty.")).toBeInTheDocument();
    // The persistence claim is stated in the rail and again in the notes.
    expect(
      screen.getAllByText(/Saved in this browser only \(localStorage\)/).length,
    ).toBeGreaterThan(0);
    // No fabricated market data of any kind on an empty list.
    expect(screen.queryByText("24H")).not.toBeInTheDocument();
  });

  it("creates a watchlist and selects it", async () => {
    render(<MarketsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "+ New list" }));
    await user.type(screen.getByLabelText("New watchlist name"), "Crypto majors");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByRole("heading", { name: "Crypto majors", level: 2 })).toBeInTheDocument();
    const railItem = screen.getByRole("button", { name: /Crypto majors/ });
    expect(railItem).toHaveAttribute("aria-current", "true");
    expect(watchlistsStore.getSnapshot().lists).toHaveLength(2);
  });

  it("rejects a duplicate list name with a real error message", async () => {
    render(<MarketsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "+ New list" }));
    await user.type(screen.getByLabelText("New watchlist name"), "watchlist");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "A watchlist with that name already exists.",
    );
    expect(watchlistsStore.getSnapshot().lists).toHaveLength(1);
  });

  it("renames the active list", async () => {
    render(<MarketsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Watchlist name");
    await user.clear(input);
    await user.type(input, "Long term");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("heading", { name: "Long term", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Long term/ })).toBeInTheDocument();
    expect(screen.getByText("Watchlist renamed.")).toBeInTheDocument();
  });

  it("deletes a list only after confirmation and falls back to the remaining list", async () => {
    seedList("Crypto majors", [btc()]);
    render(<MarketsPage />);
    const user = userEvent.setup();

    // The second list is active after seeding.
    expect(screen.getByRole("heading", { name: "Crypto majors", level: 2 })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete “Crypto majors” and its 1 instrument?");
    await user.click(within(dialog).getByRole("button", { name: "Delete list" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Watchlist", level: 2 })).toBeInTheDocument();
    expect(watchlistsStore.getSnapshot().lists).toHaveLength(1);
  });

  it("shows the no-watchlist state when every list was deleted", () => {
    const state = watchlistsStore.getSnapshot();
    watchlistActions.remove(state.activeId);
    render(<MarketsPage />);

    expect(screen.getByRole("heading", { name: "No watchlist selected" })).toBeInTheDocument();
    expect(screen.getByText("No watchlists exist.")).toBeInTheDocument();
    expect(screen.getByText(/No watchlists yet/)).toBeInTheDocument();
  });
});

describe("MarketsPage — instruments", () => {
  beforeEach(() => resetAllStores());

  it("adds an instrument and reports success, then refuses the duplicate", async () => {
    render(<MarketsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "+ Add instrument" }));
    await user.type(screen.getByLabelText("Symbol"), "msft");
    await user.selectOptions(screen.getByLabelText("Exchange"), "NASDAQ");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const row = screen.getByTestId("market-row-MSFT");
    expect(within(row).getByText("MSFT")).toBeInTheDocument();
    // Feedback is a real status message (the quote badges are role=status too,
    // so assert on the copy rather than the role).
    expect(screen.getByText("MSFT · NASDAQ added to Watchlist.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Symbol"), "MSFT");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("MSFT · NASDAQ is already in Watchlist.");
    expect(screen.getAllByTestId("market-row-MSFT")).toHaveLength(1);
  });

  it("keeps instruments distinct per venue and never merges identities", () => {
    seedList("Venues", [aapl(), aapl({ exchange: "NYSE" })]);
    render(<MarketsPage />);

    const rows = screen.getAllByTestId("market-row-AAPL");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("NASDAQ");
    expect(rows[1]).toHaveTextContent("NYSE");
  });

  it("removes an instrument from the active list", async () => {
    seedList("Second", [aapl(), btc()]);
    render(<MarketsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove AAPL from Second" }));
    expect(screen.queryByTestId("market-row-AAPL")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-row-BTC")).toBeInTheDocument();
    expect(screen.getByText("AAPL removed from Second.")).toBeInTheDocument();
    expect(watchlistsStore.getSnapshot().lists[1].instruments).toHaveLength(1);
  });

  it("filters by search text and asset class, with a working clear", async () => {
    seedList("Mixed", [aapl(), btc()]);
    render(<MarketsPage />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Filter instruments"), "btc");
    expect(screen.getByTestId("market-row-BTC")).toBeInTheDocument();
    expect(screen.queryByTestId("market-row-AAPL")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Filter instruments"));
    await user.selectOptions(screen.getByLabelText("Filter by asset class"), "EQUITY");
    expect(screen.getByTestId("market-row-AAPL")).toBeInTheDocument();
    expect(screen.queryByTestId("market-row-BTC")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Filter instruments"), "zzz");
    expect(screen.getByText("No instruments match the current filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByTestId("market-row-AAPL")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-BTC")).toBeInTheDocument();
  });
});

describe("MarketsPage — quote semantics", () => {
  beforeEach(() => resetAllStores());

  it("renders real quote fields with the shared freshness badges", () => {
    seedList("Quotes", [
      aapl(),
      btc(),
      { symbol: "ETH", asset_class: "CRYPTO", currency: "USD", exchange: "UNKNOWN" },
    ]);
    applyQuote(aapl());
    applyQuote(btc(), { stale: true });
    marketStore.update((state) => setQuoteFetchState(state, instrumentKey(btc()), "missing"));

    render(<MarketsPage />);

    const aaplRow = screen.getByTestId("market-row-AAPL");
    expect(within(aaplRow).getByText("150.25")).toBeInTheDocument();
    expect(within(aaplRow).getByText("150")).toBeInTheDocument();
    expect(within(aaplRow).getByText("150.5")).toBeInTheDocument();
    expect(within(aaplRow).getByText("Polled")).toBeInTheDocument();
    // A REST-read quote is never labelled "Live".
    expect(within(aaplRow).queryByText("Live")).not.toBeInTheDocument();

    // The engine reported no quote for BTC (REST 404 semantics) → "No data".
    expect(within(screen.getByTestId("market-row-BTC")).getByText("No data")).toBeInTheDocument();
  });

  it("labels a stale quote as stale instead of live", () => {
    seedList("Stale", [aapl()]);
    applyQuote(aapl(), { stale: true });
    render(<MarketsPage />);
    expect(within(screen.getByTestId("market-row-AAPL")).getByText("Stale")).toBeInTheDocument();
  });

  it("shows an error badge when the quote request fails", () => {
    seedList("Errors", [aapl()]);
    marketStore.update((state) => setQuoteFetchState(state, instrumentKey(aapl()), "error"));
    render(<MarketsPage />);
    expect(within(screen.getByTestId("market-row-AAPL")).getByText("Error")).toBeInTheDocument();
  });

  it("renders '—' for missing bid/ask and never invents a zero", () => {
    seedList("Empty book", [aapl()]);
    applyQuote(aapl(), { bid: null, ask: null, last: null, mid: null });
    const { container } = render(<MarketsPage />);

    const row = screen.getByTestId("market-row-AAPL");
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(3); // last, bid, ask
    expect(row.textContent).not.toMatch(/\b0(\.0+)?\b/);
    expect(rowsOf(container)).toHaveLength(1);
  });

  it("shows the session change only once two observations exist, labelled as not a daily change", () => {
    seedList("Observed", [aapl({ symbol: "AAPL" })]);
    const key = instrumentKey(aapl());
    marketStore.update((state) => ({
      ...state,
      history: { [key]: [{ t: 1, price: 149 }] },
    }));
    const first = render(<MarketsPage />);
    expect(
      within(screen.getByTestId("market-row-AAPL")).getByTitle(/No change can be shown/),
    ).toHaveTextContent("—");
    first.unmount();

    marketStore.update((state) => ({
      ...state,
      history: {
        [key]: [
          { t: 1, price: 149 },
          { t: 2, price: 150.25 },
        ],
      },
    }));
    render(<MarketsPage />);

    const cell = screen.getByText(/^\+1\.25/);
    expect(cell).toHaveTextContent("(+0.84%)");
    expect(cell).toHaveAttribute("title", expect.stringContaining("Not a daily/24H change"));
    expect(cell).toHaveClass("pos");
  });

  it("sorts decimal prices numerically, not lexicographically", async () => {
    seedList("Sorting", [aapl({ symbol: "TEN" }), aapl({ symbol: "NINE" })]);
    applyQuote(aapl({ symbol: "TEN" }), { last: "10" });
    applyQuote(aapl({ symbol: "NINE" }), { last: "9" });
    const { container } = render(<MarketsPage />);

    // Default order is by instrument, never by an implied price ranking.
    expect(rowsOf(container)[0]).toHaveTextContent("NINE");
    expect(rowsOf(container)[1]).toHaveTextContent("TEN");

    const user = userEvent.setup();
    // Numeric columns start descending: 10 before 9.
    await user.click(screen.getByRole("button", { name: /^Last/ }));
    expect(rowsOf(container)[0]).toHaveTextContent("TEN");
    expect(rowsOf(container)[1]).toHaveTextContent("NINE");

    // Ascending proves NUMERIC ordering: a string sort would put "10" first.
    await user.click(screen.getByRole("button", { name: /^Last/ }));
    expect(rowsOf(container)[0]).toHaveTextContent("NINE");
    expect(rowsOf(container)[1]).toHaveTextContent("TEN");
  });

  it("selects the instrument for the Trade screen", async () => {
    seedList("Nav", [aapl()]);
    render(<MarketsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Open AAPL in Trade" }));
    expect(uiStore.getSnapshot().view).toBe("dashboard");
    expect(uiStore.getSnapshot().selectedInstrument?.symbol).toBe("AAPL");
  });

  it("states the data limitations in the UI, not just in documentation", () => {
    render(<MarketsPage />);
    const notes = screen.getByRole("region", { name: "Quote semantics & limitations" });
    expect(notes).toHaveTextContent(/not a daily or 24-hour change/i);
    expect(notes).toHaveTextContent(/market-session status/i);
    expect(notes).toHaveTextContent(/never treated as zero/i);
    expect(notes).toHaveTextContent(/opens no second connection/i);
  });
});
