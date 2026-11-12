import { errors } from '@strapi/utils';
import { validateTags } from './tags';
import type { WriteAction } from './dream';

export const STORY_STYLES = ['gentle_fairytale', 'mystery', 'sci_fi', 'poetic'] as const;
export const MAX_TITLE_LEN = 100;
export const MAX_CONTENT_LEN = 20000;
export const MIN_SOURCES = 1;
export const MAX_SOURCES = 5;

function fail(field: string, message: string): never {
  throw new errors.ValidationError(`Invalid field "${field}": ${message}`, {
    errors: [{ path: [field], message }],
  });
}

function checkText(data: Record<string, any>, field: 'title' | 'content', max: number, required: boolean) {
  const v = data[field];
  if (v === undefined) {
    if (required) fail(field, 'is required');
    return;
  }
  if (typeof v !== 'string' || v.trim().length < 1 || v.length > max) {
    fail(field, `must be a non-empty string of at most ${max} characters`);
  }
}

/** 取出 sourceDreams 的完整集合：数组，或仅含 set 的对象；其余形态一律拒绝。 */
function extractSourceSet(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('connect' in obj || 'disconnect' in obj) {
      fail('sourceDreams', 'connect/disconnect are not allowed; send the full array or { set: [...] }');
    }
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === 'set' && Array.isArray(obj.set)) return obj.set;
  }
  fail('sourceDreams', 'must be an array of document ids or { set: [...] }');
}

/**
 * 校验 Story 写入载荷（原地规整并返回同一对象）。
 * create 要求 title、content、style、sourceDreams 齐备；update 只校验出现的字段。
 */
export function validateStoryWrite<T extends Record<string, any>>(data: T, action: WriteAction): T {
  if (data === null || typeof data !== 'object') return data;
  const d = data as Record<string, any>;
  const isCreate = action === 'create';

  checkText(d, 'title', MAX_TITLE_LEN, isCreate);
  checkText(d, 'content', MAX_CONTENT_LEN, isCreate);

  if (d.style === undefined) {
    if (isCreate) fail('style', 'is required');
  } else if (!(STORY_STYLES as readonly string[]).includes(d.style)) {
    fail('style', `must be one of ${STORY_STYLES.join(', ')}`);
  }

  if (d.tags !== undefined) {
    d.tags = validateTags(d.tags);
  } else if (isCreate) {
    d.tags = [];
  }

  if (d.sourceDreams === undefined) {
    if (isCreate) fail('sourceDreams', `must contain ${MIN_SOURCES}-${MAX_SOURCES} dreams`);
  } else {
    const set = extractSourceSet(d.sourceDreams);
    if (set.length < MIN_SOURCES || set.length > MAX_SOURCES) {
      fail('sourceDreams', `must contain ${MIN_SOURCES}-${MAX_SOURCES} dreams`);
    }
  }
  return data;
}
