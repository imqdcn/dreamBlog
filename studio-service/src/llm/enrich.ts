/**
 * 梦境加工（设计 4.1；需求 4.7、16.1）。
 *
 * 提示词与 parseAndValidate 规整规则复制自 mcp-server/src/llm-processor.ts（不修改 mcp-server），
 * 保持与 MCP_Server 相同的字段范围：title、summary、keywords、emotion、emotionScore、clarity。
 *
 * 重试策略由调用方（加工队列）决定；本模块只做一次 LLM 调用：
 * - 瞬时/永久 LLM 错误原样向上抛出（LlmTransientError | LlmPermanentError）
 * - 返回内容无法解析为有效结果时抛 LlmPermanentError
 */

import type { LlmClient } from '../agent/types.js';
import type { DreamEmotion } from '../domain/types.js';
import { LlmPermanentError } from './client.js';

export type { DreamEmotion };

/** LLM 加工结果：梦境的结构化字段 */
export interface DreamEnrichment {
  title: string;
  summary: string;
  keywords: string[];
  emotion: DreamEmotion;
  /** [-1, 1] */
  emotionScore: number;
  /** [1, 5] 整数；模型未给出数值时为 undefined */
  clarity?: number;
}

const VALID_EMOTIONS: readonly DreamEmotion[] = [
  'joyful',
  'peaceful',
  'neutral',
  'anxious',
  'fearful',
  'sad',
  'bizarre',
];

export const ENRICH_SYSTEM_PROMPT = `你是一个梦境分析助手。用户会口述一段梦境，你需要提炼结构化信息。
请只返回一个 JSON 对象，不要包含任何额外文字或 markdown 代码块，字段如下：
- title: 字符串，为这段梦境起一个简短、有意象感的标题（不超过 20 字）
- summary: 字符串，用第三人称概括梦境内容（不超过 80 字）
- keywords: 字符串数组，3~6 个关键词（意象、人物、场景等）
- emotion: 字符串，必须是以下之一：joyful（愉悦）, peaceful（平静）, neutral（中性）, anxious（焦虑）, fearful（恐惧）, sad（悲伤）, bizarre（离奇）
- emotionScore: 数字，-1 到 1 之间，-1 最消极，1 最积极
- clarity: 整数，1 到 5，表示梦境叙述的清晰程度（1 模糊，5 清晰）`;

/** 解析并校验 LLM 返回的 JSON，非法时返回 null（规则与 mcp-server 一致）。 */
export function parseAndValidate(content: string): DreamEnrichment | null {
  let obj: Record<string, unknown>;
  try {
    // 容错：剥离可能的 markdown 代码块围栏
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object') return null;

  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.filter((k): k is string => typeof k === 'string').map((k) => k.trim())
    : [];
  const emotion = VALID_EMOTIONS.includes(obj.emotion as DreamEmotion)
    ? (obj.emotion as DreamEmotion)
    : 'neutral';
  let emotionScore = typeof obj.emotionScore === 'number' ? obj.emotionScore : 0;
  emotionScore = Math.max(-1, Math.min(1, emotionScore));
  let clarity: number | undefined;
  if (typeof obj.clarity === 'number') {
    clarity = Math.max(1, Math.min(5, Math.round(obj.clarity)));
  }

  if (!title && !summary && keywords.length === 0) return null;

  return { title, summary, keywords, emotion, emotionScore, clarity };
}

/**
 * 对梦境原文做一次加工。
 * @throws LlmTransientError | LlmPermanentError（含无法解析的返回内容）
 */
export async function enrichDream(
  llm: LlmClient,
  rawContent: string,
  opts: { signal: AbortSignal },
): Promise<DreamEnrichment> {
  const res = await llm.chat(
    {
      messages: [
        { role: 'system', content: ENRICH_SYSTEM_PROMPT },
        { role: 'user', content: rawContent },
      ],
    },
    opts,
  );
  if (!res.content) throw new LlmPermanentError('LLM 响应缺少 content');
  const parsed = parseAndValidate(res.content);
  if (!parsed) throw new LlmPermanentError('LLM 返回内容无法解析为有效结果');
  return parsed;
}
