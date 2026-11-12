/** emotion_trend 工具（设计 7.5，需求 9.4）：按粒度统计区间内情绪趋势。 */
import { z } from 'zod';
import { dreamDateKey } from '../../domain/dates.js';
import { emotionTrend, type TrendPoint } from '../../domain/stats.js';
import { DEFAULT_TIMEZONE } from '../prompt.js';
import { dateString, withDateRange, type AgentTool } from './common.js';

const schema = withDateRange(
  z
    .object({
      dateFrom: dateString.describe('起始日期 YYYY-MM-DD（含）'),
      dateTo: dateString.describe('结束日期 YYYY-MM-DD（含），不得早于 dateFrom'),
      granularity: z.enum(['day', 'week', 'month']).default('week').describe('分桶粒度，默认 week'),
    })
    .strict(),
);

type Args = { dateFrom: string; dateTo: string; granularity: 'day' | 'week' | 'month' };

export const emotionTrendTool: AgentTool<Args, TrendPoint[]> = {
  name: 'emotion_trend',
  description: '按天、周或月统计指定日期区间内梦境的平均情绪分数、数量与主导情绪，结果按时间升序，无梦境的时间段不出现。',
  schema: schema as AgentTool<Args, TrendPoint[]>['schema'],
  run(args, ctx) {
    const tz = process.env.TZ || DEFAULT_TIMEZONE;
    const inRange = ctx.dreams.filter((d) => {
      const key = dreamDateKey(d, tz);
      return key !== null && key >= args.dateFrom && key <= args.dateTo;
    });
    const data = emotionTrend(inRange, args.granularity, tz);
    return data.length === 0 ? { ok: true, data, empty: true } : { ok: true, data };
  },
};
