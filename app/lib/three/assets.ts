import * as THREE from 'three'
import type { Product } from '~/data/products'
import { buildGarmentGeometry, getKnitCanvas, paintGarment, type GarmentSpec } from './garment'
import { createHanger } from './hardware'

export interface GarmentAsset {
  spec: GarmentSpec
  geometry: THREE.BufferGeometry
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
      const asset: GarmentAsset = {
        spec: canvases.spec,
        geometry: buildGarmentGeometry(product.garment, canvases, product.id),
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
 * A garment on its hanger. The group origin is the point where the hook meets
 * the rail, so rotating the group swings and turns the piece like the real thing.
 */
export function createHangingGarment(product: Product, imageUrl: string, onReady?: (mesh: THREE.Mesh, asset: GarmentAsset) => void) {
  const group = new THREE.Group()
  group.add(createHanger(product.garment))
  loadGarment(product, imageUrl).then((asset) => {
    const mesh = new THREE.Mesh(asset.geometry, asset.materials)
    mesh.position.y = -asset.spec.drop
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    onReady?.(mesh, asset)
  }).catch((error) => {
    console.error(`[rack] could not build "${product.name}"`, error)
  })
  return group
}
