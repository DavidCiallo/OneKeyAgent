#!/bin/sh
set -e

# Database tables are created automatically by Drizzle migrations on startup.
echo "Starting server..."

exec "$@"
