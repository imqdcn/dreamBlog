<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsOption } from 'echarts';
import { emotionMeta, type DreamEmotion } from '../types/dream';
import {
  countEmotions,
  countKeywords,
  countByDay,
  emotionTrend,
} from '../utils/aggregate';

const { data: dreams, pending } = useDreams();

const hasData = computed(() => (dreams.value?.length ?? 0) > 0);

// 情绪趋势折线图
const trendOption = computed<EChartsOption>(() => {
  const trend = emotionTrend(dreams.value ?? []);
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 30, bottom: 40 },
    xAxis: { type: 'category', data: trend.map((t) => t[0]) },
    yAxis: { type: 'value', min: -1, max: 1, name: '情绪分' },
    series: [
      {
        name: '平均情绪分',
        type: 'line',
        smooth: true,
        data: trend.map((t) => t[1]),
        areaStyle: { opacity: 0.15 },
        lineStyle: { color: '#9b5de5' },
        itemStyle: { color: '#9b5de5' },
      },
    ],
  };
});

// 情绪分布柱状图
const emotionBarOption = computed<EChartsOption>(() => {
  const counts = countEmotions(dreams.value ?? []);
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: counts.map((c) => emotionMeta(c.emotion).label) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        type: 'bar',
        data: counts.map((c) => ({
          value: c.count,
          itemStyle: { color: emotionMeta(c.emotion as DreamEmotion).color },
        })),
        barWidth: '55%',
      },
    ],
  };
});

// 关键词云
const wordcloudOption = computed<EChartsOption>(() => {
  const words = countKeywords(dreams.value ?? []);
  return {
    tooltip: { show: true },
    series: [
      {
        type: 'wordCloud',
        shape: 'circle',
        sizeRange: [14, 54],
        rotationRange: [-45, 45],
        gridSize: 8,
        drawOutOfBound: false,
        textStyle: {
          color: () =>
            ['#9b5de5', '#5b8def', '#6cc3a9', '#f6c445', '#e5679b', '#e08e45'][
              Math.floor(Math.random() * 6)
            ],
        },
        data: words,
      },
    ] as any,
  };
});

// 日历热力图
const calendarOption = computed<EChartsOption>(() => {
  const byDay = countByDay(dreams.value ?? []);
  const maxVal = byDay.reduce((m, [, v]) => Math.max(m, v), 1);
  const year =
    byDay.length > 0 ? byDay[byDay.length - 1][0].slice(0, 4) : String(new Date().getFullYear());
  return {
    tooltip: {
      formatter: (p: any) => `${p.value[0]}：${p.value[1]} 个梦`,
    },
    visualMap: {
      min: 0,
      max: maxVal,
      inRange: { color: ['#2d2f55', '#5b8def', '#9b5de5'] },
      show: false,
    },
    calendar: {
      range: year,
      cellSize: ['auto', 16],
      itemStyle: { color: '#1a1b33', borderColor: '#2d2f55' },
      dayLabel: { color: '#a0a3c0' },
      monthLabel: { color: '#a0a3c0' },
      yearLabel: { show: false },
      splitLine: { show: false },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: byDay,
      },
    ],
  };
});
</script>

<template>
  <div>
    <p v-if="pending" class="empty">正在统计…</p>
    <p v-else-if="!hasData" class="empty">还没有足够的数据生成统计，先去记录一些梦境吧 🌙</p>

    <template v-else>
      <section class="chart-box">
        <h3>情绪趋势</h3>
        <BaseChart :option="trendOption" />
      </section>

      <section class="chart-box">
        <h3>情绪分布</h3>
        <BaseChart :option="emotionBarOption" />
      </section>

      <section class="chart-box">
        <h3>关键词云</h3>
        <BaseChart :option="wordcloudOption" />
      </section>

      <section class="chart-box">
        <h3>梦境日历</h3>
        <BaseChart :option="calendarOption" />
      </section>
    </template>
  </div>
</template>
