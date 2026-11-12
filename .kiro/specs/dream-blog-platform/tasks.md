# Implementation Plan: Dream Blog（梦境日记）需求对齐

## Overview

现有代码已实现大部分功能。本计划聚焦 design.md「需求与现状差异」表（D-1 至 D-22）中的缺口，让代码与 requirements.md 对齐。实现语言沿用现有代码：Backend 与 MCP_Server 使用 TypeScript（Node 20），Frontend 使用 Nuxt 4 + TypeScript。

执行约定：

- 属性测试使用 fast-check（版本固定），与现有 Vitest 配合，每个属性一个测试，`numRuns` 起步为 100。
- 每个属性测试以注释标注：`Feature: dream-blog-platform, Property {编号}: {属性名}`。
- 涉及时间的测试使用 Vitest 假定时器或注入 `sleep`，不做真实等待。
- 需求中的 Docker、GitHub Actions、文档类内容用配置检查验证，不写属性测试。
- 差异编号（D-n）引用自 design.md，便于追溯。

## Tasks

- [ ] 1. Backend：依赖、数据模型约束与输入校验
  - [ ] 1.1 补充 Postgres 驱动并修正 npm 脚本（D-18、D-22）
    - 在 `backend/package.json` 中以固定版本添加 `pg` 依赖，并更新 `package-lock.json`
    - 移除指向不存在文件的 `seed:example` 脚本，或补齐对应脚本；新增 `setup-access` 脚本指向 `node ./scripts/setup-access.js`
    - 运行 `npm run build` 确认构建通过
    - _Requirements: 3.5, 2.2_

  - [ ] 1.2 为 `dream` schema 增加长度约束（D-1）
    - 在 `backend/src/api/dream/content-types/dream/schema.json` 中为 `rawContent` 设置 `minLength: 1`、`maxLength: 20000`
    - 为 `title` 设置 `maxLength: 200`，为 `summary` 设置 `maxLength: 5000`
    - 保持 `draftAndPublish: false`，以及 `emotion`、`emotionScore`、`clarity` 的现有枚举与范围、`aiProcessed`、`source` 的默认值不变
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ] 1.3 在控制器中增加 `rawContent` 空白与 `keywords` 校验（D-1、D-2）
    - 新增纯函数校验模块（如 `backend/src/api/dream/validate-dream.ts`），校验 `rawContent` 去除首尾空白后长度为 1 到 20000，`keywords` 为最多 20 个字符串元素的数组
    - 在 `backend/src/api/dream/controllers/dream.ts` 的 `create` 与 `update` 中调用校验，不合法时返回 400 及指明无效字段（如 `rawContent`）的错误信息，且不写入数据
    - 保留 Strapi 对 `emotion`、`emotionScore`、`clarity` 的校验，并保证出错时已有数据不变
    - _Requirements: 1.2, 1.3, 1.9, 1.10_

- [ ] 2. Checkpoint - Backend 对齐完成
  - 确认 `backend` 构建通过，确保所有测试通过，有疑问时询问用户。

- [ ] 3. MCP_Server：测试基础、配置与 WebSocket 传输层
  - [ ] 3.1 为 mcp-server 添加 fast-check 开发依赖
    - 在 `mcp-server/package.json` 的 devDependencies 中以固定版本添加 `fast-check`
    - 确认 Vitest 的 `include` 覆盖 `src/properties/**/*.test.ts`（属性测试统一放在此目录）
    - _Requirements: 4.2, 4.3_

  - [ ] 3.2 改造传输层的连接超时与重连行为（D-3、D-4）
    - 在 `mcp-server/src/ws-transport.ts` 中抽出导出的纯函数 `computeReconnectDelay(attempt, base, max)`，结果为 `min(max, base × 2^(attempt-1))`
    - 为每次连接尝试增加 10 秒超时，超时视为连接失败
    - 首次连接失败也进入指数退避重连，不再使 `start()` reject 而让进程退出；重连无次数上限，连接成功后重置计数
    - 增加 `onconnected` 回调，供生命周期代码在每次连接成功后触发补偿扫描
    - 收到非法 JSON 时回复不带请求标识的解析错误响应（JSON-RPC -32700），不合法的 JSON-RPC 消息回复无效请求错误；两种情况连接均保持并继续处理后续消息
    - _Requirements: 4.1, 4.3, 4.4, 4.6_

  - [ ]* 3.3 编写属性测试：重连延迟为带上限的指数退避
    - **Property 2: 重连延迟为带上限的指数退避**
    - 文件：`mcp-server/src/properties/p02-reconnect-delay.test.ts`
    - **Validates: Requirements 4.3, 4.4**

  - [ ]* 3.4 编写属性测试：缺失或空白的必填环境变量被拒绝
    - **Property 1: 缺失或空白的必填环境变量被拒绝**
    - 文件：`mcp-server/src/properties/p01-config-required.test.ts`，对 `loadConfig()` 生成空白、缺失的 `MCP_ENDPOINT` 与 `STRAPI_TOKEN`
    - **Validates: Requirements 4.2**

- [ ] 4. MCP_Server：Strapi 客户端超时与分页接口
  - [ ] 4.1 为 `StrapiClient` 增加超时、Token 校验与分页查询（D-7、D-9）
    - 在 `mcp-server/src/strapi-client.ts` 中为每次请求增加 10 秒超时，超时按网络错误处理并参与重试
    - 构造或请求前检查 `STRAPI_TOKEN`，为空时报错且指明缺少 `STRAPI_TOKEN`，不发出网络请求；`STRAPI_URL` 为空串时回退 `http://localhost:1337`
    - `ping()` 增加 5 秒超时，并在失败时返回或抛出可记录的失败原因
    - 新增 `listUnprocessedPage(page)`，返回当前页数据与是否还有下一页（按每页 100 条，`createdAt` 升序，条数少于 100 视为最后一页），失败时错误中包含页码；`listUnprocessed` 可复用该方法
    - 不修改调用方传入的 `record` 与 `patch`
    - _Requirements: 7.1, 7.2, 7.3, 7.6, 7.7, 7.10, 4.9, 4.10, 9.6, 9.7_

  - [ ]* 4.2 编写属性测试：Strapi 请求形状
    - **Property 8: Strapi 请求形状**
    - 文件：`mcp-server/src/properties/p08-strapi-request-shape.test.ts`，注入 `fetchImpl`
    - **Validates: Requirements 7.1, 7.3, 7.4, 7.5**

  - [ ]* 4.3 编写属性测试：重试策略按状态码分类
    - **Property 9: 重试策略按状态码分类**
    - 文件：`mcp-server/src/properties/p09-strapi-retry.test.ts`，使用注入的 `sleep`
    - **Validates: Requirements 7.6, 7.7, 7.8**

  - [ ]* 4.4 编写属性测试：缺少有效 data 的成功响应不重试
    - **Property 10: 缺少有效 data 的成功响应不重试**
    - 文件：`mcp-server/src/properties/p10-strapi-no-data.test.ts`
    - **Validates: Requirements 7.9**

  - [ ]* 4.5 编写属性测试：失败不修改调用方数据
    - **Property 11: 失败不修改调用方数据**
    - 文件：`mcp-server/src/properties/p11-strapi-no-mutation.test.ts`
    - **Validates: Requirements 7.10**

  - [ ]* 4.6 补充单元测试：超时、空 Token、分页
    - 在 `mcp-server/src/strapi-client.test.ts` 中覆盖 10 秒超时触发重试、空 Token 不发请求、`ping` 5 秒超时、`listUnprocessedPage` 多页与页码错误信息
    - _Requirements: 7.2, 7.6, 4.9, 9.6, 9.7_

- [ ] 5. MCP_Server：工具入参校验
  - [ ] 5.1 为 `echo` 与 `record_dream` 补充校验（D-5、D-6）
    - 在 `mcp-server/src/tools.ts` 中，`echo` 的 `text` 超过 10000 字符时返回 `isError: true` 并指明超出长度上限，不返回截断文本；缺失或非字符串时返回指明 `text` 无效的错误
    - `record_dream` 的 `content` 先 trim，要求长度 1 到 10000，缺失、空白或超长时返回 `isError: true` 的内容无效提示且不创建 Dream；入库的 `rawContent` 使用校验后的内容
    - `dreamedAt` 提供时必须是有效 ISO 8601 字符串，否则返回日期格式无效提示且不创建 Dream；未提供时使用当前时间的 ISO 8601 字符串
    - 保持：创建成功后立即返回确认文案，并在 `documentId` 非空时入队；缺 `documentId` 时仅记录警告；写入失败返回友好文案且不入队；未知工具返回含「未知工具」的错误
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [ ]* 5.2 编写属性测试：echo 是恒等函数
    - **Property 3: echo 是恒等函数**
    - 文件：`mcp-server/src/properties/p03-echo-identity.test.ts`，字符串长度限制在 0 到 10000
    - **Validates: Requirements 5.1**

  - [ ]* 5.3 编写属性测试：echo 拒绝非字符串参数
    - **Property 4: echo 拒绝非字符串参数**
    - 文件：`mcp-server/src/properties/p04-echo-invalid.test.ts`，经 MCP 请求处理器调用
    - **Validates: Requirements 5.2**

  - [ ]* 5.4 编写属性测试：record_dream 成功路径落库并入队
    - **Property 5: record_dream 成功路径落库并入队**
    - 文件：`mcp-server/src/properties/p05-record-dream-success.test.ts`
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5, 6.6**

  - [ ]* 5.5 编写属性测试：record_dream 失败或缺 documentId 时不误入队
    - **Property 6: record_dream 失败或缺 documentId 时不误入队**
    - 文件：`mcp-server/src/properties/p06-record-dream-no-enqueue.test.ts`
    - **Validates: Requirements 6.7, 6.9**

  - [ ]* 5.6 编写属性测试：未知工具名返回错误
    - **Property 7: 未知工具名返回错误**
    - 文件：`mcp-server/src/properties/p07-unknown-tool.test.ts`
    - **Validates: Requirements 6.10**

  - [ ]* 5.7 补充单元测试：输入校验边界
    - 在 `mcp-server/src/tools.test.ts` 中覆盖 `echo` 超 10000 字符、`content` 纯空白与超 10000、非法 `dreamedAt` 不创建 Dream、`content` 被 trim 后入库
    - _Requirements: 5.3, 6.4, 6.8_

- [ ] 6. MCP_Server：LLM 处理器属性测试
  - [ ]* 6.1 编写属性测试：LLM 未启用时不发请求
    - **Property 12: LLM 未启用时不发请求**
    - 文件：`mcp-server/src/properties/p12-llm-disabled.test.ts`
    - **Validates: Requirements 8.4**

  - [ ]* 6.2 编写属性测试：LLM 输出规整后始终合法
    - **Property 13: LLM 输出规整后始终合法**
    - 文件：`mcp-server/src/properties/p13-llm-normalize.test.ts`
    - **Validates: Requirements 8.5, 8.6, 8.7**

  - [ ]* 6.3 编写属性测试：代码围栏不影响解析
    - **Property 14: 代码围栏不影响解析**
    - 文件：`mcp-server/src/properties/p14-llm-fence.test.ts`
    - **Validates: Requirements 8.8**

  - [ ]* 6.4 编写属性测试：无效内容降级为空结果
    - **Property 15: 无效内容降级为空结果**
    - 文件：`mcp-server/src/properties/p15-llm-invalid.test.ts`
    - **Validates: Requirements 8.9**

  - [ ]* 6.5 编写属性测试：LLM 重试策略按状态码分类
    - **Property 16: LLM 重试策略按状态码分类**
    - 文件：`mcp-server/src/properties/p16-llm-retry.test.ts`，使用注入的 `sleep` 断言 1000ms、2000ms
    - **Validates: Requirements 8.10, 8.11**

- [ ] 7. MCP_Server：加工队列超时、去重与补偿扫描
  - [ ] 7.1 改造 `EnrichmentQueue`（D-8、D-9）
    - 在 `mcp-server/src/enrichment-queue.ts` 中为单个任务的 LLM 加工增加 60 秒超时、为回写增加 30 秒超时；超时或失败时保持 Dream 原文及 `aiProcessed=false`，记录含 Dream 标识与失败原因的日志，并在 1 秒内处理下一个任务
    - 维护排队与处理中的 `documentId` 集合，`enqueue` 与补偿扫描时跳过已在队列或正在加工的 Dream
    - `size` 或新增 `pending` 计数包含正在处理的任务，供退出流程使用
    - `recover()` 改为逐页调用 `listUnprocessedPage` 并边取边入队；任一页失败时保留已入队任务，记录含失败页码与原因的错误日志，不抛出，MCP_Server 继续运行
    - `drain(timeoutMs)` 返回是否排空以及未完成任务数量
    - 保持单 worker、FIFO，以及成功时单次回写 `title、summary、keywords、emotion、emotionScore、aiProcessed:true`，`clarity` 有值才附带
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 4.7, 4.8_

  - [ ]* 7.2 编写属性测试：队列串行且保序
    - **Property 17: 队列串行且保序**
    - 文件：`mcp-server/src/properties/p17-queue-serial.test.ts`
    - **Validates: Requirements 9.1**

  - [ ]* 7.3 编写属性测试：成功加工单次回写完整字段
    - **Property 18: 成功加工单次回写完整字段**
    - 文件：`mcp-server/src/properties/p18-queue-writeback.test.ts`
    - **Validates: Requirements 9.2, 9.3**

  - [ ]* 7.4 编写属性测试：单个任务失败不影响后续任务
    - **Property 19: 单个任务失败不影响后续任务**
    - 文件：`mcp-server/src/properties/p19-queue-isolation.test.ts`
    - **Validates: Requirements 9.4, 9.5**

  - [ ]* 7.5 补充单元测试：超时、去重与补偿分页
    - 在 `mcp-server/src/enrichment-queue.test.ts` 中，用假定时器覆盖 60 秒加工超时、30 秒回写超时、重复 `documentId` 去重、补偿第二页失败时保留第一页任务并记录页码
    - _Requirements: 9.4, 9.5, 9.6, 9.7, 9.8_

- [ ] 8. MCP_Server：生命周期与退出流程
  - [ ] 8.1 对齐启动、重连补偿与优雅退出（D-4、D-9）
    - 在 `mcp-server/src/index.ts` 中使用传输层的 `onconnected` 回调，在每次连接成功（含重连）后触发 `queue.recover()`
    - Strapi 自检使用 5 秒超时，失败时记录含失败原因的警告日志并继续连接 WebSocket
    - 收到 SIGINT 或 SIGTERM 时停止重连、关闭连接，并等待队列（含正在处理的任务）排空，最长 60 秒；排空时以退出码 0 退出，超时则记录含未完成任务数量的警告并以非零退出码退出
    - `MCP_ENDPOINT` 或 `STRAPI_TOKEN` 无效时，保持在创建任何 WebSocket 之前以非零退出码退出
    - _Requirements: 4.1, 4.2, 4.7, 4.8, 4.9, 4.10, 9.6_

  - [ ]* 8.2 编写传输层集成测试
    - 使用本地 `ws` 服务验证：首次连接失败后自动重连、连接成功后收到 `tools/list` 返回恰好 `echo` 与 `record_dream` 两个工具且请求标识一致、非法 JSON 得到解析错误响应且连接保持、不支持的方法得到错误响应
    - 文件：`mcp-server/src/ws-transport.test.ts`
    - _Requirements: 4.1, 4.3, 4.5, 4.6_

- [ ] 9. Checkpoint - MCP_Server 对齐完成
  - 在 `mcp-server` 中运行 `npm run build` 与 `vitest --run`，确保所有测试通过，有疑问时询问用户。

- [ ] 10. Frontend：工具函数、类型与聚合对齐
  - [ ] 10.1 为 frontend 添加 fast-check 并扩展测试范围
    - 在 `frontend/package.json` 中以固定版本添加 `fast-check` 开发依赖
    - 在 `frontend/vitest.config.ts` 中确认 `include` 覆盖 `app/utils/**/*.test.ts`，属性测试放在 `app/utils/properties/` 下
    - _Requirements: 10.4, 11.8, 12.2_

  - [ ] 10.2 `emotionMeta` 与 `EmotionPill` 的未知情绪回退（D-11）
    - 在 `frontend/app/types/dream.ts` 中让 `emotionMeta` 对空值或不在枚举内的值都返回「未知」名称、默认颜色与默认 emoji
    - 确保 `frontend/app/components/EmotionPill.vue` 在任何情绪取值下都不会因 `meta` 为 `undefined` 而抛错
    - _Requirements: 10.12_

  - [ ] 10.3 聚合函数补充次数相同的字典序排序（D-14）
    - 在 `frontend/app/utils/aggregate.ts` 中，`countEmotions` 次数相同时按 Emotion 名称字典序升序；`countKeywords` 频次相同时按关键词字典序升序，默认最多 60 项
    - 保持 `dreamDateKey` 以 `dreamedAt` 优先、`createdAt` 回退并忽略无法解析的日期，`countByDay` 与 `emotionTrend` 的行为不变
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [ ] 10.4 抽出摘录与 `normalize` 纯函数
    - 新增 `frontend/app/utils/excerpt.ts`，导出 `excerpt(text, max = 90)`：长度不超过 90 原样返回，否则返回前 90 个字符加「…」
    - 新增 `frontend/app/utils/normalize.ts`，导出 `normalize(item)`，从 `frontend/app/composables/useDreams.ts` 中移出并改为引用，保持 v5 平铺与 v4 `attributes` 结构同样的输出
    - _Requirements: 10.4, 10.5, 11.8_

  - [ ]* 10.5 编写属性测试：摘录截断规则
    - **Property 20: 摘录截断规则**
    - 文件：`frontend/app/utils/properties/p20-excerpt.test.ts`
    - **Validates: Requirements 10.4, 10.5**

  - [ ]* 10.6 编写属性测试：v4 与 v5 响应结构规整结果相同
    - **Property 21: v4 与 v5 响应结构规整结果相同**
    - 文件：`frontend/app/utils/properties/p21-normalize.test.ts`
    - **Validates: Requirements 11.8**

  - [ ]* 10.7 编写属性测试：情绪计数守恒且有序
    - **Property 22: 情绪计数守恒且有序**
    - 文件：`frontend/app/utils/properties/p22-count-emotions.test.ts`
    - **Validates: Requirements 12.2**

  - [ ]* 10.8 编写属性测试：关键词词频规则
    - **Property 23: 关键词词频规则**
    - 文件：`frontend/app/utils/properties/p23-count-keywords.test.ts`
    - **Validates: Requirements 12.3**

  - [ ]* 10.9 编写属性测试：按日聚合忽略无效日期并保持升序
    - **Property 24: 按日聚合忽略无效日期并保持升序**
    - 文件：`frontend/app/utils/properties/p24-count-by-day.test.ts`
    - **Validates: Requirements 12.4, 12.5, 12.6**

  - [ ]* 10.10 编写属性测试：情绪趋势为日均值
    - **Property 25: 情绪趋势为日均值**
    - 文件：`frontend/app/utils/properties/p25-emotion-trend.test.ts`
    - **Validates: Requirements 12.7**

  - [ ]* 10.11 补充单元测试：`emotionMeta` 与同次数排序
    - 覆盖已知情绪、空值、`"foo"` 等未知值的回退结果，以及 `countEmotions`、`countKeywords` 的同次数字典序示例
    - _Requirements: 10.12, 12.2, 12.3_

- [ ] 11. Frontend：数据访问与页面行为对齐
  - [ ] 11.1 为数据请求增加超时与分页终止条件（D-10、D-13）
    - 在 `frontend/app/composables/useDreams.ts` 中，`fetchDream` 增加 10 秒超时，超时或失败时返回「未找到」状态
    - `fetchDreams` 每页 100 条，返回条数少于 100 或已到分页元数据中的最后一页即停止；元数据缺失时以条数判断；任一页失败则抛出
    - `NUXT_PUBLIC_STRAPI_URL` 未配置时使用默认值 `http://localhost:1337`
    - _Requirements: 10.2, 10.3, 10.9, 11.1, 11.7_

  - [ ] 11.2 日记流页面使用摘录函数并校验显示规则
    - 在 `frontend/app/pages/index.vue` 中使用 `excerpt()`，摘录取 `summary` 或回退到 `rawContent`；标题缺失显示「未命名的梦」，关键词最多显示 5 个，`aiProcessed` 非真显示「未加工」标签
    - 保持 `pending → error → 空 → 列表` 的互斥渲染，错误时不显示已加载的卡片与空状态；卡片链接使用 `documentId ?? id`
    - _Requirements: 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11_

  - [ ] 11.3 详情页字段显示规则（D-12、D-13）
    - 在 `frontend/app/pages/dream/[id].vue` 中，仅当 `clarity` 是 1 到 5 的整数时显示「清晰度 N/5」，否则不显示
    - 情绪、摘要、关键词为空或缺失时不渲染对应内容，其余字段仍正常展示；关键词不截断，原文保留换行
    - 读取失败、超时或不存在时只显示「未找到这条梦境。」并保留「← 返回日记流」入口
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ] 11.4 统计页错误态与日历热力图（D-14）
    - 在 `frontend/app/pages/stats.vue` 中读取 `useAsyncData` 的 `error`：加载失败显示错误提示且不渲染图表；无数据显示数据不足的空状态；加载中显示「正在统计…」，完成或失败后移除
    - 日历热力图覆盖数据中出现的全部年份，不再只显示最新一条记录所在的那一年
    - 有数据时展示情绪趋势折线图、情绪分布柱状图、关键词云和日历热力图 4 个图表
    - _Requirements: 12.1, 12.8, 12.9, 12.10_

- [ ] 12. Checkpoint - Frontend 对齐完成
  - 在 `frontend` 中运行 `vitest --run` 与 `npm run generate`，确保所有测试通过，有疑问时询问用户。

- [ ] 13. 部署配置、环境模板与文档
  - [ ] 13.1 更新 `docker-compose.yml`（D-15、D-16、D-17、D-21）
    - 为 `backend` 增加健康检查（请求 Strapi 的 `/_health`），`mcp-server` 的 `depends_on.backend.condition` 改为 `service_healthy`
    - Strapi 密钥与数据库凭据使用 `${VAR:?缺少 VAR}` 形式，缺失时 `docker compose up` 非零退出并指明变量名，且不创建容器
    - 向 `mcp-server` 传递 `RECONNECT_BASE_DELAY_MS`、`RECONNECT_MAX_DELAY_MS`；确认 `LLM_ENABLED` 默认 `true`、`LOG_LEVEL` 默认 `info`
    - 保持三个服务 `restart: unless-stopped`、`pgdata` 与 `uploads` 命名卷、`1337:1337` 端口映射，并通过 `docker compose config` 验证
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11, 14.12_

  - [ ] 13.2 补齐 `.env.example` 模板（D-20、D-21）
    - 根目录 `.env.example` 增加 `RECONNECT_BASE_DELAY_MS`、`RECONNECT_MAX_DELAY_MS`
    - 确认 Backend、MCP_Server、Frontend 与根目录共 4 个 `.env.example` 都存在并列出全部变量，敏感变量为空或占位符
    - 修正 `mcp-server/.env.example` 中关于 Token 权限的注释：需 `find`、`create`、`update` 权限，或使用 Setup_Script 生成的 full-access Token
    - 确认 Backend 与 Frontend 的 `.env.example`、源码中不出现 LLM 密钥变量名，且 `.gitignore` 忽略各级 `.env` 而不忽略 `.env.example`
    - _Requirements: 15.1, 15.2, 15.3_

  - [ ] 13.3 完善 README（D-19）
    - 在 `README.md` 中补充已被 Git 跟踪的 `.env` 的移除步骤（`git rm --cached <路径>`，保留本地文件），并说明提交前检查 `git ls-files`
    - 确认包含本地开发与 Docker 部署的对比（`.env` 位置、加载方式、启动命令），以及覆盖连接、触发、写入、前端展示、加工状态 5 类问题的排错指南
    - 说明 Docker 模式下可通过 `RECONNECT_*` 调整重连参数、使用 `setup-access` 脚本生成 Token
    - _Requirements: 15.4, 15.5, 15.6_

- [ ] 14. Final checkpoint - 全部对齐完成
  - 确保 Backend、MCP_Server、Frontend 的构建与测试均通过，有疑问时询问用户。

## Notes

- 标记 `*` 的任务为可选，可跳过以加快 MVP；其中包含 25 条属性测试与补充单元测试
- 每个任务引用具体的需求条款，便于追溯；差异编号 D-n 见 design.md
- 属性测试对应 design.md 的 Property 1 到 Property 25，每条属性一个独立子任务
- 本计划只包含代码、配置与文档的修改任务，不包含部署到生产或人工验收
- D-17（Docker 重启间隔）由 Docker 的退避策略决定，本计划仅保证 `restart: unless-stopped` 已配置

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "3.1", "3.2", "4.1", "5.1", "10.1", "10.2", "10.3", "10.4", "13.1", "13.2"] },
    { "id": 1, "tasks": ["1.3", "3.3", "3.4", "4.2", "4.3", "4.4", "4.5", "4.6", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "6.1", "6.2", "6.3", "6.4", "6.5", "7.1", "8.2", "10.5", "10.6", "10.7", "10.8", "10.9", "10.10", "10.11", "11.1", "11.2", "13.3"] },
    { "id": 2, "tasks": ["7.2", "7.3", "7.4", "7.5", "8.1", "11.3", "11.4"] }
  ]
}
```
