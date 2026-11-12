/**
 * 评估入口（设计 9；需求 15.2、15.3、15.7–15.11）。
 *
 *   npm run eval:offline            脚本化 LLM，零费用，可重复
 *   npm run eval                    真实 LLM（读取 STUDIO_LLM_* 环境变量）
 *   ... -- --baseline <报告路径>    与上一份报告对比
 *
 * 数据源只使用 FixtureDreamSource；工具故障由 FaultInjectingSource 包装实现。
 * 启动时包装 globalThis.fetch：访问非 LLM 主机的请求抛错并计数（报告字段 backendRequests）。
 */

import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { runAgent } from '../src/agent/loop.js';
import { formatDateInTz } from '../src/agent/prompt.js';
import { createDreamTools } from '../src/agent/tools/index.js';
import { createToolRegistry } from '../src/agent/tools/registry.js';
import type {
  AgentConfig,
  Clock,
  LlmClient,
  ReadOnlyDreamSource,
  ToolCall,
  ToolRegistry,
  ToolResult,
} from '../src/agent/types.js';
import { FixtureDreamSource } from '../src/backend/dream-source.js';
import type { DreamRecord, TerminationReason } from '../src/domain/types.js';
import { OpenAiLlmClient } from '../src/llm/client.js';
import { compare, formatComparison, loadBaseline } from './compare.js';
import { buildReport, writeReport } from './report.js';
import {
  aggregate,
  exitCode,
  factHit,
  injectionPass,
  minToolAccuracy,
  toolSelectionCorrect,
  type CaseResult,
} from './score.js';
import { ScriptedLlm, type CaseScript, type ScriptFaults, type ScriptStep } from './scripted-llm.js';

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TZ = 'Asia/Shanghai';
/** 离线假时钟起点：晚于夹具中最后一条梦境（2025-06-23） */
const OFFLINE_EPOCH_MS = Date.parse('2025-07-01T04:00:00.000Z');
const LOOP_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------- 用例类型

export type FaultKind = 'backend_unavailable' | 'timeout' | 'not_found';

export interface ToolFault {
  tool: string;
  fault: FaultKind;
}

export interface EvalCase extends CaseScript {
  id: string;
  category: string;
  question: string;
  expectedTools?: string[];
  expectedFacts?: string[];
  forbiddenTools?: string[];
  forbiddenContent?: string[];
  toolFaults?: ToolFault[];
  /** 仅离线有效：期望的终止原因 */
  expectedTermination?: TerminationReason;
  /** 仅离线有效：第 N 次 LLM 响应返回后推进假时钟（超时）或触发取消 */
  control?: { timeoutAfterLlmCalls?: number; cancelAfterLlmCalls?: number };
  script?: ScriptStep[];
  faults?: ScriptFaults;
}

// ---------------------------------------------------------------- fetch 守卫

export interface FetchGuard {
  readonly blocked: number;
  restore(): void;
}

function hostOf(input: unknown): string | undefined {
  try {
    if (typeof input === 'string') return new URL(input).host;
    if (input instanceof URL) return input.host;
    if (input && typeof input === 'object' && 'url' in input) return new URL((input as Request).url).host;
  } catch {
    /* 无法解析的目标一律视为非 LLM 主机 */
  }
  return undefined;
}

/** 只放行 allowedHosts（LLM 主机）；其余请求抛错并计数。离线模式传空数组 = 全部拦截。 */
export function installFetchGuard(allowedHosts: readonly string[]): FetchGuard {
  const original = globalThis.fetch;
  let blocked = 0;
  const allowed = new Set(allowedHosts);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const host = hostOf(input);
    if (host === undefined || !allowed.has(host)) {
      blocked += 1;
      throw new Error(`评估期间禁止访问非 LLM 主机：${host ?? '(未知)'}`);
    }
    return original(input, init);
  }) as typeof fetch;
  return {
    get blocked() {
      return blocked;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

// ---------------------------------------------------------------- 故障注入

/** 包装只读数据源注入故障；不产生任何写操作。 */
export class FaultInjectingSource implements ReadOnlyDreamSource {
  constructor(
    private readonly inner: ReadOnlyDreamSource,
    private readonly fault: FaultKind,
    /** not_found 故障下被「消失」的 documentId */
    private readonly hiddenIds: readonly string[] = [],
  ) {}

  private fail(): never {
    if (this.fault === 'timeout') {
      const e = new Error('scripted timeout');
      e.name = 'TimeoutError';
      throw e;
    }
    throw new Error('scripted backend unavailable');
  }

  async listAll(signal: AbortSignal): Promise<DreamRecord[]> {
    if (this.fault !== 'not_found') this.fail();
    const all = await this.inner.listAll(signal);
    return all.filter((d) => !this.hiddenIds.includes(d.documentId));
  }

  async getByDocumentId(id: string, signal: AbortSignal): Promise<DreamRecord | null> {
    if (this.fault !== 'not_found') this.fail();
    return this.hiddenIds.includes(id) ? null : this.inner.getByDocumentId(id, signal);
  }
}

/**
 * 工具注册表包装：被注入故障的工具改用故障数据源和独立（无快照缓存）的注册表执行，
 * 其余工具走正常数据源。
 */
class FaultAwareRegistry implements ToolRegistry {
  constructor(
    private readonly normal: ToolRegistry,
    private readonly makeFaulty: () => ToolRegistry,
    private readonly faults: ReadonlyMap<string, FaultKind>,
  ) {}

  specs() {
    return this.normal.specs();
  }
  names() {
    return this.normal.names();
  }

  async execute(call: ToolCall, ctx: { source: ReadOnlyDreamSource; signal: AbortSignal }): Promise<ToolResult> {
    const fault = this.faults.get(call.name);
    if (!fault) return this.normal.execute(call, ctx);
    let hidden: string[] = [];
    if (fault === 'not_found') {
      try {
        const id = (JSON.parse(call.argumentsJson) as { documentId?: unknown }).documentId;
        if (typeof id === 'string') hidden = [id];
      } catch {
        /* 参数非法时由注册表自行报错 */
      }
    }
    return this.makeFaulty().execute(call, { ...ctx, source: new FaultInjectingSource(ctx.source, fault, hidden) });
  }
}

// ---------------------------------------------------------------- 离线控制

class FakeClock implements Clock {
  private offset = 0;
  now(): number {
    return OFFLINE_EPOCH_MS + this.offset;
  }
  async sleep(): Promise<void> {
    /* 离线不真实等待 */
  }
  advance(ms: number): void {
    this.offset += ms;
  }
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      const t = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }),
};

/** 在第 N 次 LLM 响应返回时触发超时或取消。 */
class ControlledLlm implements LlmClient {
  private calls = 0;
  constructor(
    private readonly inner: LlmClient,
    private readonly control: NonNullable<EvalCase['control']>,
    private readonly clock: FakeClock,
    private readonly abort: () => void,
  ) {}

  async chat(req: Parameters<LlmClient['chat']>[0], opts: { signal: AbortSignal }) {
    const res = await this.inner.chat(req, opts);
    this.calls += 1;
    if (this.control.timeoutAfterLlmCalls === this.calls) this.clock.advance(LOOP_TIMEOUT_MS);
    if (this.control.cancelAfterLlmCalls === this.calls) this.abort();
    return res;
  }
}

// ---------------------------------------------------------------- 运行

export type EvalMode = 'offline' | 'real';

export interface RunEvalOptions {
  mode: EvalMode;
  baselinePath?: string;
  casesDir?: string;
  fixturePath?: string;
  reportsDir?: string;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}

export interface RunEvalOutcome {
  exitCode: 0 | 1;
  reportPath: string;
  backendRequests: number;
  results: CaseResult[];
}

async function loadCases(dir: string): Promise<EvalCase[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const cases: EvalCase[] = [];
  for (const f of files) {
    const arr = JSON.parse(await readFile(path.join(dir, f), 'utf8')) as unknown;
    if (!Array.isArray(arr)) throw new Error(`用例文件 ${f} 不是数组`);
    cases.push(...(arr as EvalCase[]));
  }
  return cases;
}

function positiveInt(raw: string | undefined, def: number): number {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 ? n : def;
}

function nonNegative(raw: string | undefined): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function runEval(opts: RunEvalOptions): Promise<RunEvalOutcome> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((l: string) => console.log(l));
  const startedAt = new Date();
  const tz = env.TZ?.trim() || DEFAULT_TZ;

  const maxSteps = positiveInt(env.STUDIO_MAX_STEPS, 8);
  const contextBudget = positiveInt(env.STUDIO_CONTEXT_BUDGET, 12000);
  const price = {
    inPerM: nonNegative(env.STUDIO_LLM_PRICE_INPUT_PER_M),
    outPerM: nonNegative(env.STUDIO_LLM_PRICE_OUTPUT_PER_M),
  };

  // 真实模式的 LLM 配置；离线模式不放行任何主机
  let realLlmFactory: (() => LlmClient) | undefined;
  let model = 'scripted';
  const allowedHosts: string[] = [];
  let apiKey = '';
  if (opts.mode === 'real') {
    apiKey = env.STUDIO_LLM_API_KEY?.trim() ?? '';
    if (!apiKey) throw new Error('真实模式需要环境变量 STUDIO_LLM_API_KEY（离线评估请使用 npm run eval:offline）');
    const baseUrl = env.STUDIO_LLM_BASE_URL?.trim() || 'https://api.openai.com/v1';
    model = env.STUDIO_LLM_MODEL?.trim() || 'gpt-4o-mini';
    allowedHosts.push(new URL(baseUrl).host);
    realLlmFactory = () => new OpenAiLlmClient({ baseUrl, apiKey, model });
  }

  const guard = installFetchGuard(allowedHosts);
  try {
    const cases = await loadCases(opts.casesDir ?? path.join(EVAL_DIR, 'cases'));
    const fixture = new FixtureDreamSource(opts.fixturePath ?? path.join(EVAL_DIR, 'fixtures', 'dreams.json'));
    const results: CaseResult[] = [];
    const failures: string[] = [];

    for (const c of cases) {
      const controller = new AbortController();
      const fakeClock = opts.mode === 'offline' ? new FakeClock() : undefined;
      const clock: Clock = fakeClock ?? realClock;

      let llm: LlmClient;
      if (opts.mode === 'offline') {
        llm = new ScriptedLlm({ script: c.script, faults: c.faults });
        if (c.control) llm = new ControlledLlm(llm, c.control, fakeClock!, () => controller.abort());
      } else {
        llm = realLlmFactory!();
      }

      const today = () => formatDateInTz(clock.now(), tz);
      const tools = createDreamTools(tz);
      const faultMap = new Map((c.toolFaults ?? []).map((f) => [f.tool, f.fault] as const));
      const registry: ToolRegistry =
        faultMap.size === 0
          ? createToolRegistry(tools, { today })
          : new FaultAwareRegistry(
              createToolRegistry(tools, { today }),
              () => createToolRegistry(createDreamTools(tz), { today }),
              faultMap,
            );

      const config: AgentConfig = {
        maxSteps,
        contextBudget,
        tokenBudget: 60000,
        loopTimeoutMs: LOOP_TIMEOUT_MS,
        toolTimeoutMs: 10_000,
        secrets: apiKey ? [apiKey] : [],
        backendUrl: env.STUDIO_STRAPI_URL?.trim() || 'http://localhost:1337',
        price,
        model,
        tz,
      };

      const result = await runAgent(
        {
          llm,
          tools: registry,
          source: fixture,
          clock,
          config,
          history: [],
          signal: controller.signal,
          onProgress: () => {},
          newId: () => randomUUID(),
        },
        c.question,
      );

      const toolCorrect = c.expectedTools ? toolSelectionCorrect(result.trace, c.expectedTools) : undefined;
      const hit = c.expectedFacts ? factHit(result.answer, c.expectedFacts) : undefined;
      const inj = c.category === 'injection' ? injectionPass(result.trace, result.answer, c) : undefined;
      // 终止原因期望只在离线（脚本确定）时强制
      const terminationOk =
        opts.mode === 'offline' && c.expectedTermination ? result.terminationReason === c.expectedTermination : true;
      const passed = terminationOk && toolCorrect !== false && hit !== false && inj !== false;
      if (!passed) {
        failures.push(
          `${c.id}（终止=${result.terminationReason}` +
            `${terminationOk ? '' : `，期望=${c.expectedTermination}`}` +
            `${toolCorrect === false ? '，工具选择错误' : ''}` +
            `${hit === false ? '，事实未命中' : ''}` +
            `${inj === false ? '，注入防护失败' : ''}）`,
        );
      }

      results.push({
        id: c.id,
        category: c.category,
        passed,
        toolCorrect,
        factHit: hit,
        injectionPass: inj,
        terminationReason: result.terminationReason,
        stepCount: result.stepCount,
        totalTokens: result.promptTokens + result.completionTokens,
        cost: result.estimatedCost,
      });
      log(`${passed ? 'PASS' : 'FAIL'}  ${c.id}  [${result.terminationReason}, ${result.stepCount} 步]`);
    }

    const metrics = aggregate(results);
    const backendRequests = guard.blocked;
    const report = buildReport({
      mode: opts.mode,
      model,
      maxSteps,
      contextBudget,
      startedAt,
      metrics,
      results,
      backendRequests,
    });
    const reportPath = await writeReport(report, opts.reportsDir, startedAt);

    log('');
    log(`模式：${opts.mode === 'offline' ? '离线（ScriptedLlm）' : `真实（${model}）`}`);
    log(`用例：${results.length}，通过：${results.filter((r) => r.passed).length}`);
    log(`工具选择正确率：${metrics.toolAccuracy}，事实命中率：${metrics.factHitRate}`);
    log(`backendRequests：${backendRequests}`);
    if (failures.length > 0) log(`未通过：\n  ${failures.join('\n  ')}`);
    log(`报告：${reportPath}`);

    if (opts.baselinePath) {
      const baseline = await loadBaseline(opts.baselinePath);
      log('');
      log(formatComparison(compare(report, baseline)));
    }

    return { exitCode: exitCode(metrics, minToolAccuracy(env)), reportPath, backendRequests, results };
  } finally {
    guard.restore();
  }
}

// ---------------------------------------------------------------- CLI

export interface CliArgs {
  mode: EvalMode;
  baselinePath?: string;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let mode: EvalMode = 'real';
  let baselinePath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--offline') mode = 'offline';
    else if (a === '--real') mode = 'real';
    else if (a === '--baseline') baselinePath = argv[++i];
    else if (a.startsWith('--baseline=')) baselinePath = a.slice('--baseline='.length);
  }
  return { mode, baselinePath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'real') dotenv.config();
  try {
    const outcome = await runEval(args);
    process.exitCode = outcome.exitCode;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

// 被 vitest 导入（测试）时不自动运行；vite-node 的 argv[1] 是其自身入口，故不能比对脚本路径
if (!process.env.VITEST) {
  void main();
}
