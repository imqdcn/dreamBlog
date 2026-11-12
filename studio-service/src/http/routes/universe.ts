/**
 * GET /v1/universe?threshold=0.3（需求 6.5、6.6、6.10）：公开；读取全量 Dream，
 * 经 60 秒指纹缓存构建节点与边；Dream 少于 2 条时 edges 为空。
 */
import { getUniverseCached } from '../../domain/similarity.js';
import type { RouteRegistrar } from '../app.js';
import { invalidArgument } from '../middleware.js';

export const DEFAULT_UNIVERSE_THRESHOLD = 0.3;

function parseThreshold(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_UNIVERSE_THRESHOLD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw invalidArgument('threshold 必须是 0 到 1 之间的数字', ['threshold']);
  }
  return n;
}

export const registerUniverseRoutes: RouteRegistrar = (app, deps) => {
  app.get('/v1/universe', async (c) => {
    const threshold = parseThreshold(c.req.query('threshold'));
    const dreams = await deps.dreamSource.listAll(c.req.raw.signal);
    // getUniverseCached 在 Dream 少于 2 条时由 buildUniverse 返回空 edges。
    const universe = getUniverseCached(dreams, threshold, deps.clock.now());
    return c.json(universe);
  });
};
