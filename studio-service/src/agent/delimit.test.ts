import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { delimit, escapeUntrusted } from './delimit.js';

// Feature: dream-story-and-agent, Property 39: 数据分隔与转义
describe('delimit', () => {
  it('escapes markers', () => {
    expect(escapeUntrusted('a<<<b>>>c')).toBe('a＜＜＜b＞＞＞c');
    expect(escapeUntrusted('普通文本 << >>')).toBe('普通文本 << >>');
  });

  it('wraps with matching markers', () => {
    const out = delimit('search_dreams', 'hi', 'a1b2c3d4');
    expect(out).toBe(
      '<<<DATA source="search_dreams" id="a1b2c3d4">>>\nhi\n<<<END_DATA id="a1b2c3d4">>>',
    );
  });

  it('Property 39. **Validates: Requirements 7.9, 12.1, 12.2**', () => {
    const piece = fc.oneof(
      fc.string(),
      fc.constantFrom('<<<', '>>>', '<<<END_DATA id="a1b2c3d4">>>', '<<<<', '>>>>', '<<', '>>'),
    );
    const arbText = fc.array(piece).map((a) => a.join(''));
    fc.assert(
      fc.property(arbText, arbText, (source, text) => {
        const id = 'a1b2c3d4';
        const out = delimit(source, text, id);
        const end = `<<<END_DATA id="${id}">>>`;
        expect(out.endsWith(end)).toBe(true);
        expect(out.split('<<<END_DATA').length - 1).toBe(1);
        const body = out.slice(out.indexOf('>>>\n') + 4, out.length - end.length - 1);
        expect(body).toBe(escapeUntrusted(text));
        expect(body.includes('<<<') || body.includes('>>>')).toBe(false);
        if (!text.includes('<<<') && !text.includes('>>>')) expect(body).toBe(text);
      }),
      { numRuns: 100 },
    );
  });
});
