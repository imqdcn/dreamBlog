/** 与 backend dream schema 对齐的情绪枚举 */
export type DreamEmotion =
  | 'joyful'
  | 'peaceful'
  | 'neutral'
  | 'anxious'
  | 'fearful'
  | 'sad'
  | 'bizarre';

/** 前端使用的梦境记录（已从 Strapi 响应结构扁平化） */
export interface Dream {
  id: number;
  documentId?: string;
  rawContent: string;
  title?: string;
  summary?: string;
  keywords?: string[];
  emotion?: DreamEmotion;
  emotionScore?: number;
  clarity?: number;
  dreamedAt?: string;
  aiProcessed?: boolean;
  source?: string;
  createdAt?: string;
  isFavorite?: boolean;
  tags?: string[];
}

export type StoryStyle = 'gentle_fairytale' | 'mystery' | 'sci_fi' | 'poetic';

export type TerminationReason =
  | 'answered'
  | 'max_steps'
  | 'repeated_call'
  | 'token_budget'
  | 'timeout'
  | 'tool_failure'
  | 'llm_failure'
  | 'cancelled';

/** 梦境故事（Strapi story 扁平化） */
export interface Story {
  id: number;
  documentId: string;
  title: string;
  content: string;
  style: StoryStyle;
  tags?: string[];
  sourceDreams?: Dream[];
  /** 创建时的来源快照，用于识别已删除的来源梦境 */
  sourceSnapshot?: Array<{ documentId: string; title: string }>;
  createdAt?: string;
}

/** Agent 运行列表项（不含 trace 与回答） */
export interface AgentRunSummary {
  documentId?: string;
  runId?: string;
  question: string;
  terminationReason: TerminationReason;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  durationMs: number;
  createdAt?: string;
}

export interface TraceLlmInfo {
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  usageEstimated: boolean;
  aborted?: boolean;
}

export interface ToolCallTrace {
  callId: string;
  name: string;
  args: unknown;
  status: 'ok' | 'error' | 'rejected' | 'skipped';
  errorCode?: string;
  empty?: boolean;
  truncated?: boolean;
  resultBytes: number;
  durationMs: number;
  resultPreview?: string;
}

export interface StepTrace {
  kind: 'step';
  step: number;
  startedAtMs: number;
  llm: TraceLlmInfo;
  toolCalls: ToolCallTrace[];
}

export interface CompressionTrace {
  kind: 'compression';
  atStep: number;
  trigger: 'over_budget_before_llm_call';
  compressedSteps: number[];
  tokensBefore: number;
  tokensAfter: number;
}

export interface SummaryTrace {
  kind: 'summary';
  reason: 'max_steps' | 'repeated_call';
  llm: TraceLlmInfo;
  failed?: boolean;
}

export type TraceEntry = StepTrace | CompressionTrace | SummaryTrace;

/** 情绪的中文展示与配色 */
export const EMOTION_META: Record<DreamEmotion, { label: string; color: string; emoji: string }> = {
  joyful: { label: '愉悦', color: '#f6c445', emoji: '😊' },
  peaceful: { label: '平静', color: '#6cc3a9', emoji: '😌' },
  neutral: { label: '中性', color: '#9aa5b1', emoji: '😐' },
  anxious: { label: '焦虑', color: '#e08e45', emoji: '😰' },
  fearful: { label: '恐惧', color: '#9b5de5', emoji: '😨' },
  sad: { label: '悲伤', color: '#5b8def', emoji: '😢' },
  bizarre: { label: '离奇', color: '#e5679b', emoji: '🌀' },
};

export function emotionMeta(emotion?: DreamEmotion) {
  return emotion ? EMOTION_META[emotion] : { label: '未知', color: '#cbd2d9', emoji: '❔' };
}
