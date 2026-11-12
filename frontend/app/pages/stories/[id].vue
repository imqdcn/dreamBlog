<script setup lang="ts">
import { computed, ref } from 'vue';
import { normalizeStory } from '../../composables/useStories';

const route = useRoute();
const config = useRuntimeConfig();
const baseUrl = (config.public.strapiUrl as string).replace(/\/$/, '');
const id = route.params.id as string;
const session = useOwnerSession();
const studio = useStudio();

const { data: story, pending, error } = await useAsyncData(`story-${id}`, async () => {
  const res = (await $fetch(`${baseUrl}/api/stories/${encodeURIComponent(id)}`, {
    params: { populate: 'sourceDreams' },
  })) as { data?: any };
  return res.data ? normalizeStory(res.data) : null;
});

const deleting = ref(false);
const deleteError = ref('');

function formatDate(raw?: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const tags = computed<string[]>(() => {
  const t = (story.value as any)?.tags;
  return Array.isArray(t) ? t.filter((x: unknown): x is string => typeof x === 'string') : [];
});

/** 来源列表以 sourceSnapshot 为准（保持顺序），用实时 sourceDreams 判断是否仍存在 */
const sources = computed(() => {
  const s = story.value;
  if (!s) return [];
  const live = new Set(s.sourceDreams.map((d) => d.documentId));
  const snapshot = Array.isArray((s as any).sourceSnapshot) ? ((s as any).sourceSnapshot as any[]) : [];
  return snapshot.map((x) => ({
    documentId: String(x?.documentId ?? ''),
    title: typeof x?.title === 'string' && x.title ? x.title : '未命名的梦',
    exists: live.has(x?.documentId),
  }));
});

async function remove() {
  if (deleting.value) return;
  deleting.value = true;
  deleteError.value = '';
  try {
    await studio.request(`/v1/stories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await navigateTo('/stories');
  } catch (e: any) {
    deleteError.value = e?.message ? `删除失败：${e.message}` : '删除失败，故事已保留，请稍后重试';
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div>
    <NuxtLink to="/stories" class="back-link">← 返回故事列表</NuxtLink>

    <p v-if="pending" class="empty">加载中…</p>
    <p v-else-if="error || !story" class="empty">未找到这个故事。</p>

    <article v-else class="card">
      <div class="dream-card__meta">
        <span>{{ formatDate(story.createdAt) }}</span>
        <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
      </div>

      <h1 class="dream-card__title" style="font-size: 24px">{{ story.title || '未命名的故事' }}</h1>

      <div class="raw-block" style="white-space: pre-wrap">{{ story.content }}</div>

      <div class="section-label">来源 {{ sources.length }} 场梦</div>
      <ul v-if="sources.length">
        <li v-for="(src, i) in sources" :key="`${src.documentId}-${i}`">
          <NuxtLink v-if="src.exists" :to="`/dream/${src.documentId}`">{{ src.title }}</NuxtLink>
          <span v-else>该梦已不存在</span>
        </li>
      </ul>

      <div v-if="session.isOwner.value" style="margin-top: 16px">
        <p v-if="deleteError" class="empty" role="alert">{{ deleteError }}</p>
        <button type="button" :disabled="deleting" @click="remove">
          {{ deleting ? '删除中…' : '删除故事' }}
        </button>
      </div>
    </article>
  </div>
</template>
