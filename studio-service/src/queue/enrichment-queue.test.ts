import { describe, expect, it, vi } from 'vitest';
import type { LlmClient } from '../agent/types.js';
import { LlmPermanentError, LlmTransientError } from '../llm/client.js';
import { ENRICHMENT_STATUS_TTL_MS, EnrichmentQueue } from './enrichment-queue.js';

const good = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ title: 't', summary: 's', keywords: ['a'], emotion: 'sad', emotionScore: 0.5, ...extra });

function llmReturning(...contents: Array<string | Error>): LlmClient {
  const chat = vi.fn(async () => {
    const c = contents.shift()!;
    if (c instanceof Error) throw c;
    return { content: c, toolCalls: [] };
  });
  return { chat } as unknown as LlmClient;
}

describe('EnrichmentQueue', () => {
  it('成功时一次 PUT 回写并置 aiProcessed，clarity 有值才附带', async () => {
    const updateDream = vi.fn(async () => ({}));
    const q = new EnrichmentQueue({
      llm: llmReturning(good({ clarity: 4 }), good()),
      backend: { updateDream },
    });
    q.enqueue({ documentId: 'a', rawContent: 'x' });
    q.enqueue({ documentId: 'b', rawContent: 'y' });
    expect(q.getStatus('a')).toEqual({ status: 'pending' });
    await q.drain();
    expect(updateDream).toHaveBeenCalledTimes(2);
    expect(updateDream.mock.calls[0]).toEqual([
      'a',
      { title: 't', summary: 's', keywords: ['a'], emotion: 'sad', emotionScore: 0.5, clarity: 4, aiProcessed: true },
    ]);
    expect('clarity' in (updateDream.mock.calls[1] as unknown[])[1]!).toBe(false);
    expect(q.getStatus('a')).toEqual({ status: 'done' });
  });

  it('LLM 失败时不写 Backend，状态为 failed', async () => {
    const updateDream = vi.fn(async () => ({}));
    const q = new EnrichmentQueue({
      llm: llmReturning(new LlmPermanentError('bad')),
      backend: { updateDream },
    });
    q.enqueue({ documentId: 'a', rawContent: 'x' });
    await q.drain();
    expect(updateDream).not.toHaveBeenCalled();
    expect(q.getStatus('a')).toEqual({ status: 'failed', error: 'enrichment_failed' });
  });

  it('瞬时错误重试后成功；回写失败标记 failed 且队列继续', async () => {
    const updateDream = vi
      .fn()
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce({});
    const q = new EnrichmentQueue({
      llm: llmReturning(new LlmTransientError('x'), good(), good()),
      backend: { updateDream },
      retryDelayMs: 1,
    });
    q.enqueue({ documentId: 'a', rawContent: 'x' });
    q.enqueue({ documentId: 'b', rawContent: 'y' });
    await q.drain();
    expect(q.getStatus('a')).toEqual({ status: 'failed', error: 'writeback_failed' });
    expect(q.getStatus('b')).toEqual({ status: 'done' });
  });

  it('状态 30 分钟后过期', async () => {
    let t = 0;
    const q = new EnrichmentQueue({
      llm: llmReturning(good()),
      backend: { updateDream: async () => ({}) },
      now: () => t,
    });
    q.enqueue({ documentId: 'a', rawContent: 'x' });
    await q.drain();
    t = ENRICHMENT_STATUS_TTL_MS - 1;
    expect(q.getStatus('a')).toEqual({ status: 'done' });
    t = ENRICHMENT_STATUS_TTL_MS;
    expect(q.getStatus('a')).toBeUndefined();
  });
});
