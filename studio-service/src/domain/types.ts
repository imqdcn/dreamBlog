/** 情绪枚举，与 Strapi dream.emotion 一致 */
export type DreamEmotion =
  | 'joyful'
  | 'peaceful'
  | 'neutral'
  | 'anxious'
  | 'fearful'
  | 'sad'
  | 'bizarre';

/** 与 Strapi 响应规整后的内部形态 */
export interface DreamRecord {
  documentId: string;
  rawContent: string;
  title?: string;
  summary?: string;
  keywords: string[];
  tags: string[];
  emotion?: DreamEmotion;
  emotionScore?: number;
  clarity?: number;
  dreamedAt?: string;
  createdAt: string;
  updatedAt?: string;
  aiProcessed: boolean;
  isFavorite: boolean;
  source?: string;
}

/** 相似度、星图等只依赖的最小字段集合 */
export type DreamLike = Pick<DreamRecord, 'documentId' | 'keywords' | 'tags'> &
  Partial<Pick<DreamRecord, 'title' | 'summary' | 'rawContent' | 'emotion' | 'dreamedAt' | 'createdAt'>>;

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
