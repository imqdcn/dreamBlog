import { describe, expect, it } from 'vitest';
import { searchDreams, tokenize } from './search.js';
import type { DreamRecord } from './types.js';

const mk = (o: Partial<DreamRecord> & { documentId: string }): DreamRecord => ({
  rawContent: '',
  keywords: [],
  tags: [],
  createdAt: '2024-01-01T00:00:00Z',
  aiProcessed: true,
  isFavorite: false,
  ...o,
});

describe('tokenize', () => {
  it('handles CJK, latin and NFKC', () => {
    expect([...tokenize('飞')]).toEqual(['飞']);
    expect([...tokenize('飞翔天空')].sort()).toEqual(['天空', '翔天', '飞翔'].sort());
    expect([...tokenize('Ａｂｃ a 12')].sort()).toEqual(['12', 'abc']);
  });
});

describe('searchDreams', () => {
  const ds = [
    mk({ documentId: 'b', title: '飞翔', dreamedAt: '2024-03-02', emotion: 'joyful', tags: ['x'] }),
    mk({ documentId: 'a', title: '飞翔', dreamedAt: '2024-03-02' }),
    mk({ documentId: 'c', rawContent: '飞翔 in sky', dreamedAt: '2024-03-05' }),
    mk({ documentId: 'd', title: '无关', dreamedAt: '2024-03-09' }),
  ];
  it('ranks by relevance, date desc, id asc', () => {
    expect(searchDreams(ds, { query: '飞翔' }, 'UTC').map((h) => h.documentId)).toEqual(['a', 'b', 'c']);
  });
  it('empty query filters only, date desc', () => {
    expect(searchDreams(ds, {}, 'UTC').map((h) => h.documentId)).toEqual(['d', 'c', 'a', 'b']);
    expect(
      searchDreams(ds, { dateFrom: '2024-03-02', dateTo: '2024-03-05' }, 'UTC').map((h) => h.documentId),
    ).toEqual(['c', 'a', 'b']);
  });
  it('filters by emotion and tag', () => {
    expect(searchDreams(ds, { emotion: 'joyful' }, 'UTC').map((h) => h.documentId)).toEqual(['b']);
    expect(searchDreams(ds, { tag: ' x ' }, 'UTC').map((h) => h.documentId)).toEqual(['b']);
  });
});
