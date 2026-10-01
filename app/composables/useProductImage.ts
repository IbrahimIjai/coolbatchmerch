import { hasProtocol, joinURL } from 'ufo'
import type { Product } from '~/data/products'

/** Resolves product image paths against the app's base URL (for sub-path deploys). */
export function useProductImage() {
  const base = useRuntimeConfig().app.baseURL
  return (product: Product) => hasProtocol(product.image) ? product.image : joinURL(base, product.image)
}
