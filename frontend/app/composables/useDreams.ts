import type { Dream } from '../types/dream';

/** Strapi v5 列表响应结构 */
interface StrapiListResponse<T> {
  data: Array<T & { id: number; documentId?: string }>;
  meta?: {
    pagination?: { page: number; pageSize: number; pageCount: number; total: number };
  };
}

interface StrapiItemResponse<T> {
  data: (T & { id: number; documentId?: string }) | null;
}

/**
 * Strapi v5 默认把字段平铺在 data 元素上（非 v4 的 attributes 包裹），
 * 这里做一次规范化，保证前端拿到扁平的 Dream。
 */
function normalize(item: any): Dream {
  // 兼容 v4（attributes 包裹）与 v5（平铺）两种结构
  const src = item.attributes ? { id: item.id, documentId: item.documentId, ...item.attributes } : item;
  return {
    id: src.id,
    documentId: src.documentId,
    rawContent: src.rawContent ?? '',
    title: src.title ?? undefined,
    summary: src.summary ?? undefined,
    keywords: Array.isArray(src.keywords) ? src.keywords : undefined,
    emotion: src.emotion ?? undefined,
    emotionScore: typeof src.emotionScore === 'number' ? src.emotionScore : undefined,
    clarity: typeof src.clarity === 'number' ? src.clarity : undefined,
    dreamedAt: src.dreamedAt ?? undefined,
    aiProcessed: src.aiProcessed ?? undefined,
    source: src.source ?? undefined,
    createdAt: src.createdAt ?? undefined,
  };
}

/** 读取梦境列表（按 dreamedAt 倒序，自动分页拉全量，供统计使用） */
export async function fetchDreams(baseUrl: string, fetcher: typeof $fetch = $fetch): Promise<Dream[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/dreams`;
  const pageSize = 100;
  let page = 1;
  let pageCount = 1;
  const all: Dream[] = [];

  do {
    const res = (await fetcher(url, {
      params: {
        sort: 'dreamedAt:desc',
        'pagination[page]': page,
        'pagination[pageSize]': pageSize,
      },
    })) as StrapiListResponse<Dream>;
    all.push(...res.data.map(normalize));
    pageCount = res.meta?.pagination?.pageCount ?? 1;
    page += 1;
  } while (page <= pageCount);

  return all;
}

/** 读取单条梦境详情（按 documentId） */
export async function fetchDream(
  baseUrl: string,
  documentId: string,
  fetcher: typeof $fetch = $fetch
): Promise<Dream | null> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/dreams/${documentId}`;
  const res = (await fetcher(url)) as StrapiItemResponse<Dream>;
  return res.data ? normalize(res.data) : null;
}

/** Nuxt composable：响应式地加载梦境列表 */
export function useDreams() {
  const config = useRuntimeConfig();
  const baseUrl = config.public.strapiUrl as string;
  return useAsyncData<Dream[]>('dreams', () => fetchDreams(baseUrl), { default: () => [] });
}
