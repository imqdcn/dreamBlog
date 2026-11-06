// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  // 前端为纯静态站点，便于部署到 GitHub Pages / Vercel
  ssr: false,

  app: {
    // GitHub Pages 子路径部署时可通过 NUXT_APP_BASE_URL 覆盖，例如 /dream-blog/
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
    head: {
      title: '梦境日记',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: '通过小智语音记录的梦境日记与统计' },
      ],
    },
  },

  runtimeConfig: {
    public: {
      // Strapi 公开读取地址，部署时用 NUXT_PUBLIC_STRAPI_URL 覆盖
      strapiUrl: process.env.NUXT_PUBLIC_STRAPI_URL || 'http://localhost:1337',
    },
  },

  nitro: {
    // SPA 模式下生成 404.html 作为 GitHub Pages 的路由兜底，
    // 保证刷新动态路由（如 /dream/:id）不会 404。
    prerender: {
      failOnError: false,
    },
  },

  css: ['~/assets/css/main.css'],
});
