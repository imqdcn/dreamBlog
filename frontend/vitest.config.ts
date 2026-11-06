import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // 仅覆盖纯函数（聚合工具）。组件测试如需 DOM，可改用 happy-dom。
    include: ['app/utils/**/*.test.ts'],
  },
});
