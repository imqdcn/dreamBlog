<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

const config = useRuntimeConfig();
const session = useOwnerSession();
const studio = useStudio();

const studioUrl = computed(() => config.public.studioUrl as string);

// 未登录或会话已过期时回到登录页
if (!session.isOwner.value) {
  await navigateTo('/login');
}

type Health = 'checking' | 'ok' | 'unavailable';
const health = ref<Health>('checking');

async function check() {
  health.value = 'checking';
  try {
    await studio.request('/health', { anonymous: true });
    health.value = 'ok';
  } catch {
    health.value = 'unavailable';
  }
}

onMounted(check);

const healthText = computed(() =>
  health.value === 'checking' ? '检测中…' : health.value === 'ok' ? '已连通' : '服务暂不可用',
);

const expiresText = computed(() => {
  const t = session.expiresAt.value;
  return t === null ? '—' : new Date(t).toLocaleString('zh-CN', { hour12: false });
});
</script>

<template>
  <section class="settings">
    <h1>小屋设置</h1>
    <dl>
      <dt>Studio 地址</dt>
      <dd>{{ studioUrl }}</dd>
      <dt>连通状态</dt>
      <dd>
        {{ healthText }}
        <button type="button" :disabled="health === 'checking'" @click="check">重新检测</button>
      </dd>
      <dt>会话到期时间</dt>
      <dd>{{ expiresText }}</dd>
    </dl>
  </section>
</template>

<style scoped>
.settings {
  max-width: 560px;
  margin: 24px auto;
}
dt {
  font-weight: 600;
  margin-top: 16px;
}
dd {
  margin: 4px 0 0;
}
button {
  margin-left: 8px;
  padding: 2px 10px;
  border: 1px solid #c9b8e8;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
</style>
