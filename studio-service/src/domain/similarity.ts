import type { DreamLike } from './types.js';

/** 规范化：NFKC、trim、小写 */
export function norm(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase();
}

export type SimilarityFn = (a: DreamLike, b: DreamLike) => number;

const W_KEYWORDS = 0.5;
const W_TAGS = 0.3;
const W_EMOTION = 0.2;

function toSet(items: readonly string[] | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const item of items ?? []) {
    if (typeof item !== 'string') continue;
    const n = norm(item);
    if (n.length > 0) set.add(n);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 加权 Jaccard 相似度，结果在 [0,1]，对称；自相似为 1；无重叠为 0。
 * 仅对“可用组件”加权平均；无可用组件时按 documentId 是否相同取 1 或 0。
 */
export const similarity: SimilarityFn = (a, b) => {
  let weighted = 0;
  let totalWeight = 0;

  const ka = toSet(a.keywords);
  const kb = toSet(b.keywords);
  if (ka.size > 0 || kb.size > 0) {
    weighted += W_KEYWORDS * jaccard(ka, kb);
    totalWeight += W_KEYWORDS;
  }

  const ta = toSet(a.tags);
  const tb = toSet(b.tags);
  if (ta.size > 0 || tb.size > 0) {
    weighted += W_TAGS * jaccard(ta, tb);
    totalWeight += W_TAGS;
  }

  const ea = a.emotion ? norm(a.emotion) : '';
  const eb = b.emotion ? norm(b.emotion) : '';
  if (ea !== '' || eb !== '') {
    weighted += W_EMOTION * (ea !== '' && ea === eb ? 1 : 0);
    totalWeight += W_EMOTION;
  }

  if (totalWeight === 0) return a.documentId === b.documentId ? 1 : 0;
  const score = weighted / totalWeight;
  return Math.min(1, Math.max(0, score));
};

export interface UniverseNode {
  documentId: string;
  title: string;
  dreamedAt: string | null;
  tags: string[];
  emotion?: string;
}

export interface UniverseEdge {
  source: string;
  target: string;
  score: number;
}

export interface Universe {
  nodes: UniverseNode[];
  edges: UniverseEdge[];
}

/** DreamLike 加上用于缓存指纹的 updatedAt */
export type UniverseDream = DreamLike & { updatedAt?: string };

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** 构建梦境宇宙：节点数等于 Dream 数；边 source < target，无自环、无重复。 */
export function buildUniverse(
  dreams: readonly DreamLike[],
  threshold = 0.3,
  sim: SimilarityFn = similarity,
): Universe {
  const nodes: UniverseNode[] = dreams.map((d) => {
    const node: UniverseNode = {
      documentId: d.documentId,
      title: d.title ?? '',
      dreamedAt: d.dreamedAt ?? null,
      tags: [...(d.tags ?? [])],
    };
    if (d.emotion) node.emotion = d.emotion;
    return node;
  });

  const edges: UniverseEdge[] = [];
  if (dreams.length < 2) return { nodes, edges };

  const seen = new Set<string>();
  for (let i = 0; i < dreams.length; i++) {
    for (let j = i + 1; j < dreams.length; j++) {
      const a = dreams[i]!;
      const b = dreams[j]!;
      if (a.documentId === b.documentId) continue;
      const [source, target] =
        a.documentId < b.documentId ? [a.documentId, b.documentId] : [b.documentId, a.documentId];
      const key = `${source}\u0000${target}`;
      if (seen.has(key)) continue;
      const score = sim(a, b);
      if (score >= threshold) {
        seen.add(key);
        edges.push({ source, target, score: round3(score) });
      }
    }
  }
  return { nodes, edges };
}

/** 缓存指纹：Dream 数量 + 最大 updatedAt */
export function universeFingerprint(dreams: readonly UniverseDream[]): string {
  let max = '';
  for (const d of dreams) {
    const u = d.updatedAt ?? '';
    if (u > max) max = u;
  }
  return `${dreams.length}|${max}`;
}

export const UNIVERSE_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  key: string;
  expiresAt: number;
  value: Universe;
}

let cache: CacheEntry | null = null;

export function clearUniverseCache(): void {
  cache = null;
}

/** 带 60 秒指纹缓存的 buildUniverse；指纹或阈值变化、或超过 TTL 时重算。 */
export function getUniverseCached(
  dreams: readonly UniverseDream[],
  threshold = 0.3,
  now: number = Date.now(),
): Universe {
  const key = `${universeFingerprint(dreams)}|${threshold}`;
  if (cache && cache.key === key && now < cache.expiresAt) return cache.value;
  const value = buildUniverse(dreams, threshold);
  cache = { key, expiresAt: now + UNIVERSE_CACHE_TTL_MS, value };
  return value;
}
