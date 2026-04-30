#!/bin/sh
set -e

# Database migrations run automatically on server startup.
# To apply new migrations manually, run: bun run db:generate
echo "Starting server (migrations will run automatically)..."
# Note: If the drizzle/ migration folder doesn't exist yet, run:
#   bun run db:generate   # Generate initial migration from schema

exec "$@"
