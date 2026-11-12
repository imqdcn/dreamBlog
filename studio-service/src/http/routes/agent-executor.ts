/**
 * 默认的 Run 执行器：把 runAgent 封装成 RunRegistry 需要的 RunExecutor。
 * 每次 Run 使用独立的工具注册表（快照作用域为一次 Run），历史取自 SessionMemory。
 */
import { runAgent } from '../../agent/loop.js';
import { DEFAULT_TIMEZONE, formatDateInTz } from '../../agent/prompt.js';
import type { RunExecutor } from '../../agent/run-registry.js';
import type { SessionMemory } from '../../agent/session-memory.js';
import { createDreamTools } from '../../agent/tools/index.js';
import { createToolRegistry } from '../../agent/tools/registry.js';
import type { AgentConfig } from '../../agent/types.js';
import type { AppDeps } from '../app.js';

export const TOOL_TIMEOUT_MS = 10_000;

export function buildAgentConfig(deps: AppDeps): AgentConfig {
  const { config } = deps;
  const s = config.secrets;
  return {
    maxSteps: config.agent.maxSteps,
    contextBudget: config.agent.contextBudget,
    tokenBudget: config.agent.tokenBudget,
    loopTimeoutMs: config.agent.loopTimeoutMs,
    toolTimeoutMs: TOOL_TIMEOUT_MS,
    secrets: [s.strapiToken, s.llmApiKey, s.ownerPassphrase, s.sessionSecret],
    backendUrl: config.strapiUrl,
    price: { inPerM: config.llm.priceInPerM, outPerM: config.llm.priceOutPerM },
    model: config.llm.model,
    tz: config.timezone,
  };
}

export function createRunExecutorFor(deps: AppDeps, memory: SessionMemory): RunExecutor {
  return ({ runId, sid, question, signal, onProgress }) => {
    const tz = deps.config.timezone || DEFAULT_TIMEZONE;
    return runAgent(
      {
        llm: deps.llm,
        tools: createToolRegistry(createDreamTools(tz), {
          today: () => formatDateInTz(deps.clock.now(), tz),
        }),
        source: deps.dreamSource,
        clock: deps.clock,
        config: buildAgentConfig(deps),
        history: memory.get(sid, deps.clock.now()),
        signal,
        onProgress,
        newId: () => runId,
      },
      question,
    );
  };
}
