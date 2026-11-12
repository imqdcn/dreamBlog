import { describe, expect, it, vi } from 'vitest';
import { signSession } from '../auth/session.js';
import { SlidingWindowLimiter } from '../limits/sliding-window.js';
import { createApp, type AppDeps } from './app.js';
import { ApiError, parseJsonBody, requireOwner } from './middleware.js';

const SECRET = 'secret-secret-secret';
const ORIGIN = 'https://site.example';
let now = 1_700_000_000_000;

function makeDeps(spy = vi.fn()): AppDeps {
  const deps = {
    config: { corsOrigins: [ORIGIN], trustProxy: false, secrets: { sessionSecret: SECRET } },
    clock: { now: () => now, sleep: async () => {} },
    loginGuard: {},
    publicLimiter: new SlidingWindowLimiter({ limit: 60, windowMs: 60_000 }),
    strapi: {},
    dreamSource: {},
    llm: {},
    routes: [
      (app, d) => {
        app.get('/v1/universe', (c) => c.json({ ok: true }));
        app.get('/v1/owner', requireOwner(d), (c) => {
          spy();
          return c.json({ ok: true });
        });
        app.get('/v1/boom', () => {
          throw new Error('secret detail');
        });
        app.get('/v1/conflict', () => {
          throw new ApiError('conflict', 'dup');
        });
        app.post('/v1/body', async (c) => {
          await parseJsonBody(c, (await import('zod')).z.object({ a: (await import('zod')).z.string() }));
          return c.json({});
        });
      },
    ],
  };
  return deps as unknown as AppDeps;
}

describe('createApp', () => {
  it('answers allowed-origin preflight with 204 and CORS headers', async () => {
    const app = createApp(makeDeps());
    const res = await app.request('/v1/owner', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('omits CORS headers for other origins', async () => {
    const app = createApp(makeDeps());
    const res = await app.request('/v1/universe', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns 401 for missing/invalid session before running the handler', async () => {
    const spy = vi.fn();
    const app = createApp(makeDeps(spy));
    for (const h of [undefined, 'Bearer abc.def', 'Basic x']) {
      const res = await app.request('/v1/owner', { headers: h ? { Authorization: h } : {} });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('unauthorized');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts a valid session', async () => {
    const app = createApp(makeDeps());
    const { token } = signSession(SECRET, now);
    const res = await app.request('/v1/owner', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  it('rate-limits public endpoints at 60/min per address', async () => {
    const app = createApp(makeDeps());
    for (let i = 0; i < 60; i++) expect((await app.request('/v1/universe')).status).toBe(200);
    const res = await app.request('/v1/universe');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
    expect((await res.json()).error.code).toBe('rate_limited');
  });

  it('maps errors to the unified body', async () => {
    const app = createApp(makeDeps());
    const boom = await app.request('/v1/boom');
    expect(boom.status).toBe(500);
    expect(JSON.stringify(await boom.json())).not.toContain('secret detail');
    expect((await app.request('/v1/conflict')).status).toBe(409);
    expect((await app.request('/v1/nope')).status).toBe(404);
    const bad = await app.request('/v1/body', { method: 'POST', body: '{"a":1}' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.fields).toEqual(['a']);
  });
});
