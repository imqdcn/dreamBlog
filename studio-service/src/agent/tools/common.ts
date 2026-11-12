/** 工具公共层（设计 7.5）：AgentTool 接口、共享 zod 片段、ToolSpec 生成。 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { isValidDateKey } from '../../domain/dates.js';
import type { DreamRecord } from '../../domain/types.js';
import type { ToolSpec } from '../types.js';

export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 300;

/** 纯函数 run 的返回：成功数据（可标 empty）或 not_found。其余错误由注册表产生。 */
export type ToolData<TData> =
  | { ok: true; data: TData; empty?: boolean }
  | { ok: false; error: { code: 'not_found'; message: string } };

export interface ToolContext {
  dreams: DreamRecord[];
  /** 今天的日期 YYYY-MM-DD（按配置时区） */
  today: string;
}

export interface AgentTool<TArgs = any, TData = unknown> {
  name: string;
  /** 10–300 字符，面向 LLM */
  description: string;
  /** 单一事实来源：参数校验与发给 LLM 的 JSON Schema 都来自它 */
  schema: z.ZodType<TArgs, z.ZodTypeDef, any>;
  run(args: TArgs, ctx: ToolContext): ToolData<TData>;
}

// ---------------------------------------------------------------- 共享 zod 片段

/** 字符串字段的默认最大长度 */
export const MAX_STRING_LENGTH = 200;

/** 有长度上限的字符串 */
export const boundedString = (max: number = MAX_STRING_LENGTH) => z.string().max(max);

/** 有效的 YYYY-MM-DD 日历日期（拒绝 2024-02-30、2024-1-1） */
export const dateString = z
  .string()
  .max(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式须为 YYYY-MM-DD')
  .refine((s) => isValidDateKey(s), { message: '须为有效的日历日期（YYYY-MM-DD）' });

/** documentId：1–100 字符 */
export const documentIdString = z.string().min(1).max(100);

/**
 * 为含 dateFrom / dateTo 的对象 schema 增加 dateFrom <= dateTo 校验。
 * 任一缺失或格式无效时跳过（由字段自身校验报告）。
 */
export function withDateRange<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((val: any, ctx) => {
    const from = val?.dateFrom;
    const to = val?.dateTo;
    if (isValidDateKey(from) && isValidDateKey(to) && from > to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateFrom'],
        message: 'dateFrom 不得晚于 dateTo',
      });
    }
  });
}

// ---------------------------------------------------------------- ToolSpec

export function toToolSpec(tool: AgentTool): ToolSpec {
  const json = zodToJsonSchema(tool.schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  delete json.$schema;
  return { name: tool.name, description: tool.description, parameters: json };
}

/** 校验工具元数据；注册表构造时调用，错误属于编程错误。 */
export function assertToolMeta(tool: AgentTool): void {
  const len = [...tool.description].length;
  if (len < DESCRIPTION_MIN || len > DESCRIPTION_MAX) {
    throw new Error(`工具 ${tool.name} 的 description 长度须在 ${DESCRIPTION_MIN}–${DESCRIPTION_MAX}，当前 ${len}`);
  }
}
