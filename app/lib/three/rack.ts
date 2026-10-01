import * as THREE from 'three'
import type { Product } from '~/data/products'
import { createHangingGarment } from './assets'
import { GARMENT_SPECS } from './garment'
import { createRail } from './hardware'
import { createStage, damp, fitDistance, prefersReducedMotion, type Stage } from './stage'

const SPACING = 0.46
const ROD_Y = 0.62
/** Pieces hang side-on along the rail, like a real shop rack. */
const REST_TURN = 1.18
const HOVER_SCALE = 0.1
const HOVER_FORWARD = 0.1
const HOVER_TILT = -0.07

interface RackItem {
  product: Product
  group: THREE.Group
  garment: THREE.Mesh | null
  baseX: number
  x: number
  rest: number
  phase: number
  open: number
  swing: number
  appear: number
  /** How far neighbours slide aside when this piece turns to face front. */
  push: number
  length: number
}

export interface RackOptions {
  products: Product[]
  resolveImage: (product: Product) => string
  onHover: (index: number | null) => void
  onSelect: (index: number) => void
  /** Element positioned under the hovered piece (the product name). */
  label?: HTMLElement | null
}

function seeded(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export class RackController {
  private stage: Stage
  private items: RackItem[] = []
  private rail: THREE.Group
  private raycaster = new THREE.Raycaster()
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.05)
  private pointer = new THREE.Vector2()
  private hit = new THREE.Vector3()
  private projected = new THREE.Vector3()

  private pointerIndex: number | null = null
  private keyboardIndex: number | null = null
  private hovered: number | null = null
  private pointerInside = false

  private pan = 0
  private panTarget = 0
  private panLimit = 0
  private centerY = 0
  private distance = 8
  private drag: { id: number, x: number, y: number, startPan: number, moved: boolean, time: number } | null = null

  private frame = 0
  private last = 0
  private time = 0
  private paused = false
  private reducedMotion: boolean
  private railLength: number

  constructor(private container: HTMLElement, private options: RackOptions) {
    this.reducedMotion = prefersReducedMotion()
    const count = options.products.length
    const span = (count - 1) * SPACING
    this.railLength = span + 0.9

    this.stage = createStage(container, stage => this.frame3D(stage))
    const { scene } = this.stage

    this.rail = createRail(this.railLength)
    this.rail.position.y = ROD_Y
    scene.add(this.rail)

    options.products.forEach((product, i) => {
      const spec = GARMENT_SPECS[product.garment]
      const item: RackItem = {
        product,
        group: new THREE.Group(),
        garment: null,
        baseX: -span / 2 + i * SPACING,
        x: -span / 2 + i * SPACING,
        rest: REST_TURN + (seeded(i) - 0.5) * 0.16,
        phase: seeded(i + 40) * Math.PI * 2,
        open: 0,
        swing: 0,
        appear: 0,
        push: (spec.width * (1 + HOVER_SCALE) - SPACING) / 2 + 0.06,
        length: spec.drop + spec.height
      }
      item.group = createHangingGarment(product, options.resolveImage(product), (mesh, asset) => {
        item.garment = mesh
        item.length = asset.spec.drop + asset.spec.height
      })
      item.group.rotation.y = item.rest
      item.group.position.set(item.baseX, ROD_Y, 0)
      scene.add(item.group)
      this.items.push(item)
    })

    this.frame3D(this.stage)
    this.bind()
    this.start()
  }

  /** Fit the whole rail on wide screens; on narrow screens zoom in and allow panning. */
  private frame3D(stage: Stage) {
    const { camera } = stage
    const top = ROD_Y + 0.1
    const bottom = ROD_Y - (GARMENT_SPECS.tee.drop + GARMENT_SPECS.tee.height) * (1 + HOVER_SCALE) - 0.04
    const fitH = (top - bottom) * 1.1
    this.centerY = (top + bottom) / 2
    const fullW = this.railLength + 0.35
    const aspect = camera.aspect
    const targetW = aspect >= 1.25 ? fullW : THREE.MathUtils.clamp(aspect * fitH * 1.3, 2.3, fullW)
    this.distance = fitDistance(camera, targetW, fitH)
    const visibleW = 2 * this.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * aspect
    this.panLimit = Math.max(0, (fullW - visibleW) / 2)
    this.panTarget = THREE.MathUtils.clamp(this.panTarget, -this.panLimit, this.panLimit)
    this.pan = THREE.MathUtils.clamp(this.pan, -this.panLimit, this.panLimit)
    this.placeCamera(camera)
  }

  private placeCamera(camera = this.stage.camera) {
    camera.position.set(this.pan, this.centerY + 0.04, this.distance)
    camera.lookAt(this.pan, this.centerY, 0)
  }

  /* --------------------------------------------------------------- input */

  private bind() {
    const el = this.stage.renderer.domElement
    el.style.touchAction = 'pan-y'
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointercancel', this.onPointerCancel)
    el.addEventListener('pointerleave', this.onPointerLeave)
  }

  private unbind() {
    const el = this.stage.renderer.domElement
    el.removeEventListener('pointermove', this.onPointerMove)
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('pointercancel', this.onPointerCancel)
    el.removeEventListener('pointerleave', this.onPointerLeave)
  }

  private pick(clientX: number, clientY: number): number | null {
    const rect = this.stage.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.stage.camera)
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null
    const { x, y } = this.hit
    let best: number | null = null
    let bestScore = Infinity
    this.items.forEach((item, i) => {
      const scale = 1 + HOVER_SCALE * item.open
      const reach = SPACING / 2 + item.push * item.open
      const dx = Math.abs(x - item.x)
      if (dx > reach) return
      if (y > ROD_Y + 0.06 || y < ROD_Y - item.length * scale - 0.04) return
      const score = dx - item.push * item.open
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    })
    return best
  }

  private onPointerMove = (e: PointerEvent) => {
    this.pointerInside = true
    if (this.drag && e.pointerId === this.drag.id) {
      const dx = e.clientX - this.drag.x
      if (Math.abs(dx) > 6 || Math.abs(e.clientY - this.drag.y) > 6) this.drag.moved = true
      if (this.drag.moved && this.panLimit > 0) {
        const worldPerPx = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.stage.camera.fov) / 2)) / this.stage.size.height
        this.panTarget = THREE.MathUtils.clamp(this.drag.startPan - dx * worldPerPx, -this.panLimit, this.panLimit)
      }
    }
    if (e.pointerType === 'mouse') {
      this.pointerIndex = this.pick(e.clientX, e.clientY)
      this.updateHover()
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startPan: this.panTarget, moved: false, time: performance.now() }
    if (e.pointerType !== 'mouse') {
      // Touch: preview the piece under the finger.
      this.pointerIndex = this.pick(e.clientX, e.clientY)
      this.updateHover()
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    const drag = this.drag
    this.drag = null
    if (!drag || drag.moved || e.pointerId !== drag.id) {
      if (e.pointerType !== 'mouse') this.clearPointer()
      return
    }
    const index = this.pick(e.clientX, e.clientY)
    if (index !== null) this.options.onSelect(index)
    if (e.pointerType !== 'mouse') this.clearPointer()
  }

  private onPointerCancel = () => {
    this.drag = null
    this.clearPointer()
  }

  private onPointerLeave = (e: PointerEvent) => {
    this.pointerInside = false
    if (e.pointerType === 'mouse') this.clearPointer()
  }

  private clearPointer() {
    this.pointerIndex = null
    this.updateHover()
  }

  private updateHover() {
    const next = this.pointerIndex ?? (this.pointerInside ? null : this.keyboardIndex)
    if (next === this.hovered) return
    this.hovered = next
    this.stage.renderer.domElement.style.cursor = this.pointerIndex !== null ? 'pointer' : (this.panLimit > 0 ? 'grab' : 'default')
    this.options.onHover(next)
  }

  /** Keyboard focus from the accessible product list mirrors hover. */
  setFocus(index: number | null) {
    this.keyboardIndex = index
    if (index !== null) {
      const item = this.items[index]
      if (item) this.panTarget = THREE.MathUtils.clamp(item.baseX, -this.panLimit, this.panLimit)
    }
    this.updateHover()
    if (this.paused) this.render()
  }

  /* ---------------------------------------------------------------- loop */

  setPaused(paused: boolean) {
    if (paused === this.paused) return
    this.paused = paused
    if (paused) {
      cancelAnimationFrame(this.frame)
      this.pointerIndex = null
      this.updateHover()
    } else {
      this.start()
    }
  }

  private start() {
    this.last = performance.now()
    cancelAnimationFrame(this.frame)
    const loop = (now: number) => {
      this.frame = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      this.update(dt)
      this.render()
    }
    this.frame = requestAnimationFrame(loop)
  }

  private update(dt: number) {
    this.time += dt
    const t = this.time
    const speed = this.reducedMotion ? 30 : 9
    const swayAmount = this.reducedMotion ? 0 : 1

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!
      item.open = damp(item.open, this.hovered === i ? 1 : 0, speed, dt)
    }

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!
      let x = item.baseX
      for (let j = 0; j < this.items.length; j++) {
        if (j === i) continue
        const other = this.items[j]!
        x += Math.sign(i - j) * other.push * other.open
      }
      const velocity = (x - item.x) / Math.max(dt, 1e-4)
      item.x = x
      item.swing = damp(item.swing, THREE.MathUtils.clamp(-velocity * 0.05, -0.1, 0.1) * swayAmount, 6, dt)

      const e = item.open * item.open * (3 - 2 * item.open)
      const sway = swayAmount * (1 - 0.75 * e)
      const g = item.group
      g.position.set(x, ROD_Y, HOVER_FORWARD * e)
      g.rotation.set(
        HOVER_TILT * e,
        item.rest * (1 - e) + sway * 0.035 * Math.sin(t * 0.55 + item.phase * 1.3),
        sway * 0.012 * Math.sin(t * 0.9 + item.phase) + item.swing
      )
      g.scale.setScalar(1 + HOVER_SCALE * e)

      if (item.garment) {
        item.appear = damp(item.appear, 1, 5, dt)
        item.garment.position.y = -GARMENT_SPECS[item.product.garment].drop + (1 - item.appear) * 0.06
      }
    }

    this.pan = damp(this.pan, this.panTarget, 10, dt)
    this.placeCamera()
    this.positionLabel()
  }

  private positionLabel() {
    const label = this.options.label
    if (!label || this.hovered === null) return
    const item = this.items[this.hovered]
    if (!item) return
    const scale = 1 + HOVER_SCALE * item.open
    this.projected.set(item.x, ROD_Y - item.length * scale - 0.03, item.group.position.z).project(this.stage.camera)
    const { width, height } = this.stage.size
    const px = (this.projected.x * 0.5 + 0.5) * width
    const py = (-this.projected.y * 0.5 + 0.5) * height
    label.style.setProperty('--label-x', `${px.toFixed(1)}px`)
    label.style.setProperty('--label-y', `${py.toFixed(1)}px`)
  }

  private render() {
    this.stage.renderer.render(this.stage.scene, this.stage.camera)
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.unbind()
    this.rail.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    this.stage.dispose()
  }
}
