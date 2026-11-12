<script setup lang="ts">
// 占位页：不发起任何请求（需求 4.12）
</script>

<template>
  <main class="archive-placeholder" aria-labelledby="archive-title">
    <h1 id="archive-title">存档冒险</h1>
    <p class="badge">即将推出</p>
    <p class="hint">这里将成为把梦境延伸为可存档冒险的地方，敬请期待。</p>
    <NuxtLink to="/">返回首页</NuxtLink>
  </main>
</template>

<style scoped>
.archive-placeholder {
  max-width: 640px;
  margin: 4rem auto;
  padding: 0 1rem;
  text-align: center;
}
.badge {
  display: inline-block;
  margin: 1rem 0;
  padding: 0.25rem 0.9rem;
  border-radius: 999px;
  background: #9b5de5;
  color: #fff;
}
.hint {
  margin-bottom: 1.5rem;
  opacity: 0.8;
}
</style>
