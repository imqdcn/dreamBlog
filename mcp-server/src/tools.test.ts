import { describe, it, expect, vi } from 'vitest';
import { ToolHandlers } from './tools.js';
import type { StrapiClient, DreamRecord } from './strapi-client.js';
import type { EnrichmentQueue } from './enrichment-queue.js';

function makeHandlers(opts: {
  createImpl?: (r: DreamRecord) => Promise<{ id: number; documentId?: string }>;
} = {}) {
  const created: DreamRecord[] = [];
  const enqueued: Array<{ documentId: string; rawContent: string }> = [];

  const strapi = {
    createDream: vi.fn(async (r: DreamRecord) => {
      created.push(r);
      return opts.createImpl ? opts.createImpl(r) : { id: 1, documentId: 'doc-1' };
    }),
  } as unknown as StrapiClient;

  const queue = {
    enqueue: vi.fn((job: { documentId: string; rawContent: string }) => {
      enqueued.push(job);
    }),
    size: 0,
  } as unknown as EnrichmentQueue;

  return { handlers: new ToolHandlers(strapi, queue), created, enqueued };
}

describe('ToolHandlers echo', () => {
  it('原样回显', async () => {
    const { handlers } = makeHandlers();
    const r = await handlers.call('echo', { text: 'hello' });
    expect(r.content[0].text).toBe('hello');
    expect(r.isError).toBeUndefined();
  });
});

describe('ToolHandlers record_dream（异步加工）', () => {
  it('先落库原文（aiProcessed=false）并立即回话', async () => {
    const { handlers, created } = makeHandlers();
    const r = await handlers.call('record_dream', { content: '我梦见自己飞起来了' });
    expect(r.isError).toBeUndefined();
    expect(created).toHaveLength(1);
    expect(created[0].rawContent).toBe('我梦见自己飞起来了');
    expect(created[0].aiProcessed).toBe(false);
    expect(created[0].source).toBe('xiaozhi');
    expect(created[0].dreamedAt).toBeTruthy();
    // 回话不再包含标题（加工转后台）
    expect(created[0].title).toBeUndefined();
  });

  it('落库成功后把加工任务入队', async () => {
    const { handlers, enqueued } = makeHandlers();
    await handlers.call('record_dream', { content: '一段梦' });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toEqual({ documentId: 'doc-1', rawContent: '一段梦' });
  });

  it('尊重传入的 dreamedAt', async () => {
    const { handlers, created } = makeHandlers();
    await handlers.call('record_dream', { content: '梦', dreamedAt: '2026-01-01T00:00:00.000Z' });
    expect(created[0].dreamedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('Strapi 写入失败返回 isError 且不入队', async () => {
    const { handlers, enqueued } = makeHandlers({
      createImpl: async () => {
        throw new Error('db down');
      },
    });
    const r = await handlers.call('record_dream', { content: '梦' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('出了点问题');
    expect(enqueued).toHaveLength(0);
  });

  it('未获得 documentId 时跳过入队但仍成功回话', async () => {
    const { handlers, enqueued } = makeHandlers({
      createImpl: async () => ({ id: 9 }), // 无 documentId
    });
    const r = await handlers.call('record_dream', { content: '梦' });
    expect(r.isError).toBeUndefined();
    expect(enqueued).toHaveLength(0);
  });

  it('空内容被 zod 拒绝', async () => {
    const { handlers } = makeHandlers();
    await expect(handlers.call('record_dream', { content: '' })).rejects.toThrow();
  });

  it('未知工具返回错误', async () => {
    const { handlers } = makeHandlers();
    const r = await handlers.call('nonexistent', {});
    expect(r.isError).toBe(true);
  });
});
