import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { setLogLevel, logger } from './logger.js';
import { WebSocketClientTransport } from './ws-transport.js';
import { StrapiClient } from './strapi-client.js';
import { LlmProcessor } from './llm-processor.js';
import { EnrichmentQueue } from './enrichment-queue.js';
import { ToolHandlers, TOOL_DEFINITIONS } from './tools.js';

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  logger.info('=== Dream Blog MCP Server 启动 ===');
  logger.info(`Strapi: ${config.strapiUrl}`);
  logger.info(`LLM 加工: ${config.llm.enabled ? `启用（${config.llm.model}）` : '未启用（仅保存原文）'}`);

  const strapi = new StrapiClient({
    baseUrl: config.strapiUrl,
    token: config.strapiToken,
  });
  const llm = new LlmProcessor(config.llm);
  const queue = new EnrichmentQueue(strapi, llm);
  const handlers = new ToolHandlers(strapi, queue);

  // Strapi 连通性自检（不阻断启动）
  strapi.ping().then((ok) => {
    if (ok) logger.info('Strapi 连通性自检通过');
    else logger.warn('Strapi 连通性自检未通过，请检查 STRAPI_URL / STRAPI_TOKEN 及权限');
  });

  const server = new Server(
    { name: 'DreamBlog', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // tools/list：返回工具清单给小智端
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  // tools/call：执行工具
  // SDK 的返回类型联合包含实验性的 task 变体，这里的工具结果只用标准的 content 形态，
  // 故把 handler 回调断言为 SDK 期望的签名，避免实验性字段造成的类型不匹配。
  server.setRequestHandler(CallToolRequestSchema, (async (request: {
    params: { name: string; arguments?: Record<string, unknown> };
  }) => {
    const { name, arguments: args } = request.params;
    try {
      return await handlers.call(name, args ?? {});
    } catch (err) {
      logger.error(`工具 ${name} 执行异常：`, (err as Error).message);
      return {
        content: [{ type: 'text', text: `工具执行出错：${(err as Error).message}` }],
        isError: true,
      };
    }
  }) as Parameters<typeof server.setRequestHandler>[1]);

  const transport = new WebSocketClientTransport({
    url: config.mcpEndpoint,
    reconnectBaseDelayMs: config.reconnectBaseDelayMs,
    reconnectMaxDelayMs: config.reconnectMaxDelayMs,
  });

  await server.connect(transport);
  logger.info('MCP Server 已连接到接入点，等待小智端调用……');
  logger.info(`已注册工具：${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}`);

  // 开机补偿扫描：补做上次未完成的加工（不阻塞服务）
  void queue.recover();

  // 优雅退出：先停止接收新调用，再尽量排空后台加工队列
  const shutdown = async (sig: string) => {
    logger.info(`收到 ${sig}，正在关闭……`);
    await transport.close().catch(() => {});
    if (queue.size > 0) {
      logger.info(`等待后台加工队列排空（剩余 ${queue.size} 条）……`);
      await queue.drain().catch(() => {});
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('启动失败：', err);
  process.exit(1);
});
