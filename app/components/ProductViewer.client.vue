<script setup lang="ts">
import type { Product } from '~/data/products'
import type { ViewerController } from '~/lib/three/viewer'

const props = defineProps<{
  products: Product[]
  index: number
  direction: -1 | 0 | 1
}>()

const container = useTemplateRef<HTMLElement>('container')
const resolveUrl = useAssetUrl()
const webgl = hasWebGL()
const preview = useGarmentPreview(() => webgl ? undefined : props.products[props.index])

let viewer: ViewerController | null = null
let disposed = false

onMounted(async () => {
  if (!webgl || !container.value) return
  const { ViewerController } = await import('~/lib/three/viewer')
  if (disposed || !container.value) return
  viewer = new ViewerController(container.value, props.products, resolveUrl, props.index)
})

watch(() => props.index, index => viewer?.show(index, props.direction))

onBeforeUnmount(() => {
  disposed = true
  viewer?.dispose()
  viewer = null
})
</script>

<template>
  <div class="relative size-full">
    <div v-if="webgl" ref="container" class="absolute inset-0" />
    <div v-else class="absolute inset-0 flex items-center justify-center p-6">
      <img
        v-if="preview"
        :src="preview"
        :alt="products[index]?.name"
        class="max-h-full max-w-full object-contain drop-shadow-[0_18px_24px_rgb(30_36_60/0.18)]"
      >
    </div>
  </div>
</template>
