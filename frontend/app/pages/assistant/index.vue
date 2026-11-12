<script setup lang="ts">
import { computed } from 'vue';
import { linkifyAnswer } from '../../utils/linkify';
import { validateQuestion } from '../../utils/question';
import { formatCost, isIncomplete, terminationLabel, toolStatusLabel } from '../../utils/agent-labels';

const session = useOwnerSession();
const run = useAgentRun();
const { data: dreams } = useDreams();

const progress = computed(() => run.progress.value);
const result = computed(() => progress.value?.result);
const steps = computed(() => progress.value?.steps ?? []);
const answerSegments = computed(() =>
  result.value ? linkifyAnswer(result.value.answer ?? '', (dreams.value ?? []) as any[]) : []
);

async function ask() {
  const v = validateQuestion(run.question.value);
  if (!v.ok) {
    run.error.value = v.error; // 本地拒绝，不发送请求
    return;
  }
  await run.submit();
}
</script>

<template>
  <div>
    <h2>梦境分析助手</h2>
    <p v-if="!session.isOwner.value" class="empty">仅 Owner 登录后可使用梦境分析助手。</p>

    <template v-else>
      <p><NuxtLink to="/assistant/runs">查看运行记录 →</NuxtLink></p>

      <form class="card" @submit.prevent="ask">
        <label for="agent-question">向助手提问</label>
        <textarea
          id="agent-question"
          v-model="run.question.value"
          rows="3"
          maxlength="500"
          placeholder="例如：最近一个月我的梦境情绪有什么变化？"
          style="width: 100%"
        />
        <div style="margin-top: 8px">
          <button type="submit" :disabled="run.running.value">{{ run.running.value ? '运行中…' : '提问' }}</button>
          <button
            v-if="run.running.value"
            type="button"
            :disabled="run.cancelling.value"
            style="margin-left: 8px"
            @click="run.cancel()"
          >
            {{ run.cancelling.value ? '取消中…' : '取消' }}
          </button>
        </div>
      </form>

      <p v-if="run.error.value" class="empty" role="alert">{{ run.error.value }}</p>

      <section v-if="steps.length || run.running.value" class="card" aria-live="polite">
        <div class="section-label">进度</div>
        <p v-if="run.running.value && steps.length === 0">正在启动…</p>
        <ul>
          <li v-for="s in steps" :key="s.step">
            <span v-if="s.phase === 'thinking' && run.running.value">第 {{ s.step }} 步推理中</span>
            <span v-else>第 {{ s.step }} 步</span>
            <span v-if="s.aborted">（已中止）</span>
            <ul v-if="s.tools.length">
              <li v-for="(t, i) in s.tools" :key="i">{{ t.name }}：{{ toolStatusLabel(t.status) }}</li>
            </ul>
          </li>
        </ul>
      </section>

      <section v-if="result" class="card">
        <div class="section-label">回答</div>
        <p v-if="isIncomplete(result.terminationReason)" role="status">
          {{ terminationLabel(result.terminationReason) }} · 回答可能不完整
        </p>
        <p v-else class="dream-card__meta">{{ terminationLabel(result.terminationReason) }}</p>

        <div class="raw-block" style="white-space: pre-wrap"><template v-for="(seg, i) in answerSegments" :key="i"><NuxtLink
              v-if="seg.type === 'dreamLink'"
              :to="seg.to"
            >{{ seg.text }}</NuxtLink><template v-else>{{ seg.text }}</template></template></div>

        <p class="dream-card__meta">
          共 {{ result.stepCount }} 步 · 总 token {{ result.totalTokens }} · 估算成本 {{ formatCost(result.estimatedCost) }}
        </p>

        <details v-if="steps.length">
          <summary>Trace</summary>
          <ol>
            <li v-for="s in steps" :key="s.step">
              第 {{ s.step }} 步<span v-if="s.aborted">（已中止）</span>
              <ul>
                <li v-for="(t, i) in s.tools" :key="i">{{ t.name }}：{{ toolStatusLabel(t.status) }}</li>
                <li v-if="s.tools.length === 0">无工具调用</li>
              </ul>
            </li>
          </ol>
        </details>
      </section>

      <section v-else-if="!run.running.value && steps.length" class="card">
        <p>运行已停止，已保留已展示的 Trace。</p>
        <details>
          <summary>Trace</summary>
          <ol>
            <li v-for="s in steps" :key="s.step">
              第 {{ s.step }} 步<span v-if="s.aborted">（已中止）</span>
              <ul>
                <li v-for="(t, i) in s.tools" :key="i">{{ t.name }}：{{ toolStatusLabel(t.status) }}</li>
              </ul>
            </li>
          </ol>
        </details>
      </section>
    </template>
  </div>
</template>
