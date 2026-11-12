import type { Dream } from '../types/dream';

/** 将日期字符串转为时间戳；缺失或无效时视为最早 */
function ts(raw?: string): number {
  if (!raw) return Number.NEGATIVE_INFINITY;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** 比较两个时间戳（降序），避免 -Infinity 相减得到 NaN */
function desc(a: number, b: number): number {
  return a === b ? 0 : a > b ? -1 : 1;
}

/**
 * 珍藏过滤：仅保留 isFavorite === true 的梦境，
 * 按 dreamedAt 降序，相同时按 createdAt 降序。不修改入参。
 */
export function selectFavorites(dreams: Dream[]): Dream[] {
  return dreams
    .filter((d) => d.isFavorite === true)
    .sort((a, b) => desc(ts(a.dreamedAt), ts(b.dreamedAt)) || desc(ts(a.createdAt), ts(b.createdAt)));
}
