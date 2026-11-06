<script setup lang="ts">
import { emotionMeta } from '../../types/dream';

const route = useRoute();
const config = useRuntimeConfig();
const baseUrl = config.public.strapiUrl as string;
const id = route.params.id as string;

const { data: dream, pending, error } = await useAsyncData(`dream-${id}`, () =>
  fetchDream(baseUrl, id)
);

function formatDate(raw?: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <div>
    <NuxtLink to="/" class="back-link">← 返回日记流</NuxtLink>

    <p v-if="pending" class="empty">加载中…</p>
    <p v-else-if="error || !dream" class="empty">未找到这条梦境。</p>

    <article v-else class="card">
      <div class="dream-card__meta">
        <EmotionPill :emotion="dream.emotion" />
        <span>{{ formatDate(dream.dreamedAt || dream.createdAt) }}</span>
        <span v-if="typeof dream.clarity === 'number'" class="tag">清晰度 {{ dream.clarity }}/5</span>
      </div>

      <h1 class="dream-card__title" style="font-size: 24px">
        {{ dream.title || '未命名的梦' }}
      </h1>

      <p v-if="dream.summary" class="dream-card__summary" style="font-size: 15px">
        {{ dream.summary }}
      </p>

      <div v-if="dream.keywords && dream.keywords.length">
        <div class="section-label">关键词</div>
        <span v-for="k in dream.keywords" :key="k" class="tag">{{ k }}</span>
      </div>

      <div class="section-label">原始口述</div>
      <div class="raw-block">{{ dream.rawContent }}</div>
    </article>
  </div>
</template>
