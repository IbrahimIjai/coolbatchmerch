<script setup lang="ts">
import { site } from '~/data/site'

defineEmits<{ subscribe: [] }>()
</script>

<template>
  <button
    type="button"
    class="block w-full cursor-pointer bg-navy text-paper focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-paper"
    aria-label="Subscribe to our newsletter"
    @click="$emit('subscribe')"
  >
    <UMarquee
      :overlay="false"
      :repeat="4"
      pause-on-hover
      :ui="{ root: '[--duration:42s] [--gap:--spacing(7)] py-2', content: 'gap-(--gap)' }"
      aria-hidden="true"
    >
      <template
        v-for="item in site.ticker"
        :key="item"
      >
        <span class="text-[11px] font-medium tracking-[0.12em] whitespace-nowrap uppercase italic">{{ item }}</span>
        <span class="text-[9px] opacity-80">•</span>
      </template>
    </UMarquee>
  </button>
</template>
