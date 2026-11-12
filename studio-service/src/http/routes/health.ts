/**
 * GET /health（需求 1.8、1.9）：探测 Backend 可达性，约 2 秒内返回；
 * 响应只含 status 与 backend，不含任何密钥或内部细节。
 */
import type { RouteRegistrar } from '../app.js';

export const HEALTH_TIMEOUT_MS = 2000;

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean }>;

export const registerHealthRoutes: RouteRegistrar = (app, deps) => {
  const fetchImpl = (deps.extras?.fetch as FetchLike | undefined) ?? (globalThis.fetch as FetchLike);

  app.get('/health', async (c) => {
    let reachable = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${deps.config.strapiUrl}/_health`, { signal: controller.signal });
      // Strapi 的 /_health 返回 204；任何 2xx 视为可达。
      reachable = res.ok;
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timer);
    }
    c.header('Cache-Control', 'no-store');
    return c.json({
      status: reachable ? ('ok' as const) : ('degraded' as const),
      backend: reachable ? ('reachable' as const) : ('unreachable' as const),
    });
  });
};
