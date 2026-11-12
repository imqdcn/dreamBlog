/** Trace 类型与构造（设计 7.11；需求 13.2、11.7）。序列化前对所有字符串脱敏（设计 7.7 第 6 点）。 */

import { redactSecrets } from './redact.js';

export const RESULT_PREVIEW_MAX = 200;

export interface StepLlmTrace {
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  usageEstimated: boolean;
  aborted?: boolean;
}

export type ToolCallStatus = 'ok' | 'error' | 'rejected' | 'skipped';

export interface ToolCallTrace {
  callId: string;
  name: string;
  /** 规范化后的参数（序列化时脱敏） */
  args: unknown;
  status: ToolCallStatus;
  errorCode?: string;
  empty?: boolean;
  truncated?: boolean;
  /** UTF-8 字节数 */
  resultBytes: number;
  durationMs: number;
  /** ≤ 200 字符，已脱敏 */
  resultPreview?: string;
}

export interface StepTrace {
  kind: 'step';
  /** 从 1 开始连续递增，不含 summary */
  step: number;
  /** 相对 Run 开始 */
  startedAtMs: number;
  llm: StepLlmTrace;
  toolCalls: ToolCallTrace[];
}

export interface CompressionTrace {
  kind: 'compression';
  atStep: number;
  trigger: 'over_budget_before_llm_call';
  compressedSteps: number[];
  tokensBefore: number;
  tokensAfter: number;
}

export interface SummaryTrace {
  kind: 'summary';
  reason: 'max_steps' | 'repeated_call';
  llm: Omit<StepLlmTrace, 'aborted'>;
  failed?: boolean;
}

export type TraceEntry = StepTrace | CompressionTrace | SummaryTrace;

// ---------------------------------------------------------------- 构造函数

export function makeToolCallTrace(input: ToolCallTrace): ToolCallTrace {
  const t: ToolCallTrace = { ...input };
  if (t.resultPreview !== undefined) t.resultPreview = clip(t.resultPreview, RESULT_PREVIEW_MAX);
  return t;
}

export function makeStepTrace(input: {
  step: number;
  startedAtMs: number;
  llm: StepLlmTrace;
  toolCalls?: ToolCallTrace[];
}): StepTrace {
  return {
    kind: 'step',
    step: input.step,
    startedAtMs: input.startedAtMs,
    llm: { ...input.llm },
    toolCalls: (input.toolCalls ?? []).map(makeToolCallTrace),
  };
}

export function makeCompressionTrace(input: {
  atStep: number;
  compressedSteps: number[];
  tokensBefore: number;
  tokensAfter: number;
}): CompressionTrace {
  return {
    kind: 'compression',
    atStep: input.atStep,
    trigger: 'over_budget_before_llm_call',
    compressedSteps: [...input.compressedSteps],
    tokensBefore: input.tokensBefore,
    tokensAfter: input.tokensAfter,
  };
}

export function makeSummaryTrace(input: {
  reason: 'max_steps' | 'repeated_call';
  llm: Omit<StepLlmTrace, 'aborted'>;
  failed?: boolean;
}): SummaryTrace {
  const t: SummaryTrace = { kind: 'summary', reason: input.reason, llm: { ...input.llm } };
  if (input.failed) t.failed = true;
  return t;
}

/** 按 Unicode 码点截断，超长追加 `…`（总长不超过 max）。 */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max - 1).join('') + '…';
}

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

// ---------------------------------------------------------------- 脱敏与序列化

function redactDeep(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[redactSecrets(k, secrets)] = redactDeep(v, secrets);
    }
    return out;
  }
  return value;
}

/** 返回脱敏后的深拷贝；不修改入参。 */
export function redactTrace(trace: readonly TraceEntry[], secrets: readonly string[]): TraceEntry[] {
  return redactDeep(trace, secrets) as TraceEntry[];
}

/** 序列化前脱敏：持久化与日志只应使用此函数的输出。 */
export function serializeTrace(trace: readonly TraceEntry[], secrets: readonly string[]): string {
  return JSON.stringify(redactTrace(trace, secrets));
}
