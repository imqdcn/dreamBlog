import { readFile } from 'node:fs/promises';
import type { ReadOnlyDreamSource } from '../agent/types.js';
import type { DreamEmotion, DreamRecord } from '../domain/types.js';

export type { ReadOnlyDreamSource };

/** 运行快照上限：超出时只保留最新 5000 条 */
export const SNAPSHOT_LIMIT = 5000;
const PAGE_SIZE = 100;

export class DreamSourceError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'DreamSourceError';
  }
}

export interface StrapiDreamSourceOptions {
  baseUrl: string;
  /** Studio Token（只需读权限），以 Bearer 发送 */
  token: string;
  fetchImpl?: typeof fetch;
  /** 快照上限，默认 5000 */
  limit?: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** 把 Strapi 条目（v5 扁平；兼容 v4 attributes 包裹）规整为 DreamRecord */
export function normalizeDream(raw: unknown): DreamRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const base = raw as Record<string, unknown>;
  const r =
    base.attributes && typeof base.attributes === 'object'
      ? { ...(base.attributes as Record<string, unknown>), documentId: base.documentId ?? base.id }
      : base;
  const documentId = str(r.documentId);
  if (!documentId) return null;
  const tags = Array.isArray(r.tags)
    ? r.tags
        .map((t) => (typeof t === 'string' ? t : str((t as { name?: unknown } | null)?.name)))
        .filter((t): t is string => !!t)
    : [];
  return {
    documentId,
    rawContent: str(r.rawContent) ?? '',
    title: str(r.title),
    summary: str(r.summary),
    keywords: strArr(r.keywords),
    tags,
    emotion: str(r.emotion) as DreamEmotion | undefined,
    emotionScore: num(r.emotionScore),
    clarity: num(r.clarity),
    dreamedAt: str(r.dreamedAt),
    createdAt: str(r.createdAt) ?? '',
    updatedAt: str(r.updatedAt),
    aiProcessed: r.aiProcessed === true,
    isFavorite: r.isFavorite === true,
    source: str(r.source),
  };
}

/**
 * 基于 Strapi REST 的只读数据源。只发 GET；不重试；
 * 整个 listAll 受调用方传入的 AbortSignal 约束（设计第 3 节、需求 9.11）。
 */
export class StrapiDreamSource implements ReadOnlyDreamSource {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limit: number;
  /** 最近一次 listAll 是否因超过上限而截断（工具结果据此标注 snapshotTruncated:true） */
  snapshotTruncated = false;

  constructor(opts: StrapiDreamSourceOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.limit = opts.limit ?? SNAPSHOT_LIMIT;
  }

  async listAll(signal: AbortSignal): Promise<DreamRecord[]> {
    const out: DreamRecord[] = [];
    let truncated = false;
    let page = 1;
    let pageCount = 1;
    do {
      const qs =
        `sort=dreamedAt:desc&pagination[page]=${page}&pagination[pageSize]=${PAGE_SIZE}&populate=*`;
      const json = (await this.get(`/api/dreams?${qs}`, signal)) as {
        data?: unknown[];
        meta?: { pagination?: { pageCount?: number } };
      };
      pageCount = json.meta?.pagination?.pageCount ?? 1;
      for (const item of json.data ?? []) {
        const d = normalizeDream(item);
        if (d) out.push(d);
      }
      if (out.length >= this.limit && (page < pageCount || out.length > this.limit)) {
        truncated = true;
        break;
      }
      page += 1;
    } while (page <= pageCount);

    this.snapshotTruncated = truncated;
    return truncated ? out.slice(0, this.limit) : out;
  }

  async getByDocumentId(id: string, signal: AbortSignal): Promise<DreamRecord | null> {
    try {
      const json = (await this.get(`/api/dreams/${encodeURIComponent(id)}?populate=*`, signal)) as {
        data?: unknown;
      };
      return normalizeDream(json.data);
    } catch (err) {
      if (err instanceof DreamSourceError && err.status === 404) return null;
      throw err;
    }
  }

  private async get(path: string, signal: AbortSignal): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DreamSourceError(`GET ${path.split('?')[0]} Strapi 返回 ${res.status}：${text.slice(0, 200)}`, res.status);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }
}

/** 评估与单元测试用：读取 JSON 夹具（如 eval/fixtures/dreams.json），不产生任何网络请求 */
export class FixtureDreamSource implements ReadOnlyDreamSource {
  private cache: Promise<DreamRecord[]> | null = null;

  constructor(private readonly fixturePath: string) {}

  private load(): Promise<DreamRecord[]> {
    if (!this.cache) {
      const p = readFile(this.fixturePath, 'utf8').then((text) => {
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) throw new DreamSourceError(`夹具 ${this.fixturePath} 不是数组`);
        return arr as DreamRecord[];
      });
      p.catch(() => {
        this.cache = null;
      });
      this.cache = p;
    }
    return this.cache;
  }

  async listAll(signal: AbortSignal): Promise<DreamRecord[]> {
    signal.throwIfAborted();
    // 返回副本，避免调用方修改夹具
    return (await this.load()).map((d) => ({ ...d }));
  }

  async getByDocumentId(id: string, signal: AbortSignal): Promise<DreamRecord | null> {
    signal.throwIfAborted();
    const d = (await this.load()).find((x) => x.documentId === id);
    return d ? { ...d } : null;
  }
}
