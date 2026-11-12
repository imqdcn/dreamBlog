import { describe, it, expect } from 'vitest';
import { validateQuestion } from './question';

describe('validateQuestion', () => {
  it('trim 后返回，1–500 边界', () => {
    expect(validateQuestion(' hi ')).toEqual({ ok: true, value: 'hi' });
    expect(validateQuestion('x'.repeat(500)).ok).toBe(true);
    expect(validateQuestion('x'.repeat(501)).ok).toBe(false);
  });
  it('空串、空白、非字符串被拒绝', () => {
    expect(validateQuestion('').ok).toBe(false);
    expect(validateQuestion(' \n\t ').ok).toBe(false);
    expect(validateQuestion(undefined).ok).toBe(false);
  });
});
