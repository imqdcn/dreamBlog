import { dreamDateKey, monthStart, weekStart } from './dates.js';
import type { DreamRecord } from './types.js';

export type Granularity = 'day' | 'week' | 'month';

export interface TrendPoint {
  periodStart: string;
  avgEmotionScore: number | null;
  count: number;
  dominantEmotion: string | null;
}

export interface KeywordStat {
  keyword: string;
  count: number;
}

type TrendInput = Pick<DreamRecord, 'createdAt' | 'emotion' | 'emotionScore'> & {
  dreamedAt?: string | null;
};

function bucketStart(dateKey: string, g: Granularity): string {
  if (g === 'week') return weekStart(dateKey);
  if (g === 'month') return monthStart(dateKey);
  return dateKey;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 情绪趋势：按粒度分桶（周起点为周一，月起点为 1 日）。
 * 区间过滤由调用方完成；无法确定日期的 Dream 被忽略。
 */
export function emotionTrend(dreams: readonly TrendInput[], granularity: Granularity, tz: string): TrendPoint[] {
  const buckets = new Map<string, { count: number; sum: number; scored: number; emotions: Map<string, number> }>();
  for (const d of dreams) {
    const key = dreamDateKey(d, tz);
    if (!key) continue;
    const start = bucketStart(key, granularity);
    let b = buckets.get(start);
    if (!b) {
      b = { count: 0, sum: 0, scored: 0, emotions: new Map() };
      buckets.set(start, b);
    }
    b.count += 1;
    if (typeof d.emotionScore === 'number' && Number.isFinite(d.emotionScore)) {
      b.sum += d.emotionScore;
      b.scored += 1;
    }
    if (d.emotion) b.emotions.set(d.emotion, (b.emotions.get(d.emotion) ?? 0) + 1);
  }
  return [...buckets.keys()].sort(cmp).map((periodStart) => {
    const b = buckets.get(periodStart)!;
    let dominant: string | null = null;
    let best = 0;
    for (const [e, n] of b.emotions) {
      if (n > best || (n === best && dominant !== null && e < dominant)) {
        best = n;
        dominant = e;
      }
    }
    return {
      periodStart,
      avgEmotionScore: b.scored > 0 ? Math.round((b.sum / b.scored + Number.EPSILON) * 100) / 100 : null,
      count: b.count,
      dominantEmotion: dominant,
    };
  });
}

/** 关键词统计：trim 后计数，过滤空串；次数降序、同次数字典序升序 */
export function keywordStats(dreams: readonly Pick<DreamRecord, 'keywords'>[], limit?: number): KeywordStat[] {
  const counts = new Map<string, number>();
  for (const d of dreams) {
    for (const raw of d.keywords ?? []) {
      if (typeof raw !== 'string') continue;
      const k = raw.trim();
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const out = [...counts].map(([keyword, count]) => ({ keyword, count }));
  out.sort((a, b) => b.count - a.count || cmp(a.keyword, b.keyword));
  return limit === undefined ? out : out.slice(0, limit);
}
