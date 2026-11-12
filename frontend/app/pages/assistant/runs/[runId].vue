<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { StepTrace, TraceEntry } from '../../../types/dream';
import { linkifyAnswer } from '../../../utils/linkify';
import {
  formatCost,
  formatDateTime,
  formatMs,
  isIncomplete,
  terminationLabel,
  toolStatusLabel,
} from '../../../utils/agent-labels';

const route = useRoute();
const runId = route.params.runId as string;
const session = useOwnerSession();
const studio = useStudio();
const { data: dreams } = useDreams();

const run = ref<any>(null);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    run.value = await studio.request(`/v1/agent/runs/${encodeURIComponent(runId)}`);
  } catch (e: any) {
    run.value = null;
    error.value = e?.status === 404 ? '未找到这条运行记录。' : e?.message || '运行详情加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (session.isOwner.value) void load();
});

/** 仅 step 条目，按步骤序号升序（需求 13.5） */
const steps = computed<StepTrace[]>(() => {
  const t = run.value?.trace;
  if (!Array.isArray(t)) return [];
  return (t as TraceEntry[])
    .filter((e): e is StepTrace => e?.kind === 'step')
    .slice()
    .sort((a, b) => a.step - b.step);
});

const totalTokens = computed(() => (run.value?.promptTokens ?? 0) + (run.value?.completionTokens ?? 0));
const answerSegments = computed(() =>
  linkifyAnswer(String(run.value?.finalAnswer ?? ''), (dreams.value ?? []) as any[])
);
</script>

<template>
  <div>
    <NuxtLink to="/assistant/runs" class="back-link">← 返回运行记录</NuxtLink>
    <p v-if="!session.isOwner.value" class="empty">仅 Owner 登录后可查看运行详情。</p>
    <p v-else-if="loading" class="empty">加载中…</p>
    <p v-else-if="error" class="empty" role="alert">{{ error }}</p>

    <article v-else-if="run" class="card">
      <div class="dream-card__meta">
        <span>{{ formatDateTime(run.createdAt) }}</span>
        <span class="tag">{{ terminationLabel(run.terminationReason) }}</span>
      </div>
      <h1 class="dream-card__title" style="font-size: 22px">{{ run.question }}</h1>

      <p v-if="isIncomplete(run.terminationReason)" role="status">回答可能不完整</p>
      <div class="raw-block" style="white-space: pre-wrap"><template v-for="(seg, i) in answerSegments" :key="i"><NuxtLink
            v-if="seg.type === 'dreamLink'"
            :to="seg.to"
          >{{ seg.text }}</NuxtLink><template v-else>{{ seg.text }}</template></template></div>

      <p class="dream-card__meta">
        共 {{ run.stepCount ?? steps.length }} 步 · 总 token {{ totalTokens }} · 估算成本
        {{ formatCost(run.estimatedCost) }} · 耗时 {{ formatMs(run.durationMs) }}
      </p>

      <div class="section-label">时间线</div>
      <p v-if="steps.length === 0" class="empty">没有步骤记录。</p>
      <ol v-else>
        <li v-for="s in steps" :key="s.step">
          <div>
            第 {{ s.step }} 步<span v-if="s.llm?.aborted">（已中止）</span> · LLM 耗时 {{ formatMs(s.llm?.durationMs) }}
          </div>
          <ul>
            <li v-for="(t, i) in s.toolCalls ?? []" :key="t.callId ?? i">
              {{ t.name }}：{{ toolStatusLabel(t.status) }} · 工具耗时 {{ formatMs(t.durationMs) }}
            </li>
            <li v-if="!s.toolCalls || s.toolCalls.length === 0">无工具调用</li>
          </ul>
        </li>
      </ol>
    </article>
  </div>
</template>
