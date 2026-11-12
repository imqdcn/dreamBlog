/** get_dream 工具（设计 7.5，需求 9.3、9.10）：按 documentId 读取单条梦境，原文超 2000 字符截断。 */

import { z } from 'zod';
import type { DreamEmotion } from '../../domain/types.js';
import { documentIdString, type AgentTool } from './common.js';

export const RAW_CONTENT_MAX = 2000;

export const getDreamSchema = z.object({ documentId: documentIdString }).strict();

export type GetDreamArgs = z.infer<typeof getDreamSchema>;

export interface GetDreamData {
  documentId: string;
  title: string | null;
  summary: string | null;
  keywords: string[];
  emotion: DreamEmotion | null;
  emotionScore: number | null;
  clarity: number | null;
  dreamedAt: string | null;
  tags: string[];
  rawContent: string;
  truncated: boolean;
  originalLength: number;
}

export const getDreamTool: AgentTool<GetDreamArgs, GetDreamData> = {
  name: 'get_dream',
  description: '按 documentId 读取单条梦境的完整信息，包括摘要、情绪、标签和原文（原文最多 2000 字符）。',
  schema: getDreamSchema,
  run({ documentId }, ctx) {
    const dream = ctx.dreams.find((d) => d.documentId === documentId);
    if (!dream) {
      return { ok: false, error: { code: 'not_found', message: `未找到梦境：${documentId}` } };
    }
    const raw = dream.rawContent ?? '';
    const truncated = raw.length > RAW_CONTENT_MAX;
    return {
      ok: true,
      data: {
        documentId: dream.documentId,
        title: dream.title ?? null,
        summary: dream.summary ?? null,
        keywords: dream.keywords ?? [],
        emotion: dream.emotion ?? null,
        emotionScore: dream.emotionScore ?? null,
        clarity: dream.clarity ?? null,
        dreamedAt: dream.dreamedAt ?? null,
        tags: dream.tags ?? [],
        rawContent: truncated ? raw.slice(0, RAW_CONTENT_MAX) : raw,
        truncated,
        originalLength: raw.length,
      },
    };
  },
};
