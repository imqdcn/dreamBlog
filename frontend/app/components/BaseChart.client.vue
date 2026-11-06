<script setup lang="ts">
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, HeatmapChart, BarChart } from 'echarts/charts';
import {
  TooltipComponent,
  GridComponent,
  VisualMapComponent,
  CalendarComponent,
  TitleComponent,
} from 'echarts/components';
import 'echarts-wordcloud';
import VChart from 'vue-echarts';
import type { EChartsOption } from 'echarts';

use([
  CanvasRenderer,
  LineChart,
  HeatmapChart,
  BarChart,
  TooltipComponent,
  GridComponent,
  VisualMapComponent,
  CalendarComponent,
  TitleComponent,
]);

defineProps<{ option: EChartsOption }>();
</script>

<template>
  <VChart class="chart" :option="option" autoresize theme="dark" />
</template>
