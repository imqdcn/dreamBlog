/** keyword_stats 工具（设计 7.5，需求 9.6）：统计区间内关键词出现次数。 */
import { z } from 'zod';
import { dreamDateKey } from '../../domain/dates.js';
import { keywordStats, type KeywordStat } from '../../domain/stats.js';
import { DEFAULT_TIMEZONE } from '../prompt.js';
import { dateString, withDateRange, type AgentTool } from './common.js';

const schema = withDateRange(
  z
    .object({
      dateFrom: dateString.describe('起始日期 YYYY-MM-DD（含）'),
      dateTo: dateString.describe('结束日期 YYYY-MM-DD（含），不得早于 dateFrom'),
      limit: z.number().int().min(1).max(50).default(20).describe('返回条数 1–50，默认 20'),
    })
    .strict(),
);

type Args = { dateFrom: string; dateTo: string; limit: number };

export const keywordStatsTool: AgentTool<Args, KeywordStat[]> = {
  name: 'keyword_stats',
  description: '统计指定日期区间内梦境关键词的出现次数，按次数降序、同次数按关键词字典序升序返回。',
  schema: schema as AgentTool<Args, KeywordStat[]>['schema'],
  run(args, ctx) {
    const tz = process.env.TZ || DEFAULT_TIMEZONE;
    const inRange = ctx.dreams.filter((d) => {
      const key = dreamDateKey(d, tz);
      return key !== null && key >= args.dateFrom && key <= args.dateTo;
    });
    const data = keywordStats(inRange, args.limit);
    return data.length === 0 ? { ok: true, data, empty: true } : { ok: true, data };
  },
};
