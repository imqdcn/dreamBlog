/** find_similar_dreams 工具（设计 7.5，需求 9.5、9.10）：按相似度找出与指定梦境相近的其他梦境。 */

import { z } from 'zod';
import { similarity, type SimilarityFn } from '../../domain/similarity.js';
import type { DreamEmotion } from '../../domain/types.js';
import { documentIdString, type AgentTool } from './common.js';

export const findSimilarDreamsSchema = z
  .object({
    documentId: documentIdString.describe('作为参照的梦境 documentId'),
    limit: z.number().int().min(1).max(10).default(5).describe('返回条数 1–10，默认 5'),
  })
  .strict();

type Args = { documentId: string; limit: number };

export interface SimilarDreamItem {
  documentId: string;
  title: string | null;
  summary: string | null;
  emotion: DreamEmotion | null;
  dreamedAt: string | null;
  keywords: string[];
  score: number;
}

/** similarityFn 可替换（如将来的嵌入实现），默认使用 domain/similarity。 */
export function createFindSimilarDreamsTool(
  similarityFn: SimilarityFn = similarity,
): AgentTool<Args, SimilarDreamItem[]> {
  return {
    name: 'find_similar_dreams',
    description: '根据关键词、标签与情绪，找出与指定 documentId 的梦境最相似的其他梦境，按相似度从高到低返回，不含其自身。',
    schema: findSimilarDreamsSchema as AgentTool<Args, SimilarDreamItem[]>['schema'],
    run({ documentId, limit }, ctx) {
      const target = ctx.dreams.find((d) => d.documentId === documentId);
      if (!target) {
        return { ok: false, error: { code: 'not_found', message: `未找到梦境：${documentId}` } };
      }
      const data = ctx.dreams
        .filter((d) => d.documentId !== documentId)
        .map((d) => ({ d, score: similarityFn(target, d) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || (a.d.documentId < b.d.documentId ? -1 : a.d.documentId > b.d.documentId ? 1 : 0))
        .slice(0, limit)
        .map(({ d, score }): SimilarDreamItem => ({
          documentId: d.documentId,
          title: d.title ?? null,
          summary: d.summary ?? null,
          emotion: d.emotion ?? null,
          dreamedAt: d.dreamedAt ?? null,
          keywords: d.keywords ?? [],
          score,
        }));
      return data.length === 0 ? { ok: true, data, empty: true } : { ok: true, data };
    },
  };
}

export const findSimilarDreamsTool = createFindSimilarDreamsTool();
