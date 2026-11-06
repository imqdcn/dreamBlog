<script setup lang="ts">
import { computed } from 'vue';
import { emotionMeta, type DreamEmotion } from '../types/dream';

const props = defineProps<{ emotion?: DreamEmotion }>();
const meta = computed(() => emotionMeta(props.emotion));
</script>

<template>
  <span class="emotion-pill" :style="{ background: meta.color }">
    <span>{{ meta.emoji }}</span>
    <span>{{ meta.label }}</span>
  </span>
</template>
