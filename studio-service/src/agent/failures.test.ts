import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConsecutiveFailures } from './failures.js';
import { TOOL_ERROR_CODES, type ToolResult } from './types.js';

const err = (code: (typeof TOOL_ERROR_CODES)[number]): ToolResult => ({ ok: false, error: { code, message: 'm' } });
const OK: ToolResult = { ok: true, data: [1] };
const EMPTY: ToolResult = { ok: true, data: [], empty: true };

describe('ConsecutiveFailures', () => {
  it('triggers on third execution failure; non-counting errors and empty do not change count', () => {
    const f = new ConsecutiveFailures();
    expect(f.record(err('timeout')).count).toBe(1);
    for (const c of ['invalid_arguments', 'unknown_tool', 'rejected_argument', 'not_found'] as const) {
      expect(f.record(err(c)).count).toBe(1);
    }
    expect(f.record(EMPTY).count).toBe(1);
    expect(f.record(err('internal')).triggered).toBe(false);
    expect(f.record(err('backend_unavailable')).triggered).toBe(true);
  });

  it('success resets', () => {
    const f = new ConsecutiveFailures();
    f.record(err('timeout'));
    f.record(err('timeout'));
    expect(f.record(OK).count).toBe(0);
    expect(f.record(err('timeout')).triggered).toBe(false);
  });

  // Feature: dream-story-and-agent, Property 33: 连续失败计数
  it('Property 33. **Validates: Requirements 10.7**', () => {
    const arbEvent = fc.constantFrom('fail', 'ok', 'neutral');
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 30 }), (events) => {
        const f = new ConsecutiveFailures();
        let run = 0;
        for (const e of events) {
          const r =
            e === 'fail' ? err('timeout') : e === 'ok' ? OK : err('not_found');
          if (e === 'fail') run += 1;
          else if (e === 'ok') run = 0;
          expect(f.record(r).triggered).toBe(e === 'fail' && run === 3);
          if (run === 3) break;
        }
      }),
    );
  });
});
