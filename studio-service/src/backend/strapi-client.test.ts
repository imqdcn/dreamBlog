import { describe, expect, it, vi } from 'vitest';
import { StrapiClient, StrapiError } from './strapi-client.js';

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });

function make(fetchImpl: typeof fetch) {
  const sleeps: number[] = [];
  const client = new StrapiClient({
    baseUrl: 'http://strapi:1337/',
    token: 'tok',
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, sleeps };
}

describe('StrapiClient', () => {
  it('sends Bearer token and a timeout signal', async () => {
    const f = vi.fn(async () => ok({ id: 1, documentId: 'd1' }));
    const { client } = make(f as unknown as typeof fetch);
    await client.updateDream('d1', { isFavorite: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://strapi:1337/api/dreams/d1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries PUT on 5xx with 500ms then 1000ms backoff', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ok({ id: 1 }));
    const { client, sleeps } = make(f as unknown as typeof fetch);
    await expect(client.updateDream('d1', { title: 't' })).resolves.toMatchObject({ id: 1 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up after 2 retries', async () => {
    const f = vi.fn(async () => new Response('x', { status: 500 }));
    const { client } = make(f as unknown as typeof fetch);
    await expect(client.updateDream('d1', {})).rejects.toBeInstanceOf(StrapiError);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('does not retry 4xx', async () => {
    const f = vi.fn(async () => new Response('bad', { status: 400 }));
    const { client } = make(f as unknown as typeof fetch);
    await expect(client.updateDream('d1', {})).rejects.toMatchObject({ status: 400 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('does not retry createStory / createAgentRun POSTs', async () => {
    const f = vi.fn(async () => new Response('x', { status: 500 }));
    const { client } = make(f as unknown as typeof fetch);
    await expect(
      client.createStory({ title: 't', content: 'c', style: 'poetic', sourceDreams: ['a'] })
    ).rejects.toBeInstanceOf(StrapiError);
    await expect(client.createAgentRun({ runId: 'r', question: 'q' })).rejects.toBeInstanceOf(StrapiError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('getDream returns null on 404; deleteStory handles 204', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('nf', { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { client } = make(f as unknown as typeof fetch);
    expect(await client.getDream('nope')).toBeNull();
    expect(await client.deleteStory('s1')).toBe(true);
  });

  it('getAgentRun filters by runId and returns first match', async () => {
    const f = vi.fn(async () => ok([{ id: 3, runId: 'r1' }]));
    const { client } = make(f as unknown as typeof fetch);
    const run = await client.getAgentRun('r1');
    expect(run).toMatchObject({ runId: 'r1' });
    expect(decodeURIComponent((f.mock.calls[0] as unknown as [string])[0])).toContain(
      'filters[runId][$eq]=r1'
    );
  });
});
