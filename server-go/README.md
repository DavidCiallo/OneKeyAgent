# OneKeyAgent Server — Go 版

原 Bun/TypeScript 服务端（`server/`）的 Go 完整重写，**API 契约与原版一致**，
前端 React SPA 无需任何改动即可对接。

## 为什么重写

原版的内存问题根源在架构，不在语言：

1. **JSONL 存储是全文件读写** —— `update/delete` 每次把整个集合文件读进内存再
   全量重写，`usage_bucket` 只增不减，查询无索引全文件扫描。
2. **扣费是“先查后扣”** —— 流式响应结束后才检查+扣费，并发可透支、扣费失败被
   `catch {}` 吞掉。
3. Bun/V8 堆基线高、GC 高水位不回落。

Go 版逐项修复：

| 问题 | Go 版方案 |
|---|---|
| JSONL 全文件重写 | SQLite（modernc 纯 Go 驱动，无 CGO），每集合一张表 + 索引，更新都是单行 SQL |
| 扣费竞态/透支 | 余额预检（≤0 直接 429）+ `UPDATE ... SET balance = MAX(balance-?, 0)` 原子扣减，永不透支 |
| 周限额三倍误算 | TS 版 `getWeeklySpending` 未过滤 granularity，1m/60m/1d 三份 cost 重复累加；Go 版只统计 `1d` |
| 礼品卡双花 | `UPDATE ... WHERE status='unused'` 原子核销 |
| usage 无限增长 | 保留 TTL 清理，且每次一条索引化 DELETE 全量清除过期行（TS 每次只删一行） |
| reasoning 缓存从未写入 | TS 版在响应头到达时就读 reasoning（恒为空串）；Go 版流式增量捕获，流结束后写缓存 |
| 内存 | 空载 ~15MB，流式转发常数内存，不随历史数据增长 |

## 构建 & 运行

```bash
cd server-go
go build -o bin/onekey-server.exe ./cmd/server
go build -o bin/onekey-migrate.exe ./cmd/migrate

# 从仓库根目录的 .env 读取配置（SERVER_PORT/SECRET/ADMIN_*/NOWPAYMENTS_* 等）
SECRET=xxx SERVER_PORT=3300 SQLITE_PATH=data/onekey.db STATIC_DIR=../dist ./bin/onekey-server.exe
```

环境变量与 TS 版完全兼容：`SERVER_PORT`、`SECRET`、`NONCE_LENGTH`、
`ADMIN_NAME/EMAIL/PASSWORD`、`TG_BOT_API_BASE_URL`、`NOWPAYMENTS_API_KEY`、
`IPN_SECRET`、`IPN_CALLBACK_URL`、`RESEND_API_KEY`、`EMAIL_FROM`、
`ALLOWED_REGISTER_DOMAINS`、`CLIENT_URL`、`ENABLE_RECHARGE`、
`DAILY_REGISTER_LIMIT`、`FALLBACK_MODEL_ALIAS`。
新增：`SQLITE_PATH`（默认 `data/onekey.db`）、`STATIC_DIR`（默认 `./dist` 或 `../dist`）。

## 数据迁移（JSONL → SQLite）

```bash
./bin/onekey-migrate.exe -data ../data -db data/onekey.db
```

读取 TS 版遗留的 `data/*.jsonl` 的 10 个集合（account/model/provider/role/
account_role/settings/usage_bucket/gift_card/transaction/session_reasoning），
保留原 id 与时间戳。TS 版可随时切回；JSONL 文件只读不动。

## Docker 部署

仓库根目录直接（compose 会自动读取根目录 `.env`）：

```bash
docker compose up -d --build
```

- 多阶段构建：bun 构建前端 → Go 静态编译（CGO 关闭）→ alpine 运行时，
  单容器同时服务 API 与前端，最终镜像约 30MB。
- 数据卷挂载 `./data`；**首次启动若检测到遗留 `data/*.jsonl` 且无 SQLite，
  entrypoint 自动执行迁移**（幂等，已有 onekey.db 直接跳过）。
- 健康检查打 `/api/auth/config`；`restart: unless-stopped`。
- 容器内默认 UTC。每日签到/按天统计的"本地零点"取决于时区，需要的话在
  compose 里取消 `TZ=Asia/Shanghai` 的注释（与旧 TS 容器一致默认 UTC）。
- 回滚 TS 版：`git checkout` 旧版 `Dockerfile` + `docker-compose.yml` 后重新 up。

本地无 Docker 时已验证的等价项：`CGO_ENABLED=0 GOOS=linux` 交叉编译通过、
基础镜像标签存在、前端选择性 COPY 构建产物完整、entrypoint 迁移/跳过逻辑实测。

## 兼容性说明

- 路由/请求/响应格式、`{success,data}` 信封、400 错误信封、CORS、静态服务
  SPA 回退、`.mjs` 403，全部与 `mount.ts` 行为一致。
- 鉴权 token 是 AES-256-CBC(key=sha256(SECRET), iv) 加密的
  `identity|-|过期时间`，IV 与 TS 版一样每次进程启动随机生成——
  **重启后所有登录态失效**（与 TS 版行为相同，非回归）。
- 密码仍是 sha256 hex，迁移后老账号可直接登录。
- `/api/chat/completions`、`/api/completions`、`/api/models`（OpenAI 格式）、
  `/api/v1/messages`（Anthropic 格式，含流式互转）已通过 mock 上游端到端验证，
  含工具调用/思考内容/grounding 的协议转换与 TS 版逐行对译。
- 原版 `ai.stream.ts` 的伪流、`mountws` WebSocket 广播、`Queue` 插件均为死代码
  （无调用方），未移植。

## 测试

```bash
# 1) 迁移真实数据到临时库
./bin/onekey-migrate.exe -data ../data -db testtmp/onekey.db

# 2) API 端到端（mock 上游，验证转发/计费/桶统计/预检）
python smoke_test.py testtmp/onekey.db   # 需先起服务: SQLITE_PATH=testtmp/onekey.db PORT=3399

# 3) Web 管理面（登录/鉴权/设置/每日签到）
python web_test.py
```

## 目录结构

```
cmd/server       入口：初始化、管理员种子、监控、HTTP 服务
cmd/migrate      JSONL → SQLite 迁移
internal/store   SQLite：建表 + 全部实体访问（含原子扣费/核销）
internal/service 设置缓存、鉴权 token、计费、邮件、NowPayments、限流
internal/ai      协议转换(trans) / SSE 流转换(stream) / 上游调用与编排(service)
internal/api     全部 HTTP handlers + 路由 + 静态服务
internal/httpx   请求上下文合并(query+body) / 信封 / CORS
internal/cryptox AES-CBC / sha256 / nanoid / uuid（与 TS crypto.ts 对齐）
internal/monitor 支付状态轮询
```
