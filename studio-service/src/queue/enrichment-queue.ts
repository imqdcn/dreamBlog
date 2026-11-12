/**
 * Dream 加工队列与状态存储（设计 4.1；需求 4.7、4.9）。
 *
 * - 进程内单 worker FIFO：任务串行消费
 * - 成功后一次 PUT 回写 title/summary/keywords/emotion/emotionScore/aiProcessed:true，clarity 有值才附带
 * - 状态保存在 Map<documentId, {status, error?}>，自最近一次状态变更起保留 30 分钟
 * - 失败时不写 Backend：原文保留，aiProcessed 保持 false，状态为 failed
 */
import type { LlmClient } from '../agent/types.js';
import type { DreamWrite } from '../backend/strapi-client.js';
import { LlmTransientError } from '../llm/client.js';
import { enrichDream, type DreamEnrichment } from '../llm/enrich.js';
import { logger } from '../logger.js';

export type EnrichmentStatus = 'pending' | 'done' | 'failed';

export interface EnrichmentState {
  status: EnrichmentStatus;
  error?: string;
}

export interface EnrichmentJob {
  documentId: string;
  rawContent: string;
}

export const ENRICHMENT_STATUS_TTL_MS = 30 * 60 * 1000;

export interface EnrichmentQueueOptions {
  llm: LlmClient;
  backend: { updateDream(documentId: string, patch: DreamWrite): Promise<unknown> };
  /** 默认 Date.now */
  now?: () => number;
  /** 瞬时 LLM 错误的额外重试次数，默认 2 */
  maxRetries?: number;
  /** 重试间隔毫秒，默认 500 * 2^n */
  retryDelayMs?: number;
  /** 单次 LLM 调用超时毫秒，默认 60000 */
  llmTimeoutMs?: number;
}

export class EnrichmentQueue {
  private readonly jobs: EnrichmentJob[] = [];
  private readonly states = new Map<string, EnrichmentState & { at: number }>();
  private running = false;
  private idleResolvers: Array<() => void> = [];
  private readonly now: () => number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly llmTimeoutMs: number;

  constructor(private readonly opts: EnrichmentQueueOptions) {
    this.now = opts.now ?? Date.now;
    this.maxRetries = opts.maxRetries ?? 2;
    this.retryDelayMs = opts.retryDelayMs ?? 500;
    this.llmTimeoutMs = opts.llmTimeoutMs ?? 60_000;
  }

  /** 入队并置为 pending；立即返回。同一 documentId 已在排队时不重复入队。 */
  enqueue(job: EnrichmentJob): void {
    if (this.jobs.some((j) => j.documentId === job.documentId)) return;
    this.setState(job.documentId, { status: 'pending' });
    this.jobs.push(job);
    if (!this.running) void this.run();
  }

  /** 查询状态；超过 30 分钟的记录视为不存在（返回 undefined）。 */
  getStatus(documentId: string): EnrichmentState | undefined {
    this.sweep();
    const s = this.states.get(documentId);
    if (!s) return undefined;
    return s.error !== undefined ? { status: s.status, error: s.error } : { status: s.status };
  }

  get size(): number {
    return this.jobs.length;
  }

  /** 等待队列排空（含正在处理的任务），最多 timeoutMs。 */
  async drain(timeoutMs = 60_000): Promise<void> {
    if (!this.running && this.jobs.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      new Promise<void>((resolve) => this.idleResolvers.push(resolve)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
  }

  private setState(documentId: string, s: EnrichmentState): void {
    this.states.set(documentId, { ...s, at: this.now() });
  }

  private sweep(): void {
    const cutoff = this.now() - ENRICHMENT_STATUS_TTL_MS;
    for (const [id, s] of this.states) {
      if (s.at <= cutoff && s.status !== 'pending') this.states.delete(id);
    }
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.jobs.length > 0) {
        const job = this.jobs.shift()!;
        await this.process(job);
      }
    } finally {
      this.running = false;
      const rs = this.idleResolvers;
      this.idleResolvers = [];
      for (const r of rs) r();
    }
  }

  private async enrichWithRetry(rawContent: string): Promise<DreamEnrichment> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await enrichDream(this.opts.llm, rawContent, {
          signal: AbortSignal.timeout(this.llmTimeoutMs),
        });
      } catch (err) {
        if (!(err instanceof LlmTransientError) || attempt >= this.maxRetries) throw err;
        await new Promise((r) => setTimeout(r, this.retryDelayMs * 2 ** attempt));
      }
    }
  }

  private async process(job: EnrichmentJob): Promise<void> {
    let enrichment: DreamEnrichment;
    try {
      enrichment = await this.enrichWithRetry(job.rawContent);
    } catch (err) {
      logger.warn('Dream 加工失败，保留原文', undefined, {
        documentId: job.documentId,
        reason: (err as Error).message,
      });
      this.setState(job.documentId, { status: 'failed', error: 'enrichment_failed' });
      return;
    }

    const patch: DreamWrite = {
      title: enrichment.title,
      summary: enrichment.summary,
      keywords: enrichment.keywords,
      emotion: enrichment.emotion,
      emotionScore: enrichment.emotionScore,
      ...(enrichment.clarity !== undefined ? { clarity: enrichment.clarity } : {}),
      aiProcessed: true,
    };
    try {
      await this.opts.backend.updateDream(job.documentId, patch);
      this.setState(job.documentId, { status: 'done' });
    } catch (err) {
      logger.error('Dream 加工回写失败，保留原文', undefined, {
        documentId: job.documentId,
        reason: (err as Error).message,
      });
      this.setState(job.documentId, { status: 'failed', error: 'writeback_failed' });
    }
  }
}
