<script setup lang="ts">
import type { Product } from '~/data/products'
import { availabilityHref } from '~/data/site'

const props = defineProps<{ products: Product[] }>()
const open = defineModel<boolean>('open', { required: true })
const index = defineModel<number>('index', { required: true })

const direction = ref<-1 | 0 | 1>(0)
const product = computed(() => props.products[index.value]!)
const total = computed(() => props.products.length)
const pad = (n: number) => String(n).padStart(2, '0')
const counter = computed(() => `${pad(index.value + 1)} / ${pad(total.value)}`)

function step(delta: -1 | 1) {
  direction.value = delta
  index.value = (index.value + delta + total.value) % total.value
}

watch(open, (value) => {
  if (value) direction.value = 0
})

defineShortcuts({
  arrowleft: { handler: () => open.value && step(-1), usingInput: false },
  arrowright: { handler: () => open.value && step(1), usingInput: false }
})

const arrow = {
  base: 'rounded-full ring-navy/35 text-navy hover:bg-navy hover:text-paper hover:ring-navy transition-colors duration-200',
  leadingIcon: 'size-3.5'
}
</script>

<template>
  <UModal
    v-model:open="open"
    fullscreen
    :close="false"
    :title="product.name"
    :description="`${product.label}. Piece ${counter}. Use the arrow keys to browse the collection.`"
    :content="{ onOpenAutoFocus: (event: Event) => event.preventDefault() }"
    :ui="{
      overlay: 'bg-paper/85 backdrop-blur-md',
      content: 'bg-transparent shadow-none ring-0 divide-y-0'
    }"
  >
    <template #content="{ close }">
      <div class="flex h-dvh flex-col">
        <div class="flex justify-end px-5 py-4 sm:px-8 sm:py-5">
          <UButton
            variant="link"
            color="neutral"
            label="Close"
            :ui="{ base: 'px-0 text-[11px] font-medium tracking-[0.14em] text-navy uppercase hover:text-navy/60' }"
            @click="close"
          />
        </div>

        <div class="relative min-h-0 flex-1">
          <ProductViewer
            :products="products"
            :index="index"
            :direction="direction"
            class="absolute inset-0"
          />

          <div class="pointer-events-none absolute inset-0 flex items-center justify-between px-4 sm:justify-center sm:gap-[min(48vw,560px)]">
            <UButton
              icon="i-lucide-arrow-left"
              variant="outline"
              color="neutral"
              size="sm"
              square
              class="pointer-events-auto"
              :ui="arrow"
              aria-label="Previous piece"
              @click="step(-1)"
            />
            <UButton
              icon="i-lucide-arrow-right"
              variant="outline"
              color="neutral"
              size="sm"
              square
              class="pointer-events-auto"
              :ui="arrow"
              aria-label="Next piece"
              @click="step(1)"
            />
          </div>
        </div>

        <div class="flex flex-col items-center gap-1 px-6 pt-2 pb-8 text-center sm:pb-10">
          <p class="text-[10px] tracking-[0.12em] text-navy/60 tabular-nums">
            {{ counter }}
          </p>
          <Transition
            name="swap"
            mode="out-in"
          >
            <div
              :key="product.id"
              class="flex flex-col items-center gap-0.5"
            >
              <h2 class="text-xl text-navy italic sm:text-2xl">
                {{ product.name }}
              </h2>
              <p class="text-[11px] tracking-[0.08em] text-navy/55 uppercase">
                {{ product.label }}
              </p>
            </div>
          </Transition>
          <UButton
            :to="availabilityHref(product.url)"
            target="_blank"
            variant="outline"
            color="neutral"
            size="sm"
            label="See availability"
            class="mt-3"
            :ui="pillButtonUi"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.swap-enter-active,
.swap-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.swap-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.swap-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
