import { logger } from './logger.js';

/** LLM 加工结果：梦境的结构化字段 */
export interface DreamEnrichment {
  title: string;
  summary: string;
  keywords: string[];
  emotion: DreamEmotion;
  emotionScore: number;
  clarity?: number;
}

/** 与 backend dream schema 的 emotion 枚举保持一致 */
export type DreamEmotion =
  | 'joyful'
  | 'peaceful'
  | 'neutral'
  | 'anxious'
  | 'fearful'
  | 'sad'
  | 'bizarre';

const VALID_EMOTIONS: DreamEmotion[] = [
  'joyful',
  'peaceful',
  'neutral',
  'anxious',
  'fearful',
  'sad',
  'bizarre',
];

export interface LlmProcessorOptions {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** 请求超时毫秒 */
  timeoutMs?: number;
  /** 网络/超时/5xx 的重试次数（不含首次） */
  maxRetries?: number;
  /** 重试基准延迟（毫秒） */
  retryBaseDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 内部：标记「可重试」的瞬时错误（网络/超时/5xx） */
class TransientLlmError extends Error {}

/** 内部：标记「不可重试」的错误（4xx / 非法 JSON / 缺字段）——重试无意义 */
class PermanentLlmError extends Error {}

const SYSTEM_PROMPT = `你是一个梦境分析助手。用户会口述一段梦境，你需要提炼结构化信息。
请只返回一个 JSON 对象，不要包含任何额外文字或 markdown 代码块，字段如下：
- title: 字符串，为这段梦境起一个简短、有意象感的标题（不超过 20 字）
- summary: 字符串，用第三人称概括梦境内容（不超过 80 字）
- keywords: 字符串数组，3~6 个关键词（意象、人物、场景等）
- emotion: 字符串，必须是以下之一：joyful（愉悦）, peaceful（平静）, neutral（中性）, anxious（焦虑）, fearful（恐惧）, sad（悲伤）, bizarre（离奇）
- emotionScore: 数字，-1 到 1 之间，-1 最消极，1 最积极
- clarity: 整数，1 到 5，表示梦境叙述的清晰程度（1 模糊，5 清晰）`;

/**
 * 梦境 LLM 加工器。调用 OpenAI 兼容的 Chat Completions 接口，
 * 要求模型返回结构化 JSON，并做严格校验与降级。
 *
 * 任何加工失败都不应阻断保存：调用方应在失败时仍保存 rawContent。
 */
export class LlmProcessor {
  private readonly opts: Required<Omit<LlmProcessorOptions, 'fetchImpl'>> & {
    fetchImpl: typeof fetch;
  };

  constructor(opts: LlmProcessorOptions) {
    this.opts = {
      enabled: opts.enabled,
      baseUrl: opts.baseUrl.replace(/\/$/, ''),
      apiKey: opts.apiKey,
      model: opts.model,
      timeoutMs: opts.timeoutMs ?? 30000,
      maxRetries: opts.maxRetries ?? 2,
      retryBaseDelayMs: opts.retryBaseDelayMs ?? 1000,
      fetchImpl: opts.fetchImpl ?? fetch,
    };
  }

  get enabled(): boolean {
    return this.opts.enabled;
  }

  /**
   * 对梦境文本做加工。
   * @returns 成功返回 DreamEnrichment；失败或未启用返回 null（调用方降级保存原文）。
   */
  async enrich(rawContent: string): Promise<DreamEnrichment | null> {
    if (!this.opts.enabled) {
      logger.info('LLM 加工未启用，跳过加工，仅保存原文');
      return null;
    }

    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt += 1) {
      try {
        return await this.attemptOnce(rawContent);
      } catch (err) {
        // 永久性错误（4xx / 非法 JSON / 缺字段）：重试无意义，直接降级
        if (err instanceof PermanentLlmError) {
          logger.error('LLM 加工失败（不可重试）：', err.message);
          return null;
        }
        // 瞬时错误（网络/超时/5xx）：还有重试额度则退避后再试
        const msg = (err as Error).message;
        if (attempt < this.opts.maxRetries) {
          const delay = this.opts.retryBaseDelayMs * 2 ** attempt;
          logger.warn(
            `LLM 加工瞬时失败（第 ${attempt + 1} 次），${delay}ms 后重试：${msg}`
          );
          await sleep(delay);
        } else {
          logger.error(`LLM 加工最终失败（已重试 ${this.opts.maxRetries} 次）：${msg}`);
          return null;
        }
      }
    }
    return null;
  }

  /** 单次请求：成功返回加工结果；失败抛出 Transient/Permanent 错误供外层决定是否重试。 */
  private async attemptOnce(rawContent: string): Promise<DreamEnrichment> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    let res: Response;
    try {
      res = await this.opts.fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          model: this.opts.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: rawContent },
          ],
          temperature: 0.5,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      // fetch failed / 超时 abort 都归为瞬时错误，可重试
      throw new TransientLlmError((err as Error).message || 'fetch failed');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const detail = `LLM 请求返回 ${res.status}：${text.slice(0, 300)}`;
      // 5xx 可重试；4xx（鉴权/模型名/参数）不可重试
      if (res.status >= 500) {
        throw new TransientLlmError(detail);
      }
      throw new PermanentLlmError(detail);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new PermanentLlmError('LLM 响应缺少 content');
    }

    const parsed = this.parseAndValidate(content);
    if (!parsed) {
      throw new PermanentLlmError('LLM 返回内容无法解析为有效结果');
    }
    return parsed;
  }

  /** 解析并校验 LLM 返回的 JSON，非法时返回 null */
  parseAndValidate(content: string): DreamEnrichment | null {
    let obj: Record<string, unknown>;
    try {
      // 容错：剥离可能的 markdown 代码块围栏
      const cleaned = content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');
      obj = JSON.parse(cleaned);
    } catch (e) {
      logger.error('LLM 返回非法 JSON：', content.slice(0, 200));
      return null;
    }

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

    if (!title && !summary && keywords.length === 0) {
      logger.error('LLM 返回内容缺少有效字段');
      return null;
    }

    return { title, summary, keywords, emotion, emotionScore, clarity };
  }
}
