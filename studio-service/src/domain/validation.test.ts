import { describe, expect, it } from 'vitest';
import { validateDreamContent, validateFavoriteBody, validateQuestion } from './validation.js';

describe('validation', () => {
  it('validateDreamContent trims and bounds 1-10000', () => {
    expect(validateDreamContent('  a  ')).toEqual({ ok: true, value: 'a' });
    expect(validateDreamContent('   ').ok).toBe(false);
    expect(validateDreamContent('x'.repeat(10000)).ok).toBe(true);
    expect(validateDreamContent('x'.repeat(10001)).ok).toBe(false);
    expect(validateDreamContent(' ' + 'x'.repeat(10000) + ' ').ok).toBe(true);
    expect(validateDreamContent(123).ok).toBe(false);
  });

  it('validateQuestion trims and bounds 1-500', () => {
    expect(validateQuestion(' hi ')).toEqual({ ok: true, value: 'hi' });
    expect(validateQuestion('').ok).toBe(false);
    expect(validateQuestion('x'.repeat(500)).ok).toBe(true);
    expect(validateQuestion('x'.repeat(501)).ok).toBe(false);
    expect(validateQuestion(undefined).ok).toBe(false);
  });

  it('validateFavoriteBody requires boolean isFavorite', () => {
    expect(validateFavoriteBody({ isFavorite: true })).toEqual({ ok: true, value: true });
    expect(validateFavoriteBody({ isFavorite: false })).toEqual({ ok: true, value: false });
    for (const b of [{ isFavorite: 'true' }, { isFavorite: 1 }, {}, null, [], 'x']) {
      expect(validateFavoriteBody(b).ok).toBe(false);
    }
  });
});
