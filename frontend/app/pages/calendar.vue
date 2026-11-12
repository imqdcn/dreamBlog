<script setup lang="ts">
import { computed, ref } from 'vue';
import { buildMonthGrid } from '../utils/calendar';
const { data: dreams, pending, error, refresh } = useDreams();

const now = new Date();
const year = ref(now.getFullYear());
const month = ref(now.getMonth() + 1); // 1-12
const selectedDate = ref<string | null>(null);

// 加载失败时不构建网格，因此不会渲染任何数量标注
const cells = computed(() =>
  error.value ? [] : buildMonthGrid(dreams.value ?? [], year.value, month.value),
);
/** 月首日是星期几（0=周日），用于前置空白格 */
const leadingBlanks = computed(() => new Date(year.value, month.value - 1, 1).getDay());
const selectedCell = computed(() => cells.value.find((c) => c.date === selectedDate.value) ?? null);

function shiftMonth(delta: number) {
  let m = month.value + delta;
  let y = year.value;
  if (m < 1) {
    m = 12;
    y -= 1;
  } else if (m > 12) {
    m = 1;
    y += 1;
  }
  year.value = y;
  month.value = m;
  selectedDate.value = null;
}

function selectCell(c: { date: string; count: number }) {
  if (c.count > 0) selectedDate.value = c.date;
}
</script>

<template>
  <div>
    <h2>梦境日历</h2>

    <p v-if="pending" class="empty">正在加载梦境日历…</p>
    <p v-else-if="error" class="empty" role="alert">
      加载失败，请确认后端已启动且可访问。<br />
      <small>{{ error.message }}</small><br />
      <button type="button" @click="refresh()">重试</button>
    </p>
    <template v-else>
      <div class="cal-nav">
        <button type="button" aria-label="上一月" @click="shiftMonth(-1)">‹ 上一月</button>
        <strong>{{ year }} 年 {{ month }} 月</strong>
        <button type="button" aria-label="下一月" @click="shiftMonth(1)">下一月 ›</button>
      </div>

      <div class="cal-grid" role="grid">
        <div v-for="w in ['日', '一', '二', '三', '四', '五', '六']" :key="w" class="cal-head">{{ w }}</div>
        <div v-for="n in leadingBlanks" :key="`b${n}`" class="cal-cell cal-cell--blank" />
        <button
          v-for="c in cells"
          :key="c.date"
          type="button"
          class="cal-cell"
          :class="{ 'cal-cell--has': c.count > 0, 'cal-cell--active': c.date === selectedDate }"
          :disabled="c.count === 0"
          @click="selectCell(c)"
        >
          <span>{{ Number(c.date.slice(8)) }}</span>
          <span v-if="c.count > 0" class="cal-count">{{ c.count }}</span>
        </button>
      </div>

      <div v-if="selectedCell" class="cal-list">
        <h3>{{ selectedCell.date }}</h3>
        <NuxtLink
          v-for="d in selectedCell.dreams"
          :key="d.id"
          :to="`/dream/${d.documentId ?? d.id}`"
          class="card dream-card"
          style="display: block; color: inherit; text-decoration: none"
        >
          <div class="dream-card__meta">
            <span>{{ selectedCell.date }}</span>
          </div>
          <div class="dream-card__title">{{ d.title || '未命名的梦' }}</div>
        </NuxtLink>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cal-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}
.cal-head {
  text-align: center;
  opacity: 0.7;
  font-size: 13px;
}
.cal-cell {
  position: relative;
  min-height: 56px;
  padding: 6px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  text-align: left;
}
.cal-cell--has {
  background: rgba(155, 93, 229, 0.15);
  cursor: pointer;
}
.cal-cell--active {
  border-color: #9b5de5;
}
.cal-count {
  position: absolute;
  right: 6px;
  bottom: 4px;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #9b5de5;
  color: #fff;
  font-size: 12px;
  text-align: center;
}
.cal-list {
  margin-top: 16px;
}
</style>
