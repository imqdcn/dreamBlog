/**
 * 参数守卫：拒绝工具参数中出现 URL、Backend 主机名、Bearer 凭证或密钥取值。
 * 只返回命中的规则名，绝不返回命中的值。
 */

export type GuardRule =
  | 'url_scheme'
  | 'protocol_relative_host'
  | 'backend_host'
  | 'bearer_credential'
  | 'secret_value';

export interface GuardOptions {
  backendUrl: string;
  secrets: readonly string[];
}

const SCHEME_RE = /[a-z][a-z0-9+.-]*:\/\//i;
const PROTOCOL_RELATIVE_RE = /^\s*\/\/[^\s/]/;
const BEARER_RE = /Bearer\s+\S+/i;

function backendHostname(backendUrl: string): string {
  try {
    return new URL(backendUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function checkString(s: string, host: string, secrets: readonly string[]): GuardRule | null {
  if (SCHEME_RE.test(s)) return 'url_scheme';
  if (PROTOCOL_RELATIVE_RE.test(s)) return 'protocol_relative_host';
  if (host !== '' && s.toLowerCase().includes(host)) return 'backend_host';
  if (BEARER_RE.test(s)) return 'bearer_credential';
  for (const secret of secrets) {
    if (secret.length >= 1 && s.includes(secret)) return 'secret_value';
  }
  return null;
}

/** 递归检查 args 中所有字符串值；命中返回规则名，否则返回 null。 */
export function guardArgs(args: unknown, opts: GuardOptions): GuardRule | null {
  const host = backendHostname(opts.backendUrl);
  const seen = new WeakSet<object>();

  const walk = (v: unknown): GuardRule | null => {
    if (typeof v === 'string') return checkString(v, host, opts.secrets);
    if (v === null || typeof v !== 'object') return null;
    if (seen.has(v)) return null;
    seen.add(v);
    const items = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    for (const item of items) {
      const hit = walk(item);
      if (hit) return hit;
    }
    return null;
  };

  return walk(args);
}
