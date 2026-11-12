import type { DreamRecord } from './types.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

/** 是否为有效的 YYYY-MM-DD 日历日期（严格格式，拒绝 2024-02-30） */
export function isValidDateKey(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function parts(key: string): [number, number, number] {
  const m = DATE_RE.exec(key)!;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

/** 公历日期 -> 自 1970-01-01 起的天数（纯整数算术，不涉及 Date/时区） */
function toDays(key: string): number {
  let [y, m, d] = parts(key);
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDays(z: number): string {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** 日期加减天数 */
export function addDays(key: string, n: number): string {
  return fromDays(toDays(key) + n);
}

/** 星期几：1=周一 … 7=周日 */
export function isoWeekday(key: string): number {
  // 1970-01-01 是周四
  return ((((toDays(key) + 3) % 7) + 7) % 7) + 1;
}

/** 所在周的周一（周起点） */
export function weekStart(key: string): string {
  return addDays(key, -(isoWeekday(key) - 1));
}

/** 所在月的 1 日 */
export function monthStart(key: string): string {
  const [y, m] = parts(key);
  return `${pad(y, 4)}-${pad(m, 2)}-01`;
}

/** 月份键 YYYY-MM */
export function monthKey(key: string): string {
  return monthStart(key).slice(0, 7);
}

function dateKeyInZone(date: Date, tz: string): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function toKey(value: string | undefined, tz: string): string | null {
  if (!value) return null;
  if (DATE_RE.test(value)) return isValidDateKey(value) ? value : null;
  return dateKeyInZone(new Date(value), tz);
}

/**
 * Dream 的日期归属：dreamedAt 优先，createdAt 回退，按时区 tz 折算为 YYYY-MM-DD。
 * 纯日期字符串（YYYY-MM-DD）原样使用；两者都无法解析时返回 null。
 */
export function dreamDateKey(
  d: Pick<DreamRecord, 'createdAt'> & { dreamedAt?: string | null },
  tz: string,
): string | null {
  return toKey(d.dreamedAt ?? undefined, tz) ?? toKey(d.createdAt, tz);
}

export interface DateRangeResult {
  ok: boolean;
  reason?: 'invalid_from' | 'invalid_to' | 'from_after_to';
}

/** 两端都是有效日历日期且 from <= to（字符串比较对 YYYY-MM-DD 等价于日期比较） */
export function validateDateRange(from: unknown, to: unknown): DateRangeResult {
  if (!isValidDateKey(from)) return { ok: false, reason: 'invalid_from' };
  if (!isValidDateKey(to)) return { ok: false, reason: 'invalid_to' };
  if (from > to) return { ok: false, reason: 'from_after_to' };
  return { ok: true };
}
