import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addTag, removeTag, unionTags, validateTags } from './tags.js';

interface Case {
  name: string;
  input: unknown;
  valid: boolean;
  output?: string[];
}

const cases = JSON.parse(
  readFileSync(new URL('./__fixtures__/tags-cases.json', import.meta.url), 'utf8'),
) as Case[];

describe('validateTags 与 Backend 夹具对拍', () => {
  for (const c of cases) {
    it(c.name, () => {
      const r = validateTags(c.input);
      expect(r.ok).toBe(c.valid);
      if (c.valid && r.ok) expect(r.tags).toEqual(c.output);
    });
  }
});

describe('addTag / removeTag', () => {
  it('添加新 Tag 并 trim', () => {
    expect(addTag(['a'], ' b ')).toEqual({ ok: true, tags: ['a', 'b'] });
  });
  it('已存在则幂等', () => {
    expect(addTag(['a', 'b'], ' a ')).toEqual({ ok: true, tags: ['a', 'b'] });
  });
  it('非法或超限失败', () => {
    expect(addTag([], '   ').ok).toBe(false);
    expect(addTag([], 'x'.repeat(21)).ok).toBe(false);
    const full = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    expect(addTag(full, '11').ok).toBe(false);
    expect(addTag(full, '10').ok).toBe(true);
  });
  it('removeTag 不存在则原样返回', () => {
    expect(removeTag(['a', 'b'], 'b')).toEqual(['a']);
    expect(removeTag(['a'], 'z')).toEqual(['a']);
  });
});

describe('unionTags', () => {
  it('按来源顺序去重', () => {
    expect(unionTags([['a', 'b'], ['b', 'c']])).toEqual(['a', 'b', 'c']);
  });
  it('最多 max 个', () => {
    const many = Array.from({ length: 8 }, (_, i) => `t${i}`);
    expect(unionTags([many, ['x', 'y', 'z', 'w']], 10)).toEqual([...many, 'x', 'y']);
  });
});
