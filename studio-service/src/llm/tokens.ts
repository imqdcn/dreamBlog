// Token 估算与成本计算（需求 11.1、13.3、13.4）。纯函数，无 I/O。

/** 结构化最小消息形状，避免依赖 client.ts（与 ChatMessage 兼容）。 */
export interface TokenCountMessage {
  role?: string;
  content?: string | null;
  toolCalls?: ReadonlyArray<{ id?: string; name: string; argumentsJson: string }>;
  toolCallId?: string;
  name?: string;
}

export interface TokenCountTool {
  name?: string;
  description?: string;
  parameters?: unknown;
  [key: string]: unknown;
}

export interface Price {
  inPerM: number;
  outPerM: number;
}

export const MESSAGE_OVERHEAD_TOKENS = 4;

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** cjk（每字 1 token，偏保守）+ ceil(其余字符数 / 4)。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 4);
}

/** 消息列表（每条 +4）与 tools 的 JSON Schema 序列化后一并估算。 */
export function estimateMessagesTokens(
  messages: ReadonlyArray<TokenCountMessage>,
  tools?: ReadonlyArray<TokenCountTool>,
): number {
  let total = 0;
  for (const m of messages) {
    total += MESSAGE_OVERHEAD_TOKENS;
    if (m.content) total += estimateTokens(m.content);
    for (const tc of m.toolCalls ?? []) {
      total += estimateTokens(tc.name) + estimateTokens(tc.argumentsJson);
    }
  }
  if (tools && tools.length > 0) total += estimateTokens(JSON.stringify(tools));
  return total;
}

/** 响应缺少 usage 时的估算：输入、输出文本各按 ceil(字符数 / 4)。 */
export function estimateUsage(
  inputText: string,
  outputText: string,
): { promptTokens: number; completionTokens: number } {
  return {
    promptTokens: Math.ceil(inputText.length / 4),
    completionTokens: Math.ceil(outputText.length / 4),
  };
}

/** prompt·in/1e6 + completion·out/1e6 */
export function calcCost(promptTokens: number, completionTokens: number, price: Price): number {
  return (promptTokens * price.inPerM) / 1e6 + (completionTokens * price.outPerM) / 1e6;
}
