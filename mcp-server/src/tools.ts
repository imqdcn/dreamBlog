import { z } from 'zod';
import { StrapiClient, type DreamRecord } from './strapi-client.js';
import { EnrichmentQueue } from './enrichment-queue.js';
import { logger } from './logger.js';

/** MCP 工具的 JSON Schema 定义（供 tools/list 返回给小智端） */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'echo',
    description: '测试工具：原样返回传入的文本，用于验证 MCP 接入点连通性。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要回显的文本' },
      },
      required: ['text'],
    },
  },
  {
    name: 'record_dream',
    description:
      '记录一段梦境。当用户说出类似「帮我记录一个梦」「我做了个梦」并口述梦境内容时调用。' +
      '系统会用 AI 自动生成标题、摘要、关键词与情绪分析，并保存到梦境日记中。',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '用户口述的完整梦境内容',
        },
        dreamedAt: {
          type: 'string',
          description: '可选，梦境发生的时间（ISO 8601）。不传则使用当前时间。',
        },
      },
      required: ['content'],
    },
  },
];

const echoArgs = z.object({ text: z.string() });
const recordDreamArgs = z.object({
  content: z.string().min(1, '梦境内容不能为空'),
  dreamedAt: z.string().optional(),
});

/** 工具调用的返回（MCP content 块） */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * 工具处理器：持有 Strapi 客户端与后台加工队列，负责执行具体工具逻辑。
 */
export class ToolHandlers {
  constructor(
    private readonly strapi: StrapiClient,
    private readonly queue: EnrichmentQueue
  ) {}

  async call(name: string, rawArgs: unknown): Promise<ToolResult> {
    switch (name) {
      case 'echo':
        return this.echo(rawArgs);
      case 'record_dream':
        return this.recordDream(rawArgs);
      default:
        return {
          content: [{ type: 'text', text: `未知工具：${name}` }],
          isError: true,
        };
    }
  }

  private echo(rawArgs: unknown): ToolResult {
    const { text } = echoArgs.parse(rawArgs);
    logger.info('echo 工具被调用：', text);
    return { content: [{ type: 'text', text }] };
  }

  private async recordDream(rawArgs: unknown): Promise<ToolResult> {
    const args = recordDreamArgs.parse(rawArgs);
    logger.info('record_dream 工具被调用，内容长度：', args.content.length);

    // 1. 先把原文落库（aiProcessed=false），保证快速响应、绝不丢记录
    const record: DreamRecord = {
      rawContent: args.content,
      dreamedAt: args.dreamedAt ?? new Date().toISOString(),
      source: 'xiaozhi',
      aiProcessed: false,
    };

    let created: { id: number; documentId?: string };
    try {
      created = await this.strapi.createDream(record);
    } catch (err) {
      logger.error('record_dream 写入失败：', (err as Error).message);
      return {
        content: [{ type: 'text', text: '抱歉，刚才记录梦境时出了点问题，请稍后再试一次。' }],
        isError: true,
      };
    }

    // 2. 把 LLM 加工排入后台队列，不阻塞本次回话
    if (created.documentId) {
      this.queue.enqueue({ documentId: created.documentId, rawContent: args.content });
    } else {
      // 没拿到 documentId 则无法回写，跳过加工（极少见）
      logger.warn(`record_dream 未获得 documentId，跳过后台加工：id=${created.id}`);
    }

    // 3. 立即回话。加工结果稍后在日记里自动补全。
    logger.info(`record_dream 已落库：id=${created.id}，加工转入后台`);
    return {
      content: [{ type: 'text', text: '已经帮你记下这段梦了，稍后会自动整理好标题和摘要。' }],
    };
  }
}
