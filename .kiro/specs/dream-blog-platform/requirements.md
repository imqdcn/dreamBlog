# Requirements Document

## Introduction

（简介）

Dream Blog（梦境日记）是一个通过语音记录梦境并以 Web 日记形式呈现的单体仓库系统。用户对 ESP32-S3 上的小智 AI 口述梦境，小智经官方 MCP 接入点调用 MCP 服务的 `record_dream` 工具；MCP 服务将原文写入 Strapi CMS，并在后台调用 OpenAI 兼容的 LLM 生成标题、摘要、关键词、情绪等结构化字段后回写；Nuxt 静态前端公开读取数据，提供日记流、详情页和统计可视化。

本文档由现有代码（backend、frontend、mcp-server、docker-compose.yml、GitHub Actions 工作流及各 README）反向整理而成，描述系统当前已实现的行为。

## Glossary

（术语表）

- **Dream_Blog**: 整个系统，包含 Backend、MCP_Server 和 Frontend 三个子项目。
- **Backend**: 基于 Strapi 5 的 CMS 服务，位于 `backend/`，提供 `dream` 内容类型和 REST API。
- **MCP_Server**: 位于 `mcp-server/` 的 TypeScript 常驻进程，通过 WebSocket 连接小智 MCP 接入点并暴露 MCP 工具。
- **Frontend**: 位于 `frontend/` 的 Nuxt 4 纯静态站点（`ssr:false`），只读访问 Backend。
- **Dream**: Backend 中的梦境记录，字段见需求 1。
- **Raw_Content**: 用户口述的原始梦境文本（字段 `rawContent`）。
- **Enrichment**: LLM 加工结果，包含 title、summary、keywords、emotion、emotionScore、clarity。
- **Enrichment_Queue**: MCP_Server 内串行消费加工任务的后台队列。
- **LLM_Processor**: MCP_Server 中调用 OpenAI 兼容 Chat Completions 接口的组件。
- **Strapi_Client**: MCP_Server 中访问 Backend REST API 的客户端。
- **MCP_Endpoint**: 小智官方提供的 WebSocket 接入点地址（环境变量 `MCP_ENDPOINT`）。
- **Write_Token**: 具备完全访问权限、用于 MCP_Server 写入的 Strapi API Token（名称 `mcp-server-write`）。
- **Setup_Script**: `backend/scripts/setup-access.js` 引导脚本。
- **Emotion**: 情绪枚举，取值 joyful、peaceful、neutral、anxious、fearful、sad、bizarre。
- **Deploy_Workflow**: `.github/workflows/deploy-frontend.yml` 定义的 GitHub Pages 部署流程。
- **Compose_Stack**: `docker-compose.yml` 定义的 Postgres、Backend、MCP_Server 三个服务。
- **Aggregator**: Frontend 中 `utils/aggregate.ts` 提供的统计聚合函数集合。

## Requirements

（需求列表）

### 需求 1：梦境数据模型

**用户故事：** 作为梦境记录者，我希望系统用结构化模型保存梦境原文和 AI 加工结果，以便后续检索与统计。

#### 验收标准

1. THE Backend SHALL 提供名为 `dream`（复数 `dreams`）的集合类型，并关闭草稿与发布机制，使每条 Dream 创建后即为已保存的最终状态，不存在草稿版本。
2. THE Backend SHALL 要求 Dream 的 `rawContent` 字段为必填文本，且去除首尾空白后长度为 1 到 20000 个字符。
3. THE Backend SHALL 为 Dream 提供可选字段 `title`（字符串，最长 200 个字符）、`summary`（文本，最长 5000 个字符）、`keywords`（JSON 数组，每个元素为字符串，最多 20 个元素）、`dreamedAt`（日期时间）。
4. THE Backend SHALL 将 Dream 的 `emotion` 字段限定为 joyful、peaceful、neutral、anxious、fearful、sad、bizarre 七个枚举值之一，且该字段为可选，未提供时存储为空值。
5. THE Backend SHALL 将 Dream 的 `emotionScore` 字段限定为 -1 到 1（含边界）之间的小数，且该字段为可选，未提供时存储为空值。
6. THE Backend SHALL 将 Dream 的 `clarity` 字段限定为 1 到 5（含边界）之间的整数，且该字段为可选，未提供时存储为空值。
7. WHEN 创建 Dream 的请求未提供 `aiProcessed` 字段, THE Backend SHALL 将该字段存储为 false。
8. WHEN 创建 Dream 的请求未提供 `source` 字段, THE Backend SHALL 将该字段存储为 `xiaozhi`。
9. IF 创建 Dream 的请求缺少 `rawContent`，或 `rawContent` 为空字符串或仅含空白字符，THEN THE Backend SHALL 返回 400 状态码、返回指明 `rawContent` 无效的错误信息，并且不创建任何 Dream 记录。
10. IF 创建或更新 Dream 的请求中 `emotion` 不在七个允许枚举值内，或 `emotionScore` 超出 -1 到 1，或 `clarity` 不是 1 到 5 之间的整数，THEN THE Backend SHALL 返回 400 状态码、返回指明无效字段的错误信息，并保持已有数据不变。

### 需求 2：Backend REST API 与访问控制

**用户故事：** 作为系统运维者，我希望前端可公开只读访问梦境，而写入必须携带令牌，以便保护数据。

#### 验收标准

1. THE Backend SHALL 通过 Strapi 核心路由暴露 `/api/dreams` 的列表（GET）、详情（GET `/api/dreams/:id`）、创建（POST）、更新（PUT `/api/dreams/:id`）和删除（DELETE `/api/dreams/:id`）共 5 个接口。
2. WHEN Setup_Script 被执行且名为 `mcp-server-write` 的 API Token 不存在，THE Setup_Script SHALL 创建该 Token（类型为 full-access，无过期时间），并在控制台仅打印一次明文。
3. WHEN Setup_Script 被执行且名为 `mcp-server-write` 的 API Token 已存在，THE Setup_Script SHALL 复用该 Token，不创建新 Token，不打印明文，并在控制台输出提示信息，说明明文无法再次显示以及需先在 Admin 后台删除该 Token 后重跑脚本才能获得新明文。
4. WHEN Setup_Script 被执行且 Public 角色存在，THE Setup_Script SHALL 为 Public 角色开启 `api::dream.dream.find` 与 `api::dream.dream.findOne` 两项权限，且不开启 `create`、`update`、`delete` 权限。
5. WHEN Setup_Script 被重复执行，THE Setup_Script SHALL 跳过 Public 角色已存在的权限，使 Public 角色上每个 dream 权限记录的数量保持为 1，并在控制台输出该权限已存在的提示。
6. IF Setup_Script 被执行时未找到 Public 角色，THEN THE Setup_Script SHALL 跳过权限配置并在控制台输出提示信息，同时仍完成 API Token 的创建或复用流程。
7. IF Setup_Script 执行过程中发生异常，THEN THE Setup_Script SHALL 在控制台输出错误信息，并以非 0 退出码终止。
8. WHEN 请求不携带 Token 访问 `GET /api/dreams` 或 `GET /api/dreams/:id`，THE Backend SHALL 返回 200 状态码及对应的 Dream 数据（列表或单条）。
9. IF 请求不携带 Token、携带无效 Token，或携带的 Token 缺少相应权限，且请求为创建、更新或删除 Dream，THEN THE Backend SHALL 返回 401 或 403 状态码，且不修改任何 Dream 数据。
10. WHEN 请求携带 `mcp-server-write` Token 的有效明文（Authorization: Bearer）执行创建、更新或删除，THE Backend SHALL 接受请求并执行相应操作。

### 需求 3：Backend 跨域与数据库配置

**用户故事：** 作为部署者，我希望通过环境变量控制跨域来源和数据库类型，以便在本地与生产使用不同配置。

#### 验收标准

1. WHEN Backend 启动且已设置 `CORS_ORIGIN`，THE Backend SHALL 将该值按英文逗号分隔为来源列表，并仅对列表内的来源在跨域响应中返回允许该来源访问的响应头。
2. IF 请求的 `Origin` 不在允许列表内，THEN THE Backend SHALL 不在响应中返回允许该来源访问的跨域响应头。
3. IF `CORS_ORIGIN` 未设置，THEN THE Backend SHALL 仅允许 `http://localhost:3000` 与 `http://localhost:4173` 两个来源。
4. IF `DATABASE_CLIENT` 未设置，THEN THE Backend SHALL 使用 SQLite，数据库文件路径默认为 `.tmp/data.db`（相对 Backend 项目根目录）。
5. WHERE `DATABASE_CLIENT` 设置为 `postgres`，THE Backend SHALL 使用 `DATABASE_HOST`、`DATABASE_PORT`、`DATABASE_NAME`、`DATABASE_USERNAME`、`DATABASE_PASSWORD` 连接 Postgres，其中 `DATABASE_PORT` 未设置时默认为 `5432`。
6. IF `DATABASE_CLIENT` 为 `postgres` 且数据库连接失败，THEN THE Backend SHALL 启动失败，并在终端输出指明数据库连接失败的错误信息，且不回退到 SQLite。
7. WHEN Backend 启动，THE Backend SHALL 默认监听 `0.0.0.0:1337`，并在设置了 `HOST` 或 `PORT` 时分别以其值覆盖默认主机或端口。

### 需求 4：MCP 接入点连接

**用户故事：** 作为梦境记录者，我希望 MCP 服务保持与小智接入点的长连接，以便随时通过语音触发记录。

#### 验收标准

1. WHEN MCP_Server 启动，THE MCP_Server SHALL 读取环境变量，并在 10 秒内通过 WebSocket 与 `MCP_ENDPOINT` 建立连接；若 10 秒内未建立连接，THE MCP_Server SHALL 将该次尝试视为连接失败并按验收标准 3 进入重连流程。
2. IF 环境变量 `MCP_ENDPOINT` 或 `STRAPI_TOKEN` 缺失、为空字符串或仅包含空白字符，THEN THE MCP_Server SHALL 向标准错误输出指明缺失变量名称的错误信息，不发起任何 WebSocket 连接，并以非零退出码退出进程。
3. WHEN 到接入点的 WebSocket 连接关闭或连接尝试失败，THE MCP_Server SHALL 按指数退避自动重连：第 1 次重连延迟为 `RECONNECT_BASE_DELAY_MS`（默认 1000ms），之后每次延迟翻倍，且单次延迟不超过 `RECONNECT_MAX_DELAY_MS`（默认 30000ms）；重连次数无上限，直至连接成功或进程退出。
4. WHEN 重连成功（WebSocket 连接建立），THE MCP_Server SHALL 将重连计数重置为 0，使下一次断线后的首次重连延迟恢复为 `RECONNECT_BASE_DELAY_MS`。
5. WHEN 接入点发送 `tools/list` 请求，THE MCP_Server SHALL 返回恰好包含 `echo` 与 `record_dream` 两个工具定义的响应，且响应的请求标识与该请求一致。
6. IF 接入点发送的消息不是合法 JSON，或请求的方法名不被支持，THEN THE MCP_Server SHALL 返回指明错误类型的错误响应（无法解析时不带请求标识），保持 WebSocket 连接不断开，并继续处理后续消息。
7. WHEN 收到 SIGINT 或 SIGTERM，THE MCP_Server SHALL 停止自动重连，关闭 WebSocket 连接，并等待 Enrichment_Queue 排空，最长等待 60 秒。
8. WHEN Enrichment_Queue 已排空或等待满 60 秒，THE MCP_Server SHALL 退出进程；排空时以退出码 0 退出，超时则记录含未完成任务数量的警告并以非零退出码退出。
9. WHEN MCP_Server 启动，THE MCP_Server SHALL 对 Strapi 执行一次连通性自检，自检超时时间为 5 秒。
10. IF Strapi 连通性自检失败或超时，THEN THE MCP_Server SHALL 记录一条包含失败原因的警告日志，且继续执行 WebSocket 连接流程而不退出。

### 需求 5：echo 工具

**用户故事：** 作为开发者，我希望有一个回显工具，以便验证接入点链路是否连通。

#### 验收标准

1. WHEN 工具 `echo` 被调用并传入长度为 0 至 10,000 个字符的字符串类型 `text`，THE MCP_Server SHALL 在 1 秒内返回 `isError` 不为 true 的工具结果，且结果内容为一个文本项，其文本与传入的 `text` 逐字符完全相同（包括空白字符、换行和 Unicode 字符，不做任何裁剪、转义或转换）。
2. IF 调用 `echo` 时缺少 `text` 参数，或 `text` 不是字符串类型（例如数字、布尔值、null、对象、数组），THEN THE MCP_Server SHALL 返回 `isError` 为 true 的工具结果，结果内容包含一条指明 `text` 参数缺失或类型无效的错误信息，且 MCP_Server 保持运行并可继续处理后续请求。
3. IF 调用 `echo` 时传入的 `text` 长度超过 10,000 个字符，THEN THE MCP_Server SHALL 返回 `isError` 为 true 的工具结果，结果内容包含一条指明 `text` 超出长度上限的错误信息，且不返回任何被截断的文本。

### 需求 6：record_dream 工具（快速落库）

**用户故事：** 作为梦境记录者，我希望说出梦境后立即得到确认且内容不丢失，以便无需等待 AI 处理。

#### 验收标准

1. WHEN 工具 `record_dream` 被调用且 `content` 为去除首尾空白后长度 1 至 10000 个字符的字符串，THE MCP_Server SHALL 通过 Strapi_Client 创建 Dream，其 `rawContent` 为 `content`、`source` 为 `xiaozhi`、`aiProcessed` 为 false。
2. WHERE 调用参数包含符合 ISO 8601 格式的 `dreamedAt`，THE MCP_Server SHALL 将其作为 Dream 的 `dreamedAt`。
3. WHERE 调用参数不包含 `dreamedAt`，THE MCP_Server SHALL 使用调用时刻的当前时间的 ISO 8601 字符串作为 `dreamedAt`。
4. IF 调用参数包含 `dreamedAt` 但其不是有效的 ISO 8601 字符串，THEN THE MCP_Server SHALL 返回 `isError` 为 true 且包含日期格式无效提示的工具结果，且不创建 Dream。
5. WHEN Dream 创建成功，THE MCP_Server SHALL 在 Strapi_Client 返回创建成功响应后 1 秒内返回包含确认文案的工具结果（`isError` 为 false），且不等待 LLM 加工完成。
6. WHEN Dream 创建成功且响应包含非空 `documentId`，THE MCP_Server SHALL 将该 `documentId` 对应的加工任务加入 Enrichment_Queue。
7. IF Dream 创建成功但响应不含 `documentId` 或 `documentId` 为空，THEN THE MCP_Server SHALL 跳过后台加工、记录一条警告日志，并仍返回 `isError` 为 false 的确认文案。
8. IF `content` 缺失、为空字符串、仅含空白字符或超过 10000 个字符，THEN THE MCP_Server SHALL 返回 `isError` 为 true 且包含内容无效提示的工具结果，且不创建 Dream。
9. IF Strapi_Client 在最多 3 次尝试（含首次）后仍写入失败，THEN THE MCP_Server SHALL 返回 `isError` 为 true 且包含提示用户稍后重试的友好文案的工具结果，且不将加工任务加入 Enrichment_Queue。
10. IF 调用的工具名不存在，THEN THE MCP_Server SHALL 返回 `isError` 为 true 且包含「未知工具」的工具结果。

### 需求 7：Strapi 写入客户端

**用户故事：** 作为系统运维者，我希望写入 Strapi 时具备鉴权与重试，以便在瞬时故障下仍能保存数据。

#### 验收标准

1. THE Strapi_Client SHALL 在每个发往 Strapi 的请求中携带值为 `Bearer <STRAPI_TOKEN>` 的 `Authorization` 头。
2. IF `STRAPI_TOKEN` 未设置或为空字符串，THEN THE Strapi_Client SHALL 在发送任何请求之前报错，错误信息指明缺少 `STRAPI_TOKEN`，且不发出网络请求。
3. WHERE 环境变量 `STRAPI_URL` 已设置且非空，THE Strapi_Client SHALL 使用 `STRAPI_URL` 作为所有请求的基地址；未设置或为空时，THE Strapi_Client SHALL 使用 `http://localhost:1337`。
4. WHEN 创建 Dream，THE Strapi_Client SHALL 向 `POST /api/dreams` 发送请求体 `{data: 记录}`，并在收到 2xx 响应后返回响应中的 `data` 内容。
5. WHEN 回写 Enrichment，THE Strapi_Client SHALL 向 `PUT /api/dreams/{documentId}` 发送请求体 `{data: 部分字段}`，其中仅包含调用方提供的字段，并在收到 2xx 响应后返回响应中的 `data` 内容。
6. IF Strapi 返回 5xx 状态码或发生网络错误（连接失败、连接被重置或单次请求超过 10 秒未响应），THEN THE Strapi_Client SHALL 以 500ms 为基准指数退避（第 1 次重试前等待 500ms，第 2 次重试前等待 1000ms），最多重试 2 次（含首次请求共最多 3 次请求）。
7. IF 重试 2 次后请求仍然失败，THEN THE Strapi_Client SHALL 报错，错误信息包含最后一次失败的状态码或网络错误原因，且已发送的请求次数为 3。
8. IF Strapi 返回 4xx 状态码，THEN THE Strapi_Client SHALL 不重试，并在收到响应后立即报错，错误信息包含该状态码及 Strapi 返回的错误描述（如有）。
9. IF Strapi 返回 2xx 响应但响应体不是合法 JSON，或缺少 `data` 字段，或 `data` 为 `null`，THEN THE Strapi_Client SHALL 不重试并报错，错误信息指明响应缺少有效的 `data`。
10. IF 请求最终失败（报错），THEN THE Strapi_Client SHALL 保持调用方传入的记录数据不被修改，以便调用方可以再次提交。

### 需求 8：LLM 梦境加工

**用户故事：** 作为梦境记录者，我希望系统自动为梦境生成标题、摘要、关键词和情绪，以便日记更易阅读。

#### 验收标准

1. WHEN LLM_Processor 处理 Raw_Content，THE LLM_Processor SHALL 向 `{LLM_BASE_URL}/chat/completions` 发送带 Bearer 鉴权、`temperature` 为 0.5 且要求 `json_object` 格式的请求。
2. THE LLM_Processor SHALL 在系统提示词中要求 title 不超过 20 字、summary 不超过 80 字、keywords 为 3 至 6 个、emotion 为七个枚举值之一、emotionScore 为 -1 到 1 的数字、clarity 为 1 到 5 的整数。
3. THE LLM_Processor SHALL 默认使用 `LLM_BASE_URL=https://api.openai.com/v1` 与 `LLM_MODEL=gpt-4o-mini`，并允许通过环境变量覆盖。
4. IF `LLM_API_KEY` 为空字符串或未设置，或 `LLM_ENABLED` 为 `false`，THEN THE LLM_Processor SHALL 跳过加工且不发送任何 LLM 请求，并使 Dream 仅保存 Raw_Content，title、summary、keywords、emotion 字段保持未填充。
5. WHEN LLM 返回的 emotion 不在七个枚举值内或缺失，THE LLM_Processor SHALL 将 emotion 取值为 neutral。
6. WHEN LLM 返回的 emotionScore 为数字且超出 -1 到 1，THE LLM_Processor SHALL 将其限制到 -1 到 1 的闭区间内（小于 -1 取 -1，大于 1 取 1）。
7. WHEN LLM 返回的 clarity 为数字，THE LLM_Processor SHALL 将其四舍五入为整数并限制在 1 到 5 之间。
8. WHEN LLM 返回内容被 markdown 代码块围栏（如 ```json … ```）包裹，THE LLM_Processor SHALL 剥离围栏后解析 JSON。
9. IF LLM 返回内容无法解析为 JSON，或 title、summary、keywords 均为空，THEN THE LLM_Processor SHALL 视为加工失败，返回空结果，且 Dream 仍保存 Raw_Content。
10. IF LLM 请求发生网络错误、超过 30 秒未响应或返回 5xx，THEN THE LLM_Processor SHALL 以 1000ms 为基准指数退避（第 1 次重试前等待 1000ms，第 2 次重试前等待 2000ms），最多重试 2 次；IF 重试用尽仍失败，THEN THE LLM_Processor SHALL 返回空结果，且 Dream 仍保存 Raw_Content。
11. IF LLM 请求返回 4xx 或响应缺少 content，THEN THE LLM_Processor SHALL 不重试并返回空结果，且 Dream 仍保存 Raw_Content。

### 需求 9：后台加工队列与补偿

**用户故事：** 作为梦境记录者，我希望 AI 加工在后台完成且异常后能自动补齐，以便不遗漏任何记录的整理。

#### 验收标准

1. THE Enrichment_Queue SHALL 以单 worker 串行方式消费加工任务，任意时刻最多有 1 个加工任务处于执行状态，任务按入队先后顺序（FIFO）执行。
2. WHEN 加工任务成功产出 Enrichment，THE Enrichment_Queue SHALL 通过 Strapi_Client 在单次回写请求中写入 title、summary、keywords、emotion、emotionScore，并将 `aiProcessed` 置为 true。
3. WHERE Enrichment 包含 clarity，THE Enrichment_Queue SHALL 在验收标准 2 所述的同一次回写请求中一并写入 clarity。
4. IF 加工在 60 秒内未产出结果，THEN THE Enrichment_Queue SHALL 终止该任务，保持该 Dream 的原文内容及 `aiProcessed` 为 false 不变，记录包含 Dream 标识与失败原因的日志，并在 1 秒内开始处理下一个排队任务。
5. IF 通过 Strapi_Client 的回写失败（请求报错或超时 30 秒），THEN THE Enrichment_Queue SHALL 保持该 Dream 的原文内容及 `aiProcessed` 为 false 不变，记录包含 Dream 标识与失败原因的日志，并在 1 秒内开始处理下一个排队任务。
6. WHEN MCP_Server 连接接入点成功，THE Enrichment_Queue SHALL 查询所有 `aiProcessed` 为 false 的 Dream（分页，每页 100 条，按 createdAt 升序），直到返回条数少于 100 为止，并将查询到的 Dream 按查询顺序重新入队。
7. IF 补偿扫描的任一分页查询失败，THEN THE Enrichment_Queue SHALL 终止本次补偿扫描，保留已入队的任务，记录包含失败页码与失败原因的错误日志，并保持 MCP_Server 继续运行且可接收新任务。
8. IF 补偿扫描查询到的 Dream 已在队列中或正在加工，THEN THE Enrichment_Queue SHALL 跳过该 Dream，不重复入队。

### 需求 10：前端日记流

**用户故事：** 作为访客，我希望在首页按时间倒序浏览梦境卡片，以便快速回顾。

#### 验收标准

1. THE Frontend SHALL 以纯静态站点方式构建（`ssr:false`），并在所有页面顶部提供「日记流」与「统计」两个导航入口。
2. WHEN 首页加载，THE Frontend SHALL 从 `NUXT_PUBLIC_STRAPI_URL` 读取 Dream 列表，并按 `dreamedAt:desc` 排序；IF `NUXT_PUBLIC_STRAPI_URL` 未配置，THEN THE Frontend SHALL 使用默认值 `http://localhost:1337`。
3. WHEN 首页加载，THE Frontend SHALL 以每页 100 条的分页方式依次请求 Dream，直到返回条数少于 100 条或已到达分页元数据中的最后一页，并将全部结果合并为一个列表展示。
4. THE Frontend SHALL 为每条 Dream 卡片展示以下内容：情绪标签、`YYYY-MM-DD HH:mm` 格式的 `dreamedAt` 时间（使用浏览器本地时区）、标题、最多 90 个字符的摘要（超出部分截断并以「…」结尾）、以及最多 5 个关键词（超出部分不显示）。
5. WHERE Dream 的 summary 为空或缺失，THE Frontend SHALL 使用 Raw_Content 的前 90 个字符作为摘录（超出部分截断并以「…」结尾）。
6. WHERE Dream 的 title 为空或缺失，THE Frontend SHALL 显示「未命名的梦」。
7. WHERE Dream 的 `aiProcessed` 不为 true，THE Frontend SHALL 在该卡片上显示「未加工」标签。
8. WHILE 数据加载中，THE Frontend SHALL 显示「正在加载梦境…」，并且不显示空状态文案与错误提示。
9. IF 任一分页请求失败（网络错误或服务端返回非成功响应），THEN THE Frontend SHALL 停止加载，显示加载失败提示及包含失败原因的错误信息，并且不显示部分已加载的卡片与空状态文案。
10. IF 加载成功且 Dream 列表数量为 0，THEN THE Frontend SHALL 显示引导用户对小智记录梦境的空状态文案。
11. WHEN 用户点击 Dream 卡片，THE Frontend SHALL 跳转到 `/dream/{documentId}`；IF 该 Dream 缺少 documentId，THEN THE Frontend SHALL 使用 `id` 代替 `{documentId}`。
12. THE Frontend SHALL 为每种 Emotion 显示对应的中文名称、颜色和 emoji；IF Emotion 缺失或不属于已定义的 Emotion 取值，THEN THE Frontend SHALL 显示「未知」名称及默认颜色与默认 emoji。

### 需求 11：前端梦境详情页

**用户故事：** 作为访客，我希望查看单条梦境的完整信息，以便阅读原文和 AI 整理结果。

#### 验收标准

1. WHEN 用户访问 `/dream/{id}`，THE Frontend SHALL 通过 `GET /api/dreams/{id}` 读取该 Dream，并在请求发出后至 10 秒内收到响应前显示加载状态。
2. WHEN Dream 读取成功，THE Frontend SHALL 在详情页展示情绪标签、时间、标题、摘要、全部关键词（不截断，数量不设上限）和 Raw_Content（完整原文，不截断，保留原文换行）。
3. WHERE Dream 的 clarity 为 1 到 5 的整数，THE Frontend SHALL 显示「清晰度 N/5」，其中 N 为该整数值。
4. IF Dream 的 clarity 不是 1 到 5 的整数（包括为空或缺失），THEN THE Frontend SHALL 不显示清晰度文本。
5. IF Dream 的某个可选字段（情绪标签、摘要、关键词）为空或缺失，THEN THE Frontend SHALL 不渲染该字段的内容，且页面其余字段仍正常展示。
6. WHEN 用户点击「← 返回日记流」，THE Frontend SHALL 导航到首页。
7. IF 读取失败、请求超过 10 秒未响应、`{id}` 对应的 Dream 不存在，THEN THE Frontend SHALL 显示「未找到这条梦境。」，且不显示任何 Dream 字段内容，并保留「← 返回日记流」入口。
8. THE Frontend SHALL 兼容 Strapi v5 平铺结构与 v4 `attributes` 包裹结构的响应，并对两种结构的同一 Dream 展示相同的字段内容。

### 需求 12：前端统计可视化

**用户故事：** 作为梦境记录者，我希望通过图表了解情绪与主题的规律，以便洞察自己的梦境。

#### 验收标准

1. WHEN 用户访问 `/stats` 页面且至少存在 1 条 Dream，THE Frontend SHALL 在该页面展示情绪趋势折线图、情绪分布柱状图、关键词云和梦境日历热力图这 4 个图表。
2. THE Aggregator SHALL 统计每种 Emotion 的出现次数，忽略 emotion 为空或缺失的 Dream，并按次数降序排列；次数相同时按 Emotion 名称的字典序升序排列。
3. THE Aggregator SHALL 汇总所有 Dream 的关键词词频，对每个关键词去除首尾空白，忽略去除空白后为空字符串的关键词，按频次降序排列，频次相同时按关键词字典序升序排列，默认最多返回 60 项。
4. THE Aggregator SHALL 以 `dreamedAt` 优先、`createdAt` 回退确定 Dream 的归属日期，格式为 `YYYY-MM-DD`。
5. IF `dreamedAt` 与 `createdAt` 均缺失或均无法解析为有效日期, THEN THE Aggregator SHALL 在所有按日期统计的结果中忽略该 Dream，且不中断对其余 Dream 的统计。
6. THE Aggregator SHALL 按日期升序返回每日 Dream 数量，仅包含至少有 1 条 Dream 的日期。
7. THE Aggregator SHALL 按日期升序返回每日平均 emotionScore，四舍五入保留 3 位小数，忽略缺少 emotionScore 或 emotionScore 不是有限数值的 Dream；若某日所有 Dream 均被忽略，则该日不出现在结果中。
8. WHILE 统计数据加载中，THE Frontend SHALL 显示文案「正在统计…」，并在加载完成或失败后移除该文案。
9. IF 系统中没有任何 Dream, THEN THE Frontend SHALL 显示提示数据不足的空状态文案，且不渲染任何图表。
10. IF 统计数据加载失败, THEN THE Frontend SHALL 显示指示加载失败的错误提示，且不渲染任何图表。

### 需求 13：前端部署

**用户故事：** 作为部署者，我希望前端可自动发布到 GitHub Pages，以便无需自建静态服务器。

#### 验收标准

1. WHEN 向 main 或 master 分支推送且变更文件路径匹配 `frontend/**` 或 `.github/workflows/deploy-frontend.yml`，THE Deploy_Workflow SHALL 触发一次构建与部署运行。
2. IF 向 main 或 master 分支推送且变更文件路径均不匹配 `frontend/**` 与 `.github/workflows/deploy-frontend.yml`，THEN THE Deploy_Workflow SHALL 不触发运行。
3. WHEN 用户在 GitHub 上手动触发（workflow_dispatch），THE Deploy_Workflow SHALL 触发一次构建与部署运行，且不要求存在路径变更。
4. WHEN Deploy_Workflow 运行构建任务，THE Deploy_Workflow SHALL 使用 Node 20，在 `frontend/` 目录依次执行 `npm ci` 与 `npm run generate`。
5. WHEN `npm run generate` 成功完成，THE Deploy_Workflow SHALL 将 `frontend/.output/public` 目录上传为 Pages 产物，并在上传成功后执行部署任务。
6. IF `npm ci`、`npm run generate` 或产物上传任一步骤以非零状态退出，THEN THE Deploy_Workflow SHALL 将该运行标记为失败，且不执行部署任务，已发布的线上站点保持不变。
7. WHEN Deploy_Workflow 执行 `npm run generate`，THE Deploy_Workflow SHALL 从仓库变量 `NUXT_PUBLIC_STRAPI_URL` 与 `NUXT_APP_BASE_URL` 读取值，并作为同名环境变量传入构建步骤。
8. WHERE 设置了非空的 `NUXT_APP_BASE_URL`，THE Frontend SHALL 以该值作为站点 baseURL；IF 该变量未设置或为空字符串，THEN THE Frontend SHALL 使用 `/` 作为 baseURL。
9. WHEN 同一并发组 `pages` 内有新的运行启动，THE Deploy_Workflow SHALL 取消该并发组内所有进行中的旧运行。
10. WHEN Frontend 完成静态生成，THE Frontend SHALL 在产物根目录输出 `404.html` 回退页，使刷新动态路由（如 `/dream/:id`）时加载应用入口而非 GitHub Pages 默认 404 页面。

### 需求 14：Docker 自托管部署

**用户故事：** 作为部署者，我希望用一条命令在云服务器启动后端与 MCP 服务，以便快速上线。

#### 验收标准

1. WHEN 部署者在包含根目录 `.env` 的目录执行一次 `docker compose up -d`, THE Compose_Stack SHALL 创建并启动 `postgres`（postgres:16-alpine）、`backend` 和 `mcp-server` 三个服务，且每个服务均设置 `restart: unless-stopped`。
2. THE Compose_Stack SHALL 为 `postgres` 服务配置基于 `pg_isready` 的健康检查，检查间隔不超过 10 秒，单次超时不超过 5 秒，连续失败 5 次后判定为 unhealthy。
3. WHEN `postgres` 服务健康检查状态变为 healthy, THE Compose_Stack SHALL 启动 `backend` 服务；在此之前 `backend` 服务不得启动。
4. WHEN `backend` 服务启动完成, THE Compose_Stack SHALL 启动 `mcp-server` 服务；在此之前 `mcp-server` 服务不得启动。
5. THE Compose_Stack SHALL 使 `mcp-server` 通过 `http://backend:1337` 访问 Backend。
6. THE Compose_Stack SHALL 使用命名卷 `pgdata` 持久化 Postgres 数据，使用命名卷 `uploads` 持久化 Backend 上传文件，且执行 `docker compose down`（不带 `-v`）后再次启动时两个卷中的数据保持不变。
7. THE Compose_Stack SHALL 将 Backend 容器的 1337 端口映射到宿主机的 1337 端口。
8. THE Compose_Stack SHALL 从根目录 `.env` 读取 Strapi 密钥、数据库凭据、`CORS_ORIGIN`、`MCP_ENDPOINT`、`STRAPI_TOKEN` 及 LLM 相关变量，并传递给对应服务。
9. IF 根目录 `.env` 中缺少 Strapi 密钥或数据库凭据中的任一必需变量, THEN THE Compose_Stack SHALL 使 `docker compose up` 以非零退出码终止，并输出指明缺失变量名称的错误信息，且不创建任何容器。
10. WHERE `LLM_ENABLED` 未在 `.env` 中设置, THE Compose_Stack SHALL 将其默认值设为 `true`。
11. WHERE `LOG_LEVEL` 未在 `.env` 中设置, THE Compose_Stack SHALL 将其默认值设为 `info`。
12. IF `backend` 或 `mcp-server` 容器异常退出, THEN THE Compose_Stack SHALL 在 10 秒内自动重启该容器，且 `pgdata` 与 `uploads` 卷中的数据不丢失。

### 需求 15：配置与密钥管理

**用户故事：** 作为开发者，我希望敏感信息不入库且各子项目配置清晰，以便安全地运行与部署。

#### 验收标准

1. THE Dream_Blog SHALL 在 Backend、MCP_Server、Frontend 三个子项目目录及仓库根目录各提供 1 个 `.env.example` 模板文件（共 4 个），且每个模板列出该项目运行所需的全部环境变量名，所有敏感变量的值为空或占位符，不包含真实密钥。
2. THE Dream_Blog SHALL 在 `.gitignore` 中配置规则，使仓库根目录及 Backend、MCP_Server、Frontend 各子目录下的 `.env` 文件不被 Git 跟踪，同时 `.env.example` 文件不被忽略。
3. THE Dream_Blog SHALL 仅在 MCP_Server 进程的环境变量中配置和读取 LLM 密钥，Backend 与 Frontend 的 `.env.example`、源代码及构建产物中出现 LLM 密钥变量名的次数为 0。
4. THE Dream_Blog SHALL 在 README 中包含本地开发模式与 Docker 部署模式的对比说明，至少涵盖以下 3 项：各模式使用的 `.env` 文件位置（本地为各子项目目录下独立的 `.env`，Docker 为仓库根目录的 `.env`）、环境变量的加载方式、各模式的启动命令。
5. THE Dream_Blog SHALL 在 README 中提供排错指南，且指南至少包含连接、触发、写入、前端展示、加工状态 5 类问题，每类问题至少给出 1 个现象描述及对应的检查步骤或解决办法。
6. IF 根目录或子项目的 `.env` 文件已被 Git 跟踪（`git ls-files` 输出包含 `.env`），THEN THE Dream_Blog SHALL 在 README 中提供将其从版本控制中移除的步骤，且保留本地文件内容不变。
