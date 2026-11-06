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
}

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
