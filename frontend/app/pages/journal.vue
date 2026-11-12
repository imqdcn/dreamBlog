<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  initialSelection,
  select,
  deselect,
  clear,
  isCheckboxDisabled,
  type SelectionState,
} from '../utils/story-selection';
import { excerpt } from '../utils/excerpt';

interface NewStory {
  documentId?: string;
  title: string;
  content: string;
  tags?: string[];
}

const route = useRoute();
const router = useRouter();
const { data: dreams, pending, error, refresh } = useDreams();
const session = useOwnerSession();
const studio = useStudio();

const isOwner = computed(() => session.isOwner.value);
const studioUnavailable = computed(() => studio.unavailable.value);

const selection = ref<SelectionState>(initialSelection);
const createdStories = ref<NewStory[]>([]);
const showRecord = ref(false);

const keyOf = (d: { documentId?: string; id: number }) => d.documentId ?? String(d.id);

const titles = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {};
  for (const d of dreams.value ?? []) m[keyOf(d)] = d.title || '未命名的梦';
  return m;
});

function toggle(id: string, checked: boolean) {
  selection.value = checked ? select(selection.value, id) : deselect(selection.value, id);
}

function onCreated(story: NewStory) {
  // 成功：清空选择，并把新 Story 置顶展示
  selection.value = clear(selection.value);
  createdStories.value = [story, ...createdStories.value];
}

function openRecord() {
  showRecord.value = true;
}

function closeRecord() {
  showRecord.value = false;
  if (route.query.record) {
    const { record: _record, ...rest } = route.query;
    void router.replace({ query: rest });
  }
}

// /journal?record=1 打开弹窗（仅 Owner）
watch(
  () => [route.query.record, isOwner.value] as const,
  ([rec, owner]) => {
    if (rec === '1' && owner) showRecord.value = true;
  },
  { immediate: true }
);

// 探测 Studio 可用性：不可用时写入入口显示“服务暂不可用”，不影响页面加载
onMounted(() => {
  if (isOwner.value) {
    studio.request('/health', { anonymous: true }).catch(() => {
      /* unavailable 状态已由客户端设置 */
    });
  }
});
</script>

<template>
  <div>
    <div class="head">
      <h2>梦境手记</h2>
      <template v-if="isOwner">
        <button type="button" class="primary" :disabled="studioUnavailable" @click="openRecord">记录一场梦</button>
        <span v-if="studioUnavailable" class="hint">服务暂不可用</span>
      </template>
    </div>

    <StoryComposer
      v-if="isOwner"
      :selection="selection"
      :studio-unavailable="studioUnavailable"
      :titles="titles"
      @clear="selection = clear(selection)"
      @created="onCreated"
    />

    <section v-if="createdStories.length" class="new-stories" aria-label="新生成的故事">
      <div v-for="(s, i) in createdStories" :key="s.documentId ?? i" class="card story-new">
        <div class="dream-card__title">{{ s.title }}</div>
        <div class="dream-card__summary">{{ excerpt(s.content, 120) }}</div>
        <div v-if="s.tags && s.tags.length">
          <span v-for="t in s.tags" :key="t" class="tag">{{ t }}</span>
        </div>
      </div>
      <NuxtLink to="/stories" class="more">在「梦的另一种可能」查看全部 →</NuxtLink>
    </section>

    <p v-if="pending" class="empty">正在加载梦境…</p>

    <p v-else-if="error" class="empty">
      加载失败，请确认后端已启动且可访问。<br />
      <small>{{ error.message }}</small>
    </p>

    <p v-else-if="!dreams || dreams.length === 0" class="empty">还没有任何梦境记录。</p>

    <template v-else>
      <JournalDreamCard
        v-for="d in dreams"
        :key="keyOf(d)"
        :dream="d"
        :is-owner="isOwner"
        :checked="selection.selected.includes(keyOf(d))"
        :checkbox-disabled="isCheckboxDisabled(selection, keyOf(d))"
        :studio-unavailable="studioUnavailable"
        @toggle-inspiration="(c: boolean) => toggle(keyOf(d), c)"
      />
    </template>

    <RecordDreamDialog
      v-if="showRecord && isOwner"
      :studio-unavailable="studioUnavailable"
      @close="closeRecord"
      @saved="refresh()"
    />
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.head h2 {
  margin-right: auto;
}
.primary {
  padding: 7px 14px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  cursor: pointer;
  font-family: inherit;
}
.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hint {
  color: var(--text-dim);
  font-size: 12px;
}
.new-stories {
  margin-bottom: 18px;
}
.story-new {
  margin-bottom: 10px;
}
.more {
  color: var(--accent-2);
  font-size: 13px;
}
</style>
