import { describe, expect, it, vi } from 'vitest';
import { signSession } from '../../auth/session.js';
import { StrapiError } from '../../backend/strapi-client.js';
import { SlidingWindowLimiter } from '../../limits/sliding-window.js';
import { createApp, type AppDeps } from '../app.js';
import { registerDreamRoutes } from './dreams.js';

const SECRET = 'secret-secret-secret';
const now = 1_700_000_000_000;
const { token } = signSession(SECRET, now);
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

function setup(opts: { updateFails?: boolean; llmFails?: boolean } = {}) {
  const store: Record<string, Record<string, unknown>> = {
    d1: { id: 1, documentId: 'd1', rawContent: 'raw', tags: ['a'], aiProcessed: false },
  };
  const strapi = {
    getDream: vi.fn(async (id: string) => store[id] ?? null),
    createDream: vi.fn(async (r: Record<string, unknown>) => {
      store.new1 = { id: 2, documentId: 'new1', ...r };
      return store.new1;
    }),
    updateDream: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      if (opts.updateFails) throw new StrapiError('boom', 500);
      Object.assign(store[id], patch);
      return store[id];
    }),
  };
  const llm = {
    chat: vi.fn(async () => {
      if (opts.llmFails) throw new Error('llm down');
      return {
        content: JSON.stringify({
          title: 't',
          summary: 's',
          keywords: ['k'],
          emotion: 'calm',
          emotionScore: 0.5,
        }),
      };
    }),
  };
  const deps = {
    config: { corsOrigins: [], trustProxy: false, secrets: { sessionSecret: SECRET } },
    clock: { now: () => now, sleep: async () => {} },
    publicLimiter: new SlidingWindowLimiter({ limit: 60, windowMs: 60_000 }),
    strapi,
    llm,
    routes: [registerDreamRoutes],
  } as unknown as AppDeps;
  return { app: createApp(deps), strapi, llm, deps };
}

const req = (app: ReturnType<typeof setup>['app'], method: string, path: string, body?: unknown, headers = auth) =>
  app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

describe('dreams routes', () => {
  it('401 without session', async () => {
    const { app, strapi } = setup();
    const res = await req(app, 'POST', '/v1/dreams', { content: 'x' }, { 'content-type': 'application/json' });
    expect(res.status).toBe(401);
    expect(strapi.createDream).not.toHaveBeenCalled();
  });

  it('POST validates content (400, no create) and returns 201 pending', async () => {
    const { app, strapi, deps } = setup();
    expect((await req(app, 'POST', '/v1/dreams', { content: '   ' })).status).toBe(400);
    expect(strapi.createDream).not.toHaveBeenCalled();

    const res = await req(app, 'POST', '/v1/dreams', { content: ' 梦 ' });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { enrichment: string };
    expect(json.enrichment).toBe('pending');
    expect(strapi.createDream).toHaveBeenCalledWith(
      expect.objectContaining({ rawContent: ' 梦 ', source: 'web', aiProcessed: false, isFavorite: false, tags: [] }),
    );
    const queue = deps.extras!.enrichmentQueue as { drain(): Promise<void> };
    await queue.drain();
    const st = await req(app, 'GET', '/v1/dreams/new1/enrichment');
    expect(await st.json()).toEqual({ status: 'done' });
  });

  it('enrich retry: 409 unless failed', async () => {
    const { app, deps } = setup();
    await req(app, 'POST', '/v1/dreams', { content: 'abc' });
    await (deps.extras!.enrichmentQueue as { drain(): Promise<void> }).drain();
    expect((await req(app, 'POST', '/v1/dreams/new1/enrich')).status).toBe(409); // done
  });

  it('enrich retry accepted when failed', async () => {
    const { app, deps } = setup({ llmFails: true });
    await req(app, 'POST', '/v1/dreams', { content: 'abc' });
    await (deps.extras!.enrichmentQueue as { drain(): Promise<void> }).drain();
    const st = (await (await req(app, 'GET', '/v1/dreams/new1/enrichment')).json()) as { status: string };
    expect(st.status).toBe('failed');
    expect((await req(app, 'POST', '/v1/dreams/new1/enrich')).status).toBe(202);
  });

  it('tags: add/remove exclusive, invalid → 400 without write', async () => {
    const { app, strapi } = setup();
    for (const body of [{}, { add: 'x', remove: 'a' }, { add: 1 }, { add: ' ' }, { add: 'x'.repeat(21) }]) {
      expect((await req(app, 'PATCH', '/v1/dreams/d1/tags', body)).status).toBe(400);
    }
    expect(strapi.updateDream).not.toHaveBeenCalled();
    const add = await req(app, 'PATCH', '/v1/dreams/d1/tags', { add: ' b ' });
    expect(await add.json()).toEqual({ tags: ['a', 'b'] });
    const rm = await req(app, 'PATCH', '/v1/dreams/d1/tags', { remove: 'a' });
    expect(await rm.json()).toEqual({ tags: ['b'] });
    expect((await req(app, 'PATCH', '/v1/dreams/zz/tags', { add: 'x' })).status).toBe(404);
  });

  it('favorite: 400 non-boolean, 404 no create, sets absolute value, 502 on PUT failure', async () => {
    const { app, strapi } = setup();
    expect((await req(app, 'PUT', '/v1/dreams/d1/favorite', { isFavorite: 'yes' })).status).toBe(400);
    expect((await req(app, 'PUT', '/v1/dreams/zz/favorite', { isFavorite: true })).status).toBe(404);
    expect(strapi.createDream).not.toHaveBeenCalled();
    expect(strapi.updateDream).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      const res = await req(app, 'PUT', '/v1/dreams/d1/favorite', { isFavorite: true });
      expect(await res.json()).toEqual({ isFavorite: true });
    }
    const failing = setup({ updateFails: true });
    expect((await req(failing.app, 'PUT', '/v1/dreams/d1/favorite', { isFavorite: true })).status).toBe(502);
  });
});
