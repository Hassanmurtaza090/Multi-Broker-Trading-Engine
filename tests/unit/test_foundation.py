"""Foundation tests for M0.

These tests validate the *actual* project foundation: that packages import,
that architecture boundaries are respected (no forbidden imports), and that the
environment template is present and free of committed secrets.

They do NOT assert functionality that does not yet exist.
"""

from __future__ import annotations

import importlib
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"


# --- Package importability ---------------------------------------------------

BACKEND_PACKAGES = [
    "api",
    "application",
    "domain",
    "infrastructure",
    "brokers",
    "brokers.base",
    "brokers.ibkr",
    "brokers.saxo",
    "market_data",
    "execution",
    "risk",
    "portfolio",
    "events",
    "config",
]


@pytest.mark.parametrize("pkg", BACKEND_PACKAGES)
def test_backend_package_imports(pkg: str) -> None:
    """Every declared backend package must exist and be importable."""
    module = importlib.import_module(pkg)
    assert module is not None


# --- Architecture boundary enforcement ---------------------------------------

# Modules above the broker abstraction must not reference concrete brokers.
FORBIDDEN_BROKER_IMPORTS = ("brokers.ibkr", "brokers.saxo", "ibkr", "saxo")

# The domain/core must never depend on framework or infrastructure modules.
FORBIDDEN_DOMAIN_IMPORTS = (
    "fastapi",
    "uvicorn",
    "sqlalchemy",
    "react",
    "infrastructure",
    "api",
)


def _read_python_files(directory: Path) -> list[str]:
    return [str(p) for p in directory.rglob("*.py") if p.name != "__init__.py"]


def _import_statements(path: Path) -> list[str]:
    imports: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*(?:from|import)\s+([a-zA-Z0-9_.]+)", line)
        if match:
            imports.append(match.group(1))
    return imports


def test_domain_has_no_framework_or_infra_imports() -> None:
    """The domain core must not import framework/infrastructure/broker specifics."""
    violations: list[str] = []
    for path in _read_python_files(BACKEND / "domain"):
        for imp in _import_statements(Path(path)):
            if imp.startswith(FORBIDDEN_DOMAIN_IMPORTS):
                violations.append(f"{path}: imports {imp}")
    assert violations == [], f"Domain boundary violations:\n{violations}"


def test_non_adapter_modules_do_not_import_concrete_brokers() -> None:
    """Only broker adapters may reference concrete brokers."""
    adapter_dirs = {BACKEND / "brokers" / "ibkr", BACKEND / "brokers" / "saxo"}
    violations: list[str] = []
    for directory in [
        BACKEND / "domain",
        BACKEND / "application",
        BACKEND / "api",
        BACKEND / "market_data",
        BACKEND / "execution",
        BACKEND / "risk",
        BACKEND / "portfolio",
        BACKEND / "events",
    ]:
        for path in _read_python_files(directory):
            for imp in _import_statements(Path(path)):
                if imp.startswith(FORBIDDEN_BROKER_IMPORTS):
                    violations.append(f"{path}: imports {imp}")
    assert violations == [], f"Broker isolation violations:\n{violations}"


# --- Environment / secrets ----------------------------------------------------

_ENV_EXAMPLE = REPO_ROOT / ".env.example"


def test_env_example_exists() -> None:
    assert _ENV_EXAMPLE.is_file(), ".env.example is missing"


def test_env_example_has_expected_placeholders() -> None:
    text = _ENV_EXAMPLE.read_text(encoding="utf-8")
    for key in ["APP_ENV", "DATABASE_URL", "API_HOST", "API_PORT", "JWT_", "REDIS_", "LOG_LEVEL"]:
        assert key in text, f"missing placeholder category: {key}"


def test_no_real_secrets_in_env_example() -> None:
    """Placeholder file must not contain realistic credentials."""
    text = _ENV_EXAMPLE.read_text(encoding="utf-8")
    suspicious = [
        r"(?i)client_secret\s*=\s*\S{20,}",  # long non-placeholder secret
        r"(?i)token\s*=\s*[A-Za-z0-9+/]{20,}",
    ]
    for pattern in suspicious:
        assert re.search(pattern, text) is None, f"suspicious secret value matched: {pattern}"


def test_env_is_gitignored() -> None:
    gitignore = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8")
    assert re.search(r"^\.env", gitignore, flags=re.MULTILINE), ".env not ignored"


# --- Documentation presence ---------------------------------------------------

REQUIRED_DOCS = [
    "README.md",
    "docs/PROJECT_STATUS.md",
    "docs/ROADMAP.md",
    "docs/ARCHITECTURE.md",
    "docs/REQUIREMENTS.md",
    "docs/DECISIONS.md",
    "docs/TEST_STATUS.md",
    "docs/CHANGELOG.md",
    "docs/DEVELOPMENT_WORKFLOW.md",
]


@pytest.mark.parametrize("doc", REQUIRED_DOCS)
def test_required_documentation_exists(doc: str) -> None:
    path = REPO_ROOT / doc
    assert path.is_file(), f"missing required documentation: {doc}"
    assert path.read_text(encoding="utf-8").strip(), f"empty documentation: {doc}"


# --- Test suite hygiene ---------------------------------------------------------


def test_test_module_basenames_are_unique() -> None:
    """A duplicated ``test_*.py`` basename aborts the whole pytest collection.

    pytest imports test modules by basename, so two test files with the same
    name in different directories make any run that collects both (for
    example CI's ``python -m pytest ../tests``) fail with "import file
    mismatch" before a single test executes.
    """
    seen: dict[str, str] = {}
    violations: list[str] = []
    for path in sorted((REPO_ROOT / "tests").rglob("test_*.py")):
        first = seen.setdefault(path.name, str(path))
        if first != str(path):
            violations.append(f"{path.name}: {first} and {path}")
    assert violations == [], f"Duplicate test module basenames:\n{violations}"
