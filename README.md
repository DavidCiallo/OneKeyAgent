# OneKey 🔑

**OpenAI-compatible API gateway with automatic model failover.**

When a backend model becomes unavailable, requests are automatically routed to the next configured model. Client applications require no changes.

---

### Features

- 🔄 Automatic failover — seamless fallback across configured models
- 🎯 OpenAI-compatible — drop-in replacement for `/chat/completions` and `/completions`
- 📊 Usage tracking — token consumption by API key, session, and model
- 👥 Multi-tenant — account management with role-based access control
- 🐳 Self-contained — Docker or bare metal, embedded SQLite, zero external dependencies

### Quick start

```bash
cp .env.example .env
docker compose up -d
```

Admin credentials are configured via `.env`.

<details>
<summary>Bare metal</summary>

```bash
bun install
bun run dbsync
bun run build
bun run serve
```
</details>

### Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVER_PORT` | Server port | `3300` |
| `SECRET` | AES encryption key for tokens | — |
| `ADMIN_EMAIL` | Initial admin account email | — |
| `ADMIN_PASSWORD` | Initial admin account password | — |

MIT