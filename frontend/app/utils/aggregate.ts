import type { Dream, DreamEmotion } from '../types/dream';

/** 情绪计数：统计每种情绪出现的次数 */
export function countEmotions(dreams: Dream[]): Array<{ emotion: DreamEmotion; count: number }> {
  const map = new Map<DreamEmotion, number>();
  for (const d of dreams) {
    if (!d.emotion) continue;
    map.set(d.emotion, (map.get(d.emotion) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([emotion, count]) => ({ emotion, count }))
    .sort((a, b) => b.count - a.count);
}

/** 关键词词频：汇总所有梦境的关键词并计数 */
export function countKeywords(
  dreams: Dream[],
  limit = 60
): Array<{ name: string; value: number }> {
  const map = new Map<string, number>();
  for (const d of dreams) {
    for (const k of d.keywords ?? []) {
      const key = k.trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** 取梦境的归属日期（优先 dreamedAt，回退 createdAt），返回 YYYY-MM-DD；无有效日期返回 null */
export function dreamDateKey(d: Dream): string | null {
  const raw = d.dreamedAt || d.createdAt;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 按日分组计数：用于日历热力图，返回 [日期, 次数] 数组 */
export function countByDay(dreams: Dream[]): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const d of dreams) {
    const key = dreamDateKey(d);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * 情绪趋势：按日期聚合平均情绪分（emotionScore）。
 * 返回按日期升序的 [日期, 平均分] 数组，便于折线图。
 */
export function emotionTrend(dreams: Dream[]): Array<[string, number]> {
  const sum = new Map<string, { total: number; n: number }>();
  for (const d of dreams) {
    if (typeof d.emotionScore !== 'number') continue;
    const key = dreamDateKey(d);
    if (!key) continue;
    const cur = sum.get(key) ?? { total: 0, n: 0 };
    cur.total += d.emotionScore;
    cur.n += 1;
    sum.set(key, cur);
  }
  return [...sum.entries()]
    .map(([date, { total, n }]) => [date, Number((total / n).toFixed(3))] as [string, number])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
