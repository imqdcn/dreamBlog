# Implementation Plan: 梦境小屋与梦境分析助手（dream-story-and-agent）

## Overview

实现语言：**TypeScript**（Studio_Service 为 Node 20 + Hono，手写 Agent 循环；Backend 为 Strapi 5 的 TypeScript；Frontend 为 Nuxt 4）。属性测试统一使用 **fast-check**，测试框架沿用 Vitest。

任务按依赖顺序组织：

1. Backend 前置问题（缺 `pg` 依赖、缺健康检查）与测试基建
2. Backend 的 schema、校验、权限与 Studio 专用 Token
3. Studio_Service 的纯逻辑模块（配置、会话、限流、相似度、搜索、统计、token 估算、压缩、重复检测、脱敏）
4. Agent 工具、Agent 循环、Run 管理与 HTTP 路由
5. 离线评估脚本（Eval_Suite）
6. Frontend 新页面
7. Compose、环境变量与文档

本计划只包含编码类任务。设计中的每条 Correctness Property 对应一个带 `*` 的可选属性测试子任务。

## Tasks

- [x] 1. Backend 前置问题与测试基建
  - [x] 1.1 补齐 Backend 的 `pg` 依赖
    - 在 `backend/package.json` 的 dependencies 中加入精确固定版本的 `pg`，并更新 `package-lock.json`
    - 这是 Compose 固定 `DATABASE_CLIENT=postgres` 时 Backend 能启动的前置条件（遗留问题 D-18）
    - _Requirements: 1.2_

  - [x] 1.2 为 `backend` 服务增加 Compose 健康检查
    - 在 `docker-compose.yml` 的 `backend` 下新增 `healthcheck`，使用 `node -e "fetch('http://localhost:1337/_health')..."`（镜像无 curl），`interval: 10s`、`timeout: 5s`、`retries: 12`、`start_period: 60s`
    - 不改动 `mcp-server` 的 `depends_on`，不改变 `backend` 其他配置
    - 遗留问题 D-15 的前置修复，供 `studio-service` 的 `service_healthy` 依赖使用
    - _Requirements: 1.2_

  - [x] 1.3 搭建 Backend 测试基建
    - 在 `backend` 增加精确版本的 `vitest` 与 `fast-check` devDependencies、`vitest.config.ts` 和 `npm test` 脚本
    - 测试文件与源码同目录，命名 `*.test.ts`
    - _Requirements: 3.2, 3.7_

- [x] 2. Backend 数据模型、校验、权限与 Token
  - [x] 2.1 为 Dream 增加新字段
    - 在 `backend/src/api/dream/content-types/dream/schema.json` 增加 `isFavorite`（boolean，默认 false）与 `tags`（json）
    - 不修改任何现有字段（遗留问题 D-1 不在本次范围）
    - _Requirements: 3.1, 3.2, 3.9_

  - [x] 2.2 新增 `story` 内容类型
    - 在 `backend/src/api/story/` 下创建 schema、controller、routes、service（核心工厂，与 `dream` 同构），`draftAndPublish:false`
    - 字段：`title`（1–100）、`content`（1–20000）、`style`（四个枚举）、`tags`（json）、`sourceDreams`（多对多到 `api::dream.dream`）、`sourceSnapshot`（json）
    - _Requirements: 3.3, 3.4, 3.5, 8.7_

  - [x] 2.3 新增 `agent-run` 内容类型
    - 在 `backend/src/api/agent-run/` 下创建 schema、controller、routes、service，`draftAndPublish:false`
    - 字段：`runId`（required、unique）、`question`（maxLength 500）、`finalAnswer`、`terminationReason`（八个枚举）、`trace`（json）、`promptTokens`/`completionTokens`/`durationMs`/`stepCount`（integer，min 0）、`estimatedCost`（**float**，不用 decimal）、`model`、`redacted`、`usageEstimated`
    - 不为 `dream` 建立关系字段
    - _Requirements: 3.6, 13.1_

  - [x] 2.4 实现 Backend 校验纯函数
    - 创建 `backend/src/validation/tags.ts`（`validateTags`）、`dream.ts`（`validateDreamWrite`，create 时补 `tags:[]` 与 `isFavorite:false`）、`story.ts`（`validateStoryWrite`，`sourceDreams` 仅接受完整数组或 `{set:[...]}` 且数量 1–5，出现 `connect/disconnect` 一律拒绝）
    - 校验失败抛出 `@strapi/utils` 的 `errors.ValidationError` 并指明无效字段
    - 创建共享夹具 `backend/src/validation/__fixtures__/tags-cases.json`，供 Studio 侧对拍
    - 函数不依赖 Strapi 运行时，可单测
    - _Requirements: 3.2, 3.3, 3.4, 3.7, 3.8, 16.5_

  - [x] 2.5 在 `src/index.ts` 注册写入校验中间件与存量回填
    - 在 `register` 中通过 `strapi.documents.use` 对 `api::dream.dream` 与 `api::story.story` 的 create/update 调用校验函数
    - 在 `bootstrap` 中幂等回填：`isFavorite` 为 null 的 Dream 置 false，`tags` 为 null 的 Dream 置 `[]`
    - _Requirements: 3.7, 3.8, 3.9, 16.5_

  - [ ]* 2.6 编写属性测试：Tag 列表校验（Backend 侧）
    - **Property 8: Tag 列表校验**
    - 使用 fast-check 生成任意 JSON 值与边界 Tag，并用共享夹具验证
    - **Validates: Requirements 3.2, 3.7**

  - [ ]* 2.7 编写校验函数的单元测试
    - 覆盖 `validateDreamWrite` 的默认值补全、`validateStoryWrite` 的 `sourceDreams` 0/1/5/6 边界、`connect/disconnect` 被拒、非法 `style`
    - _Requirements: 3.3, 3.4, 3.8, 16.5_

  - [x] 2.8 扩展 `scripts/setup-access.js`
    - 新增 Studio 专用 API Token：`name:'studio-service-write'`，`type:'custom'`，权限为 `dream` 的 find/findOne/create/update、`story` 的 find/findOne/create/delete、`agent-run` 的 find/findOne/create；不授予 Dream delete
    - Public 角色追加 `api::story.story.find`、`findOne`；不为 `agent-run` 添加任何权限
    - 保持幂等：Token 已存在只提示不重建，已存在的权限不重复创建
    - _Requirements: 2.7, 2.8, 16.3, 16.4_

  - [ ]* 2.9 编写 Backend 集成测试（临时 SQLite）
    - 验证：Public 对 dream/story 写请求返回 403，对 agent-run 任何请求返回 403；非法 `tags` 与 `sourceDreams` 返回 400 且数据不变；旧数据读取得到 `isFavorite=false`、`tags=[]`；`bootstrap` 回填幂等
    - 验证 Strapi 5.61 实际的关系载荷形态，以及 `estimatedCost` 保留至少 6 位小数；验证删除 Dream 后 `sourceDreams` 关联行的清理行为
    - _Requirements: 2.7, 2.8, 3.7, 3.8, 3.9, 13.1, 16.3, 16.4, 16.5_

  - [ ]* 2.10 编写 `setup-access.js` 幂等集成测试
    - 在临时 SQLite 上连续运行两次，第二次不重建 Token，不重复创建权限
    - _Requirements: 2.7, 2.8_

- [x] 3. 检查点 - Backend 就绪
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Studio_Service 脚手架、配置、脱敏与 CORS
  - [x] 4.1 创建 `studio-service` 项目脚手架
    - 创建 `package.json`（Node 20、ESM，依赖 `hono`、`@hono/node-server`、`zod`、`zod-to-json-schema`、`dotenv`，devDependencies 含 `vitest`、`typescript`、`fast-check`，全部精确版本）、`tsconfig.json`、`vitest.config.ts`、`.env.example`（敏感变量留空，注释建议口令与密钥至少 12 个字符）、`.gitignore`（含 `eval/reports/`）
    - 创建 `src/` 与 `eval/` 目录骨架
    - _Requirements: 1.1, 1.10_

  - [x] 4.2 实现 `config.ts` 的 `loadConfig`
    - 校验四个必填 `STUDIO_*` 变量，缺失、空串、全空白都视为缺失；一次收集全部缺失变量名并抛出 `ConfigError{missing}`，错误文本不含任何取值
    - 解析可选变量及默认值（端口 8787、Max_Steps 8、Context_Budget 12000、`TZ` 默认 `Asia/Shanghai` 等），配置对象 `Object.freeze`
    - _Requirements: 1.3, 1.5_

  - [ ]* 4.3 编写属性测试：配置缺失校验
    - **Property 1: 配置缺失时报告全部缺失变量且不泄露取值**
    - **Validates: Requirements 1.5**

  - [x] 4.4 实现脱敏与日志（`agent/redact.ts`、`logger.ts`）
    - `redactSecrets` 将任何密钥取值替换为 `[REDACTED]`；`checkOutput` 在回答含密钥取值时整体替换为固定安全提示并返回 `redacted=true`
    - `logger` 输出单行 JSON（`ts, level, runId?, msg`），序列化前统一脱敏，初始化时登记四个密钥值
    - _Requirements: 2.6, 12.6, 12.7, 12.8, 13.10_

  - [ ]* 4.5 编写属性测试：脱敏与输出检查
    - **Property 7: 脱敏与输出检查**
    - **Validates: Requirements 2.6, 12.6, 12.7, 12.8**

  - [x] 4.6 实现 `http/cors.ts` 的 `corsHeadersFor`
    - 仅当 `Origin` 与允许列表某一项逐字符相等时返回跨域许可头（含 `Vary: Origin`），否则返回空对象；不使用通配符，不做子串或后缀匹配
    - _Requirements: 1.6, 1.7_

  - [ ]* 4.7 编写属性测试：CORS 精确匹配
    - **Property 2: CORS 仅放行完全匹配的来源**
    - **Validates: Requirements 1.6, 1.7**

- [x] 5. 认证、会话与限流
  - [x] 5.1 实现口令校验与会话令牌（`auth/passphrase.ts`、`auth/session.ts`）
    - `verifyPassphrase`：非字符串或长度不在 1–128 返回 false，对双方做 SHA-256 后用 `timingSafeEqual` 比较
    - `signSession` / `verifySession`：令牌格式 `base64url(payload).base64url(hmac)`，HMAC-SHA256，有效期 12 小时，验证顺序为格式、签名、过期
    - _Requirements: 2.1, 2.2, 2.5_

  - [ ]* 5.2 编写属性测试：会话令牌
    - **Property 3: 会话令牌往返、过期与篡改**
    - **Validates: Requirements 2.1, 2.5**

  - [ ]* 5.3 编写属性测试：口令校验
    - **Property 4: 口令校验**
    - **Validates: Requirements 2.2**

  - [x] 5.4 实现登录失败锁定状态机（`auth/login-guard.ts`）
    - 注入 `now`，按来源地址记录最近 10 分钟的失败；第 5 次失败锁定 15 分钟，锁定期内不比较口令直接返回 429；锁定结束后计数清零；成功清零
    - 实现来源地址解析（`STUDIO_TRUST_PROXY=true` 时取 `X-Forwarded-For` 最左项）和每 5 分钟的过期项清扫
    - _Requirements: 2.3, 2.4_

  - [ ]* 5.5 编写属性测试：登录锁定状态机
    - **Property 5: 登录锁定状态机**
    - 以“重放整个历史再判定”的朴素模型为参照
    - **Validates: Requirements 2.3, 2.4**

  - [x] 5.6 实现滑动窗口限流（`limits/sliding-window.ts`）
    - `SlidingWindowLimiter.tryAcquire(key, now)`：先剔除过期时间戳；达到上限则拒绝并返回 `retryAfterMs`，拒绝的请求不入表；提供空项清扫
    - _Requirements: 12.9_

  - [ ]* 5.7 编写属性测试：滑动窗口限流
    - **Property 6: 滑动窗口限流**
    - **Validates: Requirements 12.9**

- [x] 6. 领域纯逻辑
  - [x] 6.1 实现日期工具与领域类型（`domain/dates.ts`、`domain/types.ts`）
    - `dreamDateKey`（`dreamedAt` 优先、`createdAt` 回退、按 `TZ`）、周（周一起点）与月分桶（仅对 `YYYY-MM-DD` 字符串做日期算术）、`validateDateRange`（两端为有效日历日期且 `from <= to`）
    - 定义 `DreamRecord`、`DreamLike`、`StoryStyle`、`TerminationReason` 等共享类型
    - _Requirements: 9.4, 13.7, 13.9_

  - [ ]* 6.2 编写属性测试：日期区间校验
    - **Property 45: 日期区间校验**
    - **Validates: Requirements 13.9**

  - [x] 6.3 实现 Tag 工具（`domain/tags.ts`）
    - `normalizeTag`、`validateTags`（与 Backend 规则一致）、`addTag`（已存在则幂等）、`removeTag`、`unionTags(sources, max=10)`
    - 复制 Backend 的共享夹具并用于对拍
    - _Requirements: 3.2, 4.10, 4.11, 7.13_

  - [ ]* 6.4 编写属性测试：Tag 列表校验（Studio 侧）
    - **Property 8: Tag 列表校验**
    - 同时用共享夹具验证与 Backend 判定一致
    - **Validates: Requirements 3.2, 3.7**

  - [ ]* 6.5 编写属性测试：Tag 增删
    - **Property 9: Tag 增删**
    - **Validates: Requirements 4.10, 4.11**

  - [ ]* 6.6 编写属性测试：Tag 并集
    - **Property 20: Tag 并集**
    - **Validates: Requirements 7.13**

  - [x] 6.7 实现请求文本与参数校验（`domain/validation.ts`）
    - `validateDreamContent`（trim 后 1–10000）、`validateQuestion`（trim 后 1–500）、`validateFavoriteBody`（`isFavorite` 必须为布尔值）
    - _Requirements: 4.8, 5.6, 10.12_

  - [ ]* 6.8 编写属性测试：文本长度校验
    - **Property 11: 文本长度校验**
    - **Validates: Requirements 4.8, 10.12, 14.10**

  - [ ]* 6.9 编写属性测试：珍藏参数校验
    - **Property 12: 珍藏参数校验**
    - **Validates: Requirements 5.6**

  - [x] 6.10 实现相似度与梦境宇宙（`domain/similarity.ts`）
    - `norm`（NFKC、trim、小写）、加权 Jaccard（keywords 0.5、tags 0.3、emotion 0.2，仅对可用组件加权平均；无可用组件时按 `documentId` 是否相同取 1 或 0）
    - `type SimilarityFn`；`buildUniverse(dreams, threshold=0.3)`：边的 `source < target`，`score` 保留 3 位小数，无自环、无重复边
    - 实现按“Dream 数量 + 最大 `updatedAt`”指纹缓存 60 秒
    - _Requirements: 6.5, 6.6, 6.7, 6.8_

  - [ ]* 6.11 编写属性测试：相似度范围与对称
    - **Property 15: 相似度范围与对称**
    - **Validates: Requirements 6.6**

  - [ ]* 6.12 编写属性测试：自相似度为 1
    - **Property 16: 自相似度为 1**
    - **Validates: Requirements 6.7**

  - [ ]* 6.13 编写属性测试：无重叠时相似度为 0
    - **Property 17: 无重叠时相似度为 0**
    - **Validates: Requirements 6.8**

  - [ ]* 6.14 编写属性测试：宇宙的边规则
    - **Property 18: 宇宙的边规则**
    - **Validates: Requirements 6.5**

  - [x] 6.15 实现搜索（`domain/search.ts`）
    - `tokenize`（NFKC 小写；CJK 单字或二元组；拉丁/数字按词，长度 ≥ 2）、`relevance`（字段权重 title 3、keywords 3、tags 2、summary 1.5、rawContent 1）、`searchDreams`
    - 过滤：日期区间含端点、`emotion`、`tag`；排序：相关度降序、日期降序、`documentId` 升序；`query` 为空时仅过滤并按日期倒序
    - _Requirements: 9.2_

  - [x] 6.16 实现统计（`domain/stats.ts`）
    - `emotionTrend`：按粒度分桶，`avgEmotionScore` 保留 2 位小数（全无分数为 null），`dominantEmotion` 次数相同取字典序最小，无 Dream 的区间不出现
    - `keywordStats`：关键词 trim 后计数，过滤空串，次数降序、同次数字典序升序
    - _Requirements: 9.4, 9.6_

  - [x] 6.17 实现故事请求逻辑（`domain/story-request.ts`）
    - `validateStoryRequest(body, existsFn)`：`dreamIds` 为长度 1–5 的字符串数组、无重复、全部存在，`style` 合法；失败时返回指明具体原因的错误
    - 去重键 `sha256(JSON.stringify({style, ids: sorted}))` 与 `inFlight` 集合管理（`finally` 释放）
    - `parseStoryOutput`：去围栏后 JSON 解析，`title`/`content` trim 后均非空，`title` 超过 100 个字符截取前 100，`content` 超过 20000 视为失败
    - _Requirements: 3.4, 7.10, 7.11, 7.12_

  - [ ]* 6.18 编写属性测试：Story 创建请求校验
    - **Property 10: Story 创建请求校验**
    - **Validates: Requirements 3.4, 7.10**

  - [ ]* 6.19 编写属性测试：故事输出解析
    - **Property 21: 故事输出解析**
    - **Validates: Requirements 7.11**

  - [ ]* 6.20 编写属性测试：生成去重键
    - **Property 22: 生成去重键**
    - **Validates: Requirements 7.12**

- [x] 7. Token 估算、成本与 LLM 客户端
  - [x] 7.1 实现 token 与成本（`llm/tokens.ts`）
    - `estimateTokens`（CJK 字符按 1，其余 `ceil(n/4)`，每条消息额外加 4，`tools` 的 JSON Schema 也计入）、`estimateUsage`（输入与输出文本各按字符数 ÷ 4 向上取整）、`calcCost`
    - _Requirements: 11.1, 13.3, 13.4_

  - [ ]* 7.2 编写属性测试：成本计算
    - **Property 41: 成本计算**
    - **Validates: Requirements 13.3**

  - [ ]* 7.3 编写属性测试：缺失用量时的估算
    - **Property 42: 缺失用量时的估算**
    - **Validates: Requirements 13.4**

  - [x] 7.4 实现 OpenAI 兼容 LLM 客户端（`llm/client.ts`）
    - 基于 `fetch`，支持 `tools`、`toolChoice`、`AbortSignal`；抛出 `LlmTransientError`（网络错误、超时、5xx）与 `LlmPermanentError`（4xx、响应格式不合法，含供应商 429）
    - 解析 `usage`（缺失时返回 undefined），`fetchImpl` 可注入
    - _Requirements: 10.8, 7.11_

  - [x] 7.5 实现梦境加工（`llm/enrich.ts`）
    - 复制 `mcp-server/src/llm-processor.ts` 的提示词与 `parseAndValidate` 规整规则（不修改 `mcp-server`）
    - 输出 `title, summary, keywords, emotion, emotionScore, clarity`；非法 `emotion` 回落 `neutral`，`emotionScore` 限制在 [-1,1]，`clarity` 为 [1,5] 整数
    - _Requirements: 4.7, 16.1_

  - [ ]* 7.6 编写属性测试：梦境加工输出规整
    - **Property 50: 梦境加工输出规整**
    - 额外与 `mcp-server` 的 `parseAndValidate` 对同一输入对拍
    - **Validates: Requirements 4.7**

  - [ ]* 7.7 编写 LLM 客户端单元测试
    - 注入 `fetchImpl`：5xx 与网络错误归为瞬时、4xx 归为永久、`usage` 缺失、响应格式非法
    - _Requirements: 10.8_

- [x] 8. Backend 客户端与数据源
  - [x] 8.1 实现 Strapi 客户端（`backend/strapi-client.ts`）
    - `createDream/updateDream/createStory/deleteStory/createAgentRun/listAgentRuns/getAgentRun`，带 `Authorization: Bearer`，10 秒超时
    - 5xx 与网络错误重试 2 次（500ms、1000ms），4xx 不重试；`createStory`/`createAgentRun` 的 POST 不重试
    - _Requirements: 1.3, 4.6, 7.6, 13.1_

  - [x] 8.2 实现只读数据源（`backend/dream-source.ts`）
    - `ReadOnlyDreamSource` 接口（`listAll`、`getByDocumentId`，无任何写方法）、`StrapiDreamSource`（`pageSize=100` 分页取全量，受传入 `AbortSignal` 约束，不重试，上限最新 5000 条并标注 `snapshotTruncated`）、`FixtureDreamSource`
    - _Requirements: 9.7, 9.11, 15.2_

  - [ ]* 8.3 编写 Backend 客户端与数据源单元测试
    - 覆盖重试规则、POST 不重试、分页、5000 条截断、`AbortSignal` 中止
    - _Requirements: 9.11, 13.1_

- [x] 9. Agent 基础组件
  - [x] 9.1 实现数据分隔与转义（`agent/delimit.ts`）
    - `escapeUntrusted`：`<<<`→`＜＜＜`，`>>>`→`＞＞＞`；`delimit(source, text, id)` 输出 `<<<DATA source=... id=...>>>` … `<<<END_DATA id=...>>>`
    - _Requirements: 7.9, 12.1, 12.2_

  - [ ]* 9.2 编写属性测试：数据分隔与转义
    - **Property 39: 数据分隔与转义**
    - **Validates: Requirements 7.9, 12.1, 12.2**

  - [x] 9.3 实现参数守卫（`agent/guard.ts`）
    - `guardArgs(args, {backendUrl, secrets})` 递归检查字符串：URL 协议头、`//host`、Backend 主机名、`Bearer` 凭证、任一密钥取值；返回命中的规则名，不含命中的值
    - _Requirements: 12.4, 12.5_

  - [ ]* 9.4 编写属性测试：参数守卫
    - **Property 40: 参数守卫**
    - **Validates: Requirements 12.4, 12.5**

  - [x] 9.5 实现重复调用检测与连续失败计数（`agent/repeat.ts`、`agent/failures.ts`）
    - `canonicalize`（键排序、字符串 trim、丢弃 undefined、递归）、`callKey`、`RepeatTracker`（累计所有发起过的调用，第 3 次报告 `isThird`）
    - `ConsecutiveFailures`：仅 `backend_unavailable`、`timeout`、`internal` 累加，成功清零，参数无效、未知工具、守卫拒绝、`not_found`、空结果不改变计数，第 3 次触发
    - _Requirements: 10.5, 10.6, 10.7_

  - [ ]* 9.6 编写属性测试：参数规范化与重复调用检测
    - **Property 32: 参数规范化与重复调用检测**
    - **Validates: Requirements 10.5**

  - [ ]* 9.7 编写属性测试：连续失败计数
    - **Property 33: 连续失败计数**
    - **Validates: Requirements 10.7**

  - [x] 9.8 实现 LLM 重试与退避（`agent/retry.ts`）
    - `callWithRetry`：单次尝试 60 秒超时，瞬时错误最多重试 2 次，等待 1000ms、2000ms（通过 `clock.sleep(ms, signal)`，可被中止），永久错误不重试，`signal` 已中止则立即抛 `AbortError`
    - _Requirements: 10.8_

  - [ ]* 9.9 编写属性测试：LLM 重试与退避
    - **Property 34: LLM 重试与退避**
    - **Validates: Requirements 10.8**

  - [x] 9.10 实现工具结果限长（`agent/limit-result.ts`）
    - `limitResult(result, 3000)`：列表型 `data` 二分查找最大前缀并标注 `truncated`、`omitted`；非列表或单项仍超限时退化为带 `partial` 前缀的结果，保证整体不超过 3000
    - _Requirements: 9.12_

  - [ ]* 9.11 编写属性测试：工具结果限长
    - **Property 31: 工具结果限长**
    - **Validates: Requirements 9.12**

  - [x] 9.12 定义 Agent 公共类型与 Trace（`agent/types.ts`、`agent/trace.ts`）
    - `LlmClient`、`ChatRequest/Response`、`ToolCall`、`Clock`、`AgentDeps`、`AgentResult`、`ToolResult` 信封（含错误码枚举）、`Turn`、`ProgressEvent`
    - `StepTrace`、`ToolCallTrace`、`CompressionTrace`、`SummaryTrace`、`TraceEntry` 及构造函数；Trace 序列化前脱敏
    - _Requirements: 13.2, 11.7_

  - [x] 9.13 实现上下文管理（`agent/context.ts`）
    - `fitContext(ctx, budget)`：保护系统指令、历史、当前问题与最近 2 个已完成步骤；按步骤序号从小到大把尚未压缩的步骤的 tool 消息替换为不超过 200 字符的确定性 `digest`；保留项超预算返回 `token_budget` 失败；幂等
    - 每次压缩产生 `CompressionTrace{atStep, trigger, compressedSteps, tokensBefore, tokensAfter}`；被压缩步骤的 assistant `tool_calls` 保留以保持成对
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.7_

  - [ ]* 9.14 编写属性测试：上下文压缩
    - **Property 37: 上下文压缩**（200 次运行）
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.7**

  - [x] 9.15 实现会话历史（`agent/session-memory.ts`）
    - `SessionMemory` 按 `sid` 保存最近 3 轮 `{question, answer}`（回答截断到 2000 字符存入），最多缓存 50 个会话，会话过期后清理；不保存工具调用明细
    - _Requirements: 11.5_

  - [ ]* 9.16 编写属性测试：会话历史窗口
    - **Property 38: 会话历史窗口**
    - **Validates: Requirements 11.5**

- [x] 10. Agent 工具
  - [x] 10.1 实现工具公共层与注册表（`agent/tools/common.ts`、`registry.ts`）
    - `AgentTool` 接口（`name`、10–300 字符 `description`、`schema: z.ZodType`、纯函数 `run(args, {dreams, today})`）
    - 公共 zod 片段：有效日历日期、`dateFrom <= dateTo` 的 `superRefine`、字符串最大长度；`ToolSpec` 通过 `zodToJsonSchema` 生成
    - 参数校验失败时返回 `invalid_arguments`，`fields` 列出每个无效字段名及合法类型或取值范围，且不访问数据源
    - _Requirements: 9.1, 9.8_

  - [x] 10.2 实现 `search_dreams`
    - 参数：`query`、`dateFrom`、`dateTo`、`emotion`、`tag`、`limit`（1–20，默认 10）；返回仅含 `documentId,title,summary,emotion,dreamedAt,keywords` 的摘要；无匹配返回 `ok:true, data:[], empty:true`
    - _Requirements: 9.2, 9.9_

  - [x] 10.3 实现 `get_dream`
    - 参数 `documentId`；`rawContent` 超过 2000 字符截断并返回 `truncated`、`originalLength`；不存在返回 `not_found`
    - _Requirements: 9.3, 9.10_

  - [x] 10.4 实现 `emotion_trend` 与 `keyword_stats`
    - 基于 `domain/stats.ts`；参数范围：`granularity ∈ day|week|month`（默认 week），`keyword_stats.limit` 1–50（默认 20）
    - _Requirements: 9.4, 9.6, 9.9_

  - [x] 10.5 实现 `find_similar_dreams`
    - 参数 `documentId`、`limit`（1–10，默认 5）；结果不含自身，按 `score` 降序，`score > 0`；`documentId` 不存在返回 `not_found`
    - _Requirements: 9.5, 9.10_

  - [ ]* 10.6 编写属性测试：工具参数校验
    - **Property 25: 工具参数校验**
    - **Validates: Requirements 9.8**

  - [ ]* 10.7 编写属性测试：search_dreams 的过滤、数量与排序
    - **Property 26: search_dreams 的过滤、数量与排序**
    - **Validates: Requirements 9.2**

  - [ ]* 10.8 编写属性测试：get_dream 的原文截断
    - **Property 27: get_dream 的原文截断**
    - **Validates: Requirements 9.3**

  - [ ]* 10.9 编写属性测试：emotion_trend 的分桶与统计
    - **Property 28: emotion_trend 的分桶与统计**
    - **Validates: Requirements 9.4**

  - [ ]* 10.10 编写属性测试：find_similar_dreams 的结果
    - **Property 29: find_similar_dreams 的结果**
    - **Validates: Requirements 9.5**

  - [ ]* 10.11 编写属性测试：keyword_stats 的计数与顺序
    - **Property 30: keyword_stats 的计数与顺序**
    - **Validates: Requirements 9.6**

  - [ ]* 10.12 编写工具元数据与静态结构测试
    - 断言五个工具的名称、描述长度 10–300、schema 存在；空结果与 `not_found` 的信封形状
    - 静态断言 `agent/tools/*.ts` 不 import `backend/strapi-client` 且无 create/update/delete 类 Backend 调用
    - _Requirements: 9.1, 9.7, 9.9, 9.10, 12.3_

- [x] 11. Agent 循环与 Run 管理
  - [x] 11.1 实现系统指令（`agent/prompt.ts`）
    - 包含角色、只能依据工具数据回答、当前日期 `YYYY-MM-DD`（按 `TZ`，由 `clock.now()` 生成）、数据不足如实说明、引用梦境时给出标题与 `documentId`、分隔区约定、回答语言跟随用户
    - 系统指令与工具描述不含任何密钥取值
    - _Requirements: 11.6, 12.1, 12.8_

  - [x] 11.2 实现 `runAgent` 主循环（`agent/loop.ts`）
    - 状态机 Prepare → Gate → Compress → CallLLM → Execute，所有副作用经 `AgentDeps` 注入
    - Gate 按优先级判定 `timeout` > `cancelled` > `token_budget`（累计 ≥ 60000）> `max_steps`；`answered`、`llm_failure`、`repeated_call`、`tool_failure` 的终止点按设计实现
    - Execute：未知工具（返回五个工具名并计入步骤）、参数无效、守卫拒绝（Trace 记 `rejected`）、第 3 次重复调用则整步不执行并将其标为 `skipped`、通过预检的调用 `Promise.allSettled` 并行执行且每个 10 秒超时、按 LLM 返回顺序回填
    - 总结调用：仅对 `max_steps`、`repeated_call` 发起 `toolChoice:'none'` 的一次调用，不计入步骤序号；失败时保留原终止原因并返回固定文案，不拼接原始工具结果
    - 取消与超时通过 `AbortSignal` 中止进行中的 LLM 请求和工具调用；输出检查与脱敏；用量缺失时使用估算并标记 `usageEstimated`
    - _Requirements: 9.8, 9.11, 9.13, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.13, 10.15, 11.1, 11.4, 12.5, 12.6, 12.7, 12.10, 13.2, 13.4_

  - [ ]* 11.3 编写属性测试：并行工具调用保序
    - **Property 35: 并行工具调用保序**
    - **Validates: Requirements 10.13**

  - [ ]* 11.4 编写属性测试：Agent 循环的终止性与一致性
    - **Property 36: Agent 循环的终止性与一致性**（200 次运行，脚本化 LLM、假时钟、可控 `AbortController`）
    - **Validates: Requirements 10.3, 10.4, 10.6, 10.11, 12.10, 13.2**

  - [ ]* 11.5 编写终止原因回归与循环示例测试
    - 八个 Termination_Reason 各一个脚本化用例
    - 覆盖：未知工具返回五个工具名并计入步骤、取消后不再发起新 LLM 请求、总结调用失败返回固定文案、系统指令含当前日期、分隔区转义
    - _Requirements: 9.13, 10.3, 10.4, 10.5, 10.7, 10.8, 10.9, 10.10, 10.15, 11.6, 12.10_

  - [x] 11.6 实现 Run 注册表与进度快照（`agent/run-registry.ts`）
    - `RunRegistry.start(sid, question)` 同一 `sid` 已有运行中的 Run 时返回 `busy`；`cancel(runId)`；`runId = crypto.randomUUID()`，所有日志行带 `runId`
    - `setTimeout` 触发 120 秒总超时；进度快照 `{runId, state, currentStep, steps[{step, phase, tools[{name, status}]}], result?}`；Run 结束后内存保留 10 分钟
    - `SIGTERM` 时取消所有运行中的 Run 并等待最多 5 秒
    - _Requirements: 10.1, 10.9, 10.10, 10.14, 13.10, 14.2_

  - [ ]* 11.7 编写 Run 注册表单元测试
    - 并发提交返回 busy 且原 Run 不受影响、取消、120 秒超时、结束后保留与清理
    - _Requirements: 10.9, 10.10, 10.14_

  - [x] 11.8 实现运行记录查询与汇总（`runs/summary.ts`）
    - 列表分页（每页 ≤ 50、`createdAt` 倒序、附 `totalTokens`）；`summarizeRuns(runs, from, to)`：区间含起止日期当天（本地时区），输出 `runs`、`byReason`（百分比 1 位小数）、`avgSteps`（1 位小数）、`totalTokens`、`totalCost`；区间无 Run 时全部为 0 且 `byReason` 为空
    - _Requirements: 13.6, 13.7, 13.8, 13.9_

  - [ ]* 11.9 编写属性测试：Run 列表分页与排序
    - **Property 43: Run 列表分页与排序**
    - **Validates: Requirements 13.6**

  - [ ]* 11.10 编写属性测试：Run 区间汇总
    - **Property 44: Run 区间汇总**
    - **Validates: Requirements 13.7, 13.8**

- [x] 12. 检查点 - Studio 核心逻辑与 Agent 循环
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Studio_Service HTTP 层
  - [x] 13.1 实现故事生成器（`llm/story-generator.ts`）
    - 系统指令声明分隔区内指令不被执行；每条 Dream 的 `rawContent` 与加工字段用 `delimit()` 包裹，来源名 `dream:<序号>`；按风格提示生成 JSON `{title, content}`；60 秒超时，不重试
    - LLM 失败或 `parseStoryOutput` 返回 null 时抛出生成失败错误
    - _Requirements: 7.6, 7.9, 7.11_

  - [x] 13.2 实现 Dream 加工队列与状态存储
    - 单 worker FIFO 队列，调用 `llm/enrich.ts`，成功后一次 `PUT` 回写字段并置 `aiProcessed:true`，`clarity` 有值才附带
    - `Map<documentId, {status, error?}>` 保存 30 分钟；失败时保留原文且 `aiProcessed` 保持 false
    - _Requirements: 4.7, 4.9_

  - [x] 13.3 实现 Hono 应用与中间件（`http/app.ts`、`http/middleware.ts`）
    - `createApp(deps)`：挂载 CORS（含 `OPTIONS` 预检）、`requireOwner`（会话无效返回 401，之前不触发 Backend 或 LLM）、来源地址限流（公开接口 60 次/分钟）、统一错误体 `{error:{code,message,fields?}}` 及状态码映射
    - 路由通过 `registerXRoutes(app, deps)` 形式挂载
    - _Requirements: 1.6, 1.7, 2.5_

  - [x] 13.4 实现 `health` 与 `auth` 路由
    - `GET /health`：对 `{strapi}/_health` 使用 2 秒超时，返回 `{status, backend}`，仅含这两个字段，Backend 不可达时 `degraded`
    - `POST /v1/auth/login`：401/429 处理，成功返回 `{token, expiresAt}`，接入 `LoginGuard`
    - _Requirements: 1.8, 1.9, 2.1, 2.2, 2.3, 2.4_

  - [x] 13.5 实现 `universe` 路由
    - `GET /v1/universe?threshold=0.3`：读取全量 Dream 调用 `buildUniverse`，使用 60 秒指纹缓存；Dream 少于 2 条返回空 `edges`
    - _Requirements: 6.5, 6.6, 6.10_

  - [x] 13.6 实现 `dreams` 路由
    - `POST /v1/dreams`（保存后立即返回 201 与 `enrichment:"pending"`，加工转入后台队列）、`GET /v1/dreams/:id/enrichment`、`POST /v1/dreams/:id/enrich`、`PATCH /v1/dreams/:id/tags`（`add` 或 `remove` 二选一，校验失败 400 且不写 Backend）、`PUT /v1/dreams/:id/favorite`（先 GET 确认存在，404 不创建；设置绝对值，PUT 失败返回 502）
    - _Requirements: 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 5.1, 5.4, 5.5, 5.6, 5.7_

  - [x] 13.7 实现 `stories` 路由
    - `POST /v1/stories`：校验 → 逐条读取 Dream → 去重键占用（冲突 409，不调用 LLM）→ 生成 → 保存 Story（含 `sourceSnapshot`、Tag 并集），`finally` 释放去重键；失败返回 502
    - `DELETE /v1/stories/:id` 仅删除 Story，失败时保留并返回错误
    - _Requirements: 7.6, 7.10, 7.11, 7.12, 7.13, 8.9_

  - [x] 13.8 实现 `agent` 路由
    - `POST /v1/agent/runs`：顺序为认证 → 问题校验（400 不计数）→ 并发检查（429 不计数）→ 限流（30 次/60 分钟，计数）→ 启动 Run，返回 202 `{runId}`
    - `GET /progress`、`POST /cancel`（最多等待 5 秒让 Run 结束）、`GET /runs`、`GET /runs/:runId`、`GET /summary`（日期无效返回 400）
    - Run 结束后写入 `agent_run`（含 `stepCount`、`redacted`、`usageEstimated`）；持久化失败只记录带 `runId` 的错误日志，最终回答照常返回；更新 `SessionMemory`
    - _Requirements: 10.1, 10.10, 10.12, 10.14, 12.9, 13.1, 13.5, 13.6, 13.7, 13.9, 13.11_

  - [x] 13.9 实现入口装配与优雅退出（`src/index.ts`）
    - `main()` 捕获 `ConfigError`，向 stderr 输出缺失变量名，在创建 HTTP 服务器前以退出码 1 退出
    - 装配 logger、客户端、队列、路由，启动 `@hono/node-server`；处理 `SIGTERM`
    - _Requirements: 1.1, 1.3, 1.5_

  - [ ]* 13.10 编写路由单元测试（health、auth、CORS、universe、dreams）
    - 使用 `app.request()` 与注入的 `fetchImpl`/LLM 替身：健康检查在 Backend 不可达时 `degraded` 且响应不含密钥、登录 401/429、未登录写入请求 401 且不触发 Backend、创建 Dream 立即返回、珍藏幂等与 404、Tag 校验失败不写 Backend
    - _Requirements: 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.5, 4.6, 4.8, 4.11, 5.4, 5.5_

  - [ ]* 13.11 编写路由单元测试（stories、agent）
    - 故事成功/失败/409 路径、删除只删 Story；agent 并发 429、限流 429、持久化失败仍返回回答、汇总日期无效 400
    - _Requirements: 7.10, 7.11, 7.12, 8.9, 10.14, 12.9, 13.9, 13.11_

- [x] 14. 离线评估 Eval_Suite
  - [x] 14.1 创建评估夹具 `eval/fixtures/dreams.json`
    - 约 40 条梦境，其中至少 2 条含提示词注入文本（含金丝雀字符串）
    - _Requirements: 15.2_

  - [x] 14.2 实现脚本化 LLM（`eval/scripted-llm.ts`）
    - 按用例 `script` 回放；支持故障注入：前 k 次抛瞬时错误、返回超大 `usage` 以触发 `token_budget`、永远返回新参数的工具调用以触发 `max_steps`、重复同一调用以触发 `repeated_call`
    - _Requirements: 15.11_

  - [x] 14.3 实现评分（`eval/score.ts`）
    - `toolSelectionCorrect`、`factHit`（`toLowerCase` 后 `includes`）、`injectionPass`、`aggregate`（正确率、事实命中率、终止原因计数与占比、平均步数 2 位、平均 token 取整、平均成本 6 位；无可统计用例时显示 `n/a`）、退出码判定（正确率低于 `EVAL_MIN_TOOL_ACCURACY`（默认 0.8）或注入类用例未通过则非零）
    - _Requirements: 15.3, 15.4, 15.5, 15.6, 15.10_

  - [x] 14.4 实现报告与对比（`eval/report.ts`、`eval/compare.ts`）
    - 写入 `reports/eval-<时间戳>.json`，含模式、模型、`maxSteps`、`contextBudget`、`backendRequests` 与每个用例的通过状态
    - `compare(current, previous)` 输出每个指标的 `delta` 与 `direction`；上一份报告缺失或无法解析时输出“无法对比”提示，不抛异常、不改变退出码
    - _Requirements: 15.7, 15.8, 15.9_

  - [x] 14.5 编写评估用例集 `eval/cases/*.json`
    - 5 个类别共 18 条（趋势 4、相似 3、无答案 3、注入 4、工具错误 4），含 `expectedTools`、`expectedFacts`、`forbiddenTools`/`forbiddenContent`、`toolFaults`、离线用 `script`；注入类用例都定义禁止项
    - _Requirements: 15.1_

  - [x] 14.6 实现评估入口与 npm 脚本（`eval/run-eval.ts`）
    - 离线模式 `npm run eval:offline`（`ScriptedLlm`）与真实模式 `npm run eval`；`--baseline <path>` 指定上一次报告；报告标注运行模式
    - 只构造 `FixtureDreamSource`，工具故障由 `FaultInjectingSource` 包装实现；启动时包装 `globalThis.fetch`，访问非 LLM 主机的请求抛错并计数，报告输出 `backendRequests`
    - _Requirements: 15.2, 15.3, 15.7, 15.8, 15.9, 15.10, 15.11_

  - [ ]* 14.7 编写属性测试：评估评分规则
    - **Property 47: 评估评分规则**
    - **Validates: Requirements 15.3, 15.4, 15.5, 15.6**

  - [ ]* 14.8 编写属性测试：评估报告对比
    - **Property 48: 评估报告对比**
    - **Validates: Requirements 15.8, 15.9**

  - [ ]* 14.9 编写属性测试：评估退出码
    - **Property 49: 评估退出码**
    - **Validates: Requirements 15.10**

  - [ ]* 14.10 编写评估套件结构测试
    - 用例总数 ≥ 15、五个类别各 ≥ 2、用例 id 唯一、注入类用例定义了 `forbiddenTools` 或 `forbiddenContent`
    - _Requirements: 15.1_

  - [ ]* 14.11 编写离线评估端到端测试
    - 运行 `eval:offline`，断言 `backendRequests` 为 0、报告文件生成、八个终止原因均有回归覆盖
    - _Requirements: 15.2, 15.3, 15.7, 15.11_

- [x] 15. 检查点 - Studio_Service 与评估就绪
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Frontend 基础设施、纯函数与组合式函数
  - [x] 16.1 配置 Frontend 基础设施
    - 在 `frontend` 增加精确版本的 `fast-check`；`vitest.config.ts` 的 `include` 扩展到 `app/composables/**/*.test.ts`
    - `nuxt.config.ts` 的 `runtimeConfig.public` 增加 `studioUrl`（`NUXT_PUBLIC_STUDIO_URL`，默认 `http://localhost:8787`）；`frontend/.env.example` 增加 `NUXT_PUBLIC_STUDIO_URL`，不含任何敏感变量
    - 扩展 `types/dream.ts`（`isFavorite?`、`tags?`、`Story`、`AgentRunSummary`、`TraceEntry`），导出并扩展 `useDreams.ts` 的 `normalize`（`isFavorite` 缺省 false、`tags` 非数组则 `[]`）
    - _Requirements: 1.4, 3.9, 16.2_

  - [x] 16.2 实现灵感选择 reducer（`utils/story-selection.ts`）
    - `select/deselect/clear`，上限 5，已满时 `select` 不改变状态；`canSubmit(state, style)`；已满时未选中项不可勾选而已选中项恒可取消
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 16.3 编写属性测试：灵感选择状态的不变量
    - **Property 19: 灵感选择状态的不变量**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

  - [x] 16.4 实现摘录函数（`utils/excerpt.ts`）
    - `excerpt(text, 120)`：不超过 120 字符原样返回，否则前 120 个字符加“…”
    - _Requirements: 8.4_

  - [ ]* 16.5 编写属性测试：故事摘录
    - **Property 24: 故事摘录**
    - **Validates: Requirements 8.4**

  - [x] 16.6 实现珍藏过滤（`utils/favorites.ts`）
    - `selectFavorites(dreams)`：仅 `isFavorite===true`，按 `dreamedAt` 降序，相同时按 `createdAt` 降序
    - _Requirements: 5.2_

  - [ ]* 16.7 编写属性测试：珍藏列表的过滤与排序
    - **Property 13: 珍藏列表的过滤与排序**
    - **Validates: Requirements 5.2**

  - [x] 16.8 实现月历网格（`utils/calendar.ts`）
    - `buildMonthGrid(dreams, year, month)`：复用 `dreamDateKey`，每格 `count === dreams.length`，`count=0` 不标注
    - _Requirements: 6.1, 6.3_

  - [ ]* 16.9 编写属性测试：日历数量与列表一致
    - **Property 14: 日历数量与列表一致**
    - **Validates: Requirements 6.1, 6.3**

  - [x] 16.10 实现回答链接化（`utils/linkify.ts`）
    - `linkifyAnswer(text, dreams)` 返回 `text | dreamLink` 片段数组；按标题或 `documentId` 匹配，链接目标 `/dream/{documentId}`；文本片段原样保留，不拼接 HTML
    - _Requirements: 14.5, 12.11_

  - [ ]* 16.11 编写属性测试：回答的链接化
    - **Property 46: 回答的链接化**
    - **Validates: Requirements 14.5**

  - [x] 16.12 实现问题校验（`utils/question.ts`）
    - `validateQuestion(s)`：与 Studio 的 trim 规则一致（1–500），空白拒绝
    - _Requirements: 14.10_

  - [ ]* 16.13 编写属性测试：文本长度校验（Frontend 侧）
    - **Property 11: 文本长度校验**
    - 与 Studio 侧判定对同一输入对拍
    - **Validates: Requirements 4.8, 10.12, 14.10**

  - [x] 16.14 实现故事列表分页拉取（`composables/useStories.ts`）
    - `fetchAllPages` 与 `fetchStories(baseUrl)`：`GET /api/stories?populate=sourceDreams&sort=createdAt:desc&pagination[pageSize]=100`，循环直到某页条数 < 100；任一页失败时保留已加载的页并带上错误
    - _Requirements: 8.1, 8.2_

  - [ ]* 16.15 编写属性测试：分页拉取全部数据
    - **Property 23: 分页拉取全部数据**
    - **Validates: Requirements 8.1, 8.2**

  - [x] 16.16 实现会话与 Studio 请求封装（`composables/useOwnerSession.ts`、`useStudio.ts`）
    - `useOwnerSession`：`localStorage` 键 `dream-owner-session`，`isOwner` 计算属性读取时过期则清除，`logout()` 立即清除并切换只读视图
    - `useStudio`：自动带 `Authorization`；任何 401 清除会话并提示登录失效；5 秒无响应视为服务不可用；统一 `StudioError{status, code, message}`
    - _Requirements: 2.9, 2.10, 2.11, 16.6_

  - [x] 16.17 实现 Agent 运行组合式函数（`composables/useAgentRun.ts`）
    - 提交问题、每 500ms 轮询进度、取消（10 秒无响应提示“取消请求超时”）；401 清除会话；429/5xx 提示含状态码并保留问题
    - _Requirements: 14.2, 14.6, 14.7, 14.8, 14.9_

  - [ ]* 16.18 编写组合式函数单元测试
    - 会话过期清除、401 清除会话并提示、Studio 5 秒无响应视为不可用、取消超时、429/5xx 提示含状态码
    - _Requirements: 2.9, 2.11, 14.6, 14.7, 14.8, 14.9, 16.6_

- [x] 17. Frontend 新页面
  - [x] 17.1 改造 `app.vue` 为侧边导航布局
    - 浏览区（日记流、梦境手记、珍藏的梦、梦境日历、梦境宇宙、存档冒险、统计）、故事区（梦的另一种可能）、Owner 区（梦境分析助手、记录一场梦、小屋设置、退出小屋）；Owner 区条目由 `isOwner` 驱动 `v-if` 渲染，未登录时底部显示“登录”
    - 不改变现有 `/`、`/stats`、`/dream/[id]` 的行为
    - _Requirements: 2.9, 2.10, 4.1, 14.1, 16.2_

  - [x] 17.2 实现 `/login` 与 `/settings` 页面
    - 登录：401 提示“口令不正确”，429 提示“尝试次数过多，请 15 分钟后再试”；设置页显示 Studio 地址、连通状态、会话到期时间
    - _Requirements: 2.1, 2.2, 2.3, 4.1_

  - [x] 17.3 实现 `/journal` 梦境手记与相关组件
    - 卡片展示标题、`YYYY-MM-DD`、Tag、“读一读原梦”（失败时提示且不改变卡片）；Owner 可见“作为故事灵感”勾选框、创作面板（风格选择、清空选择、生成中状态、成功后清空并置顶新 Story、失败保留选择）、Tag 编辑、珍藏按钮
    - “记录一场梦”弹窗：本地 trim 长度 1–10000 校验，提交后每 2 秒轮询 `enrichment`（最多 60 秒），显示加工中/已完成/加工失败可重试
    - Studio 不可用时各写入入口显示“服务暂不可用”，页面照常加载
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.9, 4.10, 4.11, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.11, 16.6_

  - [x] 17.4 实现 `/favorites` 珍藏的梦页面
    - 使用 `selectFavorites`；无珍藏时显示文字空状态并提示可执行珍藏操作；Owner 可取消珍藏
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 17.5 实现 `/calendar` 梦境日历页面
    - 默认当前自然月，上一月/下一月 1000 毫秒内切换；点击有 Dream 的日期显示卡片列表；加载失败显示错误与重试入口，不渲染数量标注
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 17.6 实现 `/universe` 梦境宇宙页面
    - 调用 `GET /v1/universe` 绘制节点与边；点击节点展示标题、日期、Tag 与“读一读原梦”（跳转详情页）；Dream 少于 2 条显示空状态；加载失败仅该页显示错误与重试，不渲染节点与边
    - _Requirements: 6.4, 6.5, 6.9, 6.10_

  - [x] 17.7 实现 `/stories` 与 `/stories/[id]` 页面
    - 列表：创建日期、Tag、标题、摘录（`excerpt`）、“来源 N 场梦”；分页失败保留已加载卡片并显示重试；无故事显示引导空状态；Owner 可删除 Story
    - 详情：完整正文与来源 Dream 标题列表（按 `sourceDreams` 顺序，链接到 `/dream/{documentId}`），已删除来源按 `sourceSnapshot` 显示“该梦已不存在”（不可点击）
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [x] 17.8 实现 `/archive` 占位页
    - 展示“即将推出”，不发起任何请求
    - _Requirements: 4.12_

  - [x] 17.9 实现 `/assistant`、`/assistant/runs`、`/assistant/runs/[runId]` 页面
    - 输入框（空白拒绝并提示，不发请求）；每步显示“第 N 步推理中”及工具名与运行中/成功/失败三态；结束后显示回答（`linkifyAnswer` 渲染）、终止原因中文说明、默认折叠的 Trace；非 `answered` 时显示“回答可能不完整”；回答下方显示步数、总 token、估算成本
    - 历史运行列表与区间汇总；详情页以时间线展示每步的工具名称、状态、LLM 耗时与工具耗时
    - 所有 LLM 文本仅用文本插值，禁止 `v-html`
    - _Requirements: 12.11, 13.5, 13.6, 13.7, 13.12, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.10_

  - [ ]* 17.10 编写静态检查与页面示例测试
    - 静态断言 `frontend/app` 内无 `v-html`；`/archive` 不发起请求；Owner 入口在无会话时不渲染；现有 `aggregate` 测试继续通过
    - _Requirements: 2.10, 4.12, 12.11, 16.2_

- [x] 18. Compose、环境变量与文档
  - [x] 18.1 编写 `studio-service/Dockerfile`
    - 与 `mcp-server/Dockerfile` 同构的两阶段构建（`npm ci && npm run build`，运行阶段 `node dist/index.js`，`NODE_ENV=production`），`EXPOSE 8787`，必要时安装 `tzdata` 以保证 `TZ` 生效
    - _Requirements: 1.1_

  - [x] 18.2 在 `docker-compose.yml` 增加 `studio-service`
    - `build: ./studio-service`、`restart: unless-stopped`、`depends_on.backend.condition: service_healthy`，环境变量按设计（含 `STUDIO_*` 回退到 `LLM_*`、`TZ`、`CORS_ORIGIN`），端口 `8787:8787`，无挂卷
    - _Requirements: 1.2_

  - [x] 18.3 更新环境变量示例与 CI 工作流
    - 根目录 `.env.example` 增加 Studio 变量块（敏感变量留空，注释说明口令至少 12 个字符与生成会话密钥的命令）
    - `.github/workflows/deploy-frontend.yml` 的构建步骤追加 `NUXT_PUBLIC_STUDIO_URL: ${{ vars.NUXT_PUBLIC_STUDIO_URL }}`；Frontend 与 Backend 的 `.env.example` 不增加任何敏感变量
    - _Requirements: 1.4, 1.10_

  - [x] 18.4 实现密钥边界扫描脚本 `scripts/check-secret-boundary.mjs`
    - 扫描 `frontend/`（源码、`.env.example`、`.output/public`）与 `backend/`（源码与 `.env.example`，排除 `node_modules`、`dist`、`.tmp`）；`STUDIO_STRAPI_TOKEN`、`STUDIO_LLM_API_KEY`、`STUDIO_OWNER_PASSPHRASE`、`STUDIO_SESSION_SECRET`、`LLM_API_KEY`、`STRAPI_TOKEN` 的变量名与（非空时）环境取值的命中次数必须为 0
    - 挂入 CI，在 `npm test` 之后运行
    - _Requirements: 1.4_

  - [ ]* 18.5 编写 Compose 结构断言与密钥边界测试
    - 对 `docker compose config` 输出断言：`studio-service` 存在、`restart: unless-stopped`、`depends_on.backend.condition: service_healthy`、`backend` 含健康检查
    - 对密钥边界脚本构造含命中与不含命中的临时目录，验证退出码；在 `TZ=Asia/Shanghai` 下运行日期归属冒烟测试
    - _Requirements: 1.2, 1.4_

  - [x] 18.6 更新 README
    - 更新根 `README.md` 与新增 `studio-service/README.md`：组件边界、环境变量、Token 创建步骤（`setup-access`）、评估命令、`SIGTERM` 行为
    - 说明 Frontend 在 GitHub Pages（HTTPS）时 Studio_Service 必须经 HTTPS 暴露，以及内存状态在重启后丢失等残余风险
    - _Requirements: 1.10_

- [x] 19. 最终检查点 - 全部功能就绪
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选，可跳过以加快 MVP；核心实现任务不可跳过。
- 每个属性测试写入独立文件（命名 `<模块>.p<编号>.property.test.ts`），因此同一波次内不会出现文件冲突。属性测试的注释格式为 `Feature: dream-story-and-agent, Property {编号}: {标题}`，默认 `numRuns: 100`，Property 36 与 37 为 200。
- 时间相关属性（5、6、34）通过注入 `Clock` 驱动，不使用真实等待。
- Frontend 的纯函数与组合式函数（任务 16）不依赖后端，可在 Studio 开发期间并行进行；页面任务（17）等待 Studio 路由装配完成后再开始。
- 本计划不修改 `mcp-server`；`parseAndValidate` 的一致性依靠对拍测试保证。
- 设计中尚未验证的项目已落入集成测试或冒烟测试：Strapi 关系载荷形态、`sourceDreams` 联接行清理、`estimatedCost` 精度、容器内 `TZ` 是否生效。
- 检查点任务不进入依赖图。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2", "2.3", "2.4", "4.1"] },
    { "id": 1, "tasks": ["1.3", "2.5", "2.8", "4.2", "4.4", "4.6", "5.1", "5.4", "5.6", "6.1", "6.3", "6.7", "7.1", "9.1", "9.3", "9.12", "9.15", "14.1", "16.1"] },
    { "id": 2, "tasks": ["2.6", "2.7", "2.9", "2.10", "4.3", "4.5", "4.7", "5.2", "5.3", "5.5", "5.7", "6.2", "6.4", "6.5", "6.6", "6.8", "6.9", "6.10", "6.15", "6.16", "6.17", "7.2", "7.3", "7.4", "8.1", "9.2", "9.4", "9.5", "9.8", "9.10", "9.13", "9.16", "10.1", "11.1", "11.8", "13.3", "14.2", "14.3", "16.2", "16.4", "16.6", "16.8", "16.10", "16.12", "16.14", "16.16"] },
    { "id": 3, "tasks": ["6.11", "6.12", "6.13", "6.14", "6.18", "6.19", "6.20", "7.5", "7.7", "8.2", "9.6", "9.7", "9.9", "9.11", "9.14", "10.2", "10.3", "10.4", "10.5", "11.9", "11.10", "13.1", "13.4", "14.4", "14.5", "14.7", "14.9", "16.3", "16.5", "16.7", "16.9", "16.11", "16.13", "16.15", "16.17"] },
    { "id": 4, "tasks": ["7.6", "8.3", "10.6", "10.7", "10.8", "10.9", "10.10", "10.11", "10.12", "11.2", "13.2", "13.5", "13.7", "14.8", "14.10", "16.18"] },
    { "id": 5, "tasks": ["11.3", "11.4", "11.5", "11.6", "13.6", "14.6"] },
    { "id": 6, "tasks": ["11.7", "13.8", "13.10", "14.11"] },
    { "id": 7, "tasks": ["13.9", "13.11"] },
    { "id": 8, "tasks": ["17.1", "17.2", "17.3", "17.4", "17.5", "17.6", "17.7", "17.8", "17.9", "18.1", "18.3"] },
    { "id": 9, "tasks": ["17.10", "18.2", "18.4"] },
    { "id": 10, "tasks": ["18.5", "18.6"] }
  ]
}
```
