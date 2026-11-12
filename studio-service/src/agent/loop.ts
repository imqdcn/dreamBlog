/**
 * Agent 主循环（设计 7.2–7.4、7.10；需求 9.8、9.11、9.13、10.2–10.11、10.13、10.15、11.1、11.4、12.5–12.7、12.10、13.2、13.4）。
 *
 * 状态机：Prepare → Gate → Compress → CallLLM → Execute → Gate …
 * 不读环境变量、不直接 fetch、不读系统时钟；所有副作用经 AgentDeps 注入。
 */

import { calcCost, estimateUsage } from '../llm/tokens.js';
import { errorFields, logger } from '../logger.js';
import type { TerminationReason } from '../domain/types.js';
import { fitContext, type AgentContext, type ContextStep, toMessages } from './context.js';
import { delimit } from './delimit.js';
import { ConsecutiveFailures } from './failures.js';
import { guardArgs } from './guard.js';
import { limitResult } from './limit-result.js';
import {
  ANSWER_CANCELLED,
  ANSWER_CONTEXT_OVER_BUDGET,
  ANSWER_LLM_FAILURE,
  ANSWER_SUMMARY_FAILED,
  ANSWER_TIMEOUT,
  ANSWER_TOKEN_BUDGET,
  buildSummarySystemInstruction,
  buildSystemInstruction,
  toolFailureAnswer,
} from './prompt.js';
import { checkOutput } from './redact.js';
import { canonicalize, RepeatTracker } from './repeat.js';
import { callWithRetry } from './retry.js';
import {
  makeStepTrace,
  makeSummaryTrace,
  makeToolCallTrace,
  redactTrace,
  utf8Bytes,
  type StepLlmTrace,
  type ToolCallTrace,
  type TraceEntry,
} from './trace.js';
import type {
  AgentDeps,
  AgentResult,
  ChatMessage,
  ChatResponse,
  ToolCall,
  ToolResult,
} from './types.js';

const fail = (
  code: Extract<ToolResult, { ok: false }>['error']['code'],
  message: string,
  extra: Partial<Extract<ToolResult, { ok: false }>['error']> = {},
): ToolResult => ({ ok: false, error: { code, message, ...extra } });

function isTimeoutReason(reason: unknown): boolean {
  if (reason === 'timeout') return true;
  return reason instanceof Error && (reason.name === 'TimeoutError' || reason.message === 'timeout');
}

/** 并行执行单个工具调用：独立 10 秒超时，并随 Run 的 signal 一起中止。 */
async function executeOne(call: ToolCall, deps: AgentDeps): Promise<ToolResult> {
  const timeoutSignal = AbortSignal.timeout(deps.config.toolTimeoutMs);
  const sig = AbortSignal.any([deps.signal, timeoutSignal]);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<ToolResult>((resolve) => {
    onAbort = () => resolve(fail('timeout', '工具调用超时或已中止'));
    if (sig.aborted) onAbort();
    else sig.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      deps.tools.execute(call, { source: deps.source, signal: sig }),
      aborted,
    ]);
  } catch (err) {
    if (!sig.aborted) {
      logger.error('agent tool execution threw', undefined, { tool: call.name, callId: call.id, ...errorFields(err) });
    }
    return sig.aborted ? fail('timeout', '工具调用超时或已中止') : fail('internal', '工具执行出错');
  } finally {
    if (onAbort) sig.removeEventListener('abort', onAbort);
  }
}

function parseArgs(argumentsJson: string): { parsed: boolean; value: unknown } {
  const text = argumentsJson.trim();
  if (text === '') return { parsed: true, value: {} };
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch {
    return { parsed: false, value: argumentsJson };
  }
}

export async function runAgent(deps: AgentDeps, question: string): Promise<AgentResult> {
  const { config, clock, signal } = deps;
  const startedAt = clock.now();
  const runId = deps.newId();
  const dataId = runId.replace(/[^0-9a-f]/gi, '').slice(0, 8).padEnd(8, '0');

  // ------------------------------------------------------------ Prepare
  const toolSpecs = deps.tools.specs();
  const systemText = buildSystemInstruction({ clock, tz: config.tz });
  const history: ChatMessage[] = [];
  for (const t of deps.history) {
    history.push({ role: 'user', content: t.question }, { role: 'assistant', content: t.answer });
  }
  let ctx: AgentContext = {
    system: { role: 'system', content: systemText },
    history,
    question: { role: 'user', content: question },
    steps: [],
    tools: toolSpecs,
  };

  const trace: TraceEntry[] = [];
  const repeat = new RepeatTracker();
  const failures = new ConsecutiveFailures();
  let stepCount = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let usageEstimated = false;

  const finish = (reason: TerminationReason, rawAnswer: string): AgentResult => {
    const checked = checkOutput(rawAnswer, config.secrets);
    return {
      runId,
      answer: checked.answer,
      terminationReason: reason,
      redacted: checked.redacted,
      trace: redactTrace(trace, config.secrets),
      stepCount,
      promptTokens,
      completionTokens,
      estimatedCost: calcCost(promptTokens, completionTokens, config.price),
      usageEstimated,
      durationMs: Math.max(0, clock.now() - startedAt),
      model: config.model,
    };
  };

  /** 超时优先于取消；返回 null 表示未中止。 */
  const abortReason = (): 'timeout' | 'cancelled' | null => {
    if (clock.now() - startedAt >= config.loopTimeoutMs) return 'timeout';
    if (signal.aborted) return isTimeoutReason(signal.reason) ? 'timeout' : 'cancelled';
    return null;
  };
  const abortResult = (r: 'timeout' | 'cancelled'): AgentResult =>
    finish(r, r === 'timeout' ? ANSWER_TIMEOUT : ANSWER_CANCELLED);

  const addUsage = (
    req: { messages: ChatMessage[]; tools?: unknown },
    res: ChatResponse,
  ): { promptTokens: number; completionTokens: number; usageEstimated: boolean } => {
    let u = res.usage;
    let estimated = false;
    if (!u) {
      estimated = true;
      const input = JSON.stringify(req.messages) + (req.tools ? JSON.stringify(req.tools) : '');
      const output =
        (res.content ?? '') + res.toolCalls.map((c) => `${c.name}${c.argumentsJson}`).join('');
      u = estimateUsage(input, output);
    }
    promptTokens += u.promptTokens;
    completionTokens += u.completionTokens;
    if (estimated) usageEstimated = true;
    return { promptTokens: u.promptTokens, completionTokens: u.completionTokens, usageEstimated: estimated };
  };

  // ------------------------------------------------------------ 总结调用
  const summarize = async (reason: 'max_steps' | 'repeated_call'): Promise<AgentResult> => {
    const ab = abortReason();
    if (ab) return abortResult(ab);

    const zero = { promptTokens: 0, completionTokens: 0, durationMs: 0, usageEstimated: false };
    const failed = (llm = zero): AgentResult => {
      trace.push(makeSummaryTrace({ reason, llm, failed: true }));
      return finish(reason, ANSWER_SUMMARY_FAILED);
    };

    if (promptTokens + completionTokens >= config.tokenBudget) return failed();

    const sumCtx: AgentContext = {
      ...ctx,
      system: { role: 'system', content: buildSummarySystemInstruction(systemText) },
      tools: undefined,
    };
    const fitted = fitContext(sumCtx, config.contextBudget, { atStep: stepCount + 1 });
    trace.push(...fitted.traces);
    if (!fitted.ok) return failed();

    const messages = toMessages(fitted.ctx);
    const t0 = clock.now();
    try {
      const res = await callWithRetry(
        (sig) => deps.llm.chat({ messages, toolChoice: 'none' }, { signal: sig }),
        clock,
        signal,
      );
      const u = addUsage({ messages }, res);
      const llm = { ...u, durationMs: Math.max(0, clock.now() - t0) };
      const text = (res.content ?? '').trim();
      if (text === '') return failed(llm);
      trace.push(makeSummaryTrace({ reason, llm }));
      return finish(reason, text);
    } catch (err) {
      const ab2 = abortReason();
      if (ab2) return abortResult(ab2);
      logger.error('agent summary llm call failed', runId, { reason, model: config.model, ...errorFields(err) });
      return failed({ ...zero, durationMs: Math.max(0, clock.now() - t0) });
    }
  };

  // ------------------------------------------------------------ 主循环
  for (;;) {
    // Gate：timeout > cancelled > token_budget > max_steps
    const ab = abortReason();
    if (ab) return abortResult(ab);
    if (promptTokens + completionTokens >= config.tokenBudget) {
      return finish('token_budget', ANSWER_TOKEN_BUDGET);
    }
    if (stepCount >= config.maxSteps) return summarize('max_steps');

    // Compress
    const fitted = fitContext(ctx, config.contextBudget, { atStep: stepCount + 1 });
    trace.push(...fitted.traces);
    ctx = fitted.ctx;
    if (!fitted.ok) return finish('token_budget', ANSWER_CONTEXT_OVER_BUDGET);

    // CallLLM
    const step = ++stepCount;
    const stepStart = clock.now();
    deps.onProgress({ type: 'step_started', step });
    const messages = toMessages(ctx);
    let res: ChatResponse;
    try {
      res = await callWithRetry(
        (sig) => deps.llm.chat({ messages, tools: toolSpecs, toolChoice: 'auto' }, { signal: sig }),
        clock,
        signal,
      );
    } catch (err) {
      const llmTrace: StepLlmTrace = {
        promptTokens: 0,
        completionTokens: 0,
        durationMs: Math.max(0, clock.now() - stepStart),
        usageEstimated: false,
      };
      const ab2 = abortReason();
      if (ab2) llmTrace.aborted = true;
      trace.push(makeStepTrace({ step, startedAtMs: stepStart - startedAt, llm: llmTrace }));
      deps.onProgress({ type: 'step_finished', step });
      if (ab2) return abortResult(ab2);
      logger.error('agent llm call failed', runId, { step, model: config.model, ...errorFields(err) });
      return finish('llm_failure', ANSWER_LLM_FAILURE);
    }

    const usage = addUsage({ messages, tools: toolSpecs }, res);
    const llmTrace: StepLlmTrace = {
      ...usage,
      durationMs: Math.max(0, clock.now() - stepStart),
    };

    // 无工具调用 → answered
    if (res.toolCalls.length === 0) {
      trace.push(makeStepTrace({ step, startedAtMs: stepStart - startedAt, llm: llmTrace }));
      deps.onProgress({ type: 'step_finished', step });
      return finish('answered', res.content ?? '');
    }

    // ---------------------------------------------------------- Execute
    const calls = res.toolCalls;
    const parsedArgs = calls.map((c) => parseArgs(c.argumentsJson));
    const canonArgs = parsedArgs.map((p) => (p.parsed ? canonicalize(p.value) : p.value));

    // 重复检测：累计所有发起过的调用；出现第 3 次则整步不执行
    let hasThird = false;
    calls.forEach((c, i) => {
      if (repeat.record(c.name, canonArgs[i]).isThird) hasThird = true;
    });
    if (hasThird) {
      const skipped = calls.map((c, i) =>
        makeToolCallTrace({
          callId: c.id,
          name: c.name,
          args: canonArgs[i],
          status: 'skipped',
          resultBytes: 0,
          durationMs: 0,
        }),
      );
      trace.push(
        makeStepTrace({ step, startedAtMs: stepStart - startedAt, llm: llmTrace, toolCalls: skipped }),
      );
      deps.onProgress({ type: 'step_finished', step });
      // 本步的 assistant 消息不进入 ctx，避免留下没有 tool 消息的 tool_calls
      return summarize('repeated_call');
    }

    const knownNames = new Set(deps.tools.names());
    const results: (ToolResult | undefined)[] = new Array(calls.length).fill(undefined);
    const previews: (string | undefined)[] = new Array(calls.length).fill(undefined);
    const statuses: ToolCallTrace['status'][] = new Array(calls.length).fill('ok');
    const durations: number[] = new Array(calls.length).fill(0);
    const pending: number[] = [];

    // 预检（顺序）
    calls.forEach((c, i) => {
      deps.onProgress({ type: 'tool_started', step, name: c.name });
      if (!knownNames.has(c.name)) {
        results[i] = fail('unknown_tool', `未知工具：${c.name.slice(0, 100)}`, {
          availableTools: deps.tools.names(),
        });
        return;
      }
      const rule = guardArgs(parsedArgs[i]!.value, {
        backendUrl: config.backendUrl,
        secrets: config.secrets,
      });
      if (rule) {
        results[i] = fail('rejected_argument', `参数被安全规则拒绝（${rule}）`);
        statuses[i] = 'rejected';
        previews[i] = `rejected: ${rule}`;
        return;
      }
      pending.push(i);
    });

    // 并行执行，按原顺序回填
    const settled = await Promise.allSettled(
      pending.map(async (i) => {
        const t0 = clock.now();
        const r = await executeOne(calls[i]!, deps);
        durations[i] = Math.max(0, clock.now() - t0);
        return r;
      }),
    );
    settled.forEach((s, k) => {
      const i = pending[k]!;
      results[i] =
        s.status === 'fulfilled' ? s.value : fail('internal', '工具执行出错');
    });

    // 回填、Trace、连续失败计数（按调用顺序）
    const toolMessages: ChatMessage[] = [];
    const toolTraces: ToolCallTrace[] = [];
    const runAborted = abortReason() !== null;
    let failureTrigger: { name: string; code: string } | null = null;
    calls.forEach((c, i) => {
      const r = limitResult(results[i]!);
      const text = JSON.stringify(r);
      toolMessages.push({
        role: 'tool',
        toolCallId: c.id,
        name: c.name,
        content: delimit(c.name, text, dataId),
      });
      const status: ToolCallTrace['status'] = statuses[i] === 'rejected' ? 'rejected' : r.ok ? 'ok' : 'error';
      toolTraces.push(
        makeToolCallTrace({
          callId: c.id,
          name: c.name,
          args: canonArgs[i],
          status,
          errorCode: r.ok ? undefined : r.error.code,
          empty: r.ok && r.empty ? true : undefined,
          truncated: r.ok && r.truncated ? true : undefined,
          resultBytes: utf8Bytes(text),
          durationMs: durations[i]!,
          resultPreview: previews[i] ?? text,
        }),
      );
      deps.onProgress({ type: 'tool_finished', step, name: c.name, status: r.ok ? 'ok' : 'error' });
      // 因 Run 中止产生的超时不代表数据服务不稳定
      if (!runAborted) {
        const f = failures.record(r);
        if (f.triggered && !failureTrigger) {
          failureTrigger = { name: c.name, code: r.ok ? 'unknown' : r.error.code };
        }
      }
    });

    trace.push(
      makeStepTrace({ step, startedAtMs: stepStart - startedAt, llm: llmTrace, toolCalls: toolTraces }),
    );
    deps.onProgress({ type: 'step_finished', step });

    const contextStep: ContextStep = {
      index: step,
      assistant: { role: 'assistant', content: res.content, toolCalls: calls },
      tools: toolMessages,
    };
    ctx = { ...ctx, steps: [...ctx.steps, contextStep] };

    if (failureTrigger) {
      const ft = failureTrigger as { name: string; code: string };
      return finish('tool_failure', toolFailureAnswer(ft.name, ft.code));
    }
  }
}
