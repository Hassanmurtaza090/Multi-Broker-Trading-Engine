/**
 * Order ticket (M11 → M1 Figma "Quick order" card).
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
 *
 * M1 Figma mapping: the design's quick-order card structure (asset display,
 * Buy/Sell segmented toggle, order-type segmented control, amount + estimated
 * total, limit price field, summary, review button). The design's hardcoded
 * "Est. fee $4.92" is NOT reproduced — no fee data exists on the API; the
 * "Est. total" is computed EXACTLY (BigInt decimal multiply) from the user's
 * quantity and the REAL last quote of the entered instrument, and shows "—"
 * whenever no live quote exists.
 */

import { useMemo, useState } from "react";

import { Panel } from "../../components/Panel";
import { SegmentedControl } from "../../components/SegmentedControl";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState } from "../../components/Status";
import { isApiError } from "../../services/api";
import { useServices } from "../../services/context";
import { accountStore, marketStore, ordersStore, uiStore } from "../../stores";
import { userCanTrade } from "../../stores/authStore";
import { useStoreState } from "../../stores/store";
import {
  ASSET_CLASSES,
  EXCHANGES,
  ORDER_TYPES,
  TIME_IN_FORCE,
  type OrderCreateIn,
} from "../../types/api";
import { formatDecimal, isValidDecimalInput, multiplyDecimal } from "../../utils/decimal";
import { instrumentKey, instrumentLabel } from "../../utils/instrument";
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
  const { accountId, selectedInstrument } = useStoreState(uiStore);
  const { killSwitchActive, balance } = useStoreState(accountStore);
  const { quotes } = useStoreState(marketStore);

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

  // The REAL quote for the instrument the user is actually entering (the
  // watchlist's watched instruments only — quotes are fetched for those).
  const ticketQuote = useMemo(() => {
    const descriptor = {
      symbol: symbol.trim().toUpperCase(),
      asset_class: assetClass,
      currency: currency.trim().toUpperCase(),
      exchange,
    };
    return quotes[instrumentKey(descriptor)] ?? null;
  }, [quotes, symbol, assetClass, currency, exchange]);

  const selectedQuote = useMemo(
    () =>
      selectedInstrument !== null ? (quotes[instrumentKey(selectedInstrument)] ?? null) : null,
    [quotes, selectedInstrument],
  );

  // Exact display estimate: quantity × live last price (BigInt strings — no
  // floats). "—" when either factor is missing/invalid. Est. fee: no API data.
  const estTotal = useMemo(() => {
    if (!isValidDecimalInput(quantity)) return null;
    const last = ticketQuote?.last ?? null;
    if (last === null) return null;
    return multiplyDecimal(quantity, last);
  }, [quantity, ticketQuote]);

  const availableToTrade = useMemo(() => {
    if (balance === null) return null;
    const entries = balance.cash.filter((entry) => entry.buying_power !== null);
    if (entries.length !== 1) return null;
    return { value: entries[0].buying_power as string, currency: entries[0].currency };
  }, [balance]);

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

  function applySelectedInstrument() {
    const descriptor = selectedInstrument;
    if (descriptor === null) return;
    setSymbol(descriptor.symbol);
    setAssetClass(descriptor.asset_class);
    setCurrency(descriptor.currency);
    setExchange(descriptor.exchange);
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
      subtitle="Place an order across any broker"
      className="panel-flush"
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
        <div className="asset-select">
          <div className="asset-coin" aria-hidden="true">
            {(selectedInstrument?.symbol ?? symbol ?? "?").charAt(0).toUpperCase()}
          </div>
          <div className="asset-main">
            <small>Instrument</small>
            <strong>
              {selectedInstrument !== null ? instrumentLabel(selectedInstrument) : "Free entry"}
            </strong>
          </div>
          <span className="asset-price">
            {selectedQuote !== null ? formatDecimal(selectedQuote.last) : "—"}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={applySelectedInstrument}
            disabled={selectedInstrument === null}
            title="Copy the instrument selected in Markets into the ticket"
          >
            Use
          </button>
        </div>

        <div className="ticket-grid">
          <label className="field">
            <span>Symbol</span>
            <input
              id="ticket-symbol"
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
        </div>

        <div className="ticket-fields">
          <div className="field">
            <span>Side</span>
            <SegmentedControl
              aria-label="Order side"
              name="side"
              tone="side"
              value={side}
              onChange={setSide}
              options={[
                { value: "BUY", label: "Buy" },
                { value: "SELL", label: "Sell" },
              ]}
            />
          </div>

          <div className="field">
            <span>Type</span>
            <SegmentedControl
              aria-label="Type"
              name="type"
              value={orderType}
              onChange={setOrderType}
              options={ORDER_TYPES.map((type) => ({ value: type, label: type }))}
            />
          </div>

          <div className="input-row">
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
            <label className="field">
              <span>Est. total</span>
              <input
                className="input"
                value={estTotal !== null ? formatDecimal(estTotal) : "—"}
                readOnly
                aria-label="Estimated total (quantity × live last price)"
                tabIndex={-1}
              />
            </label>
          </div>

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

        <div className="order-summary">
          <span>
            Available to trade{" "}
            <b>
              {availableToTrade !== null
                ? `${formatDecimal(availableToTrade.value)} ${availableToTrade.currency}`
                : "—"}
            </b>
          </span>
          <span>
            Instrument price <b>{ticketQuote !== null ? formatDecimal(ticketQuote.last) : "—"}</b>
          </span>
        </div>

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
            className={`btn review-btn ${side === "BUY" ? "buy" : "sell"}`}
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
