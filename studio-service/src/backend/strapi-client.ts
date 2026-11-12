import { logger } from '../logger.js';

/** 梦境写入字段（与 backend 的 dream schema 对应） */
export interface DreamWrite {
  rawContent?: string;
  title?: string;
  summary?: string;
  keywords?: string[];
  emotion?: string;
  emotionScore?: number;
  clarity?: number;
  dreamedAt?: string;
  aiProcessed?: boolean;
  source?: string;
  isFavorite?: boolean;
  tags?: string[];
}

export interface StoryWrite {
  title: string;
  content: string;
  style: string;
  tags?: string[];
  /** 来源梦境的 documentId 列表 */
  sourceDreams: string[];
  sourceSnapshot?: Array<{ documentId: string; title: string }>;
}

export interface AgentRunWrite {
  runId: string;
  question: string;
  finalAnswer?: string;
  terminationReason?: string;
  trace?: unknown[];
  promptTokens?: number;
  completionTokens?: number;
  estimatedCost?: number;
  durationMs?: number;
  stepCount?: number;
  model?: string;
  redacted?: boolean;
  usageEstimated?: boolean;
}

/** Strapi 返回的实体：至少含 id / documentId，其余字段原样透传 */
export type StrapiEntity<T = Record<string, unknown>> = T & { id: number; documentId?: string };

export interface Pagination {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

export interface StrapiClientOptions {
  baseUrl: string;
  token: string;
  /** 5xx / 网络错误的重试次数，默认 2 */
  maxRetries?: number;
  /** 重试基准延迟（毫秒），默认 500（500、1000） */
  retryBaseDelayMs?: number;
  /** 单次请求超时（毫秒），默认 10000 */
  timeoutMs?: number;
  /** 注入 fetch，便于测试 */
  fetchImpl?: typeof fetch;
  /** 注入 sleep，便于测试 */
  sleepImpl?: (ms: number) => Promise<void>;
}

/** 4xx 等不可重试的 Strapi 错误，保留状态码 */
export class StrapiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'StrapiError';
  }
}

/** 5xx 与网络/超时错误，可重试 */
class RetryableError extends StrapiError {}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 列表查询只取摘要字段，不含 trace / finalAnswer */
const RUN_LIST_FIELDS = [
  'runId',
  'question',
  'terminationReason',
  'promptTokens',
  'completionTokens',
  'estimatedCost',
  'durationMs',
  'stepCount',
  'createdAt',
];

/**
 * Studio_Service 使用的 Strapi 写客户端。
 * 所有请求带 Bearer Token 与 10 秒超时；GET/PUT/DELETE 对 5xx 与网络错误重试 2 次
 * （500ms、1000ms），4xx 不重试；createStory / createAgentRun 的 POST 不重试，避免重复记录。
 */
export class StrapiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: StrapiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.maxRetries = opts.maxRetries ?? 2;
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 500;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleepImpl ?? defaultSleep;
  }

  /** 创建梦境（POST，会产生新记录，不重试） */
  async createDream(record: DreamWrite & { rawContent: string }): Promise<StrapiEntity> {
    const json = await this.request('POST', '/api/dreams', { data: record }, false);
    return this.entity(json, 'POST /api/dreams');
  }

  /** 更新梦境（PUT 幂等，可重试）。Strapi v5 以 documentId 为主键。 */
  async updateDream(documentId: string, patch: DreamWrite): Promise<StrapiEntity> {
    const path = `/api/dreams/${encodeURIComponent(documentId)}`;
    const json = await this.request('PUT', path, { data: patch }, true);
    return this.entity(json, `PUT ${path}`);
  }

  /** 读取单条梦境；不存在返回 null（用于存在性校验） */
  async getDream(documentId: string): Promise<StrapiEntity | null> {
    const path = `/api/dreams/${encodeURIComponent(documentId)}`;
    try {
      const json = await this.request('GET', path, undefined, true);
      return this.entity(json, `GET ${path}`);
    } catch (err) {
      if (err instanceof StrapiError && err.status === 404) return null;
      throw err;
    }
  }

  /** 创建故事（POST，不重试） */
  async createStory(story: StoryWrite): Promise<StrapiEntity> {
    const json = await this.request('POST', '/api/stories', { data: story }, false);
    return this.entity(json, 'POST /api/stories');
  }

  /** 删除故事（只删 Story，DELETE 幂等，可重试）。故事不存在时返回 false。 */
  async deleteStory(documentId: string): Promise<boolean> {
    const path = `/api/stories/${encodeURIComponent(documentId)}`;
    try {
      await this.request('DELETE', path, undefined, true);
      return true;
    } catch (err) {
      if (err instanceof StrapiError && err.status === 404) return false;
      throw err;
    }
  }

  /** 持久化一次 Agent 运行（POST，不重试） */
  async createAgentRun(record: AgentRunWrite): Promise<StrapiEntity> {
    const json = await this.request('POST', '/api/agent-runs', { data: record }, false);
    return this.entity(json, 'POST /api/agent-runs');
  }

  /** 分页列出运行摘要（按 createdAt 倒序，不含 trace） */
  async listAgentRuns(
    page = 1,
    pageSize = 50,
    opts: { full?: boolean } = {}
  ): Promise<{ data: Array<StrapiEntity>; pagination: Pagination }> {
    const qs = new URLSearchParams({
      sort: 'createdAt:desc',
      'pagination[page]': String(page),
      'pagination[pageSize]': String(pageSize),
    });
    if (!opts.full) RUN_LIST_FIELDS.forEach((f, i) => qs.set(`fields[${i}]`, f));
    const path = `/api/agent-runs?${qs.toString()}`;
    const json = (await this.request('GET', path, undefined, true)) as {
      data?: Array<StrapiEntity>;
      meta?: { pagination?: Partial<Pagination> };
    };
    const p = json.meta?.pagination ?? {};
    return {
      data: json.data ?? [],
      pagination: {
        page: p.page ?? page,
        pageSize: p.pageSize ?? pageSize,
        pageCount: p.pageCount ?? 1,
        total: p.total ?? json.data?.length ?? 0,
      },
    };
  }

  /** 按 runId 取一条完整运行记录（含 trace）；不存在返回 null */
  async getAgentRun(runId: string): Promise<StrapiEntity | null> {
    const qs = new URLSearchParams({
      'filters[runId][$eq]': runId,
      'pagination[pageSize]': '1',
    });
    const path = `/api/agent-runs?${qs.toString()}`;
    const json = (await this.request('GET', path, undefined, true)) as {
      data?: Array<StrapiEntity>;
    };
    return json.data?.[0] ?? null;
  }

  private entity(json: unknown, what: string): StrapiEntity {
    const data = (json as { data?: StrapiEntity } | undefined)?.data;
    if (!data || typeof data !== 'object') {
      throw new StrapiError(`${what} 返回体缺少 data 字段`);
    }
    return data;
  }

  /**
   * 单次/重试请求。retry=false 时只尝试一次。
   * 4xx → StrapiError（不重试）；5xx、网络错误、超时 → 可重试。
   */
  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    payload: unknown,
    retry: boolean
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    let body: string | undefined;
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(payload);
    }
    const attempts = retry ? this.maxRetries : 0;
    const label = `${method} ${path.split('?')[0]}`;

    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      try {
        let res: Response;
        try {
          res = await this.fetchImpl(url, {
            method,
            headers,
            body,
            signal: AbortSignal.timeout(this.timeoutMs),
          });
        } catch (netErr) {
          // fetch 抛错（网络故障 / 超时）一律视为可重试
          throw new RetryableError(`${label} 网络错误：${(netErr as Error).message}`);
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const msg = `${label} Strapi 返回 ${res.status}：${text.slice(0, 300)}`;
          if (res.status >= 500) throw new RetryableError(msg, res.status);
          throw new StrapiError(msg, res.status);
        }

        if (res.status === 204) return undefined;
        const text = await res.text();
        return text ? JSON.parse(text) : undefined;
      } catch (err) {
        lastErr = err as Error;
        if (!(err instanceof RetryableError) || attempt >= attempts) break;
        const delay = this.retryBaseDelayMs * 2 ** attempt;
        logger.warn(`${label} 失败（第 ${attempt + 1} 次），${delay}ms 后重试：${lastErr.message}`);
        await this.sleep(delay);
      }
    }
    if (lastErr instanceof StrapiError) throw lastErr;
    throw new StrapiError(`${label} 最终失败：${lastErr?.message ?? '未知错误'}`);
  }
}
