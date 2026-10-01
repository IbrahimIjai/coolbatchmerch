import * as THREE from 'three'
import type { Product } from '~/data/products'
import { HangingGarment } from './assets'
import { GARMENT_SPECS } from './garment'
import { createRail } from './hardware'
import { createStage, damp, fitDistance, prefersReducedMotion, type Stage } from './stage'

const SPACING = 0.46
const ROD_Y = 0.62
/** Pieces hang side-on along the rail, like a real shop rack. */
const REST_TURN = 1.32
const HOVER_SCALE = 0.1
const HOVER_FORWARD = 0.1
const HOVER_TILT = -0.05
/** Hold time before a touch press picks a piece up instead of panning. */
const LONG_PRESS_MS = 320
const DRAG_THRESHOLD = 6

interface RackItem {
  product: Product
  garment: HangingGarment
  slot: number
  x: number
  rest: number
  phase: number
  open: number
  /** How far neighbours slide aside when this piece turns to face front. */
  push: number
  length: number
}

interface Press {
  id: number
  type: string
  x: number
  y: number
  index: number | null
  startPan: number
  moved: boolean
  timer: ReturnType<typeof setTimeout> | null
}

export interface RackOptions {
  products: Product[]
  resolveImage: (product: Product) => string
  onHover: (index: number | null) => void
  onSelect: (index: number) => void
  /** Called with product indices in rail order after a piece is moved. */
  onReorder?: (order: number[]) => void
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
  private order: number[] = []
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

  private press: Press | null = null
  private carry: { index: number, offset: number, x: number } | null = null

  private pan = 0
  private panTarget = 0
  private panLimit = 0
  private centerY = 0
  private distance = 8

  private frame = 0
  private last = 0
  private time = 0
  private paused = false
  private reducedMotion: boolean
  private span: number
  private railLength: number

  constructor(private container: HTMLElement, private options: RackOptions) {
    this.reducedMotion = prefersReducedMotion()
    const count = options.products.length
    this.span = (count - 1) * SPACING
    this.railLength = this.span + 0.9

    this.stage = createStage(container, stage => this.frame3D(stage), { fov: 24 })
    const { scene } = this.stage

    this.rail = createRail(this.railLength)
    this.rail.position.y = ROD_Y
    scene.add(this.rail)

    options.products.forEach((product, i) => {
      const spec = GARMENT_SPECS[product.garment]
      const garment = new HangingGarment(product, options.resolveImage(product), scene, { lift: 0.08 })
      const item: RackItem = {
        product,
        garment,
        slot: i,
        x: this.slotX(i),
        rest: REST_TURN + (seeded(i) - 0.5) * 0.12,
        phase: seeded(i + 40) * Math.PI * 2,
        open: 0,
        push: (spec.width * (1 + HOVER_SCALE) - SPACING) / 2 + 0.06,
        length: spec.drop + spec.height
      }
      garment.hanger.rotation.y = item.rest
      garment.hanger.position.set(item.x, ROD_Y, 0)
      scene.add(garment.hanger)
      this.items.push(item)
      this.order.push(i)
    })

    this.frame3D(this.stage)
    this.bind()
    this.start()
  }

  private slotX(slot: number) {
    return -this.span / 2 + slot * SPACING
  }

  /** Fit the whole rail on wide screens; on narrow screens zoom in and allow panning. */
  private frame3D(stage: Stage) {
    const { camera } = stage
    const top = ROD_Y + 0.1
    const bottom = ROD_Y - (GARMENT_SPECS.tee.drop + GARMENT_SPECS.tee.height) * (1 + HOVER_SCALE) - 0.04
    const fitH = (top - bottom) * 1.12
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
    el.style.userSelect = 'none'
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

  /** World-space point on the rail plane under the pointer. */
  private worldAt(clientX: number, clientY: number) {
    const rect = this.stage.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.stage.camera)
    return this.raycaster.ray.intersectPlane(this.plane, this.hit)
  }

  private pick(clientX: number, clientY: number): number | null {
    const point = this.worldAt(clientX, clientY)
    if (!point) return null
    const { x, y } = point
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

  private onPointerDown = (e: PointerEvent) => {
    const index = this.pick(e.clientX, e.clientY)
    this.press = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, index, startPan: this.panTarget, moved: false, timer: null }
    this.stage.renderer.domElement.setPointerCapture(e.pointerId)
    if (e.pointerType !== 'mouse') {
      // Touch: preview the piece under the finger; hold to pick it up.
      this.pointerIndex = index
      this.updateHover()
      if (index !== null) {
        this.press.timer = setTimeout(() => {
          if (this.press && !this.press.moved) {
            this.beginCarry(index, e.clientX, e.clientY)
            navigator.vibrate?.(8)
          }
        }, LONG_PRESS_MS)
      }
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    this.pointerInside = true
    const press = this.press
    if (press && e.pointerId === press.id) {
      const dx = e.clientX - press.x
      if (!press.moved && Math.hypot(dx, e.clientY - press.y) > DRAG_THRESHOLD) {
        press.moved = true
        if (press.timer) clearTimeout(press.timer)
        if (press.type === 'mouse' && press.index !== null && !this.carry) this.beginCarry(press.index, press.x, press.y)
      }
      if (this.carry) {
        this.moveCarry(e.clientX, e.clientY)
        return
      }
      if (press.moved && this.panLimit > 0) {
        const worldPerPx = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.stage.camera.fov) / 2)) / this.stage.size.height
        this.panTarget = THREE.MathUtils.clamp(press.startPan - dx * worldPerPx, -this.panLimit, this.panLimit)
      }
    }
    if (e.pointerType === 'mouse' && !this.carry) {
      this.pointerIndex = this.pick(e.clientX, e.clientY)
      this.updateHover()
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    const press = this.press
    if (!press || e.pointerId !== press.id) return
    if (press.timer) clearTimeout(press.timer)
    this.press = null
    if (this.carry) {
      this.endCarry()
    } else if (!press.moved) {
      const index = this.pick(e.clientX, e.clientY)
      if (index !== null) this.options.onSelect(index)
    }
    if (e.pointerType === 'mouse') {
      this.pointerIndex = this.pick(e.clientX, e.clientY)
      this.updateHover()
    } else {
      this.clearPointer()
    }
  }

  private onPointerCancel = () => {
    if (this.press?.timer) clearTimeout(this.press.timer)
    this.press = null
    if (this.carry) this.endCarry()
    this.clearPointer()
  }

  private onPointerLeave = (e: PointerEvent) => {
    this.pointerInside = false
    if (e.pointerType === 'mouse' && !this.carry) this.clearPointer()
  }

  private clearPointer() {
    this.pointerIndex = null
    this.updateHover()
  }

  /* ------------------------------------------------------- drag to reorder */

  private beginCarry(index: number, clientX: number, clientY: number) {
    const point = this.worldAt(clientX, clientY)
    const item = this.items[index]
    if (!point || !item) return
    this.carry = { index, offset: item.x - point.x, x: item.x }
    this.pointerIndex = index
    this.updateHover()
  }

  private moveCarry(clientX: number, clientY: number) {
    const carry = this.carry
    const point = this.worldAt(clientX, clientY)
    if (!carry || !point) return
    const limit = this.span / 2 + 0.2
    carry.x = THREE.MathUtils.clamp(point.x + carry.offset, -limit, limit)
    const slot = THREE.MathUtils.clamp(Math.round((carry.x + this.span / 2) / SPACING), 0, this.items.length - 1)
    const item = this.items[carry.index]!
    if (slot !== item.slot) {
      this.order.splice(item.slot, 1)
      this.order.splice(slot, 0, carry.index)
      this.order.forEach((itemIndex, s) => {
        this.items[itemIndex]!.slot = s
      })
    }
    // Keep panned views following the piece near the edges.
    if (this.panLimit > 0) this.panTarget = THREE.MathUtils.clamp(carry.x * 0.6, -this.panLimit, this.panLimit)
  }

  private endCarry() {
    this.carry = null
    this.options.onReorder?.([...this.order])
  }

  /* ------------------------------------------------------------- hovering */

  private updateHover() {
    const next = this.carry?.index ?? this.pointerIndex ?? (this.pointerInside ? null : this.keyboardIndex)
    const el = this.stage.renderer.domElement
    el.style.cursor = this.carry ? 'grabbing' : this.pointerIndex !== null ? 'pointer' : (this.panLimit > 0 ? 'grab' : 'default')
    if (next === this.hovered) return
    this.hovered = next
    this.options.onHover(next)
  }

  /** Keyboard focus from the accessible product list mirrors hover. */
  setFocus(index: number | null) {
    this.keyboardIndex = index
    if (index !== null) {
      const item = this.items[index]
      if (item) this.panTarget = THREE.MathUtils.clamp(this.slotX(item.slot), -this.panLimit, this.panLimit)
    }
    this.updateHover()
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
    const sway = this.reducedMotion ? 0 : 1

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!
      item.open = damp(item.open, this.hovered === i ? 1 : 0, speed, dt)
    }

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!
      const carried = this.carry?.index === i
      let targetX = this.slotX(item.slot)
      for (const other of this.items) {
        if (other === item) continue
        targetX += Math.sign(item.slot - other.slot) * other.push * other.open
      }
      if (carried) targetX = this.carry!.x
      item.x = damp(item.x, targetX, carried ? 24 : 11, dt)

      const e = item.open * item.open * (3 - 2 * item.open)
      const idle = sway * (1 - 0.8 * e)
      const hanger = item.garment.hanger
      hanger.position.set(item.x, ROD_Y, HOVER_FORWARD * e)
      hanger.rotation.set(
        HOVER_TILT * e,
        item.rest * (1 - e) + idle * 0.03 * Math.sin(t * 0.55 + item.phase * 1.3),
        idle * 0.01 * Math.sin(t * 0.9 + item.phase)
      )
      hanger.scale.setScalar(1 + HOVER_SCALE * e)

      // Hovered pieces firm up into their pressed shape; carried ones swing freely.
      const rigidity = carried ? 0.25 : 0.9 * e
      item.garment.update(dt, rigidity, sway)
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
    this.projected.set(item.x, ROD_Y - item.length * scale - 0.03, item.garment.hanger.position.z).project(this.stage.camera)
    const { width, height } = this.stage.size
    label.style.setProperty('--label-x', `${((this.projected.x * 0.5 + 0.5) * width).toFixed(1)}px`)
    label.style.setProperty('--label-y', `${((-this.projected.y * 0.5 + 0.5) * height).toFixed(1)}px`)
  }

  private render() {
    this.stage.renderer.render(this.stage.scene, this.stage.camera)
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    if (this.press?.timer) clearTimeout(this.press.timer)
    this.unbind()
    for (const item of this.items) item.garment.dispose()
    this.rail.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    this.stage.dispose()
  }
}
