# Backend

Broker-agnostic trading engine backend (Python + FastAPI). See
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the module boundaries.

> Currently scaffolded only — no application behavior is implemented yet.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -e ".[dev]"
```

## Quality checks

```bash
ruff check .                  # lint
ruff format --check .         # format
mypy .                        # type check
pytest                        # tests (from backend/)
```