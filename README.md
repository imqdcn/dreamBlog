# Dream Blog · 梦境记录（小智语音 → Web）

通过 ESP32-S3 上的小智 AI 进行语音对话，用场景词触发「记录梦境」，经 LLM 加工（标题 / 摘要 / 关键词 / 情绪）后存入后端，并在 Web 端以日记流 + 统计可视化的形式呈现。

## 架构

```
你口述梦境
  → ESP32-S3 小智固件
  → 官方 xiaozhi.me 服务器 + LLM
  → WS 接入点转发（function_call）
  → mcp-server（TS, record_dream 工具）
  → LLM API 做加工（标题/摘要/关键词/情绪）
  → Strapi CMS（REST + API Token）
  → Nuxt 前端（日记流 + 统计）
  → 部署到 GitHub Pages / Vercel
```

## 单体仓库结构

| 子项目 | 目录 | 说明 | 部署目标 |
| --- | --- | --- | --- |
| Strapi CMS | [`backend/`](./backend) | 梦境数据模型、REST API、API Token 鉴权 | 自托管云服务器 |
| MCP Server | [`mcp-server/`](./mcp-server) | WS 客户端连官方接入点，`record_dream` 工具 + LLM 加工 | 自托管云服务器 |
| Nuxt 前端 | [`frontend/`](./frontend) | 日记流 + 统计可视化 | GitHub Pages / Vercel |

## 本地启动

每个子项目各自独立，首次使用先按其目录内 README 安装依赖、复制 `.env.example` 为 `.env` 并填写。

### 1. 后端 Strapi

```bash
cd backend
npm install
npm run develop   # http://localhost:1337/admin
```

首次进入 Admin 创建管理员账号，随后在 Settings → API Tokens 签发一个用于写入的 Token。

### 2. MCP Server

```bash
cd mcp-server
npm install
cp .env.example .env   # 填写接入点 URL、Strapi 地址与 Token、LLM 密钥
npm run dev
```

### 3. 前端 Nuxt

```bash
cd frontend
npm install
cp .env.example .env   # 填写 Strapi 公开读取地址
npm run dev            # http://localhost:3000
```

## 环境变量：四个 .env 的关系（常见疑问）

本仓库里会看到多个环境变量文件，它们服务于**不同的运行时进程**，彼此独立、互不读取。先说清楚：根目录的是 `.env.example`（示例模板），真正生效的 `.env` 需要你从模板复制后填写。

| 文件 | 给哪个进程用 | 何时生效 |
| --- | --- | --- |
| `backend/.env` | Strapi 进程 | 本地 `npm run develop` 时 |
| `mcp-server/.env` | MCP Server 进程 | 本地 `npm run dev` 时 |
| `frontend/.env` | Nuxt 构建 / dev | 本地跑前端时 |
| 根目录 `.env`（由 `.env.example` 复制） | **仅 `docker-compose.yml` 使用** | 仅当用 `docker compose up` 一键部署时 |

**为什么有「内层三个 + 根目录一个」？**
内层三个是「本地分别单独跑每个子项目」时各自读取的；根目录那个只给「用 Docker 一键编排三件套」时用。两种运行方式二选一，不会同时使用。

### LLM key 到底填哪？

LLM key 永远只属于 **MCP Server 这一个进程**（backend / frontend 都不需要、也不应出现 LLM key）。具体填哪个文件取决于你怎么跑：

- **本地开发**（各自 `npm run dev`）：填 `mcp-server/.env` 的 `LLM_API_KEY`。← 当前你就是这样，已验证跑通。
- **用 Docker 部署到云服务器**：填**根目录 `.env`** 的 `LLM_API_KEY`（先把 `.env.example` 复制成 `.env`）。此时 `docker-compose.yml` 会把它注入 mcp-server 容器，`mcp-server/.env` 不参与。

> 相关变量：`LLM_ENABLED` / `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`。未填 key 时 MCP Server 自动降级为仅保存原文。

各子项目 `.env.example` 列出了完整变量清单，敏感信息不入库（已在 `.gitignore` 忽略 `.env`）。

## 三个子项目能都推 GitHub Pages 吗？

**不能。** 三个子项目的运行形态不同，只有前端是静态站点：

| 子项目 | 本质 | GitHub Pages |
| --- | --- | --- |
| `frontend/` | 纯静态网页（HTML/JS/CSS） | ✅ 可以 |
| `backend/`（Strapi） | 常驻 Node 服务 + 数据库 | ❌ 不行 |
| `mcp-server/` | 常驻 Node 进程 + WebSocket 长连接 | ❌ 不行 |

GitHub Pages 只托管**静态文件**，没有服务器运行时——不能跑 Node 进程、不能连数据库、不能维持 WebSocket 长连接。而：

- **Strapi** 需要一直运行的进程响应 API 并连数据库存梦境。
- **MCP Server** 需要一直在线的进程维持与小智接入点的 WebSocket 长连接（必须 24h 在线，否则你对小智说话时没人接）。

所以正确的部署分工是：

```
frontend/   → GitHub Pages / Vercel   （静态）
backend/    → 你的云服务器            （常驻服务，Docker）
mcp-server/ → 你的云服务器            （常驻服务，Docker）
```

> 前端上 Pages 后是公网访问，它读数据要连到你云服务器上的 Strapi，因此 Strapi 需有公网地址（域名/IP），并在 `CORS_ORIGIN` 里加上你的 Pages 域名。

## CORS 配置（上线最容易漏的一步）

前端和 Strapi 不同源，浏览器会做跨域检查。**如果 Strapi 的 CORS 没放行你的前端域名，前端页面会打开但一条梦境都读不到**（控制台报 CORS 错误）。这是上线时最常见的坑。

Strapi 的 CORS 由 `backend/config/middlewares.ts` 控制，它从环境变量 `CORS_ORIGIN` 读取允许的来源（逗号分隔，不配时默认只允许本地 `localhost:3000` 和 `localhost:4173`）：

```ts
// backend/config/middlewares.ts（已内置，无需改动）
{
  name: 'strapi::cors',
  config: {
    origin: env.array('CORS_ORIGIN', ['http://localhost:3000', 'http://localhost:4173']),
  },
}
```

所以你只需设置 `CORS_ORIGIN` 环境变量，**不用改代码**。按部署方式填：

- **Docker 部署**：在根目录 `.env` 里设（`docker-compose.yml` 会注入 backend 容器）
  ```bash
  # 多个域名用逗号分隔，不要带结尾斜杠
  CORS_ORIGIN=https://<用户名>.github.io,https://dream.example.com
  ```
- **本地/裸机跑 Strapi**：在 `backend/.env` 里设同样的 `CORS_ORIGIN`。

填写要点：
- 值是**协议 + 域名（+端口）**，例如 `https://alice.github.io`，不要带路径或结尾 `/`。
- GitHub Pages 的来源是 `https://<用户名>.github.io`（**注意：子路径 `/dream-blog/` 不属于 CORS origin，不要写进去**）。
- 用自定义域名就填自定义域名；Vercel 则填你的 `*.vercel.app` 或绑定的域名。
- 改完 `CORS_ORIGIN` 需重启 Strapi（Docker 下 `docker compose up -d` 重建 backend 容器）才生效。

> 对应地，前端的 `NUXT_PUBLIC_STRAPI_URL` 要指向这台 Strapi 的公网地址。两者是一对：前端知道去哪读（`NUXT_PUBLIC_STRAPI_URL`），Strapi 知道放行谁来读（`CORS_ORIGIN`）。

## 两种运行模式速查

### 模式 A：本地开发（分别启动）
1. `backend/`：（首次自动生成含随机密钥的 `.env`）→ `npm install && npm run develop`
2. `mcp-server/`：`cp .env.example .env` → 填 `MCP_ENDPOINT` / `STRAPI_TOKEN` / `LLM_API_KEY` → `npm run dev`
3. `frontend/`：`cp .env.example .env` → 填 `NUXT_PUBLIC_STRAPI_URL`（本地默认 `http://localhost:1337`）→ `npm run dev`

### 模式 B：云服务器 Docker 部署（后端 + MCP Server）
1. 根目录：`cp .env.example .env` → 在这里填 Strapi 密钥、Postgres 密码、`MCP_ENDPOINT`、`STRAPI_TOKEN`、`LLM_API_KEY`、`CORS_ORIGIN`
2. `docker compose up -d --build`（拉起 Postgres + Strapi + MCP Server）
3. 前端单独走 GitHub Pages / Vercel，把 `NUXT_PUBLIC_STRAPI_URL` 指向云服务器上的 Strapi 公网地址

## 技术栈与版本

| 层 | 选型 |
| --- | --- |
| 后端 | Strapi 5.61（SQLite 开发 / Postgres 生产） |
| MCP Server | TypeScript + `@modelcontextprotocol/sdk` + `ws`（自定义 WebSocket Transport，自动重连） |
| LLM 加工 | OpenAI 兼容接口（可接 OpenAI / 阿里百炼 qwen / 智谱 glm，未配 key 时降级为仅保存原文） |
| 前端 | Nuxt 4（`ssr:false` 静态）+ ECharts 5 + vue-echarts 7 + echarts-wordcloud 2 |

> 图表依赖链有 peer 约束：`echarts-wordcloud@2` 只支持 echarts 5，故前端统一锁定 echarts 5 + vue-echarts 7。

## 本地端到端已验证

- Strapi `dream` 内容类型建模完成，REST 写入（带 Token）与公开只读（无 Token）均通过。
- MCP Server 单元测试 22 项全过（消息序列化、Strapi 写入重试、LLM 解析/降级、工具逻辑）。
- 前端聚合函数单测 11 项全过，静态构建成功（生成 SPA + 404 fallback）。
- 前端 ↔ Strapi 跨域联调通过（CORS 放行、公开读取到数据）。

## 前置准备（硬件侧）

开始接入 MCP 前，需登录官方 [xiaozhi.me](https://xiaozhi.me) 控制台，确认存在「MCP 接入点」入口并复制其 WebSocket URL，填入 `mcp-server/.env` 的 `MCP_ENDPOINT`。若官方未开放自定义 MCP 接入点，退路是自建 [`xiaozhi-esp32-server`](https://github.com/xinnan-tech/xiaozhi-esp32-server)，任务结构基本不变，仅接入那一环换成本地插件。

## 下一步（需要你操作）

1. 从 xiaozhi.me 控制台复制 MCP 接入点 URL，填入 `mcp-server/.env`。
2. 在 `mcp-server/.env` 填入 LLM 的 `LLM_API_KEY`（及对应 `LLM_BASE_URL` / `LLM_MODEL`）以启用 AI 加工。
3. `cd mcp-server && npm run dev` 连上接入点，对小智说「帮我记录一个梦……」做真机联调。
4. 生产部署见根目录 `docker-compose.yml`（Postgres + Strapi + MCP Server）与 `.github/workflows/deploy-frontend.yml`（前端 Pages）。

## 部署

- 后端 + MCP Server：根目录 `docker compose up -d --build`（先复制 `.env.example` 为 `.env` 并填值）。
- 前端：推送到 GitHub 触发 Pages 工作流，或在 Vercel 导入、Root 设为 `frontend`、Build `npm run generate`、Output `.output/public`。

## 排错 FAQ（真机联调常见问题）

下列命令中 `http://localhost:1337` 换成你实际的 Strapi 地址，`<TOKEN>` 换成写入用的 API Token。

### 1. MCP Server 启动后连不上接入点

现象：日志停在 `正在连接 MCP 接入点` 后反复 `WebSocket 关闭` / `将在 xxxms 后尝试第 N 次重连`。

排查：
- 确认 `mcp-server/.env`（或 Docker 下根 `.env`）的 `MCP_ENDPOINT` 是从 xiaozhi.me 控制台原样复制的 `wss://.../mcp_endpoint/mcp/?token=...`，**token 查询参数没被截断**。
- 接入点地址是 WebSocket，别用浏览器直接打开测试。
- 控制台里该智能体的接入点可能有有效期或需要刷新，重新复制一次最新地址。

### 2. 连上了，但对小智说话不触发 record_dream

现象：MCP Server 日志有 `MCP 接入点连接成功` / `已注册工具：echo, record_dream`，但说「记录梦境」没反应。

排查：
- 在 xiaozhi.me 控制台点「刷新 MCP 接入状态」，确认工具列表里出现了 `record_dream`。
- 换一句更明确的触发语，例如「帮我记录一个梦，我梦见……」，让大模型更容易命中意图。
- 先用 `echo` 工具验证链路：让小智调用 echo，看 MCP Server 日志是否打印 `echo 工具被调用`。能通就说明接入点转发正常，问题只在意图识别措辞。

### 3. 梦境没写进去（record_dream 报错）

现象：MCP Server 日志出现 `record_dream 写入失败`。

排查 Strapi 是否可写：
```bash
# 应返回 200 和创建的记录
curl -i -X POST "http://localhost:1337/api/dreams" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"data":{"rawContent":"排错测试"}}'
```
- 返回 `401/403`：Token 错误或没有 `dream.create` 权限 → 重新运行 `backend` 的 `node ./scripts/setup-access.js` 生成 Token，更新到 MCP Server 的环境变量。
- 返回 `400`：字段校验失败 → 确认 `rawContent` 存在。
- 连接被拒 / 超时：`STRAPI_URL` 指向的地址不对或 Strapi 没在跑。

### 4. 前端能打开，但看不到任何梦境

现象：页面显示空状态或加载失败，浏览器控制台有 CORS 或网络错误。

排查：
```bash
# A. 确认公开只读是否开放（不带 Token 应返回 200 和数据）
curl -s "http://localhost:1337/api/dreams?sort=dreamedAt:desc" -o /dev/null -w "%{http_code}\n"

# B. 模拟前端跨域，确认 CORS 放行（应出现 Access-Control-Allow-Origin）
curl -s -H "Origin: https://<你的前端域名>" "http://localhost:1337/api/dreams" -D - -o /dev/null | grep -i access-control-allow-origin
```
- A 返回 `403`：Public 只读没开 → 运行 `backend` 的 `node ./scripts/setup-access.js`（会开放 `find` / `findOne`）。
- B 没有 `Access-Control-Allow-Origin`：`CORS_ORIGIN` 没包含你的前端域名 → 见上文「CORS 配置」。
- 两个都正常但页面仍空：确认前端 `NUXT_PUBLIC_STRAPI_URL` 指向的就是这台 Strapi。

### 5. 梦境存进去了，但一直是「未命名的梦 / 未加工」

现象：日记流里有记录，但没有标题/摘要，带「未加工」标签。

说明：这是**正常的中间态**——原文已先落库，LLM 加工在后台异步进行，完成后会自动回写并去掉标签，刷新页面即可看到。若长时间不变成已加工：
- 看 MCP Server 日志是否有 `LLM 加工瞬时失败` / `LLM 加工最终失败` / `LLM 请求返回 4xx`。
  - `4xx`（永久失败，不重试）：多半是 `LLM_MODEL` 模型名不对或 `LLM_API_KEY` 无效 → 核对代理商支持的模型名与 key。
  - `fetch failed` / `5xx`（瞬时）：会自动重试；若持续失败，检查代理服务可用性与网络。
- 用内置脚本单独验证 LLM 这一环（不连小智、不写库）：
  ```bash
  cd mcp-server && npx tsx scripts/verify-llm.ts
  ```
- 修好 LLM 配置后**重启 MCP Server 即可**：开机补偿扫描会自动把所有 `aiProcessed=false` 的遗留记录重新排队补做加工。

### 6. 重启 MCP Server 后，之前漏加工的梦境会补上吗

会。MCP Server 连上接入点后会执行一次补偿扫描，日志形如 `补偿扫描：发现 N 条待加工梦境，重新入队`，把 Strapi 里所有 `aiProcessed=false` 的记录重新加工回写。因此 LLM 临时故障期间的记录不会永久丢失加工——原文始终完好，修好配置重启即可补齐。
