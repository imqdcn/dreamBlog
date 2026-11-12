/**
 * stories 路由（需求 7.6、7.10–7.13、8.9）。
 *
 * POST /v1/stories：校验（400，不调用 LLM）→ 去重键占用（409，不调用 LLM）→ 生成（失败 502）
 *                   → 保存 Story（含 sourceSnapshot、Tag 并集）；finally 释放去重键。
 * DELETE /v1/stories/:id：仅删除 Story，不触碰来源 Dream；失败时 Story 保留并返回错误。
 */
import { normalizeDream } from '../../backend/dream-source.js';
import { dedupeKey, InFlightSet, validateStoryRequest } from '../../domain/story-request.js';
import { unionTags } from '../../domain/tags.js';
import type { DreamRecord } from '../../domain/types.js';
import { generateStory } from '../../llm/story-generator.js';
import { errorFields, logger } from '../../logger.js';
import type { RouteRegistrar } from '../app.js';
import { conflict, invalidArgument, notFound, requireOwner, upstreamFailed } from '../middleware.js';

const UNTITLED_DREAM = '未命名的梦';

export const registerStoryRoutes: RouteRegistrar = (app, deps) => {
  const inFlight = (deps.extras?.storyInFlight as InFlightSet | undefined) ?? new InFlightSet();
  const owner = requireOwner(deps);

  app.post('/v1/stories', owner, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw invalidArgument('请求体不是合法的 JSON');
    }

    // 校验的同时读取每条 Dream，避免二次读取
    const loaded = new Map<string, DreamRecord>();
    const validation = await validateStoryRequest(body, async (id) => {
      const entity = await deps.strapi.getDream(id);
      const dream = entity ? normalizeDream(entity) : null;
      if (!dream) return false;
      loaded.set(id, dream);
      return true;
    });
    if (!validation.ok) throw invalidArgument(validation.reason);
    const { dreamIds, style } = validation.value;
    const dreams = dreamIds.map((id) => loaded.get(id)!);

    const outcome = await inFlight.run(dedupeKey(style, dreamIds), async () => {
      let generated: { title: string; content: string };
      try {
        generated = await generateStory(deps.llm, dreams, style);
      } catch (err) {
        logger.error('story generation failed', undefined, { style, dreamCount: dreams.length, ...errorFields(err) });
        throw upstreamFailed('故事生成失败，请稍后重试');
      }
      const saved = await deps.strapi.createStory({
        title: generated.title,
        content: generated.content,
        style,
        tags: unionTags(dreams.map((d) => d.tags)),
        sourceDreams: dreamIds,
        sourceSnapshot: dreams.map((d) => ({
          documentId: d.documentId,
          title: d.title?.trim() || UNTITLED_DREAM,
        })),
      });
      return saved;
    });
    if (outcome.conflict) throw conflict('相同的故事生成请求正在处理中');

    return c.json(outcome.value, 201);
  });

  app.delete('/v1/stories/:id', owner, async (c) => {
    const deleted = await deps.strapi.deleteStory(c.req.param('id'));
    if (!deleted) throw notFound('故事不存在');
    return c.json({ deleted: true });
  });
};
