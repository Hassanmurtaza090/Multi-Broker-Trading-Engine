"""API error handling — maps engine errors to safe HTTP responses.

Rules (ADR-016):
- Engine errors surface as the STABLE internal error codes (`DomainError`
  hierarchy) — never raw tracebacks, exception class names, or internals.
- 400 invalid domain input, 404 unknown resource, 409 state conflicts and
  duplicates, 422 request-body validation, 502/503/504 broker failures.
- Unexpected exceptions return a generic 500 with NO internal detail; the full
  context is logged server-side only.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from api.schemas import ErrorOut, ErrorResponseOut
from api.security import (
    ApiForbiddenError,
    ApiRateLimitedError,
    ApiUnauthorizedError,
)
from domain.errors import (
    BrokerError,
    DomainError,
    DuplicateOrderError,
    ErrorCode,
    InvalidArgumentError,
    OrderNotFoundError,
    OrderStateError,
)

logger = logging.getLogger("mtbe.api")


class ApiRiskRejectionError(Exception):
    """A risk-gate rejection to render as HTTP 422 with the decision body."""

    def __init__(self, decision: Any) -> None:
        super().__init__("order rejected by risk")
        self.decision = decision


def _error_response(
    status: int, code: str, message: str, detail: str | None = None
) -> JSONResponse:
    body = ErrorResponseOut(error=ErrorOut(code=code, message=message, detail=detail))
    return JSONResponse(status_code=status, content=body.model_dump())


def _domain_status_and_code(error: DomainError) -> tuple[int, str]:
    """Map a `DomainError` to (HTTP status, stable code)."""
    code = error.code.value
    if isinstance(error, OrderNotFoundError):
        return 404, code
    if error.code is ErrorCode.NOT_FOUND:
        return 404, code
    if isinstance(error, (OrderStateError, DuplicateOrderError)):
        return 409, code
    if isinstance(error, InvalidArgumentError):
        return 400, code
    if isinstance(error, BrokerError):
        if error.code is ErrorCode.TIMEOUT:
            return 504, code
        if error.code is ErrorCode.CONNECTION_LOST:
            return 503, code
        return 502, code
    return 400, code


def install_exception_handlers(app: FastAPI) -> None:
    """Register all API exception handlers on the app."""

    @app.exception_handler(ApiUnauthorizedError)
    async def _unauthorized_handler(_: Request, exc: ApiUnauthorizedError) -> JSONResponse:
        # Generic message only — never distinguish missing/malformed/expired
        # tokens, and never echo any part of the presented credential.
        return _error_response(401, "UNAUTHENTICATED", exc.message)

    @app.exception_handler(ApiForbiddenError)
    async def _forbidden_handler(_: Request, exc: ApiForbiddenError) -> JSONResponse:
        # 403s state the requirement, not the caller's identity data.
        return _error_response(403, "FORBIDDEN", exc.message)

    @app.exception_handler(ApiRateLimitedError)
    async def _rate_limited_handler(_: Request, exc: ApiRateLimitedError) -> JSONResponse:
        # Standard Retry-After (seconds, ceil); body stays generic — it
        # never confirms whether the username exists.
        response = _error_response(429, "RATE_LIMITED", exc.message)
        response.headers["Retry-After"] = str(int(exc.retry_after_seconds) + 1)
        return response

    @app.exception_handler(DomainError)
    async def _domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
        status, code = _domain_status_and_code(exc)
        # Domain messages are authored by us (safe); `detail` is safe metadata.
        return _error_response(status, code, exc.message, exc.detail)

    @app.exception_handler(ApiRiskRejectionError)
    async def _risk_rejection_handler(_: Request, exc: ApiRiskRejectionError) -> JSONResponse:
        # Risk rejections are explainable decisions, not errors: 422 with the
        # decision body (rule, reason, data availability).
        from api.schemas import decision_to_out

        payload = decision_to_out(exc.decision).model_dump()
        payload["error"] = {"code": "RISK_REJECTED", "message": "order rejected by risk"}
        return JSONResponse(status_code=422, content=payload)

    @app.exception_handler(ValueError)
    async def _value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
        # Domain construction failures (incl. pydantic ValidationError, which
        # subclasses ValueError) — messages are validation texts, safe to return.
        return _error_response(400, ErrorCode.INVALID_ARGUMENT.value, str(exc))

    @app.exception_handler(RequestValidationError)
    async def _request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI body validation: summarize the failing fields only.
        errors = exc.errors()
        message = "; ".join(
            f"{'.'.join(str(loc) for loc in e.get('loc', ()))}: {e.get('msg', 'invalid')}"
            for e in errors[:5]
        )
        return _error_response(422, "VALIDATION_ERROR", message or "invalid request body")

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _error_response(exc.status_code, str(exc.status_code), str(exc.detail))

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        # Full context server-side only — never leak internals to clients.
        logger.exception(
            "api_unhandled_error",
            extra={"path": request.url.path, "operation": "api.unhandled"},
        )
        return _error_response(500, "INTERNAL_ERROR", "internal server error")
