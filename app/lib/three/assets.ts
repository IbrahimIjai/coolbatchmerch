import * as THREE from 'three'
import type { Product } from '~/data/products'
import { ClothSim } from './cloth'
import { foldField, getFabricNormalMap, loadGarmentModel, paintGarment, type GarmentSpec } from './garment'
import { createHanger } from './hardware'

export type ResolveUrl = (path: string) => string

export interface GarmentAsset {
  spec: GarmentSpec
  geometry: THREE.BufferGeometry
  insideAt: (x: number, y: number) => boolean
  /** The fabric's natural hanging folds (offset of its middle surface). */
  foldAt: (x: number, y: number) => number
  /** Front and back materials. */
  materials: THREE.MeshPhysicalMaterial[]
}

/*
 * Models are shared per garment type; textures and materials per product.
 * Everything is shared between renderers (the rack and the product viewer).
 */
const cache = new Map<string, Promise<GarmentAsset>>()

/**
 * Cotton jersey: fully rough, with a soft sheen that lights up where the
 * fabric turns away from you (the dusty edge real T-shirts have), and a fine
 * knit texture. Shape and folds come from the geometry, not from the material.
 */
function fabric(spec: GarmentSpec, map: THREE.Texture, fabricColor: string) {
  const knit = getFabricNormalMap().clone()
  knit.repeat.set(26, 26 * spec.height / spec.width)
  const sheen = new THREE.Color(fabricColor).lerp(new THREE.Color('#ffffff'), 0.65).multiplyScalar(0.55)
  const material = new THREE.MeshPhysicalMaterial({
    map,
    roughness: 0.94,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.45,
    sheenColor: sheen,
    normalMap: knit,
    normalScale: new THREE.Vector2(0.35, 0.35),
    side: THREE.DoubleSide
  })
  // Prints don't show through: the inside of the garment is plain fabric.
  // (Stored as a string — material.clone() copies userData through JSON.)
  material.userData.inside = fabricColor
  return material
}

function canvasTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

export function loadGarment(product: Product, resolveUrl: ResolveUrl) {
  const key = [product.id, product.garment, product.color, product.image, product.placement].join('|')
  let pending = cache.get(key)
  if (!pending) {
    pending = loadGarmentModel(product.garment, resolveUrl).then(async (model) => {
      const { spec } = model
      const { front, back } = await paintGarment(product, model, resolveUrl(product.image))
      const materials = [fabric(spec, canvasTexture(front), product.color), fabric(spec, canvasTexture(back), product.color)]
      return { spec, geometry: model.geometry, insideAt: model.insideAt, foldAt: foldField(product.id, spec), materials }
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

  update(dt: number, rigidity: number) {
    if (!this.cloth) return
    this.hanger.updateWorldMatrix(true, false)
    this.cloth.update(dt, this.hanger.matrixWorld, rigidity)
  }

  /** A hand brushing past the fabric. */
  brush(point: THREE.Vector3, velocity: THREE.Vector3) {
    this.cloth?.poke(point, velocity, 0.16, 0.35)
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
