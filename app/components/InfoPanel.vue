<script setup lang="ts">
import { site } from '~/data/site'

const props = defineProps<{ kind: 'about' | 'contact' }>()
const open = defineModel<boolean>('open', { required: true })

const isAbout = computed(() => props.kind === 'about')
const subscribeHref = `mailto:${site.email}?subject=${encodeURIComponent('Newsletter — sign me up')}&body=${encodeURIComponent('Please add me to the Naija Threads newsletter.')}`
const linkClass = 'text-navy underline decoration-navy/30 underline-offset-4 transition-colors hover:decoration-navy'
</script>

<template>
  <USlideover
    v-model:open="open"
    :side="isAbout ? 'left' : 'right'"
    :title="isAbout ? site.about.title : 'Contact'"
    :description="isAbout ? 'Who we are and what this capsule is about.' : 'Orders, collaborations and the newsletter.'"
    :ui="{
      overlay: 'bg-navy/15 backdrop-blur-[2px]',
      content: 'bg-paper ring-0 max-w-md',
      header: 'border-0 px-6 pt-6 sm:px-8',
      title: 'text-[11px] font-medium tracking-[0.14em] text-navy uppercase',
      description: 'sr-only',
      body: 'px-6 sm:px-8',
      close: 'text-navy'
    }"
  >
    <template #body>
      <div v-if="isAbout" class="space-y-4 text-sm/relaxed text-navy/85">
        <p v-for="paragraph in site.about.paragraphs" :key="paragraph">
          {{ paragraph }}
        </p>
        <section class="space-y-1 pt-4 text-xs/relaxed text-navy/60">
          <h3 class="text-[11px] tracking-[0.14em] text-navy/55 uppercase">
            3D models
          </h3>
          <p v-for="credit in site.modelCredits" :key="credit.url">
            Based on “<a :href="credit.url" target="_blank" rel="noopener" :class="linkClass">{{ credit.work }}</a>” by
            <a :href="credit.authorUrl" target="_blank" rel="noopener" :class="linkClass">{{ credit.author }}</a>,
            <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" :class="linkClass">CC BY 4.0</a>
            — re-posed, simulated and re-textured.
          </p>
        </section>
      </div>

      <div v-else class="space-y-8 text-sm/relaxed text-navy/85">
        <section class="space-y-1">
          <h3 class="text-[11px] tracking-[0.14em] text-navy/55 uppercase">
            Email
          </h3>
          <a :href="`mailto:${site.email}`" :class="linkClass">{{ site.email }}</a>
        </section>
        <section class="space-y-1">
          <h3 class="text-[11px] tracking-[0.14em] text-navy/55 uppercase">
            Instagram
          </h3>
          <a :href="site.instagram" target="_blank" rel="noopener" :class="linkClass">@{{ site.instagram.split('/').pop() }}</a>
        </section>
        <section class="space-y-3">
          <h3 class="text-[11px] tracking-[0.14em] text-navy/55 uppercase">
            Newsletter
          </h3>
          <p>New designs land most days. Join the list and we will send the drops, restocks and the odd studio note — nothing else.</p>
          <UButton
            :to="subscribeHref"
            variant="outline"
            color="neutral"
            size="sm"
            label="Subscribe by email"
            class="pill-button"
          />
        </section>
      </div>
    </template>
  </USlideover>
</template>
