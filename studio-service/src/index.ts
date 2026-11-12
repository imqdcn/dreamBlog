/**
 * Studio_Service 入口：加载配置 → 装配依赖与路由 → 启动 HTTP → 处理 SIGTERM 优雅退出。
 * 配置不合规时在创建 HTTP 服务器前以退出码 1 退出（需求 1.3、1.5）。
 */
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import 'dotenv/config';
import type { RunRegistry } from './agent/run-registry.js';
import { StrapiDreamSource } from './backend/dream-source.js';
import { StrapiClient } from './backend/strapi-client.js';
import { ConfigError, loadConfig } from './config.js';
import { registerAgentRoutes } from './http/routes/agent.js';
import { registerAuthRoutes } from './http/routes/auth.js';
import { registerDreamRoutes } from './http/routes/dreams.js';
import { registerHealthRoutes } from './http/routes/health.js';
import { registerStoryRoutes } from './http/routes/stories.js';
import { registerUniverseRoutes } from './http/routes/universe.js';
import { createApp, PUBLIC_RATE_LIMIT, type AppDeps } from './http/app.js';
import { LoginGuard } from './auth/login-guard.js';
import { SlidingWindowLimiter } from './limits/sliding-window.js';
import { OpenAiLlmClient } from './llm/client.js';
import { logger, registerSecrets, setLogLevel } from './logger.js';
import { EnrichmentQueue } from './queue/enrichment-queue.js';

/** 加工队列排空上限（毫秒）。 */
export const QUEUE_DRAIN_MS = 10_000;

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  let config;
  try {
    config = loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) {
      // 只输出变量名与原因，不含取值
      console.error(`Studio_Service 启动失败：${err.message}`);
      console.error(`缺失或不合规的变量：${err.missing.join(', ')}`);
      process.exit(1);
    }
    throw err;
  }

  setLogLevel(config.logLevel);
  const s = config.secrets;
  registerSecrets([s.ownerPassphrase, s.sessionSecret, s.llmApiKey, s.strapiToken]);

  const clock = {
    now: () => Date.now(),
    sleep: (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'));
        const t = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }),
  };

  const strapi = new StrapiClient({ baseUrl: config.strapiUrl, token: s.strapiToken });
  const dreamSource = new StrapiDreamSource({ baseUrl: config.strapiUrl, token: s.strapiToken });
  const llm = new OpenAiLlmClient({
    baseUrl: config.llm.baseUrl,
    apiKey: s.llmApiKey,
    model: config.llm.model,
  });
  const loginGuard = new LoginGuard();
  loginGuard.startSweeper();
  const enrichmentQueue = new EnrichmentQueue({ llm, backend: strapi });

  const deps: AppDeps = {
    config,
    clock,
    loginGuard,
    publicLimiter: new SlidingWindowLimiter({ ...PUBLIC_RATE_LIMIT }),
    strapi,
    dreamSource,
    llm,
    extras: { enrichmentQueue },
    routes: [
      registerHealthRoutes,
      registerAuthRoutes,
      registerUniverseRoutes,
      registerDreamRoutes,
      registerStoryRoutes,
      registerAgentRoutes,
    ],
  };
  const app = createApp(deps);

  const server: ServerType = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info('studio-service listening', undefined, { port: info.port });
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('SIGTERM received, shutting down');
    const registry = deps.extras?.runRegistry as RunRegistry | undefined;
    const queue = deps.extras?.enrichmentQueue as EnrichmentQueue | undefined;
    loginGuard.stopSweeper();
    // 先停止接收新连接，再取消 Run、排空队列
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.allSettled([registry?.shutdown(), queue?.drain(QUEUE_DRAIN_MS)]);
    await Promise.race([closed, new Promise<void>((r) => setTimeout(r, 2_000).unref())]);
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
}

// 仅在作为入口直接运行时启动（便于测试导入）
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error('Studio_Service 启动失败：', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
