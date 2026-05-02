FROM oven/bun:1-alpine

WORKDIR /app

# Install build tools for native addons (better-sqlite3)
RUN apk add --no-cache python3 make g++ gcc

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build frontend
RUN bun run build

# Generate Drizzle migrations from schema
RUN bun run db:generate

# Create data directory for SQLite
RUN mkdir -p data

# Make entrypoint executable
RUN chmod +x /app/docker-entrypoint.sh

# Expose port
EXPOSE 3300

# Start the server
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["bun", "run", "server/app/index.ts"]