import * as THREE from 'three'
import type { GarmentKind, Product } from '~/data/products'

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
  /** Half-thickness of the inflated fabric at its fullest. */
  thickness: number
}

export const GARMENT_SPECS: Record<GarmentKind, GarmentSpec> = {
  tee: { width: 1.04, height: 1.07, drop: 0.172, thickness: 0.042 },
  shorts: { width: 0.8, height: 0.62, drop: 0.176, thickness: 0.038 }
}

const TEXTURE_WIDTH = 1024

type PathSink = Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath'>

function traceTee(p: PathSink) {
  p.moveTo(-0.125, 0)
  p.quadraticCurveTo(-0.07, -0.032, 0, -0.032)
  p.quadraticCurveTo(0.07, -0.032, 0.125, 0)
  p.quadraticCurveTo(0.24, -0.022, 0.355, -0.062)
  p.quadraticCurveTo(0.45, -0.13, 0.52, -0.255)
  p.lineTo(0.445, -0.345)
  p.quadraticCurveTo(0.38, -0.3, 0.335, -0.29)
  p.quadraticCurveTo(0.34, -0.7, 0.352, -1.045)
  p.quadraticCurveTo(0, -1.085, -0.352, -1.045)
  p.quadraticCurveTo(-0.34, -0.7, -0.335, -0.29)
  p.quadraticCurveTo(-0.38, -0.3, -0.445, -0.345)
  p.lineTo(-0.52, -0.255)
  p.quadraticCurveTo(-0.45, -0.13, -0.355, -0.062)
  p.quadraticCurveTo(-0.24, -0.022, -0.125, 0)
  p.closePath()
}

function traceShorts(p: PathSink) {
  p.moveTo(-0.33, 0)
  p.lineTo(0.33, 0)
  p.lineTo(0.34, -0.065)
  p.quadraticCurveTo(0.385, -0.3, 0.4, -0.59)
  p.lineTo(0.392, -0.612)
  p.quadraticCurveTo(0.2, -0.6, 0.035, -0.59)
  p.quadraticCurveTo(0.02, -0.42, 0, -0.36)
  p.quadraticCurveTo(-0.02, -0.42, -0.035, -0.59)
  p.quadraticCurveTo(-0.2, -0.6, -0.392, -0.612)
  p.lineTo(-0.4, -0.59)
  p.quadraticCurveTo(-0.385, -0.3, -0.34, -0.065)
  p.closePath()
}

const TRACERS: Record<GarmentKind, (p: PathSink) => void> = {
  tee: traceTee,
  shorts: traceShorts
}

/* ------------------------------------------------------------------ colour */

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
  const l = new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l
  return l > 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.18)'
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
  return {
    x: (x0 + spec.width / 2) * s,
    y: -y0 * s,
    w: (x1 - x0) * s,
    h: (y0 - y1) * s
  }
}

function drawContain(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number, height: number }, r: { x: number, y: number, w: number, h: number }) {
  const scale = Math.min(r.w / img.width, r.h / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h)
}

function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number, height: number }) {
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
  ctx.globalAlpha = 0.16
  ctx.fillStyle = ctx.createPattern(getKnitCanvas(), 'repeat')!
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
}

function stitch(ctx: CanvasRenderingContext2D, color: string, draw: () => void) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 0.0032
  ctx.setLineDash([0.011, 0.007])
  ctx.beginPath()
  draw()
  ctx.stroke()
  ctx.restore()
}

function seam(ctx: CanvasRenderingContext2D, color: string, width: number, draw: () => void) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  draw()
  ctx.stroke()
  ctx.restore()
}

function frontNeckline(p: PathSink) {
  p.moveTo(-0.125, 0)
  p.bezierCurveTo(-0.115, -0.07, -0.06, -0.09, 0, -0.09)
  p.bezierCurveTo(0.06, -0.09, 0.115, -0.07, 0.125, 0)
}

function drawTeeDetails(ctx: CanvasRenderingContext2D, color: string, side: 'front' | 'back') {
  const stitches = stitchColor(color)
  if (side === 'front') {
    // The inside of the back panel, seen through the neck opening.
    ctx.save()
    ctx.fillStyle = shade(color, 0.72)
    ctx.beginPath()
    ctx.moveTo(-0.125, 0)
    ctx.quadraticCurveTo(-0.07, -0.032, 0, -0.032)
    ctx.quadraticCurveTo(0.07, -0.032, 0.125, 0)
    ctx.bezierCurveTo(0.115, -0.07, 0.06, -0.09, 0, -0.09)
    ctx.bezierCurveTo(-0.06, -0.09, -0.115, -0.07, -0.125, 0)
    ctx.fill()
    ctx.restore()
    // Ribbed collar.
    seam(ctx, shade(color, 0.9), 0.03, () => frontNeckline(ctx))
    seam(ctx, 'rgba(0,0,0,0.12)', 0.003, () => {
      ctx.moveTo(-0.142, 0)
      ctx.bezierCurveTo(-0.13, -0.085, -0.07, -0.106, 0, -0.106)
      ctx.bezierCurveTo(0.07, -0.106, 0.13, -0.085, 0.142, 0)
    })
  } else {
    seam(ctx, shade(color, 0.9), 0.024, () => {
      ctx.moveTo(-0.125, 0)
      ctx.quadraticCurveTo(-0.07, -0.032, 0, -0.032)
      ctx.quadraticCurveTo(0.07, -0.032, 0.125, 0)
    })
  }
  // Set-in sleeve seams.
  seam(ctx, 'rgba(0,0,0,0.1)', 0.004, () => {
    ctx.moveTo(0.355, -0.062)
    ctx.quadraticCurveTo(0.31, -0.17, 0.335, -0.29)
    ctx.moveTo(-0.355, -0.062)
    ctx.quadraticCurveTo(-0.31, -0.17, -0.335, -0.29)
  })
  // Twin-needle hems.
  stitch(ctx, stitches, () => {
    ctx.moveTo(0.497, -0.236)
    ctx.lineTo(0.422, -0.326)
    ctx.moveTo(-0.497, -0.236)
    ctx.lineTo(-0.422, -0.326)
    ctx.moveTo(-0.35, -1.012)
    ctx.quadraticCurveTo(0, -1.052, 0.35, -1.012)
  })
}

function drawShortsDetails(ctx: CanvasRenderingContext2D, color: string, side: 'front' | 'back', fabric: string) {
  const stitches = stitchColor(color)
  // Elasticated waistband, always in the base fabric colour.
  ctx.save()
  ctx.fillStyle = shade(fabric, 0.93)
  ctx.fillRect(-0.34, -0.066, 0.68, 0.066)
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'
  ctx.lineWidth = 0.0025
  ctx.beginPath()
  for (let x = -0.33; x <= 0.33; x += 0.014) {
    ctx.moveTo(x, -0.008)
    ctx.lineTo(x + 0.002, -0.058)
  }
  ctx.stroke()
  ctx.restore()
  stitch(ctx, stitchColor(fabric), () => {
    ctx.moveTo(-0.338, -0.07)
    ctx.lineTo(0.338, -0.07)
  })

  if (side === 'front') {
    // Drawcord with metal eyelets and aglets.
    const cord = new THREE.Color(fabric).getHSL({ h: 0, s: 0, l: 0 }).l > 0.5 ? '#2b2b2b' : '#f1ece0'
    seam(ctx, cord, 0.009, () => {
      ctx.moveTo(-0.022, -0.036)
      ctx.bezierCurveTo(-0.03, -0.09, -0.05, -0.12, -0.04, -0.18)
      ctx.moveTo(0.022, -0.036)
      ctx.bezierCurveTo(0.03, -0.09, 0.02, -0.14, 0.034, -0.195)
    })
    seam(ctx, '#9a9a9a', 0.012, () => {
      ctx.moveTo(-0.0405, -0.17)
      ctx.lineTo(-0.0395, -0.188)
      ctx.moveTo(0.0325, -0.184)
      ctx.lineTo(0.0355, -0.203)
    })
    ctx.save()
    ctx.fillStyle = '#b9b9b9'
    for (const x of [-0.022, 0.022]) {
      ctx.beginPath()
      ctx.arc(x, -0.034, 0.008, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    // Fly and slant pockets.
    stitch(ctx, stitches, () => {
      ctx.moveTo(0.032, -0.072)
      ctx.lineTo(0.032, -0.25)
      ctx.quadraticCurveTo(0.03, -0.3, 0.004, -0.31)
    })
    seam(ctx, 'rgba(0,0,0,0.16)', 0.004, () => {
      ctx.moveTo(0.24, -0.068)
      ctx.quadraticCurveTo(0.27, -0.16, 0.355, -0.22)
      ctx.moveTo(-0.24, -0.068)
      ctx.quadraticCurveTo(-0.27, -0.16, -0.355, -0.22)
    })
  }
  seam(ctx, 'rgba(0,0,0,0.1)', 0.003, () => {
    ctx.moveTo(0, -0.07)
    ctx.lineTo(0, -0.36)
  })
  stitch(ctx, stitches, () => {
    ctx.moveTo(0.04, -0.562)
    ctx.quadraticCurveTo(0.2, -0.572, 0.39, -0.583)
    ctx.moveTo(-0.04, -0.562)
    ctx.quadraticCurveTo(-0.2, -0.572, -0.39, -0.583)
  })
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

/**
 * Paints the front and back panels of a garment. The canvas alpha is the
 * garment silhouette, which the mesh builder later inflates into 3D.
 */
export async function paintGarment(product: Product, imageUrl: string): Promise<GarmentCanvases> {
  const base = GARMENT_SPECS[product.garment]
  const img = await loadImage(imageUrl).catch(() => null)

  if (product.placement === 'mockup' && img) {
    const crop = trimTransparent(img)
    const spec: GarmentSpec = { ...base, height: base.width * crop.sh / crop.sw }
    const front = createCanvas(spec)
    const back = createCanvas(spec)
    const fctx = front.getContext('2d')!
    fctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, front.width, front.height)
    const bctx = back.getContext('2d')!
    bctx.drawImage(front, 0, 0)
    bctx.globalCompositeOperation = 'source-in'
    bctx.fillStyle = crop.average
    bctx.fillRect(0, 0, back.width, back.height)
    return { spec, front, back }
  }

  const spec = base
  const trace = TRACERS[product.garment]
  const paint = (canvas: HTMLCanvasElement, side: 'front' | 'back') => {
    const ctx = canvas.getContext('2d')!
    useGarmentSpace(ctx, spec)
    ctx.beginPath()
    trace(ctx)
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

    // Use the printed area's dominant tone for stitch contrast on all-over prints.
    if (product.garment === 'tee') drawTeeDetails(ctx, product.color, side)
    else drawShortsDetails(ctx, product.color, side, product.color)

    if (side === 'front' && img && !allOver) {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      if (product.placement === 'leg') {
        // Wearer's right leg = viewer's left.
        drawContain(ctx, img, toPixels(ctx, spec, -0.335, -0.4, -0.185, -0.55))
      } else {
        const top = product.garment === 'tee' ? -0.165 : -0.12
        const size = product.garment === 'tee' ? 0.46 : 0.3
        drawContain(ctx, img, toPixels(ctx, spec, -size / 2, top, size / 2, top - size))
      }
      ctx.restore()
    }
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

function hashSeed(id: string) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

/**
 * A two-sided "pillow" mesh: a dense grid whose front and back surfaces are
 * pushed apart by the distance to the silhouette (rounded edges, soft body)
 * and both bent by the same drape so the garment hangs with gentle folds.
 * Pixels outside the silhouette are discarded by the material's alpha test.
 */
export function buildGarmentGeometry(kind: GarmentKind, canvases: GarmentCanvases, seedKey: string) {
  const { spec } = canvases
  const { width: w, height: h, thickness } = spec
  const maskH = Math.round(MASK_WIDTH * h / w)
  const field = distanceField(canvases.front, MASK_WIDTH, maskH)
  const pxToWorld = w / MASK_WIDTH
  const radius = 0.07

  const seed = hashSeed(seedKey)
  const p1 = seed * Math.PI * 2
  const p2 = seed * 17.3
  const p3 = seed * 5.1

  const segX = 120
  const segY = Math.round(segX * h / w)
  const cols = segX + 1
  const count = cols * (segY + 1)

  const positions = new Float32Array(count * 2 * 3)
  const uvs = new Float32Array(count * 2 * 2)

  for (let j = 0; j <= segY; j++) {
    const v = j / segY
    const y = -(1 - v) * h
    const t = 1 - v
    for (let i = 0; i <= segX; i++) {
      const u = i / segX
      const x = (u - 0.5) * w
      const nx = x / (w / 2)

      const dist = Math.max(0, (field.sample(u, v) - 0.6) * pxToWorld)
      const k = 1 - Math.min(dist / radius, 1)
      const puff = thickness * Math.sqrt(Math.max(0, 1 - k * k))

      // Drape: a soft belly, vertical folds that deepen towards the hem, and
      // sleeves / legs that fall slightly back.
      const amp = 0.004 + 0.02 * Math.pow(t, 1.4)
      let drape = 0.03 * (1 - nx * nx) * (0.35 + 0.65 * t)
        + amp * (0.62 * Math.sin(x * 12 + p1) + 0.38 * Math.sin(x * 27 + p2))
        + 0.006 * Math.sin(y * 9 + p3) * t
      if (kind === 'tee') drape -= 0.03 * smoothstep(0.33, 0.52, Math.abs(x)) * (1 - smoothstep(0.2, 0.4, t))
      else drape -= 0.012 * smoothstep(0.0, 0.3, Math.abs(x) - 0.1) * t

      const f = j * cols + i
      const b = f + count
      positions.set([x, y, drape + puff], f * 3)
      positions.set([x, y, drape - puff * 0.8], b * 3)
      uvs.set([u, v], f * 2)
      uvs.set([u, v], b * 2)
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
  geometry.setIndex(indices)
  geometry.addGroup(0, frontCount, 0)
  geometry.addGroup(frontCount, frontCount, 1)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}
