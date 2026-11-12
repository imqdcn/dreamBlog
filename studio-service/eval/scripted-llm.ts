/**
 * 脚本化 LLM 替身（设计 9.2，需求 15.11）。离线评估按用例 `script` 回放，费用为 0。
 * 支持故障注入：前 k 次抛瞬时错误、超大 usage（token_budget）、
 * 永远返回新参数的工具调用（max_steps）、重复同一调用（repeated_call）。
 */

import type {
  ChatRequest,
  ChatResponse,
  ChatUsage,
  LlmClient,
  ToolCall,
} from '../src/agent/types.js';
import { LlmPermanentError, LlmTransientError } from '../src/llm/client.js';

export interface ScriptedToolCall {
  name: string;
  /** 对象会被 JSON.stringify；字符串原样作为 argumentsJson（可用于非法 JSON） */
  arguments?: Record<string, unknown> | string;
  id?: string;
}

/** 脚本中的一步响应：工具调用、最终回答，或抛错。 */
export type ScriptStep =
  | { type: 'tool_calls'; calls: ScriptedToolCall[]; content?: string | null; usage?: ChatUsage }
  | { type: 'final'; content: string; usage?: ChatUsage }
  | { type: 'error'; kind: 'transient' | 'permanent'; message?: string };

export interface ScriptFaults {
  /** 前 k 次 chat 调用抛 LlmTransientError（不消耗脚本步骤） */
  transientFirst?: number;
  /** 所有响应的 usage 替换为该超大值，用于触发 token_budget */
  hugeUsage?: ChatUsage;
  /** 脚本耗尽后永远返回参数各不相同的工具调用，用于触发 max_steps */
  endlessNewParams?: { tool: string; paramName?: string };
  /** 脚本耗尽后永远重复同一工具调用，用于触发 repeated_call */
  repeatCall?: ScriptedToolCall;
}

export interface CaseScript {
  script?: ScriptStep[];
  faults?: ScriptFaults;
}

export const DEFAULT_SCRIPTED_USAGE: ChatUsage = { promptTokens: 0, completionTokens: 0 };
export const HUGE_USAGE: ChatUsage = { promptTokens: 10_000_000, completionTokens: 10_000_000 };

export class ScriptedLlm implements LlmClient {
  private calls = 0;
  private cursor = 0;
  private generated = 0;
  private readonly script: ScriptStep[];
  private readonly faults: ScriptFaults;

  constructor(spec: CaseScript = {}) {
    this.script = spec.script ?? [];
    this.faults = spec.faults ?? {};
  }

  /** 已收到的 chat 调用次数（含抛错的）。 */
  get callCount(): number {
    return this.calls;
  }

  async chat(_req: ChatRequest, opts: { signal: AbortSignal }): Promise<ChatResponse> {
    if (opts.signal.aborted) throw abortError();
    this.calls += 1;

    if (this.calls <= (this.faults.transientFirst ?? 0)) {
      throw new LlmTransientError('scripted transient failure');
    }

    const step = this.nextStep();
    if (step.type === 'error') {
      const msg = step.message ?? `scripted ${step.kind} failure`;
      throw step.kind === 'transient' ? new LlmTransientError(msg) : new LlmPermanentError(msg);
    }

    const usage = this.faults.hugeUsage ?? step.usage ?? DEFAULT_SCRIPTED_USAGE;
    if (step.type === 'final') {
      return { content: step.content, toolCalls: [], usage: { ...usage } };
    }
    return {
      content: step.content ?? null,
      toolCalls: step.calls.map((c) => this.toToolCall(c)),
      usage: { ...usage },
    };
  }

  private nextStep(): ScriptStep {
    if (this.cursor < this.script.length) return this.script[this.cursor++]!;

    const { endlessNewParams, repeatCall } = this.faults;
    if (endlessNewParams) {
      this.generated += 1;
      const key = endlessNewParams.paramName ?? 'query';
      return {
        type: 'tool_calls',
        calls: [{ name: endlessNewParams.tool, arguments: { [key]: `scripted-${this.generated}` } }],
      };
    }
    if (repeatCall) return { type: 'tool_calls', calls: [repeatCall] };

    // 脚本耗尽且无故障生成器：以固定回答收尾，避免离线评估挂起
    return { type: 'final', content: '（脚本已耗尽）' };
  }

  private toToolCall(c: ScriptedToolCall): ToolCall {
    this.generated += c.id ? 0 : 1;
    return {
      id: c.id ?? `scripted-call-${this.calls}-${this.generated}`,
      name: c.name,
      argumentsJson:
        typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}),
    };
  }
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}
