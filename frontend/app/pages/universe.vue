<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

interface UniverseNode {
  documentId: string;
  title: string;
  dreamedAt: string | null;
  tags: string[];
  emotion?: string;
}
interface UniverseEdge {
  source: string;
  target: string;
  score: number;
}

const studio = useStudio();

const SIZE = 600;
const CENTER = SIZE / 2;
const RADIUS = 240;

const nodes = ref<UniverseNode[]>([]);
const edges = ref<UniverseEdge[]>([]);
const loading = ref(true);
const loadError = ref('');
const selectedId = ref<string | null>(null);

async function load() {
  loading.value = true;
  loadError.value = '';
  // 失败时不保留任何节点与边
  nodes.value = [];
  edges.value = [];
  selectedId.value = null;
  try {
    const res = await studio.request<{ nodes?: UniverseNode[]; edges?: UniverseEdge[] }>('/v1/universe', {
      anonymous: true,
    });
    nodes.value = Array.isArray(res?.nodes) ? res.nodes : [];
    edges.value = Array.isArray(res?.edges) ? res.edges : [];
  } catch (e: any) {
    nodes.value = [];
    edges.value = [];
    loadError.value = e?.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** 节点数据不足 2 条：展示空状态，且不渲染边 */
const insufficient = computed(() => nodes.value.length < 2);

const positions = computed(() => {
  const map = new Map<string, { x: number; y: number }>();
  const n = nodes.value.length;
  nodes.value.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    map.set(node.documentId, {
      x: CENTER + RADIUS * Math.cos(angle),
      y: CENTER + RADIUS * Math.sin(angle),
    });
  });
  return map;
});

const drawableEdges = computed(() => {
  if (insufficient.value) return [];
  return edges.value
    .map((e) => ({ e, a: positions.value.get(e.source), b: positions.value.get(e.target) }))
    .filter((x) => x.a && x.b)
    .map((x) => ({
      key: `${x.e.source}|${x.e.target}`,
      x1: x.a!.x,
      y1: x.a!.y,
      x2: x.b!.x,
      y2: x.b!.y,
      score: x.e.score,
    }));
});

const selected = computed(() => nodes.value.find((n) => n.documentId === selectedId.value) ?? null);

function formatDate(raw: string | null): string {
  if (!raw) return '日期未知';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (m) return m[1]!;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '日期未知';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function select(id: string) {
  selectedId.value = id;
}

function shortTitle(t: string): string {
  const s = t || '未命名的梦';
  return s.length > 8 ? `${s.slice(0, 8)}…` : s;
}
</script>

<template>
  <div>
    <h2>梦境宇宙</h2>

    <p v-if="loading" class="empty">正在加载梦境宇宙…</p>

    <div v-else-if="loadError" class="empty" role="alert">
      <p>梦境宇宙加载失败：{{ loadError }}</p>
      <button type="button" @click="load">重试</button>
    </div>

    <p v-else-if="insufficient" class="empty">梦境还不够多，至少记录 2 场梦后，才能看到它们之间的联系 ✨</p>

    <template v-else>
      <svg
        :viewBox="`0 0 ${SIZE} ${SIZE}`"
        role="img"
        aria-label="梦境关系图"
        style="width: 100%; max-width: 640px; height: auto"
      >
        <line
          v-for="l in drawableEdges"
          :key="l.key"
          class="universe-edge"
          :x1="l.x1"
          :y1="l.y1"
          :x2="l.x2"
          :y2="l.y2"
          stroke="#9b8cd6"
          :stroke-opacity="0.35 + 0.65 * Math.min(1, l.score)"
          :stroke-width="1 + 3 * Math.min(1, l.score)"
        />
        <g
          v-for="n in nodes"
          :key="n.documentId"
          class="universe-node"
          role="button"
          tabindex="0"
          :aria-label="n.title || '未命名的梦'"
          style="cursor: pointer"
          @click="select(n.documentId)"
          @keydown.enter.prevent="select(n.documentId)"
          @keydown.space.prevent="select(n.documentId)"
        >
          <circle
            :cx="positions.get(n.documentId)!.x"
            :cy="positions.get(n.documentId)!.y"
            :r="n.documentId === selectedId ? 14 : 10"
            :fill="n.documentId === selectedId ? '#6a4fd8' : '#b7a8f0'"
            stroke="#fff"
            stroke-width="2"
          />
          <text
            :x="positions.get(n.documentId)!.x"
            :y="positions.get(n.documentId)!.y + 26"
            text-anchor="middle"
            font-size="12"
            fill="currentColor"
          >
            {{ shortTitle(n.title) }}
          </text>
        </g>
      </svg>

      <p v-if="drawableEdges.length === 0" class="empty">这些梦之间暂时还没有明显的联系。</p>

      <div v-if="selected" class="card" style="margin-top: 12px">
        <div class="dream-card__title">{{ selected.title || '未命名的梦' }}</div>
        <div class="dream-card__meta">
          <span>{{ formatDate(selected.dreamedAt) }}</span>
        </div>
        <div v-if="selected.tags.length" style="margin: 6px 0">
          <span v-for="t in selected.tags" :key="t" class="tag" style="margin-right: 6px">#{{ t }}</span>
        </div>
        <NuxtLink :to="`/dream/${selected.documentId}`">读一读原梦</NuxtLink>
      </div>
      <p v-else class="empty">点击一个节点，查看这场梦。</p>
    </template>
  </div>
</template>
