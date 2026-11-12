export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 20;

export type TagsResult = { ok: true; tags: string[] } | { ok: false; reason: string };

/** 规整单个 Tag：trim */
export function normalizeTag(s: string): string {
  return s.trim();
}

/**
 * 与 backend/src/validation/tags.ts 相同的规则：
 * 数组、元素均为字符串、trim 后长度 1–20、trim 后无重复、总数 ≤ 10。
 * 通过时返回逐项 trim 后的列表。
 */
export function validateTags(tags: unknown): TagsResult {
  if (!Array.isArray(tags)) return { ok: false, reason: 'tags must be an array of strings' };
  if (tags.length > MAX_TAGS) return { ok: false, reason: `tags must contain at most ${MAX_TAGS} items` };
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tags.length; i++) {
    const item: unknown = tags[i];
    if (typeof item !== 'string') return { ok: false, reason: `tags[${i}] must be a string` };
    const t = normalizeTag(item);
    if (t.length < 1 || t.length > MAX_TAG_LEN) {
      return { ok: false, reason: `tags[${i}] must be 1-${MAX_TAG_LEN} characters after trimming` };
    }
    if (seen.has(t)) return { ok: false, reason: `tags[${i}] is a duplicate` };
    seen.add(t);
    out.push(t);
  }
  return { ok: true, tags: out };
}

/** 添加 Tag：trim 后已存在则原样返回（幂等）；非法或超出上限则失败，原列表不变。 */
export function addTag(tags: string[], tag: string): TagsResult {
  if (typeof tag !== 'string') return { ok: false, reason: 'tag must be a string' };
  const t = normalizeTag(tag);
  if (t.length < 1 || t.length > MAX_TAG_LEN) {
    return { ok: false, reason: `tag must be 1-${MAX_TAG_LEN} characters after trimming` };
  }
  if (tags.includes(t)) return { ok: true, tags: [...tags] };
  if (tags.length + 1 > MAX_TAGS) {
    return { ok: false, reason: `tags must contain at most ${MAX_TAGS} items` };
  }
  return { ok: true, tags: [...tags, t] };
}

/** 移除 Tag（按 trim 后精确匹配）；不存在则原样返回。 */
export function removeTag(tags: string[], tag: string): string[] {
  const t = normalizeTag(tag);
  return tags.filter((x) => x !== t);
}

/** 按来源顺序、首次出现顺序去重，最多 max 个。 */
export function unionTags(sources: string[][], max = MAX_TAGS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of sources) {
    for (const raw of list) {
      const t = normalizeTag(raw);
      if (t.length === 0 || seen.has(t)) continue;
      if (out.length >= max) return out;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
