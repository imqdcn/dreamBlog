import { describe, expect, it } from 'vitest';
import { LoginGuard } from '../../auth/login-guard.js';
import { verifySession } from '../../auth/session.js';
import { SlidingWindowLimiter } from '../../limits/sliding-window.js';
import { createApp, type AppDeps } from '../app.js';
import { registerAuthRoutes } from './auth.js';
import { registerHealthRoutes } from './health.js';

const PASS = 'correct-passphrase';
const SECRET = 'secret-secret-secret';
let now = 1_700_000_000_000;

function makeApp(fetchImpl: unknown) {
  const deps = {
    config: {
      corsOrigins: [],
      trustProxy: false,
      strapiUrl: 'http://strapi.test',
      secrets: { sessionSecret: SECRET, ownerPassphrase: PASS },
    },
    clock: { now: () => now, sleep: async () => {} },
    loginGuard: new LoginGuard({ now: () => now }),
    publicLimiter: new SlidingWindowLimiter({ limit: 60, windowMs: 60_000 }),
    extras: { fetch: fetchImpl },
    routes: [registerHealthRoutes, registerAuthRoutes],
  } as unknown as AppDeps;
  return createApp(deps);
}

const login = (app: ReturnType<typeof makeApp>, passphrase: string) =>
  app.request('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });

describe('GET /health', () => {
  it('reports ok when backend reachable', async () => {
    const app = makeApp(async () => ({ ok: true }));
    const res = await app.request('/health');
    expect(await res.json()).toEqual({ status: 'ok', backend: 'reachable' });
  });
  it('reports degraded when backend fails', async () => {
    const app = makeApp(async () => {
      throw new Error('boom');
    });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'degraded', backend: 'unreachable' });
  });
});

describe('POST /v1/auth/login', () => {
  it('issues a verifiable token on success', async () => {
    const app = makeApp(async () => ({ ok: true }));
    const res = await login(app, PASS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number };
    expect(verifySession(SECRET, body.token, now).ok).toBe(true);
    expect(body.expiresAt).toBe(Math.floor(now / 1000) * 1000 + 12 * 3600 * 1000);
  });
  it('401 on wrong passphrase, then 429 after lockout even with correct one', async () => {
    const app = makeApp(async () => ({ ok: true }));
    for (let i = 0; i < 5; i++) expect((await login(app, 'wrong')).status).toBe(401);
    const locked = await login(app, PASS);
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).not.toBeNull();
  });
});
