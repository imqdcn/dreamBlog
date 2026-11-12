/**
 * OpenAI 兼容 Chat Completions 客户端（设计 7.x；需求 10.8、7.11）。
 *
 * 错误分类：
 * - LlmTransientError：网络错误、单次尝试超时、HTTP 5xx（可重试）
 * - LlmPermanentError：HTTP 4xx（含供应商 429）、响应格式不合法（不重试）
 * - 调用方传入的 signal 中止时，抛出 AbortError（由循环映射为 timeout/cancelled）
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatUsage,
  LlmClient,
  ToolCall,
} from '../agent/types.js';

export class LlmTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmTransientError';
  }
}

export class LlmPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmPermanentError';
  }
}

export interface OpenAiClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** 单次尝试超时毫秒，默认 60000 */
  timeoutMs?: number;
}

function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

function toWireMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.toolCalls && m.toolCalls.length > 0) {
    out.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.argumentsJson },
    }));
  }
  if (m.toolCallId !== undefined) out.tool_call_id = m.toolCallId;
  if (m.name !== undefined) out.name = m.name;
  return out;
}

function parseUsage(raw: unknown): ChatUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const p = u.prompt_tokens;
  const c = u.completion_tokens;
  if (typeof p !== 'number' || typeof c !== 'number' || !Number.isFinite(p) || !Number.isFinite(c)) {
    return undefined;
  }
  return { promptTokens: p, completionTokens: c };
}

function parseToolCalls(raw: unknown): ToolCall[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new LlmPermanentError('LLM 响应格式不合法：tool_calls 不是数组');
  return raw.map((item, i) => {
    const t = item as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = t?.function?.name;
    const args = t?.function?.arguments;
    if (typeof name !== 'string' || name.length === 0) {
      throw new LlmPermanentError(`LLM 响应格式不合法：tool_calls[${i}] 缺少函数名`);
    }
    return {
      id: typeof t.id === 'string' && t.id ? t.id : `call_${i}`,
      name,
      argumentsJson: typeof args === 'string' ? args : '{}',
    };
  });
}

export class OpenAiLlmClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OpenAiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 60000;
  }

  async chat(req: ChatRequest, opts: { signal: AbortSignal }): Promise<ChatResponse> {
    const { signal } = opts;
    if (signal.aborted) throw abortError();

    const body: Record<string, unknown> = {
      model: this.model,
      messages: req.messages.map(toWireMessage),
    };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      if (req.toolChoice) body.tool_choice = req.toolChoice;
    } else if (req.toolChoice === 'none') {
      // 无工具定义时 tool_choice 会被部分供应商拒绝，故不发送
    }

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const combined = AbortSignal.any([signal, timeoutSignal]);

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err) {
      if (signal.aborted) throw abortError();
      if (timeoutSignal.aborted) {
        throw new LlmTransientError(`LLM 请求超时（${this.timeoutMs}ms）`);
      }
      // undici 只给出 "fetch failed"，真正原因（如 UND_ERR_CONNECT_TIMEOUT、ENOTFOUND）在 cause 里
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      const detail = cause?.code ?? cause?.message;
      const base = (err as Error)?.message || 'fetch failed';
      throw new LlmTransientError(detail ? `${base}（${detail}）` : base);
    }

    if (!res.ok) {
      let text = '';
      try {
        text = await res.text();
      } catch {
        /* 忽略读取失败 */
      }
      // 不回显响应体以外的敏感信息；截断避免日志膨胀
      const detail = `LLM 请求返回 ${res.status}：${text.slice(0, 300)}`;
      if (res.status >= 500) throw new LlmTransientError(detail);
      throw new LlmPermanentError(detail);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      if (signal.aborted) throw abortError();
      if (timeoutSignal.aborted) throw new LlmTransientError(`LLM 响应读取超时（${this.timeoutMs}ms）`);
      throw new LlmPermanentError('LLM 响应格式不合法：不是有效 JSON');
    }

    const choices = (json as { choices?: unknown })?.choices;
    const message = Array.isArray(choices)
      ? (choices[0] as { message?: Record<string, unknown> } | undefined)?.message
      : undefined;
    if (!message || typeof message !== 'object') {
      throw new LlmPermanentError('LLM 响应格式不合法：缺少 choices[0].message');
    }

    const rawContent = message.content;
    if (rawContent !== null && rawContent !== undefined && typeof rawContent !== 'string') {
      throw new LlmPermanentError('LLM 响应格式不合法：content 不是字符串');
    }
    const toolCalls = parseToolCalls(message.tool_calls);
    const content = typeof rawContent === 'string' ? rawContent : null;
    if (content === null && toolCalls.length === 0) {
      throw new LlmPermanentError('LLM 响应格式不合法：既无 content 也无 tool_calls');
    }

    return {
      content,
      toolCalls,
      usage: parseUsage((json as { usage?: unknown }).usage),
    };
  }
}
