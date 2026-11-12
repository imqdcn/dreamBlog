<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { formatCost, formatDateTime, formatMs, terminationLabel } from '../../../utils/agent-labels';

interface RunItem {
  runId?: string;
  documentId?: string;
  question: string;
  terminationReason: string;
  totalTokens: number;
  estimatedCost: number;
  durationMs: number;
  createdAt?: string;
}

const session = useOwnerSession();
const studio = useStudio();

const items = ref<RunItem[]>([]);
const page = ref(1);
const pageCount = ref(1);
const loading = ref(false);
const error = ref('');

async function load(p = 1) {
  loading.value = true;
  error.value = '';
  try {
    const res = await studio.request<{ items?: RunItem[]; pagination?: { pageCount?: number } }>('/v1/agent/runs', {
      query: { page: p },
    });
    items.value = Array.isArray(res?.items) ? res.items : [];
    page.value = p;
    pageCount.value = res?.pagination?.pageCount ?? 1;
  } catch (e: any) {
    error.value = e?.message || '运行记录加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (session.isOwner.value) void load(1);
});
</script>

<template>
  <div>
    <NuxtLink to="/assistant" class="back-link">← 返回梦境分析助手</NuxtLink>
    <h2>运行记录</h2>
    <p v-if="!session.isOwner.value" class="empty">仅 Owner 登录后可查看运行记录。</p>

    <template v-else>
      <p v-if="error" class="empty" role="alert">
        {{ error }} <button type="button" :disabled="loading" @click="load(page)">重试</button>
      </p>
      <p v-else-if="loading && items.length === 0" class="empty">加载中…</p>
      <p v-else-if="items.length === 0" class="empty">还没有运行记录。</p>

      <div v-for="r in items" :key="r.runId ?? r.documentId" class="card dream-card">
        <NuxtLink v-if="r.runId" :to="`/assistant/runs/${encodeURIComponent(r.runId)}`" style="color: inherit; text-decoration: none">
          <div class="dream-card__meta">
            <span>{{ formatDateTime(r.createdAt) }}</span>
            <span class="tag">{{ terminationLabel(r.terminationReason) }}</span>
          </div>
          <div class="dream-card__title">{{ r.question }}</div>
          <div class="dream-card__meta">
            总 token {{ r.totalTokens }} · 估算成本 {{ formatCost(r.estimatedCost) }} · 耗时 {{ formatMs(r.durationMs) }}
          </div>
        </NuxtLink>
      </div>

      <div v-if="pageCount > 1">
        <button type="button" :disabled="loading || page <= 1" @click="load(page - 1)">上一页</button>
        <span> 第 {{ page }} / {{ pageCount }} 页 </span>
        <button type="button" :disabled="loading || page >= pageCount" @click="load(page + 1)">下一页</button>
      </div>
    </template>
  </div>
</template>
