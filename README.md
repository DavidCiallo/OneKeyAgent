# OneKey Agent 🔑

**OpenAI-compatible API gateway with automatic model failover & built-in admin panel.**

OneKey Agent is a self-hosted AI gateway that seamlessly routes requests across multiple models/providers. When a model fails, traffic automatically falls back to the next available one — no client-side changes needed. The built-in Web admin panel lets you manage accounts, models, usage quotas, and role-based permissions with ease.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔄 **Auto Failover** | Configure multiple models under one alias with priority tiers; automatic fallback |
| 🎯 **OpenAI Compatible** | Drop-in replacement for `/chat/completions`, `/completions`, `/models` |
| 📊 **Usage Analytics** | Token consumption tracking by API key, model & session; visual charts |
| 👥 **Multi-Tenant RBAC** | Role-based access control with admin & regular user roles |
| 🌐 **WebSocket Broadcasting** | Real-time event push to connected admin panels |
| 🌍 **Internationalization** | Built-in English & Chinese UI |
| 🐳 **Self-Contained** | Docker or bare metal; embedded SQLite, zero external dependencies |

---

## 🧱 Tech Stack

- **Frontend**: React 19 + Rsbuild + Tailwind CSS 4 + HeroUI + Framer Motion + Recharts
- **Backend**: Bun + TypeScript + Express (MCP service)
- **Database**: SQLite + Drizzle ORM
- **Communication**: RESTful API + SSE + WebSocket
- **AI Requests**: undici HTTP client with proxy support

---

## 🔄 How Auto Failover Works

The core capability of OneKey Agent is **model-level automatic failover**:

1. **Model Configuration**: Each model has an `alias`, `model` name, `baseURL`, `api_key`, and `tier` (priority level)
2. **Request Routing**: Clients specify a model alias (e.g. `gpt-4`); the gateway finds all models under that alias
3. **Failover**: Models are tried by tier priority; if one fails (network error, HTTP error, etc.), the next is tried automatically
4. **Transparent Proxy**: The entire failover process is invisible to the client; responses follow OpenAI format

```
Request ──> /chat/completions { model: "gpt-4" }
        │
        ├── [tier 1] gpt-4-turbo @ OpenAI  ── Success ✅
        │
        └── [tier 2] gpt-4 @ Azure         ── Fallback 🔄
             └── [tier 3] claude-3-opus     ── Fallback 🔄
```

---

## 🚀 Quick Start

### Docker (Recommended)

```bash
cp .env.example .env
# Edit .env to set admin credentials & secrets
docker compose up -d
```

### Bare Metal

```bash
bun install        # Install dependencies
bun run dbsync     # Initialize database
bun run build      # Build frontend
bun run serve      # Start server
```

---

## ⚙️ Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVER_PORT` | Server port | `3300` |
| `SECRET` | AES encryption key for tokens | — |
| `ADMIN_EMAIL` | Initial admin email | — |
| `ADMIN_PASSWORD` | Initial admin password | — |
| `ADMIN_NAME` | Initial admin name | — |

---

## 📋 Admin Panel

- **Model Management**: Add/edit/delete AI model configs; set aliases, tiers & proxies
- **Account Management**: Manage users & role assignments
- **Usage Analytics**: View token consumption trends; filter by time, model, or user
- **Profile**: View & regenerate API keys; see endpoint info
- **Roles & Permissions**: Role-based access control (RBAC)

---

## 🔌 API Endpoints

Follows OpenAI API format. Clients only need to replace the `baseURL`:

```bash
# Chat completions
POST http://localhost:3300/api/v1/chat/completions
Authorization: Bearer <your-api-key>

# Text completions
POST http://localhost:3300/api/v1/completions

# List models
GET http://localhost:3300/api/v1/models
```

Streaming (`stream: true`) is supported via SSE.

---

## 📄 License

[MIT](LICENSE)