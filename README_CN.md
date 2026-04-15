# OneKey 🔑

**兼容 OpenAI 接口格式的 API 网关，支持模型自动故障切换。**

当后端模型不可用时，请求自动路由至下一个可用模型，客户端无需任何改动。

---

### 特性

- 🔄 自动故障切换 — 在已配置的模型之间无缝降级
- 🎯 兼容 OpenAI — 可直接替换 `/chat/completions` 和 `/completions` 接口
- 📊 用量统计 — 按 API Key、会话、模型统计 Token 消耗
- 👥 多用户 — 账号管理与基于角色的访问控制
- 🐳 自包含 — Docker 或裸机部署，内嵌 SQLite，无外部依赖

### 快速开始

```bash
cp .env.example .env
docker compose up -d
```

管理员账号通过 `.env` 配置。

<details>
<summary>裸机部署</summary>

```bash
bun install
bun run dbsync
bun run build
bun run serve
```
</details>

### 配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SERVER_PORT` | 服务端口 | `3300` |
| `SECRET` | Token 加密密钥 | — |
| `ADMIN_EMAIL` | 初始管理员邮箱 | — |
| `ADMIN_PASSWORD` | 初始管理员密码 | — |

MIT