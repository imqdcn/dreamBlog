import { describe, it, expect } from 'vitest';
import {
  countEmotions,
  countKeywords,
  countByDay,
  emotionTrend,
  dreamDateKey,
} from './aggregate';
import type { Dream } from '../types/dream';

function d(partial: Partial<Dream>): Dream {
  return { id: Math.random(), rawContent: 'x', ...partial };
}

describe('countEmotions', () => {
  it('按情绪计数并降序', () => {
    const r = countEmotions([
      d({ emotion: 'joyful' }),
      d({ emotion: 'joyful' }),
      d({ emotion: 'sad' }),
      d({ emotion: undefined }),
    ]);
    expect(r).toEqual([
      { emotion: 'joyful', count: 2 },
      { emotion: 'sad', count: 1 },
    ]);
  });

  it('空输入返回空数组', () => {
    expect(countEmotions([])).toEqual([]);
  });
});

describe('countKeywords', () => {
  it('汇总词频并降序', () => {
    const r = countKeywords([
      d({ keywords: ['海', '鲸鱼'] }),
      d({ keywords: ['海', '天空'] }),
      d({ keywords: ['海'] }),
    ]);
    expect(r[0]).toEqual({ name: '海', value: 3 });
    expect(r).toHaveLength(3);
  });

  it('忽略空白关键词', () => {
    const r = countKeywords([d({ keywords: ['  ', '梦'] })]);
    expect(r).toEqual([{ name: '梦', value: 1 }]);
  });

  it('尊重 limit', () => {
    const dreams = Array.from({ length: 10 }, (_, i) => d({ keywords: [`k${i}`] }));
    expect(countKeywords(dreams, 3)).toHaveLength(3);
  });
});

describe('dreamDateKey', () => {
  it('优先 dreamedAt', () => {
    expect(dreamDateKey(d({ dreamedAt: '2026-11-06T05:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z' }))).toBe(
      dreamDateKey(d({ dreamedAt: '2026-11-06T05:00:00.000Z' }))
    );
  });

  it('dreamedAt 缺失时回退 createdAt', () => {
    const key = dreamDateKey(d({ createdAt: '2026-01-02T10:00:00.000Z' }));
    expect(key).toBe('2026-01-02');
  });

  it('无有效日期返回 null', () => {
    expect(dreamDateKey(d({}))).toBeNull();
    expect(dreamDateKey(d({ dreamedAt: 'not-a-date' }))).toBeNull();
  });
});

describe('countByDay', () => {
  // 说明：dreamDateKey 按「本地时间」归日（符合用户日历视角），
  // 故测试用本地时间字符串（不带 Z）以避免时区翻日的歧义。
  it('按日分组计数并按日期升序', () => {
    const r = countByDay([
      d({ dreamedAt: '2026-11-06T09:00:00' }),
      d({ dreamedAt: '2026-11-06T20:00:00' }),
      d({ dreamedAt: '2026-11-05T09:00:00' }),
    ]);
    expect(r[0][0] < r[1][0]).toBe(true);
    const nov6 = r.find(([day]) => day === '2026-11-06');
    expect(nov6?.[1]).toBe(2);
  });
});

describe('emotionTrend', () => {
  it('按日聚合平均情绪分', () => {
    const r = emotionTrend([
      d({ dreamedAt: '2026-11-06T09:00:00', emotionScore: 0.4 }),
      d({ dreamedAt: '2026-11-06T20:00:00', emotionScore: 0.8 }),
      d({ dreamedAt: '2026-11-05T09:00:00', emotionScore: -0.5 }),
    ]);
    const nov6 = r.find(([day]) => day === '2026-11-06');
    expect(nov6?.[1]).toBeCloseTo(0.6, 3);
  });

  it('忽略无 emotionScore 的记录', () => {
    const r = emotionTrend([d({ dreamedAt: '2026-11-06T09:00:00' })]);
    expect(r).toEqual([]);
  });
});
