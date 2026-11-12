import type { Dream } from '../types/dream';
import { dreamDateKey } from './aggregate';

export interface MonthCell {
  /** YYYY-MM-DD */
  date: string;
  /** 恒等于 dreams.length；为 0 时界面不应渲染数量标注 */
  count: number;
  dreams: Dream[];
}

/**
 * 构建某自然月的日历格：每天一格，按日期升序。
 * @param month 1-12
 * 日期归属复用 dreamDateKey（dreamedAt 优先，createdAt 回退，浏览器本地时区）。
 */
export function buildMonthGrid(dreams: Dream[], year: number, month: number): MonthCell[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const prefix = `${year}-${mm}-`;

  const buckets = new Map<string, Dream[]>();
  for (const d of dreams) {
    const key = dreamDateKey(d);
    if (!key || !key.startsWith(prefix)) continue;
    const list = buckets.get(key);
    if (list) list.push(d);
    else buckets.set(key, [d]);
  }

  const cells: MonthCell[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${prefix}${String(day).padStart(2, '0')}`;
    const list = buckets.get(date) ?? [];
    cells.push({ date, count: list.length, dreams: list });
  }
  return cells;
}
