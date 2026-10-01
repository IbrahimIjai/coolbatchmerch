import * as THREE from 'three'
import type { GarmentAsset } from './assets'

/**
 * Position-based cloth (Verlet integration + distance constraints).
 *
 * Each garment is a coarse particle grid laid over its flat silhouette. The
 * particles along the shoulders rest on the hanger and are pinned to it;
 * everything else hangs under real-scale gravity. Like knitted cotton, the
 * fabric hardly stretches but bends and buckles easily, so hems trail and
 * twist when the hanger turns, sleeves flop when it is carried, and a brush of
 * the hand ripples through it. The detailed garment mesh is bound to this grid
 * and deformed on the GPU, so the solver stays small.
 *
 * A faint shape memory stops the fabric drifting over time; `rigidity` raises
 * it a little while a piece is held up to look at.
 *
 * Settled cloth falls asleep and simply rides along with its hanger; anything
 * more than a tiny sway, or a brush, wakes it.
 */

/** 9.81 m/s² in garment units (1 unit ≈ 0.74 m). */
const GRAVITY = 13.2
/** Velocity kept per step — still air around heavyweight cotton. */
const DAMPING = 0.988
const ITERATIONS = 8
const STEP = 1 / 75
const MAX_STEPS = 4
/** Particle speed (units per step) below which cloth counts as settled. */
const REST_SPEED = 1.2e-4
const SLEEP_AFTER = 75

const BLOCK_POSITION = 0
const BLOCK_AXIS_X = 1
const BLOCK_AXIS_Z = 2

export interface ClothGrid {
  cols: number
  rows: number
  cell: number
}

export const CLOTH_COLUMNS = 18

export function clothGrid(width: number, height: number): ClothGrid {
  const cell = width / (CLOTH_COLUMNS - 1)
  return { cols: CLOTH_COLUMNS, rows: Math.ceil(height / cell) + 1, cell }
}

/* ----------------------------------------------------------- GPU binding */

const VERTEX_PARS = /* glsl */`
uniform sampler2D clothTex;
uniform vec2 clothSize;
attribute vec2 aGrid;
attribute float aShell;
vec3 clothFetch(int block, vec2 g) {
  vec2 c = clamp(floor(g), vec2(0.0), clothSize - 2.0);
  vec2 f = g - c;
  ivec2 b = ivec2(c) + ivec2(0, block * int(clothSize.y));
  vec3 p00 = texelFetch(clothTex, b, 0).xyz;
  vec3 p10 = texelFetch(clothTex, b + ivec2(1, 0), 0).xyz;
  vec3 p01 = texelFetch(clothTex, b + ivec2(0, 1), 0).xyz;
  vec3 p11 = texelFetch(clothTex, b + ivec2(1, 1), 0).xyz;
  return mix(mix(p00, p10, f.x), mix(p01, p11, f.x), f.y);
}
`

const BEGIN_NORMAL = /* glsl */`
vec3 clothAxisX = normalize(clothFetch(${BLOCK_AXIS_X}, aGrid));
vec3 clothAxisZ = normalize(clothFetch(${BLOCK_AXIS_Z}, aGrid));
vec3 clothAxisY = normalize(cross(clothAxisZ, clothAxisX));
vec3 objectNormal = normalize(clothAxisX * normal.x + clothAxisY * normal.y + clothAxisZ * normal.z);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
`

const BEGIN_VERTEX = /* glsl */`
vec3 clothShellAxis = normalize(clothFetch(${BLOCK_AXIS_Z}, aGrid));
vec3 transformed = clothFetch(${BLOCK_POSITION}, aGrid) + clothShellAxis * aShell;
`

/** The reverse side of the fabric (seen through the neck, hem and cuffs) is in shadow. */
const INSIDE_SHADE = /* glsl */`
#include <map_fragment>
if (!gl_FrontFacing) diffuseColor.rgb *= 0.5;
`

function bindToCloth<T extends THREE.Material>(material: T, uniforms: { clothTex: THREE.IUniform, clothSize: THREE.IUniform }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.clothTex = uniforms.clothTex
    shader.uniforms.clothSize = uniforms.clothSize
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <beginnormal_vertex>', BEGIN_NORMAL)
      .replace('#include <begin_vertex>', BEGIN_VERTEX)
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', INSIDE_SHADE)
  }
  material.customProgramCacheKey = () => 'cloth-v3'
  return material
}

/* ----------------------------------------------------------------- solver */

export class ClothSim {
  readonly mesh: THREE.Mesh
  private grid: ClothGrid
  private count: number
  private pos: Float32Array
  private prev: Float32Array
  private target: Float32Array
  /** Rest position of each particle in hanger space. */
  private rest: Float32Array
  private inside: Uint8Array
  private pinned: Uint8Array
  private anchor: Int32Array
  private links: Int32Array
  private linkRest: Float32Array
  private linkStretch: Float32Array
  private linkCompress: Float32Array
  private axes: Float32Array
  private texData: Float32Array
  private texture: THREE.DataTexture
  private materials: THREE.Material[]
  private accumulator = 0
  private quiet = 0
  private sleeping = false
  private lastMatrix = new THREE.Matrix4()
  private delta = new THREE.Matrix4()

  constructor(asset: GarmentAsset) {
    const { spec } = asset
    this.grid = clothGrid(spec.width, spec.height)
    const { cols, rows, cell } = this.grid
    const n = this.count = cols * rows

    this.pos = new Float32Array(n * 3)
    this.prev = new Float32Array(n * 3)
    this.target = new Float32Array(n * 3)
    this.rest = new Float32Array(n * 3)
    this.inside = new Uint8Array(n)
    this.pinned = new Uint8Array(n)
    this.anchor = new Int32Array(n).fill(-1)
    this.axes = new Float32Array(n * 6)

    const isInside = (x: number, y: number) => asset.insideAt(x, y)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        const x = -spec.width / 2 + i * cell
        const y = -j * cell
        this.rest.set([x, y - spec.drop, 0], k * 3)
        this.inside[k] = isInside(x, y) ? 1 : 0
      }
    }

    // Pins: the band of fabric resting along the top of the hanger.
    for (let k = 0; k < n; k++) {
      if (!this.inside[k]) continue
      const x = this.rest[k * 3]!
      const y = this.rest[k * 3 + 1]! + spec.drop
      if (Math.abs(x) <= spec.shoulder && !isInside(x, y + 0.075)) this.pinned[k] = 1
    }

    // Links between neighbouring particles whose connecting segment lies on the fabric.
    const links: number[] = []
    const linkRest: number[] = []
    const stretch: number[] = []
    const compress: number[] = []
    const addLink = (a: number, b: number, kStretch: number, kCompress: number) => {
      if (!this.inside[a] || !this.inside[b]) return
      const ax = this.rest[a * 3]!, ay = this.rest[a * 3 + 1]! + spec.drop
      const bx = this.rest[b * 3]!, by = this.rest[b * 3 + 1]! + spec.drop
      if (!isInside((ax + bx) / 2, (ay + by) / 2)) return
      links.push(a, b)
      linkRest.push(Math.hypot(bx - ax, by - ay))
      stretch.push(kStretch)
      compress.push(kCompress)
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        // Knit fabric: barely stretches, gives way under compression, bends easily.
        if (i + 1 < cols) addLink(k, k + 1, 1, 0.12)
        if (j + 1 < rows) addLink(k, k + cols, 1, 0.12)
        if (i + 1 < cols && j + 1 < rows) addLink(k, k + cols + 1, 0.6, 0.08)
        if (i > 0 && j + 1 < rows) addLink(k, k + cols - 1, 0.6, 0.08)
        if (i + 2 < cols) addLink(k, k + 2, 0.22, 0.04)
        if (j + 2 < rows) addLink(k, k + cols * 2, 0.22, 0.04)
      }
    }
    this.links = Int32Array.from(links)
    this.linkRest = Float32Array.from(linkRest)
    this.linkStretch = Float32Array.from(stretch)
    this.linkCompress = Float32Array.from(compress)

    // Anything not connected to a pin would fall away: treat it as a ghost.
    const reached = new Uint8Array(n)
    const queue: number[] = []
    for (let k = 0; k < n; k++) {
      if (this.pinned[k]) {
        reached[k] = 1
        queue.push(k)
      }
    }
    const adjacency: number[][] = Array.from({ length: n }, () => [])
    for (let l = 0; l < this.links.length; l += 2) {
      adjacency[this.links[l]!]!.push(this.links[l + 1]!)
      adjacency[this.links[l + 1]!]!.push(this.links[l]!)
    }
    while (queue.length) {
      const k = queue.pop()!
      for (const m of adjacency[k]!) {
        if (!reached[m]) {
          reached[m] = 1
          queue.push(m)
        }
      }
    }
    for (let k = 0; k < n; k++) if (!reached[k]) this.inside[k] = 0

    // Ghost particles (off the fabric) ride along with their nearest fabric particle.
    const solid: number[] = []
    for (let k = 0; k < n; k++) if (this.inside[k]) solid.push(k)
    for (let k = 0; k < n; k++) {
      if (this.inside[k]) continue
      let best = -1
      let bestD = Infinity
      for (const s of solid) {
        const d = (this.rest[k * 3]! - this.rest[s * 3]!) ** 2 + (this.rest[k * 3 + 1]! - this.rest[s * 3 + 1]!) ** 2
        if (d < bestD) {
          bestD = d
          best = s
        }
      }
      this.anchor[k] = best
    }

    // GPU side: positions + local frame per particle, packed in a float texture.
    this.texData = new Float32Array(cols * rows * 3 * 4)
    this.texture = new THREE.DataTexture(this.texData, cols, rows * 3, THREE.RGBAFormat, THREE.FloatType)
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter
    this.texture.generateMipmaps = false
    const uniforms = {
      clothTex: { value: this.texture },
      clothSize: { value: new THREE.Vector2(cols, rows) }
    }
    const surfaces = asset.materials.map(m => bindToCloth(m.clone(), uniforms))
    const depth = bindToCloth(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }), uniforms)
    this.materials = [...surfaces, depth]

    this.mesh = new THREE.Mesh(asset.geometry, surfaces)
    this.mesh.customDepthMaterial = depth
    this.mesh.frustumCulled = false
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.matrixAutoUpdate = false
  }

  /** Places the cloth on its hanger, optionally lifted so it drops into place. */
  reset(matrix: THREE.Matrix4, lift = 0) {
    this.lastMatrix.copy(matrix)
    this.computeTargets(matrix)
    for (let k = 0; k < this.count; k++) {
      const o = k * 3
      const lifted = this.pinned[k] ? 0 : lift
      this.pos[o] = this.prev[o] = this.target[o]!
      this.pos[o + 1] = this.prev[o + 1] = this.target[o + 1]! + lifted
      this.pos[o + 2] = this.prev[o + 2] = this.target[o + 2]!
    }
    this.finish()
  }

  private computeTargets(m: THREE.Matrix4) {
    const e = m.elements
    const r = this.rest
    const t = this.target
    for (let k = 0; k < this.count; k++) {
      const o = k * 3
      const x = r[o]!, y = r[o + 1]!, z = r[o + 2]!
      t[o] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!
      t[o + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!
      t[o + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!
    }
  }

  /**
   * Advances the simulation. `matrix` is the hanger's world matrix,
   * `rigidity` 0..1 blends from free-hanging cloth towards its pressed shape.
   */
  update(dt: number, matrix: THREE.Matrix4, rigidity: number) {
    if (this.sleeping) {
      if (this.followRigidly(matrix)) return
      this.wake()
    }
    this.lastMatrix.copy(matrix)
    this.accumulator = Math.min(this.accumulator + dt, STEP * MAX_STEPS)
    if (this.accumulator < STEP) return
    const e = matrix.elements
    const scale = Math.hypot(e[0]!, e[1]!, e[2]!)
    this.computeTargets(matrix)
    let speed = 0
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP
      speed = Math.max(speed, this.step(STEP, scale, rigidity))
    }
    this.finish()
    this.quiet = speed < REST_SPEED * scale ? this.quiet + 1 : 0
    if (this.quiet > SLEEP_AFTER) this.sleeping = true
  }

  /**
   * While asleep, small hanger movements (an idle sway) carry the cloth along
   * as a rigid body. Returns false when the movement is big enough to wake it.
   */
  private followRigidly(matrix: THREE.Matrix4) {
    const d = this.delta.copy(this.lastMatrix).invert().premultiply(matrix)
    const e = d.elements
    const move = Math.abs(e[12]!) + Math.abs(e[13]!) + Math.abs(e[14]!)
    const turn = Math.abs(e[1]!) + Math.abs(e[2]!) + Math.abs(e[6]!)
    if (move > 0.003 || turn > 0.006) return false
    if (move < 1e-7 && turn < 1e-7) return true
    for (const buffer of [this.pos, this.prev]) {
      for (let k = 0; k < this.count; k++) {
        const o = k * 3
        const x = buffer[o]!, y = buffer[o + 1]!, z = buffer[o + 2]!
        buffer[o] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!
        buffer[o + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!
        buffer[o + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!
      }
    }
    this.lastMatrix.copy(matrix)
    this.finish()
    return true
  }

  private wake() {
    this.sleeping = false
    this.quiet = 0
  }

  /**
   * A hand brushing past: particles near `point` (world space, judged in the
   * x–y plane) pick up some of `velocity`.
   */
  poke(point: THREE.Vector3, velocity: THREE.Vector3, radius: number, strength: number) {
    const { pos, prev, inside, pinned } = this
    let touched = false
    for (let k = 0; k < this.count; k++) {
      if (!inside[k] || pinned[k]) continue
      const o = k * 3
      const d = Math.hypot(pos[o]! - point.x, pos[o + 1]! - point.y)
      if (d > radius) continue
      const w = (1 - d / radius) ** 2 * strength * STEP
      prev[o] = prev[o]! - velocity.x * w
      prev[o + 1] = prev[o + 1]! - velocity.y * w * 0.4
      prev[o + 2] = prev[o + 2]! - velocity.z * w
      touched = true
    }
    if (touched) this.wake()
  }

  /** Advances one step; returns the fastest particle speed (units per step). */
  private step(dt: number, scale: number, rigidity: number) {
    const { pos, prev, target, inside, pinned } = this
    const dt2 = dt * dt
    let speed = 0

    for (let k = 0; k < this.count; k++) {
      if (!inside[k]) continue
      const o = k * 3
      if (pinned[k]) {
        prev[o] = pos[o] = target[o]!
        prev[o + 1] = pos[o + 1] = target[o + 1]!
        prev[o + 2] = pos[o + 2] = target[o + 2]!
        continue
      }
      const vx = (pos[o]! - prev[o]!) * DAMPING
      const vy = (pos[o + 1]! - prev[o + 1]!) * DAMPING
      const vz = (pos[o + 2]! - prev[o + 2]!) * DAMPING
      speed = Math.max(speed, Math.abs(vx) + Math.abs(vy) + Math.abs(vz))
      prev[o] = pos[o]!
      prev[o + 1] = pos[o + 1]!
      prev[o + 2] = pos[o + 2]!
      pos[o] = pos[o]! + vx
      pos[o + 1] = pos[o + 1]! + vy - GRAVITY * scale * dt2
      pos[o + 2] = pos[o + 2]! + vz
    }

    const { links, linkRest, linkStretch, linkCompress } = this
    const shape = Math.min(0.4, 0.004 + rigidity * 0.18)
    for (let it = 0; it < ITERATIONS; it++) {
      for (let l = 0, c = 0; l < links.length; l += 2, c++) {
        const a = links[l]! * 3
        const b = links[l + 1]! * 3
        const dx = pos[b]! - pos[a]!
        const dy = pos[b + 1]! - pos[a + 1]!
        const dz = pos[b + 2]! - pos[a + 2]!
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
        const L = linkRest[c]! * scale
        const diff = (d - L) / d
        const k = diff > 0 ? linkStretch[c]! : linkCompress[c]!
        const wa = pinned[links[l]!] ? 0 : 1
        const wb = pinned[links[l + 1]!] ? 0 : 1
        const w = wa + wb
        if (!w) continue
        const s = (k * diff) / w
        pos[a] = pos[a]! + dx * s * wa
        pos[a + 1] = pos[a + 1]! + dy * s * wa
        pos[a + 2] = pos[a + 2]! + dz * s * wa
        pos[b] = pos[b]! - dx * s * wb
        pos[b + 1] = pos[b + 1]! - dy * s * wb
        pos[b + 2] = pos[b + 2]! - dz * s * wb
      }
      if (it % 2 === 1) {
        for (let k = 0; k < this.count; k++) {
          if (!inside[k] || pinned[k]) continue
          const o = k * 3
          pos[o] = pos[o]! + (target[o]! - pos[o]!) * shape
          pos[o + 1] = pos[o + 1]! + (target[o + 1]! - pos[o + 1]!) * shape
          pos[o + 2] = pos[o + 2]! + (target[o + 2]! - pos[o + 2]!) * shape
        }
      }
    }
    return speed
  }

  /** Builds per-particle frames, places ghosts and uploads the texture. */
  private finish() {
    const { cols, rows } = this.grid
    const { pos, axes, inside, anchor, rest } = this
    const p = (i: number, j: number) => (Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))) * 3

    const frame = (k: number, i: number, j: number) => {
      const r = p(i + 1, j), l = p(i - 1, j), u = p(i, j - 1), d = p(i, j + 1)
      let xx = pos[r]! - pos[l]!, xy = pos[r + 1]! - pos[l + 1]!, xz = pos[r + 2]! - pos[l + 2]!
      const yx = pos[u]! - pos[d]!, yy = pos[u + 1]! - pos[d + 1]!, yz = pos[u + 2]! - pos[d + 2]!
      let zx = xy * yz - xz * yy, zy = xz * yx - xx * yz, zz = xx * yy - xy * yx
      const zl = Math.hypot(zx, zy, zz) || 1
      zx /= zl
      zy /= zl
      zz /= zl
      const xl = Math.hypot(xx, xy, xz) || 1
      xx /= xl
      xy /= xl
      xz /= xl
      const o = k * 6
      axes[o] = xx
      axes[o + 1] = xy
      axes[o + 2] = xz
      axes[o + 3] = zx
      axes[o + 4] = zy
      axes[o + 5] = zz
    }

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        if (inside[k]) frame(k, i, j)
      }
    }
    // Ghosts follow their anchor rigidly in its local frame.
    const scale = this.currentScale()
    for (let k = 0; k < this.count; k++) {
      if (inside[k]) continue
      const a = anchor[k]!
      if (a < 0) continue
      const ao = a * 6
      const xx = axes[ao]!, xy = axes[ao + 1]!, xz = axes[ao + 2]!
      const zx = axes[ao + 3]!, zy = axes[ao + 4]!, zz = axes[ao + 5]!
      // y axis = z × x
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx
      const dx = (rest[k * 3]! - rest[a * 3]!) * scale
      const dy = (rest[k * 3 + 1]! - rest[a * 3 + 1]!) * scale
      const o = k * 3
      pos[o] = pos[a * 3]! + xx * dx + yx * dy
      pos[o + 1] = pos[a * 3 + 1]! + xy * dx + yy * dy
      pos[o + 2] = pos[a * 3 + 2]! + xz * dx + yz * dy
      axes.copyWithin(k * 6, ao, ao + 6)
    }

    const tex = this.texData
    const block = cols * rows * 4
    for (let k = 0; k < this.count; k++) {
      const o = k * 4
      tex[o] = pos[k * 3]!
      tex[o + 1] = pos[k * 3 + 1]!
      tex[o + 2] = pos[k * 3 + 2]!
      tex[block + o] = axes[k * 6]!
      tex[block + o + 1] = axes[k * 6 + 1]!
      tex[block + o + 2] = axes[k * 6 + 2]!
      tex[block * 2 + o] = axes[k * 6 + 3]!
      tex[block * 2 + o + 1] = axes[k * 6 + 4]!
      tex[block * 2 + o + 2] = axes[k * 6 + 5]!
    }
    this.texture.needsUpdate = true
  }

  /** World units per rest unit, from the hanger's current scale. */
  private currentScale() {
    const t = this.target
    const r = this.rest
    const dx = t[3]! - t[0]!, dy = t[4]! - t[1]!, dz = t[5]! - t[2]!
    const rx = r[3]! - r[0]!, ry = r[4]! - r[1]!
    return Math.hypot(dx, dy, dz) / (Math.hypot(rx, ry) || 1)
  }

  dispose() {
    this.texture.dispose()
    for (const m of this.materials) m.dispose()
  }
}
