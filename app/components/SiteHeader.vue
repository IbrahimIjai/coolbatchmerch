<script setup lang="ts">
defineEmits<{ about: [], contact: [] }>()

const navLink = {
  base: 'px-0 text-[11px] font-medium tracking-[0.14em] text-navy uppercase hover:text-navy/60 focus-visible:ring-navy'
}
</script>

<template>
  <UHeader
    :toggle="false"
    :ui="{
      root: 'static h-auto border-0 bg-transparent backdrop-blur-none',
      container: 'max-w-none px-5 py-4 sm:px-8 sm:py-5',
      left: 'flex-1',
      center: 'flex justify-center',
      right: 'flex-1'
    }"
  >
    <template #left>
      <UButton
        variant="link"
        color="neutral"
        label="About"
        :ui="navLink"
        @click="$emit('about')"
      />
    </template>

    <BrandWordmark />

    <template #right>
      <UButton
        variant="link"
        color="neutral"
        label="Contact"
        :ui="navLink"
        @click="$emit('contact')"
      />
    </template>
  </UHeader>
</template>
