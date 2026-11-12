import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_LEN = 1;
const MAX_LEN = 128;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * 常量时间口令校验。输入不是字符串或长度不在 1–128 时返回 false；
 * 否则对双方分别做 SHA-256，再用 timingSafeEqual 比较两个定长摘要。
 */
export function verifyPassphrase(input: unknown, expected: string): boolean {
  if (typeof input !== 'string') return false;
  if (input.length < MIN_LEN || input.length > MAX_LEN) return false;
  return timingSafeEqual(sha256(input), sha256(expected));
}
