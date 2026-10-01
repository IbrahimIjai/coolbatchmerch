import * as THREE from 'three'
import type { Product } from '~/data/products'
import { HangingGarment } from './assets'
import { GARMENT_SPECS } from './garment'
import { createStage, damp, fitDistance, prefersReducedMotion, type Stage } from './stage'

const TRAVEL = 2.8
const FRAME_HEIGHT = 1.62
const FRAME_WIDTH = 1.5
const TWIRL_SECONDS = 1.9
const TAU = Math.PI * 2

interface Actor {
  garment: HangingGarment
  holder: THREE.Group
  x: number
  targetX: number
  spin: number
  phase: number
  leaving: boolean
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Presents one piece at a time, large and front-facing on its hanger.
 *
 * - Opening (or clicking the piece) gives it a full 360° twirl on the hanger;
 *   the cloth simulation makes the fabric swing out and settle.
 * - Dragging spins it freely with momentum, then it eases to face front.
 * - Changing product slides the current piece out and the next one in.
 */
export class ViewerController {
  private stage: Stage
  private actors: Actor[] = []
  private current: Actor | null = null
  private frame = 0
  private last = 0
  private time = 0
  private reducedMotion = prefersReducedMotion()

  /** Spin the user controls (radians); eases to the nearest front-facing turn. */
  private spin = 0
  private spinTarget = 0
  private velocity = 0
  private twirl: { from: number, elapsed: number } | null = null
  private drag: { id: number, x: number, lastX: number, lastT: number, start: number, moved: boolean } | null = null

  constructor(private container: HTMLElement, private products: Product[], private resolveImage: (p: Product) => string, index: number) {
    this.stage = createStage(container, stage => this.frame3D(stage))
    this.show(index, 0)
    this.bind()
    this.start()
  }

  private frame3D(stage: Stage) {
    const { camera } = stage
    const distance = fitDistance(camera, FRAME_WIDTH, FRAME_HEIGHT)
    camera.position.set(0, 0.02, distance)
    camera.lookAt(0, 0, 0)
  }

  show(index: number, direction: -1 | 0 | 1) {
    const product = this.products[index]
    if (!product) return
    if (this.current) {
      this.current.leaving = true
      this.current.targetX = -direction * TRAVEL
      if (direction === 0) this.remove(this.current)
    }

    const spec = GARMENT_SPECS[product.garment]
    // Shorts are presented a little larger so both garment types read at a similar size.
    const presentScale = product.garment === 'shorts' ? 1.3 : 1
    const totalHeight = (spec.drop + spec.height + 0.04) * presentScale

    const holder = new THREE.Group()
    const garment = new HangingGarment(product, this.resolveImage(product), this.stage.scene)
    garment.hanger.scale.setScalar(presentScale)
    garment.hanger.position.y = totalHeight / 2 - 0.04 * presentScale
    holder.add(garment.hanger)

    const actor: Actor = {
      garment,
      holder,
      x: direction * TRAVEL,
      targetX: 0,
      spin: direction * 0.9,
      phase: Math.random() * TAU,
      leaving: false
    }
    holder.position.x = actor.x
    this.stage.scene.add(holder)
    this.actors.push(actor)
    this.current = actor
    this.spin = this.spinTarget = 0
    this.velocity = 0
    if (direction === 0) this.startTwirl()
  }

  /** One full turn on the hanger, eased in and out. */
  startTwirl() {
    if (this.reducedMotion) return
    if (this.current) this.spin = this.current.spin
    this.twirl = { from: this.spin, elapsed: 0 }
  }

  private remove(actor: Actor) {
    this.stage.scene.remove(actor.holder)
    actor.garment.dispose()
    this.actors = this.actors.filter(a => a !== actor)
  }

  /* --------------------------------------------------------------- input */

  private bind() {
    const el = this.stage.renderer.domElement
    el.style.touchAction = 'pan-y'
    el.style.cursor = 'grab'
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointercancel', this.onUp)
  }

  private onDown = (e: PointerEvent) => {
    this.twirl = null
    if (this.current) this.spin = this.current.spin
    this.drag = { id: e.pointerId, x: e.clientX, lastX: e.clientX, lastT: performance.now(), start: this.spin, moved: false }
    this.velocity = 0
    this.stage.renderer.domElement.setPointerCapture(e.pointerId)
    this.stage.renderer.domElement.style.cursor = 'grabbing'
  }

  private onMove = (e: PointerEvent) => {
    const drag = this.drag
    if (!drag || e.pointerId !== drag.id) return
    if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true
    const now = performance.now()
    const dt = Math.max(1, now - drag.lastT) / 1000
    this.velocity = THREE.MathUtils.lerp(this.velocity, ((e.clientX - drag.lastX) * 0.011) / dt, 0.5)
    drag.lastX = e.clientX
    drag.lastT = now
    this.spinTarget = this.spin = drag.start + (e.clientX - drag.x) * 0.011
  }

  private onUp = (e: PointerEvent) => {
    const drag = this.drag
    if (!drag || e.pointerId !== drag.id) return
    this.drag = null
    this.stage.renderer.domElement.style.cursor = 'grab'
    if (!drag.moved) {
      this.startTwirl()
      return
    }
    // Throw with momentum, then come to rest facing front.
    const projected = this.spin + this.velocity * 0.45
    this.spinTarget = Math.round(projected / TAU) * TAU
  }

  /* ---------------------------------------------------------------- loop */

  private start() {
    this.last = performance.now()
    const loop = (now: number) => {
      this.frame = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      this.update(dt)
      this.stage.renderer.render(this.stage.scene, this.stage.camera)
    }
    this.frame = requestAnimationFrame(loop)
  }

  private update(dt: number) {
    this.time += dt
    const sway = this.reducedMotion ? 0 : 1
    const speed = this.reducedMotion ? 30 : 7

    if (this.twirl) {
      this.twirl.elapsed += dt
      const t = Math.min(1, this.twirl.elapsed / TWIRL_SECONDS)
      this.spin = this.spinTarget = this.twirl.from + easeInOutCubic(t) * TAU
      if (t >= 1) this.twirl = null
    } else if (!this.drag) {
      this.spin = damp(this.spin, this.spinTarget, 4.5, dt)
    }
    const spinning = this.twirl !== null || this.drag !== null || Math.abs(this.spin - this.spinTarget) > 0.02

    for (const actor of [...this.actors]) {
      actor.x = damp(actor.x, actor.targetX, speed, dt)
      const goal = actor.leaving ? -Math.sign(actor.targetX) * 0.9 : (actor === this.current ? this.spin : 0)
      const direct = actor === this.current && (this.twirl !== null || this.drag !== null)
      actor.spin = direct ? goal : damp(actor.spin, goal, speed, dt)
      actor.holder.position.x = actor.x
      actor.garment.hanger.rotation.set(
        0,
        actor.spin + sway * 0.05 * Math.sin(this.time * 0.6 + actor.phase),
        sway * 0.01 * Math.sin(this.time * 0.85 + actor.phase)
      )
      // Firm for presentation, looser while spinning so the fabric flares.
      actor.garment.update(dt, spinning && actor === this.current ? 0.12 : 0.45, sway * 0.6)
      if (actor.leaving && Math.abs(actor.x - actor.targetX) < 0.02) this.remove(actor)
    }
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    const el = this.stage.renderer.domElement
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointercancel', this.onUp)
    for (const actor of this.actors) actor.garment.dispose()
    this.stage.dispose()
  }
}
