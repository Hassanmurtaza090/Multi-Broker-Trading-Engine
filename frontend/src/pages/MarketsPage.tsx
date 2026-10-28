/**
 * Markets page (M6) — watchlists plus the terminal's market-data view.
 *
 * DESIGN NOTE: the Figma Make prototype has no Markets destination. Its
 * sidebar is Overview / Trade / Orders / Positions / Accounts / Activity, and
 * market data appears only as the "Markets" card inside the Trade screen
 * (with an asset-class tab strip and a "24H" column). M6 asks for a dedicated
 * Watchlists screen, so this page is an INFERRED extension: it reuses the
 * FE-M1 design system (page title → rail + panel → tables/toolbars/badges) and
 * the same Markets card primitives (instrument icon, tabs, quote-state badge).
 * The mock's "24H" column is not reproduced because the provider reports no
 * daily change — see the notes panel below, which states every limitation in
 * the UI itself rather than only in documentation.
 *
 * Data provenance: watchlists are a this-device-only client feature (the API
 * has no watchlist endpoints); quotes come from the single existing market
 * pipeline — REST `GET /market/quote` polling plus `market.quote.updated` on
 * the terminal's one WebSocket. Nothing on this page opens a new connection.
 */

import { Panel } from "../components/Panel";
import { config } from "../config";
import { uiStore, watchlistsStore } from "../stores";
import { useStoreState } from "../stores/store";
import { activeList } from "../stores/watchlistsStore";
import { storageNote } from "../features/markets/storageNote";
import { WatchlistRail } from "../features/markets/WatchlistRail";
import { WatchlistTable } from "../features/markets/WatchlistTable";

const POLL_SECONDS = Math.max(1, Math.round(config.quotePollMs / 1000));
const STALE_SECONDS = Math.max(1, Math.round(config.staleWindowMs / 1000));

export function MarketsPage() {
  const watchlists = useStoreState(watchlistsStore);
  const active = activeList(watchlists);
  const totalInstruments = watchlists.lists.reduce(
    (total, list) => total + list.instruments.length,
    0,
  );

  return (
    <div className="workspace">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Market data</p>
          <h1>Markets</h1>
          <p className="page-subtitle">
            {watchlists.lists.length} watchlist{watchlists.lists.length === 1 ? "" : "s"} ·{" "}
            {totalInstruments} instrument{totalInstruments === 1 ? "" : "s"} · quotes from GET
            /market/quote (every {POLL_SECONDS}s) and the market stream
          </p>
        </div>
        <div className="title-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => uiStore.update((state) => ({ ...state, view: "dashboard" }))}
            title="Open the Trade screen (order ticket and chart)"
          >
            Trade screen
          </button>
        </div>
      </section>

      <div className="markets-layout">
        <WatchlistRail state={watchlists} />
        <WatchlistTable list={active} listCount={watchlists.lists.length} />
      </div>

      <Panel title="Quote semantics & limitations" subtitle="What this screen can and cannot show">
        <ul className="markets-notes-list">
          <li>
            <b>Source</b> — every price comes from the engine's own market-data store via{" "}
            <code>GET /api/v1/market/quote</code>, polled once every {POLL_SECONDS}s for the
            instruments in the selected watchlist, merged with <code>market.quote.updated</code>{" "}
            events on the terminal's existing WebSocket. This screen opens no second connection and
            starts no additional polling.
          </li>
          <li>
            <b>State badges</b> — <em>Live</em> means the quote arrived on the stream;{" "}
            <em>Polled</em> means it was read over REST; <em>Stale</em> means it is older than{" "}
            {STALE_SECONDS}s or flagged stale by the server; <em>No data</em> means the engine
            reports no quote for that instrument (HTTP 404); <em>Error</em> means the request itself
            failed.
          </li>
          <li>
            <b>Session Δ</b> — the change between the first and latest quote this terminal received
            in this session, with the sample count in its tooltip. It is <b>not</b> a daily or
            24-hour change: the provider reports no previous close, day open, or change field, so no
            such value is displayed anywhere.
          </li>
          <li>
            <b>Not reported by the API</b> — daily/24H change, previous close, market-session status
            (open/closed), venue depth, trades/volume, and instrument descriptions. Missing bid, ask
            or last values render “—” and are never treated as zero. Prices are shown exactly as the
            engine reports them, in the instrument's own currency, with no cross-currency
            conversion.
          </li>
          <li>
            <b>Persistence</b> — {storageNote(watchlists.storage)} Instrument names appear only when
            a payload supplies one; they are never derived from the symbol.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
