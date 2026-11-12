import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunRegistry, type RunExecutor } from './run-registry.js';
import type { AgentResult } from './types.js';

function result(runId: string, reason: AgentResult['terminationReason'] = 'answered'): AgentResult {
  return {
    runId, answer: 'ok', terminationReason: reason, redacted: false, trace: [], stepCount: 1,
    promptTokens: 3, completionTokens: 4, estimatedCost: 0.1, usageEstimated: false, durationMs: 1, model: 'm',
  };
}

/** 等待 signal 中止后以对应原因结束。 */
const waiting: RunExecutor = ({ runId, signal, onProgress }) =>
  new Promise((resolve) => {
    onProgress({ type: 'step_started', step: 1 });
    onProgress({ type: 'tool_started', step: 1, name: 'a' });
    signal.addEventListener('abort', () =>
      resolve(result(runId, signal.reason === 'timeout' ? 'timeout' : 'cancelled')),
    );
  });

afterEach(() => vi.useRealTimers());

describe('RunRegistry', () => {
  it('同一 sid 运行中返回 busy，不同 sid 不受影响，结束后可再启动', async () => {
    const reg = new RunRegistry(waiting);
    const h = reg.start('s1', 'q');
    expect('error' in h).toBe(false);
    expect(reg.start('s1', 'q2')).toEqual({ error: 'busy' });
    expect('error' in reg.start('s2', 'q')).toBe(false);
    if ('error' in h) return;
    reg.cancel(h.runId);
    await h.done;
    expect('error' in reg.start('s1', 'q3')).toBe(false);
    await reg.shutdown();
  });

  it('取消后 cancelled=true，快照结束并带结果；进度包含步骤与工具', async () => {
    const reg = new RunRegistry(waiting);
    const h = reg.start('s', 'q');
    if ('error' in h) throw new Error('busy');
    expect(h.progress).toMatchObject({
      state: 'running', currentStep: 1,
      steps: [{ step: 1, phase: 'tools', tools: [{ name: 'a', status: 'running' }] }],
    });
    reg.cancel(h.runId);
    await h.done;
    expect(h.cancelled).toBe(true);
    expect(h.progress.state).toBe('finished');
    expect(h.progress.result).toMatchObject({ terminationReason: 'cancelled', totalTokens: 7 });
  });

  it('120 秒总超时触发 abort(timeout)', async () => {
    vi.useFakeTimers();
    const reg = new RunRegistry(waiting);
    const h = reg.start('s', 'q');
    if ('error' in h) throw new Error('busy');
    await vi.advanceTimersByTimeAsync(119_999);
    expect(h.abort.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.abort.signal.reason).toBe('timeout');
    expect((await h.done).terminationReason).toBe('timeout');
  });

  it('结束后保留 10 分钟', async () => {
    vi.useFakeTimers();
    const reg = new RunRegistry(async ({ runId }) => result(runId));
    const h = reg.start('s', 'q');
    if ('error' in h) throw new Error('busy');
    await h.done;
    await vi.advanceTimersByTimeAsync(599_999);
    expect(reg.get(h.runId)).toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(reg.get(h.runId)).toBeUndefined();
  });

  it('shutdown 取消所有运行中的 Run，且最多等待 5 秒', async () => {
    vi.useFakeTimers();
    const reg = new RunRegistry(() => new Promise<AgentResult>(() => undefined)); // 永不结束
    const h = reg.start('s', 'q');
    if ('error' in h) throw new Error('busy');
    let settled = false;
    const p = reg.shutdown().then(() => { settled = true; });
    expect(h.cancelled).toBe(true);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
  });
});
