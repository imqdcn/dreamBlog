/**
 * dreams 路由（设计 4；需求 4.6–4.11、4.13–4.16、5.1、5.4–5.7）。
 *
 * POST  /v1/dreams                    校验 → 保存 → 立即 201 {dream, enrichment:"pending"}，加工转入后台队列
 * GET   /v1/dreams/:id/enrichment     {status, error?}
 * POST  /v1/dreams/:id/enrich         仅 failed 可重试，否则 409
 * PATCH /v1/dreams/:id/tags           {add} 或 {remove} 二选一；校验失败 400 且不写 Backend
 * PUT   /v1/dreams/:id/favorite       先 GET 确认存在（404 不创建），再 PUT 绝对值；PUT 失败 502
 */
import { normalizeDream } from '../../backend/dream-source.js';
import { addTag, removeTag } from '../../domain/tags.js';
import { validateDreamContent, validateFavoriteBody } from '../../domain/validation.js';
import { EnrichmentQueue, type EnrichmentState } from '../../queue/enrichment-queue.js';
import type { AppDeps, RouteRegistrar } from '../app.js';
import { conflict, invalidArgument, notFound, requireOwner } from '../middleware.js';

async function readJsonObject(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw invalidArgument('请求体不是合法的 JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalidArgument('请求体必须是对象');
  }
  return body as Record<string, unknown>;
}

function getQueue(deps: AppDeps): EnrichmentQueue {
  const existing = deps.extras?.enrichmentQueue as EnrichmentQueue | undefined;
  if (existing) return existing;
  const created = new EnrichmentQueue({ llm: deps.llm, backend: deps.strapi });
  deps.extras = { ...(deps.extras ?? {}), enrichmentQueue: created };
  return created;
}

export const registerDreamRoutes: RouteRegistrar = (app, deps) => {
  const owner = requireOwner(deps);
  const queue = getQueue(deps);

  /** 读取 Dream；不存在抛 404。 */
  const loadDream = async (id: string) => {
    const entity = await deps.strapi.getDream(id);
    if (!entity) throw notFound('梦境不存在');
    return { entity, dream: normalizeDream(entity) };
  };

  app.post('/v1/dreams', owner, async (c) => {
    const body = await readJsonObject(c);
    const content = validateDreamContent(body.content);
    if (!content.ok) throw invalidArgument(content.error, ['content']);

    let dreamedAt = new Date(deps.clock.now()).toISOString();
    if (body.dreamedAt !== undefined) {
      if (typeof body.dreamedAt !== 'string' || Number.isNaN(Date.parse(body.dreamedAt))) {
        throw invalidArgument('dreamedAt 必须是合法的日期时间字符串', ['dreamedAt']);
      }
      dreamedAt = body.dreamedAt;
    }

    const rawContent = body.content as string; // 保留原文，不 trim
    const created = await deps.strapi.createDream({
      rawContent,
      dreamedAt,
      source: 'web',
      aiProcessed: false,
      isFavorite: false,
      tags: [],
    });
    if (created.documentId) {
      queue.enqueue({ documentId: created.documentId, rawContent });
    }
    return c.json({ dream: created, enrichment: 'pending' as const }, 201);
  });

  /** 队列状态；过期或进程重启后无记录时，以 Backend 的 aiProcessed 推断。 */
  const resolveStatus = async (id: string): Promise<EnrichmentState> => {
    const known = queue.getStatus(id);
    if (known) return known;
    const { dream } = await loadDream(id);
    if (dream?.aiProcessed) return { status: 'done' };
    return { status: 'failed', error: 'enrichment_failed' };
  };

  app.get('/v1/dreams/:id/enrichment', owner, async (c) => {
    return c.json(await resolveStatus(c.req.param('id')));
  });

  app.post('/v1/dreams/:id/enrich', owner, async (c) => {
    const id = c.req.param('id');
    const state = await resolveStatus(id);
    if (state.status !== 'failed') throw conflict('仅加工失败的梦境可以重试');
    const { entity } = await loadDream(id);
    const rawContent = typeof entity.rawContent === 'string' ? entity.rawContent : '';
    queue.enqueue({ documentId: id, rawContent });
    return c.json({ status: 'pending' as const }, 202);
  });

  app.patch('/v1/dreams/:id/tags', owner, async (c) => {
    const id = c.req.param('id');
    const body = await readJsonObject(c);
    const hasAdd = body.add !== undefined;
    const hasRemove = body.remove !== undefined;
    if (hasAdd === hasRemove) throw invalidArgument('add 与 remove 必须二选一', ['add', 'remove']);
    const field = hasAdd ? 'add' : 'remove';
    const value = body[field];
    if (typeof value !== 'string') throw invalidArgument(`${field} 必须是字符串`, [field]);

    const { dream } = await loadDream(id);
    const current = dream?.tags ?? [];
    let next: string[];
    if (hasAdd) {
      const r = addTag(current, value);
      if (!r.ok) throw invalidArgument(r.reason, ['add']);
      next = r.tags;
    } else {
      next = removeTag(current, value);
    }
    await deps.strapi.updateDream(id, { tags: next });
    return c.json({ tags: next });
  });

  app.put('/v1/dreams/:id/favorite', owner, async (c) => {
    const id = c.req.param('id');
    const body = await readJsonObject(c);
    const fav = validateFavoriteBody(body);
    if (!fav.ok) throw invalidArgument(fav.error, ['isFavorite']);
    await loadDream(id); // 404 时不创建任何记录
    await deps.strapi.updateDream(id, { isFavorite: fav.value }); // StrapiError → 502
    return c.json({ isFavorite: fav.value });
  });
};
