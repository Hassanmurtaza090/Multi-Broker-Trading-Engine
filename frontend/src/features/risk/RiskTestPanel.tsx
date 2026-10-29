/**
 * Pre-trade risk check (FE-M8) — a dry run against the REAL risk gate.
 *
 * What this does: `POST /accounts/{id}/risk/evaluate` runs the same
 * `RiskEngine.evaluate` the order path uses and returns the decision WITHOUT
 * creating an order (verified in `backend/api/rest.py`). It is the only way a
 * user can see the gate's opinion before submitting.
 *
 * Safety boundaries, deliberately enforced in code:
 * - This component imports no order-submission function. The client's
 *   order-submission method is never referenced here, so "checking risk" can
 *   never place an order.
 * - Requires `orders:write` on the server; viewers get 403, and the form is
 *   replaced with an explanation (UX gate only — the server is authoritative).
 * - The submit button is disabled while a request is in flight, so a double
 *   click cannot produce two overlapping evaluations.
 * - An "approved" result is a statement about the gate's rules at one instant,
 *   not a guarantee: the payload says so, and data-unavailable rejections are
 *   surfaced distinctly from limit breaches.
 */

import { useMemo, useState } from "react";

import { Panel } from "../../components/Panel";
import { SegmentedControl } from "../../components/SegmentedControl";
import { EmptyState } from "../../components/Status";
import { StatusBadge } from "../../components/StatusBadge";
import { isApiError } from "../../services/api";
import { useServices } from "../../services/context";
import { uiStore } from "../../stores";
import { userCanTrade } from "../../stores/authStore";
import { useStoreState } from "../../stores/store";
import {
  ASSET_CLASSES,
  EXCHANGES,
  ORDER_SIDES,
  ORDER_TYPES,
  type OrderCreateIn,
  type RuleResultOut,
} from "../../types/api";
import { validateTicket } from "../orders/ticketValidation";

type CheckOutcome =
  | { kind: "approved" }
  | { kind: "rejected"; violations: RuleResultOut[] }
  | { kind: "error"; message: string };

export function RiskTestPanel() {
  const { api } = useServices();
  const { accountId } = useStoreState(uiStore);

  const [symbol, setSymbol] = useState("");
  const [assetClass, setAssetClass] = useState<string>("EQUITY");
  const [currency, setCurrency] = useState("USD");
  const [exchange, setExchange] = useState("UNKNOWN");
  const [side, setSide] = useState<string>("BUY");
  const [orderType, setOrderType] = useState<string>("LIMIT");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);

  const needsLimit = orderType === "LIMIT" || orderType === "STOP_LIMIT";
  const needsStop = orderType === "STOP" || orderType === "STOP_LIMIT";

  const validationError = useMemo(
    () =>
      validateTicket({ symbol, currency, quantity, limitPrice, stopPrice, needsLimit, needsStop }),
    [symbol, currency, quantity, limitPrice, stopPrice, needsLimit, needsStop],
  );

  function buildOrder(): OrderCreateIn {
    return {
      account_id: accountId,
      instrument: {
        symbol: symbol.trim().toUpperCase(),
        asset_class: assetClass,
        currency: currency.trim().toUpperCase(),
        exchange,
        identifiers: {},
      },
      side,
      order_type: orderType,
      quantity: quantity.trim(),
      limit_price: limitPrice.trim() === "" ? null : limitPrice.trim(),
      stop_price: stopPrice.trim() === "" ? null : stopPrice.trim(),
      time_in_force: "DAY",
      idempotency_key: null,
    };
  }

  async function runCheck() {
    if (validationError !== null || pending) return;
    setPending(true);
    setOutcome(null);
    try {
      const decision = await api.evaluateRisk(accountId, buildOrder());
      setOutcome(
        decision.approved
          ? { kind: "approved" }
          : { kind: "rejected", violations: decision.violations },
      );
    } catch (error) {
      setOutcome({
        kind: "error",
        message: isApiError(error) ? error.userMessage : "The risk check could not be completed.",
      });
    } finally {
      setPending(false);
    }
  }

  // UX-only gate: the endpoint requires `orders:write`, so a viewer's request
  // would be rejected by the server anyway.
  if (!userCanTrade()) {
    return (
      <Panel
        title="Pre-trade risk check"
        subtitle="Dry run against the live risk gate — no order is created"
      >
        <EmptyState
          message="Read-only access."
          detail="Evaluating an order requires order-submission permission. The risk gate itself runs server-side for every order regardless of this page."
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Pre-trade risk check"
      subtitle="Dry run against the live risk gate — no order is created, nothing is sent to the broker"
    >
      <div className="ticket-grid">
        <label className="field">
          <span>Symbol</span>
          <input
            className="input"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            placeholder="AAPL"
            maxLength={20}
          />
        </label>
        <label className="field">
          <span>Asset class</span>
          <select
            className="input"
            value={assetClass}
            onChange={(event) => setAssetClass(event.target.value)}
          >
            {ASSET_CLASSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Currency</span>
          <input
            className="input input-ccy"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            maxLength={3}
          />
        </label>
        <label className="field">
          <span>Exchange</span>
          <select
            className="input"
            value={exchange}
            onChange={(event) => setExchange(event.target.value)}
          >
            {EXCHANGES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ticket-fields">
        <div className="field">
          <span>Side</span>
          <SegmentedControl
            aria-label="Side"
            name="risk-side"
            tone="side"
            value={side}
            onChange={setSide}
            options={ORDER_SIDES.map((value) => ({ value, label: value }))}
          />
        </div>

        <div className="field">
          <span>Type</span>
          <SegmentedControl
            aria-label="Type"
            name="risk-type"
            value={orderType}
            onChange={setOrderType}
            options={ORDER_TYPES.map((value) => ({ value, label: value }))}
          />
        </div>

        <label className="field">
          <span>Quantity</span>
          <input
            className="input"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
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
              onChange={(event) => setLimitPrice(event.target.value)}
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
              onChange={(event) => setStopPrice(event.target.value)}
              placeholder="149.00"
            />
          </label>
        ) : null}
      </div>

      {validationError ? (
        <p className="form-error" role="alert">
          {validationError}
        </p>
      ) : null}

      {outcome !== null ? <CheckResult outcome={outcome} /> : null}

      <div className="ticket-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void runCheck()}
          disabled={pending || validationError !== null}
        >
          {pending ? "Checking…" : "Run risk check"}
        </button>
        <span className="state-detail risk-inline-note">
          Evaluates the order shape only — this button cannot submit an order.
        </span>
      </div>
    </Panel>
  );
}

function CheckResult({ outcome }: { outcome: CheckOutcome }) {
  if (outcome.kind === "approved") {
    return (
      <div className="ticket-outcome ticket-outcome-success" role="status">
        <p>
          <StatusBadge tone="ok" label="Would be approved" /> No configured rule rejects this order
          as entered.
        </p>
        <p className="state-detail">
          This is the gate&apos;s decision at this instant, not a guarantee: balances, marks, order
          counts and the kill switch can change before a real submission is evaluated again.
        </p>
      </div>
    );
  }

  if (outcome.kind === "error") {
    return (
      <div className="ticket-outcome ticket-outcome-error" role="alert">
        <p>{outcome.message}</p>
      </div>
    );
  }

  const unavailable = outcome.violations.filter((violation) => violation.data_unavailable);
  const breached = outcome.violations.filter((violation) => !violation.data_unavailable);

  return (
    <div className="ticket-outcome ticket-outcome-risk_rejected" role="alert">
      <p>This order would be rejected by the risk gate.</p>
      {breached.length > 0 ? (
        <ul className="violation-list">
          {breached.map((violation, index) => (
            <li key={`${violation.rule}-${index}`}>
              <StatusBadge tone="danger" label={violation.rule} />{" "}
              {violation.reason ?? "Limit breached."}
            </li>
          ))}
        </ul>
      ) : null}
      {unavailable.length > 0 ? (
        <div className="risk-unavailable-rejections">
          <p className="state-detail">
            <b>Rejected because required data is unavailable</b> — these are not limit breaches. The
            gate is fail-closed, so it refuses the order rather than guessing:
          </p>
          <ul className="violation-list">
            {unavailable.map((violation, index) => (
              <li key={`${violation.rule}-unavailable-${index}`}>
                <StatusBadge tone="warn" label={violation.rule} />{" "}
                {violation.reason ?? "Required data unavailable."}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
