# Nuxt Starter

A minimal Nuxt app with Nuxt UI, Tailwind CSS, and a blank homepage.

## Development

```bash
bun install
bun run dev
```

## Theme

- `app/assets/css/main.css` defines fonts, colors, surfaces, borders, and radii for light and dark mode.
- `app/app.config.ts` configures Nuxt UI colors, icons, and shared component styles.
- `nuxt.config.ts` configures color mode to follow the system preference, with a dark fallback.

The theme uses a warm paper canvas in light mode and charcoal in dark mode,
with neutral primary actions and Geist typography.

## App structure

- `app/app.vue` provides the Nuxt UI app wrapper.
- `app/pages/index.vue` is the blank starting page.

## Checks and production

```bash
bun run lint
bun run typecheck
bun run build
bun run preview
```
