FROM oven/bun:1-alpine

WORKDIR /app

# Install build tools for native addons (better-sqlite3)
RUN apk add --no-cache python3 make g++ gcc

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code (includes pre-committed Drizzle migration files)
COPY . .

# Build frontend
RUN bun run build

# Create data directory for SQLite
RUN mkdir -p data

# Expose port
EXPOSE 3300

# Start the server (migrate.ts runs automatically on startup)
CMD ["bun", "run", "server/app/index.ts"]