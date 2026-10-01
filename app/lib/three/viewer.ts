import * as THREE from 'three'
import type { Product } from '~/data/products'
import { createHangingGarment } from './assets'
import { GARMENT_SPECS } from './garment'
import { createStage, damp, fitDistance, prefersReducedMotion, type Stage } from './stage'

const TRAVEL = 2.8
const FRAME_HEIGHT = 1.62
const FRAME_WIDTH = 1.5

interface Actor {
  group: THREE.Group
  holder: THREE.Group
  x: number
  targetX: number
  spin: number
  phase: number
  leaving: boolean
}

/**
 * Presents one piece at a time, large and front-facing on its hanger.
 * Changing product slides the current piece out and the next one in; dragging
 * turns the piece to show its side, and it settles back to the front on release.
 */
export class ViewerController {
  private stage: Stage
  private actors: Actor[] = []
  private current: Actor | null = null
  private frame = 0
  private last = 0
  private time = 0
  private spinTarget = 0
  private drag: { id: number, x: number, start: number } | null = null
  private reducedMotion = prefersReducedMotion()

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
      this.current.targetX = direction === 0 ? 0 : -direction * TRAVEL
      if (direction === 0) this.remove(this.current)
    }

    const spec = GARMENT_SPECS[product.garment]
    // Shorts are presented a little larger so both garment types read at a similar size.
    const presentScale = product.garment === 'shorts' ? 1.3 : 1
    const totalHeight = (spec.drop + spec.height + 0.04) * presentScale

    const holder = new THREE.Group()
    const group = createHangingGarment(product, this.resolveImage(product))
    group.scale.setScalar(presentScale)
    group.position.y = totalHeight / 2 - 0.04 * presentScale
    holder.add(group)

    const actor: Actor = {
      group,
      holder,
      x: direction * TRAVEL,
      targetX: 0,
      spin: direction * 0.9,
      phase: Math.random() * Math.PI * 2,
      leaving: false
    }
    holder.position.x = actor.x
    this.stage.scene.add(holder)
    this.actors.push(actor)
    this.current = actor
    this.spinTarget = 0
  }

  private remove(actor: Actor) {
    this.stage.scene.remove(actor.holder)
    this.actors = this.actors.filter(a => a !== actor)
  }

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
    this.drag = { id: e.pointerId, x: e.clientX, start: this.spinTarget }
    this.stage.renderer.domElement.setPointerCapture(e.pointerId)
    this.stage.renderer.domElement.style.cursor = 'grabbing'
  }

  private onMove = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return
    this.spinTarget = THREE.MathUtils.clamp(this.drag.start + (e.clientX - this.drag.x) * 0.008, -1.4, 1.4)
  }

  private onUp = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return
    this.drag = null
    this.spinTarget = 0
    this.stage.renderer.domElement.style.cursor = 'grab'
  }

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
    for (const actor of [...this.actors]) {
      actor.x = damp(actor.x, actor.targetX, speed, dt)
      const spinGoal = actor.leaving ? -Math.sign(actor.targetX) * 0.9 : this.spinTarget
      actor.spin = damp(actor.spin, spinGoal, actor === this.current && this.drag ? 14 : speed, dt)
      actor.holder.position.x = actor.x
      actor.group.rotation.set(
        0,
        actor.spin + sway * 0.06 * Math.sin(this.time * 0.6 + actor.phase),
        sway * 0.01 * Math.sin(this.time * 0.85 + actor.phase)
      )
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
    this.stage.dispose()
  }
}
