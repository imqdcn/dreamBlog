# Backend · Strapi CMS

梦境数据的内容管理与 REST API。

## 内容类型：Dream

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `rawContent` | text（必填） | 原始口述的梦境内容 |
| `title` | string | LLM 生成的标题 |
| `summary` | text | LLM 生成的摘要 |
| `keywords` | json | LLM 提取的关键词数组 |
| `emotion` | enum | joyful/peaceful/neutral/anxious/fearful/sad/bizarre |
| `emotionScore` | decimal(-1~1) | 情绪倾向打分 |
| `clarity` | integer(1~5) | 梦境清晰度 |
| `dreamedAt` | datetime | 做梦/记录时间 |
| `aiProcessed` | boolean | 是否已成功 LLM 加工 |
| `source` | string | 记录来源，默认 `xiaozhi` |

## 本地启动

```bash
npm install
# 首次会自动生成 .env（含随机密钥）；若无则复制 .env.example 并填好密钥
npm run develop   # 开发模式，http://localhost:1337/admin
```

首次进入 Admin 创建管理员账号。

## 配置访问权限（签发 Token + 开放只读）

停掉正在运行的 Strapi 后执行（SQLite 不允许并发写）：

```bash
node ./scripts/setup-access.js
```

脚本会：
- 创建名为 `mcp-server-write` 的 full-access API Token 并打印明文（仅首次可见），填入 `mcp-server/.env` 的 `STRAPI_TOKEN`。
- 为 Public 角色开启 `dream` 的 `find` / `findOne` 只读权限，供前端公开读取。

## REST API

```bash
# 写入（需 Token）
curl -X POST http://localhost:1337/api/dreams \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"data":{"rawContent":"..."}}'

# 读取（公开）
curl "http://localhost:1337/api/dreams?sort=dreamedAt:desc"
```

## 生产部署（Task 7）

- 切换数据库到 Postgres：在 `.env` 设置 `DATABASE_CLIENT=postgres` 与 `DATABASE_URL`（见 `.env.example`）。
- 配置 `CORS_ORIGIN` 为前端线上域名（逗号分隔）。
- 用 Docker 运行见根目录 `docker-compose.yml`，或 `npm run build && npm run start` 配 pm2/systemd 守护。
