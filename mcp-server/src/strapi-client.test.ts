import { describe, it, expect, vi } from 'vitest';
import { StrapiClient } from './strapi-client.js';

function okResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('StrapiClient.createDream', () => {
  it('成功写入并返回 id', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ id: 1, documentId: 'abc' }));
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.createDream({ rawContent: '梦' });
    expect(res.id).toBe(1);
    expect(res.documentId).toBe('abc');

    // 校验请求：POST /api/dreams，带 Bearer，data 包裹
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:1337/api/dreams');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.data.rawContent).toBe('梦');
  });

  it('4xx 不重试直接抛错', async () => {
    const fetchImpl = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.createDream({ rawContent: '梦' })).rejects.toThrow(/403/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('5xx 会重试到上限', async () => {
    const fetchImpl = vi.fn(async () => new Response('err', { status: 500 }));
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      maxRetries: 2,
      retryBaseDelayMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.createDream({ rawContent: '梦' })).rejects.toThrow();
    // 初次 + 2 次重试 = 3
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('5xx 后恢复则成功', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return n === 1 ? new Response('err', { status: 503 }) : okResponse({ id: 7 });
    });
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      maxRetries: 2,
      retryBaseDelayMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.createDream({ rawContent: '梦' });
    expect(res.id).toBe(7);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('StrapiClient.updateDream', () => {
  it('以 PUT /api/dreams/:documentId 回写字段', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ id: 1, documentId: 'abc' }));
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.updateDream('abc', { title: '飞翔', aiProcessed: true });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:1337/api/dreams/abc');
    expect((init as RequestInit).method).toBe('PUT');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.data.title).toBe('飞翔');
    expect(body.data.aiProcessed).toBe(true);
  });

  it('4xx 不重试直接抛错', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.updateDream('abc', { aiProcessed: true })).rejects.toThrow(/404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('5xx 会重试', async () => {
    const fetchImpl = vi.fn(async () => new Response('err', { status: 500 }));
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      maxRetries: 2,
      retryBaseDelayMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.updateDream('abc', { aiProcessed: true })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('StrapiClient.listUnprocessed', () => {
  function pageResponse(
    data: Array<{ documentId?: string; rawContent?: string }>,
    pageCount: number
  ) {
    return new Response(JSON.stringify({ data, meta: { pagination: { pageCount } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('查询 aiProcessed=false 并返回 documentId+rawContent', async () => {
    const fetchImpl = vi.fn(async () =>
      pageResponse([{ documentId: 'a', rawContent: '梦1' }], 1)
    );
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.listUnprocessed();
    expect(res).toEqual([{ documentId: 'a', rawContent: '梦1' }]);

    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('filters%5BaiProcessed%5D%5B%24eq%5D=false');
  });

  it('自动翻页拉全量', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(pageResponse([{ documentId: 'a', rawContent: '1' }], 2))
      .mockResolvedValueOnce(pageResponse([{ documentId: 'b', rawContent: '2' }], 2));
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.listUnprocessed();
    expect(res.map((r) => r.documentId)).toEqual(['a', 'b']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('跳过缺少 documentId 或 rawContent 的项', async () => {
    const fetchImpl = vi.fn(async () =>
      pageResponse(
        [
          { documentId: 'a', rawContent: '1' },
          { documentId: undefined, rawContent: '2' },
          { documentId: 'c' },
        ],
        1
      )
    );
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.listUnprocessed();
    expect(res).toEqual([{ documentId: 'a', rawContent: '1' }]);
  });

  it('查询失败抛错', async () => {
    const fetchImpl = vi.fn(async () => new Response('err', { status: 500 }));
    const client = new StrapiClient({
      baseUrl: 'http://localhost:1337',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.listUnprocessed()).rejects.toThrow(/500/);
  });
});
