/**
 * 创建 Hono 应用：挂载 CORS、公开接口限流、统一错误体，再由 registerXRoutes 挂载路由。
 */
import { Hono } from 'hono';
import type { Clock, LlmClient, ReadOnlyDreamSource } from '../agent/types.js';
import type { LoginGuard } from '../auth/login-guard.js';
import type { StrapiClient } from '../backend/strapi-client.js';
import type { StudioConfig } from '../config.js';
import type { SlidingWindowLimiter } from '../limits/sliding-window.js';
import {
  apiErrorHandler,
  apiNotFoundHandler,
  corsMiddleware,
  publicRateLimit,
  type AppEnv,
} from './middleware.js';

export type StudioApp = Hono<AppEnv>;

/**
 * 路由依赖。核心字段为各路由共用；`extras` 留给后续路由任务放置自己的服务
 * （如加工队列、Run 管理器），避免本文件成为合并冲突点。
 */
export interface AppDeps {
  config: StudioConfig;
  clock: Clock;
  loginGuard: LoginGuard;
  /** 公开接口按来源地址限流：60 次/分钟。 */
  publicLimiter: Pick<SlidingWindowLimiter, 'tryAcquire'>;
  /** 其他命名限流器（如 Agent 提问 30 次/小时，key=sid）。 */
  limiters?: Record<string, Pick<SlidingWindowLimiter, 'tryAcquire'>>;
  strapi: StrapiClient;
  dreamSource: ReadOnlyDreamSource;
  llm: LlmClient;
  extras?: Record<string, unknown>;
  /** 路由注册函数；由装配代码（index.ts）传入。 */
  routes?: RouteRegistrar[];
}

export type RouteRegistrar = (app: StudioApp, deps: AppDeps) => void;

export const PUBLIC_RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const;
/** 需要按来源地址限流的公开端点（/health 不限流，便于健康检查）。 */
export const PUBLIC_LIMITED_PATHS = ['/v1/universe', '/v1/auth/login'] as const;

export function createApp(deps: AppDeps): StudioApp {
  const app = new Hono<AppEnv>();

  app.use('*', corsMiddleware(deps));
  for (const path of PUBLIC_LIMITED_PATHS) {
    app.use(path, publicRateLimit(deps));
  }

  app.onError(apiErrorHandler);
  app.notFound(apiNotFoundHandler);

  for (const register of deps.routes ?? []) register(app, deps);
  return app;
}
