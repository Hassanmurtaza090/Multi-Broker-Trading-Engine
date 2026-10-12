"""M16 unit tests — composition helpers in main.py (env parsing)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend"))

from main import parse_market_subscriptions


class TestParseMarketSubscriptions:
    def test_basic_entry(self):
        entries = parse_market_subscriptions("AAPL|EQUITY|USD|NASDAQ")
        assert entries == [
            {
                "symbol": "AAPL",
                "asset_class": "EQUITY",
                "currency": "USD",
                "exchange": "NASDAQ",
                "identifiers": "",
            }
        ]

    def test_identifiers_entry(self):
        entries = parse_market_subscriptions("AAPL|EQUITY|USD|NASDAQ|SAXO_UIC=211")
        assert entries[0]["identifiers"] == "SAXO_UIC=211"

    def test_multiple_entries_via_separator(self):
        entries = parse_market_subscriptions(
            "AAPL|EQUITY|USD|NASDAQ; MSFT|EQUITY|USD|NASDAQ|SAXO_UIC=461"
        )
        assert [e["symbol"] for e in entries] == ["AAPL", "MSFT"]

    def test_malformed_entries_dropped(self):
        entries = parse_market_subscriptions("AAPL|EQUITY; ;AAPL|EQUITY|USD|NASDAQ")
        assert len(entries) == 1
        assert entries[0]["symbol"] == "AAPL"

    def test_empty_is_empty(self):
        assert parse_market_subscriptions("") == []
        assert parse_market_subscriptions(";;;") == []
