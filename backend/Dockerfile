# Backend Dockerfile (scaffold)
#
# NOT yet operational. Intended for the FastAPI gateway (M10) and beyond.
FROM python:3.13-slim

WORKDIR /app

# Install dependencies (fastapi/uvicorn installed once application is built;
# the pyproject dependencies are minimal at M0).
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip

COPY . .

# Placeholder — replace with the real entrypoint when implemented:
# CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8000"]
CMD ["python", "-c", "print('backend scaffold: not implemented')"]