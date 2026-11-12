'use strict';

/**
 * 一次性引导脚本：
 * 1) 创建（或复用）一个具备完全访问权限的 API Token，用于 MCP Server 写入梦境。
 * 2) 打开 Public 角色对 dream 的只读权限（find / findOne），供前端公开读取。
 *
 * 用法：node ./scripts/setup-access.js
 * 脚本会在控制台打印 API Token（仅首次创建时可见，请妥善保存）。
 */

const { createStrapi, compileStrapi } = require('@strapi/strapi');

async function main() {
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  // ---- 1. API Token ----
  const tokenService = app.service('admin::api-token');
  const tokenName = 'mcp-server-write';
  const existing = await tokenService.getByName(tokenName);

  let tokenValue = null;
  if (existing) {
    console.log(`\nAPI Token「${tokenName}」已存在（无法再次显示明文）。`);
    console.log('如需新明文，请先在 Admin 后台删除后重跑本脚本。');
  } else {
    const created = await tokenService.create({
      name: tokenName,
      description: 'MCP Server 写入梦境用（full-access）',
      type: 'full-access',
      lifespan: null,
    });
    tokenValue = created.accessKey;
  }

  // ---- 1b. Studio Service 专用 API Token（custom，最小权限，不含 Dream delete）----
  const studioTokenName = 'studio-service-write';
  const studioPermissions = [
    'api::dream.dream.find',
    'api::dream.dream.findOne',
    'api::dream.dream.create',
    'api::dream.dream.update',
    'api::story.story.find',
    'api::story.story.findOne',
    'api::story.story.create',
    'api::story.story.delete',
    'api::agent-run.agent-run.find',
    'api::agent-run.agent-run.findOne',
    'api::agent-run.agent-run.create',
  ];
  const existingStudio = await tokenService.getByName(studioTokenName);

  let studioTokenValue = null;
  if (existingStudio) {
    console.log(`\nAPI Token「${studioTokenName}」已存在（无法再次显示明文）。`);
    console.log('如需新明文，请先在 Admin 后台删除后重跑本脚本。');
  } else {
    const createdStudio = await tokenService.create({
      name: studioTokenName,
      description: 'Studio Service 写入用（custom：无 Dream delete）',
      type: 'custom',
      lifespan: null,
      permissions: studioPermissions,
    });
    studioTokenValue = createdStudio.accessKey;
  }

  // ---- 2. Public 角色只读权限 ----
  const publicRole = await app
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (publicRole) {
    // 不为 agent-run 添加任何 Public 权限
    const actions = [
      'api::dream.dream.find',
      'api::dream.dream.findOne',
      'api::story.story.find',
      'api::story.story.findOne',
    ];
    for (const action of actions) {
      const existingPerm = await app
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action, role: publicRole.id } });
      if (!existingPerm) {
        await app.query('plugin::users-permissions.permission').create({
          data: { action, role: publicRole.id },
        });
        console.log(`已为 Public 角色开启权限：${action}`);
      } else {
        console.log(`Public 角色已有权限：${action}`);
      }
    }
  } else {
    console.log('未找到 Public 角色，跳过只读权限配置。');
  }

  if (tokenValue) {
    console.log('\n==================== API TOKEN（请复制保存）====================');
    console.log(tokenValue);
    console.log('================================================================');
    console.log('把它填入 mcp-server/.env 的 Strapi Token 变量。\n');
  }

  if (studioTokenValue) {
    console.log('\n============== STUDIO API TOKEN（请复制保存）==============');
    console.log(studioTokenValue);
    console.log('===========================================================');
    console.log('把它填入 studio-service/.env 的 Strapi Token 变量。\n');
  }

  await app.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('setup-access 执行失败：', err);
  process.exit(1);
});
