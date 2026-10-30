/**
 * Broker Connections & Account Management (FE-M9).
 *
 * This page reports the ACTUAL broker integration state — no fabricated
 * connections, no pretend credential management, no simulated account
 * linking. The backend runs ONE broker at a time (configured at startup via
 * `broker_adapter` / `broker_account`); the `GET /brokers` endpoint returns
 * that single entry. There is NO connect/disconnect API, NO credential
 * storage, NO account registry, and NO multi-broker runtime.
 *
 * What this page DOES do:
 * - Shows the live broker connection status from `GET /brokers` (via WS + REST)
 * - Shows the current account's details from summary/positions/balance
 * - Lists the KNOWN broker adapters (IBKR, Saxo) with their SIMULATED capabilities
 * - States explicitly which capabilities are NOT backed by the current API
 * - Provides no "connect" button because no such endpoint exists
 *
 * Design source: inferred from the terminal's existing broker badge, account
 * selector, and the BrokerStatusPanel. No Figma broker-connection screen exists.
 */

import React from "react";

import { Panel } from "../components/Panel";
import { EmptyState, ErrorState, LoadingState } from "../components/Status";
import { StatusBadge } from "../components/StatusBadge";
import { brokersStore } from "../stores";
import { accountStore } from "../stores";
import { uiStore } from "../stores";
import { useStoreState } from "../stores/store";
import { useServices } from "../services/context";
import { AccountSummaryOut, BalanceOut, BrokerStatusOut, CashBalanceOut } from "../types/api";
import { getBrokerCapabilities, KNOWN_BROKERS } from "../features/brokers/capabilities";
import { MoneyText } from "../components/MoneyText";

interface BackendGap {
  capability: string;
  effect: string;
  requiredWork: string;
}

/** Capabilities this page cannot provide because the backend does not expose them. */
const BACKEND_GAPS: readonly BackendGap[] = [
  {
    capability: "Broker connect / disconnect",
    effect:
      "No 'Connect' or 'Disconnect' buttons — the runtime binds one broker at startup via `broker_adapter` / `broker_account` settings. The `GET /brokers` endpoint is read-only.",
    requiredWork:
      "POST /api/v1/brokers/connect (with broker-specific credential schema), POST /api/v1/brokers/{name}/disconnect, and a credential storage mechanism (encrypted, not in config).",
  },
  {
    capability: "Credential management",
    effect:
      "No credential input, storage, rotation, or revocation UI. Simulated adapters connect without credentials.",
    requiredWork:
      "Secure credential vault (per-user, per-broker), encrypted at rest, with audit logging. API: PUT /api/v1/brokers/{name}/credentials, DELETE /api/v1/brokers/{name}/credentials.",
  },
  {
    capability: "Account registry / multi-account",
    effect:
      "Only the single startup `broker_account` is visible. No `GET /accounts` to list linked accounts, no account linking UI, no default-account selection beyond the header selector.",
    requiredWork:
      "GET /api/v1/accounts (scoped by principal) returning `[{ account_id, broker, label, currency, type, status, last_synced_at }]`. POST /api/v1/accounts to link, PATCH to rename, DELETE to unlink.",
  },
  {
    capability: "Broker health details",
    effect:
      "Only `connected: boolean` is exposed. No last-health-check timestamp, no market-data vs order-routing separation, no recoverable error details.",
    requiredWork:
      "Extend `BrokerStatusOut` with `last_health_check`, `market_data_connected`, `order_routing_connected`, `last_error`, `reconnecting` fields. Backend health-check scheduler.",
  },
  {
    capability: "Live broker switching",
    effect: "Changing `broker_adapter` requires a backend restart. No runtime broker swap.",
    requiredWork:
      "Runtime broker composition (multiple simultaneous adapters) + `POST /api/v1/runtime/broker` to switch. Requires M15+ architecture changes.",
  },
];

export function BrokerConnectionsPage() {
  const { api } = useServices();
  const { brokers, loadState, errorMessage } = useStoreState(brokersStore) as {
    brokers: BrokerStatusOut[];
    loadState: "idle" | "loading" | "ready" | "error";
    errorMessage: string | null;
  };
  const { accountId } = useStoreState(uiStore);
  const { summary, summaryState, killSwitchActive, killSwitchState } = useStoreState(
    accountStore,
  ) as {
    summary: AccountSummaryOut | null;
    summaryState: "idle" | "loading" | "ready" | "error";
    killSwitchActive: boolean | null;
    killSwitchState: "idle" | "loading" | "ready" | "error";
  };

  return (
    <div className="workspace broker-connections-page">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Platform · {accountId}</p>
          <h1>Broker Connections & Accounts</h1>
          <p className="page-subtitle">
            Live broker connectivity, current account details, and integration capabilities. This
            runtime binds ONE broker at startup — no connect/disconnect API exists.
          </p>
        </div>
      </section>

      <section className="risk-context" aria-label="Data provenance">
        <p className="state-detail">
          <b>Scope and provenance.</b> Broker status comes from <code>GET /brokers</code> (REST + WS
          `broker.connected`/`broker.disconnected`). Account figures come from the terminal&apos;s
          existing reads — <code>GET /accounts/&#123;id&#125;/summary</code>,{" "}
          <code>/positions</code>, and
          <code>/balance</code>. The simulated adapters (IBKR, Saxo) connect without credentials in
          paper mode; real transports are deferred (ADR-014/015).
        </p>
      </section>

      {/* Live Broker Status */}
      <BrokerStatusSection brokers={brokers} loadState={loadState} errorMessage={errorMessage} />

      {/* Current Account Details */}
      <AccountDetailsSection
        api={api}
        accountId={accountId}
        summary={summary}
        summaryState={summaryState}
        killSwitchActive={killSwitchActive}
        killSwitchState={killSwitchState}
      />

      {/* Known Broker Capabilities */}
      <BrokerCapabilitiesSection currentBrokerName={brokers[0]?.name ?? null} />

      {/* Backend Gaps */}
      <BackendGapsSection />
    </div>
  );
}

/** Live broker status from the runtime (GET /brokers + WS). */
function BrokerStatusSection({
  brokers,
  loadState,
  errorMessage,
}: {
  brokers: BrokerStatusOut[];
  loadState: "idle" | "loading" | "ready" | "error";
  errorMessage: string | null;
}) {
  return (
    <Panel
      title="Runtime Broker Status"
      subtitle="The broker currently bound to this gateway instance"
    >
      {loadState === "idle" || (loadState === "loading" && brokers.length === 0) ? (
        <LoadingState label="Contacting gateway…" />
      ) : loadState === "error" ? (
        <ErrorState message={errorMessage ?? "Could not load broker status."} />
      ) : brokers.length === 0 ? (
        <EmptyState
          message="No broker configured."
          detail="The gateway reports no active broker integration."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table broker-status-table">
            <thead>
              <tr>
                <th scope="col">Broker</th>
                <th scope="col">Transport</th>
                <th scope="col">Connection</th>
                <th scope="col">Last Event</th>
              </tr>
            </thead>
            <tbody>
              {brokers.map((broker) => {
                const caps = getBrokerCapabilities(broker.name);
                return (
                  <tr key={broker.name}>
                    <td>
                      <span className="cell-primary">{broker.name}</span>
                      {caps && <span className="cell-muted">Adapter: {caps.adapterClass}</span>}
                    </td>
                    <td>
                      {caps ? (
                        <span className="badge badge-muted">{caps.transport}</span>
                      ) : (
                        <span className="cell-muted">Unknown</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge
                        tone={broker.connected ? "ok" : "danger"}
                        label={broker.connected ? "Connected" : "Disconnected"}
                      />
                    </td>
                    <td>
                      <span className="cell-muted">— (no timestamp exposed)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ul className="markets-notes-list risk-notes">
        <li>
          <b>Single-broker runtime.</b> The M15 gateway composes ONE adapter (IBKR or Saxo) at
          startup via the `broker_adapter` / `broker_account` settings. The `GET /brokers` endpoint
          reflects that single instance.
        </li>
        <li>
          <b>No connect/disconnect API.</b> This page cannot start or stop the broker connection.
          The connection lifecycle is managed by the gateway process.
        </li>
        <li>
          <b>Simulated transports only.</b> Both IBKR and Saxo run in paper/simulation mode. Real
          TWS/Gateway (IBKR) and OpenAPI (Saxo) transports are deferred (ADR-014/015).
        </li>
      </ul>
    </Panel>
  );
}

/** Current account details from summary/balance/positions. */
function AccountDetailsSection({
  api,
  accountId,
  summary,
  summaryState,
  killSwitchActive,
  killSwitchState,
}: {
  api: { getBalance: (accountId: string) => Promise<BalanceOut> };
  accountId: string;
  summary: AccountSummaryOut | null;
  summaryState: "idle" | "loading" | "ready" | "error";
  killSwitchActive: boolean | null;
  killSwitchState: "idle" | "loading" | "ready" | "error";
}) {
  // We'll fetch balance for this display
  const [balance, setBalance] = React.useState<BalanceOut | null>(null);
  const [balanceState, setBalanceState] = React.useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [balanceError, setBalanceError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function fetchBalance() {
      setBalanceState("loading");
      setBalanceError(null);
      try {
        const data = await api.getBalance(accountId);
        if (!cancelled) {
          setBalance(data);
          setBalanceState("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setBalanceState("error");
          setBalanceError(error instanceof Error ? error.message : "Failed to load balance");
        }
      }
    }
    fetchBalance();
    return () => {
      cancelled = true;
    };
  }, [api, accountId]);

  return (
    <Panel title="Current Account" subtitle={`Account: ${accountId} (${summaryState})`}>
      {summaryState === "loading" && summary === null ? (
        <LoadingState label="Loading account summary…" />
      ) : summaryState === "error" && summary === null ? (
        <ErrorState message="Account summary could not be loaded." />
      ) : (
        <>
          {/* Equity / Exposure / P&L */}
          <div className="stats-grid" style={{ marginBottom: "var(--gap)" }}>
            <article className="stat-card">
              <div className="stat-head">
                <span>Account equity</span>
              </div>
              {summary?.equity == null ? (
                <h2 className="stat-value">—</h2>
              ) : (
                <MoneyText value={summary!.equity!} />
              )}
              <p className="stat-sub">
                Server-reported. No currency field on the summary endpoint.
              </p>
            </article>

            <article className="stat-card">
              <div className="stat-head">
                <span>Gross exposure</span>
              </div>
              {summary?.exposure == null ? (
                <h2 className="stat-value">—</h2>
              ) : (
                <MoneyText value={summary!.exposure!} />
              )}
              <p className="stat-sub">
                From <code>AccountSummaryOut.exposure</code>.
              </p>
            </article>

            <article className="stat-card">
              <div className="stat-head">
                <span>Unrealized P&L</span>
              </div>
              {Object.keys(summary?.unrealized_pnl ?? {}).length === 0 ? (
                <h2 className="stat-value">—</h2>
              ) : (
                <div className="stat-value-stack">
                  {Object.entries(summary!.unrealized_pnl).map(([currency, value]) => (
                    <div key={currency} className="stat-value-line">
                      <MoneyText value={value} currency={currency} signed />
                      <span className="stat-value-ccy">{currency}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="stat-sub">Per currency, exactly as reported — never summed.</p>
            </article>

            <article className="stat-card">
              <div className="stat-head">
                <span>Realized P&L (cumulative)</span>
              </div>
              {Object.keys(summary?.realized_pnl ?? {}).length === 0 ? (
                <h2 className="stat-value">—</h2>
              ) : (
                <div className="stat-value-stack">
                  {Object.entries(summary!.realized_pnl).map(([currency, value]) => (
                    <div key={currency} className="stat-value-line">
                      <MoneyText value={value} currency={currency} signed />
                      <span className="stat-value-ccy">{currency}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="stat-sub">
                Cumulative since the engine started, not today&rsquo;s figure. The daily value
                exists internally (<code>realized_pnl_today</code>, used by the risk engine) but is
                not exposed on this endpoint.
              </p>
            </article>
          </div>

          {/* Cash Balances */}
          <h3 className="section-title">Cash Balances</h3>
          {balanceState === "loading" ? (
            <LoadingState label="Loading balance…" />
          ) : balanceState === "error" ? (
            <ErrorState message={balanceError ?? "Balance could not be loaded."} />
          ) : balance?.cash && Object.keys(balance.cash).length > 0 ? (
            <div className="table-scroll">
              <table className="data-table balance-table">
                <thead>
                  <tr>
                    <th scope="col">Currency</th>
                    <th scope="col" className="num">
                      Total
                    </th>
                    <th scope="col" className="num">
                      Available
                    </th>
                    <th scope="col" className="num">
                      Buying Power
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(balance.cash).map(
                    ([currency, cash]: [string, CashBalanceOut]) => (
                      <tr key={currency}>
                        <td>
                          <span className="cell-primary">{currency}</span>
                        </td>
                        <td className="num">
                          <MoneyText value={cash.total} currency={currency} />
                        </td>
                        <td className="num">
                          <MoneyText value={cash.available} currency={currency} />
                        </td>
                        <td className="num">
                          {cash.buying_power === null ? (
                            <span className="cell-muted">—</span>
                          ) : (
                            <MoneyText value={cash.buying_power} currency={currency} />
                          )}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              message="No balance reported."
              detail="The balance endpoint returned no cash rows for this account."
            />
          )}

          {/* Kill Switch Status */}
          <h3 className="section-title">Risk Controls</h3>
          {killSwitchState === "loading" ? (
            <LoadingState label="Loading risk state…" />
          ) : (
            <div className="risk-control-row">
              <StatusBadge
                tone={killSwitchActive === true ? "danger" : "ok"}
                label={killSwitchActive === true ? "KILL SWITCH ACTIVE" : "Trading enabled"}
              />
              <span className="state-detail">
                Managed via <code>GET/POST /accounts/&#123;id&#125;/risk/kill-switch</code> (
                {killSwitchActive === null
                  ? "unavailable"
                  : killSwitchActive === true
                    ? "active"
                    : "inactive"}
                ).
              </span>
            </div>
          )}

          <ul className="markets-notes-list risk-notes">
            <li>
              <b>Single account scope.</b> This page shows the account currently selected in the
              header ({accountId}). The gateway serves one account per runtime; multi-account
              requires B2 (account registry endpoint).
            </li>
            <li>
              <b>No margin data.</b> The simulated adapters do not report margin requirements or
              buying power (fields are `null`). Real broker margin would require adapter
              implementation.
            </li>
            <li>
              <b>Per-currency only.</b> Cash balances are per-currency. No cross-currency
              aggregation without an FX conversion endpoint (ADR-013).
            </li>
          </ul>
        </>
      )}
    </Panel>
  );
}

/** Known broker adapter capabilities (simulated). */
function BrokerCapabilitiesSection({ currentBrokerName }: { currentBrokerName: string | null }) {
  return (
    <Panel
      title="Known Broker Capabilities"
      subtitle="Simulated adapters only — real transports deferred (ADR-014/015)"
    >
      <div className="broker-capabilities-grid">
        {KNOWN_BROKERS.map((name: string) => {
          const caps = getBrokerCapabilities(name)!;
          const isCurrent = name === currentBrokerName;
          return (
            <article key={name} className={`broker-capability-card${isCurrent ? " current" : ""}`}>
              <header className="capability-header">
                <h4>
                  {name}
                  {isCurrent && (
                    <span className="badge badge-ok" style={{ marginLeft: 8, fontSize: "8px" }}>
                      ACTIVE
                    </span>
                  )}
                </h4>
                <p className="capability-transport">
                  <span className="badge badge-muted">{caps.transport}</span> —{" "}
                  {caps.authMethods.join(", ")} auth
                </p>
              </header>

              <dl className="capability-grid">
                <dt>Asset Classes</dt>
                <dd>{caps.assetClasses.join(", ")}</dd>

                <dt>Order Types</dt>
                <dd>{caps.orderTypes.join(", ")}</dd>

                <dt>Time in Force</dt>
                <dd>{caps.timeInForce.join(", ")}</dd>

                <dt>Market Data</dt>
                <dd>
                  <ul className="capability-list">
                    {caps.marketData.realtimeQuotes && <li>Realtime quotes</li>}
                    {caps.marketData.streamingBars && <li>Streaming bars</li>}
                    {caps.marketData.historicalBars && <li>Historical bars</li>}
                    {!caps.marketData.level2 && <li className="muted">Level 2: not implemented</li>}
                  </ul>
                </dd>

                <dt>Account Data</dt>
                <dd>
                  <ul className="capability-list">
                    {caps.accountData.balance && <li>Balances</li>}
                    {caps.accountData.positions && <li>Positions</li>}
                    {caps.accountData.equity && <li>Equity</li>}
                    {!caps.accountData.margin && <li className="muted">Margin: not implemented</li>}
                  </ul>
                </dd>

                <dt>Execution</dt>
                <dd>
                  <ul className="capability-list">
                    {caps.execution.partialFills && <li>Partial fills</li>}
                    {caps.execution.orderModification && <li>Order modification</li>}
                    {caps.execution.orderCancellation && <li>Order cancellation</li>}
                    {caps.execution.reconciliation && <li>Reconciliation</li>}
                  </ul>
                </dd>

                <dt>Environments</dt>
                <dd>{caps.environments.join(", ")}</dd>

                <dt>Simulated Limitations</dt>
                <dd>
                  <ul className="capability-list limitations">
                    {caps.simulatedLimitations.map((lim: string, idx: number) => (
                      <li key={idx} className="muted">
                        {lim}
                      </li>
                    ))}
                  </ul>
                </dd>
              </dl>
            </article>
          );
        })}
      </div>

      <ul className="markets-notes-list risk-notes">
        <li>
          <b>Simulated only.</b> These capabilities describe the paper/simulation adapters used in
          development and CI. Real broker transports (IBKR TWS/Gateway, Saxo OpenAPI) are deferred
          and may have different capability sets.
        </li>
        <li>
          <b>No capability discovery endpoint.</b> This list is compiled from the adapter source
          code (`backend/brokers/ibkr/adapter.py`, `backend/brokers/saxo/adapter.py`). There is no
          `GET /brokers/&#123;name&#125;/capabilities` API.
        </li>
        <li>
          <b>Active broker highlighted.</b> The broker marked "ACTIVE" is the one currently bound to
          the gateway (from `GET /brokers`).
        </li>
      </ul>
    </Panel>
  );
}

/** Honest gap report. */
function BackendGapsSection() {
  return (
    <Panel
      title="Not Supported by This Backend"
      subtitle="Exact gaps behind every missing control or “—” value on this page"
    >
      <div className="table-scroll">
        <table className="data-table risk-gap-table">
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">Effect on This Page</th>
              <th scope="col">Required Backend Work</th>
            </tr>
          </thead>
          <tbody>
            {BACKEND_GAPS.map((gap) => (
              <tr key={gap.capability}>
                <td>
                  <span className="cell-primary">{gap.capability}</span>
                </td>
                <td>{gap.effect}</td>
                <td>{gap.requiredWork}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="markets-notes-list risk-notes">
        <li>
          <b>Informational on this page:</b> the live broker connection status, the current
          account&apos;s equity/exposure/P&L/balances, the kill-switch state, and the compiled
          adapter capabilities. They REPORT what the server does or reports.
        </li>
        <li>
          <b>Enforced by the backend:</b> the risk engine (8 pre-trade rules + kill switch), the
          execution engine (order lifecycle, reconciliation), and the portfolio service (P&L,
          positions). The single-broker composition is a runtime configuration fact.
        </li>
        <li>
          <b>No automatic action exists here:</b> this page never connects, disconnects, stores
          credentials, links accounts, or switches brokers. The single write it could perform is the
          kill switch (shown on the Risk Management page).
        </li>
      </ul>
    </Panel>
  );
}

export { BrokerConnectionsPage as default };
