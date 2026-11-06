export default ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      // 前端部署域名（逗号分隔），本地开发默认允许 localhost
      origin: env.array('CORS_ORIGIN', [
        'http://localhost:3000',
        'http://localhost:4173',
      ]),
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
