#!/usr/bin/env bash
# Restore the trading-engine PostgreSQL volume from a backup dump (M15).
# Usage: ./scripts/restore_db.sh <backup.sql.gz>   (backend should be stopped)
set -euo pipefail

file="${1:?usage: restore_db.sh <backup.sql.gz>}"
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }

echo "Restoring $file into ${POSTGRES_DB:-trading_engine}..."
echo "(backend should be stopped: docker compose stop backend)"
gunzip -c "$file" | docker compose exec -T postgres \
  psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-trading_engine}"
echo "restore complete."
