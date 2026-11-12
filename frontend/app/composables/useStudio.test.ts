import { describe, expect, it, vi } from 'vitest';
import { createOwnerSession, OWNER_SESSION_KEY, type StorageLike } from './useOwnerSession';
import { createStudioClient, StudioError } from './useStudio';

function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('useOwnerSession', () => {
  it('isOwner 过期读取时清除存储', () => {
    const storage = memStorage();
    let t = 1000;
    const s = createOwnerSession({ storage, now: () => t });
    s.login({ token: 'a', expiresAt: 2000 });
    expect(s.isOwner.value).toBe(true);
    expect(storage.map.has(OWNER_SESSION_KEY)).toBe(true);
    t = 2000;
    expect(s.isOwner.value).toBe(false);
    expect(storage.map.has(OWNER_SESSION_KEY)).toBe(false);
  });

  it('启动时从存储恢复，logout 立即清除并回调', () => {
    const storage = memStorage();
    storage.setItem(OWNER_SESSION_KEY, JSON.stringify({ token: 'x', expiresAt: 5000 }));
    const onLogout = vi.fn();
    const s = createOwnerSession({ storage, now: () => 1, onLogout });
    expect(s.isOwner.value).toBe(true);
    s.logout();
    expect(s.isOwner.value).toBe(false);
    expect(storage.map.size).toBe(0);
    expect(onLogout).toHaveBeenCalled();
  });
});

describe('useStudio', () => {
  const mk = (fetchImpl: typeof fetch, timeoutMs = 5000) => {
    const session = createOwnerSession({ storage: memStorage(), now: () => 0 });
    session.login({ token: 'tok', expiresAt: 10_000 });
    const client = createStudioClient({ baseUrl: 'http://s/', session, fetch: fetchImpl, timeoutMs });
    return { session, client };
  };

  it('自动带 Bearer 令牌', async () => {
    const f = vi.fn(async () => new Response('{"ok":1}', { status: 200 }));
    const { client } = mk(f as any);
    expect(await client.request('/dreams')).toEqual({ ok: 1 });
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('http://s/dreams');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('401 清除会话并提示登录失效', async () => {
    const f = async () => new Response('{"error":{"code":"unauthorized","message":"x"}}', { status: 401 });
    const { client, session } = mk(f as any);
    await expect(client.request('/dreams')).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(session.isOwner.value).toBe(false);
    expect(client.notice.value).toContain('登录已失效');
  });

  it('超时视为服务不可用', async () => {
    const f = (_u: any, init: any) =>
      new Promise<Response>((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
    const { client } = mk(f as any, 20);
    const e = await client.request('/x').catch((x) => x);
    expect(e).toBeInstanceOf(StudioError);
    expect(e).toMatchObject({ status: 0, code: 'service_unavailable' });
    expect(client.unavailable.value).toBe(true);
  });

  it('其他错误映射为 StudioError', async () => {
    const f = async () => new Response('{"error":{"code":"rate_limited","message":"慢点"}}', { status: 429 });
    const { client } = mk(f as any);
    await expect(client.request('/x')).rejects.toMatchObject({ status: 429, code: 'rate_limited', message: '慢点' });
  });
});
