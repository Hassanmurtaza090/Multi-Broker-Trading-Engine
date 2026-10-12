#!/usr/bin/env bash
# Generate self-signed TLS certificates for STAGING/local validation (M15).
# Production must mount real CA-issued certificates — never commit either.
#
# Usage: ./scripts/generate_tls_certs.sh   (from the repository root)
set -euo pipefail

cert_dir="$(dirname "$0")/../infrastructure/nginx/certs"
mkdir -p "$cert_dir"

openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "$cert_dir/server.key" -out "$cert_dir/server.crt" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# The unprivileged proxy (uid 101) must be able to read the key: staging
# files are world-readable (production ops own their own cert perms).
chmod 644 "$cert_dir/server.key" "$cert_dir/server.crt"

echo "Done: $cert_dir/server.crt + server.key (gitignored)."
echo "Mount via TLS_CERT_DIR in .env (default: ./infrastructure/nginx/certs)."
