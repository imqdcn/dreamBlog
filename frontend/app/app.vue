<script setup lang="ts">
import { useOwnerSession } from '~/composables/useOwnerSession';
import { useStudio } from '~/composables/useStudio';

const session = useOwnerSession();
const studio = useStudio();
// isOwner 驱动 Owner 区条目；服务端渲染时无 localStorage，恒为只读视图
const isOwner = computed(() => session.isOwner.value);
const notice = computed(() => studio.notice.value);

const browse = [
  { to: '/', label: '日记流' },
  { to: '/journal', label: '梦境手记' },
  { to: '/favorites', label: '珍藏的梦' },
  { to: '/calendar', label: '梦境日历' },
  { to: '/universe', label: '梦境宇宙' },
  { to: '/archive', label: '存档冒险' },
  { to: '/stats', label: '统计' },
];

function exitHut() {
  session.logout();
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <NuxtLink to="/" class="site-title">🌙 梦境日记</NuxtLink>
      <nav class="side-nav" aria-label="主导航">
        <div class="side-group">
          <NuxtLink v-for="item in browse" :key="item.to" :to="item.to" :active-class="item.to === '/' ? 'is-inactive' : 'router-link-active'" exact-active-class="router-link-active">
            {{ item.label }}
          </NuxtLink>
        </div>
        <div class="side-group">
          <NuxtLink to="/stories">梦的另一种可能</NuxtLink>
        </div>
        <div v-if="isOwner" class="side-group">
          <NuxtLink to="/assistant">梦境分析助手</NuxtLink>
          <NuxtLink to="/journal?record=1" active-class="is-inactive" exact-active-class="is-inactive">记录一场梦</NuxtLink>
          <NuxtLink to="/settings">小屋设置</NuxtLink>
          <button type="button" class="side-btn" @click="exitHut">退出小屋</button>
        </div>
      </nav>
      <div v-if="!isOwner" class="side-footer">
        <NuxtLink to="/login">登录</NuxtLink>
      </div>
    </aside>
    <main class="container">
      <p v-if="notice" class="side-notice" role="status">{{ notice }}</p>
      <NuxtPage />
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  align-items: flex-start;
  min-height: 100vh;
}
.sidebar {
  position: sticky;
  top: 0;
  flex: 0 0 200px;
  width: 200px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 12px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
.side-nav {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
}
.side-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.side-group + .side-group {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.side-nav a,
.side-footer a,
.side-btn {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border-radius: 10px;
  color: var(--text-dim);
  font-size: 14px;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
  font-family: inherit;
}
.side-nav a:hover,
.side-footer a:hover,
.side-btn:hover {
  color: var(--text);
  background: var(--bg-soft);
}
.side-nav a.router-link-active:not(.side-btn),
.side-footer a.router-link-active {
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
}
.side-footer {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.layout > .container {
  flex: 1;
  min-width: 0;
  margin: 0 auto;
}
.side-notice {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--bg-soft);
  color: var(--text-dim);
  font-size: 14px;
}
@media (max-width: 720px) {
  .layout {
    flex-direction: column;
  }
  .sidebar {
    position: static;
    width: 100%;
    flex: none;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .layout > .container {
    width: 100%;
  }
}
</style>
