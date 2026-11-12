/** 参数规范化与重复调用检测（设计 7.8，需求 10.5、10.6）。纯逻辑，无副作用。 */

/** 对象键排序；字符串 trim；丢弃 undefined；递归。数组顺序保留。 */
export function canonicalize(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map((v) => {
      const c = canonicalize(v);
      // JSON 中数组内 undefined 会变成 null；这里显式保持该语义
      return c === undefined ? null : c;
    });
  }
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      const v = src[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function callKey(name: string, args: unknown): string {
  const canonical = canonicalize(args);
  return `${name}\u0000${JSON.stringify(canonical === undefined ? null : canonical)}`;
}

/** 累计 Run 内所有发起过的调用（无论成功、失败或被拒绝）。 */
export class RepeatTracker {
  private readonly counts = new Map<string, number>();

  record(name: string, args: unknown): { count: number; isThird: boolean } {
    const key = callKey(name, args);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { count, isThird: count === 3 };
  }
}
