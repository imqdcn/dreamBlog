import { describe, expect, it, vi } from 'vitest';
import type { RunExecutor } from '../../agent/run-registry.js';
import type { SessionMemory } from '../../agent/session-memory.js';
import type { AgentResult } from '../../agent/types.js';
import { signSession } from '../../auth/session.js';
import { StrapiError } from '../../backend/strapi-client.js';
import { SlidingWindowLimiter } from '../../limits/sliding-window.js';
import { createApp, type AppDeps } from '../app.js';
import { registerAgentRoutes } from './agent.js';

const SECRET = 'secret-secret-secret';
const now = 1_700_000_000_000;
const { token } = signSession(SECRET, now);
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

function result(runId: string, over: Partial<AgentResult> = {}): AgentResult {
  return {
    runId, answer: '回答', terminationReason: 'answered', redacted: false, trace: [], stepCount: 2,
    promptTokens: 3, completionTokens: 4, estimatedCost: 0.1, usageEstimated: true, durationMs: 5, model: 'm',
    ...over,
  };
}

const instant: RunExecutor = async ({ runId }) => result(runId);
/** 等到被取消才结束。 */
const waiting: RunExecutor = ({ runId, signal }) =>
  new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(result(runId, { terminationReason: 'cancelled' })));
  });

function setup(opts: { executor?: RunExecutor; createAgentRun?: () => Promise<unknown>; limit?: number } = {}) {
  const strapi = {
    createAgentRun: vi.fn(opts.createAgentRun ?? (async () => ({ id: 1 }))),
    listAgentRuns: vi.fn(async () => ({
      data: [{ createdAt: '2024-01-02T03:00:00Z', terminationReason: 'answered', stepCount: 2 }],
      pagination: { page: 1, pageSize: 50, pageCount: 1, total: 1 },
    })),
    getAgentRun: vi.fn(async (id: string) => (id === 'known' ? { id: 1, runId: 'known', trace: [] } : null)),
  };
  const deps = {
    config: { corsOrigins: [], trustProxy: false, secrets: { sessionSecret: SECRET }, timezone: 'UTC' },
    clock: { now: () => now, sleep: async () => {} },
    publicLimiter: new SlidingWindowLimiter({ limit: 60, windowMs: 60_000 }),
    limiters: opts.limit ? { agentAsk: new SlidingWindowLimiter({ limit: opts.limit, windowMs: 3_600_000 }) } : undefined,
    strapi,
    extras: { agentExecutor: opts.executor ?? instant },
    routes: [registerAgentRoutes],
  } as unknown as AppDeps;
  return { app: createApp(deps), strapi, deps };
}

type App = ReturnType<typeof setup>['app'];
const ask = (app: App, question: unknown, headers: Record<string, string> = auth) =>
  app.request('/v1/agent/runs', { method: 'POST', headers, body: JSON.stringify({ question }) });
const get = (app: App, path: string) => app.request(path, { headers: auth });

describe('POST /v1/agent/runs', () => {
  it('401 without session, 400 for invalid question', async () => {
    const { app, strapi } = setup();
    expect((await ask(app, 'q', { 'content-type': 'application/json' })).status).toBe(401);
    for (const q of ['', '   ', 'x'.repeat(501), 5]) expect((await ask(app, q)).status).toBe(400);
    expect(strapi.createAgentRun).not.toHaveBeenCalled();
  });

  it('invalid questions do not consume rate limit quota', async () => {
    const { app } = setup({ limit: 1 });
    expect((await ask(app, '')).status).toBe(400);
    expect((await ask(app, '有效')).status).toBe(202);
  });

  it('202 with runId, persists agent_run with stepCount/redacted/usageEstimated', async () => {
    const { app, strapi } = setup();
    const res = await ask(app, '  最近的梦  ');
    expect(res.status).toBe(202);
    const { runId } = (await res.json()) as { runId: string };
    await vi.waitFor(() => expect(strapi.createAgentRun).toHaveBeenCalledTimes(1));
    expect(strapi.createAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId, question: '最近的梦', finalAnswer: '回答', stepCount: 2, redacted: false, usageEstimated: true,
        terminationReason: 'answered',
      }),
    );
    const progress = (await (await get(app, `/v1/agent/runs/${runId}/progress`)).json()) as {
      state: string;
      result?: { answer: string };
    };
    expect(progress.state).toBe('finished');
    expect(progress.result?.answer).toBe('回答');
  });

  it('429 when a run is already active, without consuming quota', async () => {
    const { app } = setup({ executor: waiting, limit: 2 });
    const first = await ask(app, 'q1');
    const { runId } = (await first.json()) as { runId: string };
    expect((await ask(app, 'q2')).status).toBe(429);
    expect((await ask(app, 'q3')).status).toBe(429);
    await app.request(`/v1/agent/runs/${runId}/cancel`, { method: 'POST', headers: auth });
    // 并发 429 未计数：第 2 个名额仍可用
    expect((await ask(app, 'q4')).status).toBe(202);
  });

  it('429 with Retry-After after exceeding the per-sid limit', async () => {
    const { app, strapi } = setup({ limit: 2 });
    for (let i = 0; i < 2; i++) {
      expect((await ask(app, `q${i}`)).status).toBe(202);
      // persist 发生在 Run 结束之后，等待它即表示 sid 已空闲
      await vi.waitFor(() => expect(strapi.createAgentRun).toHaveBeenCalledTimes(i + 1));
    }
    const res = await ask(app, 'over');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
  });

  it('persistence failure still returns the final answer', async () => {
    const { app, strapi } = setup({
      createAgentRun: async () => {
        throw new StrapiError('boom', 500);
      },
    });
    const { runId } = (await (await ask(app, 'q')).json()) as { runId: string };
    await vi.waitFor(() => expect(strapi.createAgentRun).toHaveBeenCalled());
    const progress = (await (await get(app, `/v1/agent/runs/${runId}/progress`)).json()) as {
      result?: { answer: string };
    };
    expect(progress.result?.answer).toBe('回答');
  });

  it('updates SessionMemory with the finished turn', async () => {
    const { app, deps } = setup();
    await ask(app, '第一问');
    const memory = deps.extras!.sessionMemory as SessionMemory;
    await vi.waitFor(() => {
      const sid = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).sid as string;
      expect(memory.get(sid, now)).toEqual([{ question: '第一问', answer: '回答' }]);
    });
  });
});

describe('cancel / progress', () => {
  it('cancel aborts the run and returns finished snapshot; unknown run → 404', async () => {
    const { app } = setup({ executor: waiting });
    const { runId } = (await (await ask(app, 'q')).json()) as { runId: string };
    const res = await app.request(`/v1/agent/runs/${runId}/cancel`, { method: 'POST', headers: auth });
    expect(res.status).toBe(200);
    const snap = (await res.json()) as { state: string; result?: { terminationReason: string } };
    expect(snap.state).toBe('finished');
    expect(snap.result?.terminationReason).toBe('cancelled');
    expect((await get(app, '/v1/agent/runs/nope/progress')).status).toBe(404);
    expect((await app.request('/v1/agent/runs/nope/cancel', { method: 'POST', headers: auth })).status).toBe(404);
  });
});

describe('runs listing and summary', () => {
  it('lists runs with totalTokens and returns detail / 404', async () => {
    const { app } = setup();
    const list = (await (await get(app, '/v1/agent/runs?page=1')).json()) as { items: { totalTokens: number }[] };
    expect(list.items[0].totalTokens).toBe(0);
    expect((await get(app, '/v1/agent/runs/known')).status).toBe(200);
    expect((await get(app, '/v1/agent/runs/missing')).status).toBe(404);
  });

  it('summary: 400 for invalid dates, 200 for valid range', async () => {
    const { app, strapi } = setup();
    for (const qs of ['', '?from=2024-02-30&to=2024-03-01', '?from=2024-03-02&to=2024-03-01', '?from=a&to=b']) {
      expect((await get(app, `/v1/agent/summary${qs}`)).status).toBe(400);
    }
    expect(strapi.listAgentRuns).not.toHaveBeenCalled();
    const ok = await get(app, '/v1/agent/summary?from=2024-01-02&to=2024-01-02');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ runs: 1, byReason: { answered: 100 }, avgSteps: 2 });
  });
});
