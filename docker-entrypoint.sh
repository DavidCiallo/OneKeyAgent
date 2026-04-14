#!/bin/sh
set -e

# Sync database schema on every start (drizzle-kit push is a no-op when already up-to-date)
echo "Syncing database schema..."
bun run dbsync

exec "$@"