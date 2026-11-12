import { describe, expect, it, vi } from 'vitest';
import { createAgentRun, MSG_CANCEL_TIMEOUT, MSG_QUESTION_EMPTY, type ProgressSnapshot } from './useAgentRun';
import { StudioError, MSG_UNAVAILABLE } from './useStudio';

const tick = () => new Promise((r) => setTimeout(r, 5));

function make(request: (path: string, opts?: any) => Promise<any>) {
  return createAgentRun({
    studio: { request: request as any },
    session: { current: () => null, clear: vi.fn() },
    pollIntervalMs: 1,
  });
}

const finished: ProgressSnapshot = {
  runId: 'r1',
  state: 'finished',
  currentStep: 1,
  steps: [],
  result: { answer: 'hi', terminationReason: 'answered', stepCount: 1, totalTokens: 1, estimatedCost: 0 },
};

describe('useAgentRun', () => {
  it('rejects blank question without request', async () => {
    const req = vi.fn();
    const run = make(req);
    run.question.value = '   ';
    expect(await run.submit()).toBe(false);
    expect(run.error.value).toBe(MSG_QUESTION_EMPTY);
    expect(req).not.toHaveBeenCalled();
  });

  it('submits, polls until finished', async () => {
    const req = vi.fn(async (path: string) => (path === '/v1/agent/runs' ? { runId: 'r1' } : finished));
    const run = make(req);
    run.question.value = 'q';
    await run.submit();
    await tick();
    await tick();
    expect(run.progress.value?.result?.answer).toBe('hi');
    expect(run.running.value).toBe(false);
  });

  it('keeps question and shows status code on 429', async () => {
    const run = make(async () => {
      throw new StudioError(429, 'rate', '请求过多');
    });
    run.question.value = 'q';
    await run.submit();
    expect(run.error.value).toContain('429');
    expect(run.question.value).toBe('q');
    expect(run.running.value).toBe(false);
  });

  it('cancel timeout shows message and stops', async () => {
    const req = vi.fn(async (path: string) => {
      if (path === '/v1/agent/runs') return { runId: 'r1' };
      if (path.endsWith('/cancel')) throw new StudioError(0, 'service_unavailable', MSG_UNAVAILABLE);
      return { runId: 'r1', state: 'running', currentStep: 1, steps: [] };
    });
    const run = make(req);
    run.question.value = 'q';
    await run.submit();
    await run.cancel();
    expect(run.error.value).toBe(MSG_CANCEL_TIMEOUT);
    expect(run.running.value).toBe(false);
    expect(run.question.value).toBe('q');
  });
});
