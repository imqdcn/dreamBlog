/**
 * CORS 判定（纯函数）。
 * 仅当 Origin 与允许列表中某一项逐字符相等时返回跨域许可头，否则返回空对象。
 * 不使用通配符，不做子串、前缀、后缀或大小写不敏感匹配。
 */
export function corsHeadersFor(
  origin: string | undefined,
  allowed: readonly string[],
): Record<string, string> {
  if (typeof origin !== 'string' || origin === '' || origin === '*') return {};
  if (!allowed.some((entry) => entry === origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  };
}
