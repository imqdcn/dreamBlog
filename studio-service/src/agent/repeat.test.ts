import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { callKey, canonicalize, RepeatTracker } from './repeat.js';

const arbJson: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small' },
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('tree'), { maxLength: 3 }),
    fc.dictionary(fc.string({ maxLength: 4 }), tie('tree'), { maxKeys: 3 }),
  ),
})).tree;

function shuffleKeys(v: unknown, pad: boolean): unknown {
  if (typeof v === 'string') return pad ? `  ${v}\t` : v;
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, pad));
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as object)
        .reverse()
        .map(([k, x]) => [k, shuffleKeys(x, pad)]),
    );
  }
  return v;
}

describe('repeat', () => {
  it('canonicalize sorts keys, trims, drops undefined, recurses', () => {
    expect(canonicalize({ b: ' x ', a: { d: undefined, c: [' y '] } })).toEqual({ a: { c: ['y'] }, b: 'x' });
    expect(callKey('t', { b: 1, a: 2 })).toBe(callKey('t', { a: 2, b: 1 }));
    expect(callKey('t', {})).not.toBe(callKey('u', {}));
  });

  it('third identical call reports isThird, counting every issued call', () => {
    const t = new RepeatTracker();
    expect(t.record('s', { q: 'a' })).toEqual({ count: 1, isThird: false });
    expect(t.record('s', { q: ' a ' })).toEqual({ count: 2, isThird: false });
    expect(t.record('x', { q: 'a' }).count).toBe(1);
    expect(t.record('s', { q: 'a' })).toEqual({ count: 3, isThird: true });
    expect(t.record('s', { q: 'a' }).isThird).toBe(false);
  });

  // Feature: dream-story-and-agent, Property 32: 参数规范化与重复调用检测
  it('Property 32. **Validates: Requirements 10.5**', () => {
    fc.assert(
      fc.property(arbJson, fc.string(), (args, name) => {
        const c = canonicalize(args);
        expect(canonicalize(c)).toEqual(c);
        expect(callKey(name, shuffleKeys(args, true))).toBe(callKey(name, args));
        expect(callKey(name + 'x', args)).not.toBe(callKey(name, args));
      }),
    );
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'b', 'c')), (seq) => {
        const t = new RepeatTracker();
        const seen: Record<string, number> = {};
        for (const k of seq) {
          seen[k] = (seen[k] ?? 0) + 1;
          expect(t.record('tool', { k }).isThird).toBe(seen[k] === 3);
        }
      }),
    );
  });
});
