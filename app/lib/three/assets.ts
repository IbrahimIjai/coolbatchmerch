import * as THREE from 'three'
import type { Product } from '~/data/products'
import { ClothSim } from './cloth'
import { loadGarmentModel, paintGarment, type GarmentModel, type GarmentSpec } from './garment'
import { createHanger } from './hardware'

export type ResolveUrl = (path: string) => string

export interface GarmentAsset {
  spec: GarmentSpec
  geometry: THREE.BufferGeometry
  insideAt: (x: number, y: number) => boolean
  /** Front, back and (for layered pieces) under-layer materials. */
  materials: THREE.MeshStandardMaterial[]
}

/*
 * Models are shared per garment type; textures and materials per product.
 * Everything is shared between renderers (the rack and the product viewer).
 */
const cache = new Map<string, Promise<GarmentAsset>>()

function fabric(model: GarmentModel, map: THREE.Texture | null, color?: string) {
  const material = new THREE.MeshStandardMaterial({
    map,
    color: color ?? '#ffffff',
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide
  })
  if (model.normalMap) {
    material.normalMap = model.normalMap
    material.normalScale.copy(model.normalScale)
  }
  return material
}

function canvasTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

export function loadGarment(product: Product, resolveUrl: ResolveUrl) {
  const key = [product.id, product.garment, product.color, product.under, product.image, product.placement, product.sleeve].join('|')
  let pending = cache.get(key)
  if (!pending) {
    pending = loadGarmentModel(product.garment, resolveUrl).then(async (model) => {
      // The model's normal map follows the model's own UVs (second uv set).
      if (model.normalMap) model.normalMap.channel = 1
      const { front, back } = await paintGarment(product, model, resolveUrl(product.image))
      const materials = [fabric(model, canvasTexture(front)), fabric(model, canvasTexture(back))]
      if (model.layered) materials.push(fabric(model, null, product.under ?? '#f5f4f0'))
      return { spec: model.spec, geometry: model.geometry, insideAt: model.insideAt, materials }
    })
    cache.set(key, pending)
  }
  return pending
}

/**
 * A garment on its hanger. `hanger` is placed at the point where the hook
 * meets the rail; move and turn it like the real thing. The cloth mesh lives in
 * world space (added to `scene`) and follows the hanger through the solver.
 */
export class HangingGarment {
  readonly hanger: THREE.Group
  cloth: ClothSim | null = null
  spec: GarmentSpec | null = null
  private disposed = false

  constructor(product: Product, resolveUrl: ResolveUrl, private scene: THREE.Scene, options: { lift?: number } = {}) {
    this.hanger = createHanger()
    loadGarment(product, resolveUrl).then((asset) => {
      if (this.disposed) return
      this.spec = asset.spec
      this.cloth = new ClothSim(asset)
      this.hanger.updateWorldMatrix(true, false)
      this.cloth.reset(this.hanger.matrixWorld, options.lift ?? 0)
      this.scene.add(this.cloth.mesh)
    }).catch((error) => {
      console.error(`[rack] could not build "${product.name}"`, error)
    })
  }

  update(dt: number, rigidity: number, draught = 1) {
    if (!this.cloth) return
    this.hanger.updateWorldMatrix(true, false)
    this.cloth.update(dt, this.hanger.matrixWorld, rigidity, draught)
  }

  dispose() {
    this.disposed = true
    this.hanger.removeFromParent()
    if (this.cloth) {
      this.scene.remove(this.cloth.mesh)
      this.cloth.dispose()
      this.cloth = null
    }
  }
}
