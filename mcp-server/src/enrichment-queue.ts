import { logger } from './logger.js';
import type { StrapiClient } from './strapi-client.js';
import type { LlmProcessor } from './llm-processor.js';

/** 一条待加工任务：已落库的梦境，待 LLM 加工后回写 */
interface EnrichmentJob {
  documentId: string;
  rawContent: string;
}

/**
 * 后台梦境加工队列。
 *
 * record_dream 先把原文落库并立即回话，再把加工任务排入本队列。
 * 队列以单 worker 串行消费（避免并发压垮 LLM 代理），对每条任务：
 *   LLM 加工（内部已带重试）→ 成功则回写 Strapi 并置 aiProcessed=true。
 * 加工失败不影响已保存的原文，记录保持 aiProcessed=false。
 */
export class EnrichmentQueue {
  private readonly jobs: EnrichmentJob[] = [];
  private running = false;
  /** 当前排空 Promise，便于进程退出时 await */
  private idleResolvers: Array<() => void> = [];

  constructor(
    private readonly strapi: StrapiClient,
    private readonly llm: LlmProcessor
  ) {}

  /**
   * 开机补偿扫描：把 Strapi 中所有 aiProcessed=false 的梦境重新入队。
   * 用于进程崩溃/重启后，补做之前未完成的加工，避免任务丢失。
   * 查询失败不抛出（不阻断启动），仅记录日志。
   */
  async recover(): Promise<number> {
    try {
      const pending = await this.strapi.listUnprocessed();
      if (pending.length === 0) {
        logger.info('补偿扫描：没有待加工的梦境');
        return 0;
      }
      logger.info(`补偿扫描：发现 ${pending.length} 条待加工梦境，重新入队`);
      for (const job of pending) {
        this.enqueue(job);
      }
      return pending.length;
    } catch (err) {
      logger.error('补偿扫描失败（不影响正常服务）：', (err as Error).message);
      return 0;
    }
  }

  /** 入队一条加工任务，立即返回（不阻塞调用方） */
  enqueue(job: EnrichmentJob): void {
    this.jobs.push(job);
    logger.info(`加工任务入队：documentId=${job.documentId}，当前队列长度=${this.jobs.length}`);
    if (!this.running) {
      void this.run();
    }
  }

  /** 队列当前长度 */
  get size(): number {
    return this.jobs.length;
  }

  /** 等待队列排空（含正在处理的任务）。用于进程优雅退出。 */
  async drain(timeoutMs = 60000): Promise<void> {
    if (!this.running && this.jobs.length === 0) return;
    await Promise.race([
      new Promise<void>((resolve) => this.idleResolvers.push(resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
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
      const resolvers = this.idleResolvers;
      this.idleResolvers = [];
      for (const r of resolvers) r();
    }
  }

  private async process(job: EnrichmentJob): Promise<void> {
    try {
      const enrichment = await this.llm.enrich(job.rawContent);
      if (!enrichment) {
        // enrich 内部已重试并降级；保持原文记录不变
        logger.warn(`加工未产出结果，保留原文：documentId=${job.documentId}`);
        return;
      }
      await this.strapi.updateDream(job.documentId, {
        title: enrichment.title,
        summary: enrichment.summary,
        keywords: enrichment.keywords,
        emotion: enrichment.emotion,
        emotionScore: enrichment.emotionScore,
        ...(enrichment.clarity !== undefined ? { clarity: enrichment.clarity } : {}),
        aiProcessed: true,
      });
      logger.info(`加工完成并回写：documentId=${job.documentId} 标题「${enrichment.title}」`);
    } catch (err) {
      // 回写失败也不应中断队列；原文已安全保存
      logger.error(`加工回写失败：documentId=${job.documentId}：${(err as Error).message}`);
    }
  }
}
