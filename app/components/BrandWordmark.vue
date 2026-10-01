<script setup lang="ts">
import { site } from '~/data/site'
</script>

<template>
  <NuxtLink to="/" class="brand-wordmark" :aria-label="`${site.brand.name} — home`">
    <span class="brand-wordmark__line">{{ site.brand.lines[0] }}</span>
    <span class="brand-wordmark__line brand-wordmark__line--offset">{{ site.brand.lines[1] }}</span>
  </NuxtLink>
</template>

<style scoped>
.brand-wordmark {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  color: var(--color-navy);
  font-family: 'Lobster Two', cursive;
  font-style: italic;
  font-weight: 700;
  font-size: 1.45rem;
  line-height: 0.78;
  transform: rotate(-6deg);
  transition: opacity 200ms ease;
  user-select: none;
}

.brand-wordmark:hover {
  opacity: 0.8;
}

.brand-wordmark:focus-visible {
  outline: 2px solid var(--color-navy);
  outline-offset: 6px;
  border-radius: 4px;
}

.brand-wordmark__line--offset {
  padding-left: 0.85em;
}

@media (min-width: 640px) {
  .brand-wordmark {
    font-size: 1.7rem;
  }
}
</style>
