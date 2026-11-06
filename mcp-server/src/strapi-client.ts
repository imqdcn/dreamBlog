import { logger } from './logger.js';

/** 写入 Strapi 的梦境记录字段（与 backend 的 dream schema 对应） */
export interface DreamRecord {
  rawContent: string;
  title?: string;
  summary?: string;
  keywords?: string[];
  emotion?: string;
  emotionScore?: number;
  clarity?: number;
  dreamedAt?: string;
  aiProcessed?: boolean;
  source?: string;
}

/** LLM 加工后回写的字段（部分更新） */
export type DreamEnrichmentPatch = Partial<
  Pick<DreamRecord, 'title' | 'summary' | 'keywords' | 'emotion' | 'emotionScore' | 'clarity' | 'aiProcessed'>
>;

export interface StrapiClientOptions {
  baseUrl: string;
  token: string;
  /** 失败重试次数 */
  maxRetries?: number;
  /** 重试基准延迟（毫秒） */
  retryBaseDelayMs?: number;
  /** 注入 fetch，便于测试 */
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 标记可重试的错误（5xx / 网络） */
class RetryableError extends Error {}

/**
 * Strapi REST 客户端。封装梦境记录的创建与更新，带 Bearer Token 鉴权、
 * 指数退避重试与错误处理。
 */
export class StrapiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: StrapiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
    this.maxRetries = opts.maxRetries ?? 2;
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 500;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * 创建一条梦境记录。
   * @returns 创建成功后的记录（含 id / documentId）
   */
  async createDream(record: DreamRecord): Promise<{ id: number; documentId?: string }> {
    const data = await this.requestWithRetry('POST', '/api/dreams', { data: record });
    logger.info(`梦境已写入 Strapi：id=${data.id} documentId=${data.documentId ?? '-'}`);
    return { id: data.id, documentId: data.documentId };
  }

  /**
   * 更新一条梦境记录（用于 LLM 加工后回写）。
   * Strapi v5 以 documentId 作为更新主键。
   */
  async updateDream(
    documentId: string,
    patch: DreamEnrichmentPatch
  ): Promise<{ id: number; documentId?: string }> {
    const data = await this.requestWithRetry('PUT', `/api/dreams/${documentId}`, { data: patch });
    logger.info(`梦境已更新：documentId=${documentId}`);
    return { id: data.id, documentId: data.documentId };
  }

  /**
   * 列出所有尚未 LLM 加工（aiProcessed=false）的梦境，用于开机补偿扫描。
   * 分页拉全量，只取回写所需的 documentId 与 rawContent。
   */
  async listUnprocessed(): Promise<Array<{ documentId: string; rawContent: string }>> {
    const pageSize = 100;
    let page = 1;
    let pageCount = 1;
    const out: Array<{ documentId: string; rawContent: string }> = [];

    do {
      const qs = new URLSearchParams({
        'filters[aiProcessed][$eq]': 'false',
        'fields[0]': 'rawContent',
        'pagination[page]': String(page),
        'pagination[pageSize]': String(pageSize),
        sort: 'createdAt:asc',
      });
      const res = await this.fetchImpl(`${this.baseUrl}/api/dreams?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`查询待加工梦境失败 ${res.status}：${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        data?: Array<{ documentId?: string; rawContent?: string }>;
        meta?: { pagination?: { pageCount?: number } };
      };
      for (const item of json.data ?? []) {
        if (item.documentId && item.rawContent) {
          out.push({ documentId: item.documentId, rawContent: item.rawContent });
        }
      }
      pageCount = json.meta?.pagination?.pageCount ?? 1;
      page += 1;
    } while (page <= pageCount);

    return out;
  }

  /** 健康检查：能否访问 Strapi（不校验业务数据） */
  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/dreams?pagination[pageSize]=1`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * 通用请求 + 指数退避重试。
   * 4xx 不重试（鉴权/校验错误），5xx 与网络错误（TypeError）可重试。
   */
  private async requestWithRetry(
    method: 'POST' | 'PUT',
    path: string,
    payload: unknown
  ): Promise<{ id: number; documentId?: string }> {
    const url = `${this.baseUrl}${path}`;
    const body = JSON.stringify(payload);

    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          if (res.status >= 400 && res.status < 500) {
            throw new Error(`Strapi 返回 ${res.status}：${text.slice(0, 300)}`);
          }
          throw new RetryableError(`Strapi 返回 ${res.status}：${text.slice(0, 300)}`);
        }

        const json = (await res.json()) as {
          data?: { id: number; documentId?: string };
        };
        const data = json.data;
        if (!data) {
          throw new Error('Strapi 返回体缺少 data 字段');
        }
        return { id: data.id, documentId: data.documentId };
      } catch (err) {
        lastErr = err as Error;
        const retryable = err instanceof RetryableError || err instanceof TypeError;
        if (!retryable || attempt === this.maxRetries) {
          break;
        }
        const delay = this.retryBaseDelayMs * 2 ** attempt;
        logger.warn(
          `${method} ${path} 失败（第 ${attempt + 1} 次），${delay}ms 后重试：${(err as Error).message}`
        );
        await sleep(delay);
      }
    }
    throw new Error(`${method} ${path} 最终失败：${lastErr?.message ?? '未知错误'}`);
  }
}
