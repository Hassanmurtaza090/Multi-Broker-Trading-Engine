"""Domain-level error types.

A single typed hierarchy so the API layer can map errors to HTTP/WS responses
and broker adapters can translate broker-specific errors into these.
No broker-specific codes live here.
"""

from __future__ import annotations

from enum import StrEnum


class ErrorCode(StrEnum):
    """Stable, broker-agnostic error codes."""

    UNKNOWN = "UNKNOWN"
    INVALID_ARGUMENT = "INVALID_ARGUMENT"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    UNAVAILABLE = "UNAVAILABLE"
    TIMEOUT = "TIMEOUT"
    CONNECTION_LOST = "CONNECTION_LOST"
    UNAUTHORIZED = "UNAUTHORIZED"
    RATE_LIMITED = "RATE_LIMITED"
    ORDER_REJECTED = "ORDER_REJECTED"
    ORDER_NOT_FOUND = "ORDER_NOT_FOUND"
    DUPLICATE_ORDER = "DUPLICATE_ORDER"
    RISK_REJECTED = "RISK_REJECTED"
    STALE_DATA = "STALE_DATA"


class DomainError(Exception):
    """Base domain exception carrying a stable code and safe message."""

    code: ErrorCode = ErrorCode.UNKNOWN

    def __init__(
        self,
        message: str,
        *,
        code: ErrorCode | None = None,
        detail: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code or self.code
        self.detail = detail

    def to_dict(self) -> dict[str, str | None]:
        return {
            "code": self.code.value,
            "message": self.message,
            "detail": self.detail,
        }

    def __str__(self) -> str:
        return f"{self.code.value}: {self.message}"


class InvalidArgumentError(DomainError):
    code = ErrorCode.INVALID_ARGUMENT


class OrderNotFoundError(DomainError):
    code = ErrorCode.ORDER_NOT_FOUND


class DuplicateOrderError(DomainError):
    code = ErrorCode.DUPLICATE_ORDER


class OrderRejectedError(DomainError):
    code = ErrorCode.ORDER_REJECTED


class OrderStateError(DomainError):
    """An invalid order state transition was requested (e.g. a terminal order).

    Mapped to HTTP/WS 409 Conflict by the API layer.
    """

    code = ErrorCode.CONFLICT


class RiskRejectedError(DomainError):
    code = ErrorCode.RISK_REJECTED


class StaleDataError(DomainError):
    code = ErrorCode.STALE_DATA


class BrokerError(DomainError):
    """An error originating from (or mapped from) a broker.

    `broker` names the source broker (opaque); `broker_error_code` carries the
    broker's raw code for diagnostics without leaking implementation details
    into the core.
    """

    code = ErrorCode.UNAVAILABLE

    def __init__(
        self,
        message: str,
        *,
        broker: str | None = None,
        broker_error_code: str | None = None,
        code: ErrorCode | None = None,
        detail: str | None = None,
    ) -> None:
        super().__init__(message, code=code, detail=detail)
        self.broker = broker
        self.broker_error_code = broker_error_code

    def to_dict(self) -> dict[str, str | None]:
        data = super().to_dict()
        data["broker"] = self.broker
        data["broker_error_code"] = self.broker_error_code
        return data
