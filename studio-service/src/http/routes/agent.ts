/**
 * agent 路由（需求 10.1、10.10、10.12、10.14、12.9、13.1、13.5–13.7、13.9、13.11）。
 *
 * POST /v1/agent/runs 的顺序：认证 → 问题校验（400，不计数）→ 并发检查（429，不计数）
 *                            → 限流（30 次/60 分钟，按 sid 计数）→ 启动 Run，返回 202 {runId}。
 * Run 结束后写入 agent_run；持久化失败只记录带 runId 的错误日志，不影响最终回答。
 */
import { createRunExecutorFor } from './agent-executor.js';
import { RunRegistry, type RunExecutor, type RunHandle } from '../../agent/run-registry.js';
import { SessionMemory } from '../../agent/session-memory.js';
import type { AgentResult } from '../../agent/types.js';
import { StrapiError, type AgentRunWrite } from '../../backend/strapi-client.js';
import { validateQuestion } from '../../domain/validation.js';
import { SlidingWindowLimiter } from '../../limits/sliding-window.js';
import { logger } from '../../logger.js';
import { fetchRunPage, InvalidDateRangeError, summarizeFromSource } from '../../runs/summary.js';
import type { AppDeps, RouteRegistrar } from '../app.js';
import {
  invalidArgument,
  notFound,
  rateLimited,
  requireOwner,
} from '../middleware.js';

export const AGENT_RATE_LIMIT = { limit: 30, windowMs: 60 * 60_000 } as const;
export const CANCEL_WAIT_MS = 5_000;

/** 把一次 Run 的结果映射为 agent_run 记录。 */
export function toAgentRunWrite(question: string, r: AgentResult): AgentRunWrite {
  return {
    runId: r.runId,
    question,
    finalAnswer: r.answer,
    terminationReason: r.terminationReason,
    trace: r.trace,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    estimatedCost: r.estimatedCost,
    durationMs: r.durationMs,
    stepCount: r.stepCount,
    model: r.model,
    redacted: r.redacted,
    usageEstimated: r.usageEstimated,
  };
}

function getRegistry(deps: AppDeps, memory: SessionMemory, expBySid: Map<string, number>): RunRegistry {
  const existing = deps.extras?.runRegistry as RunRegistry | undefined;
  if (existing) return existing;
  const injected = deps.extras?.agentExecutor as RunExecutor | undefined;
  const base = injected ?? createRunExecutorFor(deps, memory);
  // 在 Run 结束（executor 返回）时同步更新 SessionMemory，保证同一会话的下一问能看到本轮
  const executor: RunExecutor = async (ctx) => {
    const result = await base({ ...ctx });
    const nowMs = deps.clock.now();
    const expMs = expBySid.get(ctx.sid) ?? nowMs + 12 * 3600_000;
    memory.append(ctx.sid, { question: ctx.question, answer: result.answer }, expMs, nowMs);
    return result;
  };
  const created = new RunRegistry(executor);
  deps.extras = { ...(deps.extras ?? {}), runRegistry: created };
  return created;
}

export const registerAgentRoutes: RouteRegistrar = (app, deps) => {
  const owner = requireOwner(deps);
  const memory = (deps.extras?.sessionMemory as SessionMemory | undefined) ?? new SessionMemory();
  const expBySid = new Map<string, number>();
  deps.extras = { ...(deps.extras ?? {}), sessionMemory: memory };
  const limiter =
    deps.limiters?.agentAsk ?? new SlidingWindowLimiter({ ...AGENT_RATE_LIMIT });
  const registry = getRegistry(deps, memory, expBySid);

  const persist = async (handle: RunHandle): Promise<void> => {
    let result: AgentResult;
    try {
      result = await handle.done;
    } catch {
      return; // Run 异常已由注册表记录日志
    }
    try {
      await deps.strapi.createAgentRun(toAgentRunWrite(handle.question, result));
    } catch (err) {
      logger.error('persist agent_run failed', handle.runId, {
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof StrapiError ? err.status : undefined,
      });
    }
  };

  app.post('/v1/agent/runs', owner, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw invalidArgument('请求体不是合法的 JSON');
    }
    const raw = typeof body === 'object' && body !== null ? (body as { question?: unknown }).question : undefined;
    const q = validateQuestion(raw);
    if (!q.ok) throw invalidArgument('问题长度不合法：去除首尾空白后需为 1 到 500 个字符', ['question']);

    const session = c.get('session');
    const sid = session.sid;

    if (registry.isActive(sid)) throw rateLimited('已有一个运行中的问题，请等待其结束或先取消');

    const acquired = limiter.tryAcquire(sid, deps.clock.now());
    if (!acquired.allowed) throw rateLimited('提问过于频繁，已超出频率限制', acquired.retryAfterMs);

    expBySid.set(sid, session.exp * 1000);
    const handle = registry.start(sid, q.value);
    if ('error' in handle) throw rateLimited('已有一个运行中的问题，请等待其结束或先取消');

    void persist(handle);
    return c.json({ runId: handle.runId }, 202);
  });

  app.get('/v1/agent/runs/:runId/progress', owner, (c) => {
    const handle = registry.get(c.req.param('runId'));
    if (!handle) throw notFound('Run 不存在或已过期');
    return c.json(handle.progress);
  });

  app.post('/v1/agent/runs/:runId/cancel', owner, async (c) => {
    const handle = registry.get(c.req.param('runId'));
    if (!handle) throw notFound('Run 不存在或已过期');
    registry.cancel(handle.runId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        handle.done.then(
          () => undefined,
          () => undefined,
        ),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, CANCEL_WAIT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    return c.json(handle.progress);
  });

  app.get('/v1/agent/runs', owner, async (c) => {
    const page = Number(c.req.query('page'));
    return c.json(await fetchRunPage(deps.strapi, Number.isFinite(page) && page >= 1 ? page : 1));
  });

  app.get('/v1/agent/runs/:runId', owner, async (c) => {
    const run = await deps.strapi.getAgentRun(c.req.param('runId'));
    if (!run) throw notFound('Run 不存在');
    return c.json(run);
  });

  app.get('/v1/agent/summary', owner, async (c) => {
    try {
      const summary = await summarizeFromSource(
        deps.strapi,
        c.req.query('from') ?? '',
        c.req.query('to') ?? '',
        deps.config.timezone,
      );
      return c.json(summary);
    } catch (err) {
      if (err instanceof InvalidDateRangeError) {
        throw invalidArgument('日期参数无效：需为 YYYY-MM-DD 且起始日期不晚于结束日期', ['from', 'to']);
      }
      throw err;
    }
  });
};
