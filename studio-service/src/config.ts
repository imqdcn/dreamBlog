/**
 * Studio_Service 配置加载（需求 1.3、1.5）。
 * 错误信息只含变量名与原因，不含任何取值。
 */

export type ConfigIssueReason = 'missing' | 'too_short';

export class ConfigError extends Error {
  /** 全部不满足要求的变量名 */
  readonly missing: string[];
  /** 变量名 -> 原因 */
  readonly reasons: Record<string, ConfigIssueReason>;

  constructor(reasons: Record<string, ConfigIssueReason>) {
    const names = Object.keys(reasons);
    const detail = names
      .map((n) => `${n}（${reasons[n] === 'missing' ? '缺失' : '长度不足'}）`)
      .join(', ');
    super(`缺少必需的环境变量或取值不合规：${detail}`);
    this.name = 'ConfigError';
    this.missing = names;
    this.reasons = reasons;
  }
}

export interface StudioConfig {
  port: number;
  strapiUrl: string;
  secrets: {
    strapiToken: string;
    llmApiKey: string;
    ownerPassphrase: string;
    sessionSecret: string;
  };
  llm: { baseUrl: string; model: string; priceInPerM: number; priceOutPerM: number };
  corsOrigins: string[];
  trustProxy: boolean;
  agent: { maxSteps: number; contextBudget: number; tokenBudget: 60000; loopTimeoutMs: 120000 };
  timezone: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const MIN_SECRET_LENGTH = 12;

const REQUIRED = [
  'STUDIO_STRAPI_TOKEN',
  'STUDIO_LLM_API_KEY',
  'STUDIO_OWNER_PASSPHRASE',
  'STUDIO_SESSION_SECRET',
] as const;

const MIN_LENGTH: Record<string, number> = {
  STUDIO_OWNER_PASSPHRASE: MIN_SECRET_LENGTH,
  STUDIO_SESSION_SECRET: MIN_SECRET_LENGTH,
};

type Env = Record<string, string | undefined>;

function str(env: Env, key: string, def: string): string {
  const v = env[key]?.trim();
  return v ? v : def;
}

function num(env: Env, key: string, def: number, opts: { int?: boolean; min?: number } = {}): number {
  const raw = env[key]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  if (opts.int && !Number.isInteger(n)) return def;
  if (opts.min !== undefined && n < opts.min) return def;
  return n;
}

export function loadConfig(env: Env): StudioConfig {
  const reasons: Record<string, ConfigIssueReason> = {};
  for (const name of REQUIRED) {
    const v = env[name];
    if (v === undefined || v.trim() === '') {
      reasons[name] = 'missing';
    } else if (name in MIN_LENGTH && v.length < MIN_LENGTH[name]) {
      reasons[name] = 'too_short';
    }
  }
  if (Object.keys(reasons).length > 0) throw new ConfigError(reasons);

  const level = str(env, 'LOG_LEVEL', 'info').toLowerCase();
  const logLevel = (['debug', 'info', 'warn', 'error'] as const).find((l) => l === level) ?? 'info';

  const config: StudioConfig = {
    port: num(env, 'STUDIO_PORT', 8787, { int: true, min: 0 }),
    strapiUrl: str(env, 'STUDIO_STRAPI_URL', 'http://localhost:1337').replace(/\/+$/, ''),
    secrets: Object.freeze({
      strapiToken: env.STUDIO_STRAPI_TOKEN as string,
      llmApiKey: env.STUDIO_LLM_API_KEY as string,
      ownerPassphrase: env.STUDIO_OWNER_PASSPHRASE as string,
      sessionSecret: env.STUDIO_SESSION_SECRET as string,
    }),
    llm: Object.freeze({
      baseUrl: str(env, 'STUDIO_LLM_BASE_URL', 'https://api.openai.com/v1'),
      model: str(env, 'STUDIO_LLM_MODEL', 'gpt-4o-mini'),
      priceInPerM: num(env, 'STUDIO_LLM_PRICE_INPUT_PER_M', 0, { min: 0 }),
      priceOutPerM: num(env, 'STUDIO_LLM_PRICE_OUTPUT_PER_M', 0, { min: 0 }),
    }),
    corsOrigins: Object.freeze(
      (env.CORS_ORIGIN ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ) as string[],
    trustProxy: str(env, 'STUDIO_TRUST_PROXY', 'false').toLowerCase() === 'true',
    agent: Object.freeze({
      maxSteps: num(env, 'STUDIO_MAX_STEPS', 8, { int: true, min: 1 }),
      contextBudget: num(env, 'STUDIO_CONTEXT_BUDGET', 12000, { int: true, min: 1 }),
      tokenBudget: 60000 as const,
      loopTimeoutMs: 120000 as const,
    }),
    timezone: str(env, 'TZ', 'Asia/Shanghai'),
    logLevel,
  };
  return Object.freeze(config);
}
