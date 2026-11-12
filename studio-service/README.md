# Studio_Service · 梦境小屋与分析助手

服务端组件，负责 Owner 登录认证、梦境写入、故事生成（Story）与 Dream_Agent（分析助手）。所有敏感密钥（Strapi Write_Token、LLM 密钥、Owner 口令、会话签名密钥）**只存在于本服务的环境变量中**，浏览器端与 Backend 均不持有。

## 组件边界

```
Frontend（GitHub Pages / Vercel，静态）
   │  HTTPS + 会话 Cookie / 凭证
   ▼
Studio_Service（本服务，:8787）──► LLM（OpenAI 兼容接口）
   │  Write_Token（custom，最小权限）
   ▼
Backend / Strapi（dream / story / agent-run）
```

- Frontend：只知道 `NUXT_PUBLIC_STUDIO_URL`，不含任何密钥。
- Studio_Service：认证、写入、LLM 调用、Agent 运行与进度查询均在此。
- Backend：存储数据；Write_Token 只授予所需的最小权限（不含 Dream 删除）。
- MCP Server：独立组件，使用自己的 `STRAPI_TOKEN`，与本服务互不依赖。

## 环境变量

完整清单与注释见 [`.env.example`](./.env.example)。以下仅列名称，请勿把真实值提交入库。

必填（缺失或不合规时启动失败，退出码 1）：

| 变量 | 说明 |
| --- | --- |
| `STUDIO_STRAPI_TOKEN` | Strapi Write_Token（见下文创建步骤） |
| `STUDIO_LLM_API_KEY` | LLM 密钥；Docker 编排下留空会回退到 `LLM_API_KEY` |
| `STUDIO_OWNER_PASSPHRASE` | Owner 登录口令，至少 12 个字符 |
| `STUDIO_SESSION_SECRET` | 会话签名密钥（HMAC-SHA256），随机值 |

生成会话密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

可选：`STUDIO_STRAPI_URL`、`STUDIO_LLM_BASE_URL`、`STUDIO_LLM_MODEL`、`STUDIO_LLM_PRICE_INPUT_PER_M`、`STUDIO_LLM_PRICE_OUTPUT_PER_M`、`CORS_ORIGIN`、`STUDIO_PORT`（默认 8787）、`STUDIO_TRUST_PROXY`、`STUDIO_MAX_STEPS`、`STUDIO_CONTEXT_BUDGET`、`TZ`、`LOG_LEVEL`。

> 口令过短会让「回答中出现密钥取值即整体脱敏」的机制误伤正常内容，因此要求至少 12 个字符。

## Token 创建步骤（`setup-access`）

Write_Token 由 Backend 的引导脚本创建，名称为 `studio-service-write`，类型 custom，仅包含 dream（find/findOne/create/update）、story（find/findOne/create/delete）、agent-run（find/findOne/create）权限：

```bash
cd backend
node ./scripts/setup-access.js
```

- 明文**仅首次创建时在控制台显示一次**，请立即保存到部署环境的 `STUDIO_STRAPI_TOKEN`。
- 若 Token 已存在，脚本不会再次显示明文；需先在 Strapi Admin 删除后重跑。
- 脚本同时会创建 MCP Server 用的 Token（`mcp-server-write`）并开放 Public 只读权限。

## 本地运行

```bash
cd studio-service
npm install
cp .env.example .env   # 填写四个必填变量
npm run build && npm start
npm test               # vitest run
```

可用脚本：`build`、`start`、`typecheck`、`test`、`eval`、`eval:offline`。

### 通过本地代理访问 LLM

Node 自带的 `fetch` 不会读取 macOS 系统代理。若浏览器、Cline 能访问 OpenAI，而本服务报 `llm_failure`、日志中出现 `fetch failed（UND_ERR_CONNECT_TIMEOUT）`，请让 Node 显式走代理启动（端口按你的代理软件实际值修改，此处为 `7897`）：

```bash
cd studio-service
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 NO_PROXY=localhost,127.0.0.1 npm start
```

- `NODE_USE_ENV_PROXY=1`：让 Node 内置 `fetch` 遵循代理环境变量（需 Node 22.21+ / 24.5+）。
- `NO_PROXY`：访问本机 Strapi 时不经过代理。
- 这些变量必须在进程启动前设置，写进 `.env` 不生效；也可以改为开启代理软件的 TUN 模式。

Docker 部署见根目录 `docker-compose.yml`（服务名 `studio-service`，端口 `8787:8787`，依赖 backend 健康检查通过，无挂卷）。

## 评估命令

评估套件位于 `eval/`，用于回归 Dream_Agent 行为：

```bash
npm run eval:offline                      # 脚本化 LLM，零费用，可重复
npm run eval                              # 真实 LLM，读取 STUDIO_LLM_* 环境变量，会产生费用
npm run eval -- --baseline <报告路径>     # 与上一份报告对比
```

报告写入 `eval/reports/`。评估只使用夹具数据源，不访问真实 Backend。

## SIGTERM 行为

收到 `SIGTERM`（如 `docker stop`）时服务会优雅退出：

1. 停止接收新连接，并停止登录限流的清理定时器；
2. 取消所有运行中的 Agent Run（最多等待约 5 秒）；
3. 排空梦境加工队列（上限 10 秒）；
4. 最多再等待 2 秒让连接关闭，然后以退出码 0 退出。

重复收到信号只会处理一次。

## 残余风险

- **HTTPS 要求**：Frontend 部署在 GitHub Pages（HTTPS）时，浏览器会拦截对 HTTP 的混合内容请求，Studio_Service 必须经 HTTPS 暴露（例如反向代理 + 证书），并将其公网地址配置为 CI 变量 `NUXT_PUBLIC_STUDIO_URL`；同时 `CORS_ORIGIN` 必须精确包含前端来源（如 `https://<用户名>.github.io`，不含路径）。位于反向代理后请设置 `STUDIO_TRUST_PROXY=true`。
- **内存状态重启即丢**：会话限流计数、Run 进度（结束后仅保留约 10 分钟）、加工队列中未完成的任务均只在内存中，进程重启或崩溃后丢失。已写入 Backend 的数据不受影响，但进行中的 Run 会被取消，需要重新发起。
- **单实例假设**：内存状态不跨实例共享，请不要水平扩展多个副本。
- **密钥边界**：CI 中运行 `scripts/check-secret-boundary.mjs`，确保 `frontend/` 与 `backend/` 不出现上述密钥的变量名或取值。
