import { customRef, ref, type Ref } from 'vue';

export const OWNER_SESSION_KEY = 'dream-owner-session';

export interface OwnerSessionData {
  token: string;
  /** 过期时间，毫秒时间戳 */
  expiresAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OwnerSessionDeps {
  storage?: StorageLike | null;
  now?: () => number;
  /** logout() 之后切换到只读视图（默认在 Nuxt 包装里导航到 `/`） */
  onLogout?: () => void;
}

function parseSession(raw: string | null): OwnerSessionData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.token === 'string' && v.token && typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt)) {
      return { token: v.token, expiresAt: v.expiresAt };
    }
  } catch {
    /* 损坏的数据按无会话处理 */
  }
  return null;
}

/** 可注入存储与时钟的会话管理（需求 2.9、2.10、2.11） */
export function createOwnerSession(deps: OwnerSessionDeps = {}) {
  const storage = deps.storage ?? null;
  const now = deps.now ?? (() => Date.now());

  const state = ref<OwnerSessionData | null>(null);
  state.value = parseSession(storage?.getItem(OWNER_SESSION_KEY) ?? null);

  function clear() {
    state.value = null;
    try {
      storage?.removeItem(OWNER_SESSION_KEY);
    } catch {
      /* 存储不可用时仅清内存 */
    }
  }

  /** 有效则返回会话；已过期则清除并返回 null */
  function current(): OwnerSessionData | null {
    const s = state.value;
    if (!s) return null;
    if (s.expiresAt <= now()) {
      clear();
      return null;
    }
    return s;
  }

  function login(data: OwnerSessionData) {
    state.value = { token: data.token, expiresAt: data.expiresAt };
    try {
      storage?.setItem(OWNER_SESSION_KEY, JSON.stringify(state.value));
    } catch {
      /* 忽略存储失败，会话仍在内存中有效 */
    }
  }

  function logout() {
    clear();
    deps.onLogout?.();
  }

  // 时钟不是响应式依赖，普通 computed 会缓存过期前的结果；
  // 这里用只读 customRef，每次读取都重新判断过期（同时仍追踪 state 变化）。
  const live = <T>(read: () => T): Readonly<Ref<T>> =>
    customRef<T>((track) => ({
      get() {
        track();
        void state.value; // 追踪会话变化
        return read();
      },
      set() {
        /* 只读 */
      },
    }));

  const isOwner = live(() => current() !== null);
  const token = live(() => current()?.token ?? null);
  const expiresAt = live(() => current()?.expiresAt ?? null);

  return { isOwner, token, expiresAt, login, logout, clear, current };
}

export type OwnerSession = ReturnType<typeof createOwnerSession>;

let singleton: OwnerSession | null = null;

/** Nuxt composable：全局共享的 Owner 会话（仅客户端有 localStorage） */
export function useOwnerSession(): OwnerSession {
  if (!singleton) {
    singleton = createOwnerSession({
      storage: typeof localStorage !== 'undefined' ? localStorage : null,
      onLogout: () => {
        void navigateTo('/');
      },
    });
  }
  return singleton;
}
