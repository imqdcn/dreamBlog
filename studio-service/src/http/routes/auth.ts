/**
 * POST /v1/auth/login（需求 2.1–2.4）：先查锁定再比较口令；
 * 失败 401 并记录，成功签发 12 小时会话令牌。
 */
import { z } from 'zod';
import { signSession } from '../../auth/session.js';
import { verifyPassphrase } from '../../auth/passphrase.js';
import type { RouteRegistrar } from '../app.js';
import { parseJsonBody, rateLimited, sourceAddressOf, unauthorized } from '../middleware.js';

const LoginBody = z.object({ passphrase: z.string() });

export const registerAuthRoutes: RouteRegistrar = (app, deps) => {
  app.post('/v1/auth/login', async (c) => {
    const { passphrase } = await parseJsonBody(c, LoginBody);
    const address = sourceAddressOf(c, deps.config.trustProxy);

    const state = deps.loginGuard.check(address);
    if (state.locked) throw rateLimited('登录失败次数过多，请稍后再试', state.retryAfterMs);

    if (!verifyPassphrase(passphrase, deps.config.secrets.ownerPassphrase)) {
      deps.loginGuard.recordFailure(address);
      throw unauthorized('口令错误');
    }

    deps.loginGuard.recordSuccess(address);
    const { payload, token } = signSession(deps.config.secrets.sessionSecret, deps.clock.now());
    return c.json({ token, expiresAt: payload.exp * 1000 });
  });
};
