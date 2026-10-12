# Generate self-signed TLS certificates for STAGING/local validation (M15).
# Production must mount real CA-issued certificates instead — never commit
# either; the certs directory is gitignored.
#
# Usage:  .\scripts\generate_tls_certs.ps1   (from the repository root)

$ErrorActionPreference = "Stop"
$certDir = Join-Path $PSScriptRoot "..\infrastructure\nginx\certs"
if (-not (Test-Path $certDir)) { New-Item -ItemType Directory -Path $certDir | Out-Null }

$days = 825
$keyFile = Join-Path $certDir "server.key"
$crtFile = Join-Path $certDir "server.crt"

Write-Output "Generating self-signed certificate (staging) in $certDir ..."
openssl req -x509 -nodes -newkey rsa:2048 -days $days `
  -keyout $keyFile -out $crtFile `
  -subj "/CN=localhost" `
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

Write-Output "Done: server.crt / server.key (gitignored)."
Write-Output "NOTE: the production proxy runs UNPRIVILEGED (uid 101) — ensure the key"
Write-Output "file is readable by it (on Linux hosts: chmod 644 server.key; on Windows"
Write-Output "Docker Desktop mounts this is usually automatic; see the runbook)."
Write-Output "Mount the directory via TLS_CERT_DIR in .env (default: ./infrastructure/nginx/certs)."
