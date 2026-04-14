#!/bin/sh
set -e

# Initialize database only once (persistent across restarts)
if [ ! -f /app/data/.initialized ]; then
    echo "Initializing database..."
    bun run dbsync
    touch /app/data/.initialized
    echo "Database initialized."
fi

exec "$@"
