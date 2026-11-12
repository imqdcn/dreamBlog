import { dreamDateKey } from './dates.js';
import type { DreamEmotion, DreamRecord } from './types.js';

/** 字段权重（design 7.5） */
export const FIELD_WEIGHTS = {
  title: 3,
  keywords: 3,
  tags: 2,
  summary: 1.5,
  rawContent: 1,
} as const;

const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}`;
const CJK_RUN_RE = new RegExp(`[${CJK}]+`, 'gu');
const WORD_RUN_RE = new RegExp(`[^${CJK}]+`, 'gu');
const WORD_PART_RE = /[\p{L}\p{N}]+/gu;

/**
 * 分词：NFKC + 小写；连续 CJK 段长度为 1 取单字，否则取全部二元组；
 * 拉丁/数字段按词，长度 >= 2。返回去重后的词元集合。
 */
export function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  const text = (s ?? '').normalize('NFKC').toLowerCase();
  for (const run of text.match(CJK_RUN_RE) ?? []) {
    const chars = Array.from(run);
    if (chars.length === 1) out.add(chars[0]!);
    else for (let i = 0; i < chars.length - 1; i++) out.add(chars[i]! + chars[i + 1]!);
  }
  for (const seg of text.match(WORD_RUN_RE) ?? []) {
    for (const w of seg.match(WORD_PART_RE) ?? []) {
      if (Array.from(w).length >= 2) out.add(w);
    }
  }
  return out;
}

/** relevance = Σ_f w_f · |Q ∩ T_f| / |Q|；Q 为空时为 0 */
export function relevance(
  queryTokens: Set<string>,
  dream: Pick<DreamRecord, 'keywords' | 'tags'> &
    Partial<Pick<DreamRecord, 'title' | 'summary' | 'rawContent'>>,
): number {
  if (queryTokens.size === 0) return 0;
  const fields: Record<keyof typeof FIELD_WEIGHTS, string> = {
    title: dream.title ?? '',
    keywords: (dream.keywords ?? []).join(' '),
    tags: (dream.tags ?? []).join(' '),
    summary: dream.summary ?? '',
    rawContent: dream.rawContent ?? '',
  };
  let total = 0;
  for (const f of Object.keys(FIELD_WEIGHTS) as (keyof typeof FIELD_WEIGHTS)[]) {
    const tokens = tokenize(fields[f]);
    let hit = 0;
    for (const q of queryTokens) if (tokens.has(q)) hit++;
    total += (FIELD_WEIGHTS[f] * hit) / queryTokens.size;
  }
  return total;
}

export interface SearchFilters {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  emotion?: DreamEmotion;
  tag?: string;
}

export interface SearchHit {
  documentId: string;
  title?: string;
  summary?: string;
  emotion?: DreamEmotion;
  dreamedAt?: string;
  keywords: string[];
}

function project(d: DreamRecord): SearchHit {
  return {
    documentId: d.documentId,
    title: d.title,
    summary: d.summary,
    emotion: d.emotion,
    dreamedAt: d.dreamedAt,
    keywords: d.keywords ?? [],
  };
}

/**
 * 搜索梦境。过滤：日期区间（含端点）、emotion 相等、tag trim 后完全相等。
 * 有查询时仅保留 relevance > 0；排序 relevance 降序、日期降序、documentId 升序。
 * 查询为空时只过滤，按日期降序（同日按 documentId 升序）。
 */
export function searchDreams(dreams: readonly DreamRecord[], filters: SearchFilters, tz: string): SearchHit[] {
  const q = tokenize(filters.query ?? '');
  const hasQuery = (filters.query ?? '').trim() !== '';
  const tag = filters.tag?.trim();

  const rows: { d: DreamRecord; date: string; rel: number }[] = [];
  for (const d of dreams) {
    const date = dreamDateKey(d, tz);
    if (filters.dateFrom !== undefined || filters.dateTo !== undefined) {
      if (date === null) continue;
      if (filters.dateFrom !== undefined && date < filters.dateFrom) continue;
      if (filters.dateTo !== undefined && date > filters.dateTo) continue;
    }
    if (filters.emotion !== undefined && d.emotion !== filters.emotion) continue;
    if (tag !== undefined && !(d.tags ?? []).some((t) => t.trim() === tag)) continue;
    let rel = 0;
    if (hasQuery) {
      rel = relevance(q, d);
      if (rel <= 0) continue;
    }
    rows.push({ d, date: date ?? '', rel });
  }

  rows.sort((a, b) => {
    if (a.rel !== b.rel) return b.rel - a.rel;
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.d.documentId < b.d.documentId ? -1 : a.d.documentId > b.d.documentId ? 1 : 0;
  });
  return rows.map((r) => project(r.d));
}
