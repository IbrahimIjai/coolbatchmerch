import * as THREE from 'three'
import type { GarmentKind, Product } from '~/data/products'
import { clothGrid } from './cloth'

/**
 * Garments are built in "garment space": x is centred, y = 0 is the top edge
 * (collar / waistband) and the garment hangs downwards into negative y.
 * One unit is roughly 55cm, so a tee is about a metre across the sleeves.
 */
export interface GarmentSpec {
  width: number
  height: number
  /** Where the garment's top edge sits below the rod centre. */
  drop: number
  /** Half-thickness of the fabric where the hanger fills the shoulders. */
  thickness: number
  /** Half-width of the body panel (sleeves start outside it). */
  body: number
  /** Shoulder span supported by the hanger. */
  shoulder: number
}

export const GARMENT_SPECS: Record<GarmentKind, GarmentSpec> = {
  tee: { width: 1.04, height: 1.07, drop: 0.172, thickness: 0.026, body: 0.34, shoulder: 0.34 },
  longsleeve: { width: 1.04, height: 1.07, drop: 0.172, thickness: 0.026, body: 0.345, shoulder: 0.34 },
  crewneck: { width: 1.08, height: 1.01, drop: 0.172, thickness: 0.034, body: 0.365, shoulder: 0.35 },
  shorts: { width: 0.8, height: 0.62, drop: 0.176, thickness: 0.026, body: 0.4, shoulder: 0.3 }
}

/** Garments that hang from the shoulders on a wooden hanger. */
export const isTop = (kind: GarmentKind) => kind !== 'shorts'

const TEXTURE_WIDTH = 1024

/* --------------------------------------------------------------- outlines */

type Point = [number, number]
type Segment = { to: Point, c?: Point }
interface Outline { start: Point, right: Segment[] }

type PathSink = Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath'>

/*
 * Each outline is the right half, traced clockwise from the top centre down to
 * the bottom centre. The left half is mirrored automatically.
 */
const OUTLINES: Record<GarmentKind, Outline> = {
  tee: {
    start: [0, -0.032],
    right: [
      { c: [0.07, -0.032], to: [0.125, 0] },
      { c: [0.24, -0.022], to: [0.355, -0.062] },
      { c: [0.45, -0.13], to: [0.52, -0.262] },
      { to: [0.442, -0.352] },
      { c: [0.38, -0.305], to: [0.338, -0.295] },
      { c: [0.34, -0.7], to: [0.35, -1.045] },
      { c: [0.18, -1.066], to: [0, -1.065] }
    ]
  },
  longsleeve: {
    start: [0, -0.032],
    right: [
      { c: [0.07, -0.032], to: [0.125, 0] },
      { c: [0.24, -0.022], to: [0.355, -0.062] },
      { c: [0.47, -0.12], to: [0.49, -0.42] },
      { to: [0.503, -0.93] },
      { to: [0.505, -0.985] },
      { to: [0.418, -0.99] },
      { to: [0.413, -0.93] },
      { c: [0.405, -0.55], to: [0.372, -0.31] },
      { to: [0.345, -0.33] },
      { c: [0.338, -0.7], to: [0.35, -1.045] },
      { c: [0.18, -1.066], to: [0, -1.065] }
    ]
  },
  crewneck: {
    start: [0, -0.034],
    right: [
      { c: [0.075, -0.034], to: [0.13, 0] },
      { c: [0.25, -0.024], to: [0.37, -0.07] },
      { c: [0.5, -0.13], to: [0.515, -0.42] },
      { to: [0.53, -0.87] },
      { to: [0.506, -0.885] },
      { to: [0.502, -0.95] },
      { to: [0.428, -0.952] },
      { to: [0.422, -0.885] },
      { to: [0.405, -0.87] },
      { c: [0.412, -0.55], to: [0.395, -0.32] },
      { to: [0.365, -0.34] },
      { c: [0.36, -0.7], to: [0.37, -0.93] },
      { to: [0.346, -0.94] },
      { to: [0.346, -1.004] },
      { to: [0, -1.006] }
    ]
  },
  shorts: {
    start: [0, 0],
    right: [
      { to: [0.33, 0] },
      { to: [0.34, -0.065] },
      { c: [0.385, -0.3], to: [0.4, -0.59] },
      { to: [0.392, -0.612] },
      { c: [0.2, -0.6], to: [0.035, -0.59] },
      { c: [0.02, -0.42], to: [0, -0.36] }
    ]
  }
}

function traceOutline(p: PathSink, kind: GarmentKind) {
  const { start, right } = OUTLINES[kind]
  p.moveTo(start[0], start[1])
  for (const s of right) {
    if (s.c) p.quadraticCurveTo(s.c[0], s.c[1], s.to[0], s.to[1])
    else p.lineTo(s.to[0], s.to[1])
  }
  // Mirror back up the left side, reversing each segment.
  for (let i = right.length - 1; i >= 0; i--) {
    const s = right[i]!
    const from = i === 0 ? start : right[i - 1]!.to
    if (s.c) p.quadraticCurveTo(-s.c[0], s.c[1], -from[0], from[1])
    else p.lineTo(-from[0], from[1])
  }
  p.closePath()
}

/* ------------------------------------------------------------------ colour */

function lightness(hex: string) {
  return new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l
}

function shade(hex: string, amount: number) {
  const c = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  // Light fabrics darken for seams; dark fabrics lift slightly instead.
  const l = hsl.l > 0.18 ? hsl.l * amount : Math.min(1, hsl.l + (1 - amount) * 0.35)
  c.setHSL(hsl.h, hsl.s, l)
  return `#${c.getHexString()}`
}

function stitchColor(hex: string) {
  return lightness(hex) > 0.5 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.16)'
}

/* ------------------------------------------------------------------ canvas */

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

function createCanvas(spec: GarmentSpec) {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_WIDTH
  canvas.height = Math.round(TEXTURE_WIDTH * spec.height / spec.width)
  return canvas
}

/** Maps garment space to canvas pixels so paths and line widths are in garment units. */
function useGarmentSpace(ctx: CanvasRenderingContext2D, spec: GarmentSpec) {
  const s = ctx.canvas.width / spec.width
  ctx.setTransform(s, 0, 0, -s, (spec.width / 2) * s, 0)
}

function toPixels(ctx: CanvasRenderingContext2D, spec: GarmentSpec, x0: number, y0: number, x1: number, y1: number) {
  const s = ctx.canvas.width / spec.width
  return { x: (x0 + spec.width / 2) * s, y: -y0 * s, w: (x1 - x0) * s, h: (y0 - y1) * s }
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

function stroke(ctx: CanvasRenderingContext2D, color: string, width: number, draw: () => void, dash?: number[]) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  if (dash) ctx.setLineDash(dash)
  ctx.beginPath()
  draw()
  ctx.stroke()
  ctx.restore()
}

const STITCH = [0.011, 0.007]

/** Both halves: calls `draw` for the right side and again mirrored. */
function mirrored(ctx: CanvasRenderingContext2D, draw: () => void) {
  draw()
  ctx.save()
  ctx.scale(-1, 1)
  draw()
  ctx.restore()
}

function drawCollar(ctx: CanvasRenderingContext2D, color: string, side: 'front' | 'back', heavy: boolean) {
  const outer = heavy ? 0.13 : 0.125
  if (side === 'front') {
    // The inside of the back panel, seen through the neck opening.
    ctx.save()
    ctx.fillStyle = shade(color, 0.7)
    ctx.beginPath()
    ctx.moveTo(-outer, 0)
    ctx.quadraticCurveTo(-0.07, -0.032, 0, -0.032)
    ctx.quadraticCurveTo(0.07, -0.032, outer, 0)
    ctx.bezierCurveTo(outer - 0.01, -0.07, 0.06, -0.092, 0, -0.092)
    ctx.bezierCurveTo(-0.06, -0.092, -(outer - 0.01), -0.07, -outer, 0)
    ctx.fill()
    ctx.restore()
    stroke(ctx, shade(color, 0.9), heavy ? 0.042 : 0.03, () => {
      ctx.moveTo(-outer, 0)
      ctx.bezierCurveTo(-(outer - 0.01), -0.07, -0.06, -0.092, 0, -0.092)
      ctx.bezierCurveTo(0.06, -0.092, outer - 0.01, -0.07, outer, 0)
    })
    stroke(ctx, 'rgba(0,0,0,0.12)', 0.003, () => {
      const o = heavy ? 0.022 : 0.016
      ctx.moveTo(-(outer + o), 0)
      ctx.bezierCurveTo(-(outer + o - 0.012), -0.085 - o * 0.5, -0.07, -0.092 - o, 0, -0.092 - o)
      ctx.bezierCurveTo(0.07, -0.092 - o, outer + o - 0.012, -0.085 - o * 0.5, outer + o, 0)
    })
  } else {
    stroke(ctx, shade(color, 0.9), heavy ? 0.034 : 0.024, () => {
      ctx.moveTo(-outer, 0)
      ctx.quadraticCurveTo(-0.07, -0.032, 0, -0.032)
      ctx.quadraticCurveTo(0.07, -0.032, outer, 0)
    })
  }
}

/** Vertical ribbing inside a band (cuffs, waistbands on sweatshirts). */
function ribBand(ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number, color: string) {
  ctx.save()
  ctx.fillStyle = shade(color, 0.93)
  ctx.fillRect(x0, y1, x1 - x0, y0 - y1)
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'
  ctx.lineWidth = 0.0028
  ctx.beginPath()
  for (let x = x0 + 0.006; x < x1; x += 0.011) {
    ctx.moveTo(x, y0 - 0.004)
    ctx.lineTo(x, y1 + 0.004)
  }
  ctx.stroke()
  ctx.restore()
}

function drawTopDetails(ctx: CanvasRenderingContext2D, kind: GarmentKind, color: string, side: 'front' | 'back') {
  const stitches = stitchColor(color)
  drawCollar(ctx, color, side, kind === 'crewneck')

  if (kind === 'tee') {
    mirrored(ctx, () => {
      stroke(ctx, 'rgba(0,0,0,0.1)', 0.004, () => {
        ctx.moveTo(0.355, -0.062)
        ctx.quadraticCurveTo(0.31, -0.17, 0.338, -0.295)
      })
      stroke(ctx, stitches, 0.0032, () => {
        ctx.moveTo(0.497, -0.243)
        ctx.lineTo(0.42, -0.333)
      }, STITCH)
    })
    stroke(ctx, stitches, 0.0032, () => {
      ctx.moveTo(-0.35, -1.012)
      ctx.quadraticCurveTo(0, -1.035, 0.35, -1.012)
    }, STITCH)
  } else if (kind === 'longsleeve') {
    mirrored(ctx, () => {
      stroke(ctx, 'rgba(0,0,0,0.1)', 0.004, () => {
        ctx.moveTo(0.355, -0.062)
        ctx.quadraticCurveTo(0.33, -0.18, 0.36, -0.315)
      })
      stroke(ctx, stitches, 0.0032, () => {
        ctx.moveTo(0.5, -0.93)
        ctx.lineTo(0.414, -0.93)
      }, STITCH)
    })
    stroke(ctx, stitches, 0.0032, () => {
      ctx.moveTo(-0.35, -1.012)
      ctx.quadraticCurveTo(0, -1.035, 0.35, -1.012)
    }, STITCH)
  } else if (kind === 'crewneck') {
    mirrored(ctx, () => {
      stroke(ctx, 'rgba(0,0,0,0.12)', 0.005, () => {
        ctx.moveTo(0.37, -0.07)
        ctx.quadraticCurveTo(0.35, -0.2, 0.38, -0.33)
      })
      ribBand(ctx, 0.42, 0.508, -0.885, -0.952, color)
    })
    ribBand(ctx, -0.35, 0.35, -0.94, -1.01, color)
    if (side === 'front') {
      // Classic sweatshirt V-insert under the collar.
      stroke(ctx, 'rgba(0,0,0,0.1)', 0.004, () => {
        ctx.moveTo(-0.03, -0.11)
        ctx.lineTo(0, -0.15)
        ctx.lineTo(0.03, -0.11)
      })
    }
  }
}

function drawShortsDetails(ctx: CanvasRenderingContext2D, color: string, side: 'front' | 'back') {
  const stitches = stitchColor(color)
  ctx.save()
  ctx.fillStyle = shade(color, 0.93)
  ctx.fillRect(-0.34, -0.066, 0.68, 0.066)
  ctx.restore()
  stroke(ctx, stitches, 0.0032, () => {
    ctx.moveTo(-0.338, -0.07)
    ctx.lineTo(0.338, -0.07)
  }, STITCH)
  if (side === 'front') {
    const cord = lightness(color) > 0.5 ? '#2b2b2b' : '#f1ece0'
    stroke(ctx, cord, 0.009, () => {
      ctx.moveTo(-0.022, -0.036)
      ctx.bezierCurveTo(-0.03, -0.09, -0.05, -0.12, -0.04, -0.18)
      ctx.moveTo(0.022, -0.036)
      ctx.bezierCurveTo(0.03, -0.09, 0.02, -0.14, 0.034, -0.195)
    })
    stroke(ctx, stitches, 0.0032, () => {
      ctx.moveTo(0.032, -0.072)
      ctx.lineTo(0.032, -0.25)
      ctx.quadraticCurveTo(0.03, -0.3, 0.004, -0.31)
    }, STITCH)
  }
  stroke(ctx, stitches, 0.0032, () => {
    ctx.moveTo(0.04, -0.562)
    ctx.quadraticCurveTo(0.2, -0.572, 0.39, -0.583)
    ctx.moveTo(-0.04, -0.562)
    ctx.quadraticCurveTo(-0.2, -0.572, -0.39, -0.583)
  }, STITCH)
}

/**
 * Soft baked shading that a photographed garment would have: the sides
 * turning away, drag lines from the hanger tips, creases at the armpits,
 * a shadow under the collar and gentle vertical folds towards the hem.
 */
function drawShading(ctx: CanvasRenderingContext2D, spec: GarmentSpec, kind: GarmentKind, color: string, seed: number) {
  const px = ctx.canvas.width / spec.width
  const dark = lightness(color) < 0.2
  const shadow = dark ? 'rgba(0,0,0,0.35)' : 'rgba(20,16,10,0.16)'
  const light = dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.22)'
  const b = spec.body

  ctx.save()
  // Sides falling away from the light.
  const side = ctx.createLinearGradient(-b, 0, b, 0)
  side.addColorStop(0, shadow)
  side.addColorStop(0.16, 'rgba(0,0,0,0)')
  side.addColorStop(0.8, 'rgba(0,0,0,0)')
  side.addColorStop(1, shadow)
  ctx.globalAlpha = 0.75
  ctx.fillStyle = side
  ctx.fillRect(-b - 0.01, -spec.height, 2 * b + 0.02, spec.height)
  ctx.globalAlpha = 1

  if (kind === 'shorts') {
    ctx.restore()
    return
  }

  ctx.filter = `blur(${Math.round(0.012 * px)}px)`
  // Drag lines from the hanger tips towards the chest and armpits.
  mirrored(ctx, () => {
    stroke(ctx, shadow, 0.018, () => {
      ctx.moveTo(spec.shoulder - 0.02, -0.07)
      ctx.quadraticCurveTo(spec.shoulder - 0.06, -0.2, b - 0.03, -0.33)
    })
    stroke(ctx, light, 0.014, () => {
      ctx.moveTo(spec.shoulder - 0.05, -0.06)
      ctx.quadraticCurveTo(0.22, -0.16, 0.18, -0.3)
    })
    stroke(ctx, shadow, 0.012, () => {
      ctx.moveTo(spec.shoulder - 0.08, -0.065)
      ctx.quadraticCurveTo(0.2, -0.13, 0.13, -0.2)
    })
  })
  // Under-collar shadow.
  stroke(ctx, shadow, 0.02, () => {
    ctx.moveTo(-0.14, -0.04)
    ctx.bezierCurveTo(-0.12, -0.11, 0.12, -0.11, 0.14, -0.04)
  })
  // Vertical folds that deepen towards the hem.
  const rand = (n: number) => {
    const x = Math.sin((seed + n) * 91.7) * 43758.5453
    return x - Math.floor(x)
  }
  for (let i = 0; i < 5; i++) {
    const x = (rand(i) - 0.5) * 1.3 * b
    const top = -0.38 - rand(i + 9) * 0.25
    stroke(ctx, i % 2 ? light : shadow, 0.012 + rand(i + 3) * 0.012, () => {
      ctx.moveTo(x, top)
      ctx.quadraticCurveTo(x + (rand(i + 5) - 0.5) * 0.06, (top - spec.height) / 2, x + (rand(i + 7) - 0.5) * 0.05, -spec.height)
    })
  }
  ctx.restore()
}

/** Small screen-printed label under the back collar. */
function drawBackNeckPrint(ctx: CanvasRenderingContext2D, spec: GarmentSpec, product: Product) {
  const ink = lightness(product.color) > 0.5 ? 'rgba(39,48,79,0.85)' : 'rgba(241,236,224,0.9)'
  const s = ctx.canvas.width / spec.width
  const top = isTop(product.garment) ? 0.075 : 0.105
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const cx = ctx.canvas.width / 2
  ctx.font = `600 ${Math.round(0.03 * s)}px "Instrument Sans", system-ui, sans-serif`
  ctx.letterSpacing = `${Math.round(0.006 * s)}px`
  ctx.fillText('NAIJA THREADS', cx, top * s)
  ctx.font = `500 ${Math.round(0.019 * s)}px "Instrument Sans", system-ui, sans-serif`
  ctx.fillText('NIGERIA @ 66 · 1960—2026', cx, (top + 0.042) * s)
  ctx.restore()
}

/** Text printed down the wearer's left sleeve (viewer's right). */
function drawSleevePrint(ctx: CanvasRenderingContext2D, spec: GarmentSpec, product: Product) {
  if (!product.sleeve) return
  const ink = lightness(product.color) > 0.5 ? 'rgba(39,48,79,0.9)' : 'rgba(241,236,224,0.92)'
  const s = ctx.canvas.width / spec.width
  const p = toPixels(ctx, spec, 0.458, -0.6, 0.458, -0.6)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.translate(p.x, p.y)
  ctx.rotate(Math.PI / 2 - 0.02)
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${Math.round(0.03 * s)}px "Instrument Sans", system-ui, sans-serif`
  ctx.letterSpacing = `${Math.round(0.008 * s)}px`
  ctx.fillText(product.sleeve.toUpperCase(), 0, 0)
  ctx.restore()
}

async function loadImage(src: string) {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  await img.decode()
  return img
}

/** Crops transparent margins from a mockup photo so its garment fills the frame. */
function trimTransparent(img: HTMLImageElement) {
  const probe = document.createElement('canvas')
  const scale = Math.min(1, 256 / Math.max(img.width, img.height))
  probe.width = Math.max(1, Math.round(img.width * scale))
  probe.height = Math.max(1, Math.round(img.height * scale))
  const ctx = probe.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, probe.width, probe.height)
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height)
  let minX = probe.width, minY = probe.height, maxX = -1, maxY = -1
  let r = 0, g = 0, b = 0, n = 0
  for (let y = 0; y < probe.height; y++) {
    for (let x = 0; x < probe.width; x++) {
      const i = (y * probe.width + x) * 4
      if (data[i + 3]! > 24) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        r += data[i]!
        g += data[i + 1]!
        b += data[i + 2]!
        n++
      }
    }
  }
  if (maxX < 0) return { sx: 0, sy: 0, sw: img.width, sh: img.height, average: '#cccccc' }
  const toHex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
  return {
    sx: minX / scale,
    sy: minY / scale,
    sw: (maxX - minX + 1) / scale,
    sh: (maxY - minY + 1) / scale,
    average: `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }
}

export interface GarmentCanvases {
  spec: GarmentSpec
  front: HTMLCanvasElement
  back: HTMLCanvasElement
}

function hashSeed(id: string) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

/**
 * Paints the front and back panels of a garment. The canvas alpha is the
 * garment silhouette, which the mesh builder later turns into 3D.
 */
export async function paintGarment(product: Product, imageUrl: string): Promise<GarmentCanvases> {
  const base = GARMENT_SPECS[product.garment]
  const [img] = await Promise.all([
    loadImage(imageUrl).catch(() => null),
    document.fonts?.load('600 32px "Instrument Sans"').catch(() => null)
  ])

  if (product.placement === 'mockup' && img) {
    const crop = trimTransparent(img)
    const spec: GarmentSpec = { ...base, height: base.width * crop.sh / crop.sw }
    const front = createCanvas(spec)
    const back = createCanvas(spec)
    const fctx = front.getContext('2d')!
    fctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, front.width, front.height)
    const bctx = back.getContext('2d')!
    // The back panel is painted as seen from behind, i.e. mirrored.
    bctx.setTransform(-1, 0, 0, 1, back.width, 0)
    bctx.drawImage(front, 0, 0)
    bctx.setTransform(1, 0, 0, 1, 0, 0)
    bctx.globalCompositeOperation = 'source-in'
    bctx.fillStyle = crop.average
    bctx.fillRect(0, 0, back.width, back.height)
    return { spec, front, back }
  }

  const spec = base
  const kind = product.garment
  const seed = hashSeed(product.id)
  const paint = (canvas: HTMLCanvasElement, side: 'front' | 'back') => {
    const ctx = canvas.getContext('2d')!
    useGarmentSpace(ctx, spec)
    ctx.beginPath()
    traceOutline(ctx, kind)
    ctx.clip()
    ctx.fillStyle = product.color
    ctx.fillRect(-spec.width, -spec.height * 2, spec.width * 2, spec.height * 3)

    const allOver = product.placement === 'full' && img
    if (allOver) {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      drawCover(ctx, img)
      ctx.restore()
    }

    if (isTop(kind)) drawTopDetails(ctx, kind, product.color, side)
    else drawShortsDetails(ctx, product.color, side)

    if (side === 'back') {
      drawBackNeckPrint(ctx, spec, product)
    } else {
      if (isTop(kind)) drawSleevePrint(ctx, spec, product)
      if (img && !allOver) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        if (product.placement === 'leg') {
          // Wearer's right leg = viewer's left.
          drawContain(ctx, img, toPixels(ctx, spec, -0.335, -0.4, -0.185, -0.55))
        } else if (product.placement === 'pocket') {
          // Wearer's left chest = viewer's right.
          drawContain(ctx, img, toPixels(ctx, spec, 0.08, -0.16, 0.24, -0.32))
        } else {
          const top = kind === 'shorts' ? -0.12 : -0.17
          const size = kind === 'shorts' ? 0.3 : kind === 'crewneck' ? 0.5 : 0.46
          drawContain(ctx, img, toPixels(ctx, spec, -size / 2, top, size / 2, top - size))
        }
        ctx.restore()
      }
    }
    drawShading(ctx, spec, kind, product.color, side === 'front' ? seed : seed + 0.5)
    applyGrain(ctx)
  }

  const front = createCanvas(spec)
  const back = createCanvas(spec)
  paint(front, 'front')
  paint(back, 'back')
  return { spec, front, back }
}

/* -------------------------------------------------------------- geometry */

const MASK_WIDTH = 192

/** Approximate Euclidean distance (in pixels) from each inside pixel to the outline. */
function distanceField(canvas: HTMLCanvasElement, width: number, height: number) {
  const probe = document.createElement('canvas')
  probe.width = width
  probe.height = height
  const ctx = probe.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(canvas, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)
  const d = new Float32Array(width * height)
  for (let i = 0; i < d.length; i++) d[i] = data[i * 4 + 3]! > 127 ? 1e6 : 0
  const D = Math.SQRT2
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height) ? 0 : d[y * width + x]!
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (d[i] === 0) continue
      d[i] = Math.min(d[i]!, at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + D, at(x + 1, y - 1) + D)
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (d[i] === 0) continue
      d[i] = Math.min(d[i]!, at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + D, at(x - 1, y + 1) + D)
    }
  }
  return {
    sample(u: number, v: number) {
      const fx = Math.min(width - 1, Math.max(0, u * width - 0.5))
      const fy = Math.min(height - 1, Math.max(0, (1 - v) * height - 0.5))
      const x0 = Math.floor(fx), y0 = Math.floor(fy)
      const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1)
      const tx = fx - x0, ty = fy - y0
      const a = d[y0 * width + x0]!, b = d[y0 * width + x1]!
      const c = d[y1 * width + x0]!, e = d[y1 * width + x1]!
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty
    }
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * A two-sided fabric mesh: a grid whose front and back surfaces sit a few
 * millimetres apart (fuller across the shoulders, where the hanger fills the
 * garment), pinched together at the edges and bent by a shared drape so the
 * piece hangs with soft folds. Pixels outside the silhouette are discarded by
 * the material's alpha test. Each vertex is also bound to the cloth grid so
 * the physics can move it.
 */
export function buildGarmentGeometry(kind: GarmentKind, canvases: GarmentCanvases, seedKey: string) {
  const { spec } = canvases
  const { width: w, height: h, thickness, body } = spec
  const maskH = Math.round(MASK_WIDTH * h / w)
  const field = distanceField(canvases.front, MASK_WIDTH, maskH)
  const pxToWorld = w / MASK_WIDTH
  const radius = 0.035

  const seed = hashSeed(seedKey)
  const p1 = seed * Math.PI * 2
  const p2 = seed * 17.3
  const p3 = seed * 5.1

  const segX = 84
  const segY = Math.round(segX * h / w)
  const cols = segX + 1
  const count = cols * (segY + 1)

  const positions = new Float32Array(count * 2 * 3)
  const uvs = new Float32Array(count * 2 * 2)
  const grid = clothGrid(w, h)
  const gridCoords = new Float32Array(count * 2 * 2)
  const shells = new Float32Array(count * 2)
  const top = isTop(kind)

  for (let j = 0; j <= segY; j++) {
    const v = j / segY
    const y = -(1 - v) * h
    const t = 1 - v
    for (let i = 0; i <= segX; i++) {
      const u = i / segX
      const x = (u - 0.5) * w
      const ax = Math.abs(x)
      const nx = Math.min(1, ax / body)
      const sleeve = top ? smoothstep(body - 0.01, body + 0.08, ax) : 0

      // Fuller across the shoulders where the hanger sits, thin towards the hem.
      const fill = top ? 1 - smoothstep(0.02, 0.32, t) : 1 - smoothstep(0, 0.2, t)
      const half = thickness * (0.35 + 0.65 * fill) * (1 - 0.35 * sleeve)
      const dist = Math.max(0, (field.sample(u, v) - 0.6) * pxToWorld)
      const k = 1 - Math.min(dist / radius, 1)
      const puff = half * Math.sqrt(Math.max(0, 1 - k * k))

      // Drape: a slight belly, vertical folds that deepen towards the hem and
      // sleeves that fall a little forward off the hanger.
      const amp = 0.003 + 0.016 * Math.pow(t, 1.3)
      let drape = 0.014 * (1 - nx * nx) * (0.4 + 0.6 * t)
        + amp * (0.62 * Math.sin(x * 12 + p1) + 0.38 * Math.sin(x * 27 + p2))
        + 0.005 * Math.sin(y * 9 + p3) * t
      if (kind === 'tee') drape += 0.04 * sleeve
      else if (top) drape += 0.035 * sleeve * (0.6 + 0.4 * t)
      else drape -= 0.012 * smoothstep(0.0, 0.3, ax - 0.1) * t

      const f = j * cols + i
      const b = f + count
      positions.set([x, y, drape + puff], f * 3)
      positions.set([x, y, drape - puff], b * 3)
      uvs.set([u, v], f * 2)
      // Back panel art is painted as seen from behind.
      uvs.set([1 - u, v], b * 2)
      const gx = (x + w / 2) / grid.cell
      const gy = -y / grid.cell
      gridCoords.set([gx, gy], f * 2)
      gridCoords.set([gx, gy], b * 2)
      shells[f] = drape + puff
      shells[b] = drape - puff
    }
  }

  const indices: number[] = []
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * cols + i
      const b = a + 1
      const c = a + cols + 1
      const d = a + cols
      indices.push(a, b, d, b, c, d)
    }
  }
  const frontCount = indices.length
  for (let n = 0; n < frontCount; n += 3) {
    indices.push(indices[n]! + count, indices[n + 2]! + count, indices[n + 1]! + count)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('aGrid', new THREE.BufferAttribute(gridCoords, 2))
  geometry.setAttribute('aShell', new THREE.BufferAttribute(shells, 1))
  geometry.setIndex(indices)
  geometry.addGroup(0, frontCount, 0)
  geometry.addGroup(frontCount, frontCount, 1)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  /** True where garment-space (x, y) is on the fabric. */
  const insideAt = (x: number, y: number) => field.sample((x + w / 2) / w, 1 + y / h) > 0.5
  return { geometry, insideAt }
}
