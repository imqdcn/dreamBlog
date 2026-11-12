import { describe, expect, it } from 'vitest';
import { runAgent } from './loop.js';
import { ANSWER_SUMMARY_FAILED } from './prompt.js';
import { SAFE_NOTICE } from './redact.js';
import type {
  AgentDeps,
  ChatRequest,
  ChatResponse,
  LlmClient,
  ToolCall,
  ToolRegistry,
  ToolResult,
} from './types.js';

const SECRET = 'sk-secret-value-123';

function call(id: string, name: string, args: unknown): ToolCall {
  return { id, name, argumentsJson: JSON.stringify(args) };
}
const tc = (calls: ToolCall[]): ChatResponse => ({
  content: null,
  toolCalls: calls,
  usage: { promptTokens: 10, completionTokens: 5 },
});
const text = (s: string, usage = true): ChatResponse => ({
  content: s,
  toolCalls: [],
  usage: usage ? { promptTokens: 10, completionTokens: 5 } : undefined,
});

class Scripted implements LlmClient {
  reqs: ChatRequest[] = [];
  constructor(private script: (ChatResponse | Error)[]) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.reqs.push(req);
    const next = this.script.shift();
    if (!next) throw new Error('script exhausted');
    if (next instanceof Error) throw next;
    return next;
  }
}

function registry(
  impl: (c: ToolCall) => Promise<ToolResult> | ToolResult = () => ({ ok: true, data: [{ title: 't' }] }),
): ToolRegistry & { executed: string[] } {
  const executed: string[] = [];
  return {
    executed,
    specs: () => [{ name: 'search_dreams', description: 'x'.repeat(20), parameters: {} }],
    names: () => ['search_dreams', 'get_dream'],
    execute: async (c) => {
      executed.push(c.id);
      return impl(c);
    },
  };
}

function make(
  llm: LlmClient,
  tools: ToolRegistry,
  over: Partial<AgentDeps['config']> = {},
  signal: AbortSignal = new AbortController().signal,
): AgentDeps {
  let t = 0;
  return {
    llm,
    tools,
    source: { listAll: async () => [], getByDocumentId: async () => null },
    clock: { now: () => (t += 1), sleep: async () => {} },
    config: {
      maxSteps: 3,
      contextBudget: 12000,
      tokenBudget: 60000,
      loopTimeoutMs: 120000,
      toolTimeoutMs: 50,
      secrets: [SECRET],
      backendUrl: 'http://backend.internal:1337',
      price: { inPerM: 1, outPerM: 2 },
      model: 'm',
      ...over,
    },
    history: [],
    signal,
    onProgress: () => {},
    newId: () => 'abcdef12-0000-0000-0000-000000000000',
  };
}

describe('runAgent', () => {
  it('answered：无工具调用直接回答，缺失 usage 时估算并标记', async () => {
    const llm = new Scripted([text('你好', false)]);
    const r = await runAgent(make(llm, registry()), '问');
    expect(r.terminationReason).toBe('answered');
    expect(r.answer).toBe('你好');
    expect(r.stepCount).toBe(1);
    expect(r.usageEstimated).toBe(true);
    expect(r.promptTokens).toBeGreaterThan(0);
  });

  it('回答含密钥取值时整体替换', async () => {
    const r = await runAgent(make(new Scripted([text(`key ${SECRET}`)]), registry()), 'q');
    expect(r.answer).toBe(SAFE_NOTICE);
    expect(r.redacted).toBe(true);
  });

  it('并行调用按顺序回填，未知工具与守卫拒绝不执行', async () => {
    const reg = registry(async (c) => {
      if (c.id === 'a') await new Promise((res) => setTimeout(res, 20));
      return { ok: true, data: [{ title: c.id }] };
    });
    const llm = new Scripted([
      tc([
        call('a', 'search_dreams', { query: 'x' }),
        call('b', 'search_dreams', { query: 'y' }),
        call('c', 'nope', {}),
        call('d', 'search_dreams', { query: 'http://evil.com' }),
      ]),
      text('done'),
    ]);
    const r = await runAgent(make(llm, reg), 'q');
    expect(r.terminationReason).toBe('answered');
    expect(reg.executed.sort()).toEqual(['a', 'b']);
    const second = llm.reqs[1]!.messages.filter((m) => m.role === 'tool');
    expect(second.map((m) => m.toolCallId)).toEqual(['a', 'b', 'c', 'd']);
    expect(second[2]!.content).toContain('search_dreams');
    const step = r.trace.find((e) => e.kind === 'step')!;
    if (step.kind !== 'step') throw new Error();
    expect(step.toolCalls.map((x) => x.status)).toEqual(['ok', 'ok', 'error', 'rejected']);
  });

  it('第 3 次相同调用：整步 skipped，总结调用 toolChoice none 且不计步骤', async () => {
    const same = () => tc([call('x', 'search_dreams', { query: 'a' })]);
    const llm = new Scripted([same(), same(), same(), text('总结')]);
    const reg = registry();
    const r = await runAgent(make(llm, reg, { maxSteps: 8 }), 'q');
    expect(r.terminationReason).toBe('repeated_call');
    expect(r.answer).toBe('总结');
    expect(r.stepCount).toBe(3);
    expect(reg.executed.length).toBe(2);
    const last = llm.reqs[3]!;
    expect(last.toolChoice).toBe('none');
    expect(last.tools).toBeUndefined();
    // 被跳过步骤的 assistant 消息不在总结上下文中
    const assistants = last.messages.filter((m) => m.role === 'assistant');
    expect(assistants.length).toBe(2);
    const steps = r.trace.filter((e) => e.kind === 'step');
    const lastStep = steps[2]!;
    if (lastStep.kind !== 'step') throw new Error();
    expect(lastStep.toolCalls[0]!.status).toBe('skipped');
    expect(r.trace.some((e) => e.kind === 'summary')).toBe(true);
  });

  it('max_steps：总结失败返回固定文案并保留原因', async () => {
    const n = (i: number) => tc([call(`c${i}`, 'search_dreams', { query: `q${i}` })]);
    const llm = new Scripted([n(1), n(2), new (class extends Error {})('boom')]);
    const r = await runAgent(make(llm, registry(), { maxSteps: 2 }), 'q');
    expect(r.terminationReason).toBe('max_steps');
    expect(r.answer).toBe(ANSWER_SUMMARY_FAILED);
    expect(r.stepCount).toBe(2);
  });

  it('token_budget：累计 ≥ 上限时在下一次 Gate 终止', async () => {
    const big: ChatResponse = {
      content: null,
      toolCalls: [call('a', 'search_dreams', { query: 'a' })],
      usage: { promptTokens: 60000, completionTokens: 0 },
    };
    const llm = new Scripted([big]);
    const r = await runAgent(make(llm, registry()), 'q');
    expect(r.terminationReason).toBe('token_budget');
    expect(llm.reqs.length).toBe(1);
  });

  it('tool_failure：连续 3 次执行类失败', async () => {
    const bad = (i: number) => tc([call(`c${i}`, 'search_dreams', { query: `q${i}` })]);
    const reg = registry(() => ({ ok: false, error: { code: 'backend_unavailable', message: 'x' } }));
    const llm = new Scripted([bad(1), bad(2), bad(3)]);
    const r = await runAgent(make(llm, reg, { maxSteps: 8 }), 'q');
    expect(r.terminationReason).toBe('tool_failure');
    expect(r.answer).toContain('search_dreams');
    expect(r.answer).toContain('backend_unavailable');
  });

  it('工具超时：挂起的工具返回 timeout 错误', async () => {
    const reg = registry(() => new Promise<ToolResult>(() => {}));
    const llm = new Scripted([tc([call('a', 'search_dreams', { query: 'a' })]), text('ok')]);
    const r = await runAgent(make(llm, reg), 'q');
    expect(r.terminationReason).toBe('answered');
    const tool = llm.reqs[1]!.messages.find((m) => m.role === 'tool')!;
    expect(tool.content).toContain('timeout');
  });

  it('llm_failure：永久错误不重试', async () => {
    const { LlmPermanentError } = await import('../llm/client.js');
    const llm = new Scripted([new LlmPermanentError('bad')]);
    const r = await runAgent(make(llm, registry()), 'q');
    expect(r.terminationReason).toBe('llm_failure');
    expect(llm.reqs.length).toBe(1);
  });

  it('cancelled / timeout：中止后不再发起 LLM 请求', async () => {
    const c = new AbortController();
    c.abort('cancel');
    const llm = new Scripted([text('x')]);
    const r = await runAgent(make(llm, registry(), {}, c.signal), 'q');
    expect(r.terminationReason).toBe('cancelled');
    expect(llm.reqs.length).toBe(0);

    const c2 = new AbortController();
    c2.abort('timeout');
    const r2 = await runAgent(make(new Scripted([]), registry(), {}, c2.signal), 'q');
    expect(r2.terminationReason).toBe('timeout');
  });

  it('系统指令包含当前日期，且不含密钥', async () => {
    const llm = new Scripted([text('ok')]);
    await runAgent(make(llm, registry()), 'q');
    const sys = llm.reqs[0]!.messages[0]!.content!;
    expect(sys).toMatch(/今天是 \d{4}-\d{2}-\d{2}/);
    expect(sys).not.toContain(SECRET);
  });
});
