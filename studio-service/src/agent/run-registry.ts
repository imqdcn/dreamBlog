/**
 * Run 注册表与进度快照（设计 7.12；需求 10.1、10.9、10.10、10.14、13.10、14.2）。
 * - 同一 sid 同时只允许一个运行中的 Run，否则返回 busy
 * - runId = crypto.randomUUID()，所有日志行带 runId
 * - 120 秒总超时由 setTimeout 触发 abort('timeout')，Run 结束时清除
 * - Run 结束后在内存保留 10 分钟供 progress 查询
 * - SIGTERM：取消所有运行中的 Run，最多等待 5 秒
 */
import { randomUUID } from 'node:crypto';

import { logger } from '../logger.js';
import type { AgentResult, ProgressEvent } from './types.js';

export const RUN_TIMEOUT_MS = 120_000;
export const RUN_RETENTION_MS = 10 * 60_000;
export const SHUTDOWN_WAIT_MS = 5_000;

export type ToolStatus = 'running' | 'ok' | 'error';

export interface ProgressStep {
  step: number;
  phase: 'thinking' | 'tools';
  tools: { name: string; status: ToolStatus }[];
}

export interface ProgressResult {
  answer: string;
  terminationReason: AgentResult['terminationReason'];
  stepCount: number;
  totalTokens: number;
  estimatedCost: number;
  redacted: boolean;
}

/** 与前端 composables/useAgentRun.ts 的 ProgressSnapshot 保持一致。 */
export interface ProgressSnapshot {
  runId: string;
  state: 'running' | 'finished';
  currentStep: number;
  steps: ProgressStep[];
  result?: ProgressResult;
}

export interface RunHandle {
  runId: string;
  sid: string;
  question: string;
  abort: AbortController;
  cancelled: boolean;
  progress: ProgressSnapshot;
  done: Promise<AgentResult>;
}

/** 实际执行 Run 的函数（通常是 runAgent 的封装）。 */
export type RunExecutor = (ctx: {
  runId: string;
  sid: string;
  question: string;
  signal: AbortSignal;
  onProgress: (e: ProgressEvent) => void;
}) => Promise<AgentResult>;

export interface RunRegistryOptions {
  timeoutMs?: number;
  retentionMs?: number;
  newId?: () => string;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

/** 把进度事件应用到快照上（纯函数，原地修改）。 */
export function applyProgress(p: ProgressSnapshot, e: ProgressEvent): void {
  if (p.state === 'finished') return;
  if (e.type === 'step_started') {
    p.currentStep = e.step;
    if (!p.steps.some((s) => s.step === e.step)) {
      p.steps.push({ step: e.step, phase: 'thinking', tools: [] });
    }
    return;
  }
  let s = p.steps.find((x) => x.step === e.step);
  if (!s) {
    s = { step: e.step, phase: 'thinking', tools: [] };
    p.steps.push(s);
    p.currentStep = e.step;
  }
  if (e.type === 'tool_started') {
    s.phase = 'tools';
    s.tools.push({ name: e.name, status: 'running' });
  } else if (e.type === 'tool_finished') {
    // 同名工具可能并行多次：更新第一个仍在运行的
    const t = s.tools.find((x) => x.name === e.name && x.status === 'running');
    if (t) t.status = e.status;
  }
}

export class RunRegistry {
  private readonly runs = new Map<string, RunHandle>();
  private readonly active = new Map<string, string>(); // sid -> runId
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly timeoutMs: number;
  private readonly retentionMs: number;
  private readonly newId: () => string;
  private readonly setT: typeof setTimeout;
  private readonly clearT: typeof clearTimeout;

  constructor(
    private readonly executor: RunExecutor,
    opts: RunRegistryOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? RUN_TIMEOUT_MS;
    this.retentionMs = opts.retentionMs ?? RUN_RETENTION_MS;
    this.newId = opts.newId ?? randomUUID;
    this.setT = opts.setTimeout ?? setTimeout;
    this.clearT = opts.clearTimeout ?? clearTimeout;
  }

  /** 同一 sid 已有运行中的 Run → busy（需求 10.14）。 */
  start(sid: string, question: string): RunHandle | { error: 'busy' } {
    if (this.active.has(sid)) return { error: 'busy' };

    const runId = this.newId();
    const abort = new AbortController();
    const progress: ProgressSnapshot = { runId, state: 'running', currentStep: 0, steps: [] };
    const handle = { runId, sid, question, abort, cancelled: false, progress } as RunHandle;

    this.active.set(sid, runId);
    this.runs.set(runId, handle);
    logger.info('run started', runId);

    const timeout = this.setT(() => {
      if (!abort.signal.aborted) {
        logger.warn('run timeout', runId);
        abort.abort('timeout');
      }
    }, this.timeoutMs);
    this.timers.set(runId, timeout);

    handle.done = (async () => {
      try {
        const result = await this.executor({
          runId,
          sid,
          question,
          signal: abort.signal,
          onProgress: (e) => applyProgress(progress, e),
        });
        progress.state = 'finished';
        progress.result = {
          answer: result.answer,
          terminationReason: result.terminationReason,
          stepCount: result.stepCount,
          totalTokens: result.promptTokens + result.completionTokens,
          estimatedCost: result.estimatedCost,
          redacted: result.redacted,
        };
        logger.info('run finished', runId, { terminationReason: result.terminationReason });
        return result;
      } catch (err) {
        progress.state = 'finished';
        logger.error('run failed', runId, { error: err instanceof Error ? err.message : String(err) });
        throw err;
      } finally {
        this.finish(handle);
      }
    })();
    // 避免无人等待时产生 unhandledRejection；调用方仍可 await handle.done 取得错误
    handle.done.catch(() => undefined);

    return handle;
  }

  get(runId: string): RunHandle | undefined {
    return this.runs.get(runId);
  }

  /** 取消运行中的 Run；已结束或不存在则忽略（需求 10.10）。 */
  cancel(runId: string): void {
    const h = this.runs.get(runId);
    if (!h || h.progress.state !== 'running' || h.abort.signal.aborted) return;
    h.cancelled = true;
    logger.info('run cancel requested', runId);
    h.abort.abort('cancelled');
  }

  /** 该 sid 是否有运行中的 Run（不改变状态，用于在限流计数前做并发检查）。 */
  isActive(sid: string): boolean {
    return this.active.has(sid);
  }

  /** 运行中的 Run 数量。 */
  activeCount(): number {
    return this.active.size;
  }

  /** 取消所有运行中的 Run，等待它们结束，最多 waitMs（默认 5 秒）。 */
  async shutdown(waitMs: number = SHUTDOWN_WAIT_MS): Promise<void> {
    const pending = [...this.active.values()]
      .map((id) => this.runs.get(id))
      .filter((h): h is RunHandle => !!h);
    for (const h of pending) this.cancel(h.runId);
    if (pending.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = this.setT(resolve, waitMs);
    });
    try {
      await Promise.race([Promise.allSettled(pending.map((h) => h.done)).then(() => undefined), limit]);
    } finally {
      if (timer) this.clearT(timer);
    }
  }

  /** 注册 SIGTERM 处理：取消所有运行中的 Run，等待最多 5 秒后调用 exit。 */
  installSigtermHandler(exit: (code: number) => void = (c) => process.exit(c)): () => void {
    const handler = () => {
      void this.shutdown().finally(() => exit(0));
    };
    process.once('SIGTERM', handler);
    return () => process.off('SIGTERM', handler);
  }

  private finish(h: RunHandle): void {
    const t = this.timers.get(h.runId);
    if (t) this.clearT(t);
    this.timers.delete(h.runId);
    if (this.active.get(h.sid) === h.runId) this.active.delete(h.sid);
    const evict = this.setT(() => this.runs.delete(h.runId), this.retentionMs);
    // 保留期定时器不阻止进程退出
    (evict as { unref?: () => void }).unref?.();
  }
}
