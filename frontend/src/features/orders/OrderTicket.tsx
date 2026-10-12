/**
 * Order ticket (M11): risk-gated order entry.
 *
 * Safety design (mirrors the engine's guarantees, TS-003/004/005):
 * - Every order entry carries a client-generated `idempotency_key`. The key is
 *   REGENERATED after a definitive outcome (201/200 success, 400 validation,
 *   422 risk rejection, 409 conflict) but KEPT across uncertain outcomes
 *   (network failure, 5xx, 504 timeout) so re-submitting replays idempotently
 *   on the server instead of creating a duplicate order.
 * - Submit is disabled while a request is in flight (no double submit).
 * - An optional server-side risk dry-run (`POST /risk/evaluate`) previews the
 *   M6 decision without creating an order.
 * - The ticket performs input-only validation (shape of fields); ALL trading
 *   validation stays server-side (M1 domain + M6 risk gate).
 */

import { useMemo, useState } from "react";

import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState } from "../../components/Status";
import { isApiError } from "../../services/api";
import { useServices } from "../../services/context";
import { accountStore, ordersStore, uiStore } from "../../stores";
import { userCanTrade } from "../../stores/authStore";
import { useStoreState } from "../../stores/store";
import {
  ASSET_CLASSES,
  EXCHANGES,
  ORDER_TYPES,
  TIME_IN_FORCE,
  type OrderCreateIn,
} from "../../types/api";
import { newIdempotencyKey } from "../../utils/ids";
import { parseIdentifiers, validateTicket } from "./ticketValidation";

interface TicketOutcome {
  kind: "success" | "risk_rejected" | "error";
  message: string;
  violations?: { rule: string; reason: string | null; data_unavailable: boolean }[];
  replayed?: boolean;
}

export function OrderTicket() {
  const { api } = useServices();
  const { accountId } = useStoreState(uiStore);
  const { killSwitchActive } = useStoreState(accountStore);

  const [symbol, setSymbol] = useState("");
  const [assetClass, setAssetClass] = useState("EQUITY");
  const [currency, setCurrency] = useState("USD");
  const [exchange, setExchange] = useState("UNKNOWN");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState("LIMIT");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [tif, setTif] = useState("DAY");
  const [identifiersRaw, setIdentifiersRaw] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [pending, setPending] = useState<"submit" | "dryrun" | null>(null);
  const [outcome, setOutcome] = useState<TicketOutcome | null>(null);

  const needsLimit = orderType === "LIMIT" || orderType === "STOP_LIMIT";
  const needsStop = orderType === "STOP" || orderType === "STOP_LIMIT";

  const validationError = useMemo(() => {
    const ticketError = validateTicket({
      symbol,
      currency,
      quantity,
      limitPrice,
      stopPrice,
      needsLimit,
      needsStop,
    });
    if (ticketError !== null) return ticketError;
    if (parseIdentifiers(identifiersRaw) === null) {
      return "Identifiers must be KEY=VALUE pairs (comma-separated), e.g. SAXO_UIC=211.";
    }
    return null;
  }, [symbol, currency, quantity, limitPrice, stopPrice, needsLimit, needsStop, identifiersRaw]);

  // UX-only gate (the server rejects viewer writes anyway — M12 tests cover
  // it): viewers see an explicit read-only notice instead of the form. This
  // sits AFTER every hook call so hook order is render-invariant.
  if (!userCanTrade()) {
    return (
      <Panel title="Order Ticket">
        <EmptyState
          message="Read-only access."
          detail="Your role does not include order submission. All trading actions are enforced server-side."
        />
      </Panel>
    );
  }

  function buildOrder(): OrderCreateIn {
    return {
      account_id: accountId,
      instrument: {
        symbol: symbol.trim().toUpperCase(),
        asset_class: assetClass,
        currency: currency.trim().toUpperCase(),
        exchange: exchange === "UNKNOWN" ? "UNKNOWN" : exchange,
        identifiers: parseIdentifiers(identifiersRaw) ?? {},
      },
      side,
      order_type: orderType,
      quantity: quantity.trim(),
      limit_price: limitPrice.trim() === "" ? null : limitPrice.trim(),
      stop_price: stopPrice.trim() === "" ? null : stopPrice.trim(),
      time_in_force: tif,
      idempotency_key: idempotencyKey,
    };
  }

  function resetInstrumentFields() {
    setSymbol("");
    setQuantity("");
    setLimitPrice("");
    setStopPrice("");
  }

  async function submit() {
    if (validationError !== null || pending !== null) return;
    setPending("submit");
    setOutcome(null);
    try {
      // Idempotency: replay (200) and create (201) look identical here.
      const order = await api.createOrder(buildOrder());
      // The WS order.submitted event will land too; upserting here makes the
      // ticket result instant and is a no-op when the event arrives (dedupe).
      ordersStore.update((s) => ({
        ...s,
        byId: { ...s.byId, [order.client_order_id]: order },
        ids: s.byId[order.client_order_id] ? s.ids : [order.client_order_id, ...s.ids],
      }));
      setOutcome({
        kind: "success",
        message: `Order ${order.status} — ${order.side} ${order.quantity} ${order.symbol}`,
      });
      setIdempotencyKey(newIdempotencyKey()); // definitive outcome → new key
      resetInstrumentFields();
    } catch (error) {
      handleSubmitError(error);
    } finally {
      setPending(null);
    }
  }

  function handleSubmitError(error: unknown) {
    if (!isApiError(error)) {
      setOutcome({ kind: "error", message: "Unexpected submission failure." });
      return;
    }
    switch (error.kind) {
      case "risk":
        // Definitive rejection: nothing was created → safe to rotate the key.
        setIdempotencyKey(newIdempotencyKey());
        setOutcome({
          kind: "risk_rejected",
          message: "Order rejected by risk controls.",
          violations: error.violations,
        });
        break;
      case "validation":
      case "conflict":
        setIdempotencyKey(newIdempotencyKey());
        setOutcome({ kind: "error", message: error.userMessage });
        break;
      case "timeout":
      case "connection_lost":
      case "network":
      case "server":
      case "broker_error":
        // UNCERTAIN outcome: the order may exist server-side. Keep the key so
        // pressing Submit again replays idempotently (HTTP 200, same order).
        setOutcome({
          kind: "error",
          message: `${error.userMessage} Submission key retained: submitting again is a safe idempotent retry.`,
        });
        break;
      default:
        setOutcome({ kind: "error", message: error.userMessage });
    }
  }

  async function dryRun() {
    if (validationError !== null || pending !== null) return;
    setPending("dryrun");
    setOutcome(null);
    try {
      const decision = await api.evaluateRisk(accountId, buildOrder());
      setOutcome(
        decision.approved
          ? { kind: "success", message: "Risk check passed — the order would be approved." }
          : {
              kind: "risk_rejected",
              message: "Risk check would reject this order.",
              violations: decision.violations,
            },
      );
    } catch (error) {
      setOutcome({
        kind: "error",
        message: isApiError(error) ? error.userMessage : "Risk check failed.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <Panel
      title="Order Ticket"
      actions={<span className={`side-indicator ${side === "BUY" ? "pos" : "neg"}`}>{side}</span>}
    >
      {killSwitchActive ? (
        <p className="form-error" role="alert">
          Kill switch is ACTIVE for {accountId} — the risk engine will reject all new orders.
        </p>
      ) : null}
      <form
        className="ticket-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="ticket-grid">
          <label className="field">
            <span>Symbol</span>
            <input
              className="input"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="AAPL"
              maxLength={20}
            />
          </label>
          <label className="field">
            <span>Asset class</span>
            <select
              className="input"
              value={assetClass}
              onChange={(e) => setAssetClass(e.target.value)}
            >
              {ASSET_CLASSES.map((ac) => (
                <option key={ac} value={ac}>
                  {ac}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Currency</span>
            <input
              className="input input-ccy"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
            />
          </label>
          <label className="field">
            <span>Exchange</span>
            <select
              className="input"
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
            >
              {EXCHANGES.map((ex) => (
                <option key={ex} value={ex}>
                  {ex}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="field field-side">
            <span>Side</span>
            <div className="side-toggle" role="radiogroup" aria-label="Order side">
              {(["BUY", "SELL"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={side === s}
                  className={`btn btn-side ${side === s ? (s === "BUY" ? "btn-buy" : "btn-sell") : "btn-secondary"}`}
                  onClick={() => setSide(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>Type</span>
            <select
              className="input"
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
            >
              {ORDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Quantity</span>
            <input
              className="input"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="10"
            />
          </label>
          {needsLimit ? (
            <label className="field">
              <span>Limit price</span>
              <input
                className="input"
                inputMode="decimal"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="150.25"
              />
            </label>
          ) : null}
          {needsStop ? (
            <label className="field">
              <span>Stop price</span>
              <input
                className="input"
                inputMode="decimal"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                placeholder="149.00"
              />
            </label>
          ) : null}
          <label className="field">
            <span>Time in force</span>
            <select className="input" value={tif} onChange={(e) => setTif(e.target.value)}>
              {TIME_IN_FORCE.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Identifiers (optional)</span>
            <input
              className="input"
              value={identifiersRaw}
              onChange={(e) => setIdentifiersRaw(e.target.value)}
              placeholder="SAXO_UIC=211"
              maxLength={256}
            />
          </label>
        </div>

        {validationError ? (
          <p className="form-error" role="alert">
            {validationError}
          </p>
        ) : null}

        {outcome ? (
          <div
            className={`ticket-outcome ticket-outcome-${outcome.kind}`}
            role={outcome.kind === "success" ? "status" : "alert"}
          >
            <p>{outcome.message}</p>
            {outcome.violations && outcome.violations.length > 0 ? (
              <ul className="violation-list">
                {outcome.violations.map((v, i) => (
                  <li key={`${v.rule}-${i}`}>
                    <StatusBadge tone="danger" label={v.rule} />{" "}
                    {v.reason ?? (v.data_unavailable ? "required data unavailable" : "")}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="ticket-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={validationError !== null || pending !== null}
            onClick={() => void dryRun()}
          >
            {pending === "dryrun" ? "Checking…" : "Check risk"}
          </button>
          <button
            type="submit"
            className={`btn ${side === "BUY" ? "btn-buy" : "btn-sell"}`}
            disabled={validationError !== null || pending !== null}
          >
            {pending === "submit" ? "Submitting…" : `Submit ${side}`}
          </button>
        </div>
        <p className="ticket-key" title="Idempotency key (kept across uncertain retries)">
          key: {idempotencyKey.slice(0, 8)}…
        </p>
      </form>
    </Panel>
  );
}
