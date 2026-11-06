# MCP Server

小智云端 MCP Server：作为 WebSocket 客户端主动连接官方 MCP 接入点，注册工具供小智大模型按意图调用。

## 工具

| 工具 | 说明 |
| --- | --- |
| `echo` | 测试工具，回显文本，用于验证接入点连通性 |
| `record_dream` | 记录梦境：LLM 加工（标题/摘要/关键词/情绪）后写入 Strapi |

## 工作原理

- 接入点协议：WS 连接直接承载 MCP 的 JSON-RPC 2.0 消息，每个文本帧即一条消息；接入点在「小智端」与本工具端之间转发。
- 本服务作为 WS 客户端拨出连接，**无需公网入站端口**，断线自动指数退避重连。
- `record_dream` 调用流程：LLM 加工 → 组装记录 → 写入 Strapi；LLM 加工失败时降级为仅保存原文（`aiProcessed=false`）。

## 本地启动

```bash
npm install
cp .env.example .env   # 填写接入点 URL、Strapi 地址与 Token、LLM 配置
npm run dev
```

## 环境变量

见 `.env.example`。关键项：

- `MCP_ENDPOINT`：从 xiaozhi.me 控制台（智能体 → 配置角色 → 意图识别 → 编辑功能 → MCP 接入点）复制的 `wss://.../mcp_endpoint/mcp/?token=...`。
- `STRAPI_URL` / `STRAPI_TOKEN`：Strapi 地址与写入 Token。
- `LLM_*`：OpenAI 兼容接口。不填 `LLM_API_KEY` 则自动降级为仅保存原文。

## 测试与构建

```bash
npm test        # 单元测试（消息/Strapi 写入/LLM 解析/工具逻辑）
npm run typecheck
npm run build   # 产出 dist/
npm start       # 运行编译后的 dist/index.js
```

## 生产守护（Task 7）

```bash
npm run build
pm2 start dist/index.js --name dream-mcp
# 或用根目录 docker-compose.yml 的 mcp-server 服务
```

服务内置断线重连，接入点或网络抖动后会自动恢复。
