import { createHash } from 'node:crypto';
import type { StoryStyle } from './types.js';

export const STORY_STYLES: readonly StoryStyle[] = ['gentle_fairytale', 'mystery', 'sci_fi', 'poetic'];
export const MIN_SOURCE_DREAMS = 1;
export const MAX_SOURCE_DREAMS = 5;
export const MAX_STORY_TITLE_LEN = 100;
export const MAX_STORY_CONTENT_LEN = 20000;

export interface StoryRequest {
  dreamIds: string[];
  style: StoryStyle;
}

export type StoryRequestResult =
  | { ok: true; value: StoryRequest }
  | { ok: false; reason: string };

export type ExistsFn = (documentId: string) => boolean | Promise<boolean>;

/**
 * 校验故事创建请求。任何一项失败都返回指明具体原因的错误（调用方映射为 400，且不得调用 LLM）。
 */
export async function validateStoryRequest(body: unknown, existsFn: ExistsFn): Promise<StoryRequestResult> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, reason: 'request body must be an object' };
  }
  const { dreamIds, style } = body as Record<string, unknown>;
  if (!Array.isArray(dreamIds)) return { ok: false, reason: 'dreamIds must be an array of strings' };
  if (dreamIds.length < MIN_SOURCE_DREAMS || dreamIds.length > MAX_SOURCE_DREAMS) {
    return { ok: false, reason: `dreamIds must contain ${MIN_SOURCE_DREAMS}-${MAX_SOURCE_DREAMS} items` };
  }
  for (let i = 0; i < dreamIds.length; i++) {
    if (typeof dreamIds[i] !== 'string') return { ok: false, reason: `dreamIds[${i}] must be a string` };
  }
  const ids = dreamIds as string[];
  if (new Set(ids).size !== ids.length) return { ok: false, reason: 'dreamIds must not contain duplicates' };
  if (typeof style !== 'string' || !(STORY_STYLES as readonly string[]).includes(style)) {
    return { ok: false, reason: `style must be one of: ${STORY_STYLES.join(', ')}` };
  }
  for (const id of ids) {
    if (!(await existsFn(id))) return { ok: false, reason: `dream not found: ${id}` };
  }
  return { ok: true, value: { dreamIds: [...ids], style: style as StoryStyle } };
}

/** 去重键：与 dreamIds 顺序无关。 */
export function dedupeKey(style: StoryStyle, dreamIds: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ style, ids: [...dreamIds].sort() }))
    .digest('hex');
}

/** 进行中的生成请求集合。 */
export class InFlightSet {
  private readonly keys = new Set<string>();

  has(key: string): boolean {
    return this.keys.has(key);
  }

  /** 已存在返回 false（冲突，调用方返回 409）；否则加入并返回 true。 */
  tryAcquire(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }

  release(key: string): void {
    this.keys.delete(key);
  }

  get size(): number {
    return this.keys.size;
  }

  /**
   * 获取键后执行 fn，finally 中释放。键已存在时返回 { conflict: true }，不执行 fn。
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<{ conflict: true } | { conflict: false; value: T }> {
    if (!this.tryAcquire(key)) return { conflict: true };
    try {
      return { conflict: false, value: await fn() };
    } finally {
      this.release(key);
    }
  }
}

function stripFences(text: string): string {
  const t = text.trim();
  const m = /^```[^\n`]*\n?([\s\S]*?)\n?```$/.exec(t);
  return (m ? m[1]! : t).trim();
}

/**
 * 解析 LLM 故事输出。title/content 必须为 trim 后非空字符串；
 * title 超过 100 字符截取前 100；content 超过 20000 视为失败。无法满足返回 null。
 */
export function parseStoryOutput(text: string): { title: string; content: string } | null {
  if (typeof text !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { title, content } = parsed as Record<string, unknown>;
  if (typeof title !== 'string' || typeof content !== 'string') return null;
  const t = title.trim();
  const c = content.trim();
  if (t.length === 0 || c.length === 0) return null;
  if (c.length > MAX_STORY_CONTENT_LEN) return null;
  return { title: t.length > MAX_STORY_TITLE_LEN ? t.slice(0, MAX_STORY_TITLE_LEN) : t, content: c };
}
