/** 工具结果限长（设计 7.5，需求 9.12）。 */

import type { ToolResult } from './types.js';

export const MAX_RESULT_CHARS = 3000;

const size = (v: unknown): number => JSON.stringify(v).length;

/** 在 [0, hi] 内二分查找满足 fits 的最大值；fits 对 0 视为恒成立的下界探测，返回 -1 表示 0 也放不下。 */
function largestFit(hi: number, fits: (n: number) => boolean): number {
  if (!fits(0)) return -1;
  let lo = 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function limitResult(result: ToolResult, maxChars: number = MAX_RESULT_CHARS): ToolResult {
  const full = JSON.stringify(result);
  if (full.length <= maxChars) return result;

  if (!result.ok) {
    // 错误信封：截断 message 以满足长度上限
    const build = (n: number): ToolResult => ({
      ok: false,
      error: { ...result.error, message: result.error.message.slice(0, n) },
    });
    const n = largestFit(result.error.message.length, (k) => size(build(k)) <= maxChars);
    if (n >= 0) return build(n);
    return { ok: false, error: { code: 'internal', message: '' } };
  }

  // 列表型 data：保留最大前缀
  if (Array.isArray(result.data) && result.data.length > 0) {
    const list = result.data;
    const build = (k: number): ToolResult => ({
      ...result,
      data: list.slice(0, k),
      truncated: true,
      omitted: list.length - k,
    });
    const k = largestFit(list.length, (n) => size(build(n)) <= maxChars);
    if (k >= 1) return build(k);
  }

  // 退化：序列化文本前缀
  const text = JSON.stringify(result.data) ?? '';
  const build = (n: number): ToolResult => ({
    ok: true,
    data: { truncated: true, partial: text.slice(0, n) },
  });
  const n = largestFit(text.length, (k) => size(build(k)) <= maxChars);
  return build(Math.max(n, 0));
}
