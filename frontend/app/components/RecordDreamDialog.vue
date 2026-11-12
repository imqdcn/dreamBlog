<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { StudioError, MSG_UNAVAILABLE } from '../composables/useStudio';

const DREAM_MAX = 10000;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 60000;

defineProps<{ studioUnavailable: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  /** 新梦已保存（含加工完成），父级刷新列表 */
  (e: 'saved'): void;
}>();

type Phase = 'idle' | 'submitting' | 'pending' | 'done' | 'failed' | 'timeout';

const studio = useStudio();
const text = ref('');
const phase = ref<Phase>('idle');
const error = ref('');
const documentId = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
let startedAt = 0;
let disposed = false;

const trimmedLength = computed(() => text.value.trim().length);

function validate(): string {
  if (trimmedLength.value < 1) return '请输入梦的内容';
  if (trimmedLength.value > DREAM_MAX) return `内容不能超过 ${DREAM_MAX} 个字符`;
  return '';
}

function stopPolling() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}

function schedulePoll() {
  stopPolling();
  timer = setTimeout(poll, POLL_INTERVAL_MS);
}

async function poll() {
  if (disposed) return;
  if (Date.now() - startedAt >= POLL_MAX_MS) {
    phase.value = 'timeout';
    return;
  }
  try {
    const res = await studio.request<{ status: 'pending' | 'done' | 'failed'; error?: string }>(
      `/v1/dreams/${encodeURIComponent(documentId.value)}/enrichment`
    );
    if (disposed) return;
    if (res.status === 'done') {
      phase.value = 'done';
      emit('saved');
      return;
    }
    if (res.status === 'failed') {
      phase.value = 'failed';
      return;
    }
  } catch (e) {
    if (disposed) return;
    // 会话失效或服务不可用时停止轮询
    if (e instanceof StudioError && (e.status === 401 || e.status === 0)) {
      error.value = e.status === 0 ? MSG_UNAVAILABLE : e.message;
      phase.value = 'timeout';
      return;
    }
  }
  schedulePoll();
}

function beginPolling() {
  phase.value = 'pending';
  startedAt = Date.now();
  schedulePoll();
}

async function submit() {
  if (phase.value === 'submitting' || phase.value === 'pending') return;
  const msg = validate();
  if (msg) {
    error.value = msg;
    return;
  }
  error.value = '';
  phase.value = 'submitting';
  try {
    const res = await studio.request<{ dream: { documentId: string }; enrichment: string }>('/v1/dreams', {
      method: 'POST',
      body: { content: text.value },
    });
    documentId.value = res.dream.documentId;
    emit('saved');
    beginPolling();
  } catch (e) {
    phase.value = 'idle';
    error.value = e instanceof StudioError ? (e.status === 0 ? MSG_UNAVAILABLE : e.message) : '保存失败';
  }
}

async function retry() {
  error.value = '';
  try {
    await studio.request(`/v1/dreams/${encodeURIComponent(documentId.value)}/enrich`, { method: 'POST' });
    beginPolling();
  } catch (e) {
    error.value = e instanceof StudioError ? (e.status === 0 ? MSG_UNAVAILABLE : e.message) : '重试失败';
  }
}

function close() {
  stopPolling();
  emit('close');
}

onBeforeUnmount(() => {
  disposed = true;
  stopPolling();
});
</script>

<template>
  <div class="backdrop" @click.self="close">
    <div class="dialog card" role="dialog" aria-modal="true" aria-label="记录一场梦">
      <h3>记录一场梦</h3>

      <p v-if="studioUnavailable" class="error" role="alert">服务暂不可用</p>

      <form v-if="phase === 'idle' || phase === 'submitting'" @submit.prevent="submit">
        <textarea
          v-model="text"
          rows="8"
          aria-label="梦的内容"
          placeholder="把昨晚的梦写下来…"
          :disabled="phase === 'submitting'"
        />
        <div class="meta">{{ trimmedLength }} / {{ DREAM_MAX }}</div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="row">
          <button type="submit" class="primary" :disabled="phase === 'submitting' || studioUnavailable">
            {{ phase === 'submitting' ? '保存中…' : '保存' }}
          </button>
          <button type="button" @click="close">取消</button>
        </div>
      </form>

      <div v-else class="status" role="status">
        <p v-if="phase === 'pending'">梦已保存，AI 正在加工中…</p>
        <p v-else-if="phase === 'done'">已完成：标题、摘要与情绪已生成 ✨</p>
        <p v-else-if="phase === 'failed'" class="error">加工失败，原文已保留，可重试。</p>
        <p v-else>加工仍在进行或状态暂不可用，稍后刷新页面查看。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="row">
          <button v-if="phase === 'failed'" type="button" class="primary" @click="retry">重试加工</button>
          <button type="button" @click="close">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  padding: 16px;
}
.dialog {
  width: 100%;
  max-width: 560px;
}
.dialog h3 {
  margin: 0 0 12px;
}
textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
  font-family: inherit;
  line-height: 1.7;
  resize: vertical;
}
.meta {
  text-align: right;
  font-size: 12px;
  color: var(--text-dim);
  margin: 4px 0 8px;
}
.row {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
button {
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
}
button.primary {
  border: 0;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: #e57373;
  font-size: 13px;
  margin: 6px 0;
}
</style>
