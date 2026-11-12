import { validateDreamWrite } from './validation/dream';
import { validateStoryWrite } from './validation/story';

export default {
  /**
   * 在应用初始化、依赖注册之前执行。
   * 注册 Document Service 写入校验中间件（需求 3.7、3.8、16.5）。
   * 校验失败抛出 ValidationError，发生在写库之前，因此数据保持不变。
   */
  register({ strapi }: { strapi: any }) {
    strapi.documents.use(async (ctx: any, next: () => Promise<unknown>) => {
      const action = ctx.action;
      if (action !== 'create' && action !== 'update') return next();

      if (ctx.uid === 'api::dream.dream' || ctx.uid === 'api::story.story') {
        // 缺少 data 时无需校验，交给后续处理
        const data = ctx.params?.data;
        if (data && typeof data === 'object') {
          if (ctx.uid === 'api::dream.dream') validateDreamWrite(data, action);
          else validateStoryWrite(data, action);
        }
      }
      return next();
    });
  },

  /**
   * 在应用完成初始化、准备好对外服务之后执行。
   * 幂等回填存量 Dream（需求 3.9）：isFavorite 为 null -> false，tags 为 null -> []。
   * 没有可回填的行时 updateMany 为空操作，重复运行结果不变。
   */
  async bootstrap({ strapi }: { strapi: any }) {
    const query = strapi.db.query('api::dream.dream');
    await query.updateMany({ where: { isFavorite: null }, data: { isFavorite: false } });
    await query.updateMany({ where: { tags: null }, data: { tags: [] } });
  },
};
