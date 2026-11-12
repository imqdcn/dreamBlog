/** 上下文管理与压缩（设计 7.6；需求 11.1–11.4、11.7）。纯函数，不调用 LLM，不修改入参。 */

import { estimateMessagesTokens } from '../llm/tokens.js';
import type { ChatMessage, ToolSpec } from './types.js';
import { makeCompressionTrace, type CompressionTrace } from './trace.js';

export const DIGEST_MAX = 200;
export const DIGEST_PREFIX = '[已压缩] ';
/** 最近 N 个已完成步骤不压缩 */
export const PROTECTED_RECENT_STEPS = 2;

/** 一个 Agent_Step：assistant 的 tool_calls 与对应的 tool 消息。 */
export interface ContextStep {
  /** 从 1 开始的步骤序号 */
  index: number;
  assistant: ChatMessage;
  tools: ChatMessage[];
  compressed?: boolean;
}

export interface AgentContext {
  /** 系统指令（含日期与分隔区约定） */
  system: ChatMessage;
  /** 历史问答消息（user/assistant 交替） */
  history: ChatMessage[];
  /** 当前问题 */
  question: ChatMessage;
  steps: ContextStep[];
  /** 计入 token 估算的工具 JSON Schema */
  tools?: ToolSpec[];
}

export type FitContextResult =
  | { ok: true; ctx: AgentContext; traces: CompressionTrace[] }
  | { ok: false; reason: 'token_budget'; ctx: AgentContext; traces: CompressionTrace[] };

/** 展开为发送给 LLM 的消息列表。 */
export function toMessages(ctx: AgentContext): ChatMessage[] {
  const out: ChatMessage[] = [ctx.system, ...ctx.history, ctx.question];
  for (const s of ctx.steps) out.push(s.assistant, ...s.tools);
  return out;
}

export function estimateContext(ctx: AgentContext): number {
  return estimateMessagesTokens(toMessages(ctx), ctx.tools as ReadonlyArray<Record<string, unknown>> | undefined);
}

// ---------------------------------------------------------------- digest

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max - 1).join('') + '…';
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      out[k] = canonical((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function canonicalArgs(argumentsJson: string): string {
  try {
    return JSON.stringify(canonical(JSON.parse(argumentsJson)));
  } catch {
    return argumentsJson;
  }
}

function pickTitle(item: unknown): string | undefined {
  if (item === null || typeof item !== 'object') return undefined;
  const t = (item as Record<string, unknown>).title;
  return typeof t === 'string' ? t : undefined;
}

/** 确定性摘要：`[已压缩] 工具名(规范化参数) → ok|error:code，N 项；首项：title`，≤ 200 字符。 */
export function digest(toolName: string, argumentsJson: string, content: string | null): string {
  let status = 'ok';
  let tail = '';
  try {
    // 工具结果被 <<<DATA ...>>> 包裹时先取出中间的 JSON
    const body = (content ?? '').replace(/^<<<DATA[^\n]*\n/, '').replace(/\n<<<END_DATA[^\n]*$/, '');
    const r = JSON.parse(body) as {
      ok?: boolean;
      error?: { code?: string };
      data?: unknown;
    };
    if (r && r.ok === false) {
      status = `error:${r.error?.code ?? 'unknown'}`;
    } else if (r && Array.isArray(r.data)) {
      tail = `，${r.data.length} 项`;
      const title = r.data.length > 0 ? pickTitle(r.data[0]) : undefined;
      if (title !== undefined) tail += `；首项：${title}`;
    } else if (r && r.data !== null && typeof r.data === 'object') {
      const title = pickTitle(r.data);
      if (title !== undefined) tail = `，1 项；首项：${title}`;
    }
  } catch {
    // 非 JSON 内容：仅给出状态
  }
  return clip(`${DIGEST_PREFIX}${toolName}(${canonicalArgs(argumentsJson)}) → ${status}${tail}`, DIGEST_MAX);
}

function compressStep(step: ContextStep): ContextStep {
  const tools = step.tools.map((m): ChatMessage => {
    const call = step.assistant.toolCalls?.find((c) => c.id === m.toolCallId);
    const name = call?.name ?? m.name ?? 'unknown';
    return { ...m, content: digest(name, call?.argumentsJson ?? '{}', m.content) };
  });
  return { ...step, tools, compressed: true };
}

// ---------------------------------------------------------------- fitContext

/**
 * 每次 LLM 请求前调用。受保护：系统指令、历史、当前问题、最近 2 个已完成步骤。
 * 其余步骤按序号从小到大压缩，直到估算 ≤ budget；无可压缩步骤仍超出则返回 token_budget。
 * 已压缩的步骤不会再次被选中（幂等）。
 */
export function fitContext(
  ctx: AgentContext,
  budget: number,
  opts: { atStep?: number } = {},
): FitContextResult {
  const tokensBefore = estimateContext(ctx);
  if (tokensBefore <= budget) return { ok: true, ctx, traces: [] };

  const steps = [...ctx.steps];
  const protectedFrom = Math.max(0, steps.length - PROTECTED_RECENT_STEPS);
  const order = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i < protectedFrom && !s.compressed)
    .sort((a, b) => a.s.index - b.s.index);

  const compressed: number[] = [];
  let current: AgentContext = { ...ctx, steps };
  let tokens = tokensBefore;
  for (const { s, i } of order) {
    if (tokens <= budget) break;
    steps[i] = compressStep(s);
    compressed.push(s.index);
    current = { ...ctx, steps };
    tokens = estimateContext(current);
  }

  const traces: CompressionTrace[] = [];
  if (compressed.length > 0) {
    const last = ctx.steps[ctx.steps.length - 1];
    traces.push(
      makeCompressionTrace({
        atStep: opts.atStep ?? (last ? last.index + 1 : 1),
        compressedSteps: compressed,
        tokensBefore,
        tokensAfter: tokens,
      }),
    );
  }
  return tokens <= budget
    ? { ok: true, ctx: current, traces }
    : { ok: false, reason: 'token_budget', ctx: current, traces };
}
