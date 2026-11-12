/**
 * 滑动窗口限流（需求 12.9）。纯逻辑，时钟由调用方注入。
 * 只保存「已接受」请求的时间戳；被拒绝的请求不占用名额。
 */
export type AcquireResult = { allowed: true } | { allowed: false; retryAfterMs: number };

export class SlidingWindowLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly entries = new Map<string, number[]>();

  constructor(opts: { limit: number; windowMs: number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
  }

  tryAcquire(key: string, now: number): AcquireResult {
    const stamps = (this.entries.get(key) ?? []).filter((t) => now - t < this.windowMs);

    if (stamps.length >= this.limit) {
      // 最早能释放名额的时间戳：其过期后剩余数降到 limit - 1
      const pivot = stamps[stamps.length - this.limit];
      const retryAfterMs =
        pivot === undefined ? this.windowMs : Math.max(1, pivot + this.windowMs - now);
      if (stamps.length === 0) this.entries.delete(key);
      else this.entries.set(key, stamps);
      return { allowed: false, retryAfterMs };
    }

    stamps.push(now);
    this.entries.set(key, stamps);
    return { allowed: true };
  }

  /** 清扫：剔除过期时间戳并删除空项，防止 key 轮换撑大内存。 */
  sweep(now: number): void {
    for (const [key, stamps] of this.entries) {
      const kept = stamps.filter((t) => now - t < this.windowMs);
      if (kept.length === 0) this.entries.delete(key);
      else if (kept.length !== stamps.length) this.entries.set(key, kept);
    }
  }

  /** 当前保存的 key 数量（便于测试与监控）。 */
  size(): number {
    return this.entries.size;
  }
}
