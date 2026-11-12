import { redactSecrets } from './agent/redact.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel: Level = 'info';
let secrets: string[] = [];

export function setLogLevel(level: Level): void {
  currentLevel = level;
}

/** 初始化时登记密钥取值（口令、会话密钥、LLM Key、Backend Token），此后所有日志先脱敏再序列化。 */
export function registerSecrets(values: readonly string[]): void {
  secrets = values.filter((v) => typeof v === 'string' && v.length > 0);
}

/** 递归脱敏所有字符串（含对象键），在序列化之前执行。 */
function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSecrets(value, secrets);
  if (value instanceof Error) return redactSecrets(value.message, secrets);
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[redactSecrets(k, secrets)] = scrub(v, depth + 1);
  return out;
}

function write(level: Level, msg: string, runId?: string, extra?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[currentLevel]) return;
  const record: Record<string, unknown> = {
    ...((scrub(extra ?? {}) as Record<string, unknown>) ?? {}),
    ts: new Date().toISOString(),
    level,
    ...(runId !== undefined ? { runId: scrub(runId) } : {}),
    msg: redactSecrets(String(msg), secrets),
  };
  const line = JSON.stringify(record);
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(line);
}

/** 把异常整理为可记录的字段（名称、消息、HTTP 状态、底层原因）；输出前仍会统一脱敏。 */
export function errorFields(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { error: String(err) };
  const out: Record<string, unknown> = { errorName: err.name, error: err.message };
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number') out.status = status;
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) {
    out.cause =
      cause instanceof Error
        ? `${cause.name}: ${(cause as { code?: string }).code ?? cause.message}`
        : String(cause);
  }
  return out;
}

export const logger = {
  debug: (msg: string, runId?: string, extra?: Record<string, unknown>) => write('debug', msg, runId, extra),
  info: (msg: string, runId?: string, extra?: Record<string, unknown>) => write('info', msg, runId, extra),
  warn: (msg: string, runId?: string, extra?: Record<string, unknown>) => write('warn', msg, runId, extra),
  error: (msg: string, runId?: string, extra?: Record<string, unknown>) => write('error', msg, runId, extra),
};
