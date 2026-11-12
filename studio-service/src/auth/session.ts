import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** 载荷时间单位为秒。 */
export interface SessionPayload {
  v: 1;
  sid: string;
  iat: number;
  exp: number;
}

export type VerifyResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export const SESSION_TTL_SEC = 12 * 3600;

const B64URL = /^[A-Za-z0-9_-]+$/;

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data, 'utf8').digest();
}

/**
 * 签发会话令牌：`base64url(payload).base64url(hmac)`。
 * `now` 为毫秒时间戳（与 clock.now() 一致），载荷中的 iat/exp 为秒。
 */
export function signSession(
  secret: string,
  now: number,
  ttlSec: number = SESSION_TTL_SEC,
): { token: string; payload: SessionPayload } {
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = { v: 1, sid: randomUUID(), iat, exp: iat + ttlSec };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = hmac(secret, body).toString('base64url');
  return { token: `${body}.${sig}`, payload };
}

function parsePayload(body: string): SessionPayload | null {
  try {
    const obj: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof obj !== 'object' || obj === null) return null;
    const p = obj as Record<string, unknown>;
    if (
      p.v !== 1 ||
      typeof p.sid !== 'string' ||
      p.sid.length === 0 ||
      typeof p.iat !== 'number' ||
      typeof p.exp !== 'number' ||
      !Number.isFinite(p.iat) ||
      !Number.isFinite(p.exp)
    ) {
      return null;
    }
    return { v: 1, sid: p.sid, iat: p.iat, exp: p.exp };
  } catch {
    return null;
  }
}

/** 验证顺序：格式 → 签名 → 过期。`now` 为毫秒时间戳；`now/1000 >= exp` 视为过期。 */
export function verifySession(secret: string, token: string, now: number): VerifyResult {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  if (!B64URL.test(body) || !B64URL.test(sig)) return { ok: false, reason: 'malformed' };
  const payload = parsePayload(body);
  if (!payload) return { ok: false, reason: 'malformed' };

  const expected = hmac(secret, body);
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  // base64url 末位冗余比特可使不同字符串解码为同一字节；要求规范编码以保证“任意单字符改动都失败”。
  if (actual.toString('base64url') !== sig) return { ok: false, reason: 'bad_signature' };

  if (Math.floor(now / 1000) >= payload.exp) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
