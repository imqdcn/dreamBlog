/**
 * 与上一次报告对比（设计 9.5；需求 15.8、15.9）。纯函数，不抛异常。
 */

import { readFile } from 'node:fs/promises';

export type Direction = 'up' | 'down' | 'same';

export interface MetricDelta {
  metric: string;
  current: number;
  previous: number;
  delta: number;
  direction: Direction;
}

export type CompareResult =
  | { comparable: true; deltas: MetricDelta[]; skipped: string[] }
  | { comparable: false; notice: string };

export const NOT_COMPARABLE_NOTICE = '无法对比：上一份报告缺失或无法解析，已跳过变化量';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 展开 metrics 为 `a.b` 形式的键值对，保留所有叶子（含 'n/a' 等非数值）。 */
function flatten(v: unknown, prefix = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (isObject(v)) {
    for (const [k, val] of Object.entries(v)) flatten(val, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out.set(prefix, v);
  }
  return out;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e9) / 1e9;
}

/**
 * 对每个两边都是数值的指标输出 delta = current - previous 与 direction。
 * 任一侧为 'n/a' 或缺失的指标列入 skipped。
 */
export function compare(current: unknown, previous: unknown): CompareResult {
  try {
    if (!isObject(current) || !isObject(previous) || !isObject(current.metrics) || !isObject(previous.metrics)) {
      return { comparable: false, notice: NOT_COMPARABLE_NOTICE };
    }
    const cur = flatten(current.metrics);
    const prev = flatten(previous.metrics);
    const deltas: MetricDelta[] = [];
    const skipped: string[] = [];
    for (const [metric, c] of cur) {
      const p = prev.get(metric);
      if (!isNum(c) || !isNum(p)) {
        skipped.push(metric);
        continue;
      }
      const delta = round(c - p);
      deltas.push({ metric, current: c, previous: p, delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same' });
    }
    return { comparable: true, deltas, skipped };
  } catch {
    return { comparable: false, notice: NOT_COMPARABLE_NOTICE };
  }
}

/** 读取基线报告；文件缺失或 JSON 非法时返回 undefined，不抛异常。 */
export async function loadBaseline(file: string | undefined): Promise<unknown | undefined> {
  if (!file) return undefined;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** 渲染为终端文本。 */
export function formatComparison(result: CompareResult): string {
  if (!result.comparable) return result.notice;
  const arrow = { up: '↑', down: '↓', same: '=' } as const;
  const lines = result.deltas.map(
    (d) => `${d.metric}: ${d.previous} -> ${d.current} (${d.delta > 0 ? '+' : ''}${d.delta}) ${arrow[d.direction]}`,
  );
  if (result.skipped.length > 0) lines.push(`跳过（非数值）：${result.skipped.join(', ')}`);
  return lines.join('\n');
}
