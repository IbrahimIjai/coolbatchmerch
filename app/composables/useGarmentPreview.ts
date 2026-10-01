import type { Product } from '~/data/products'

/**
 * Flat cut-out of a garment's printed front — used when WebGL is unavailable.
 * The model is shaped and painted on the CPU, so this works without a GPU.
 */
export function useGarmentPreview(product: MaybeRefOrGetter<Product | undefined>) {
  const resolveUrl = useAssetUrl()
  const src = ref<string>()
  watch(() => toValue(product), async (p) => {
    src.value = undefined
    if (!p || import.meta.server) return
    const { previewGarment } = await import('~/lib/three/garment')
    const url = await previewGarment(p, resolveUrl).catch(() => undefined)
    if (toValue(product)?.id === p.id) src.value = url
  }, { immediate: true })
  return src
}
