import * as THREE from 'three'
import type { Product } from '~/data/products'
import { HangingGarment, type ResolveUrl } from './assets'
import { GARMENT_SPECS } from './garment'
import { createRail } from './hardware'
import { createStage, fitDistance, prefersReducedMotion, type Stage } from './stage'

const SPACING = 0.46
const ROD_Y = 0.62
/** Pieces hang side-on along the rail, like a real shop rack. */
const REST_TURN = 1.25
/** 9.81 m/s² in garment units (1 unit ≈ 0.74 m). */
const GRAVITY = 13.2
/** How far a hook rises to clear the rail when a piece is taken off. */
const LIFT = 0.08
/** How far towards the viewer a piece is held while it is carried. */
const CARRY_Z = 0.17
/** A presented piece is held out a little, bottom tipped towards the viewer. */
const PRESENT_TILT = -0.08
/** Hold time before a touch press picks a piece up instead of panning. */
const LONG_PRESS_MS = 320
const DRAG_THRESHOLD = 6
const SUBSTEP = 1 / 120

type Mode = 'rail' | 'carried' | 'returning'

interface RackItem {
  product: Product
  garment: HangingGarment
  slot: number
  mode: Mode
  /** Where the hook meets the rail (or the hand), and its velocity. */
  hook: THREE.Vector3
  velocity: THREE.Vector3
  acceleration: THREE.Vector3
  /** Turn about the vertical axis. */
  yaw: number
  yawVelocity: number
  /** Pendulum swing about the rail (x) and along it (z). */
  swingX: number
  swingXVelocity: number
  swingZ: number
  swingZVelocity: number
  rest: number
  phase: number
  /** 0 = side-on on the rail, 1 = turned to face the viewer. */
  open: number
  /** How far neighbours slide aside when this piece faces the viewer. */
  push: number
  /** Distance from hook to the garment's centre of mass, and its full length. */
  pendulum: number
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
  resolveUrl: ResolveUrl
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

/** Critically damped spring step (no overshoot): returns the acceleration. */
function spring(value: number, velocity: number, target: number, stiffness: number, damping = 1) {
  return stiffness * (target - value) - 2 * damping * Math.sqrt(stiffness) * velocity
}

const axisX = new THREE.Vector3(1, 0, 0)
const axisY = new THREE.Vector3(0, 1, 0)
const axisZ = new THREE.Vector3(0, 0, 1)
const qSwingZ = new THREE.Quaternion()
const qSwingX = new THREE.Quaternion()
const qYaw = new THREE.Quaternion()

export class RackController {
  private stage: Stage
  private items: RackItem[] = []
  private order: number[] = []
  private rail: THREE.Group
  private raycaster = new THREE.Raycaster()
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
  private panVelocity = 0
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
      const garment = new HangingGarment(product, options.resolveUrl, scene)
      const item: RackItem = {
        product,
        garment,
        slot: i,
        mode: 'rail',
        hook: new THREE.Vector3(this.slotX(i), ROD_Y, 0),
        velocity: new THREE.Vector3(),
        acceleration: new THREE.Vector3(),
        yaw: REST_TURN,
        yawVelocity: 0,
        swingX: 0,
        swingXVelocity: 0,
        swingZ: 0,
        swingZVelocity: 0,
        rest: REST_TURN + (seeded(i) - 0.5) * 0.12,
        phase: seeded(i + 40) * Math.PI * 2,
        open: 0,
        push: (spec.width - SPACING) / 2 + 0.05,
        pendulum: spec.drop + spec.height * 0.45,
        length: spec.drop + spec.height
      }
      item.yaw = item.rest
      this.pose(item)
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
    const top = ROD_Y + 0.12
    const bottom = ROD_Y - (GARMENT_SPECS.longsleeve.drop + GARMENT_SPECS.longsleeve.height) - 0.06
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

  /** World-space point under the pointer on a plane parallel to the rail. */
  private worldAt(clientX: number, clientY: number, depth = 0.05) {
    const rect = this.stage.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.stage.camera)
    return this.raycaster.ray.intersectPlane(new THREE.Plane(axisZ, -depth), this.hit)
  }

  private pick(clientX: number, clientY: number): number | null {
    const point = this.worldAt(clientX, clientY)
    if (!point) return null
    const { x, y } = point
    let best: number | null = null
    let bestScore = Infinity
    this.items.forEach((item, i) => {
      const reach = SPACING / 2 + item.push * item.open
      const dx = Math.abs(x - item.hook.x)
      if (dx > reach) return
      if (y > item.hook.y + 0.06 || y < item.hook.y - item.length - 0.04) return
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
      // Touch: preview the piece under the finger; hold to take it off the rail.
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

  /* ------------------------------------- take a piece off, carry it, hang it */

  private beginCarry(index: number, clientX: number, clientY: number) {
    const item = this.items[index]
    const point = this.worldAt(clientX, clientY, CARRY_Z)
    if (!item || !point) return
    item.mode = 'carried'
    this.carry = { index, offset: item.hook.x - point.x, x: item.hook.x }
    this.pointerIndex = index
    this.updateHover()
  }

  private moveCarry(clientX: number, clientY: number) {
    const carry = this.carry
    const point = this.worldAt(clientX, clientY, CARRY_Z)
    if (!carry || !point) return
    const limit = this.span / 2 + 0.25
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
    const carry = this.carry
    if (!carry) return
    this.items[carry.index]!.mode = 'returning'
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
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP))
    const h = dt / steps
    for (let s = 0; s < steps; s++) {
      this.time += h
      for (let i = 0; i < this.items.length; i++) this.simulate(this.items[i]!, i, h)
    }
    for (const item of this.items) {
      this.pose(item)
      // A piece held up to look at firms up; one being carried dangles freely.
      const rigidity = item.mode === 'carried' ? 0.1 : 0.4 * item.open
      item.garment.update(dt, rigidity, this.reducedMotion ? 0 : 1)
      if (item.garment.spec) {
        item.length = item.garment.spec.drop + item.garment.spec.height
        item.pendulum = item.garment.spec.drop + item.garment.spec.height * 0.45
      }
    }

    this.panVelocity += spring(this.pan, this.panVelocity, this.panTarget, 90) * dt
    this.pan += this.panVelocity * dt
    this.placeCamera()
    this.positionLabel()
  }

  /** One physics substep for a hanger: hook on springs, garment as a damped pendulum. */
  private simulate(item: RackItem, index: number, h: number) {
    const presented = this.hovered === index
    const view = Math.atan2(this.pan - item.hook.x, this.distance)

    // Where the hook wants to be.
    let tx = this.slotX(item.slot)
    for (const other of this.items) {
      if (other !== item) tx += Math.sign(item.slot - other.slot) * other.push * other.open
    }
    let ty = ROD_Y
    let tz = 0
    let k = 70
    if (item.mode === 'carried' && this.carry) {
      tx = this.carry.x
      ty = ROD_Y + LIFT
      tz = CARRY_Z
      k = 260
    } else if (item.mode === 'returning') {
      // Move over the slot first, then lower the hook back onto the rail.
      const away = Math.max(Math.abs(item.hook.x - tx), item.hook.z)
      ty = ROD_Y + LIFT * THREE.MathUtils.smoothstep(away, 0.012, 0.07)
      k = 110
      if (away < 0.004 && Math.abs(item.hook.y - ROD_Y) < 0.002) item.mode = 'rail'
    }

    const a = item.acceleration.set(
      spring(item.hook.x, item.velocity.x, tx, k),
      spring(item.hook.y, item.velocity.y, ty, item.mode === 'rail' ? 400 : k),
      spring(item.hook.z, item.velocity.z, tz, item.mode === 'rail' ? 400 : k)
    )
    item.velocity.addScaledVector(a, h)
    item.hook.addScaledVector(item.velocity, h)

    // Turning the hanger to face the viewer, like a hand would.
    const yawTarget = presented || item.mode !== 'rail' ? 0 : item.rest + view
    item.yawVelocity += spring(item.yaw, item.yawVelocity, yawTarget, 60, 0.95) * h
    item.yaw += item.yawVelocity * h
    item.open = THREE.MathUtils.clamp(1 - item.yaw / (item.rest + view), 0, 1)

    // Pendulum: gravity restores, air and the hook damp, the hook's motion drives it.
    const L = item.pendulum
    const w2 = GRAVITY / L
    const onRail = item.mode === 'rail'
    const idle = this.reducedMotion ? 0 : 1
    const t = this.time
    const breeze = idle * (Math.sin(t * 0.31 + item.phase) + 0.6 * Math.sin(t * 0.73 + item.phase * 2.1))
    const tilt = presented && onRail ? PRESENT_TILT * item.open : 0
    // About the rail: the hook rolls freely on the rod.
    const dampX = 2 * 0.16 * Math.sqrt(w2)
    const accX = -w2 * (Math.sin(item.swingX) - Math.sin(tilt)) - dampX * item.swingXVelocity
      + (a.z / L) * Math.cos(item.swingX) + 0.08 * breeze
    // Along the rail: on the rod the hook resists rocking; in the hand it swings freely.
    const stiffZ = onRail ? 2.2 : 1
    const dampZ = 2 * (onRail ? 0.3 : 0.12) * Math.sqrt(w2 * stiffZ)
    const accZ = -w2 * stiffZ * Math.sin(item.swingZ) - dampZ * item.swingZVelocity
      - (a.x / L) * Math.cos(item.swingZ) + 0.05 * breeze
    item.swingXVelocity += accX * h
    item.swingX += item.swingXVelocity * h
    item.swingZVelocity += accZ * h
    item.swingZ += item.swingZVelocity * h
  }

  private pose(item: RackItem) {
    const hanger = item.garment.hanger
    hanger.position.copy(item.hook)
    qSwingZ.setFromAxisAngle(axisZ, item.swingZ)
    qSwingX.setFromAxisAngle(axisX, item.swingX)
    qYaw.setFromAxisAngle(axisY, item.yaw)
    hanger.quaternion.copy(qSwingZ).multiply(qSwingX).multiply(qYaw)
  }

  private positionLabel() {
    const label = this.options.label
    if (!label || this.hovered === null) return
    const item = this.items[this.hovered]
    if (!item) return
    this.projected.set(item.hook.x, item.hook.y - item.length - 0.03, item.hook.z).project(this.stage.camera)
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
