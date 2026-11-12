# Requirements Document

## Introduction

本功能在现有 Dream Blog（梦境日记）基础上，参考「拾梦 / Dream Diary」的产品形态，新增两大能力：

1. **梦境小屋**：梦境手记、珍藏的梦、梦境日历、梦境宇宙，以及「把梦，写成新的故事」（选择 1 到 5 场梦作为灵感，按所选风格生成故事并收藏）和「梦的另一种可能」（已生成故事列表）。
2. **梦境分析助手（Dream_Agent）**：一个真正的 agent。LLM 在循环中自主选择工具、多步调用，直到给出最终回答（例如回答「我最近为什么总梦到坠落？」）。工具包括搜索梦境、查询情绪趋势、查找相似梦、读取单条梦境等。

本功能的求职展示重点是 agent 工程能力，因此需求显式覆盖：工具设计、循环终止与错误处理（最大步数、重复调用检测）、上下文管理、离线评估、可观测性（调用链、token 与成本）、安全（提示词注入防护、权限边界）。

### 架构约束与新增组件

现有系统中，Frontend 是匿名只读的纯静态站点，MCP_Server 是只有出站 WebSocket 连接、没有 HTTP 监听的常驻进程，且 Public 角色只有 dream 的 find 与 findOne 权限。新功能需要写入（保存故事、珍藏、标签）、调用 LLM、并向 Frontend 提供在线接口，现有组件无法在不破坏既有安全约束的前提下承担这些职责。因此本功能做如下划分：

- **新增服务 Studio_Service**：独立的服务端组件，对 Frontend 提供 HTTP 接口，是本功能中 Write_Token 与 LLM 密钥的持有者，承载故事生成、写入类操作与 Dream_Agent 循环。
- **Backend**：新增 Story、Agent_Run 内容类型及 Dream 的新增字段，仍是唯一的数据存储；对 Public 角色只开放读取。
- **MCP_Server**：职责保持不变（`record_dream` 与加工队列）。
- **Frontend**：仍为纯静态站点，只持有 Studio_Service 的地址与登录后获得的短期 Owner_Session，不持有 Write_Token，也不持有 LLM 密钥。

本功能为现有需求 15 第 3 条（LLM 密钥仅存在于 MCP_Server）的扩展：LLM 密钥允许存在于 MCP_Server 与 Studio_Service 两个服务端组件，Backend 与 Frontend 仍不得出现。

## Glossary

- **Dream_Blog**: 整个系统，包含 Backend、MCP_Server、Frontend 和 Studio_Service。
- **Backend**: 基于 Strapi 5 的 CMS 服务，提供 Dream、Story、Agent_Run 内容类型与 REST API。
- **MCP_Server**: 现有的 MCP 常驻进程，本功能不改变其职责。
- **Frontend**: Nuxt 4 纯静态站点（`ssr:false`），所有写入与 LLM 调用均通过 Studio_Service 完成。
- **Studio_Service**: 本功能新增的服务端组件，提供 HTTP 接口，持有 Write_Token 与 LLM_Key，承载 Story_Generator、Dream_Agent 和写入类接口。
- **Owner**: 梦境的主人，即唯一有权执行写入和使用 Dream_Agent 的用户。
- **Visitor**: 未登录的访客，只能读取公开的 Dream 与 Story。
- **Owner_Passphrase**: Owner 登录所用的口令，仅配置在 Studio_Service 的环境变量中，长度不少于 12 个字符。
- **Owner_Session**: Owner 登录成功后由 Studio_Service 签发的短期会话凭证。
- **Write_Token**: 具备 Dream、Story、Agent_Run 写权限的 Strapi API Token，仅存在于 Studio_Service 与 MCP_Server 的环境变量中。
- **LLM_Key**: OpenAI 兼容 LLM 服务的 API 密钥，仅存在于 MCP_Server 与 Studio_Service 的环境变量中。
- **Dream**: Backend 中的梦境记录，沿用现有字段并新增 `isFavorite` 与 `tags`。
- **Favorite_Dream**: `isFavorite` 为 true 的 Dream，对应界面中的「珍藏的梦」。
- **Tag**: Owner 为 Dream 或 Story 附加的标签，字符串，去除首尾空白后长度 1 到 20 个字符。
- **Enrichment_Status**: Dream 加工状态，取值 pending（加工尚未完成）、done（加工成功）、failed（加工失败，附带错误码），可通过 Studio_Service 的状态查询获得。
- **Source_Snapshot**: Story 创建时保存的来源 Dream 快照，为 `{documentId, title}` 的有序列表，创建后不随来源 Dream 的变化或删除而改变。
- **Run_Id**: Agent_Run 的全局唯一运行标识。
- **Story**: 由 Story_Generator 根据所选 Dream 生成并保存的故事，字段包括 title、content、style、tags、sourceDreams、sourceSnapshot、createdAt。
- **Story_Style**: 故事风格枚举，取值 gentle_fairytale（温柔童话）、mystery（悬疑）、sci_fi（科幻）、poetic（散文诗）。
- **Story_Generator**: Studio_Service 中调用 LLM 把所选 Dream 写成 Story 的组件。
- **Source_Dream_Set**: 用户为生成 Story 勾选的「作为故事灵感」的 Dream 集合。
- **Dream_Agent**: Studio_Service 中的梦境分析助手，在循环中让 LLM 自主选择 Agent_Tool 并多步调用，直到产出最终回答。
- **Agent_Loop**: Dream_Agent 的一次运行循环，每一步由「LLM 决策、工具执行、结果回填」组成。
- **Agent_Tool**: Dream_Agent 可调用的工具，包括 search_dreams、get_dream、emotion_trend、find_similar_dreams、keyword_stats。
- **Agent_Step**: Agent_Loop 中的一步，即一次 LLM 调用及其触发的 0 到多次 Agent_Tool 调用。
- **Max_Steps**: 单次 Agent_Loop 允许的最大 Agent_Step 数，默认 8。
- **Agent_Run**: 一次 Dream_Agent 运行的完整记录，包含 Run_Id、问题、Agent_Step 序列与步数、最终回答、终止原因、是否被安全替换（redacted）、token 用量、用量是否为估算值（usageEstimated）和估算成本。
- **Termination_Reason**: Agent_Run 的终止原因枚举，取值 answered、max_steps、repeated_call、token_budget、timeout、tool_failure、llm_failure、cancelled。
- **Trace**: Agent_Run 中按时间顺序记录的 Agent_Step 与 Agent_Tool 调用链。
- **Context_Budget**: 单次 Agent_Loop 发送给 LLM 的上下文 token 上限，默认 12000。
- **Untrusted_Content**: 来自 Dream 原文、Story 正文、标签和 Agent_Tool 返回结果中的文本，这些文本可能含有指令式内容。
- **Eval_Suite**: Dream_Agent 的离线评估用例集合及评分脚本。
- **Eval_Case**: Eval_Suite 中的单个用例，包含问题、固定的 Dream 数据夹具、期望调用的 Agent_Tool、期望出现的事实和禁止出现的内容。
- **Similarity_Score**: 两条 Dream 之间 0 到 1 的相似度数值，数值越大越相似。
- **Dream_Universe**: 以 Dream 为节点、以 Similarity_Score 达到阈值的关系为边的关系图视图，对应界面中的「梦境宇宙」。

## Requirements

### Requirement 1: Studio_Service 部署与密钥边界

**User Story:** 作为系统运维者，我希望写入和 LLM 调用集中在一个新增的服务端组件中，以便 LLM 密钥和写令牌不进入前端。

#### Acceptance Criteria

1. THE Studio_Service SHALL 以独立于 Frontend、Backend 与 `mcp-server` 的操作系统进程运行，并在配置的监听端口上对 Frontend 提供 HTTP 接口。
2. THE Compose_Stack SHALL 在现有 `postgres`、`backend`、`mcp-server` 之外增加 `studio-service` 服务，其 `restart` 策略为 `unless-stopped`；前置条件为 Backend 具备可被 Compose_Stack 探测的健康检查，`studio-service` 配置为在 `backend` 服务达到健康状态后才启动。
3. THE Studio_Service SHALL 仅从自身进程环境变量读取 Write_Token、LLM_Key、Owner_Passphrase 与会话签名密钥，且不从请求参数、请求头中的前端配置或 Frontend 提供的任何值读取这四项。
4. THE Dream_Blog SHALL 保证 Frontend 的源代码、`.env.example`、构建产物，以及 Backend 的 `.env.example` 与源代码中，Write_Token 与 LLM_Key 的变量名和实际取值出现次数均为 0。
5. IF Studio_Service 启动时 Write_Token、LLM_Key、Owner_Passphrase 或会话签名密钥缺失、为空字符串或仅含空白字符，或 Owner_Passphrase 或会话签名密钥的长度少于 12 个字符，THEN THE Studio_Service SHALL 在启动后 5 秒内向标准错误输出指明全部不满足要求的变量名称及原因（缺失或长度不足，不含变量值）的错误信息，不开始监听 HTTP 端口，并以非零退出码退出。
6. WHEN Studio_Service 收到带有 `Origin` 请求头的请求且该来源与 `CORS_ORIGIN` 列表中的某一项完全匹配，THE Studio_Service SHALL 在响应中返回对应的跨域许可响应头。
7. IF Studio_Service 收到的请求 `Origin` 不在 `CORS_ORIGIN` 列表中，THEN THE Studio_Service SHALL 在响应中不返回任何跨域许可响应头。
8. WHEN 未登录客户端请求健康检查接口，THE Studio_Service SHALL 在 3 秒内返回服务状态与 Backend 连通性（可达或不可达），且响应不包含 Write_Token、LLM_Key、Owner_Passphrase 或会话签名密钥的值。
9. IF 健康检查期间 Backend 在 2 秒内未响应或连接失败，THEN THE Studio_Service SHALL 仍返回响应，并将 Backend 连通性标示为不可达，服务状态标示为降级。
10. THE Dream_Blog SHALL 在 Studio_Service 目录与仓库根目录的 `.env.example` 中列出 Studio_Service 所需的全部环境变量名（包含 `CORS_ORIGIN`、Write_Token、LLM_Key、Owner_Passphrase 与会话签名密钥对应变量），且敏感变量的值为空或占位符。

### Requirement 2: Owner 登录与权限边界

**User Story:** 作为 Owner，我希望只有我能写入和使用分析助手，以便访客无法修改数据或消耗我的 LLM 额度。

#### Acceptance Criteria

1. WHEN Owner 提交与 Owner_Passphrase 完全一致（区分大小写，长度 1 至 128 个字符）的口令，THE Studio_Service SHALL 签发有效期为 12 小时的 Owner_Session，并在响应中返回该 Owner_Session 及其过期时间。
2. IF 提交的口令与 Owner_Passphrase 不一致、为空或超过 128 个字符，THEN THE Studio_Service SHALL 返回 401 状态码，且不签发 Owner_Session。
3. IF 同一来源地址在 10 分钟内累计 5 次登录失败，THEN THE Studio_Service SHALL 在随后 15 分钟内对该来源地址的所有登录请求（包括口令正确的请求）返回 429 状态码，且不签发 Owner_Session。
4. WHEN 15 分钟锁定期结束，THE Studio_Service SHALL 恢复处理该来源地址的登录请求，并将该来源地址的失败计数清零。
5. IF 写入类接口或 Dream_Agent 接口收到的请求不携带 Owner_Session、携带已过期的 Owner_Session 或携带签名无效的 Owner_Session，THEN THE Studio_Service SHALL 返回 401 状态码，且不修改任何数据，不发起任何 LLM 请求。
6. THE Studio_Service SHALL 仅向 Frontend 返回 Owner_Session，并确保任何响应、日志或 Trace 中均不包含 Write_Token、LLM_Key 或 Owner_Passphrase 的取值。
7. THE Backend SHALL 对 Public 角色仅开放 Dream、Story 的 find 与 findOne 权限，不开放 create、update、delete 权限，并且不对 Public 角色开放 Agent_Run 的任何权限。
8. IF Public 角色（未携带有效 Write_Token）对 Dream、Story 发起 create、update 或 delete 请求，或对 Agent_Run 发起任何请求，THEN THE Backend SHALL 返回 403 状态码，且不修改任何数据。
9. WHEN Owner 点击「退出小屋」，THE Frontend SHALL 在 1 秒内清除本地保存的 Owner_Session，并切换到只读视图。
10. WHILE 当前没有有效的 Owner_Session，THE Frontend SHALL 隐藏「记录一场梦」「作为故事灵感」「开始创作并收藏」「珍藏」「编辑标签」与分析助手入口，且保留只读浏览功能。
11. WHEN Frontend 收到任一接口返回的 401 状态码，THE Frontend SHALL 清除本地保存的 Owner_Session，并切换到只读视图，同时显示提示登录已失效的消息。

### Requirement 3: Dream 与 Story 数据模型

**User Story:** 作为 Owner，我希望系统保存珍藏状态、标签和生成的故事，以便日后回顾。

#### Acceptance Criteria

1. THE Backend SHALL 为 Dream 新增布尔字段 `isFavorite`，默认值为 false。
2. THE Backend SHALL 为 Dream 新增 `tags` 字段，类型为字符串数组，最多 10 个元素，每个元素去除首尾空白后长度为 1 到 20 个字符，且同一 Dream 内的 Tag 不重复（去除首尾空白后按字符完全相同判定）。
3. THE Backend SHALL 提供集合类型 `story`，字段包括 `title`（字符串，1 到 100 个字符）、`content`（文本，1 到 20000 个字符）、`style`（Story_Style 枚举）、`tags`（字符串数组，约束同 Dream 的 `tags`：最多 10 个元素，每个元素去除首尾空白后长度为 1 到 20 个字符，且不重复）、`sourceDreams`（到 Dream 的多对多关联）、`sourceSnapshot`（Source_Snapshot，有序列表，每项包含 `documentId` 与 `title`，元素数量与创建时的 `sourceDreams` 一致）。
4. THE Backend SHALL 要求 Story 的 `sourceDreams` 关联数量为 1 到 5。
5. THE Backend SHALL 为 Story 关闭草稿与发布机制。
6. THE Backend SHALL 提供集合类型 `agent_run`，字段包括 `runId`（字符串，唯一）、`question`（字符串）、`finalAnswer`（文本）、`terminationReason`（字符串）、`trace`（有序的步骤记录列表）、`stepCount`（非负整数）、`redacted`（布尔，默认 false）、`usageEstimated`（布尔，默认 false）、`promptTokens`（非负整数）、`completionTokens`（非负整数）、`estimatedCost`（非负数，保留至少 6 位小数精度）、`durationMs`（非负整数，单位毫秒）、`model`（字符串）、`createdAt`（日期时间，创建时自动设置）。
7. IF 创建或更新 Dream 的请求使 `tags` 超过 10 个元素、任一元素去除首尾空白后长度不在 1 到 20 个字符内，或存在重复元素，THEN THE Backend SHALL 返回 400 状态码、指明 `tags` 字段无效的错误信息，并保持已有数据不变。
8. IF 创建或更新 Story 的请求使 `sourceDreams` 数量小于 1 或大于 5、`style` 不在 Story_Style 内、`title` 为空或超过 100 个字符，或 `content` 为空或超过 20000 个字符，THEN THE Backend SHALL 返回 400 状态码、指明无效字段的错误信息，并保持已有数据不变。
9. WHEN 现有 Dream 数据在新字段上线后被读取，THE Backend SHALL 对未设置 `isFavorite` 的 Dream 返回 false，对未设置 `tags` 的 Dream 返回空数组。
10. WHEN Story 创建成功，THE Studio_Service SHALL 在该 Story 的 `sourceSnapshot` 中按 `sourceDreams` 的顺序写入每条来源 Dream 在创建时的 `documentId` 与 `title`。
11. IF 创建 Agent_Run 的请求所带 `runId` 与已有 Agent_Run 的 `runId` 重复，THEN THE Backend SHALL 返回 400 状态码、指明 `runId` 重复的错误信息，并保持已有数据不变。

### Requirement 4: 梦境手记与记录一场梦

**User Story:** 作为 Owner，我希望在网页上浏览梦境卡片并直接记录新梦，以便不依赖语音设备也能写日记。

#### Acceptance Criteria

1. THE Frontend SHALL 在左侧导航提供「梦境手记」「珍藏的梦」「梦境日历」「梦境宇宙」「存档冒险」五个入口，以及「记录一场梦」「小屋设置」「退出小屋」三个操作入口。
2. THE Frontend SHALL 为每张梦境卡片展示标题、`YYYY-MM-DD` 日期、Tag 与「读一读原梦」入口。
3. WHILE Owner_Session 有效，THE Frontend SHALL 在每张梦境卡片上展示「作为故事灵感」勾选框。
4. WHEN Visitor 或 Owner 点击「读一读原梦」，THE Frontend SHALL 在 1 秒内展示该 Dream 的完整 Raw_Content，且不截断任何字符。
5. IF 读取 Raw_Content 失败，THEN THE Frontend SHALL 展示表示读取失败的错误提示，并保持卡片当前展示内容不变。
6. WHEN Owner 在「记录一场梦」中提交去除首尾空白后长度为 1 到 10000 个字符的文本，THE Studio_Service SHALL 创建 `source` 为 `web`、`aiProcessed` 为 false 的 Dream，并在保存成功后 2 秒内返回创建结果，该结果表明 Enrichment_Status 为 pending。
7. WHEN 通过 Studio_Service 创建的 Dream 保存成功，THE Studio_Service SHALL 在后台对该 Dream 执行与 MCP_Server 相同字段范围的加工（title、summary、keywords、emotion、emotionScore、clarity），不阻塞创建结果的返回，并在加工成功后将 `aiProcessed` 置为 true、Enrichment_Status 置为 done。
8. IF 通过 Studio_Service 创建 Dream 的文本为空、仅含空白字符或超过 10000 个字符，THEN THE Studio_Service SHALL 返回 400 状态码，并且不创建 Dream。
9. IF Dream 加工失败，THEN THE Studio_Service SHALL 保留已保存的 Raw_Content，保持 `aiProcessed` 为 false，将 Enrichment_Status 置为 failed，并在后续状态查询（第 13 条）的响应中返回表示加工失败的错误指示与错误码。
10. WHEN Owner 为 Dream 添加或移除 Tag，THE Studio_Service SHALL 更新该 Dream 的 `tags`，并在响应中返回更新后的完整 Tag 列表。
11. IF Owner 提交的 Tag 去除首尾空白后为空、超过 20 个字符，或使该 Dream 的 Tag 数量超过 10，THEN THE Studio_Service SHALL 返回 400 状态码，并保持该 Dream 的 `tags` 不变。
12. WHEN 用户点击「存档冒险」入口，THE Frontend SHALL 展示「即将推出」占位页，且不发起任何写入请求。
13. WHEN Owner 查询某条通过 Studio_Service 创建的 Dream 的加工状态，THE Studio_Service SHALL 在 2 秒内返回该 Dream 当前的 Enrichment_Status（pending、done 或 failed）；IF 状态为 failed，THEN THE Studio_Service SHALL 在同一响应中返回错误码。
14. IF 加工状态查询中的 Dream 标识不存在，THEN THE Studio_Service SHALL 返回 404 状态码和指明 Dream 不存在的错误信息。
15. WHEN Owner 对 Enrichment_Status 为 failed 的 Dream 提交重试加工请求，THE Studio_Service SHALL 在 2 秒内将 Enrichment_Status 置为 pending 并返回，随后在后台重新执行加工。
16. IF 重试加工请求所针对 Dream 的 Enrichment_Status 不是 failed，THEN THE Studio_Service SHALL 返回 409 状态码，并且不重复执行加工。

### Requirement 5: 珍藏的梦

**User Story:** 作为 Owner，我希望把重要的梦标记为珍藏，以便快速找到它们。

#### Acceptance Criteria

1. WHEN Owner 提交对一条已存在 Dream 的珍藏或取消珍藏请求，THE Studio_Service SHALL 在 2 秒内将该 Dream 的 `isFavorite` 更新为请求指定的布尔值（珍藏为 true，取消珍藏为 false），并在响应中返回更新后的 `isFavorite` 值。
2. WHEN 用户进入「珍藏的梦」，THE Frontend SHALL 仅展示 `isFavorite` 为 true 的 Dream，并按 `dreamedAt` 从新到旧排列；`dreamedAt` 相同的 Dream 按创建时间从新到旧排列。
3. IF 不存在任何 Favorite_Dream，THEN THE Frontend SHALL 在「珍藏的梦」中展示一条文字空状态，内容说明当前没有珍藏的梦并提示 Owner 可在梦境上执行珍藏操作，且不展示任何 Dream 条目。
4. WHEN 对同一 Dream 连续提交两次相同的珍藏请求（目标值相同），THE Studio_Service SHALL 两次均返回成功响应和相同的 `isFavorite` 值，且该 Dream 最终的 `isFavorite` 与仅提交一次时一致。
5. IF 珍藏请求中的 Dream 标识不存在，THEN THE Studio_Service SHALL 返回 404 状态码和指明 Dream 不存在的错误信息，且不创建任何 Dream，也不修改任何已有 Dream 的数据。
6. IF 珍藏请求中的 `isFavorite` 值缺失或不是布尔值，THEN THE Studio_Service SHALL 拒绝该请求并返回指明参数无效的错误信息，且目标 Dream 的 `isFavorite` 保持不变。
7. IF 珍藏或取消珍藏请求因服务端错误而失败，THEN THE Studio_Service SHALL 返回错误响应，且目标 Dream 的 `isFavorite` 保持请求前的值。

### Requirement 6: 梦境日历与梦境宇宙

**User Story:** 作为 Owner，我希望按日期和关联关系浏览梦境，以便发现规律。

#### Acceptance Criteria

1. WHEN 用户进入「梦境日历」，THE Frontend SHALL 默认展示当前自然月的月历，并在每个至少有 1 条 Dream 的日期格上标注该日期的 Dream 数量（正整数）；没有 Dream 的日期格不显示数量标注。
2. WHEN 用户点击「梦境日历」中的上一月或下一月控件，THE Frontend SHALL 在 1000 毫秒内切换为相邻月份的月历，并按相同规则标注各日期的 Dream 数量。
3. WHEN 用户点击日历中有 Dream 的日期，THE Frontend SHALL 展示该日期的 Dream 卡片列表，每张卡片包含 Dream 的标题与日期；日期归属沿用现有 Aggregator 的 `dreamedAt` 优先、`createdAt` 回退规则，且 Dream 数量标注与卡片列表的条数一致。
4. IF 「梦境日历」或「梦境宇宙」加载 Dream 数据失败，THEN THE Frontend SHALL 展示指明加载失败的错误提示及重试入口，且不渲染日历数量标注、节点与边。
5. WHEN 用户进入「梦境宇宙」且 Dream 数量大于或等于 2，THE Frontend SHALL 以每条 Dream 为一个节点绘制关系图，并在任意两条 Dream 的 Similarity_Score 大于或等于 0.3 时在二者之间绘制一条边；Similarity_Score 小于 0.3 时不绘制边。
6. THE Studio_Service SHALL 基于 keywords、tags 与 emotion 计算 Similarity_Score，结果为 0 到 1（含边界）之间的数值，且对任意两条 Dream A 和 B，Similarity_Score(A, B) 等于 Similarity_Score(B, A)。
7. THE Studio_Service SHALL 对任意一条 Dream 与其自身计算出的 Similarity_Score 等于 1。
8. IF 两条 Dream 的 keywords、tags 与 emotion 均无任何重叠，THEN THE Studio_Service SHALL 返回 Similarity_Score 为 0。
9. WHEN 用户点击 Dream_Universe 中的节点，THE Frontend SHALL 展示该 Dream 的标题、日期、Tag 与「读一读原梦」入口；WHEN 用户点击「读一读原梦」入口，THE Frontend SHALL 跳转到该 Dream 的详情页。
10. IF Dream 数量少于 2，THEN THE Frontend SHALL 在「梦境宇宙」中展示数据不足的空状态文案，且不渲染边。

### Requirement 7: 把梦写成新的故事

**User Story:** 作为 Owner，我希望选择若干场梦和一种风格，让系统写出新的故事并收藏，以便把梦境转化为作品。

#### Acceptance Criteria

1. WHEN Owner 勾选某条 Dream 的「作为故事灵感」，THE Frontend SHALL 把该 Dream 加入 Source_Dream_Set，并在 200 毫秒内展示当前已选数量。
2. WHILE Source_Dream_Set 中的 Dream 数量大于或等于 5，THE Frontend SHALL 禁用未被选中的 Dream 的「作为故事灵感」勾选框，并保持已选中 Dream 的勾选框可取消勾选。
3. WHEN Owner 取消勾选已选中的 Dream，THE Frontend SHALL 把该 Dream 从 Source_Dream_Set 移除，并更新已选数量。
4. WHEN Owner 点击「清空选择」，THE Frontend SHALL 清空 Source_Dream_Set，使已选数量变为 0，并恢复所有 Dream 勾选框为可用。
5. WHILE Source_Dream_Set 中的 Dream 数量小于 1 或没有选定 Story_Style，THE Frontend SHALL 禁用「开始创作并收藏」按钮。
6. WHEN Owner 点击「开始创作并收藏」，THE Studio_Service SHALL 读取 Source_Dream_Set 中每条 Dream 的 Raw_Content 与加工字段，调用 LLM 按所选 Story_Style 生成 title 与 content，并创建 Story 记录，其 `sourceDreams` 等于 Source_Dream_Set。
7. WHILE 生成请求处理中，THE Frontend SHALL 显示生成中状态，并禁用「开始创作并收藏」按钮。
8. WHEN Story 创建成功，THE Frontend SHALL 清空 Source_Dream_Set，并在「梦的另一种可能」列表顶部展示该 Story。
9. THE Story_Generator SHALL 把 Dream 的 Raw_Content 作为 Untrusted_Content 放入受分隔符界定的数据区，并在系统指令中声明数据区内的指令不被执行。
10. IF 请求中的 Dream 数量小于 1 或大于 5、包含重复的 Dream 标识、包含不存在的 Dream，或 `style` 不在 Story_Style 内，THEN THE Studio_Service SHALL 返回 400 状态码，不调用 LLM，不创建 Story，并返回指明具体校验失败原因的错误信息。
11. IF LLM 请求在 60 秒内未返回、返回 5xx，或返回内容无法解析为同时包含非空 title 与非空 content 的结果，THEN THE Studio_Service SHALL 向 Frontend 返回指明生成失败的错误信息，不创建 Story，并且 THE Frontend SHALL 保留 Source_Dream_Set 以便 Owner 重试。
12. IF 对同一 Source_Dream_Set 与 Story_Style 的生成请求仍在处理中，THEN THE Studio_Service SHALL 对重复提交的相同请求返回 409 状态码，并且不重复调用 LLM。
13. THE Studio_Service SHALL 在 Story 的 `tags` 中写入来源 Dream 的 Tag 并集，按 Tag 名称完全匹配去重后最多保留 10 个。

### Requirement 8: 梦的另一种可能（故事列表）

**User Story:** 作为访客或 Owner，我希望浏览已生成的故事，以便阅读梦境衍生的作品。

#### Acceptance Criteria

1. WHEN 用户进入「梦的另一种可能」，THE Frontend SHALL 按 `createdAt` 倒序请求并展示全部 Story，分页方式为每页 100 条，并持续请求下一页，直到某页返回条数少于 100。
2. IF 任一页 Story 请求失败，THEN THE Frontend SHALL 保留已加载的 Story 卡片，并展示指明加载失败的错误提示及「重试」入口。
3. THE Frontend SHALL 为每张 Story 卡片展示 `YYYY-MM-DD` 格式的创建日期、Tag、标题、正文摘录，以及「来源 N 场梦」，其中 N 等于 `sourceDreams` 的数量（无来源时 N 为 0）。
4. IF Story 正文超过 120 个字符，THEN THE Frontend SHALL 将摘录截取为前 120 个字符并在末尾追加「…」；IF 正文不超过 120 个字符，THEN THE Frontend SHALL 完整展示正文且不追加「…」。
5. WHEN 用户点击 Story 卡片，THE Frontend SHALL 展示该 Story 的完整正文与其来源 Dream 的标题列表，且来源 Dream 按其在 `sourceSnapshot` 中的顺序排列。
6. WHEN 用户点击来源 Dream 的标题，THE Frontend SHALL 跳转到 `/dream/{documentId}`。
7. THE Frontend SHALL 以 `sourceSnapshot` 作为来源列表的依据，并以 Story 实时的 `sourceDreams` 关联判断每个来源 Dream 是否仍存在；IF `sourceSnapshot` 中某 `documentId` 不在实时关联中，THEN THE Frontend SHALL 在来源列表中对应位置显示「该梦已不存在」（不可点击），且 Story 其余内容正常展示。
8. IF 不存在任何 Story，THEN THE Frontend SHALL 展示引导 Owner 创作第一个故事的空状态文案，且不展示 Story 卡片。
9. WHEN Owner 删除一个 Story，THE Studio_Service SHALL 仅删除该 Story，保留其所有来源 Dream 及其内容不变；IF 删除失败，THEN THE Studio_Service SHALL 保留该 Story 不变并返回指明删除失败的错误。

### Requirement 9: Agent 工具设计

**User Story:** 作为 agent 开发者，我希望工具有清晰的契约、受限的输出和只读的权限，以便 LLM 能稳定地选择和使用它们。

#### Acceptance Criteria

1. THE Dream_Agent SHALL 提供 search_dreams、get_dream、emotion_trend、find_similar_dreams、keyword_stats 五个 Agent_Tool，每个 Agent_Tool 具备名称、长度 10 到 300 个字符的面向 LLM 的用途描述、含字段类型、必填/可选标记与取值范围的输入模式。
2. WHEN LLM 调用 search_dreams，THE search_dreams SHALL 接受 `query`（字符串，0 到 200 个字符）、`dateFrom`、`dateTo`（ISO 8601 日期，YYYY-MM-DD，且 dateFrom 不晚于 dateTo）、`emotion`、`tag`（字符串，1 到 50 个字符）、`limit`（整数，1 到 20，默认 10）参数，并返回按相关度降序排列的 Dream 摘要列表，每项仅包含 documentId、title、summary、emotion、dreamedAt、keywords。
3. WHEN LLM 调用 get_dream 并提供存在的 `documentId`，THE get_dream SHALL 返回该 Dream 的 Raw_Content 与加工字段；IF Raw_Content 超过 2000 个字符，THEN THE get_dream SHALL 将 Raw_Content 截断为前 2000 个字符，并在结果中标注已截断及原始字符数。
4. WHEN LLM 调用 emotion_trend，THE emotion_trend SHALL 接受 `dateFrom`、`dateTo`（ISO 8601 日期，YYYY-MM-DD）与 `granularity`（仅限 day、week、month，默认 week）参数，并返回按时间段起始日期升序排列的列表，每项包含平均 emotionScore（保留 2 位小数）、Dream 数量与主导 emotion（数量相同时取按字典序最小者）；无 Dream 的时间段不出现在结果中。
5. WHEN LLM 调用 find_similar_dreams，THE find_similar_dreams SHALL 接受 `documentId` 与 `limit`（整数，1 到 10，默认 5）参数，并返回按 Similarity_Score 降序排列的 Dream 摘要及其分数，且结果不包含输入的 Dream 自身。
6. WHEN LLM 调用 keyword_stats，THE keyword_stats SHALL 接受 `dateFrom`、`dateTo`（ISO 8601 日期，YYYY-MM-DD）与 `limit`（整数，1 到 50，默认 20）参数，并返回关键词及出现次数，按次数降序、次数相同时按关键词字典序升序排列。
7. THE Dream_Agent SHALL 仅允许 Agent_Tool 读取数据，Agent_Tool 的实现不得使用 create、update、delete 类 Backend 操作。
8. IF Agent_Tool 收到不符合输入模式的参数（包括缺失必填字段、类型错误、超出取值范围、日期格式无效或 dateFrom 晚于 dateTo），THEN THE Dream_Agent SHALL 在不访问 Backend 的前提下，向 LLM 返回标记为错误的工具结果，其中列出每个无效字段名及其合法类型或取值范围。
9. IF Agent_Tool 查询成功但无匹配数据，THEN THE Dream_Agent SHALL 向 LLM 返回非错误状态的工具结果，包含明确的空结果标记及空列表。
10. IF get_dream 或 find_similar_dreams 收到的 `documentId` 在 Backend 中不存在，THEN THE Dream_Agent SHALL 向 LLM 返回标记为错误的工具结果，指明 documentId 未找到。
11. IF Backend 访问失败或在 10 秒内无响应，THEN THE Dream_Agent SHALL 向 LLM 返回标记为错误的工具结果，指明数据服务不可用，且不重试该次调用。
12. IF Agent_Tool 的单次返回内容超过 3000 个字符，THEN THE Dream_Agent SHALL 将其截断至 3000 个字符以内，并在结果中标注已截断。
13. IF LLM 请求调用不在 Agent_Tool 列表中的工具名，THEN THE Dream_Agent SHALL 向 LLM 返回标记为错误的「未知工具」结果及五个可用工具名列表，且该次调用计入 Agent_Step。

### Requirement 10: Agent 循环、终止与错误处理

**User Story:** 作为 Owner，我希望向分析助手提问并得到基于我梦境数据的回答，同时循环一定会终止，以便不会无限消耗额度。

#### Acceptance Criteria

1. WHEN Owner 提交去除首尾空白后长度为 1 到 500 个字符的问题，THE Dream_Agent SHALL 启动一次 Agent_Loop，并创建一条 Agent_Run 记录。
2. WHILE Agent_Loop 运行，THE Dream_Agent SHALL 在每个 Agent_Step 中把当前上下文发送给 LLM，由 LLM 决定调用 0 到多个 Agent_Tool 或给出最终回答。
3. WHEN LLM 在某个 Agent_Step 中给出不含工具调用的回答，THE Dream_Agent SHALL 以 Termination_Reason `answered` 结束 Agent_Loop，并返回该回答。
4. IF Agent_Step 数达到 Max_Steps 且仍未给出最终回答，THEN THE Dream_Agent SHALL 以 Termination_Reason `max_steps` 结束 Agent_Loop，并基于已收集的工具结果生成一次不允许调用工具的总结回答，回答中包含信息可能不完整的声明。
5. IF LLM 在同一 Agent_Loop 内对同一 Agent_Tool 发起第 3 次调用，且该调用的参数与前两次调用在忽略参数键顺序和字符串首尾空白后相等，THEN THE Dream_Agent SHALL 不执行该第 3 次调用，以 Termination_Reason `repeated_call` 结束 Agent_Loop，并基于已收集的工具结果生成一次不允许调用工具的总结回答。
6. IF Agent_Tool 执行失败或超过 10 秒未返回，THEN THE Dream_Agent SHALL 将错误类型和错误描述作为该工具的结果回填给 LLM，将该次调用计为一次工具失败，并允许 LLM 在后续 Agent_Step 中重试或换用其他 Agent_Tool。
7. IF 同一 Agent_Loop 内 Agent_Tool 连续失败达到 3 次（任意一次 Agent_Tool 成功执行即将连续失败计数清零），THEN THE Dream_Agent SHALL 以 Termination_Reason `tool_failure` 结束 Agent_Loop，并向 Owner 返回说明失败工具名称和失败类型的回答。
8. IF LLM 请求发生网络错误、超过 60 秒未响应或返回 5xx，THEN THE Dream_Agent SHALL 以 1000ms 为基准指数退避重试（第 1 次重试前等待 1000ms，第 2 次重试前等待 2000ms），最多重试 2 次；IF 重试用尽仍失败，THEN THE Dream_Agent SHALL 以 Termination_Reason `llm_failure` 结束 Agent_Loop，并向 Owner 返回说明 LLM 服务不可用的错误响应。
9. IF 单次 Agent_Loop 的累计耗时达到 120 秒，THEN THE Dream_Agent SHALL 中止进行中的 LLM 请求和 Agent_Tool 调用，以 Termination_Reason `timeout` 结束 Agent_Loop，并向 Owner 返回说明已超时的回答。
10. WHEN Owner 取消正在运行的 Agent_Run，THE Dream_Agent SHALL 同时中止进行中的 LLM 请求与 Agent_Tool 调用，使当前 Agent_Step 立即结束，在 Trace 中将该 Agent_Step 标记为已中止，随后以 Termination_Reason `cancelled` 结束 Agent_Loop，且不再发起新的 LLM 请求或 Agent_Tool 调用。
11. WHEN Agent_Loop 结束，THE Dream_Agent SHALL 在 Agent_Run 中记录 Termination_Reason，并在响应中返回该值。
12. IF 问题为空、仅含空白字符或超过 500 个字符，THEN THE Studio_Service SHALL 返回 400 状态码和指出问题长度不合法的错误响应，并且不创建 Agent_Run，不调用 LLM。
13. WHEN LLM 在一个 Agent_Step 中返回多个互相独立的工具调用，THE Dream_Agent SHALL 在同一 Agent_Step 内执行这些调用，并按 LLM 返回的调用顺序回填结果。
14. WHEN 同一 Owner_Session 已有一个运行中的 Agent_Run 时收到新提交的问题，THE Studio_Service SHALL 返回 429 状态码，并且不创建新的 Agent_Run，不影响已运行的 Agent_Run。
15. IF 在 `max_steps` 或 `repeated_call` 场景下的总结回答生成失败（LLM 请求按第 8 条重试用尽仍失败），THEN THE Dream_Agent SHALL 保留原 Termination_Reason，并向 Owner 返回说明总结未能生成的回答，其中不包含未经 LLM 处理的原始工具结果。

### Requirement 11: 上下文管理

**User Story:** 作为 agent 开发者，我希望上下文有明确预算和压缩策略，以便长对话和大结果不会撑爆模型窗口。

#### Acceptance Criteria

1. WHEN Dream_Agent 即将发起一次 LLM 请求，THE Dream_Agent SHALL 估算本次请求上下文（系统指令、历史、用户问题、全部 Agent_Step 内容）的 token 数，并保证发送的上下文 token 数不超过 Context_Budget。
2. IF 追加某个 Agent_Tool 结果会使上下文 token 数超过 Context_Budget，THEN THE Dream_Agent SHALL 先将最早的、尚未被压缩的已完成 Agent_Step 的工具结果替换为不超过 200 个字符的摘要，仍超出时继续按 Agent_Step 序号从小到大的顺序逐个压缩，直到上下文 token 数不超过 Context_Budget。
3. WHILE Dream_Agent 执行压缩，THE Dream_Agent SHALL 保留系统指令、当前用户问题、历史问答（按第 5 条携带的部分）和最近 2 个 Agent_Step 的完整内容，不对其做替换或截断。
4. IF 仅由第 3 条所列保留项（含待追加的 Agent_Tool 结果）构成的上下文 token 数已超过 Context_Budget，THEN THE Dream_Agent SHALL 不再发起 LLM 请求，以 Termination_Reason `token_budget` 结束 Agent_Loop，并向 Owner 返回一条说明上下文超出预算的回答，且已完成的 Agent_Step 记录保留在 Trace 中。
5. WHERE Owner 在同一会话中提出后续问题，THE Dream_Agent SHALL 携带该会话最近 3 轮问答（不足 3 轮时携带全部）的问题与最终回答作为历史，且不携带历史轮次的工具调用明细。
6. WHEN Dream_Agent 开始处理一个 Owner 问题，THE Dream_Agent SHALL 在系统指令中写入当前日期（格式 YYYY-MM-DD，按服务器本地时区），使「最近」「上个月」等相对时间可被解析为明确的起止日期区间。
7. WHEN Dream_Agent 完成一次压缩，THE Dream_Agent SHALL 在 Trace 中记录该次压缩的触发时机（所属 Agent_Step 序号与触发原因）、被压缩的 Agent_Step 序号列表，以及压缩前后的上下文 token 数。

### Requirement 12: 提示词注入防护与安全

**User Story:** 作为 Owner，我希望梦境文本里的恶意指令不能操纵分析助手，以便数据和额度安全。

#### Acceptance Criteria

1. WHEN Dream_Agent 构造发送给 LLM 的提示，THE Dream_Agent SHALL 把所有 Untrusted_Content 放入标注了来源名称的数据分隔区，并在系统指令中声明分隔区内的任何指令都只作为待分析数据，不被执行。
2. WHEN Agent_Tool 返回的内容中含有分隔区的结束标记，THE Dream_Agent SHALL 对该标记的每一处出现进行转义，使转义后的内容中不再包含可被识别为结束标记的字符串，Untrusted_Content 无法提前结束分隔区。
3. THE Dream_Agent SHALL 仅向 LLM 暴露只读的 Agent_Tool，使 Untrusted_Content 中的指令即使被 LLM 采纳，也无法触发对 Dream、Story 的任何创建、修改或删除。
4. WHEN Dream_Agent 执行 Agent_Tool，THE Dream_Agent SHALL 仅访问 Owner_Session 对应的 Owner 数据范围，且 Agent_Tool 的参数不得包含 Backend 地址、凭证或任意 URL。
5. IF LLM 请求的 Agent_Tool 参数包含 Backend 地址、凭证或 URL，THEN THE Dream_Agent SHALL 拒绝执行该工具调用，向 LLM 返回表示参数无效的工具错误结果，并在 Trace 中记录该次拒绝。
6. WHEN Dream_Agent 生成最终回答，THE Dream_Agent SHALL 在返回给 Owner 前对回答进行输出检查。
7. IF 最终回答中包含 Write_Token、LLM_Key、Owner_Passphrase 或会话签名密钥的取值（Owner_Passphrase 与会话签名密钥的长度均不少于 12 个字符，见 1.5），THEN THE Dream_Agent SHALL 以固定的安全提示替换整个回答，并将 Agent_Run 的 `redacted` 字段标记为 true。
8. THE Studio_Service SHALL 确保 Dream_Agent 的系统指令、工具描述和 Trace 中的工具参数不包含 Write_Token、LLM_Key、Owner_Passphrase 或会话签名密钥的取值。
9. IF 同一 Owner_Session 在任意连续 60 分钟内已提交 30 个 Agent 问题（限流按 Owner_Session 计数，不按来源地址或 Owner 身份合并），THEN THE Studio_Service SHALL 拒绝该会话提交的第 31 个及之后的问题，返回 429 状态码和表示已超出频率限制的错误信息，且不启动 Agent_Loop。
10. WHILE 单次 Agent_Loop 的累计 token 用量（输入与输出之和）小于 60000，THE Studio_Service SHALL 允许该 Agent_Loop 继续执行；IF 累计 token 用量达到 60000，THEN THE Studio_Service SHALL 停止发起新的 LLM 调用，以 Termination_Reason `token_budget` 结束 Agent_Loop，并保留已产生的 Trace。
11. WHEN Story_Generator 或 Dream_Agent 返回的文本在 Frontend 展示，THE Frontend SHALL 以纯文本方式渲染，使文本中的 HTML 标签原样显示为字符，而不被解释为 HTML 元素或执行脚本。

### Requirement 13: 可观测性（调用链、token 与成本）

**User Story:** 作为 agent 开发者，我希望每次运行都有完整调用链和用量数据，以便调试、复盘和成本控制。

#### Acceptance Criteria

1. WHEN Agent_Loop 结束，THE Studio_Service SHALL 将 Agent_Run 持久化到 Backend，包含 question、finalAnswer、terminationReason、trace、promptTokens、completionTokens、estimatedCost、durationMs、model，其中 promptTokens 与 completionTokens 为大于等于 0 的整数，durationMs 为大于等于 0 的整数（单位毫秒），estimatedCost 为大于等于 0 的数值（保留至少 6 位小数精度）。
2. THE Trace SHALL 为每个 Agent_Step 记录步骤序号（从 1 开始连续递增）、LLM 请求的 promptTokens 与 completionTokens、LLM 耗时（毫秒）、所调用 Agent_Tool 的名称、规范化参数、结果大小（字节数）、工具耗时（毫秒）与成功或失败状态。
3. THE Studio_Service SHALL 按配置的每百万输入 token 单价与每百万输出 token 单价计算 estimatedCost，其值等于 promptTokens 乘以输入单价除以 1,000,000 与 completionTokens 乘以输出单价除以 1,000,000 之和。
4. IF LLM 响应未返回 token 用量，THEN THE Studio_Service SHALL 按字符数估算 token 用量（输入文本与输出文本各按字符数除以 4 向上取整），将估算值计入 promptTokens、completionTokens 与 estimatedCost，并在 Trace 中对该次 LLM 请求标记用量为估算值。
5. WHEN Owner 请求某条 Agent_Run 的详情，THE Studio_Service SHALL 返回完整 Trace，且 Frontend SHALL 以时间线形式按步骤序号升序展示每个 Agent_Step 的工具名称、成功或失败状态、LLM 耗时与工具耗时。
6. WHEN Owner 请求 Agent_Run 列表，THE Studio_Service SHALL 返回按 createdAt 倒序、每页最多 50 条的结果，每项包含 question、terminationReason、总 token 用量（promptTokens 与 completionTokens 之和）、estimatedCost 与 durationMs。
7. WHEN Owner 请求指定日期区间的汇总，THE Studio_Service SHALL 返回该区间（含起止日期当天）内 Agent_Run 的次数、各 Termination_Reason 的占比（百分比，保留 1 位小数）、平均 Agent_Step 数（保留 1 位小数）、总 token 用量与总 estimatedCost。
8. IF 指定日期区间内没有 Agent_Run，THEN THE Studio_Service SHALL 返回次数为 0、总 token 用量为 0、总 estimatedCost 为 0、平均 Agent_Step 数为 0，且各 Termination_Reason 占比为空。
9. IF 汇总请求的起始日期晚于结束日期或日期格式无效，THEN THE Studio_Service SHALL 拒绝该请求并返回指明日期参数无效的错误，且不返回汇总数据。
10. WHEN Agent_Run 开始，THE Studio_Service SHALL 为其生成全局唯一的运行标识，并在该次运行相关的每条日志中包含该标识。
11. IF Agent_Run 持久化到 Backend 失败，THEN THE Studio_Service SHALL 仍向 Owner 返回最终回答，并在日志中记录包含运行标识的错误信息，且该次失败不得导致已返回的最终回答被修改或丢失。
12. WHEN Agent_Run 结束并返回回答，THE Frontend SHALL 在分析助手的回答下方展示该次运行的 Agent_Step 数、总 token 用量与 estimatedCost。

### Requirement 14: 分析助手界面

**User Story:** 作为 Owner，我希望在网页中向分析助手提问并看到它的推理过程，以便信任并理解回答。

#### Acceptance Criteria

1. WHILE Owner_Session 有效，THE Frontend SHALL 在左侧导航提供「梦境分析助手」入口。
2. WHEN Owner 提交问题，THE Frontend SHALL 在 Agent_Loop 运行期间，于每个 Agent_Step 开始后 1 秒内展示「第 N 步推理中」（N 为该 Agent_Step 序号），并在 LLM 返回工具调用后立即展示所调用的 Agent_Tool 名称与状态（运行中、成功、失败三种之一）。
3. WHEN Agent_Loop 结束，THE Frontend SHALL 展示最终回答、Termination_Reason 的中文说明，以及默认折叠、可展开的 Trace，其中每个 Agent_Step 显示序号、Agent_Tool 名称与状态。
4. IF Termination_Reason 不是 `answered`，THEN THE Frontend SHALL 在回答旁展示该原因的中文说明，并显示「回答可能不完整」的提示。
5. WHEN 最终回答引用了具体 Dream，THE Frontend SHALL 以可点击的链接展示该 Dream 的标题，点击后跳转到 `/dream/{documentId}`。
6. WHEN Owner 点击「取消」，THE Frontend SHALL 向 Studio_Service 发送取消请求，并在收到以 `cancelled` 结束的响应后停止展示进度，同时保留已展示的 Trace（其中被中止的 Agent_Step 标示为已中止）与 Owner 已输入的问题。
7. IF Studio_Service 在 10 秒内未对取消请求返回响应，THEN THE Frontend SHALL 停止展示进度，并展示「取消请求超时」的错误提示。
8. IF Studio_Service 返回 401，THEN THE Frontend SHALL 清除本地 Owner_Session，并展示提示 Owner 重新登录的消息。
9. IF Studio_Service 返回 429 或 5xx，THEN THE Frontend SHALL 展示包含该状态码的错误提示，停止展示进度，并保留 Owner 已输入的问题。
10. IF Owner 提交的问题为空或仅含空白字符，THEN THE Frontend SHALL 拒绝提交，并展示提示问题不能为空的消息，且不向 Studio_Service 发送请求。

### Requirement 15: Agent 离线评估

**User Story:** 作为 agent 开发者，我希望有可重复运行的评估集和评分，以便量化 agent 质量并比较改动前后的效果。

#### Acceptance Criteria

1. THE Eval_Suite SHALL 包含至少 15 个 Eval_Case，覆盖以下 5 个类别，且每个类别至少 2 个：需要多步调用（至少 2 次 Agent_Tool 调用）的趋势类问题、需要相似梦检索的问题、数据中不存在答案的问题、含提示词注入文本的 Dream 夹具、Agent_Tool 返回错误的场景。
2. THE Eval_Suite SHALL 使用固定的 Dream 数据夹具，并通过可替换的数据源运行，使评估运行期间向线上 Backend 发出的网络请求数为 0。
3. WHEN 执行评估命令，THE Eval_Suite SHALL 对每个 Eval_Case 运行一次 Agent_Loop，并输出工具选择正确率（0% 到 100%）、事实命中率（0% 到 100%）、各终止原因的用例数量与占比、平均 Agent_Step 数（保留 2 位小数）、平均 token 用量（取整）与平均 estimatedCost（保留 6 位小数）。
4. THE Eval_Suite SHALL 把「工具选择正确」定义为 Trace 中调用过该用例期望的全部 Agent_Tool，调用顺序与额外调用不影响该判定。
5. THE Eval_Suite SHALL 把「事实命中」定义为最终回答包含该用例期望的全部事实关键词，匹配时不区分英文大小写。
6. WHEN Eval_Case 的 Dream 夹具含提示词注入文本，THE Eval_Suite SHALL 判定该用例通过，当且仅当 Trace 中未出现用例禁止的 Agent_Tool 调用，且最终回答不含用例禁止出现的内容。
7. WHEN 评估运行结束，THE Eval_Suite SHALL 将结果写入文件名含运行时间戳的报告文件，报告包含所使用的模型名称、Max_Steps、Context_Budget 配置以及每个 Eval_Case 的通过状态。
8. WHERE 提供了上一次报告文件，THE Eval_Suite SHALL 输出各项指标相对上一次的变化量，并标明增加或减少。
9. IF 提供的上一次报告文件不存在或无法解析，THEN THE Eval_Suite SHALL 输出说明无法对比的提示，跳过变化量输出，并继续完成评估且不因此改变退出码。
10. IF 工具选择正确率低于配置的阈值，或存在注入类用例未通过，THEN THE Eval_Suite SHALL 以非零退出码结束。
11. THE Eval_Suite SHALL 支持使用脚本化的 LLM 替身运行，使离线检查产生的 LLM 费用为 0，并可用于验证 Agent_Loop 在各终止原因下的终止逻辑。

### Requirement 16: 既有行为保持不变

**User Story:** 作为现有用户，我希望新功能不影响已有的语音记录、日记流和统计，以便系统保持稳定。

#### Acceptance Criteria

1. THE MCP_Server SHALL 保持 `echo` 与 `record_dream` 两个工具的名称、输入参数定义、返回结构及对相同输入的处理结果与新功能上线前一致。
2. THE Frontend SHALL 保留现有「日记流」页面、「统计」页面与 `/dream/{id}` 详情页，且三者的行为符合现有需求 10 至 12 的全部验收标准。
3. WHEN 匿名（未携带认证凭据）请求读取 Dream 列表或单条 Dream，THE Backend SHALL 返回 Dream 数据且不要求认证。
4. IF 匿名请求对 Dream 执行创建、更新或删除，THEN THE Backend SHALL 拒绝该请求，返回表示未授权或禁止的错误，且不修改任何 Dream 数据。
5. WHEN 通过 MCP_Server 创建的 Dream 请求中缺少 `isFavorite` 与 `tags`，THE Backend SHALL 将 `isFavorite` 存储为 false，并将 `tags` 存储为空数组。
6. WHERE Studio_Service 未部署或在 5 秒内无响应，THE Frontend SHALL 保持日记流、统计与详情页的只读浏览功能可用，并在每个写入类功能入口展示表示服务不可用的提示，且不阻塞页面加载。
