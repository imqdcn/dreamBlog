/**
 * 登录失败锁定状态机（需求 2.3、2.4）。
 * 按来源地址记录最近 10 分钟的失败；第 5 次失败锁定 15 分钟；
 * 锁定期内调用方不得比较口令，直接返回 429。
 */

export const FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const LOCK_DURATION_MS = 15 * 60 * 1000;
export const MAX_FAILURES = 5;
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export type LoginCheck = { locked: false } | { locked: true; retryAfterMs: number };

interface Entry {
  failures: number[];
  lockedUntil?: number;
}

export interface LoginGuardOptions {
  now?: () => number;
}

export class LoginGuard {
  private readonly now: () => number;
  private readonly table = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: LoginGuardOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  /** 登录前调用：锁定期内返回 locked（此时不应比较口令）。锁定结束则清零。 */
  check(address: string): LoginCheck {
    const entry = this.table.get(address);
    if (!entry || entry.lockedUntil === undefined) return { locked: false };
    const now = this.now();
    if (now >= entry.lockedUntil) {
      this.table.delete(address);
      return { locked: false };
    }
    return { locked: true, retryAfterMs: entry.lockedUntil - now };
  }

  /** 口令错误后调用；返回记录后的状态。 */
  recordFailure(address: string): LoginCheck {
    const status = this.check(address);
    if (status.locked) return status;
    const now = this.now();
    const entry = this.table.get(address) ?? { failures: [] };
    entry.failures = entry.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
    entry.failures.push(now);
    if (entry.failures.length >= MAX_FAILURES) {
      entry.lockedUntil = now + LOCK_DURATION_MS;
      this.table.set(address, entry);
      return { locked: true, retryAfterMs: LOCK_DURATION_MS };
    }
    this.table.set(address, entry);
    return { locked: false };
  }

  /** 登录成功后调用：清零失败计数。 */
  recordSuccess(address: string): void {
    this.table.delete(address);
  }

  /** 清除过期项：锁定已结束，或无窗口内失败。 */
  sweep(): void {
    const now = this.now();
    for (const [address, entry] of this.table) {
      if (entry.lockedUntil !== undefined) {
        if (now >= entry.lockedUntil) this.table.delete(address);
        continue;
      }
      if (!entry.failures.some((t) => now - t < FAILURE_WINDOW_MS)) {
        this.table.delete(address);
      }
    }
  }

  /** 启动每 5 分钟一次的清扫；不阻止进程退出。 */
  startSweeper(intervalMs: number = SWEEP_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), intervalMs);
    this.timer.unref?.();
  }

  stopSweeper(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 当前跟踪的地址数（测试/观测用）。 */
  get size(): number {
    return this.table.size;
  }
}

/**
 * 解析来源地址：trustProxy 为 true 时取 X-Forwarded-For 最左项，
 * 缺失或为空则回退到连接对端地址。
 */
export function resolveSourceAddress(opts: {
  trustProxy: boolean;
  forwardedFor?: string | null;
  remoteAddress?: string | null;
}): string {
  if (opts.trustProxy && opts.forwardedFor) {
    const first = opts.forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return opts.remoteAddress?.trim() || "unknown";
}
