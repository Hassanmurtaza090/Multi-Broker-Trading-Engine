# Backend runtime image (M14 hardened).
#
# - Dependencies installed at BUILD time from pyproject (no runtime pip).
# - Runs as an unprivileged user; the app never writes to disk.
# - Secrets come from the environment at RUNTIME (compose env_file) — the
#   build context is filtered by .dockerignore so .env can never be baked
#   into an image layer.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    API_HOST=0.0.0.0

WORKDIR /app

# Install the project and its locked dependencies first (layer cacheable).
COPY pyproject.toml README.md ./
COPY api ./api
COPY application ./application
COPY brokers ./brokers
COPY config ./config
COPY domain ./domain
COPY events ./events
COPY execution ./execution
COPY infrastructure ./infrastructure
COPY market_data ./market_data
COPY order_management ./order_management
COPY portfolio ./portfolio
COPY risk ./risk
COPY main.py ./
RUN pip install --no-cache-dir .

# Unprivileged runtime user.
RUN useradd --system --uid 10001 --no-create-home appuser
USER appuser

EXPOSE 8000
# The composition boundary builds the runtime + auth from env configuration.
# Production serving (behind nginx) is finalized in M15.
CMD ["python", "main.py"]
