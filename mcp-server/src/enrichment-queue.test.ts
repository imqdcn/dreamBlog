import { describe, it, expect, vi } from 'vitest';
import { EnrichmentQueue } from './enrichment-queue.js';
import type { StrapiClient, DreamEnrichmentPatch } from './strapi-client.js';
import type { LlmProcessor, DreamEnrichment } from './llm-processor.js';

function makeQueue(opts: {
  enrich: () => Promise<DreamEnrichment | null>;
  updateImpl?: (documentId: string, patch: DreamEnrichmentPatch) => Promise<void>;
  unprocessed?: () => Promise<Array<{ documentId: string; rawContent: string }>>;
}) {
  const updates: Array<{ documentId: string; patch: DreamEnrichmentPatch }> = [];
  const strapi = {
    updateDream: vi.fn(async (documentId: string, patch: DreamEnrichmentPatch) => {
      if (opts.updateImpl) await opts.updateImpl(documentId, patch);
      updates.push({ documentId, patch });
      return { id: 1, documentId };
    }),
    listUnprocessed: vi.fn(opts.unprocessed ?? (async () => [])),
  } as unknown as StrapiClient;
  const llm = {
    enrich: vi.fn(opts.enrich),
  } as unknown as LlmProcessor;
  return { queue: new EnrichmentQueue(strapi, llm), updates, strapi, llm };
}

const sampleEnrichment: DreamEnrichment = {
  title: '飞翔',
  summary: '在天上飞。',
  keywords: ['飞', '天空'],
  emotion: 'joyful',
  emotionScore: 0.9,
  clarity: 5,
};

describe('EnrichmentQueue', () => {
  it('加工成功后回写全部字段并置 aiProcessed=true', async () => {
    const { queue, updates } = makeQueue({ enrich: async () => sampleEnrichment });
    queue.enqueue({ documentId: 'doc-1', rawContent: '梦' });
    await queue.drain();

    expect(updates).toHaveLength(1);
    expect(updates[0].documentId).toBe('doc-1');
    expect(updates[0].patch.title).toBe('飞翔');
    expect(updates[0].patch.emotion).toBe('joyful');
    expect(updates[0].patch.clarity).toBe(5);
    expect(updates[0].patch.aiProcessed).toBe(true);
  });

  it('加工返回 null 时不回写（保留原文）', async () => {
    const { queue, updates } = makeQueue({ enrich: async () => null });
    queue.enqueue({ documentId: 'doc-1', rawContent: '梦' });
    await queue.drain();
    expect(updates).toHaveLength(0);
  });

  it('无 clarity 时不包含该字段', async () => {
    const { queue, updates } = makeQueue({
      enrich: async () => ({ ...sampleEnrichment, clarity: undefined }),
    });
    queue.enqueue({ documentId: 'doc-1', rawContent: '梦' });
    await queue.drain();
    expect('clarity' in updates[0].patch).toBe(false);
  });

  it('串行消费多条任务', async () => {
    const { queue, updates } = makeQueue({ enrich: async () => sampleEnrichment });
    queue.enqueue({ documentId: 'a', rawContent: '1' });
    queue.enqueue({ documentId: 'b', rawContent: '2' });
    queue.enqueue({ documentId: 'c', rawContent: '3' });
    await queue.drain();
    expect(updates.map((u) => u.documentId)).toEqual(['a', 'b', 'c']);
  });

  it('回写失败不中断队列（后续任务仍处理）', async () => {
    let n = 0;
    const { queue, updates } = makeQueue({
      enrich: async () => sampleEnrichment,
      updateImpl: async () => {
        n += 1;
        if (n === 1) throw new Error('write failed');
      },
    });
    queue.enqueue({ documentId: 'a', rawContent: '1' });
    queue.enqueue({ documentId: 'b', rawContent: '2' });
    await queue.drain();
    // 第一条回写抛错（updates 里不会 push），第二条成功
    expect(updates.map((u) => u.documentId)).toEqual(['b']);
  });

  it('drain 在空队列上立即返回', async () => {
    const { queue } = makeQueue({ enrich: async () => sampleEnrichment });
    await expect(queue.drain()).resolves.toBeUndefined();
  });
});

describe('EnrichmentQueue.recover（开机补偿扫描）', () => {
  it('把待加工记录重新入队并加工回写', async () => {
    const { queue, updates } = makeQueue({
      enrich: async () => sampleEnrichment,
      unprocessed: async () => [
        { documentId: 'a', rawContent: '1' },
        { documentId: 'b', rawContent: '2' },
      ],
    });
    const n = await queue.recover();
    expect(n).toBe(2);
    await queue.drain();
    expect(updates.map((u) => u.documentId)).toEqual(['a', 'b']);
  });

  it('无待加工记录时返回 0', async () => {
    const { queue } = makeQueue({
      enrich: async () => sampleEnrichment,
      unprocessed: async () => [],
    });
    expect(await queue.recover()).toBe(0);
  });

  it('查询失败不抛出，返回 0', async () => {
    const { queue } = makeQueue({
      enrich: async () => sampleEnrichment,
      unprocessed: async () => {
        throw new Error('strapi down');
      },
    });
    await expect(queue.recover()).resolves.toBe(0);
  });
});
