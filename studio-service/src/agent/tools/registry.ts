/** 工具注册表（设计 7.5）：参数解析校验、快照获取（每实例一次）、结果限长。 */

import type { z } from 'zod';
import type { DreamRecord } from '../../domain/types.js';
import { limitResult } from '../limit-result.js';
import type { ReadOnlyDreamSource, ToolCall, ToolError, ToolRegistry, ToolResult, ToolSpec } from '../types.js';
import { assertToolMeta, toToolSpec, type AgentTool } from './common.js';
import { errorFields, logger } from '../../logger.js';

export interface RegistryOptions {
  /** 返回今天的日期 YYYY-MM-DD（按配置时区） */
  today: () => string;
  /** 结果限长，默认 3000 */
  maxResultChars?: number;
}

const fail = (error: ToolError): ToolResult => ({ ok: false, error });

function isAbortLike(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

function fieldsFromZod(err: z.ZodError): { name: string; expected: string }[] {
  const out: { name: string; expected: string }[] = [];
  for (const issue of err.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const k of issue.keys) out.push({ name: k, expected: '该参数不被支持' });
      continue;
    }
    out.push({ name: issue.path.join('.') || 'arguments', expected: issue.message });
  }
  return out;
}

/**
 * 注册表实例即「一次 Run」的作用域：快照在首次成功后缓存，失败不缓存（下次调用重试由循环决定）。
 */
export class DreamToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  private readonly toolSpecs: ToolSpec[];
  private snapshot: Promise<DreamRecord[]> | null = null;

  constructor(
    tools: AgentTool[],
    private readonly opts: RegistryOptions,
  ) {
    for (const t of tools) {
      assertToolMeta(t);
      if (this.tools.has(t.name)) throw new Error(`重复的工具名：${t.name}`);
      this.tools.set(t.name, t);
    }
    this.toolSpecs = tools.map(toToolSpec);
  }

  specs(): ToolSpec[] {
    return this.toolSpecs.map((s) => ({ ...s }));
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  async execute(
    call: ToolCall,
    ctx: { source: ReadOnlyDreamSource; signal: AbortSignal },
  ): Promise<ToolResult> {
    return limitResult(await this.run(call, ctx), this.opts.maxResultChars ?? 3000);
  }

  private async run(
    call: ToolCall,
    ctx: { source: ReadOnlyDreamSource; signal: AbortSignal },
  ): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return fail({
        code: 'unknown_tool',
        message: `未知工具：${call.name.slice(0, 100)}`,
        availableTools: this.names(),
      });
    }

    // 解析并校验参数；失败时不触碰数据源
    let raw: unknown;
    const text = call.argumentsJson.trim();
    try {
      raw = text === '' ? {} : JSON.parse(text);
    } catch {
      return fail({
        code: 'invalid_arguments',
        message: '参数不是有效的 JSON',
        fields: [{ name: 'arguments', expected: '有效的 JSON 对象' }],
      });
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return fail({
        code: 'invalid_arguments',
        message: '参数必须是 JSON 对象',
        fields: [{ name: 'arguments', expected: 'JSON 对象' }],
      });
    }
    const parsed = tool.schema.safeParse(raw);
    if (!parsed.success) {
      return fail({
        code: 'invalid_arguments',
        message: '参数不符合工具定义',
        fields: fieldsFromZod(parsed.error),
      });
    }

    // 取快照（每实例一次）
    let dreams: DreamRecord[];
    try {
      dreams = await this.getSnapshot(ctx.source, ctx.signal);
    } catch (err) {
      if (ctx.signal.aborted || isAbortLike(err)) {
        return fail({ code: 'timeout', message: '读取梦境数据超时' });
      }
      logger.warn('agent tool snapshot fetch failed', undefined, { tool: call.name, ...errorFields(err) });
      return fail({ code: 'backend_unavailable', message: '梦境数据暂时无法读取' });
    }

    try {
      return tool.run(parsed.data, { dreams, today: this.opts.today() });
    } catch (err) {
      logger.error('agent tool run threw', undefined, { tool: call.name, ...errorFields(err) });
      return fail({ code: 'internal', message: '工具执行出错' });
    }
  }

  private getSnapshot(source: ReadOnlyDreamSource, signal: AbortSignal): Promise<DreamRecord[]> {
    if (!this.snapshot) {
      const p = source.listAll(signal);
      this.snapshot = p;
      // 失败不缓存
      p.catch(() => {
        if (this.snapshot === p) this.snapshot = null;
      });
    }
    return this.snapshot;
  }
}

export function createToolRegistry(tools: AgentTool[], opts: RegistryOptions): ToolRegistry {
  return new DreamToolRegistry(tools, opts);
}
