import type { Product } from '~/data/products'

/**
 * Flat PNG of a garment's painted front — used when WebGL is unavailable.
 * Painting happens on a 2D canvas, so it works without a GPU.
 */
export function useGarmentPreview(product: MaybeRefOrGetter<Product | undefined>) {
  const resolveImage = useProductImage()
  const src = ref<string>()
  watch(() => toValue(product), async (p) => {
    src.value = undefined
    if (!p || import.meta.server) return
    const { paintGarment } = await import('~/lib/three/garment')
    const { front } = await paintGarment(p, resolveImage(p))
    if (toValue(product)?.id === p.id) src.value = front.toDataURL('image/png')
  }, { immediate: true })
  return src
}
