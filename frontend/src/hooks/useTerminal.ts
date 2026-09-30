/**
 * Terminal orchestration hook (M11) — the single wiring point between the M10
 * gateway and the UI stores.
 *
 * Mounted ONCE in <App/>. Responsibilities:
 * - initial REST load (brokers, orders, positions, balance, summary, kill switch)
 * - WebSocket lifecycle (connect on mount, close on unmount, reconnect handled
 *   by TerminalSocket) and event routing into stores
 * - REST resync after every (re)connect — the ADR-016 at-least-once recovery
 * - account-switch resync; debounced portfolio refresh after fills
 * - REST quote polling for watchlisted instruments (M10 has no subscribe API)
 * - 1 Hz clock tick so staleness indicators age in real time (TS-007)
 *
 * Contains NO business logic — it only moves data between the API and stores.
 */

import { useEffect } from "react";

import { config } from "../config";
import type { ApiClient } from "../services/api";
import { ApiError, isApiError } from "../services/api";
import { TerminalSocket, type ConnectionState, type WebSocketFactory } from "../services/ws";
import {
  accountStore,
  brokersStore,
  connectionStore,
  marketStore,
  ordersStore,
  positionsStore,
  riskStore,
  uiStore,
} from "../stores";
import { applyBrokerEvent } from "../stores/brokersStore";
import { applyQuoteJ, applyQuoteOut, setQuoteFetchState } from "../stores/marketStore";
import { balanceFromJ, orderFromJ } from "../stores/mappers";
import { replaceOrders, upsertOrder } from "../stores/ordersStore";
import { applyPositionEvent, replacePositions } from "../stores/positionsStore";
import { pushViolation } from "../stores/riskStore";
import type {
  AccountEventPayload,
  BalanceEventPayload,
  BrokerEventPayload,
  EventEnvelopeJ,
  OrderEventPayload,
  PositionEventPayload,
  QuoteEventPayload,
  RiskViolationPayload,
} from "../types/events";
import { isOrderEvent, isPositionEvent } from "../types/events";
import { instrumentKey } from "../utils/instrument";

const POSITION_RESYNC_DEBOUNCE_MS = 250;

export interface TerminalDeps {
  api: ApiClient;
  socketFactory?: WebSocketFactory;
  wsUrl?: string;
  quotePollMs?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Normalize a rejected promise to `Error` (keeps promise unions typed). */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function currentAccount(): string {
  return uiStore.getSnapshot().accountId;
}

export function useTerminal({ api, socketFactory, wsUrl, quotePollMs }: TerminalDeps): void {
  useEffect(() => {
    const baseWsUrl = wsUrl ?? config.wsUrl;
    // Single-use WS tickets (M12): a FRESH ticket is fetched before EVERY
    // connection attempt — tickets never replay across reconnects, and the
    // ticket request itself runs through the ApiClient's 401-refresh path.
    const wsUrlProvider = async (): Promise<string> => {
      const { ticket } = await api.createWsTicket();
      return `${baseWsUrl}?topics=all&ticket=${encodeURIComponent(ticket)}`;
    };
    let disposed = false;
    let reconnectAttempt = 0;
    let portfolioResyncTimer: ReturnType<typeof setTimeout> | null = null;

    // --- REST resync (authoritative read models; ADR-016 recovery) -------------

    async function resyncBrokers(): Promise<void> {
      brokersStore.update((s) => ({ ...s, loadState: "loading" }));
      try {
        const brokers = await api.listBrokers();
        if (disposed) return;
        brokersStore.update((s) => ({ ...s, brokers, loadState: "ready", errorMessage: null }));
      } catch (error) {
        if (disposed) return;
        brokersStore.update((s) => ({ ...s, loadState: "error", errorMessage: messageOf(error) }));
      }
    }

    async function resyncOrders(): Promise<void> {
      ordersStore.update((s) => ({ ...s, loadState: "loading" }));
      try {
        const orders = await api.listOrders();
        if (disposed) return;
        ordersStore.update((s) => replaceOrders(s, orders));
      } catch (error) {
        if (disposed) return;
        ordersStore.update((s) => ({ ...s, loadState: "error", errorMessage: messageOf(error) }));
      }
    }

    async function resyncPositions(accountId: string): Promise<void> {
      positionsStore.update((s) => ({ ...s, loadState: "loading" }));
      try {
        const positions = await api.listPositions(accountId);
        if (disposed) return;
        positionsStore.update((s) => replacePositions(s, positions));
      } catch (error) {
        if (disposed) return;
        positionsStore.update((s) => ({
          ...s,
          loadState: "error",
          errorMessage: messageOf(error),
        }));
      }
    }

    async function resyncAccountData(accountId: string): Promise<void> {
      accountStore.update((s) => ({
        ...s,
        balanceState: "loading",
        summaryState: "loading",
        killSwitchState: "loading",
      }));
      const [balance, summary, killSwitch] = await Promise.all([
        api.getBalance(accountId).catch(asError),
        api.getAccountSummary(accountId).catch(asError),
        api.getKillSwitch(accountId).catch(asError),
      ]);
      if (disposed) return;
      accountStore.update((s) => ({
        ...s,
        // 404 balance = "no data reported yet" (a legitimate empty state).
        balance:
          balance instanceof Error
            ? isApiError(balance) && balance.kind === "not_found"
              ? null
              : s.balance
            : balance,
        balanceState:
          balance instanceof ApiError && balance.kind === "not_found"
            ? "missing"
            : balance instanceof Error
              ? "error"
              : "ready",
        summary: summary instanceof Error ? s.summary : summary,
        summaryState: summary instanceof Error ? "error" : "ready",
        killSwitchActive: killSwitch instanceof Error ? s.killSwitchActive : killSwitch.active,
        killSwitchState: killSwitch instanceof Error ? "error" : "ready",
        errorMessage:
          summary instanceof Error
            ? messageOf(summary)
            : balance instanceof ApiError && balance.kind !== "not_found"
              ? messageOf(balance)
              : null,
      }));
    }

    function resyncAll(accountId: string): void {
      void resyncBrokers();
      void resyncOrders();
      void resyncPositions(accountId);
      void resyncAccountData(accountId);
    }

    function schedulePortfolioResync(): void {
      // Fills arrive in bursts (partial fills, balance reactions); collapse
      // into one REST resync for REST-only fields (market price, server
      // staleness, summary).
      if (portfolioResyncTimer !== null) clearTimeout(portfolioResyncTimer);
      portfolioResyncTimer = setTimeout(() => {
        portfolioResyncTimer = null;
        if (disposed) return;
        void resyncPositions(currentAccount());
        void resyncAccountData(currentAccount());
      }, POSITION_RESYNC_DEBOUNCE_MS);
    }

    // --- WS event routing -------------------------------------------------------

    function onEvent(envelope: EventEnvelopeJ): void {
      if (disposed) return;
      connectionStore.update((s) => ({ ...s, lastEventAt: Date.now() }));
      const type = envelope.event_type;
      if (isOrderEvent(type)) {
        // Order events carry the full order snapshot — an idempotent upsert.
        const payload = envelope.payload as OrderEventPayload;
        ordersStore.update((s) => upsertOrder(s, orderFromJ(payload.order)));
        return;
      }
      if (isPositionEvent(type)) {
        // The terminal shows one account; other accounts' events are ignored.
        const payload = envelope.payload as PositionEventPayload;
        if (payload.position.account_id !== currentAccount()) return;
        positionsStore.update((s) =>
          applyPositionEvent(s, payload.position, type === "position.closed"),
        );
        schedulePortfolioResync();
        return;
      }
      switch (type) {
        case "balance.updated": {
          const payload = envelope.payload as BalanceEventPayload;
          if (payload.balance.account_id !== currentAccount()) return;
          accountStore.update((s) => ({
            ...s,
            balance: balanceFromJ(payload.balance),
            balanceState: "ready",
          }));
          schedulePortfolioResync(); // balances co-move with equity/summary
          return;
        }
        case "market.quote.updated": {
          const payload = envelope.payload as QuoteEventPayload;
          marketStore.update((s) => applyQuoteJ(s, payload.quote, Date.now()));
          return;
        }
        case "broker.connected":
        case "broker.disconnected": {
          const payload = envelope.payload as BrokerEventPayload;
          brokersStore.update((s) =>
            applyBrokerEvent(s, payload.broker, type === "broker.connected"),
          );
          if (type === "broker.connected") resyncAll(currentAccount());
          return;
        }
        case "account.updated": {
          const payload = envelope.payload as AccountEventPayload;
          if (payload.account_id === currentAccount()) void resyncAccountData(currentAccount());
          return;
        }
        case "risk.violation": {
          const payload = envelope.payload as RiskViolationPayload;
          riskStore.update((s) => pushViolation(s, envelope.event_id, envelope.timestamp, payload));
          return;
        }
        default:
          return; // market.tick/bar updates: not rendered by the terminal UI
      }
    }

    // --- socket lifecycle --------------------------------------------------------

    const socket = new TerminalSocket({
      url: wsUrlProvider,
      onEvent,
      baseDelayMs: config.wsReconnect.baseDelayMs,
      maxDelayMs: config.wsReconnect.maxDelayMs,
      maxAttempts: config.wsReconnect.maxAttempts,
      pingIntervalMs: config.wsPingIntervalMs,
      factory: socketFactory,
      onStateChange: (state: ConnectionState) => {
        if (disposed) return;
        if (state === "RECONNECTING") reconnectAttempt += 1;
        if (state === "CONNECTED") reconnectAttempt = 0;
        connectionStore.update((s) => ({
          ...s,
          state,
          attempt: reconnectAttempt,
          fatalReason: state === "CONNECTED" ? null : s.fatalReason,
        }));
      },
      onResync: () => {
        if (!disposed) resyncAll(currentAccount());
      },
      onFatal: (reason) => {
        if (disposed) return;
        connectionStore.update((s) => ({ ...s, fatalReason: reason, state: "DISCONNECTED" }));
      },
    });
    socket.connect();
    // Initial load must not depend on the WS succeeding: REST read models are
    // authoritative — fetch them immediately, and again after each (re)connect.
    resyncAll(currentAccount());

    // --- watchlist quote polling (no M10 subscribe endpoint — documented) -----

    async function pollQuotes(): Promise<void> {
      const { watchlist } = marketStore.getSnapshot();
      for (const descriptor of watchlist) {
        const key = instrumentKey(descriptor);
        marketStore.update((s) => setQuoteFetchState(s, key, "loading"));
        try {
          const quote = await api.getQuote({
            symbol: descriptor.symbol,
            asset_class: descriptor.asset_class,
            currency: descriptor.currency,
            exchange: descriptor.exchange === "UNKNOWN" ? undefined : descriptor.exchange,
          });
          if (disposed) return;
          marketStore.update((s) => applyQuoteOut(s, descriptor, quote));
        } catch (error) {
          if (disposed) return;
          const fetchState =
            error instanceof ApiError && error.kind === "not_found" ? "missing" : "error";
          marketStore.update((s) => setQuoteFetchState(s, key, fetchState));
        }
      }
    }

    const quoteTimer = setInterval(() => void pollQuotes(), quotePollMs ?? config.quotePollMs);
    const clockTimer = setInterval(
      () => marketStore.update((s) => ({ ...s, clockTick: Date.now() })),
      1000,
    );

    return () => {
      disposed = true;
      if (portfolioResyncTimer !== null) clearTimeout(portfolioResyncTimer);
      clearInterval(quoteTimer);
      clearInterval(clockTimer);
      socket.close();
    };
  }, [api, socketFactory, wsUrl, quotePollMs]);

  // Account switching: clear account-scoped state, then resync. A second
  // switch during an in-flight resync discards the stale result.
  useEffect(() => {
    let current = currentAccount();
    const unsubscribe = uiStore.subscribe(() => {
      const next = currentAccount();
      if (next === current) return;
      current = next;
      accountStore.reset();
      positionsStore.reset();
      void resyncAccount(next);
    });

    async function resyncAccount(accountId: string): Promise<void> {
      positionsStore.update((s) => ({ ...s, loadState: "loading" }));
      const [positions, balance, summary, killSwitch] = await Promise.all([
        api.listPositions(accountId).catch(asError),
        api.getBalance(accountId).catch(asError),
        api.getAccountSummary(accountId).catch(asError),
        api.getKillSwitch(accountId).catch(asError),
      ]);
      if (uiStore.getSnapshot().accountId !== accountId) return;
      if (positions instanceof Error) {
        positionsStore.update((s) => ({
          ...s,
          loadState: "error",
          errorMessage: messageOf(positions),
        }));
      } else {
        positionsStore.update((s) => replacePositions(s, positions));
      }
      accountStore.update((s) => ({
        ...s,
        balance: balance instanceof Error ? null : balance,
        balanceState:
          balance instanceof ApiError && balance.kind === "not_found"
            ? "missing"
            : balance instanceof Error
              ? "error"
              : "ready",
        summary: summary instanceof Error ? null : summary,
        summaryState: summary instanceof Error ? "error" : "ready",
        killSwitchActive: killSwitch instanceof Error ? null : killSwitch.active,
        killSwitchState: killSwitch instanceof Error ? "error" : "ready",
        errorMessage: null,
      }));
    }

    return unsubscribe;
  }, [api]);
}
