<script setup lang="ts">
import { computed, ref } from 'vue';
import { selectFavorites } from '../utils/favorites';

const { data: dreams, pending, error, refresh } = useDreams();
const session = useOwnerSession();
const studio = useStudio();

const favorites = computed(() => selectFavorites(dreams.value ?? []));

/** 正在取消珍藏的 documentId，防止重复提交 */
const busy = ref<string | null>(null);
const actionError = ref('');

function formatDate(raw?: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function excerpt(d: { summary?: string; rawContent: string }): string {
  const text = d.summary || d.rawContent || '';
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

async function unfavorite(d: { documentId?: string; id: number }) {
  const key = d.documentId ?? String(d.id);
  if (busy.value) return;
  busy.value = key;
  actionError.value = '';
  try {
    await studio.request(`/v1/dreams/${encodeURIComponent(key)}/favorite`, {
      method: 'PUT',
      body: { isFavorite: false },
    });
    await refresh();
  } catch (e: any) {
    actionError.value = e?.message || '取消珍藏失败，请稍后重试';
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div>
    <h2>珍藏的梦</h2>

    <p v-if="pending" class="empty">正在加载珍藏的梦…</p>

    <p v-else-if="error" class="empty">
      加载失败，请确认后端已启动且可访问。<br />
      <small>{{ error.message }}</small>
    </p>

    <p v-else-if="favorites.length === 0" class="empty">
      还没有珍藏的梦。<br />
      Owner 登录后，可以对小智说「珍藏这个梦」，或通过 Studio 将喜欢的梦设为珍藏 ✨
    </p>

    <template v-else>
      <p v-if="actionError" class="empty" role="alert">{{ actionError }}</p>
      <div v-for="d in favorites" :key="d.id" class="card dream-card">
        <NuxtLink :to="`/dream/${d.documentId ?? d.id}`" style="color: inherit; text-decoration: none">
          <div class="dream-card__meta">
            <EmotionPill :emotion="d.emotion" />
            <span>{{ formatDate(d.dreamedAt || d.createdAt) }}</span>
          </div>
          <div class="dream-card__title">{{ d.title || '未命名的梦' }}</div>
          <div class="dream-card__summary">{{ excerpt(d) }}</div>
        </NuxtLink>
        <div v-if="session.isOwner.value" style="margin-top: 10px">
          <button type="button" :disabled="busy !== null" @click="unfavorite(d)">
            {{ busy === (d.documentId ?? String(d.id)) ? '处理中…' : '取消珍藏' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
