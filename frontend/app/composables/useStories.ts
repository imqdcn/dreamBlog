import { normalize as normalizeDream } from './useDreams';
import type { Dream } from '../types/dream';

export const STORY_PAGE_SIZE = 100;

export interface StoryItem {
  id: number;
  documentId?: string;
  title?: string;
  content?: string;
  style?: string;
  createdAt?: string;
  sourceDreams: Dream[];
  [key: string]: unknown;
}

export interface PagedResult<T> {
  items: T[];
  /** 任一页失败时的错误；已加载的页仍保留在 items 中 */
  error?: unknown;
}

/**
 * 纯函数：循环调用注入的分页器，直到某页条数 < pageSize。
 * 任一页失败时保留已加载的页并返回错误。
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<T[]>,
  pageSize: number = STORY_PAGE_SIZE
): Promise<PagedResult<T>> {
  const items: T[] = [];
  let page = 1;
  try {
    for (;;) {
      const batch = await fetchPage(page);
      items.push(...batch);
      if (batch.length < pageSize) break;
      page += 1;
    }
  } catch (error) {
    return { items, error };
  }
  return { items };
}

export function normalizeStory(item: any): StoryItem {
  const src = item?.attributes ? { id: item.id, documentId: item.documentId, ...item.attributes } : item;
  const sources = Array.isArray(src.sourceDreams) ? src.sourceDreams : [];
  return { ...src, sourceDreams: sources.map(normalizeDream) };
}

/** 读取故事列表（createdAt 倒序，自动分页拉全量） */
export async function fetchStories(
  baseUrl: string,
  fetcher: typeof $fetch = $fetch
): Promise<PagedResult<StoryItem>> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/stories`;
  return fetchAllPages<StoryItem>(async (page) => {
    const res = (await fetcher(url, {
      params: {
        populate: 'sourceDreams',
        sort: 'createdAt:desc',
        'pagination[page]': page,
        'pagination[pageSize]': STORY_PAGE_SIZE,
      },
    })) as { data?: any[] };
    return (res.data ?? []).map(normalizeStory);
  });
}

/** Nuxt composable：响应式地加载故事列表 */
export function useStories() {
  const config = useRuntimeConfig();
  const baseUrl = config.public.strapiUrl as string;
  return useAsyncData<PagedResult<StoryItem>>('stories', () => fetchStories(baseUrl), {
    default: () => ({ items: [] }),
  });
}
