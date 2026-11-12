import { ref } from 'vue';
import { useOwnerSession, type OwnerSession } from './useOwnerSession';

export const STUDIO_TIMEOUT_MS = 5000;
export const MSG_SESSION_EXPIRED = '登录已失效，请重新登录';
export const MSG_UNAVAILABLE = '服务暂不可用';

/** 统一的 Studio 错误类型 */
export class StudioError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'StudioError';
    this.status = status;
    this.code = code;
  }
}

export interface StudioRequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** 不带 Authorization，也不因 401 清除会话（如登录请求） */
  anonymous?: boolean;
  timeoutMs?: number;
}

export interface StudioClientDeps {
  baseUrl: string;
  session: Pick<OwnerSession, 'token' | 'clear' | 'current'>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function buildUrl(base: string, path: string, query?: StudioRequestOptions['query']): string {
  let url = `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

/** 可注入 fetch 的 Studio 客户端（需求 2.9、2.11、16.6） */
export function createStudioClient(deps: StudioClientDeps) {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  /** 最近一次需要展示的提示（登录失效 / 服务不可用），成功请求后清空服务不可用 */
  const notice = ref<string | null>(null);
  const unavailable = ref(false);

  async function request<T = unknown>(path: string, opts: StudioRequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (!opts.anonymous) {
      const t = deps.session.current()?.token;
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    const hasBody = opts.body !== undefined;
    if (hasBody) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? deps.timeoutMs ?? STUDIO_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new StudioError(0, 'service_unavailable', MSG_UNAVAILABLE));
      }, timeoutMs);
    });

    const run = async (): Promise<{ status: number; ok: boolean; data: any }> => {
      const res = await doFetch(buildUrl(deps.baseUrl, path, opts.query), {
        method: opts.method ?? (hasBody ? 'POST' : 'GET'),
        headers,
        body: hasBody ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      let data: any = null;
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { status: res.status, ok: res.ok, data };
    };

    let result: { status: number; ok: boolean; data: any };
    try {
      result = await Promise.race([run(), timeout]);
    } catch (e) {
      if (e instanceof StudioError) {
        unavailable.value = true;
        notice.value = MSG_UNAVAILABLE;
        throw e;
      }
      // 网络层失败同样视为服务不可用
      unavailable.value = true;
      notice.value = MSG_UNAVAILABLE;
      throw new StudioError(0, 'service_unavailable', MSG_UNAVAILABLE);
    } finally {
      if (timer) clearTimeout(timer);
    }

    unavailable.value = false;
    if (notice.value === MSG_UNAVAILABLE) notice.value = null;

    if (result.ok) return result.data as T;

    const err = result.data?.error;
    const code = typeof err?.code === 'string' ? err.code : result.status === 401 ? 'unauthorized' : 'http_error';
    const message = typeof err?.message === 'string' ? err.message : `请求失败（${result.status}）`;

    if (result.status === 401 && !opts.anonymous) {
      deps.session.clear();
      notice.value = MSG_SESSION_EXPIRED;
      throw new StudioError(401, code, MSG_SESSION_EXPIRED);
    }
    throw new StudioError(result.status, code, message);
  }

  return { request, notice, unavailable };
}

export type StudioClient = ReturnType<typeof createStudioClient>;

let singleton: StudioClient | null = null;

/** Nuxt composable：基于 runtimeConfig.public.studioUrl 的全局 Studio 客户端 */
export function useStudio(): StudioClient {
  if (!singleton) {
    const config = useRuntimeConfig();
    singleton = createStudioClient({
      baseUrl: config.public.studioUrl as string,
      session: useOwnerSession(),
    });
  }
  return singleton;
}
