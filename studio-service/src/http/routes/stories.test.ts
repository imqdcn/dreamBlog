import { describe, expect, it, vi } from 'vitest';
import { signSession } from '../../auth/session.js';
import { StrapiError } from '../../backend/strapi-client.js';
import { SlidingWindowLimiter } from '../../limits/sliding-window.js';
import { createApp, type AppDeps } from '../app.js';
import { registerStoryRoutes } from './stories.js';

const SECRET = 'secret-secret-secret';
const now = 1_700_000_000_000;
const { token } = signSession(SECRET, now);
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const dreamEntity = (id: string, tags: string[], title = `T-${id}`) => ({
  id: 1,
  documentId: id,
  rawContent: `raw ${id}`,
  title,
  tags,
});

function setup(opts: { llmContent?: string; llmGate?: Promise<void>; createStory?: () => Promise<unknown>; deleteStory?: () => Promise<boolean> } = {}) {
  const dreams: Record<string, ReturnType<typeof dreamEntity>> = {
    a: dreamEntity('a', ['x', 'y']),
    b: dreamEntity('b', ['y', 'z']),
  };
  const strapi = {
    getDream: vi.fn(async (id: string) => dreams[id] ?? null),
    createStory: vi.fn(opts.createStory ?? (async (s: unknown) => ({ id: 1, documentId: 's1', ...(s as object) }))),
    deleteStory: vi.fn(opts.deleteStory ?? (async () => true)),
  };
  const llm = {
    chat: vi.fn(async () => {
      if (opts.llmGate) await opts.llmGate;
      return { content: opts.llmContent ?? '{"title":"标题","content":"正文"}' };
    }),
  };
  const deps = {
    config: { corsOrigins: [], trustProxy: false, secrets: { sessionSecret: SECRET } },
    clock: { now: () => now, sleep: async () => {} },
    publicLimiter: new SlidingWindowLimiter({ limit: 60, windowMs: 60_000 }),
    strapi,
    llm,
    routes: [registerStoryRoutes],
  } as unknown as AppDeps;
  return { app: createApp(deps), strapi, llm };
}

const post = (app: ReturnType<typeof setup>['app'], body: unknown, headers: Record<string, string> = auth) =>
  app.request('/v1/stories', { method: 'POST', headers, body: JSON.stringify(body) });

describe('POST /v1/stories', () => {
  it('401 without session', async () => {
    const { app, llm } = setup();
    const res = await post(app, { dreamIds: ['a'], style: 'poetic' }, { 'content-type': 'application/json' });
    expect(res.status).toBe(401);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('400 for invalid requests without calling LLM', async () => {
    const { app, llm, strapi } = setup();
    for (const body of [
      { dreamIds: [], style: 'poetic' },
      { dreamIds: ['a', 'a'], style: 'poetic' },
      { dreamIds: ['nope'], style: 'poetic' },
      { dreamIds: ['a'], style: 'bad' },
    ]) {
      expect((await post(app, body)).status).toBe(400);
    }
    expect(llm.chat).not.toHaveBeenCalled();
    expect(strapi.createStory).not.toHaveBeenCalled();
  });

  it('creates story with snapshot and tag union', async () => {
    const { app, strapi } = setup();
    const res = await post(app, { dreamIds: ['b', 'a'], style: 'mystery' });
    expect(res.status).toBe(201);
    expect(strapi.createStory).toHaveBeenCalledWith({
      title: '标题',
      content: '正文',
      style: 'mystery',
      tags: ['y', 'z', 'x'],
      sourceDreams: ['b', 'a'],
      sourceSnapshot: [
        { documentId: 'b', title: 'T-b' },
        { documentId: 'a', title: 'T-a' },
      ],
    });
  });

  it('502 when LLM output is unparseable; key is released for retry', async () => {
    const { app, strapi } = setup({ llmContent: 'not json' });
    const body = { dreamIds: ['a'], style: 'poetic' };
    expect((await post(app, body)).status).toBe(502);
    expect((await post(app, body)).status).toBe(502);
    expect(strapi.createStory).not.toHaveBeenCalled();
  });

  it('409 for concurrent identical request without second LLM call', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, llm } = setup({ llmGate: gate });
    const body = { dreamIds: ['a', 'b'], style: 'sci_fi' };
    const first = post(app, body);
    await vi.waitFor(() => expect(llm.chat).toHaveBeenCalledTimes(1));
    const second = await post(app, { dreamIds: ['b', 'a'], style: 'sci_fi' });
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(201);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /v1/stories/:id', () => {
  it('deletes only the story', async () => {
    const { app, strapi } = setup();
    const res = await app.request('/v1/stories/s1', { method: 'DELETE', headers: auth });
    expect(res.status).toBe(200);
    expect(strapi.deleteStory).toHaveBeenCalledWith('s1');
  });

  it('404 when missing, 502 on backend failure', async () => {
    const missing = setup({ deleteStory: async () => false });
    expect((await missing.app.request('/v1/stories/x', { method: 'DELETE', headers: auth })).status).toBe(404);
    const failing = setup({
      deleteStory: async () => {
        throw new StrapiError('boom', 500);
      },
    });
    expect((await failing.app.request('/v1/stories/x', { method: 'DELETE', headers: auth })).status).toBe(502);
  });
});
