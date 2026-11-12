/** search_dreams 工具（设计 7.5，需求 9.2、9.9）：按关键词/日期/情绪/标签搜索，仅返回摘要。 */

import { z } from 'zod';
import { searchDreams, type SearchHit } from '../../domain/search.js';
import { DEFAULT_TIMEZONE } from '../prompt.js';
import { boundedString, dateString, withDateRange, type AgentTool } from './common.js';

export const EMOTION_VALUES = ['joyful', 'peaceful', 'neutral', 'anxious', 'fearful', 'sad', 'bizarre'] as const;

export const searchDreamsSchema = withDateRange(
  z
    .object({
      query: boundedString(200).optional().describe('搜索词，可为空'),
      dateFrom: dateString.optional(),
      dateTo: dateString.optional(),
      emotion: z.enum(EMOTION_VALUES).optional(),
      tag: z.string().min(1).max(50).optional(),
      limit: z.number().int().min(1).max(20).default(10),
    })
    .strict(),
);

export type SearchDreamsArgs = z.output<typeof searchDreamsSchema>;

/** tz 用于把 Dream 折算为日期；ToolContext 不含时区，由装配处注入（默认 Asia/Shanghai）。 */
export function createSearchDreamsTool(tz: string = DEFAULT_TIMEZONE): AgentTool<SearchDreamsArgs, SearchHit[]> {
  return {
    name: 'search_dreams',
    description:
      '按关键词、日期范围、情绪或标签搜索梦境，返回按相关度排序的摘要列表。需要找出某类梦或某时间段的梦时使用。',
    schema: searchDreamsSchema as unknown as AgentTool<SearchDreamsArgs, SearchHit[]>['schema'],
    run(args, ctx) {
      const hits = searchDreams(
        ctx.dreams,
        {
          query: args.query,
          dateFrom: args.dateFrom,
          dateTo: args.dateTo,
          emotion: args.emotion,
          tag: args.tag,
        },
        tz,
      ).slice(0, args.limit);
      return hits.length === 0 ? { ok: true, data: [], empty: true } : { ok: true, data: hits };
    },
  };
}

export const searchDreamsTool = createSearchDreamsTool();
