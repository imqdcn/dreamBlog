<script setup lang="ts">
import { computed, ref } from 'vue';
import { excerpt } from '../../utils/excerpt';

const { data, pending, refresh } = useStories();
const session = useOwnerSession();
const studio = useStudio();

const stories = computed(() => data.value?.items ?? []);
const loadError = computed(() => data.value?.error);

const busy = ref<string | null>(null);
const actionError = ref('');

function formatDate(raw?: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tagsOf(s: { tags?: unknown }): string[] {
  return Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string') : [];
}

function keyOf(s: { documentId?: string; id: number }): string {
  return s.documentId ?? String(s.id);
}

async function remove(s: { documentId?: string; id: number }) {
  if (busy.value) return;
  busy.value = keyOf(s);
  actionError.value = '';
  try {
    await studio.request(`/v1/stories/${encodeURIComponent(keyOf(s))}`, { method: 'DELETE' });
    await refresh();
  } catch (e: any) {
    actionError.value = e?.message ? `删除失败：${e.message}` : '删除失败，故事已保留，请稍后重试';
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div>
    <h2>梦的另一种可能</h2>

    <p v-if="actionError" class="empty" role="alert">{{ actionError }}</p>

    <p v-if="pending && stories.length === 0" class="empty">正在加载故事…</p>

    <template v-else>
      <p v-if="stories.length === 0 && !loadError" class="empty">
        还没有故事。<br />
        Owner 登录后，可以在「梦境手记」中勾选几场梦作为灵感，创作第一个故事 ✨
      </p>

      <div v-for="s in stories" :key="keyOf(s)" class="card dream-card">
        <NuxtLink :to="`/stories/${keyOf(s)}`" style="color: inherit; text-decoration: none">
          <div class="dream-card__meta">
            <span>{{ formatDate(s.createdAt) }}</span>
            <span v-for="t in tagsOf(s)" :key="t" class="tag">{{ t }}</span>
          </div>
          <div class="dream-card__title">{{ s.title || '未命名的故事' }}</div>
          <div class="dream-card__summary">{{ excerpt(s.content ?? '') }}</div>
          <div class="dream-card__meta">来源 {{ s.sourceDreams.length }} 场梦</div>
        </NuxtLink>
        <div v-if="session.isOwner.value" style="margin-top: 10px">
          <button type="button" :disabled="busy !== null" @click="remove(s)">
            {{ busy === keyOf(s) ? '删除中…' : '删除' }}
          </button>
        </div>
      </div>

      <p v-if="loadError" class="empty" role="alert">
        故事加载失败，已显示部分内容。
        <button type="button" :disabled="pending" @click="refresh()">重试</button>
      </p>
    </template>
  </div>
</template>
