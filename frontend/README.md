# Frontend · Nuxt

梦境日记流 + 统计可视化。纯静态站点（`ssr: false`），从 Strapi 公开只读 API 拉数据。

## 页面

- `/`：梦境日记流（按时间倒序，情绪标签、摘要、关键词）
- `/dream/:id`：梦境详情（全文、关键词、原始口述）
- `/stats`：统计（情绪趋势折线、情绪分布、关键词云、梦境日历热力图）

## 技术栈

- Nuxt 4（源码在 `app/` 目录）
- ECharts 5 + vue-echarts 7 + echarts-wordcloud 2（图表与词云）

## 本地启动

```bash
npm install
cp .env.example .env   # 填写 NUXT_PUBLIC_STRAPI_URL
npm run dev            # http://localhost:3000
```

## 环境变量

- `NUXT_PUBLIC_STRAPI_URL`：Strapi 公开读取地址。
- `NUXT_APP_BASE_URL`：GitHub Pages 子路径部署时设置，例如 `/dream-blog/`。

## 测试与构建

```bash
npm test             # 聚合函数单测
npm run generate     # 生成静态站点到 .output/public/
```

## 部署

### Vercel
导入仓库，设 Root Directory 为 `frontend`，Build Command `npm run generate`，Output Directory `.output/public`。
在环境变量里设 `NUXT_PUBLIC_STRAPI_URL` 为线上 Strapi 地址。

### GitHub Pages
仓库已内置工作流 `.github/workflows/deploy-frontend.yml`，推送到默认分支后自动构建并发布。
需在仓库 Settings → Secrets and variables → Actions 配置：
- 变量 `NUXT_PUBLIC_STRAPI_URL`：线上 Strapi 地址
- 变量 `NUXT_APP_BASE_URL`：若部署在 `https://<user>.github.io/<repo>/`，设为 `/<repo>/`

部署后记得把前端域名加入 Strapi 的 `CORS_ORIGIN`。
