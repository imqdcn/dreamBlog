<script setup lang="ts">
import { ref } from 'vue';
import type { StoryStyle } from '../types/dream';
import { canSubmit, type SelectionState } from '../utils/story-selection';
import { StudioError, MSG_UNAVAILABLE } from '../composables/useStudio';

interface CreatedStory {
  documentId?: string;
  title: string;
  content: string;
  style?: string;
  tags?: string[];
}

const props = defineProps<{
  selection: SelectionState;
  studioUnavailable: boolean;
  /** documentId/id → 展示标题 */
  titles: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'clear'): void;
  /** 创作成功：父组件清空选择 */
  (e: 'created', story: CreatedStory): void;
}>();

const STYLES: Array<{ value: StoryStyle; label: string }> = [
  { value: 'gentle_fairytale', label: '温柔童话' },
  { value: 'mystery', label: '悬疑' },
  { value: 'sci_fi', label: '科幻' },
  { value: 'poetic', label: '散文诗' },
];

const studio = useStudio();
const style = ref<StoryStyle | ''>('');
const generating = ref(false);
const error = ref('');

async function submit() {
  if (generating.value || !canSubmit(props.selection, style.value)) return;
  generating.value = true;
  error.value = '';
  try {
    const story = await studio.request<CreatedStory>('/v1/stories', {
      method: 'POST',
      body: { dreamIds: [...props.selection.selected].map(String), style: style.value },
      // 生成可能长达 60 秒
      timeoutMs: 70000,
    });
    emit('created', story);
  } catch (e) {
    // 失败：保留已选择，便于重试
    if (e instanceof StudioError) {
      if (e.status === 0) error.value = MSG_UNAVAILABLE;
      else if (e.status === 409) error.value = '相同的创作正在进行中，请稍候';
      else error.value = `生成失败：${e.message}`;
    } else {
      error.value = '生成失败，请重试';
    }
  } finally {
    generating.value = false;
  }
}
</script>

<template>
  <section class="card composer" aria-label="创作面板">
    <h3>把梦，写成新的故事</h3>
    <p class="count" aria-live="polite">已选 {{ selection.selected.length }} / 5 场梦</p>
    <ul v-if="selection.selected.length" class="picked">
      <li v-for="id in selection.selected" :key="String(id)">{{ titles[String(id)] || '未命名的梦' }}</li>
    </ul>

    <fieldset class="styles" :disabled="generating">
      <legend>故事风格</legend>
      <label v-for="s in STYLES" :key="s.value">
        <input v-model="style" type="radio" name="story-style" :value="s.value" />
        {{ s.label }}
      </label>
    </fieldset>

    <div class="row">
      <button
        type="button"
        class="primary"
        :disabled="generating || studioUnavailable || !canSubmit(selection, style)"
        @click="submit"
      >
        {{ generating ? '生成中…' : '开始创作并收藏' }}
      </button>
      <button type="button" :disabled="generating || selection.selected.length === 0" @click="emit('clear')">
        清空选择
      </button>
      <span v-if="studioUnavailable" class="hint">服务暂不可用</span>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.composer {
  margin-bottom: 18px;
}
.composer h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
.count {
  margin: 0 0 6px;
  color: var(--text-dim);
  font-size: 13px;
}
.picked {
  margin: 0 0 10px;
  padding-left: 18px;
  font-size: 13px;
  color: var(--text-dim);
}
.styles {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  border: 0;
  padding: 0;
  margin: 0 0 12px;
  font-size: 14px;
}
.styles legend {
  padding: 0;
  margin-bottom: 6px;
  color: var(--text-dim);
  font-size: 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
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
.hint {
  color: var(--text-dim);
  font-size: 12px;
}
.error {
  color: #e57373;
  font-size: 13px;
  margin: 8px 0 0;
}
</style>
