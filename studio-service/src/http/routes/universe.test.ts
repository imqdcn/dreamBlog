import { beforeEach, describe, expect, it } from 'vitest';
import { clearUniverseCache } from '../../domain/similarity.js';
import type { DreamRecord } from '../../domain/types.js';
import { SlidingWindowLimiter } from '../../limits/sliding-window.js';
import { createApp, type AppDeps } from '../app.js';
import { registerUniverseRoutes } from './universe.js';

let now = 1_700_000_000_000;

const dream = (id: string, keywords: string[], updatedAt = '2024-01-01T00:00:00Z'): DreamRecord => ({
  documentId: id,
  rawContent: 'x',
  keywords,
  tags: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt,
  aiProcessed: true,
  isFavorite: false,
});

function makeApp(dreams: DreamRecord[], counter: { calls: number }) {
  const deps = {
    config: { corsOrigins: [], trustProxy: false, secrets: { sessionSecret: 's' } },
    clock: { now: () => now, sleep: async () => {} },
    publicLimiter: new SlidingWindowLimiter({ limit: 60, windowMs: 60_000 }),
    dreamSource: {
      listAll: async () => {
        counter.calls++;
        return dreams;
      },
    },
    routes: [registerUniverseRoutes],
  } as unknown as AppDeps;
  return createApp(deps);
}

describe('GET /v1/universe', () => {
  beforeEach(() => clearUniverseCache());

  it('returns empty edges when fewer than 2 dreams', async () => {
    const app = makeApp([dream('a', ['x'])], { calls: 0 });
    const body = (await (await app.request('/v1/universe')).json()) as { nodes: unknown[]; edges: unknown[] };
    expect(body.nodes).toHaveLength(1);
    expect(body.edges).toEqual([]);
  });

  it('links similar dreams and caches result for 60s', async () => {
    const counter = { calls: 0 };
    const app = makeApp([dream('a', ['海', '船']), dream('b', ['海', '船'])], counter);
    const r1 = (await (await app.request('/v1/universe?threshold=0.3')).json()) as { edges: unknown[] };
    expect(r1.edges).toHaveLength(1);
    const r2 = (await (await app.request('/v1/universe?threshold=0.3')).json()) as { edges: unknown[] };
    expect(r2).toEqual(r1);
    now += 61_000;
    await app.request('/v1/universe?threshold=0.3');
    expect(counter.calls).toBe(3);
  });

  it('400 on invalid threshold', async () => {
    const app = makeApp([], { calls: 0 });
    const res = await app.request('/v1/universe?threshold=abc');
    expect(res.status).toBe(400);
  });
});
