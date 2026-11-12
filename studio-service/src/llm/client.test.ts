import { describe, expect, it } from 'vitest';
import { LlmPermanentError, LlmTransientError, OpenAiLlmClient } from './client.js';

const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

const make = (impl: typeof fetch) =>
  new OpenAiLlmClient({ baseUrl: 'http://x/v1/', apiKey: 'k', model: 'm', fetchImpl: impl, timeoutMs: 50 });
const req = { messages: [{ role: 'user' as const, content: 'hi' }] };
const sig = () => new AbortController().signal;

describe('OpenAiLlmClient', () => {
  it('解析内容、工具调用与 usage，并发送 tools/tool_choice', async () => {
    let sent: any;
    const c = make((async (url: any, init: any) => {
      expect(url).toBe('http://x/v1/chat/completions');
      sent = JSON.parse(init.body);
      return json(200, {
        choices: [
          { message: { content: null, tool_calls: [{ id: 'a', function: { name: 't', arguments: '{"q":1}' } }] } },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      });
    }) as typeof fetch);
    const r = await c.chat(
      { ...req, tools: [{ name: 't', description: 'd', parameters: {} }], toolChoice: 'auto' },
      { signal: sig() },
    );
    expect(sent.tool_choice).toBe('auto');
    expect(sent.tools[0].function.name).toBe('t');
    expect(r.toolCalls).toEqual([{ id: 'a', name: 't', argumentsJson: '{"q":1}' }]);
    expect(r.usage).toEqual({ promptTokens: 3, completionTokens: 4 });
  });

  it('usage 缺失返回 undefined', async () => {
    const c = make((async () => json(200, { choices: [{ message: { content: 'ok' } }] })) as typeof fetch);
    const r = await c.chat(req, { signal: sig() });
    expect(r.content).toBe('ok');
    expect(r.usage).toBeUndefined();
  });

  it('5xx、网络错误、超时为瞬时错误', async () => {
    await expect(make((async () => json(503, 'x')) as typeof fetch).chat(req, { signal: sig() })).rejects.toBeInstanceOf(
      LlmTransientError,
    );
    await expect(
      make((async () => { throw new TypeError('fetch failed'); }) as typeof fetch).chat(req, { signal: sig() }),
    ).rejects.toBeInstanceOf(LlmTransientError);
    const hang = ((_u: any, init: any) =>
      new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch;
    await expect(make(hang).chat(req, { signal: sig() })).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('4xx（含 429）与非法格式为永久错误', async () => {
    for (const s of [400, 401, 429]) {
      await expect(make((async () => json(s, 'no')) as typeof fetch).chat(req, { signal: sig() })).rejects.toBeInstanceOf(
        LlmPermanentError,
      );
    }
    await expect(make((async () => json(200, { choices: [] })) as typeof fetch).chat(req, { signal: sig() })).rejects.toBeInstanceOf(
      LlmPermanentError,
    );
    await expect(make((async () => json(200, 'not json')) as typeof fetch).chat(req, { signal: sig() })).rejects.toBeInstanceOf(
      LlmPermanentError,
    );
  });

  it('外部 signal 中止抛 AbortError', async () => {
    const ac = new AbortController();
    const hang = ((_u: any, init: any) =>
      new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch;
    const p = make(hang).chat(req, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
