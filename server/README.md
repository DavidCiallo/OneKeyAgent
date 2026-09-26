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
cd server
go build -o bin/onekey-server.exe ./cmd/server
go build -o bin/onekey-migrate.exe ./cmd/migrate

# 从仓库根目录的 .env 读取配置（SERVER_PORT/SECRET/ADMIN_*/NOWPAYMENTS_* 等）
SECRET=xxx SERVER_PORT=3300 SQLITE_PATH=data/onekey.db STATIC_DIR=../dist ./bin/onekey-server.exe
```

环境变量与 TS 版完全兼容：`SERVER_PORT`、`SECRET`、`NONCE_LENGTH`、
`ADMIN_NAME/EMAIL/PASSWORD`、`TG_BOT_API_BASE_URL`、`NOWPAYMENTS_API_KEY`、
`IPN_SECRET`、`IPN_CALLBACK_URL`、`RESEND_API_KEY`、`EMAIL_FROM`、
`ALLOWED_REGISTER_DOMAINS`、`CLIENT_URL`、`ENABLE_RECHARGE`、
`DAILY_REGISTER_LIMIT`、`FALLBACK_MODEL_ALIAS`、`SHOW_HOME_PAGE`、`ROUTING_TIMEZONE`。
新增：`SQLITE_PATH`（默认 `data/onekey.db`）、`STATIC_DIR`（默认 `./dist` 或 `../dist`）。

`SHOW_HOME_PAGE=0` 关闭首页：服务端把该标记注入 `index.html`（`window.__APP_CONFIG__`），
前端在渲染前同步读取，`/home` 与未知路径改跳登录页；已登录则跳到该账号的默认页面。
该值同时是可在后台设置的配置项，改动在下次页面加载时生效。

## 供应商生效时段（峰谷路由）

供应商可填 `active_from` / `active_to`（界面上是两个时间输入框，留空 = 不限），
表示该上游只在当地这段时间内参与路由 —— 典型用法是白天走便宜的、凌晨走快的。

- **时区**：按 `ROUTING_TIMEZONE`（默认 `Asia/Shanghai`）算，**不是**按容器 TZ。
  容器里 TZ 通常是 UTC，若依赖系统时区，填 `00:00-08:00` 实际会落在北京时间 08:00-16:00。
- **跨午夜**：`active_from > active_to` 视为跨越午夜的单个时段，`22:00-02:00` 是一段而非空集。
- **起含止不含**：`00:00-08:00` 包含 00:00，不包含 08:00。
- **两端相同（含都为 0）= 不限时段**。若把 `from == to` 当作空时段，填错一次就会让该上游
  永久不可用，看起来像故障而不是笔误 —— 所以按"不限"处理。
- **是偏好不是闸门**：如果按时段过滤后没有候选了，仍会按原优先级顺序使用全部候选，
  否则一个时段配置就能让请求直接失败。与其他筛选条件（上下文、配额、冷却）语义一致。
- 每日配额的自然日同样按 `ROUTING_TIMEZONE` 计算，两个功能共用一个时钟。

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
  `identity|-|过期时间`；key 与 IV 都由 `SECRET` 派生，因此
  **重启后登录态依然有效**，多个共享同一 `SECRET` 的节点也能互相解密 token。
  （旧版 IV 每进程随机，重启即全部失效，与 TS 版行为相同。）
  密文本身仍不重复：每次加密的随机 nonce 是明文前缀的一部分。
- 密码仍是 sha256 hex，迁移后老账号可直接登录。
- `/api/chat/completions`、`/api/completions`、`/api/models`（OpenAI 格式）、
  `/api/v1/messages`（Anthropic 格式，含流式互转）已通过 mock 上游端到端验证，
  含工具调用/思考内容/grounding 的协议转换与 TS 版逐行对译。
- 原版 `ai.stream.ts` 的伪流、`mountws` WebSocket 广播、`Queue` 插件均为死代码
  （无调用方），未移植。

## 多地域部署（主库 + 副本）

目的：境内用户走境内节点、境外用户走境外节点，但两边不是互相隔离的两套数据。
一个节点当**主库**（唯一权威数据源），其他节点是**副本**：本地读写、按批把变更
回传主库。

### 角色怎么定

| 环境变量 | 主库 | 副本 |
|---|---|---|
| `MAIN_DB_URL` | 不设 | 主库地址，如 `https://main.example.com` |
| `SYNC_SECRET` | 设（校验副本请求） | 设（与主库一致） |
| `NODE_ID` | 可选，仅用于日志 | 建议设，便于区分来源 |
| `SYNC_INTERVAL_SECONDS` | — | 定时推送间隔，默认 30 |
| `SYNC_FLUSH_BYTES` | — | 缓冲超过该字节数立即推送，默认 256KiB |
| `SYNC_MAX_ROWS` | — | 单批最多条数，默认 500 |
| `SYNC_PULL_SECONDS` | — | 定时拉取主库快照的间隔，默认 300（0 关闭） |
| `SYNC_ADDITIVE_MODE` | — | 余额/用量对账策略，默认 `reconcile`（见「一致性预期」） |
| `SECRET` | 两端必须一致 | 同左 |
| `NONCE_LENGTH` | 两端必须一致 | 同左 |

`SECRET` 必须相同，副本才能解开主库签发的 token（登录态可跨节点使用）。
`NONCE_LENGTH` 也要一致：它决定解密时从明文头部剥掉多少字符，不一致会把
对方的 token 解成乱码。
若希望登录态失效、只让 API key 生效，可以让两端 `SECRET` 不同——那样
网页登录需要各自重新登录，但 `sk-` 开头的 api_key 存在数据库里，不受影响。

### 副本启动时的行为

1. 打开本地 SQLite（境外卷是临时的，重建后是空库），创建/补齐 schema；
2. 从主库 `GET /api/sync/snapshot` 拉一份参考数据（模型/供应商/角色/账号/
   设置/礼品卡/用量桶/交易），**只在首次引导时导入**（`node_state.bootstrapped`）。
   已有本地数据的重启不会重新导入，否则会把还没回传的本地扣费回滚掉。
3. 开始服务流量，本地记账；
4. 后台按「缓冲超过 `SYNC_FLUSH_BYTES`」或「每 `SYNC_INTERVAL_SECONDS`」把变更
   批量 `POST /api/sync/push` 到主库，主库确认后副本才删除缓冲；
5. 后台每 `SYNC_PULL_SECONDS`（默认 5 分钟）拉一次主库快照，刷新参考数据并
   **对账余额/用量**（见「一致性预期」）。

主库（不设 `MAIN_DB_URL`）不缓冲自己的写入，避免把数据推回给自己。

### 支付只在主库确认

NowPayments 的轮询（`internal/monitor`）**只在主库启动**。副本若也轮询，
会和主库各自确认同一笔支付并各自入账——本地一笔、回传主库一笔，等于一次
充值到账两次。

代价：副本上发起的充值单会作为 put 回传主库、由主库确认入账；副本本地的余额
视图会在**下次快照刷新**（`SYNC_PULL_SECONDS`，默认 5 分钟）时并入这笔入账。
网页端的充值入口仍建议指向主库（确认更及时），副本主要承担中转流量。

### 两类变更（这是正确性的关键）

- **put（整行覆盖）**：管理员改的参考数据（模型价格、供应商开关、角色分配），
  以及**资金状态的整行变化**——礼品卡核销/作废、充值单状态流转。同一行多次修改
  会在副本侧折叠成一条，后写的列覆盖先写的。
- **delta（增量相加）**：余额扣减、用量桶。这类值由并发请求共同累加，**必须相加
  而不是覆盖**，否则延迟到达的批次会把中间发生的消费抹掉。

余额扣减是带符号的增量（扣费记负数），主库执行 `MAX(balance + delta, 0)`——与
副本本地扣减同样下限为 0，所以多节点各自扣到余额告罄也不会扣成负数。

### 一致性预期（重要）

- **参考数据**：副本进程内缓存 30 秒。管理员在主库改动后，副本最长 30 秒可见；
  副本自己走 API 的改动立即失效缓存。**跨进程直连 SQLite 改数据不会触发副本失效**，
  要等 TTL。
- **余额**：副本本地即时扣减，主库按批延迟汇总（主库余额**会略滞后**）。副本
  展示的余额是**对账值**：`主库快照余额 + 本节点已扣未回传的增量`，每次快照刷新
  （`SYNC_PULL_SECONDS`，默认 5 分钟）重新对账——主库侧的消费与充值随下次刷新
  进入副本，本节点已扣未回传的消费永远不被快照抹掉。三种合并策略（`reconcile` /
  `skip` / `copy`）的实测对照见 `demo_skip_balance.py`：`skip` 会让主库消费对副本
  永久不可见（持续超发），`copy` 会把未回传的扣费退还成免费余额，因此默认
  `reconcile`（`SYNC_ADDITIVE_MODE` 是回退/对比开关）。
  残余窗口：**其他副本**未回传的消费在推送间隔内不可见，短暂超支可接受（副本
  扣到 0 就停）；快照在途与推送确认交错的毫秒级窗口会在下次刷新自愈。
- **审计日志**：留在各节点本地，不上传主库。
- **周限额**：按主库的 `1d` 桶统计，副本侧同样滞后于批量推送，属已知取舍。
- 反向同步（主库 → 副本）：首次引导之外，副本运行期间每 `SYNC_PULL_SECONDS`
  拉取快照增量刷新（引用数据直接覆盖，余额/用量按上述规则对账）。主库的紧急
  改动最迟一个刷新周期到达副本。

### 相关接口

| 接口 | 说明 |
|---|---|
| `GET /api/sync/snapshot` | 主库返回全量引导数据（需 `SYNC_SECRET`） |
| `POST /api/sync/push` | 主库在**单事务内**应用一批副本变更 |
| `GET /api/sync/status` | 本节点角色、缓冲条数/字节、最后推送序号 |
| `POST /api/sync/flush` | 管理员手动触发一次推送（需管理员 token） |

## 测试

```bash
# 1) 迁移真实数据到临时库
./bin/onekey-migrate.exe -data ../data -db testtmp/onekey.db

# 2) API 端到端（mock 上游，验证转发/计费/桶统计/预检）
python smoke_test.py testtmp/onekey.db   # 需先起服务: SQLITE_PATH=testtmp/onekey.db PORT=3399

# 3) Web 管理面（登录/鉴权/设置/每日签到）
python web_test.py

# 4) 双节点（主库 + 副本）：引导、跨节点 token、扣费与用量回传
python sync_test.py testtmp/sync/main.db testtmp/sync/replica.db testtmp/sync/onekey-server.exe

# 5) 余额对账三态对照（skip / copy / reconcile 各跑一遍同一场景）
python demo_skip_balance.py testtmp/sync/onekey-server.exe reconcile
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
