import 'dotenv/config';

/**
 * 从环境变量读取配置，集中校验。
 * 敏感信息（接入点 token、Strapi token、LLM key）全部走环境变量，不入库。
 */
export interface AppConfig {
  /** 小智官方 MCP 接入点 WebSocket 地址，形如 wss://host/mcp_endpoint/mcp/?token=xxx */
  mcpEndpoint: string;
  /** Strapi 基地址，例如 http://localhost:1337 */
  strapiUrl: string;
  /** Strapi API Token（具备 dream 的 create 权限） */
  strapiToken: string;
  /** LLM 加工相关配置 */
  llm: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  /** 断线重连基准延迟（毫秒） */
  reconnectBaseDelayMs: number;
  /** 断线重连最大延迟（毫秒） */
  reconnectMaxDelayMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`缺少必需的环境变量：${name}`);
  }
  return value.trim();
}

export function loadConfig(): AppConfig {
  const llmApiKey = process.env.LLM_API_KEY?.trim() ?? '';
  return {
    mcpEndpoint: required('MCP_ENDPOINT', process.env.MCP_ENDPOINT),
    strapiUrl: (process.env.STRAPI_URL?.trim() || 'http://localhost:1337').replace(/\/$/, ''),
    strapiToken: required('STRAPI_TOKEN', process.env.STRAPI_TOKEN),
    llm: {
      // 未提供 LLM key 时自动降级为「不加工」，仍可保存原文
      enabled: llmApiKey.length > 0 && process.env.LLM_ENABLED !== 'false',
      baseUrl: (process.env.LLM_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey: llmApiKey,
      model: process.env.LLM_MODEL?.trim() || 'gpt-4o-mini',
    },
    reconnectBaseDelayMs: Number(process.env.RECONNECT_BASE_DELAY_MS ?? 1000),
    reconnectMaxDelayMs: Number(process.env.RECONNECT_MAX_DELAY_MS ?? 30000),
    logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info',
  };
}
