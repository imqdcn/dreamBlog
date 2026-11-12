import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { InFlightSet, dedupeKey, parseStoryOutput, validateStoryRequest } from './story-request.js';

const yes = () => true;

describe('validateStoryRequest', () => {
  it('accepts a valid request', async () => {
    const r = await validateStoryRequest({ dreamIds: ['a', 'b'], style: 'mystery' }, yes);
    expect(r.ok).toBe(true);
  });
  it.each([
    [{ dreamIds: [], style: 'poetic' }, 'dreamIds must contain'],
    [{ dreamIds: ['1', '2', '3', '4', '5', '6'], style: 'poetic' }, 'dreamIds must contain'],
    [{ dreamIds: ['a', 'a'], style: 'poetic' }, 'duplicates'],
    [{ dreamIds: ['a', 1], style: 'poetic' }, 'must be a string'],
    [{ dreamIds: ['a'], style: 'nope' }, 'style'],
    [{ dreamIds: 'a', style: 'poetic' }, 'array'],
    [null, 'object'],
  ])('rejects %j', async (body, msg) => {
    const r = await validateStoryRequest(body, yes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(msg);
  });
  it('rejects missing dream', async () => {
    const r = await validateStoryRequest({ dreamIds: ['a', 'b'], style: 'sci_fi' }, (id) => id === 'a');
    expect(r).toEqual({ ok: false, reason: 'dream not found: b' });
  });
});

describe('dedupeKey / InFlightSet', () => {
  it('is order independent and style/member sensitive', () => {
    expect(dedupeKey('poetic', ['a', 'b'])).toBe(dedupeKey('poetic', ['b', 'a']));
    expect(dedupeKey('poetic', ['a', 'b'])).not.toBe(dedupeKey('mystery', ['a', 'b']));
    expect(dedupeKey('poetic', ['a', 'b'])).not.toBe(dedupeKey('poetic', ['a', 'c']));
  });
  it('permutation property', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }), (ids) => {
        expect(dedupeKey('sci_fi', ids)).toBe(dedupeKey('sci_fi', [...ids].reverse()));
      }),
    );
  });
  it('conflicts while in flight and releases in finally', async () => {
    const s = new InFlightSet();
    let calls = 0;
    let inner: unknown;
    const r = await s.run('k', async () => {
      calls++;
      inner = await s.run('k', async () => { calls++; });
      return 1;
    });
    expect(inner).toEqual({ conflict: true });
    expect(r).toEqual({ conflict: false, value: 1 });
    expect(calls).toBe(1);
    await expect(s.run('k', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(s.size).toBe(0);
  });
});

describe('parseStoryOutput', () => {
  it('parses plain and fenced JSON identically', () => {
    const j = JSON.stringify({ title: '  T ', content: ' C ' });
    expect(parseStoryOutput(j)).toEqual({ title: 'T', content: 'C' });
    expect(parseStoryOutput('```json\n' + j + '\n```')).toEqual({ title: 'T', content: 'C' });
  });
  it('truncates long title, rejects long content and invalid input', () => {
    expect(parseStoryOutput(JSON.stringify({ title: 'x'.repeat(150), content: 'c' }))!.title).toHaveLength(100);
    expect(parseStoryOutput(JSON.stringify({ title: 't', content: 'c'.repeat(20001) }))).toBeNull();
    expect(parseStoryOutput(JSON.stringify({ title: 't', content: 'c'.repeat(20000) }))).not.toBeNull();
    expect(parseStoryOutput(JSON.stringify({ title: ' ', content: 'c' }))).toBeNull();
    expect(parseStoryOutput(JSON.stringify({ title: 't' }))).toBeNull();
    expect(parseStoryOutput('not json')).toBeNull();
    expect(parseStoryOutput('[]')).toBeNull();
  });
});
