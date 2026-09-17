"""Order Management System (M4).

Broker-independent order lifecycle, state management, and event publication.
"""

from __future__ import annotations

from order_management.manager import OrderManager
from order_management.repository import InMemoryOrderRepository, OrderRepository

__all__ = [
    "OrderManager",
    "OrderRepository",
    "InMemoryOrderRepository",
]
