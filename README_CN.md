# OneKey Agent 🔑

**兼容 OpenAI 接口格式的 AI API 网关，支持模型自动故障切换，自带 Web 管理后台。**

OneKey Agent 是自托管的 AI 网关，将请求自动路由到多个模型/上游供应商。当某个上游不可用时，请求自动回退到下一个可用供应商，客户端无需任何改动。内置 Web 管理后台，可管理模型、供应商、账号、配额、订阅与角色权限。

---

## ✨ 特性

| 特性 | 说明 |
|------|------|
| 🔄 **自动故障切换** | 同一模型别名下可配置多个供应商与优先级 tier，网络/HTTP 错误时自动降级 |
| 🔀 **多协议支持** | 原生 OpenAI 格式 + Anthropic `/v1/messages` 兼容；OpenAI / Anthropic / Gemini 协议透明互转 |
| 🎯 **OpenAI 兼容** | 可直接替换 `/chat/completions`、`/completions`、`/models`；支持 SSE 流式输出 |
| 💰 **计费与额度** | 按别名定价（输入 / 缓存 / 输出），账户余额自动扣减，每周消费限额 |
| 🧠 **思考模式** | 支持上游思考模式、推理强度（reasoning effort）、思维链缓存重放（SSE） |
| 📊 **用量统计** | 按账号、模型别名、供应商统计 Token 与费用，预聚合成分钟/小时/天桶；可视化图表 |
| 👥 **多租户 RBAC** | 管理员 / 普通用户角色权限；公开 / 私有模型可见性 |
| 💳 **订阅与加密支付** | 预充值、套餐包、礼品卡、NowPayments 加密支付（USDT/USDC），IPN 回调 + 订阅监控 |
| 🤖 **Telegram 机器人** | 用 `/auth` 绑定 API Key，聊天发消息创建任务，结果回推给用户 |
| 📧 **邮箱验证** | 可选注册邮箱验证（Resend，可插拔邮件后端） |
| 🌐 **实时推送** | WebSocket（`/ws`）向管理面板实时广播事件 |
| 🌍 **多语言** | 内置 7 种语言：English、中文、Español、日本語、Português (BR)、Русский、ไทย |
| 🐳 **自包含部署** | Docker 或裸机；JSONL 文件存储 + 可插拔仓库驱动，零外部依赖 |

---

## 🧱 技术栈

- **前端**：React 19 + Rsbuild + Tailwind CSS 4 + HeroUI + Framer Motion + Recharts + react-router
- **后端**：Bun + TypeScript，原生 `Bun.serve` HTTP 服务
- **存储**：自定义仓库层 + 可插拔 `RepositoryDriver` 接口；默认 JSONL 驱动，每个集合一个 `.jsonl` 文件存于 `./data`
- **流式 / 实时**：SSE（`text/event-stream`）+ WebSocket（`/ws`）
- **AI 请求**：Node `http`/`https` + `https-proxy-agent`（支持按供应商配置上游代理）
- **集成**：NowPayments（加密支付）、Resend（邮件）、Telegram Bot API
- **插件**：email（`resend`/`null`）与 queue（`redis`/`null`）双实现

---

## 🔄 故障切换原理

OneKey Agent 把**模型**（客户端看到的别名）和**供应商**（真实上游）分离：

1. **模型（Model）**：一个 `alias`（如 `gpt-4`），含输入 / 缓存 / 输出单价与公开可见性。
2. **供应商（Provider）**：绑定到某个模型别名的上游连接——`base_url`、上游 `model`、`api_key`、`priority`（优先级）、接口协议 `api_type`、可选 `proxy_url`、思考/推理/联网搜索能力开关。
3. **路由**：客户端请求模型别名，网关解析该别名下所有**启用**的供应商并按 `priority` 排序。
4. **故障切换**：按优先级依次尝试；任一失败（网络错误、HTTP 错误、异常状态码）自动切换到下一个。
5. **协议转换**：响应按客户端请求的格式（OpenAI 或 Anthropic）转换后返回，整个切换过程对客户端透明。

```
Client ──> POST /api/chat/completions { model: "gpt-4" }
        │
        ├── [priority 1] gpt-4-turbo @ OpenAI   ── 成功 ✅
        │
        └── [priority 2] gpt-4 @ Azure          ── 回退 🔄
             └── [priority 3] claude-3-opus     ── 回退 🔄
```

---

## 🚀 快速开始

### Docker（推荐）

```bash
cp .env.example .env
# 编辑 .env，设置 SECRET、ADMIN_EMAIL、ADMIN_PASSWORD
docker compose up -d
```

### 裸机部署

需要 [Bun](https://bun.sh) ≥ 1.x。

```bash
bun install      # 安装依赖
bun run build    # 构建前端到 dist/
bun run serve    # 启动服务（server/app/index.ts）
```

无需执行数据库迁移：存储目录 `./data` 会自动创建，管理员账号在首次启动时根据环境变量自动建立。

---

## ⚙️ 配置

服务从环境变量读取配置（参考 `.env.example`）。

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SERVER_PORT` | 服务端口 | `3300` |
| `SECRET` | Token 加密密钥（AES） | — |
| `NONCE_LENGTH` | AES 随机数长度 | `4` |
| `ADMIN_NAME` | 初始管理员名称（首次启动自动创建） | — |
| `ADMIN_EMAIL` | 初始管理员邮箱 | — |
| `ADMIN_PASSWORD` | 初始管理员密码 | — |
| `CLIENT_URL` | 服务端使用的前端站点地址 | — |
| `ALLOWED_REGISTER_DOMAINS` | 允许自助注册的邮箱域名 | — |
| `RESEND_API_KEY` | Resend API Key（邮箱验证） | — |
| `EMAIL_FROM` | 验证邮件发件地址 | — |
| `TG_BOT_API_BASE_URL` | Telegram Bot API 地址（如 `https://api.telegram.org/bot<token>`） | — |
| `NOWPAYMENTS_API_KEY` | NowPayments API Key（加密支付） | — |
| `IPN_CALLBACK_URL` | 即时支付通知（IPN）回调地址 | — |

---

## 🖥️ 管理后台

- **模型管理** — 增删改模型别名；设置输入 / 缓存 / 输出价格、公开可见性；按别名的用量统计与图表
- **供应商管理** — 管理上游供应商：优先级、BaseURL、上游模型、API Key、认证类型、接口协议（OpenAI / Anthropic / Gemini）、代理 URL、思考模式 / 推理强度开关、思维重放、联网搜索、批量导入
- **用量统计** — 按时间 / 模型别名 / 供应商查看 Token 与费用趋势；会话列表与供应商占比
- **账号管理** — 用户列表、角色分配、筛选分页、礼品卡管理
- **账户信息** — 账号资料、查看与重新生成 API Key、可用模型列表
- **费用管理** — 当前套餐、充值套餐包、预充值、礼品卡兑换、加密支付弹窗、账单流水
- **系统设置** — 系统配置（可通过环境变量或后台 UI 修改）
- **条款页 / 未授权页** — 公开条款页与无权限提示页

---

## 🔌 API 接口

### AI 接口（兼容 OpenAI）

客户端只需替换 `base_url`：

```bash
# Chat Completions（"stream": true 时走 SSE 流式）
POST http://localhost:3300/api/chat/completions
Authorization: Bearer <你的API Key>

# Text Completions
POST http://localhost:3300/api/completions

# 模型列表（按账号可见性过滤）
GET http://localhost:3300/api/models

# Anthropic Messages API（兼容）
POST http://localhost:3300/api/v1/messages
x-api-key: <你的API Key>
```

认证支持 `Authorization: Bearer <key>`、`token: <key>`、`x-api-key: <key>` 三种请求头。AI 接口返回标准 OpenAI / Anthropic 格式（原始透传，流式返回 SSE）。

### 管理接口（Web 后台）

管理 API 同样挂载在 `/api` 下（如 `/api/account`、`/api/role`、`/api/settings`、`/api/subscription`、`/api/gift_card`、`/api/telegram`），返回统一格式：

```json
{ "success": true, "data": { ... } }
```

---

## 📂 项目结构

```
├── client/          # React 前端（页面、组件、api、7 种语言 locale）
├── server/
│   ├── app/         # 入口（Bun.serve）+ 初始化
│   ├── lib/         # HTTP/静态/WebSocket 挂载、仓库层、插件（email、queue）
│   ├── methods/     # 加密与工具
│   └── modules/     # 功能模块：ai、auth、account、role、model、provider、
│                    #   usage、subscription（礼品卡/NowPayments）、telegram、task、
│                    #   settings、email
├── shared/          # 实体、接口、路由 + 代码生成模板
│   └── lib/         # generate.ts — 基于模板生成新模块脚手架
└── data/            # JSONL 存储（自动创建，每个集合一个 .jsonl 文件）
```

---

## 📄 License

MIT