# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────
# OneKeyAgent — Go server + React frontend, single container.
# Build context is the REPO ROOT (frontend + server-go both needed):
#   docker build -f server-go/Dockerfile .
# ─────────────────────────────────────────────────────────────────

# ── Stage 1: frontend (same build as the old Bun Dockerfile) ──
FROM oven/bun:1-alpine AS frontend
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html rsbuild.config.ts postcss.config.mjs tsconfig.json ./
COPY client ./client
COPY public ./public
COPY shared ./shared
RUN bun run build

# ── Stage 2: Go build (modernc.org/sqlite is pure Go → CGO off) ──
FROM golang:1.27-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0
COPY server-go/go.mod server-go/go.sum ./
RUN go mod download
COPY server-go ./
RUN go build -trimpath -ldflags="-s -w" -o /out/onekey-server ./cmd/server \
 && go build -trimpath -ldflags="-s -w" -o /out/onekey-migrate ./cmd/migrate

# ── Stage 3: runtime ──
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app

COPY --from=build /out/onekey-server  /app/onekey-server
COPY --from=build /out/onekey-migrate /app/onekey-migrate
COPY --from=frontend /app/dist        /app/dist
COPY server-go/entrypoint.sh          /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh \
 && mkdir -p /app/data

ENV SQLITE_PATH=/app/data/onekey.db \
    STATIC_DIR=/app/dist \
    SERVER_PORT=3300

EXPOSE 3300
ENTRYPOINT ["/app/entrypoint.sh"]
