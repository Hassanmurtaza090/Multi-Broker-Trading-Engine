#!/usr/bin/env bash
# Backup the trading-engine PostgreSQL volume to a timestamped SQL dump (M15).
# Usage: ./scripts/backup_db.sh [output_dir]   (default: ./backups)
set -euo pipefail

out_dir="${1:-./backups}"
mkdir -p "$out_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$out_dir/mtbe-orders-$stamp.sql.gz"

# --clean --if-exists: the dump drops existing objects before recreating,
# making restore_db.sh a true round-trip (idempotent restore).
docker compose exec -T postgres \
  pg_dump --clean --if-exists \
    -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-trading_engine}" \
  | gzip > "$file"

echo "backup written: $file"
echo "verify with: gzip -t $file"
