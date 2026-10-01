<script setup lang="ts">
import { products } from '~/data/products'
import { availabilityHref, site } from '~/data/site'

useSeoMeta({
  title: `${site.brand.name} — Nigeria @ 66`,
  description: site.description,
  ogTitle: `${site.brand.name} — Nigeria @ 66`,
  ogDescription: site.description,
  ogImage: '/merch/sixty-six.png'
})

// Rail order (product indices). Pieces can be dragged along the rail to re-order them;
// the overlay then browses in that same order.
const order = ref(products.map((_, i) => i))
const railProducts = computed(() => order.value.map(i => products[i]!))
const selected = ref(0)
const modalOpen = ref(false)
const aboutOpen = ref(false)
const contactOpen = ref(false)
const webgl = ref(true)

onMounted(() => {
  webgl.value = hasWebGL()
})

function openProduct(index: number) {
  selected.value = Math.max(0, order.value.indexOf(index))
  modalOpen.value = true
}
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden">
    <SiteHeader @about="aboutOpen = true" @contact="contactOpen = true" />

    <main class="relative flex min-h-0 flex-1 flex-col">
      <h1 class="sr-only">
        {{ site.brand.name }} — the Nigeria @ 66 independence capsule
      </h1>

      <div class="relative min-h-0 flex-1 transition-[filter,opacity] duration-300" :class="{ 'opacity-60': modalOpen }">
        <ClientOnly>
          <LazyRackScene
            v-if="webgl"
            :products="products"
            :paused="modalOpen"
            @select="openProduct"
            @reorder="order = $event"
          />
          <RackFallback v-else :products="products" @select="openProduct" />

          <template #fallback>
            <div class="flex size-full items-start justify-center pt-[12%]" aria-hidden="true">
              <div class="h-1.5 w-2/3 max-w-4xl rounded-full bg-linear-to-b from-[#f4f4f4] via-[#bdbdbd] to-[#e4e4e4]" />
            </div>
          </template>
        </ClientOnly>
      </div>

      <div class="flex flex-col items-center gap-3 px-6 pt-1 pb-5 sm:pb-7">
        <p class="text-[10px] tracking-[0.12em] text-navy/50 uppercase pointer-fine:hidden">
          Drag to browse · tap a piece
        </p>
        <UButton
          :to="availabilityHref(undefined, site.shopUrl || undefined)"
          variant="outline"
          color="neutral"
          size="sm"
          label="See availability"
          class="pill-button"
        />
      </div>
    </main>

    <SiteTicker @subscribe="contactOpen = true" />

    <ProductModal v-model:open="modalOpen" v-model:index="selected" :products="railProducts" />
    <InfoPanel v-model:open="aboutOpen" kind="about" />
    <InfoPanel v-model:open="contactOpen" kind="contact" />
  </div>
</template>
