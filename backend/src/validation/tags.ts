import { errors } from '@strapi/utils';

export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 20;

export type TagsCheck = { ok: true; tags: string[] } | { ok: false; reason: string };

/**
 * 纯判定函数（不抛错），规则见 design 4.2：
 * 数组、元素均为字符串、trim 后长度 1–20、trim 后无重复、总数 ≤ 10。
 * 通过时返回逐项 trim 后的列表。
 */
export function checkTags(tags: unknown): TagsCheck {
  if (!Array.isArray(tags)) return { ok: false, reason: 'tags must be an array of strings' };
  if (tags.length > MAX_TAGS) return { ok: false, reason: `tags must contain at most ${MAX_TAGS} items` };
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tags.length; i++) {
    const item: unknown = tags[i];
    if (typeof item !== 'string') return { ok: false, reason: `tags[${i}] must be a string` };
    const t = item.trim();
    if (t.length < 1 || t.length > MAX_TAG_LEN) {
      return { ok: false, reason: `tags[${i}] must be 1-${MAX_TAG_LEN} characters after trimming` };
    }
    if (seen.has(t)) return { ok: false, reason: `tags[${i}] is a duplicate` };
    seen.add(t);
    out.push(t);
  }
  return { ok: true, tags: out };
}

/** 校验失败时抛出 ValidationError（指明 `tags` 字段），成功返回 trim 后的列表。 */
export function validateTags(tags: unknown): string[] {
  const r = checkTags(tags);
  if ('reason' in r) {
    throw new errors.ValidationError(`Invalid field "tags": ${r.reason}`, {
      errors: [{ path: ['tags'], message: r.reason }],
    });
  }
  return r.tags;
}
