import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GarmentKind, Product } from '~/data/products'
import { clothGrid } from './cloth'
import { hangerTopAt } from './hardware'

/*
 * Garments come from real 3D clothing models (see public/models/CREDITS.md).
 * Those models are "worn": round tubes shaped by an invisible body, sleeves
 * held out. To hang them we convert them into "garment space" — x centred,
 * y = 0 at the top of the collar, hanging into negative y, z out of the front —
 * then:
 *   1. widen the torso so its circumference lies flat (as a shirt does on a hanger),
 *   2. press the front and back together into two thin layers of fabric, held a
 *      little apart across the shoulders by the hanger,
 *   3. swing the sleeves down from the shoulders,
 *   4. fit the shoulders just over our wooden hanger.
 * Our fabric colour and prints are projected onto the front and back. The
 * models' own wrinkle maps are not used: they describe a shirt worn on a body.
 * Folds come from the cloth simulation instead (see `foldAt` and cloth.ts).
 */

export interface GarmentSpec {
  width: number
  height: number
  /** Where the top of the collar sits below the rail. */
  drop: number
  /** Half-width of the torso. */
  body: number
  /** Shoulder span resting on the hanger (pinned in the cloth sim). */
  shoulder: number
}

interface ModelSource {
  path: string
  /** Extra downward swing for the sleeves, radians. */
  sleeveDrop: number
}

const SOURCES: Record<GarmentKind, ModelSource> = {
  tee: { path: 'models/basic-tee/basic_t-shirt.glb', sleeveDrop: 0.12 }
}

/** Half-width of every torso once laid flat, in garment units. */
const TORSO = 0.345
/** How much wider a round torso becomes when it lies flat (≈ π/2, minus some ease). */
const FLATTEN_X = 1.45

/** Layout sizes used before the models have loaded (rack spacing, framing). */
export const GARMENT_SPECS: Record<GarmentKind, GarmentSpec> = {
  tee: { width: 1.06, height: 1.02, drop: 0.168, body: TORSO, shoulder: 0.33 }
}

/* ---------------------------------------------------------------- loading */

interface RawModel {
  positions: Float32Array
  indices: Uint32Array
}

const rawCache = new Map<string, Promise<RawModel>>()

function loadRaw(url: string) {
  let pending = rawCache.get(url)
  if (!pending) {
    pending = new GLTFLoader().loadAsync(url).then((gltf) => {
      gltf.scene.updateMatrixWorld(true)
      const positions: number[] = []
      const indices: number[] = []
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
        const base = positions.length / 3
        const pos = g.getAttribute('position')
        for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
        const index = g.getIndex()
        if (index) for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i))
        else for (let i = 0; i < pos.count; i++) indices.push(base + i)
        g.dispose()
        // Only the shape is used; release the model's own textures.
        const material = mesh.material as THREE.MeshStandardMaterial
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) material[key]?.dispose()
        material.dispose()
      })
      return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
    })
    rawCache.set(url, pending)
  }
  return pending
}

/* ------------------------------------------------------------- topology */

/** Maps vertices that share a position (UV seams) to one id. */
function weld(positions: Float32Array) {
  const ids = new Int32Array(positions.length / 3)
  const seen = new Map<string, number>()
  for (let i = 0; i < ids.length; i++) {
    const key = `${Math.round(positions[i * 3]! * 1e4)},${Math.round(positions[i * 3 + 1]! * 1e4)},${Math.round(positions[i * 3 + 2]! * 1e4)}`
    let id = seen.get(key)
    if (id === undefined) {
      id = i
      seen.set(key, i)
    }
    ids[i] = id
  }
  return ids
}

/** Open borders (neck, hem, cuffs) as loops of vertex indices. */
function borderLoops(ids: Int32Array, indices: Uint32Array) {
  const edges = new Map<string, [number, number, number]>()
  for (let t = 0; t < indices.length; t += 3) {
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
      const u = ids[indices[t + a]!]!
      const v = ids[indices[t + b]!]!
      const key = u < v ? `${u}_${v}` : `${v}_${u}`
      const e = edges.get(key)
      if (e) e[2]++
      else edges.set(key, [u, v, 1])
    }
  }
  const adjacency = new Map<number, number[]>()
  for (const [u, v, n] of edges.values()) {
    if (n !== 1) continue
    if (!adjacency.has(u)) adjacency.set(u, [])
    if (!adjacency.has(v)) adjacency.set(v, [])
    adjacency.get(u)!.push(v)
    adjacency.get(v)!.push(u)
  }
  const seen = new Set<number>()
  const loops: number[][] = []
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue
    const loop: number[] = []
    const stack = [start]
    while (stack.length) {
      const x = stack.pop()!
      if (seen.has(x)) continue
      seen.add(x)
      loop.push(x)
      for (const y of adjacency.get(x)!) if (!seen.has(y)) stack.push(y)
    }
    loops.push(loop)
  }
  return loops
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/* --------------------------------------------------------------- shaping */

export interface GarmentAnchors {
  /** Lowest point of the front neckline. */
  neckFront: number
  /** Highest point of the back neckline. */
  neckBack: number
}

export interface GarmentModel {
  spec: GarmentSpec
  geometry: THREE.BufferGeometry
  anchors: GarmentAnchors
  insideAt: (x: number, y: number) => boolean
  /** Flat silhouette, for 2D previews. */
  mask: HTMLCanvasElement
}

const modelCache = new Map<string, Promise<GarmentModel>>()

export function loadGarmentModel(kind: GarmentKind, resolveUrl: (path: string) => string) {
  const source = SOURCES[kind]
  const url = resolveUrl(source.path)
  const key = `${kind}|${url}`
  let pending = modelCache.get(key)
  if (!pending) {
    pending = loadRaw(url).then(raw => shapeGarment(raw, source))
    modelCache.set(key, pending)
  }
  return pending
}

function shapeGarment(raw: RawModel, source: ModelSource): GarmentModel {
  // 1. The model's surface, and its open borders (neck, hem, cuffs).
  const P = raw.positions.slice()
  const n = P.length / 3
  const index = raw.indices.slice()
  const ids = weld(P)
  const loops = borderLoops(ids, index)

  const centroid = (loop: number[]) => {
    const c = new THREE.Vector3()
    for (const i of loop) c.add(new THREE.Vector3(P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!))
    return c.divideScalar(loop.length)
  }
  const loopInfo = loops.map((loop) => {
    let minX = Infinity, maxX = -Infinity
    for (const i of loop) {
      minX = Math.min(minX, P[i * 3]!)
      maxX = Math.max(maxX, P[i * 3]!)
    }
    return { loop, c: centroid(loop), half: (maxX - minX) / 2 }
  })
  const neck = loopInfo.reduce((a, b) => (b.c.y > a.c.y ? b : a))
  // The hem used for sizing: the lowest centred loop.
  const hems = loopInfo.filter(l => Math.abs(l.c.x) < 0.1)
  const hem = hems.reduce((a, b) => (b.c.y < a.c.y ? b : a))

  // 2. Face the front towards +z: the front neckline dips lower than the back.
  let lowest = neck.loop[0]!
  for (const i of neck.loop) if (P[i * 3 + 1]! < P[lowest * 3 + 1]!) lowest = i
  const flip = P[lowest * 3 + 2]! < neck.c.z ? -1 : 1

  // 3. Into garment space: torso widened to lie flat, sleeves carried outwards unscaled.
  const s = TORSO / (hem.half * FLATTEN_X)
  let top = -Infinity
  for (let i = 0; i < n; i++) top = Math.max(top, P[i * 3 + 1]!)
  const edge = hem.half * 1.05
  const X = new Float32Array(n)
  const Y = new Float32Array(n)
  const Z = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (P[i * 3]! - hem.c.x) * flip
    const ax = Math.abs(x)
    const wide = ax <= edge ? ax * FLATTEN_X : edge * FLATTEN_X + (ax - edge)
    X[i] = Math.sign(x) * wide * s
    Y[i] = (P[i * 3 + 1]! - top) * s
    Z[i] = (P[i * 3 + 2]! - hem.c.z) * flip
  }

  // 4. Press flat: per height, centre the torso and squeeze its depth so the
  //    front and back lie close — a centimetre or two apart where the hanger
  //    holds the shoulders open, a few millimetres lower down.
  let minY = 0
  for (let i = 0; i < n; i++) minY = Math.min(minY, Y[i]!)
  const bins = 48
  const lo = new Float32Array(bins).fill(Infinity)
  const hi = new Float32Array(bins).fill(-Infinity)
  const bin = (y: number) => Math.min(bins - 1, Math.max(0, Math.floor((y / minY) * bins)))
  for (let i = 0; i < n; i++) {
    if (Math.abs(X[i]!) > TORSO * 0.8) continue
    const b = bin(Y[i]!)
    lo[b] = Math.min(lo[b]!, Z[i]!)
    hi[b] = Math.max(hi[b]!, Z[i]!)
  }
  const centre = new Float32Array(bins)
  const half = new Float32Array(bins)
  for (let b = 0; b < bins; b++) {
    let k = b
    while (k < bins && !Number.isFinite(lo[k]!)) k++
    if (k === bins) {
      k = b
      while (k > 0 && !Number.isFinite(lo[k]!)) k--
    }
    centre[b] = (lo[k]! + hi[k]!) / 2
    half[b] = Math.max(0.02, (hi[k]! - lo[k]!) / 2)
  }
  const smooth = (a: Float32Array) => a.map((_, b) => (a[Math.max(0, b - 1)]! + a[b]! * 2 + a[Math.min(bins - 1, b + 1)]!) / 4)
  const centreS = smooth(centre)
  const halfS = smooth(half)

  // Hems, cuffs and collars fold back inside the garment. Those turned-under
  // allowances face inwards; once the garment is pressed thin they would sit a
  // fraction of a millimetre behind the outside and show through it, so they
  // are tucked further in, like a pressed hem.
  const turned = new Uint8Array(n)
  {
    const acc = new Float32Array(n * 3)
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3()
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t]!, index[t + 1]!, index[t + 2]!]
      pa.set(X[a]!, Y[a]!, Z[a]!)
      pb.set(X[b]!, Y[b]!, Z[b]!)
      pc.set(X[c]!, Y[c]!, Z[c]!)
      const f = pb.sub(pa).cross(pc.sub(pa))
      for (const v of [a, b, c]) {
        const w = ids[v]!
        acc[w * 3] = acc[w * 3]! + f.x
        acc[w * 3 + 2] = acc[w * 3 + 2]! + f.z
      }
    }
    // Which way the outside faces: most of a garment's area faces outwards.
    const facing = new Float32Array(n)
    let outwards = 0
    for (let i = 0; i < n; i++) {
      const w = ids[i]!
      const rz = Z[i]! - centreS[bin(Y[i]!)]!
      facing[i] = acc[w * 3]! * X[i]! + acc[w * 3 + 2]! * rz
      outwards += Math.sign(facing[i]!)
    }
    for (let i = 0; i < n; i++) turned[i] = facing[i]! * outwards < 0 ? 1 : 0
  }

  for (let i = 0; i < n; i++) {
    const b = bin(Y[i]!)
    const target = THREE.MathUtils.lerp(0.024, 0.006, smoothstep(0.04, 0.3, -Y[i]!))
    let z = ((Z[i]! - centreS[b]!) / halfS[b]!) * target
    if (turned[i]) z *= 0.35
    Z[i] = z
  }

  // 5. Let the sleeves hang: swing them down about the shoulders.
  let shoulderY = -Infinity
  for (let i = 0; i < n; i++) if (Math.abs(Math.abs(X[i]!) - TORSO) < 0.04) shoulderY = Math.max(shoulderY, Y[i]!)
  const pivotY = shoulderY - 0.04
  for (let i = 0; i < n; i++) {
    const ax = Math.abs(X[i]!)
    const w = smoothstep(TORSO - 0.01, TORSO + 0.12, ax)
    if (!w) continue
    const side = Math.sign(X[i]!)
    const angle = -side * source.sleeveDrop * w
    const dx = X[i]! - side * (TORSO - 0.02)
    const dy = Y[i]! - pivotY
    X[i] = side * (TORSO - 0.02) + dx * Math.cos(angle) - dy * Math.sin(angle)
    Y[i] = pivotY + dx * Math.sin(angle) + dy * Math.cos(angle)
  }

  // Extents (symmetric about x = 0) and the flat silhouette.
  let maxX = 0
  minY = 0
  for (let i = 0; i < n; i++) {
    maxX = Math.max(maxX, Math.abs(X[i]!))
    minY = Math.min(minY, Y[i]!)
  }
  const width = maxX * 2 + 0.02
  const height = -minY + 0.01
  const maskW = 256
  const maskH = Math.round(maskW * height / width)
  const mask = document.createElement('canvas')
  mask.width = maskW
  mask.height = maskH
  const mctx = mask.getContext('2d', { willReadFrequently: true })!
  const toMask = (x: number, y: number): [number, number] => [((x + width / 2) / width) * maskW, (-y / height) * maskH]
  mctx.fillStyle = '#000'
  mctx.strokeStyle = '#000'
  mctx.lineWidth = 1
  // Every triangle is added with the same 2D winding so overlapping front and
  // back panels union (rather than cancel) under the non-zero fill rule.
  mctx.beginPath()
  for (let t = 0; t < index.length; t += 3) {
    const a = toMask(X[index[t]!]!, Y[index[t]!]!)
    let b = toMask(X[index[t + 1]!]!, Y[index[t + 1]!]!)
    let c = toMask(X[index[t + 2]!]!, Y[index[t + 2]!]!)
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b]
    mctx.moveTo(a[0], a[1])
    mctx.lineTo(b[0], b[1])
    mctx.lineTo(c[0], c[1])
    mctx.closePath()
  }
  mctx.fill('nonzero')
  mctx.stroke()
  const alpha = mctx.getImageData(0, 0, maskW, maskH).data
  const insideAt = (x: number, y: number) => {
    const [mx, my] = toMask(x, y)
    const px = Math.floor(mx)
    const py = Math.floor(my)
    if (px < 0 || py < 0 || px >= maskW || py >= maskH) return false
    return alpha[(py * maskW + px) * 4 + 3]! > 127
  }
  const topAt = (x: number) => {
    const px = Math.min(maskW - 1, Math.max(0, Math.floor(toMask(x, 0)[0])))
    for (let py = 0; py < maskH; py++) if (alpha[(py * maskW + px) * 4 + 3]! > 127) return -(py / maskH) * height
    return -height
  }

  // 6. Sit the shoulders just over the hanger.
  const shoulderTop = (topAt(0.2) + topAt(-0.2)) / 2
  const drop = shoulderTop - hangerTopAt(0.2) - 0.012

  // The hanger is inside the shoulders: both layers drape over and around it
  // rather than through it, curving in to meet at the top edge.
  for (let i = 0; i < n; i++) {
    const ax = Math.abs(X[i]!)
    if (ax > 0.37) continue
    if (Y[i]! < hangerTopAt(X[i]!) + drop - 0.06) continue
    const below = Math.max(0, topAt(X[i]!) - Y[i]!)
    const floor = 0.024 * Math.sqrt(Math.min(1, below / 0.02)) * (1 - smoothstep(0.33, 0.37, ax))
    if (Math.abs(Z[i]!) < floor) Z[i] = (Z[i]! < 0 ? -1 : 1) * floor
  }

  // 7. Anchors for prints.
  let neckFront = 0
  let neckBack = -Infinity
  for (const i of neck.loop) {
    if (Z[i]! >= 0) neckFront = Math.min(neckFront, Y[i]!)
    else neckBack = Math.max(neckBack, Y[i]!)
  }
  if (!Number.isFinite(neckBack)) neckBack = 0

  // 8. Normals smoothed across UV seams, after all reshaping. Faces must wind
  //    outwards (the shader shades inward-facing fabric as the inside).
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3()
  const faceNormal = (t: number) => {
    const [a, b, c] = [index[t]!, index[t + 1]!, index[t + 2]!]
    pa.set(X[a]!, Y[a]!, Z[a]!)
    pb.set(X[b]!, Y[b]!, Z[b]!)
    pc.set(X[c]!, Y[c]!, Z[c]!)
    return pb.sub(pa).cross(pc.sub(pa))
  }
  let outward = 0
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t]!, index[t + 1]!, index[t + 2]!]
    const z = Z[a]! + Z[b]! + Z[c]!
    if (Math.abs(X[a]!) < 0.2) outward += Math.sign(z) * Math.sign(faceNormal(t).z)
  }
  if (outward < 0) {
    for (let t = 0; t < index.length; t += 3) {
      const b = index[t + 1]!
      index[t + 1] = index[t + 2]!
      index[t + 2] = b
    }
  }
  const normals = new Float32Array(n * 3)
  const acc = new Float32Array(n * 3)
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t]!, index[t + 1]!, index[t + 2]!]
    const f = faceNormal(t)
    for (const v of [a, b, c]) {
      const w = ids[v]!
      acc[w * 3] = acc[w * 3]! + f.x
      acc[w * 3 + 1] = acc[w * 3 + 1]! + f.y
      acc[w * 3 + 2] = acc[w * 3 + 2]! + f.z
    }
  }
  for (let i = 0; i < n; i++) {
    const w = ids[i]!
    const v = new THREE.Vector3(acc[w * 3]!, acc[w * 3 + 1]!, acc[w * 3 + 2]!).normalize()
    normals.set([v.x, v.y, v.z], i * 3)
  }

  // 9. Assemble: planar uv for our prints, plus the cloth binding.
  const grid = clothGrid(width, height)
  const positions: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const gridCoords: number[] = []
  const shells: number[] = []
  const groups: number[][] = [[], []]
  const out = [new Int32Array(n).fill(-1), new Int32Array(n).fill(-1)]
  const vertex = (i: number, group: number) => {
    const map = out[group]!
    if (map[i]! >= 0) return map[i]!
    const k = positions.length / 3
    positions.push(X[i]!, Y[i]!, Z[i]!)
    nrm.push(normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!)
    const u = (X[i]! + width / 2) / width
    uv.push(group === 1 ? 1 - u : u, 1 + Y[i]! / height)
    gridCoords.push((X[i]! + width / 2) / grid.cell, -Y[i]! / grid.cell)
    shells.push(Z[i]!)
    map[i] = k
    return k
  }
  for (let t = 0; t < index.length; t += 3) {
    const tri = [index[t]!, index[t + 1]!, index[t + 2]!]
    const group = Z[tri[0]!]! + Z[tri[1]!]! + Z[tri[2]!]! >= 0 ? 0 : 1
    groups[group]!.push(...tri.map(i => vertex(i, group)))
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('aGrid', new THREE.Float32BufferAttribute(gridCoords, 2))
  geometry.setAttribute('aShell', new THREE.Float32BufferAttribute(shells, 1))
  geometry.setIndex(groups.flat())
  let start = 0
  groups.forEach((g, i) => {
    geometry.addGroup(start, g.length, i)
    start += g.length
  })
  geometry.computeBoundingSphere()

  return {
    spec: { width, height, drop, body: TORSO, shoulder: 0.33 },
    geometry,
    anchors: { neckFront, neckBack },
    insideAt,
    mask
  }
}

/* ----------------------------------------------------------------- folds */

function seedOf(key: string) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

/**
 * How a garment naturally hangs, as an offset of its middle surface from flat
 * (garment space, z towards the viewer). Soft vertical folds open up towards
 * the hem, the hem itself undulates, and shallow drag lines run down from the
 * hanger tips. The cloth sim treats this as the fabric's rest shape, so the
 * folds are real geometry that swings, twists and settles with the garment.
 */
export function foldField(key: string, spec: GarmentSpec) {
  const seed = seedOf(key)
  const p1 = seed * Math.PI * 2
  const p2 = seed * 17.3
  const p3 = seed * 41.9
  // Folds 18–26 cm apart (in garment units), slightly irregular per garment.
  const f1 = 23 + seed * 4
  const f2 = 33 + seed * 5
  return (x: number, y: number) => {
    const t = Math.min(1, Math.max(0, -y / spec.height))
    const amp = 0.0015 + 0.014 * smoothstep(0.1, 1, t)
    // Folds drift and fan out slightly as they fall.
    let z = amp * (0.62 * Math.sin(x * f1 * (1 - 0.12 * t) + p1 + t * 1.6) + 0.38 * Math.sin(x * f2 + p2 - t * 1.1))
    z += 0.003 * Math.sin(x * 41 + p3) * smoothstep(0.8, 1, t)
    // Drag lines from the hanger tips, fading out by the chest.
    const ridge = Math.abs(x) - (spec.shoulder - 0.32 * t)
    z -= 0.007 * Math.exp(-(ridge * ridge) / 0.0018) * (1 - smoothstep(0.06, 0.3, t))
    return z
  }
}

let fabricNormal: THREE.CanvasTexture | null = null

/**
 * A tiling normal map of jersey knit — the fine texture of the cloth itself,
 * not wrinkles. Wrinkles and folds come from the geometry.
 */
export function getFabricNormalMap() {
  if (fabricNormal) return fabricNormal
  const size = 256
  const height = new Float32Array(size * size)
  let seed = 11
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  // Rows of interlocking knit loops plus fibre noise.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x % 8) / 8
      const v = ((y + (Math.floor(x / 8) % 2) * 4) % 8) / 8
      const loop = Math.sin(u * Math.PI) * (0.6 + 0.4 * Math.sin(v * Math.PI * 2))
      height[y * size + x] = loop * 0.8 + (rand() - 0.5) * 0.35
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]!
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y)
      const dy = at(x, y + 1) - at(x, y - 1)
      const n = new THREE.Vector3(-dx, -dy, 2).normalize()
      const i = (y * size + x) * 4
      img.data[i] = (n.x * 0.5 + 0.5) * 255
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  fabricNormal = new THREE.CanvasTexture(canvas)
  fabricNormal.wrapS = fabricNormal.wrapT = THREE.RepeatWrapping
  fabricNormal.colorSpace = THREE.NoColorSpace
  return fabricNormal
}

/* ---------------------------------------------------------------- canvas */

let knitCanvas: HTMLCanvasElement | null = null

/** Small tiling knit/jersey noise used both as print grain and as a bump map. */
export function getKnitCanvas() {
  if (knitCanvas) return knitCanvas
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  let seed = 7
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Interlocking "V" loops of a jersey knit, plus fibre noise.
      const loop = Math.abs(((x % 4) - 1.5)) / 1.5
      const row = ((y + (x % 4 < 2 ? 0 : 1)) % 3) / 3
      const v = 150 + loop * 40 - row * 30 + (rand() - 0.5) * 70
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v))
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  knitCanvas = canvas
  return canvas
}

function lightness(hex: string) {
  return new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l
}

type Drawable = CanvasImageSource & { width: number, height: number }

function drawContain(ctx: CanvasRenderingContext2D, img: Drawable, r: { x: number, y: number, w: number, h: number }) {
  const scale = Math.min(r.w / img.width, r.h / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h)
}

function drawCover(ctx: CanvasRenderingContext2D, img: Drawable) {
  const { width, height } = ctx.canvas
  const scale = Math.max(width / img.width, height / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h)
}

function applyGrain(ctx: CanvasRenderingContext2D) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = 0.14
  ctx.fillStyle = ctx.createPattern(getKnitCanvas(), 'repeat')!
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
}

async function loadImage(src: string) {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  await img.decode()
  return img
}

const TEXTURE_WIDTH = 1024

export interface GarmentCanvases {
  front: HTMLCanvasElement
  back: HTMLCanvasElement
}

/** Paints the front and back of a garment: fabric, prints and knit grain. */
export async function paintGarment(product: Product, model: GarmentModel, imageUrl: string): Promise<GarmentCanvases> {
  const [img] = await Promise.all([
    loadImage(imageUrl).catch(() => null),
    document.fonts?.load('600 32px "Instrument Sans"').catch(() => null)
  ])
  const { spec, anchors } = model
  const px = TEXTURE_WIDTH / spec.width
  const rect = (x0: number, y0: number, x1: number, y1: number) => ({
    x: (x0 + spec.width / 2) * px,
    y: -y0 * px,
    w: (x1 - x0) * px,
    h: (y0 - y1) * px
  })
  const ink = lightness(product.color) > 0.5 ? 'rgba(39,48,79,0.88)' : 'rgba(241,236,224,0.92)'

  const paint = (side: 'front' | 'back') => {
    const canvas = document.createElement('canvas')
    canvas.width = TEXTURE_WIDTH
    canvas.height = Math.round(TEXTURE_WIDTH * spec.height / spec.width)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = product.color
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const allOver = product.placement === 'full' && img
    if (allOver) drawCover(ctx, img)

    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    if (side === 'back') {
      // Small screen-printed label under the back collar.
      const y = (-anchors.neckBack + 0.06) * px
      ctx.textBaseline = 'top'
      ctx.font = `600 ${Math.round(0.03 * px)}px "Instrument Sans", system-ui, sans-serif`
      ctx.letterSpacing = `${Math.round(0.006 * px)}px`
      ctx.fillText('NAIJA THREADS', canvas.width / 2, y)
      ctx.font = `500 ${Math.round(0.019 * px)}px "Instrument Sans", system-ui, sans-serif`
      ctx.fillText('NIGERIA @ 66 · 1960—2026', canvas.width / 2, y + 0.042 * px)
    } else {
      if (img && !allOver) {
        const top = anchors.neckFront - 0.075
        if (product.placement === 'pocket') drawContain(ctx, img, rect(0.07, top - 0.02, 0.22, top - 0.17))
        else drawContain(ctx, img, rect(-0.23, top, 0.23, top - 0.46))
      }
    }
    ctx.letterSpacing = '0px'
    applyGrain(ctx)
    return canvas
  }

  return { front: paint('front'), back: paint('back') }
}

/** A flat cut-out of the garment front, for browsers without WebGL. */
export async function previewGarment(product: Product, resolveUrl: (path: string) => string) {
  const model = await loadGarmentModel(product.garment, resolveUrl)
  const { front } = await paintGarment(product, model, resolveUrl(product.image))
  const out = document.createElement('canvas')
  out.width = front.width
  out.height = front.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(model.mask, 0, 0, out.width, out.height)
  ctx.globalCompositeOperation = 'source-in'
  ctx.drawImage(front, 0, 0)
  return out.toDataURL('image/png')
}
