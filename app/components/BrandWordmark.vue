<script setup lang="ts">
import { site } from '~/data/site'
</script>

<template>
  <NuxtLink
    to="/"
    class="
      inline-flex -rotate-6 flex-col items-start font-script text-[1.45rem]/[0.78] font-bold text-navy italic
      transition-opacity duration-200 select-none
      hover:opacity-80
      focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-navy
      sm:text-[1.7rem]/[0.78]
    "
    :aria-label="`${site.brand.name} — home`"
  >
    <span>{{ site.brand.lines[0] }}</span>
    <span class="pl-[0.85em]">{{ site.brand.lines[1] }}</span>
  </NuxtLink>
</template>
