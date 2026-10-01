import { hasProtocol, joinURL } from 'ufo'

/** Resolves a public asset path against the app's base URL (for sub-path deploys). */
export function useAssetUrl() {
  const base = useRuntimeConfig().app.baseURL
  return (path: string) => hasProtocol(path) ? path : joinURL(base, path)
}
