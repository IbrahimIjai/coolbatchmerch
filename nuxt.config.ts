export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'theme-color', content: '#ebe8e1' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]
    }
  },

  css: ['~/assets/css/main.css'],

  // The site has one calm light palette; no dark mode toggle.
  ui: {
    colorMode: false
  },

  compatibilityDate: '2026-06-30',

  vite: {
    optimizeDeps: {
      include: ['three', 'three/examples/jsm/environments/RoomEnvironment.js', 'three/examples/jsm/loaders/GLTFLoader.js']
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  fonts: {
    families: [
      { name: 'Instrument Sans', provider: 'google', weights: [400, 500, 600], styles: ['normal', 'italic'] },
      { name: 'Lobster Two', provider: 'google', weights: [700], styles: ['italic'] }
    ]
  }
})
