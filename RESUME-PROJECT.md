# 简历项目：Dream Blog · 梦境记录与 AI 分析助手

> 说明：以下数字均来自仓库当前状态（测试数、用例数、工具数等）。没有线上用户量、性能压测数据，请勿自行编造；如已部署并有真实数据，可自行补充。

## 一、项目简介（可直接放简历）

**Dream Blog（梦境小屋）** 是一个端到端的 AI 应用：用户通过 ESP32-S3 小智语音设备口述梦境，经 MCP 协议写入系统，由 LLM 自动生成标题、摘要、关键词与情绪；在 Web 端以日记流、日历、关系图谱和统计图表呈现，并提供「梦境转故事」创作与一个可多步调用工具的 **Dream Agent（梦境分析助手）**，可用自然语言回答「我最近一个月情绪走势如何」「哪些梦和这个梦相似」等问题。

- 技术栈：TypeScript / Nuxt 4 / Vue 3 / Hono / Strapi 5 / PostgreSQL / Docker Compose / MCP / OpenAI 兼容 LLM API / Vitest / fast-check
- 角色：独立负责（硬件接入、后端、Agent、前端、部署、评估）
- 规模：4 个子项目（Strapi 后端、MCP Server、Studio Service、Nuxt 前端），monorepo

## 二、简历精简版（3~5 行）

**Dream Blog：语音驱动的梦境记录与 AI 分析助手**（个人项目，TypeScript / Nuxt / Hono / Strapi / MCP）
- 设计并实现「ESP32 语音 → MCP 工具 → LLM 加工 → Strapi 存储 → Nuxt 可视化」全链路，LLM 加工异步回写，失败时保留原文并支持补偿重试。
- 从零实现不依赖 Agent 框架的 **Dream Agent 循环**：5 个只读工具并行调用、步数/Token/超时三重预算、重复调用检测、连续失败熔断、上下文压缩，8 种终止原因均可追溯。
- 针对 Prompt 注入与密钥泄露做防御：工具结果数据分隔转义、参数守卫（拒绝 URL/密钥）、输出脱敏、写入密钥只存在于独立服务，CI 脚本扫描前端与后端的密钥边界。
- 搭建离线评估套件（脚本化 LLM，零费用、可复现），18 个用例覆盖趋势、相似、无答案、注入、工具故障，支持报告对比与退出码接入 CI。

## 三、分岗位版本

### AI 应用开发岗（突出 Agent / 评估 / 安全）
- 手写 Agent 主循环（状态机：Prepare → Gate → Compress → CallLLM → Execute），所有副作用依赖注入，便于脚本化测试；终止优先级 timeout > cancelled > token_budget > max_steps。
- 工具层：`search_dreams`、`get_dream`、`emotion_trend`、`keyword_stats`、`find_similar_dreams`，统一 zod 参数校验、结果限长与错误码；并行执行并按调用顺序回填。
- 上下文管理：超预算时压缩旧步骤为摘要；LLM 调用带指数退避重试；token 缺失时估算并标记。
- 评估体系：ScriptedLlm + FaultInjectingSource 注入工具故障，网络层拦截非 LLM 主机请求（`backendRequests=0` 作为离线保证），输出工具选择正确率、事实命中率、注入防护通过率。
- 安全：Prompt 注入防护（`<<<DATA>>>` 分隔与转义）、参数守卫、输出检查与脱敏、Trace 脱敏。

### FDE（前线部署工程师）岗（突出交付、集成、运维、权衡）
- 端到端交付：硬件（ESP32 小智）、MCP 协议接入、LLM 供应商适配（OpenAI 兼容接口，可切换 OpenAI / 百炼 / 智谱）、后端、前端、Docker Compose 一键部署。
- 面向真实部署问题：GitHub Pages(HTTPS) 与服务端的混合内容/CORS 约束、反向代理 `TRUST_PROXY`、时区 `TZ` 对日期归属的影响、SIGTERM 优雅退出（取消运行中的 Run、排空队列）。
- 最小权限：为 Studio Service 单独创建 custom 级 Strapi Token（无 Dream 删除权限），幂等引导脚本 `setup-access.js`。
- 可运维性：健康检查（Compose `service_healthy` 依赖）、结构化日志带 runId、Run 进度快照与历史查询、成本（token / 费用）统计。
- 文档化残余风险（内存状态重启丢失、单实例假设），README 给出部署与排错 FAQ。

### 全栈开发岗（突出前后端与工程化）
- 前端：Nuxt 4 + Vue 3，侧边导航布局，梦境手记、珍藏、日历、关系图谱（SVG）、故事、助手等页面；Composable 封装会话、Studio 请求、Agent 轮询/取消（10 秒取消超时、401 清会话、429/5xx 保留输入）。
- 后端：Hono 服务（认证、限流、CORS、登录失败锁定、会话令牌 HMAC 签名）；Strapi 5 内容类型扩展（Dream / Story / AgentRun）与写入校验中间件。
- 数据一致性：故事生成使用去重键防并发重复，失败不落库；珍藏/Tag 修改先校验后写入。
- 工程化：Vitest + fast-check 属性测试，studio-service 144 个测试、前端 21 个、MCP Server 43 个；GitHub Actions 部署前运行测试与密钥边界检查。

## 四、技术亮点速记（面试展开用）

| 亮点 | 一句话 | 面试可延伸 |
| --- | --- | --- |
| 不用框架手写 Agent | 状态机 + 依赖注入，可脚本化回放 | 为什么不用 LangChain；终止条件设计 |
| 三重预算与熔断 | 步数、Token、超时 + 重复调用/连续失败 | 如何避免 Agent 死循环与成本失控 |
| Prompt 注入防御 | 数据分隔转义 + 参数守卫 + 输出脱敏 | 间接注入场景与残余风险 |
| 离线评估 | ScriptedLlm 零成本复现，覆盖注入与故障 | 如何做回归、如何对比两次报告 |
| 密钥边界 | 写入 Token / LLM Key 只在 Studio Service | 前端静态站如何安全调用 LLM |
| 异步加工 + 补偿 | 先落原文再加工，失败可重试 | 一致性与幂等 |

## 五、诚实边界（面试被追问时）

- 项目为个人/演示规模，未包含线上流量数据。
- Studio Service 的 Docker 镜像与前端页面尚未在真实浏览器 / 真实 LLM 环境完整验收；评估的「真实模式」未在本次跑通。
- Backend 仅有冒烟测试，Backend 校验与 `setup-access.js` 的集成测试属于可选任务，尚未编写。
- Strapi 的 `story`、`agent-run` 内容类型有 6 个类型生成相关的 TS 报错（运行与测试不受影响），需重新生成 Strapi 类型。
- 会话限流、Run 进度、加工队列均在内存中，仅支持单实例。

## 六、STAR 讲述模板（60 秒）

- **S**：想把语音口述的梦境沉淀下来，并能用自然语言分析，但担心 LLM 幻觉、成本失控、密钥泄露。
- **T**：做一个可部署的全链路系统，Agent 可控、可评估、可追溯。
- **A**：手写 Agent 循环加三重预算与熔断；工具结果做数据分隔，参数与输出双向检查；把写权限和 LLM 密钥隔离到独立服务；用脚本化 LLM 搭离线评估并接入 CI。
- **R**：18 个评估用例离线全部通过，主要服务测试 144 项通过，前端可静态构建；关键风险点（注入、死循环、密钥泄露）都有对应测试或检查。
