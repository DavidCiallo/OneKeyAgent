#!/bin/sh
# Container entrypoint:
#   1. first boot on a legacy volume (TS-era *.jsonl, no SQLite yet) → migrate
#   2. exec the Go server
set -e

: "${SQLITE_PATH:=/app/data/onekey.db}"

if [ ! -f "$SQLITE_PATH" ] && ls /app/data/*.jsonl >/dev/null 2>&1; then
    echo "[entrypoint] legacy JSONL data found and no SQLite DB — migrating..."
    /app/onekey-migrate -data /app/data -db "$SQLITE_PATH"
fi

exec /app/onekey-server
