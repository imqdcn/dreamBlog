import { describe, it, expect, vi } from 'vitest';
import { LlmProcessor } from './llm-processor.js';

function makeProcessor(fetchImpl?: typeof fetch, enabled = true, maxRetries = 0) {
  return new LlmProcessor({
    enabled,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
    maxRetries,
    retryBaseDelayMs: 1,
    fetchImpl,
  });
}

describe('LlmProcessor.parseAndValidate', () => {
  const p = makeProcessor();

  it('解析合法 JSON', () => {
    const r = p.parseAndValidate(
      JSON.stringify({
        title: '飞翔的梦',
        summary: '梦见自己在城市上空飞行。',
        keywords: ['飞翔', '城市', '自由'],
        emotion: 'joyful',
        emotionScore: 0.8,
        clarity: 4,
      })
    );
    expect(r).not.toBeNull();
    expect(r!.title).toBe('飞翔的梦');
    expect(r!.keywords).toHaveLength(3);
    expect(r!.emotion).toBe('joyful');
    expect(r!.emotionScore).toBe(0.8);
    expect(r!.clarity).toBe(4);
  });

  it('剥离 markdown 代码块围栏', () => {
    const r = p.parseAndValidate(
      '```json\n{"title":"a","summary":"b","keywords":["x"],"emotion":"sad","emotionScore":-0.5}\n```'
    );
    expect(r).not.toBeNull();
    expect(r!.title).toBe('a');
  });

  it('非法 emotion 降级为 neutral', () => {
    const r = p.parseAndValidate(
      JSON.stringify({ title: 't', summary: 's', keywords: ['k'], emotion: '乱七八糟', emotionScore: 0 })
    );
    expect(r!.emotion).toBe('neutral');
  });

  it('emotionScore 越界被裁剪到 [-1,1]', () => {
    const r = p.parseAndValidate(
      JSON.stringify({ title: 't', summary: 's', keywords: ['k'], emotion: 'joyful', emotionScore: 5 })
    );
    expect(r!.emotionScore).toBe(1);
  });

  it('clarity 越界被裁剪到 [1,5]', () => {
    const r = p.parseAndValidate(
      JSON.stringify({ title: 't', summary: 's', keywords: ['k'], emotion: 'joyful', emotionScore: 0, clarity: 9 })
    );
    expect(r!.clarity).toBe(5);
  });

  it('非法 JSON 返回 null', () => {
    expect(p.parseAndValidate('not a json at all')).toBeNull();
  });

  it('全部字段缺失返回 null', () => {
    expect(p.parseAndValidate(JSON.stringify({ emotion: 'joyful' }))).toBeNull();
  });
});

describe('LlmProcessor.enrich', () => {
  it('未启用时直接返回 null，不发请求', async () => {
    const fetchSpy = vi.fn();
    const p = makeProcessor(fetchSpy as unknown as typeof fetch, false);
    const r = await p.enrich('一段梦');
    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('正常返回时解析成功', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: '海边',
                  summary: '梦见海。',
                  keywords: ['海', '沙滩'],
                  emotion: 'peaceful',
                  emotionScore: 0.6,
                  clarity: 3,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const p = makeProcessor(fetchImpl as unknown as typeof fetch);
    const r = await p.enrich('梦见海');
    expect(r).not.toBeNull();
    expect(r!.title).toBe('海边');
    expect(r!.emotion).toBe('peaceful');
  });

  it('HTTP 错误时返回 null（降级）', async () => {
    const fetchImpl = vi.fn(async () => new Response('server error', { status: 500 }));
    const p = makeProcessor(fetchImpl as unknown as typeof fetch);
    const r = await p.enrich('梦');
    expect(r).toBeNull();
  });

  it('网络异常时返回 null（降级）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const p = makeProcessor(fetchImpl as unknown as typeof fetch);
    const r = await p.enrich('梦');
    expect(r).toBeNull();
  });
});

describe('LlmProcessor.enrich 重试', () => {
  function successBody() {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: '海边',
                summary: '梦见海。',
                keywords: ['海'],
                emotion: 'peaceful',
                emotionScore: 0.6,
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  it('fetch failed（瞬时）会重试，恢复后成功', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('fetch failed');
      return successBody();
    });
    const p = makeProcessor(fetchImpl as unknown as typeof fetch, true, 2);
    const r = await p.enrich('梦见海');
    expect(r).not.toBeNull();
    expect(r!.title).toBe('海边');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('5xx（瞬时）会重试', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return n === 1 ? new Response('busy', { status: 503 }) : successBody();
    });
    const p = makeProcessor(fetchImpl as unknown as typeof fetch, true, 2);
    const r = await p.enrich('梦');
    expect(r).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('4xx（永久）不重试', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad model', { status: 400 }));
    const p = makeProcessor(fetchImpl as unknown as typeof fetch, true, 3);
    const r = await p.enrich('梦');
    expect(r).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('瞬时错误耗尽重试后降级返回 null', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const p = makeProcessor(fetchImpl as unknown as typeof fetch, true, 2);
    const r = await p.enrich('梦');
    expect(r).toBeNull();
    // 首次 + 2 次重试 = 3
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
