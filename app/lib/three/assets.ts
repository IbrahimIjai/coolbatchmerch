import * as THREE from 'three'
import type { Product } from '~/data/products'
import { buildGarmentGeometry, getKnitCanvas, paintGarment, type GarmentSpec } from './garment'
import { ClothSim } from './cloth'
import { createHanger } from './hardware'

export interface GarmentAsset {
  spec: GarmentSpec
  geometry: THREE.BufferGeometry
  insideAt: (x: number, y: number) => boolean
  materials: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial]
  /** Flat image of the painted front, for 2D fallbacks. */
  front: HTMLCanvasElement
}

/*
 * Geometry, textures and materials are shared between every renderer on the
 * page (the rack and the product viewer), so each garment is built once.
 */
const cache = new Map<string, Promise<GarmentAsset>>()
let knitTexture: THREE.CanvasTexture | null = null

function getKnitTexture() {
  if (!knitTexture) {
    knitTexture = new THREE.CanvasTexture(getKnitCanvas())
    knitTexture.wrapS = knitTexture.wrapT = THREE.RepeatWrapping
    knitTexture.repeat.set(26, 26)
    knitTexture.colorSpace = THREE.NoColorSpace
  }
  return knitTexture
}

function fabricMaterial(canvas: HTMLCanvasElement) {
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  return new THREE.MeshStandardMaterial({
    map,
    bumpMap: getKnitTexture(),
    bumpScale: 0.35,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
    alphaToCoverage: true
  })
}

export function loadGarment(product: Product, imageUrl: string) {
  const key = `${product.id}|${imageUrl}|${product.color}|${product.placement}|${product.garment}`
  let pending = cache.get(key)
  if (!pending) {
    pending = paintGarment(product, imageUrl).then((canvases) => {
      const { geometry, insideAt } = buildGarmentGeometry(product.garment, canvases, product.id)
      const asset: GarmentAsset = {
        spec: canvases.spec,
        geometry,
        insideAt,
        materials: [fabricMaterial(canvases.front), fabricMaterial(canvases.back)],
        front: canvases.front
      }
      return asset
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
  private disposed = false

  constructor(product: Product, imageUrl: string, private scene: THREE.Scene, options: { lift?: number } = {}) {
    this.hanger = createHanger(product.garment)
    loadGarment(product, imageUrl).then((asset) => {
      if (this.disposed) return
      this.cloth = new ClothSim(product.garment, asset)
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
