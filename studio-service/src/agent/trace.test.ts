import { describe, expect, it } from 'vitest';
import {
  makeCompressionTrace,
  makeStepTrace,
  makeSummaryTrace,
  makeToolCallTrace,
  serializeTrace,
  type TraceEntry,
} from './trace.js';

const llm = { promptTokens: 1, completionTokens: 2, durationMs: 3, usageEstimated: false };

describe('trace', () => {
  it('constructors set discriminators and clip preview to 200 chars', () => {
    const call = makeToolCallTrace({
      callId: 'c1', name: 'search_dreams', args: {}, status: 'ok',
      resultBytes: 10, durationMs: 5, resultPreview: 'x'.repeat(500),
    });
    expect(Array.from(call.resultPreview!).length).toBe(200);
    const step = makeStepTrace({ step: 1, startedAtMs: 0, llm, toolCalls: [call] });
    expect(step.kind).toBe('step');
    expect(makeCompressionTrace({ atStep: 2, compressedSteps: [1], tokensBefore: 9, tokensAfter: 3 }).kind).toBe('compression');
    expect(makeSummaryTrace({ reason: 'max_steps', llm }).kind).toBe('summary');
  });

  it('serialization redacts secrets in args, keys and previews', () => {
    const secret = 'sup3r-secret-value';
    const trace: TraceEntry[] = [
      makeStepTrace({
        step: 1, startedAtMs: 0, llm,
        toolCalls: [{
          callId: 'c', name: 'n', args: { q: `a ${secret} b`, [secret]: 1 },
          status: 'rejected', resultBytes: 0, durationMs: 0, resultPreview: secret,
        }],
      }),
    ];
    const json = serializeTrace(trace, [secret]);
    expect(json).not.toContain(secret);
    expect(json).toContain('[REDACTED]');
    expect(JSON.stringify(trace)).toContain(secret); // 原对象未被修改
  });
});
