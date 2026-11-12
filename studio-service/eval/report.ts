/**
 * 评估报告写入（设计 9.5；需求 15.7）。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CaseResult, Metrics } from './score.js';

export interface EvalReport {
  mode: 'offline' | 'real';
  model: string;
  maxSteps: number;
  contextBudget: number;
  startedAt: string;
  metrics: Metrics;
  cases: Array<
    Pick<CaseResult, 'id' | 'category' | 'passed' | 'terminationReason' | 'stepCount' | 'totalTokens' | 'cost'>
  >;
  backendRequests: number;
}

export interface BuildReportInput {
  mode: EvalReport['mode'];
  model: string;
  maxSteps: number;
  contextBudget: number;
  startedAt?: Date;
  metrics: Metrics;
  results: readonly CaseResult[];
  backendRequests: number;
}

export const DEFAULT_REPORTS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'reports');

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYYMMDD-HHmmss（本地时间）。 */
export function formatTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function buildReport(input: BuildReportInput): EvalReport {
  const startedAt = input.startedAt ?? new Date();
  return {
    mode: input.mode,
    model: input.model,
    maxSteps: input.maxSteps,
    contextBudget: input.contextBudget,
    startedAt: startedAt.toISOString(),
    metrics: input.metrics,
    cases: input.results.map((r) => ({
      id: r.id,
      category: r.category,
      passed: r.passed,
      terminationReason: r.terminationReason,
      stepCount: r.stepCount,
      totalTokens: r.totalTokens,
      cost: r.cost,
    })),
    backendRequests: input.backendRequests,
  };
}

/** 写入 `<dir>/eval-<时间戳>.json`，返回文件路径。 */
export async function writeReport(
  report: EvalReport,
  dir: string = DEFAULT_REPORTS_DIR,
  now: Date = new Date(report.startedAt),
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `eval-${formatTimestamp(now)}.json`);
  await writeFile(file, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return file;
}
