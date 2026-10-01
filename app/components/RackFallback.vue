<script setup lang="ts">
import type { Product } from '~/data/products'

/** Flat rail of garment fronts for browsers without WebGL. */
const props = defineProps<{ products: Product[] }>()
const emit = defineEmits<{ select: [index: number] }>()

const previews = props.products.map(p => useGarmentPreview(p))
</script>

<template>
  <div class="flex size-full items-center overflow-x-auto px-6">
    <ul class="relative mx-auto flex items-start gap-4 pt-6">
      <li class="absolute inset-x-[-24px] top-0 h-1.5 rounded-full bg-linear-to-b from-[#f4f4f4] via-[#b9b9b9] to-[#e2e2e2]" aria-hidden="true" />
      <li v-for="(product, i) in products" :key="product.id" class="shrink-0">
        <button
          type="button"
          class="group flex w-28 cursor-pointer flex-col items-center gap-2 sm:w-32"
          @click="emit('select', i)"
        >
          <span class="h-4 w-px bg-[#9a9a9a]" aria-hidden="true" />
          <img
            v-if="previews[i]?.value"
            :src="previews[i]?.value"
            :alt="product.name"
            class="w-full transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:scale-105"
          >
          <span class="text-center text-[11px] text-navy/70">{{ product.name }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
