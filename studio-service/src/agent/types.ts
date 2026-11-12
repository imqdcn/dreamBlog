/** Agent 公共类型（设计 7.1、7.5 ToolResult 信封、附录 AgentResult/Turn）。仅类型，无运行时副作用。 */

import type { DreamRecord, TerminationReason } from '../domain/types.js';
import type { TraceEntry } from './trace.js';

export type { TerminationReason };

// ---------------------------------------------------------------- LLM

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

/** 与 llm/tokens.ts 的 TokenCountMessage 结构兼容。 */
export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  /** assistant 消息发起的工具调用 */
  toolCalls?: ToolCall[];
  /** tool 消息对应的调用 id */
  toolCallId?: string;
  name?: string;
}

/** 与 llm/tokens.ts 的 TokenCountTool 结构兼容（JSON Schema 放在 parameters）。 */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: 'auto' | 'none';
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: ChatUsage;
}

export interface LlmClient {
  /** 抛 LlmTransientError | LlmPermanentError；signal 中止时抛 AbortError。 */
  chat(req: ChatRequest, opts: { signal: AbortSignal }): Promise<ChatResponse>;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

// ---------------------------------------------------------------- 工具结果信封

export const TOOL_ERROR_CODES = [
  'invalid_arguments',
  'unknown_tool',
  'rejected_argument',
  'not_found',
  'backend_unavailable',
  'timeout',
  'internal',
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/** 计入连续失败（tool_failure）的执行类失败。 */
export const EXECUTION_FAILURE_CODES: readonly ToolErrorCode[] = [
  'backend_unavailable',
  'timeout',
  'internal',
];

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  fields?: { name: string; expected: string }[];
  availableTools?: string[];
}

export type ToolResult =
  | { ok: true; data: unknown; empty?: boolean; truncated?: boolean; omitted?: number }
  | { ok: false; error: ToolError };

// ---------------------------------------------------------------- 依赖

/** 工具只能拿到只读数据源（与 backend/dream-source.ts 的 ReadOnlyDreamSource 结构一致）。 */
export interface ReadOnlyDreamSource {
  listAll(signal: AbortSignal): Promise<DreamRecord[]>;
  getByDocumentId(id: string, signal: AbortSignal): Promise<DreamRecord | null>;
}

/** 工具注册表的循环侧视图；具体实现见 agent/tools。 */
export interface ToolRegistry {
  specs(): ToolSpec[];
  names(): string[];
  execute(
    call: ToolCall,
    ctx: { source: ReadOnlyDreamSource; signal: AbortSignal },
  ): Promise<ToolResult>;
}

export interface Turn {
  question: string;
  answer: string;
}

export type ProgressEvent =
  | { type: 'step_started'; step: number }
  | { type: 'tool_started'; step: number; name: string }
  | { type: 'tool_finished'; step: number; name: string; status: 'ok' | 'error' }
  | { type: 'step_finished'; step: number };

export interface AgentConfig {
  maxSteps: number;
  contextBudget: number;
  tokenBudget: number;
  loopTimeoutMs: number;
  toolTimeoutMs: number;
  secrets: string[];
  backendUrl: string;
  price: { inPerM: number; outPerM: number };
  model: string;
  /** 用于系统指令中的当前日期；缺省 Asia/Shanghai */
  tz?: string;
}

export interface AgentDeps {
  llm: LlmClient;
  tools: ToolRegistry;
  source: ReadOnlyDreamSource;
  clock: Clock;
  config: AgentConfig;
  /** 最近 3 轮问答 */
  history: Turn[];
  /** 由 RunHandle 持有，取消与超时都会触发 */
  signal: AbortSignal;
  onProgress(e: ProgressEvent): void;
  newId(): string;
}

export interface AgentResult {
  runId: string;
  answer: string;
  terminationReason: TerminationReason;
  redacted: boolean;
  trace: TraceEntry[];
  stepCount: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  usageEstimated: boolean;
  durationMs: number;
  model: string;
}
