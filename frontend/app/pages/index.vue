<script setup lang="ts">
import { emotionMeta } from '../types/dream';

const { data: dreams, pending, error } = useDreams();

function formatDate(raw?: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function excerpt(d: { summary?: string; rawContent: string }): string {
  const text = d.summary || d.rawContent || '';
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}
</script>

<template>
  <div>
    <p v-if="pending" class="empty">正在加载梦境…</p>

    <p v-else-if="error" class="empty">
      加载失败，请确认后端已启动且可访问。<br />
      <small>{{ error.message }}</small>
    </p>

    <p v-else-if="!dreams || dreams.length === 0" class="empty">
      还没有任何梦境记录。<br />
      对小智说「帮我记录一个梦……」来创建第一条吧 🌙
    </p>

    <template v-else>
      <NuxtLink
        v-for="d in dreams"
        :key="d.id"
        :to="`/dream/${d.documentId ?? d.id}`"
        class="card dream-card"
      >
        <div class="dream-card__meta">
          <EmotionPill :emotion="d.emotion" />
          <span>{{ formatDate(d.dreamedAt || d.createdAt) }}</span>
          <span v-if="!d.aiProcessed" class="tag">未加工</span>
        </div>
        <div class="dream-card__title">{{ d.title || '未命名的梦' }}</div>
        <div class="dream-card__summary">{{ excerpt(d) }}</div>
        <div v-if="d.keywords && d.keywords.length" style="margin-top: 10px">
          <span v-for="k in d.keywords.slice(0, 5)" :key="k" class="tag">{{ k }}</span>
        </div>
      </NuxtLink>
    </template>
  </div>
</template>
