"""Backend entrypoint — the composition boundary (M10/M12).

Builds the engine runtime with broker adapters injected as ports and serves
the API gateway. For development this wires the SIMULATED broker adapters
(paper/sim mode; no live trading per the roadmap); production wiring selects
real transports via configuration when they arrive (ADR-014/ADR-015).

M12: authentication is MANDATORY. The identity sources are the JSON users
file (`AUTH_USERS_FILE`, hashed passwords only) and explicitly provisioned
demo users from the environment (dev convenience; hashed at startup). With
no configured users the server runs with ZERO users — nobody can log in —
rather than falling back to an insecure anonymous mode.

Run:  python main.py  (serves http://127.0.0.1:8000 — docs at /docs)
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from datetime import timedelta
from pathlib import Path

from api.auth import AuthService, UserDirectory
from api.passwords import hash_password
from api.throttle import LoginRateLimiter
from api.tokens import TokenService
from application.runtime import EngineRuntime
from brokers.ibkr import IbkrAdapter, SimulatedIbkrClient
from brokers.ibkr.contracts import IbkrExecution, IbkrQuote
from brokers.saxo import SaxoAdapter, SimulatedSaxoClient
from brokers.saxo.contracts import SaxoExecution
from config.settings import Settings, split_csv
from domain.instrument import Instrument
from domain.money import Price
from domain.orders import Order
from infrastructure.persistence import (
    PostgresOrderRepository,
    create_order_repository,
)
from order_management import OrderRepository

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mtbe.main")

_DEFAULT_ACCOUNT = "ACC-001"


def build_simulated_runtime(
    broker: str = "IBKR",
    account_id: str = _DEFAULT_ACCOUNT,
    *,
    order_repository: OrderRepository | None = None,
) -> tuple[EngineRuntime, IbkrAdapter | SaxoAdapter]:
    """Compose the engine with the simulated (paper) broker adapters.

    The composition boundary is the ONLY place concrete adapters are imported;
    the runtime and API depend solely on ports. A single adapter instance
    implements both the market-data feed and the execution broker, and it
    publishes on the runtime's bus (injected here).
    """
    from events import InProcessEventBus

    bus = InProcessEventBus()
    if broker.upper() == "IBKR":
        adapter: IbkrAdapter | SaxoAdapter = IbkrAdapter(
            SimulatedIbkrClient(), bus=bus, account_id=account_id, auto_drain=True
        )
    else:
        adapter = SaxoAdapter(
            SimulatedSaxoClient(), bus=bus, account_id=account_id, auto_drain=True
        )
    runtime = EngineRuntime(
        feed=adapter,
        broker=adapter,
        broker_name=broker.upper(),
        bus=bus,
        order_repository=order_repository,
    )
    return runtime, adapter


def build_auth_service(settings: Settings) -> AuthService:
    """Build the identity layer. Never stores or logs raw passwords."""
    if settings.jwt_secret_key:
        secret = settings.jwt_secret_key
        source = "environment"
    else:
        # Ephemeral, process-local secret: no secret is ever committed or
        # logged, and every session dies with the process. Intended for the
        # local simulated stack; production sets JWT_SECRET_KEY.
        secret = secrets.token_urlsafe(48)
        source = "ephemeral"
        logger.warning(
            "auth_jwt_secret_ephemeral",
            extra={
                "operation": "auth.bootstrap",
                "note": "JWT_SECRET_KEY not set; generated ephemeral secret "
                "(sessions do not survive restarts)",
            },
        )
    tokens = TokenService(
        secret_key=secret,
        access_ttl=timedelta(minutes=settings.jwt_access_token_expire_minutes),
        refresh_ttl=timedelta(minutes=settings.jwt_refresh_token_expire_minutes),
    )

    raw_users: list[dict[str, object]] = []
    if settings.auth_users_file:
        path = Path(settings.auth_users_file)
        raw_users = list(json.loads(path.read_text(encoding="utf-8")))
        logger.info(
            "auth_users_file_loaded",
            extra={"operation": "auth.bootstrap", "source": source, "path": str(path)},
        )
    if settings.auth_demo_trader_password:
        raw_users.append(
            {
                "username": settings.auth_demo_trader_username,
                "password_hash": hash_password(settings.auth_demo_trader_password),
                "roles": ["trader"],
                "accounts": split_csv(settings.auth_demo_trader_accounts),
            }
        )
    if settings.auth_demo_admin_password:
        raw_users.append(
            {
                "username": settings.auth_demo_admin_username,
                "password_hash": hash_password(settings.auth_demo_admin_password),
                "roles": ["admin"],
                "accounts": split_csv(settings.auth_demo_admin_accounts),
            }
        )
    if settings.auth_demo_outsider_password:
        raw_users.append(
            {
                "username": settings.auth_demo_outsider_username,
                "password_hash": hash_password(settings.auth_demo_outsider_password),
                "roles": ["trader"],
                "accounts": split_csv(settings.auth_demo_outsider_accounts),
            }
        )
    if settings.auth_demo_viewer_password:
        raw_users.append(
            {
                "username": settings.auth_demo_viewer_username,
                "password_hash": hash_password(settings.auth_demo_viewer_password),
                "roles": ["viewer"],
                "accounts": split_csv(settings.auth_demo_viewer_accounts),
            }
        )
    directory = UserDirectory.from_records(raw_users)
    if len(directory) == 0:
        logger.warning(
            "auth_no_users_configured",
            extra={
                "operation": "auth.bootstrap",
                "note": "no users configured — nobody can log in (set "
                "AUTH_USERS_FILE or AUTH_DEMO_*_PASSWORD)",
            },
        )
    throttle = LoginRateLimiter(
        max_failures=settings.auth_login_max_failures,
        window=timedelta(seconds=settings.auth_login_window_seconds),
    )
    return AuthService(tokens, directory, throttle=throttle)


def configure_logging(settings: Settings) -> None:
    """Structured logging with a production JSON option (M15, NFR-004).

    `LOG_FORMAT=json` renders every log record as a single JSON line
    (level, time, logger, message + structured extras) for aggregation;
    `text` keeps the human-readable development format. Credentials are
    never logged (M12/M14 guarantees) — the formatter only shapes output.
    """
    import json
    import logging

    class JsonFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            payload: dict[str, object] = {
                "time": self.formatTime(record),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
            }
            for key, value in record.__dict__.items():
                if key not in payload and key not in {
                    "args",
                    "msg",
                    "name",
                    "levelname",
                    "levelno",
                    "pathname",
                    "filename",
                    "module",
                    "exc_info",
                    "exc_text",
                    "stack_info",
                    "lineno",
                    "funcName",
                    "created",
                    "msecs",
                    "relativeCreated",
                    "thread",
                    "threadName",
                    "processName",
                    "process",
                    "taskName",
                }:
                    payload[key] = value
            if record.exc_info:
                payload["exception"] = self.formatException(record.exc_info)
            return json.dumps(payload, default=str)

    handler = logging.StreamHandler()
    if settings.log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level.upper())


def main() -> None:
    """Serve the API gateway with the simulated broker stack."""
    settings = Settings()
    configure_logging(settings)
    asyncio.run(_serve(settings))


async def _serve(settings: Settings) -> None:
    """Compose and serve: persistence FIRST (startup ordering, M15) —
    the order store must be usable before the broker feed connects and the
    API starts accepting traffic; teardown happens in reverse."""
    import uvicorn

    from api.app import create_app

    repository: PostgresOrderRepository | None = None
    if settings.order_repository == "postgres":
        if not settings.database_url:
            raise SystemExit("ORDER_REPOSITORY=postgres requires DATABASE_URL")
        logger.info("persistence_starting", extra={"operation": "persistence.start"})
        repository = create_order_repository(settings.database_url)
        await repository.initialize()  # fail fast when the DB is unreachable

    try:
        runtime, _adapter = build_simulated_runtime(
            settings.broker_adapter.upper(), order_repository=repository
        )
        auth = build_auth_service(settings)
        app = create_app(
            runtime,
            auth=auth,
            ws_account_id=settings.broker_account,
            allowed_origins=split_csv(settings.api_origins),
            database=repository,
            # Dev-only tooling: OpenAPI docs enabled only in development (M14).
            docs_enabled=settings.api_docs_enabled or settings.app_env == "development",
        )
        await runtime.start()  # connects the broker feed
        tick_task = await start_market_data(settings, runtime, _adapter)
        start_auto_fill(settings, runtime, _adapter)
        config = uvicorn.Config(
            app,
            host=settings.api_host,
            port=settings.api_port,
            log_level=settings.log_level.lower(),
            # access logs would record single-use WS tickets; they are
            # consumed-or-expired before being logged (ADR-018), but the
            # production posture still keeps them off by default.
            access_log=settings.log_format != "json",
        )
        server = uvicorn.Server(config)
        logger.info(
            "starting API gateway on %s:%s (simulated broker stack)",
            settings.api_host,
            settings.api_port,
        )
        try:
            await server.serve()  # graceful on SIGTERM/SIGINT
        finally:
            if tick_task is not None:
                tick_task.cancel()
            await runtime.stop()  # stops the feed (broker disconnect)
    finally:
        if repository is not None:
            await repository.close()


def parse_market_subscriptions(raw: str) -> list[dict[str, str]]:
    """Parse MARKET_SUBSCRIPTIONS entries: SYMBOL|ASSET_CLASS|CCY|EXCHANGE
    with optional KEY=VALUE identifier pairs (ADR-015 broker-neutral)."""
    entries: list[dict[str, str]] = []
    for line in raw.split(";"):
        parts = [p.strip() for p in line.split("|") if p.strip()]
        if len(parts) < 4:
            continue
        entries.append(
            {
                "symbol": parts[0].upper(),
                "asset_class": parts[1].upper(),
                "currency": parts[2].upper(),
                "exchange": parts[3].upper(),
                "identifiers": parts[4] if len(parts) > 4 else "",
            }
        )
    return entries


async def start_market_data(
    settings: Settings, runtime: EngineRuntime, adapter: IbkrAdapter | SaxoAdapter
) -> asyncio.Task[None] | None:
    """M16: startup-configured market subscriptions (there is no subscribe
    API — documented M11 limitation) plus the optional simulated tick
    emitter that drives the full market-data path on a live deployment
    (feed -> engine -> bus -> WS -> terminal). Both are SIMULATION-era
    conveniences; real transports (ADR-014/015) replace the emitter."""
    from domain.instrument import AssetClass, Exchange, Instrument
    from domain.money import Currency

    instruments: list[Instrument] = []
    for entry in parse_market_subscriptions(settings.market_subscriptions):
        identifiers: dict[str, str] = {}
        for pair in entry["identifiers"].split(","):
            if "=" in pair:
                key, _, value = pair.partition("=")
                identifiers[key.strip()] = value.strip()
        instrument = Instrument(
            symbol=entry["symbol"],
            asset_class=AssetClass(entry["asset_class"]),
            currency=Currency(code=entry["currency"]),
            exchange=Exchange(entry["exchange"]),
            identifiers=identifiers,
        )
        try:
            subscribed = await runtime.market.subscribe(instrument)
            logger.info(
                "market_subscription_started",
                extra={
                    "operation": "market.startup_subscribe",
                    "symbol": entry["symbol"],
                    "subscribed": subscribed,
                },
            )
            instruments.append(instrument)
        except Exception:  # noqa: BLE001 — config must not wedge startup
            logger.warning(
                "market_subscription_failed",
                extra={"operation": "market.startup_subscribe", "symbol": entry["symbol"]},
            )

    if settings.sim_tick_seconds <= 0 or not instruments:
        return None

    interval = settings.sim_tick_seconds

    async def tick_loop() -> None:
        import random
        from decimal import Decimal

        last_prices: dict[str, float] = {}
        while True:
            await asyncio.sleep(interval)
            for instrument in instruments:
                base = last_prices.get(instrument.symbol, 100.0)
                # Random walk: +/- 0.5% around the previous print.
                nxt = round(base * (1 + random.uniform(-0.005, 0.005)), 2)
                last_prices[instrument.symbol] = nxt
                price = Price(value=Decimal(f"{nxt}"), currency=instrument.currency)
                try:
                    feed_sim_quote(adapter, instrument, price)
                except Exception:  # noqa: BLE001 — ticks must not crash serving
                    logger.warning("sim_tick_failed", extra={"operation": "market.sim_tick"})

    logger.info(
        "sim_ticks_started",
        extra={"operation": "market.sim_tick", "interval_s": interval, "count": len(instruments)},
    )
    return asyncio.create_task(tick_loop())


def feed_sim_quote(
    adapter: IbkrAdapter | SaxoAdapter,
    instrument: Instrument,
    price: Price,
) -> None:
    """Drive the SIMULATED broker client with a quote (simulation-only,
    ADR-014/015): builds the broker-shaped DTO from the domain instrument
    and hands it to the client exactly like the transport callback would.
    Capability-detected (never on the transport ports); the main.py
    composition runs adapters with auto_drain=True so the queued delivery
    publishes on the event loop immediately."""
    from datetime import UTC, datetime

    from brokers.ibkr import IbkrAdapter
    from brokers.saxo import SaxoAdapter

    now_unix = int(datetime.now(UTC).timestamp())
    client = getattr(adapter, "_client", None)
    emit = getattr(client, "emit_quote", None)
    if emit is None:
        return  # a real transport has no emission seam — correct no-op

    bid = f"{float(price.value) * 0.999:.2f}"
    ask = f"{float(price.value) * 1.001:.2f}"
    if isinstance(adapter, IbkrAdapter):
        from brokers.ibkr.contracts import IbkrContract

        emit(
            IbkrQuote(
                contract=IbkrContract(
                    symbol=instrument.symbol,
                    sec_type="STK",
                    exchange=instrument.exchange.value,
                    currency=instrument.currency.code,
                ),
                bid=bid,
                ask=ask,
                bid_size="100",
                ask_size="100",
                last=f"{price.value}",
                timestamp_unix=now_unix,
            )
        )
    elif isinstance(adapter, SaxoAdapter):
        from brokers.saxo.contracts import SaxoQuote

        uic_raw = instrument.identifiers.get("SAXO_UIC")
        if uic_raw is None:
            return  # the Saxo adapter never guesses identifiers (ADR-015)
        emit(
            SaxoQuote(
                uic=int(uic_raw),
                asset_type="Stock",
                bid=bid,
                ask=ask,
                last=f"{price.value}",
                timestamp_unix=now_unix,
            )
        )


def start_auto_fill(
    settings: Settings, runtime: EngineRuntime, adapter: IbkrAdapter | SaxoAdapter
) -> None:
    """SIMULATION-ONLY paper-trading driver (ADR-014/015, M16): once the
    simulated broker acks an order, schedule an execution through the REAL
    callback path — the broker-shaped DTO is emitted on the simulated
    client exactly like the transport would, the adapter maps/dedupes it,
    and the OMS applies the fill (publishing order.* events, driving the
    portfolio, positions, and P&L). Never active with real transports.

    Conventions (simulation mode only, deterministic E2E scenarios): an
    order carrying the broker-neutral instrument identifier
    SIM_ACTION=PARTIAL fills 40% then the remainder; SIM_ACTION=REJECT
    gets a broker-side rejection through the M5 reconcile path
    (force_status is poll-based — TS-006).
    """
    if not settings.sim_auto_fill:
        return

    from events import EventEnvelope

    delay = settings.sim_fill_delay_seconds

    async def on_accepted(envelope: EventEnvelope) -> None:  # type: ignore[type-arg]
        order = envelope.payload.order

        async def fill_later() -> None:
            await asyncio.sleep(delay)
            try:
                client = getattr(adapter, "_client", None)
                emit_exec = getattr(client, "emit_execution", None)
                force_status = getattr(client, "force_status", None)
                if emit_exec is None or force_status is None:
                    return
                broker_id = int(order.broker_order_id) if order.broker_order_id else None
                if broker_id is None:
                    return
                # The paper-trading directive rides the broker-neutral
                # instrument identifiers (ADR-015 metadata channel —
                # validated at the API, ignored by the core).
                marker = (order.instrument.identifiers.get("SIM_ACTION", "") or "").upper()
                if "REJECT" in marker:
                    status_word = "Inactive" if isinstance(adapter, IbkrAdapter) else "Rejected"
                    force_status(broker_id, status_word)
                    await adapter.drain()
                    # force_status records broker-side state delivered only
                    # through the POLL path (TS-006): reconcile fetches the
                    # outstanding orders' status and applies the REJECTED
                    # report through the real handler.
                    await runtime.executor.reconcile()
                    return
                quantity_total = float(order.quantity.value)
                chunks = (
                    [round(quantity_total * 0.4, 8), None]
                    if "PARTIAL" in marker
                    else [quantity_total, None]
                )
                cum = 0.0
                for i, chunk in enumerate(chunks):
                    if chunk is None:
                        chunk = quantity_total - cum
                    if chunk <= 0:
                        continue
                    cum += chunk
                    exec_id = f"E2E-AF-{order.client_order_id.hex[:8]}-{i}"
                    emit_exec(_sim_execution(adapter, order, exec_id, broker_id, chunk, cum))
                    await adapter.drain()
                    if i < len(chunks) - 1:
                        await asyncio.sleep(delay)
            except Exception:  # noqa: BLE001 — paper fills must not crash serving
                logger.warning("sim_fill_failed", extra={"operation": "market.sim_fill"})

        asyncio.create_task(fill_later())

    runtime.bus.subscribe("order.accepted", on_accepted)
    logger.info(
        "sim_auto_fill_enabled",
        extra={"operation": "market.sim_fill", "delay_s": delay},
    )


def _sim_execution(
    adapter: IbkrAdapter | SaxoAdapter,
    order: Order,
    execution_id: str,
    broker_order_id: int,
    quantity: float,
    cum: float,
) -> IbkrExecution | SaxoExecution:
    """Build the broker-shaped execution DTO from the domain order
    (simulation-only mirror of the real transport payload)."""
    instrument = order.instrument
    side = order.side.value
    price = f"{order.limit_price.value if order.limit_price else 100:.2f}"
    qty = _trim_float(quantity)
    cum_qty = _trim_float(cum)
    if isinstance(adapter, IbkrAdapter):
        return IbkrExecution(
            execution_id=execution_id,
            ibkr_order_id=broker_order_id,
            order_ref=str(order.client_order_id),
            symbol=instrument.symbol,
            sec_type="STK",
            exchange=instrument.exchange.value,
            currency=instrument.currency.code,
            side="BOT" if side == "BUY" else "SLD",
            quantity=qty,
            price=price,
            cum_quantity=cum_qty,
            executed_at_unix=0,
        )
    return SaxoExecution(
        execution_id=execution_id,
        order_id=broker_order_id,
        external_reference=str(order.client_order_id),
        uic=int(instrument.identifiers["SAXO_UIC"]),
        asset_type="Stock",
        buy_sell="buy" if side == "BUY" else "sell",
        quantity=qty,
        price=price,
        cum_quantity=cum_qty,
        executed_at_unix=0,
    )


def _trim_float(value: float) -> str:
    """Format a sim quantity without float artifacts (8 dp, trailing zeros
    trimmed; never empty)."""
    out = f"{value:.8f}".rstrip("0").rstrip(".")
    return out or "0"


if __name__ == "__main__":
    main()
