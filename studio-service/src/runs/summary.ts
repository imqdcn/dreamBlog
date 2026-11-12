import { validateDateRange } from '../domain/dates.js';

/** Run 摘要（列表/汇总所需字段，其余字段透传） */
export interface RunRecord {
  createdAt: string;
  terminationReason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  estimatedCost?: number | null;
  stepCount?: number | null;
  [k: string]: unknown;
}

export type RunListItem<T extends RunRecord = RunRecord> = T & { totalTokens: number };

export const MAX_PAGE_SIZE = 50;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ts = (s: string): number => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? -Infinity : t;
};

/** 附加 totalTokens = promptTokens + completionTokens */
export function withTotalTokens<T extends RunRecord>(run: T): RunListItem<T> {
  return { ...run, totalTokens: num(run.promptTokens) + num(run.completionTokens) };
}

/**
 * Run 列表分页：createdAt 倒序，每页最多 50 条（pageSize 被夹到 [1,50]，page 最小为 1）。
 */
export function listRuns<T extends RunRecord>(
  runs: readonly T[],
  page = 1,
  pageSize = MAX_PAGE_SIZE,
): { items: RunListItem<T>[]; page: number; pageSize: number; total: number; pageCount: number } {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || MAX_PAGE_SIZE));
  const p = Math.max(1, Math.floor(page) || 1);
  const sorted = runs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ts(b.r.createdAt) - ts(a.r.createdAt) || a.i - b.i)
    .map((x) => x.r);
  const items = sorted.slice((p - 1) * size, p * size).map(withTotalTokens);
  return { items, page: p, pageSize: size, total: sorted.length, pageCount: Math.ceil(sorted.length / size) };
}

export interface RunsSummary {
  runs: number;
  byReason: Record<string, number>;
  avgSteps: number;
  totalTokens: number;
  totalCost: number;
}

export class InvalidDateRangeError extends Error {
  constructor(readonly reason: 'invalid_from' | 'invalid_to' | 'from_after_to') {
    super(`invalid date range: ${reason}`);
    this.name = 'InvalidDateRangeError';
  }
}

function localDateKey(iso: string, tz: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * 区间汇总：区间为 tz（默认本地时区）下 [from 00:00, to+1天 00:00)，含起止日期当天。
 * 日期无效或 from > to 时抛出 InvalidDateRangeError，不返回数据。
 */
export function summarizeRuns(
  runs: readonly RunRecord[],
  from: string,
  to: string,
  tz: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): RunsSummary {
  const v = validateDateRange(from, to);
  if (!v.ok) throw new InvalidDateRangeError(v.reason!);

  const inRange = runs.filter((r) => {
    const k = localDateKey(r.createdAt, tz);
    return k !== null && k >= from && k <= to;
  });
  if (inRange.length === 0) {
    return { runs: 0, byReason: {}, avgSteps: 0, totalTokens: 0, totalCost: 0 };
  }

  const counts: Record<string, number> = {};
  let steps = 0;
  let tokens = 0;
  let cost = 0;
  for (const r of inRange) {
    const reason = r.terminationReason ?? 'unknown';
    counts[reason] = (counts[reason] ?? 0) + 1;
    steps += num(r.stepCount);
    tokens += num(r.promptTokens) + num(r.completionTokens);
    cost += num(r.estimatedCost);
  }
  const byReason: Record<string, number> = {};
  for (const [k, c] of Object.entries(counts)) byReason[k] = round1((c / inRange.length) * 100);

  return {
    runs: inRange.length,
    byReason,
    avgSteps: round1(steps / inRange.length),
    totalTokens: tokens,
    totalCost: cost,
  };
}

/** 最小的 Backend 读接口（StrapiClient 满足） */
export interface RunsSource {
  listAgentRuns(
    page?: number,
    pageSize?: number,
  ): Promise<{ data: unknown[]; pagination: { pageCount: number } }>;
}

/** 取一页列表（服务端分页，pageSize ≤ 50），附 totalTokens */
export async function fetchRunPage(src: RunsSource, page = 1, pageSize = MAX_PAGE_SIZE) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || MAX_PAGE_SIZE));
  const p = Math.max(1, Math.floor(page) || 1);
  const r = await src.listAgentRuns(p, size);
  return { items: (r.data as RunRecord[]).map(withTotalTokens), page: p, pageSize: size, pagination: r.pagination };
}

/** 校验区间后分页（pageSize=100）取全量并汇总 */
export async function summarizeFromSource(
  src: RunsSource,
  from: string,
  to: string,
  tz?: string,
): Promise<RunsSummary> {
  const v = validateDateRange(from, to);
  if (!v.ok) throw new InvalidDateRangeError(v.reason!);
  const all: RunRecord[] = [];
  for (let page = 1; ; page++) {
    const r = await src.listAgentRuns(page, 100);
    all.push(...(r.data as RunRecord[]));
    if (page >= r.pagination.pageCount || r.data.length === 0) break;
  }
  return summarizeRuns(all, from, to, tz);
}
