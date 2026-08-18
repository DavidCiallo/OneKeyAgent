# OneKey Agent 🔑

**OpenAI-compatible AI API gateway with automatic model failover & a built-in admin panel.**

OneKey Agent is a self-hosted AI gateway that routes requests across multiple models and upstream providers. When an upstream fails, traffic automatically falls back to the next available provider — no client-side changes needed. The built-in Web admin panel lets you manage models, providers, accounts, quotas, subscriptions and role-based permissions with ease.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔄 **Auto Failover** | Multiple providers under one model alias with priority tiers; automatic fallback on network/HTTP errors |
| 🔀 **Multi-Protocol** | Native OpenAI format + Anthropic `/v1/messages` compatibility; transparent conversion between OpenAI / Anthropic / Gemini protocols |
| 🎯 **OpenAI Compatible** | Drop-in replacement for `/chat/completions`, `/completions`, `/models`; SSE streaming supported |
| 💰 **Billing & Quotas** | Per-alias pricing (input / cached / output), account balance deduction, weekly spending limit |
| 🧠 **Thinking Support** | Upstream thinking mode, reasoning effort, and cached reasoning replay over SSE |
| 📊 **Usage Analytics** | Token & cost tracking by account, model alias & provider, pre-aggregated into minute/hour/day buckets; visual charts |
| 👥 **Multi-Tenant RBAC** | Role-based access control with admin & regular user roles; public/private model visibility |
| 💳 **Subscriptions & Crypto** | Prepaid top-ups, plan packs, gift cards, and crypto payments (USDT/USDC) via NowPayments with IPN callback + subscription monitor |
| 🤖 **Telegram Bot** | Bind an API key with `/auth`, create tasks by chatting, results pushed back to your chat |
| 📧 **Email Verification** | Optional registration email verification via Resend (pluggable email backend) |
| 🌐 **Real-Time Updates** | WebSocket broadcasting (`/ws`) pushes live events to connected admin panels |
| 🌍 **Internationalization** | 7 built-in locales: English, 中文, Español, 日本語, Português (BR), Русский, ไทย |
| 🐳 **Self-Contained** | Docker or bare metal; JSONL file storage with a pluggable repository driver, zero external dependencies |

---

## 🧱 Tech Stack

- **Frontend**: React 19 + Rsbuild + Tailwind CSS 4 + HeroUI + Framer Motion + Recharts + react-router
- **Backend**: Bun + TypeScript, native `Bun.serve` HTTP server
- **Storage**: Custom repository layer with a pluggable `RepositoryDriver` interface; default JSONL driver stores each collection as a `.jsonl` file under `./data`
- **Streaming / Realtime**: SSE (`text/event-stream`) + WebSocket (`/ws`)
- **AI HTTP**: Node `http`/`https` + `https-proxy-agent` (per-provider upstream proxy support)
- **Integrations**: NowPayments (crypto), Resend (email), Telegram Bot API
- **Plugins**: email (`resend`/`null`) and queue (`redis`/`null`) backends via interface-based plugins

---

## 🔄 How Auto Failover Works

OneKey Agent separates **models** (the alias clients see) from **providers** (the actual upstreams):

1. **Model**: an `alias` (e.g. `gpt-4`) with input / cached / output prices and public visibility.
2. **Provider**: one upstream connection bound to a model alias — `base_url`, upstream `model`, `api_key`, `priority` (tier), API protocol (`api_type`), optional `proxy_url`, thinking/reasoning/search capabilities.
3. **Routing**: the client requests a model alias; the gateway resolves all **enabled** providers for that alias, sorted by `priority`.
4. **Failover**: providers are tried in order; on any failure (network error, HTTP error, bad status) the next one is used automatically.
5. **Protocol conversion**: responses are converted back to the format the client asked for (OpenAI or Anthropic), so the failover is transparent.

```
Client ──> POST /api/chat/completions { model: "gpt-4" }
        │
        ├── [priority 1] gpt-4-turbo @ OpenAI   ── Success ✅
        │
        └── [priority 2] gpt-4 @ Azure          ── Fallback 🔄
             └── [priority 3] claude-3-opus     ── Fallback 🔄
```

---

## 🚀 Quick Start

### Docker (Recommended)

```bash
cp .env.example .env
# Edit .env to set SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d
```

### Bare Metal

Requires [Bun](https://bun.sh) ≥ 1.x.

```bash
bun install      # Install dependencies
bun run build    # Build the frontend into dist/
bun run serve    # Start the server (server/app/index.ts)
```

No database migration step is needed: the storage directory `./data` is created automatically, and the initial admin account is created from the environment variables on first launch.

---

## ⚙️ Configuration

The server reads configuration from environment variables (see `.env.example`).

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVER_PORT` | Server port | `3300` |
| `SECRET` | AES encryption key for tokens | — |
| `NONCE_LENGTH` | AES nonce length | `4` |
| `ADMIN_NAME` | Initial admin name (auto-created on first launch) | — |
| `ADMIN_EMAIL` | Initial admin email | — |
| `ADMIN_PASSWORD` | Initial admin password | — |
| `CLIENT_URL` | Frontend origin used by the server | — |
| `ALLOWED_REGISTER_DOMAINS` | Allowed domains for self-registration | — |
| `RESEND_API_KEY` | Resend API key for email verification | — |
| `EMAIL_FROM` | Sender address for verification emails | — |
| `TG_BOT_API_BASE_URL` | Telegram Bot API base URL (e.g. `https://api.telegram.org/bot<token>`) | — |
| `NOWPAYMENTS_API_KEY` | NowPayments API key for crypto payments | — |
| `IPN_CALLBACK_URL` | Instant Payment Notification callback URL | — |

---

## 🖥️ Admin Panel

- **Model Management** — add/edit/delete model aliases; set input / cached / output prices, public visibility; per-alias usage stats & charts
- **Provider Management** — manage upstream providers: priority tier, base URL, upstream model, API key, auth type, API protocol (OpenAI / Anthropic / Gemini), proxy URL, thinking & reasoning-effort support, reasoning replay, search toggle, batch import
- **Usage Analytics** — token & cost trends by time / model alias / provider; session list and provider bars
- **Account Management** — users, role assignments, filters, pagination, and gift card management
- **Profile** — account info, view & regenerate API keys, accessible models
- **Top-Up & Billing** — current plan, top-up packs, prepaid recharge, gift card redemption, crypto payment modal, statement history
- **Settings** — system settings (configurable via env or admin UI)
- **Terms & NoContent** — public terms page and unauthorized-state page

---

## 🔌 API Endpoints

### AI (OpenAI-compatible)

Clients only need to replace the `base_url`:

```bash
# Chat completions (SSE streaming when "stream": true)
POST http://localhost:3300/api/chat/completions
Authorization: Bearer <your-api-key>

# Text completions
POST http://localhost:3300/api/completions

# List models (respects account visibility)
GET http://localhost:3300/api/models

# Anthropic Messages API (compatible)
POST http://localhost:3300/api/v1/messages
x-api-key: <your-api-key>
```

Authentication accepts `Authorization: Bearer <key>`, `token: <key>` or `x-api-key: <key>` headers. AI endpoints return payloads in the standard OpenAI / Anthropic format (raw pass-through, SSE for streams).

### Admin (Web panel)

Admin APIs are mounted under `/api` (e.g. `/api/account`, `/api/role`, `/api/settings`, `/api/subscription`, `/api/gift_card`, `/api/telegram`) and return a unified envelope:

```json
{ "success": true, "data": { ... } }
```

---

## 📂 Project Structure

```
├── client/          # React frontend (pages, components, api, locales ×7)
├── server/
│   ├── app/         # Entry point (Bun.serve) + initialization
│   ├── lib/         # HTTP/static/WebSocket mounting, repository, plugins (email, queue)
│   ├── methods/     # Crypto & helpers
│   └── modules/     # Feature modules: ai, auth, account, role, model, provider,
│                    #   usage, subscription (gift cards/NowPayments), telegram, task,
│                    #   settings, email
├── shared/          # Entities, interfaces, routers + code-generator templates
│   └── lib/         # generate.ts — scaffolds new modules from templates
└── data/            # JSONL storage (auto-created, one .jsonl file per collection)
```

---

## 📄 License

MIT