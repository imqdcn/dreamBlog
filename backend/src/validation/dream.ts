import { validateTags } from './tags';

export type WriteAction = 'create' | 'update';

/**
 * 校验 Dream 写入载荷（原地规整并返回同一对象）。
 * - 仅当 data.tags !== undefined 时校验 tags，并写回 trim 后的值。
 * - create 时补默认值 tags:[] 与 isFavorite:false（覆盖 MCP_Server 创建路径，需求 16.5）。
 * - update 不补默认值。
 */
export function validateDreamWrite<T extends Record<string, any>>(data: T, action: WriteAction): T {
  if (data === null || typeof data !== 'object') return data;
  const d = data as Record<string, any>;

  if (d.tags !== undefined) {
    d.tags = validateTags(d.tags);
  } else if (action === 'create') {
    d.tags = [];
  }

  if (action === 'create' && (d.isFavorite === undefined || d.isFavorite === null)) {
    d.isFavorite = false;
  }
  return data;
}
