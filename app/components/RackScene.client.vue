<script setup lang="ts">
import type { Product } from '~/data/products'
import { RackController } from '~/lib/three/rack'

const props = defineProps<{
  products: Product[]
  paused?: boolean
}>()

const emit = defineEmits<{
  select: [index: number]
  hover: [index: number | null]
  reorder: [order: number[]]
}>()

const container = useTemplateRef<HTMLElement>('container')
const label = useTemplateRef<HTMLElement>('label')
const hovered = ref<number | null>(null)
const lastHovered = ref(0)
const resolveImage = useProductImage()

// Keep showing the last name while the label fades out.
const labelText = computed(() => {
  const p = props.products[hovered.value ?? lastHovered.value]
  return p ? `${p.name} — ${p.label}` : ''
})

let rack: RackController | null = null

function mount() {
  rack?.dispose()
  if (!container.value) return
  rack = new RackController(container.value, {
    products: props.products,
    resolveImage,
    label: label.value,
    onHover(index) {
      hovered.value = index
      if (index !== null) lastHovered.value = index
      emit('hover', index)
    },
    onSelect: index => emit('select', index),
    onReorder: order => emit('reorder', order)
  })
  rack.setPaused(!!props.paused)
}

function focus(index: number | null) {
  rack?.setFocus(index)
}

onMounted(mount)
watch(() => props.products, mount)
watch(() => props.paused, paused => rack?.setPaused(!!paused))
onBeforeUnmount(() => {
  rack?.dispose()
  rack = null
})
</script>

<template>
  <div class="relative size-full">
    <div ref="container" class="absolute inset-0" />

    <p
      ref="label"
      class="rack-label"
      :class="{ 'is-visible': hovered !== null }"
      aria-hidden="true"
    >
      {{ labelText }}
    </p>

    <!-- Keyboard and screen-reader access to the rack. Focus mirrors hover in 3D. -->
    <ul class="sr-only">
      <li v-for="(product, i) in products" :key="product.id">
        <button
          type="button"
          @focus="focus(i)"
          @blur="focus(null)"
          @click="emit('select', i)"
        >
          View {{ product.name }}, {{ product.label }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.rack-label {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(calc(var(--label-x, 50%) - 50%), var(--label-y, 0));
  white-space: nowrap;
  pointer-events: none;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: color-mix(in oklab, var(--color-navy) 70%, transparent);
  opacity: 0;
  transition: opacity 220ms ease;
}

.rack-label.is-visible {
  opacity: 1;
}
</style>
