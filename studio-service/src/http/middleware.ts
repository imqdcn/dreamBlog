/**
 * HTTP 中间件与统一错误体（设计 1.3、1.4、2.2、2.4；需求 1.6、1.7、2.5）。
 */
import type { Context, ErrorHandler, MiddlewareHandler, NotFoundHandler } from 'hono';
import type { ZodType } from 'zod';
import type { Clock } from '../agent/types.js';
import { resolveSourceAddress } from '../auth/login-guard.js';
import { verifySession, type SessionPayload } from '../auth/session.js';
import { StrapiError } from '../backend/strapi-client.js';
import { LlmPermanentError, LlmTransientError } from '../llm/client.js';
import type { SlidingWindowLimiter } from '../limits/sliding-window.js';
import { errorFields, logger } from '../logger.js';
import { corsHeadersFor } from './cors.js';

export type ErrorCode =
  | 'invalid_argument'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'upstream_failed'
  | 'internal';

export const STATUS_BY_CODE = {
  invalid_argument: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  upstream_failed: 502,
  internal: 500,
} as const satisfies Record<ErrorCode, number>;

export type ErrorStatus = (typeof STATUS_BY_CODE)[ErrorCode];

export interface ErrorBody {
  error: { code: ErrorCode | (string & {}); message: string; fields?: string[] };
}

/** 路由与中间件抛出的受控错误；onError 将其映射为统一错误体。 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: ErrorStatus;
  readonly fields?: string[];
  /** 限流/锁定时的建议等待毫秒数，映射为 Retry-After。 */
  readonly retryAfterMs?: number;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { fields?: string[]; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fields = opts.fields;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export const invalidArgument = (message: string, fields?: string[]): ApiError =>
  new ApiError('invalid_argument', message, { fields });
export const unauthorized = (message = '未登录或会话无效'): ApiError =>
  new ApiError('unauthorized', message);
export const notFound = (message = '资源不存在'): ApiError => new ApiError('not_found', message);
export const conflict = (message: string): ApiError => new ApiError('conflict', message);
export const rateLimited = (message: string, retryAfterMs?: number): ApiError =>
  new ApiError('rate_limited', message, { retryAfterMs });
export const upstreamFailed = (message: string): ApiError =>
  new ApiError('upstream_failed', message);

export function errorBody(code: string, message: string, fields?: string[]): ErrorBody {
  const error: ErrorBody['error'] = { code, message };
  if (fields && fields.length > 0) error.fields = fields;
  return { error };
}

/** 把任意异常规整为 ApiError；未知异常不泄露内部信息。 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof StrapiError || err instanceof LlmTransientError || err instanceof LlmPermanentError) {
    return upstreamFailed('上游服务调用失败');
  }
  return new ApiError('internal', '服务内部错误');
}

export const apiErrorHandler: ErrorHandler = (err, c) => {
  const e = toApiError(err);
  if (e.code === 'internal' || (e.code === 'upstream_failed' && !(err instanceof ApiError))) {
    logger.error(e.code === 'internal' ? 'unhandled error' : 'upstream call failed', undefined, {
      method: c.req.method,
      path: c.req.path,
      ...errorFields(err),
    });
  }
  if (e.retryAfterMs !== undefined) {
    c.header('Retry-After', String(Math.max(1, Math.ceil(e.retryAfterMs / 1000))));
  }
  return c.json(errorBody(e.code, e.message, e.fields), e.status);
};

export const apiNotFoundHandler: NotFoundHandler = (c) =>
  c.json(errorBody('not_found', '路径不存在'), 404);

/** 读取并用 zod 校验 JSON 请求体；失败抛 400（fields 为无效字段路径）。 */
export async function parseJsonBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw invalidArgument('请求体不是合法的 JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(body)'))];
    throw invalidArgument('请求参数无效', fields);
  }
  return parsed.data;
}

/** 中间件所需的最小依赖，便于路由任务与测试复用。 */
export interface MiddlewareDeps {
  config: { corsOrigins: readonly string[]; trustProxy: boolean; secrets: { sessionSecret: string } };
  clock: Pick<Clock, 'now'>;
  /** 来源地址维度的公开接口限流器（60 次/分钟）。 */
  publicLimiter: Pick<SlidingWindowLimiter, 'tryAcquire'>;
}

export type AppEnv = { Variables: { session: SessionPayload; sourceAddress: string } };

/** 解析来源地址（遵循 STUDIO_TRUST_PROXY）。 */
export function sourceAddressOf(c: Context, trustProxy: boolean): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return resolveSourceAddress({
    trustProxy,
    forwardedFor: c.req.header('x-forwarded-for'),
    remoteAddress: env?.incoming?.socket?.remoteAddress,
  });
}

/** CORS：精确匹配；OPTIONS 预检直接 204，不进入认证与路由。 */
export function corsMiddleware(deps: Pick<MiddlewareDeps, 'config'>): MiddlewareHandler {
  return async (c, next) => {
    const headers = corsHeadersFor(c.req.header('origin'), deps.config.corsOrigins);
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    await next();
  };
}

/** Owner 鉴权：先验证会话，失败 401，此前不触发任何 Backend 或 LLM 调用。 */
export function requireOwner(deps: Pick<MiddlewareDeps, 'config' | 'clock'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m) throw unauthorized();
    const result = verifySession(deps.config.secrets.sessionSecret, m[1], deps.clock.now());
    if (!result.ok) throw unauthorized();
    c.set('session', result.payload);
    await next();
  };
}

/** 公开接口按来源地址限流（需求 12.9 相关的放大防护）：超限 429 + Retry-After。 */
export function publicRateLimit(deps: MiddlewareDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const address = sourceAddressOf(c, deps.config.trustProxy);
    c.set('sourceAddress', address);
    const r = deps.publicLimiter.tryAcquire(address, deps.clock.now());
    if (!r.allowed) throw rateLimited('请求过于频繁，请稍后再试', r.retryAfterMs);
    await next();
  };
}
