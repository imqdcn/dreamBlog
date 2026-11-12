<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Dream } from '../types/dream';
import { dreamDateKey } from '../utils/aggregate';
import { fetchDream } from '../composables/useDreams';
import { StudioError, MSG_UNAVAILABLE } from '../composables/useStudio';

const props = defineProps<{
  dream: Dream;
  isOwner: boolean;
  /** 已选中为故事灵感 */
  checked: boolean;
  /** 勾选框禁用（已满 5 条且本条未选中） */
  checkboxDisabled: boolean;
  /** Studio 当前不可用 */
  studioUnavailable: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-inspiration', checked: boolean): void;
  (e: 'favorite-changed', value: boolean): void;
  (e: 'tags-changed', tags: string[]): void;
}>();

const studio = useStudio();
const config = useRuntimeConfig();

const docKey = computed(() => props.dream.documentId ?? String(props.dream.id));
const dateText = computed(() => dreamDateKey(props.dream) ?? '');

/* ---------- 读一读原梦 ---------- */
const rawOpen = ref(false);
const rawText = ref<string | null>(null);
const rawLoading = ref(false);
const rawError = ref('');

async function readOriginal() {
  if (rawLoading.value) return;
  if (rawOpen.value) {
    rawOpen.value = false;
    return;
  }
  rawError.value = '';
  if (rawText.value !== null) {
    rawOpen.value = true;
    return;
  }
  rawLoading.value = true;
  try {
    let text: string;
    if (props.dream.documentId) {
      const full = await fetchDream(config.public.strapiUrl as string, props.dream.documentId);
      if (!full) throw new Error('not found');
      text = full.rawContent;
    } else {
      text = props.dream.rawContent;
    }
    rawText.value = text;
    rawOpen.value = true;
  } catch {
    // 失败：仅提示，卡片展示内容保持不变
    rawError.value = '读取原梦失败，请稍后重试';
  } finally {
    rawLoading.value = false;
  }
}

/* ---------- Tag 编辑 ---------- */
const tags = ref<string[]>([...(props.dream.tags ?? [])]);
watch(
  () => props.dream.tags,
  (v) => {
    tags.value = [...(v ?? [])];
  }
);
const tagEditing = ref(false);
const tagInput = ref('');
const tagBusy = ref(false);
const tagError = ref('');

function describeError(e: unknown, fallback: string): string {
  if (e instanceof StudioError) return e.status === 0 ? MSG_UNAVAILABLE : e.message;
  return fallback;
}

async function patchTags(body: { add: string } | { remove: string }) {
  tagBusy.value = true;
  tagError.value = '';
  try {
    const res = await studio.request<{ tags: string[] }>(`/v1/dreams/${encodeURIComponent(docKey.value)}/tags`, {
      method: 'PATCH',
      body,
    });
    tags.value = Array.isArray(res?.tags) ? res.tags : tags.value;
    emit('tags-changed', [...tags.value]);
    return true;
  } catch (e) {
    tagError.value = describeError(e, 'Tag 更新失败');
    return false;
  } finally {
    tagBusy.value = false;
  }
}

async function addTag() {
  if (tagBusy.value) return;
  const value = tagInput.value.trim();
  if (value.length < 1) {
    tagError.value = 'Tag 不能为空';
    return;
  }
  if (value.length > 20) {
    tagError.value = 'Tag 不能超过 20 个字符';
    return;
  }
  if (!tags.value.includes(value) && tags.value.length >= 10) {
    tagError.value = '最多 10 个 Tag';
    return;
  }
  if (await patchTags({ add: value })) tagInput.value = '';
}

async function removeTag(t: string) {
  if (tagBusy.value) return;
  await patchTags({ remove: t });
}

/* ---------- 珍藏 ---------- */
const favorite = ref(props.dream.isFavorite === true);
watch(
  () => props.dream.isFavorite,
  (v) => {
    favorite.value = v === true;
  }
);
const favBusy = ref(false);
const favError = ref('');

async function toggleFavorite() {
  if (favBusy.value) return;
  favBusy.value = true;
  favError.value = '';
  const target = !favorite.value;
  try {
    const res = await studio.request<{ isFavorite: boolean }>(
      `/v1/dreams/${encodeURIComponent(docKey.value)}/favorite`,
      { method: 'PUT', body: { isFavorite: target } }
    );
    favorite.value = typeof res?.isFavorite === 'boolean' ? res.isFavorite : target;
    emit('favorite-changed', favorite.value);
  } catch (e) {
    favError.value = describeError(e, '珍藏操作失败');
  } finally {
    favBusy.value = false;
  }
}
</script>

<template>
  <article class="card dream-card journal-card">
    <div class="dream-card__meta">
      <EmotionPill :emotion="dream.emotion" />
      <span>{{ dateText }}</span>
      <label v-if="isOwner" class="inspire">
        <input
          type="checkbox"
          :checked="checked"
          :disabled="checkboxDisabled"
          @change="emit('toggle-inspiration', ($event.target as HTMLInputElement).checked)"
        />
        作为故事灵感
      </label>
    </div>

    <div class="dream-card__title">{{ dream.title || '未命名的梦' }}</div>

    <div class="tags">
      <span v-for="t in tags" :key="t" class="tag">
        {{ t }}
        <button
          v-if="isOwner && tagEditing"
          type="button"
          class="tag-x"
          :aria-label="`移除 Tag ${t}`"
          :disabled="tagBusy || studioUnavailable"
          @click="removeTag(t)"
        >
          ×
        </button>
      </span>
    </div>

    <div class="actions">
      <button type="button" class="link-btn" :disabled="rawLoading" @click="readOriginal">
        {{ rawLoading ? '读取中…' : rawOpen ? '收起原梦' : '读一读原梦' }}
      </button>
      <NuxtLink :to="`/dream/${docKey}`" class="link-btn">详情</NuxtLink>
      <template v-if="isOwner">
        <button type="button" class="link-btn" @click="tagEditing = !tagEditing">
          {{ tagEditing ? '完成' : '编辑标签' }}
        </button>
        <button
          type="button"
          class="link-btn"
          :disabled="favBusy || studioUnavailable"
          :aria-pressed="favorite"
          @click="toggleFavorite"
        >
          {{ favorite ? '★ 已珍藏' : '☆ 珍藏' }}
        </button>
        <span v-if="studioUnavailable" class="hint">服务暂不可用</span>
      </template>
    </div>

    <!-- 纯文本渲染：mustache 插值会转义 HTML，不使用 v-html -->
    <div v-if="rawOpen && rawText !== null" class="raw-block">{{ rawText }}</div>
    <p v-if="rawError" class="error" role="alert">{{ rawError }}</p>

    <form v-if="isOwner && tagEditing" class="tag-form" @submit.prevent="addTag">
      <input
        v-model="tagInput"
        type="text"
        maxlength="40"
        placeholder="新增 Tag（1–20 个字符）"
        aria-label="新增 Tag"
        :disabled="tagBusy || studioUnavailable"
      />
      <button type="submit" :disabled="tagBusy || studioUnavailable">添加</button>
    </form>
    <p v-if="tagError" class="error" role="alert">{{ tagError }}</p>
    <p v-if="favError" class="error" role="alert">{{ favError }}</p>
  </article>
</template>

<style scoped>
.journal-card {
  cursor: default;
}
.journal-card:hover {
  transform: none;
}
.inspire {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.tags {
  min-height: 4px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.link-btn {
  background: none;
  border: 0;
  padding: 0;
  color: var(--accent-2);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.link-btn:disabled {
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
.raw-block {
  margin-top: 10px;
}
.tag-x {
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  padding: 0 0 0 4px;
}
.tag-form {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.tag-form input {
  flex: 1;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
}
</style>
