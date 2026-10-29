// 2:1 isometric primitives for every procedural city sprite (style-guide.md
// §3.1 iso.ts, §1.2 light rule, §1.5 grid discipline).
//
// Model: sprites are built as a small voxel volume in iso units and rendered
// with a painter's pass that is pixel-exact with the 2-px stair-step diamond
// of draw-api.ts diamondSpans():
//
//   unit u (tile +x, screen SE) -> screen (+2, +1)
//   unit v (tile +y, screen SW) -> screen (-2, +1)
//   unit z (up)                 -> screen ( 0, -1)
//   one 64x32 tile = 16 x 16 units; a footprint of n tiles = 16n units.
//
// A voxel (u, v, z) occupying [u,u+1]x[v,v+1]x[z,z+1] draws a 4x3 hexagon:
// its top face (rows y0, y0+1, 4 px) in Mat.top, its left (south-west, +v)
// face (row y0+2, left 2 px) in Mat.left and its right (south-east, +u) face
// (row y0+2, right 2 px) in Mat.right, where
//   x0 = ox + 2(u - v) - 2,  y0 = oy + u + v - z - 1
// and (ox, oy) is the top vertex of the z = 0 floor: floor cell (u, v) paints
// rows oy+u+v .. +1, columns ox+2(u-v)-2 .. +1. For a city canvas W x H with
// footprint n: ox = W/2, oy = H - 32n, so the floor is exactly the footprint
// diamond with its bottom vertex on the anchor (W/2-1..W/2, H-1).
// Painter's order = depth u + v + 2z (the view direction is (1, 1, 2)).
//
// Light rule (§1.2): top = ramp step +2, left = +1, right = base; Mat holds
// the three palette ids. Images are palette-index buffers (Img) so passes,
// outlines and the fog/mirror/reshade variants work on exact colours.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { inflateSync } from 'node:zlib'
import type { Canvas } from '@napi-rs/canvas'
import { createCanvas } from '@napi-rs/canvas'
import type { DrawCtx } from './draw-api.ts'
import { diamondSpans } from './draw-api.ts'
import { PALETTE } from './palette.ts'
import type { Rng } from './rng.ts'

export { diamondSpans }

// ---------------------------------------------------------------------------
// Palette-index images

export interface Img {
  w: number
  h: number
  /** palette index per pixel, -1 = transparent */
  px: Int16Array
  /** painter depth of the voxel that wrote the pixel (edge detection) */
  depth: Float32Array
}

const INDEX = new Map(PALETTE.colors.map((c, i) => [c.id, i]))
const HEX_INDEX = new Map(PALETTE.colors.map((c, i) => [c.hex, i]))

/** palette index of a palette id (throws on unknown ids) */
export function pidx(id: string): number {
  const i = INDEX.get(id)
  if (i === undefined) throw new Error(`iso: unknown palette id ${id}`)
  return i
}

export function pid(i: number): string {
  const c = PALETTE.colors[i]
  if (!c) throw new Error(`iso: bad palette index ${i}`)
  return c.id
}

export function newImg(w: number, h: number): Img {
  const px = new Int16Array(w * h).fill(-1)
  const depth = new Float32Array(w * h).fill(-Infinity)
  return { w, h, px, depth }
}

export function cloneImg(img: Img): Img {
  return {
    w: img.w,
    h: img.h,
    px: img.px.slice(),
    depth: img.depth.slice(),
  }
}

export function inside(img: Img, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < img.w && y < img.h
}

/** palette id at (x, y) or null when transparent / outside */
export function get(img: Img, x: number, y: number): string | null {
  if (!inside(img, x, y)) return null
  const i = img.px[y * img.w + x] as number
  return i < 0 ? null : pid(i)
}

export function opaque(img: Img, x: number, y: number): boolean {
  return inside(img, x, y) && (img.px[y * img.w + x] as number) >= 0
}

/** set one pixel (null = clear); outside the image is ignored */
export function put(
  img: Img,
  x: number,
  y: number,
  id: string | null,
  depth = 0,
): void {
  if (!inside(img, x, y)) return
  const k = y * img.w + x
  img.px[k] = id === null ? -1 : pidx(id)
  img.depth[k] = id === null ? -Infinity : depth
}

export function rect(
  img: Img,
  x: number,
  y: number,
  w: number,
  h: number,
  id: string | null,
  depth = 0,
): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) put(img, x + i, y + j, id, depth)
  }
}

/** Bresenham line */
export function lineImg(
  img: Img,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  id: string,
  depth = 0,
): void {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    put(img, x, y, id, depth)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
}

/** Copy `src` onto `dst` at (dx, dy); transparent source pixels skipped. */
export function blit(dst: Img, src: Img, dx = 0, dy = 0): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = src.px[y * src.w + x] as number
      if (i < 0 || !inside(dst, x + dx, y + dy)) continue
      const k = (y + dy) * dst.w + x + dx
      dst.px[k] = i
      dst.depth[k] = src.depth[y * src.w + x] as number
    }
  }
}

/** Remap colours by palette id (fog, swaps, reshade). */
export function remap(img: Img, map: ReadonlyMap<string, string>): Img {
  const out = cloneImg(img)
  const byIdx = new Map<number, number>()
  for (const [a, b] of map) byIdx.set(pidx(a), pidx(b))
  for (let k = 0; k < out.px.length; k++) {
    const to = byIdx.get(out.px[k] as number)
    if (to !== undefined) out.px[k] = to
  }
  return out
}

export function mirrorX(img: Img): Img {
  const out = newImg(img.w, img.h)
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const s = y * img.w + x
      const d = y * img.w + (img.w - 1 - x)
      out.px[d] = img.px[s] as number
      out.depth[d] = img.depth[s] as number
    }
  }
  return out
}

/** Img -> canvas; every colour is validated through d.hex (subset rule). */
export function imgToCanvas(img: Img, d?: DrawCtx): Canvas {
  const canvas = createCanvas(img.w, img.h)
  const ctx = canvas.getContext('2d')
  const data = ctx.createImageData(img.w, img.h)
  const rgb = new Map<number, readonly [number, number, number]>()
  for (let k = 0; k < img.px.length; k++) {
    const i = img.px[k] as number
    if (i < 0) continue
    let c = rgb.get(i)
    if (!c) {
      const id = pid(i)
      if (d) d.hex(id) // throws for colours outside the entry's subset
      c = PALETTE.byId.get(id)?.rgb as readonly [number, number, number]
      rgb.set(i, c)
    }
    data.data[k * 4] = c[0]
    data.data[k * 4 + 1] = c[1]
    data.data[k * 4 + 2] = c[2]
    data.data[k * 4 + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

/**
 * RGBA buffer -> Img. Pixels with alpha < 128 are transparent; opaque
 * pixels must be exact palette colours unless `nearestFn` maps them.
 * Returns the image and the count of off-palette pixels met.
 */
export function rgbaToImg(
  rgba: Uint8Array | Uint8ClampedArray | Buffer,
  w: number,
  h: number,
  nearestFn?: (r: number, g: number, b: number) => number,
): { img: Img; offPalette: number } {
  const img = newImg(w, h)
  let offPalette = 0
  for (let k = 0; k < w * h; k++) {
    const a = rgba[k * 4 + 3] as number
    if (a < 128) continue
    const r = rgba[k * 4] as number
    const g = rgba[k * 4 + 1] as number
    const b = rgba[k * 4 + 2] as number
    const hex = `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
    let i = HEX_INDEX.get(hex)
    if (i === undefined) {
      offPalette++
      i = nearestFn ? nearestFn(r, g, b) : -1
    }
    img.px[k] = i
    img.depth[k] = 0
  }
  return { img, offPalette }
}

/** Img -> RGBA bytes (alpha 0/255). */
export function imgToRgba(img: Img): Uint8Array {
  const out = new Uint8Array(img.w * img.h * 4)
  for (let k = 0; k < img.px.length; k++) {
    const i = img.px[k] as number
    if (i < 0) continue
    const c = (PALETTE.colors[i] as { rgb: readonly number[] }).rgb
    out[k * 4] = c[0] as number
    out[k * 4 + 1] = c[1] as number
    out[k * 4 + 2] = c[2] as number
    out[k * 4 + 3] = 255
  }
  return out
}

/**
 * Decode a PNG to straight RGBA bytes, synchronously (node:zlib): 8-bit
 * grey / RGB / palette / grey+alpha / RGBA, non-interlaced — what the
 * canvas encoder of `vlr art:draw` writes. Anything else throws (generated
 * downloads are converted with sharp in gen.ts first).
 */
export function decodePng(buf: Buffer): {
  rgba: Uint8ClampedArray
  w: number
  h: number
} {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('decodePng: not a PNG')
  }
  let w = 0
  let h = 0
  let depth = 0
  let ctype = 0
  let interlace = 0
  let plte: Buffer | null = null
  let trns: Buffer | null = null
  const idat: Buffer[] = []
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('latin1', o + 4, o + 8)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8] as number
      ctype = data[9] as number
      interlace = data[12] as number
    } else if (type === 'PLTE') plte = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    o += 12 + len
  }
  if (depth !== 8 || interlace !== 0) {
    throw new Error(`decodePng: unsupported depth ${depth} / interlace`)
  }
  const bpp = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[
    ctype
  ]
  if (!bpp) throw new Error(`decodePng: unsupported colour type ${ctype}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const cur = new Uint8Array(stride)
  const prev = new Uint8Array(stride)
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] as number
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? (cur[i - bpp] as number) : 0
      const b = prev[i] as number
      const c = i >= bpp ? (prev[i - bpp] as number) : 0
      const x = line[i] as number
      let v: number
      if (f === 0) v = x
      else if (f === 1) v = x + a
      else if (f === 2) v = x + b
      else if (f === 3) v = x + ((a + b) >> 1)
      else {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      cur[i] = v & 255
    }
    for (let xx = 0; xx < w; xx++) {
      const k = (y * w + xx) * 4
      const s = xx * bpp
      if (ctype === 6) {
        rgba[k] = cur[s] as number
        rgba[k + 1] = cur[s + 1] as number
        rgba[k + 2] = cur[s + 2] as number
        rgba[k + 3] = cur[s + 3] as number
      } else if (ctype === 2) {
        rgba[k] = cur[s] as number
        rgba[k + 1] = cur[s + 1] as number
        rgba[k + 2] = cur[s + 2] as number
        rgba[k + 3] = 255
      } else if (ctype === 0 || ctype === 4) {
        const g = cur[s] as number
        rgba[k] = g
        rgba[k + 1] = g
        rgba[k + 2] = g
        rgba[k + 3] = ctype === 4 ? (cur[s + 1] as number) : 255
      } else {
        const i = cur[s] as number
        rgba[k] = plte?.[i * 3] ?? 0
        rgba[k + 1] = plte?.[i * 3 + 1] ?? 0
        rgba[k + 2] = plte?.[i * 3 + 2] ?? 0
        rgba[k + 3] = trns && i < trns.length ? (trns[i] as number) : 255
      }
    }
    prev.set(cur)
  }
  return { rgba, w, h }
}

/** read a PNG as an Img (alpha >= 128 = opaque); counts off-palette px */
export function readImg(
  path: string,
  nearestFn?: (r: number, g: number, b: number) => number,
): { img: Img; offPalette: number; semiAlpha: number } {
  const { rgba, w, h } = decodePng(readFileSync(path))
  let semiAlpha = 0
  for (let k = 3; k < rgba.length; k += 4) {
    const a = rgba[k] as number
    if (a !== 0 && a !== 255) semiAlpha++
  }
  const { img, offPalette } = rgbaToImg(rgba, w, h, nearestFn)
  return { img, offPalette, semiAlpha }
}

/** PNG bytes of an Img (same encoder as `vlr art:draw`) */
export function encodeImg(img: Img): Buffer {
  return imgToCanvas(img).toBuffer('image/png')
}

/** write bytes only when they differ; returns true when written */
export function writeIfChanged(path: string, buf: Buffer): boolean {
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path) && readFileSync(path).equals(buf)) return false
  writeFileSync(path, buf)
  return true
}

/** pixel-equal images (palette indices) */
export function sameImg(a: Img, b: Img): boolean {
  if (a.w !== b.w || a.h !== b.h) return false
  for (let k = 0; k < a.px.length; k++) if (a.px[k] !== b.px[k]) return false
  return true
}

/** opaque bounding box or null */
export function bbox(
  img: Img,
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = img.w
  let y0 = img.h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if ((img.px[y * img.w + x] as number) < 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

// ---------------------------------------------------------------------------
// Outline and shadow (style-guide §1.2, §1.3)

/**
 * Silhouette outline: every opaque pixel 4-adjacent to transparency (or the
 * canvas edge when `edgeIsTransparent`) becomes `id`.
 */
export function outlineImg(
  img: Img,
  id = 'outline',
  edgeIsTransparent = true,
): number {
  const o = pidx(id)
  const marks: number[] = []
  const solid = (x: number, y: number) =>
    inside(img, x, y)
      ? (img.px[y * img.w + x] as number) >= 0
      : !edgeIsTransparent
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const k = y * img.w + x
      if ((img.px[k] as number) < 0 || img.px[k] === o) continue
      if (
        !solid(x - 1, y) ||
        !solid(x + 1, y) ||
        !solid(x, y - 1) ||
        !solid(x, y + 1)
      ) {
        marks.push(k)
      }
    }
  }
  for (const k of marks) img.px[k] = o
  return marks.length
}

/** painter depth of floor pixels (always 'far behind' every voxel) */
export const FLOOR_DEPTH = -1000

/**
 * Internal edges: a pixel whose 4-neighbour lies far behind it (painter
 * depth difference > threshold) becomes outline, so stacked masses (a tower
 * on a podium, a tank on a roof) keep a crisp contour against what is
 * behind them. Floor pixels never get marked.
 */
export function depthEdges(img: Img, threshold: number, id = 'outline'): void {
  const o = pidx(id)
  const marks: number[] = []
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const k = y * img.w + x
      if ((img.px[k] as number) < 0) continue
      const dk = img.depth[k] as number
      if (dk <= FLOOR_DEPTH) continue
      const nb = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const
      for (const [nx, ny] of nb) {
        if (!inside(img, nx, ny)) continue
        const n = ny * img.w + nx
        if ((img.px[n] as number) < 0) continue
        if (dk - (img.depth[n] as number) > threshold) {
          marks.push(k)
          break
        }
      }
    }
  }
  for (const k of marks) img.px[k] = o
}

/** [top, bottom] rows of column x of a diamond `w` wide (relative). */
export function diamondColumn(w: number, x: number): [number, number] {
  const h = w / 2
  const j = x < w / 2 ? x : w - 1 - x
  const kMin = Math.max(0, Math.ceil((w / 2 - j) / 2) - 1)
  return [kMin, h - 1 - kMin]
}

/**
 * The §1.2 shadow strip: 2 px of `outline` along the right (south-east)
 * base edge of the footprint diamond, inside the diamond. The diamond is
 * `w` wide with its bottom vertex at row `bottomY`, centred on column cx.
 */
export function shadowStrip(
  img: Img,
  cx: number,
  bottomY: number,
  w: number,
  id = 'outline',
): void {
  const left = cx - w / 2
  const row0 = bottomY - w / 2 + 1
  for (let x = w / 2; x < w; x++) {
    const [, b] = diamondColumn(w, x)
    put(img, left + x, row0 + b, id, -1)
    put(img, left + x, row0 + b - 1, id, -1)
  }
}

/**
 * true when the lowest rows of `img` are the footprint diamond (A04): the
 * bottom half of the diamond rows matches diamondSpans exactly and every
 * pixel of the upper half rows inside the span is opaque.
 */
export function stairStepOk(img: Img, w: number): string[] {
  const problems: string[] = []
  const spans = diamondSpans(w)
  const row0 = img.h - spans.length
  const left = img.w / 2 - w / 2
  spans.forEach(([s0, s1], r) => {
    const y = row0 + r
    const lowerHalf = r >= spans.length / 2
    for (let x = 0; x < img.w; x++) {
      const inSpan = x >= left + s0 && x <= left + s1
      const o = opaque(img, x, y)
      if (inSpan && !o) {
        problems.push(`row ${y}: hole at x ${x} inside the footprint diamond`)
        return
      }
      if (!inSpan && o && lowerHalf) {
        problems.push(`row ${y}: opaque pixel x ${x} outside the diamond`)
        return
      }
    }
  })
  return problems
}

// ---------------------------------------------------------------------------
// Materials

/** the three face colours of one material (palette ids) */
export interface Mat {
  top: string
  left: string
  right: string
}

export function mat(topId: string, left = topId, right = left): Mat {
  return { top: topId, left, right }
}

/**
 * Light-rule material from a ramp: right = step `base`, left = base + 1,
 * top = base + 2 (clamped to the ramp's lightest shade).
 */
export function rampMat(ramp: string, base: number): Mat {
  const ids = PALETTE.ramp(ramp).map((c) => c.id)
  if (ids.length === 0) throw new Error(`iso: unknown ramp ${ramp}`)
  const at = (k: number) => ids[Math.max(0, Math.min(ids.length - 1, k))]
  return {
    right: at(base) as string,
    left: at(base + 1) as string,
    top: at(base + 2) as string,
  }
}

// ---------------------------------------------------------------------------
// Voxel volume

export class Vox {
  nu: number
  nv: number
  nz: number
  cells: Int32Array
  mats: Mat[] = []
  matKey = new Map<string, number>()

  constructor(nu: number, nv: number, nz: number) {
    this.nu = nu
    this.nv = nv
    this.nz = nz
    this.cells = new Int32Array(nu * nv * nz)
  }

  /** intern a material, returns its 1-based index */
  m(m: Mat): number {
    const key = `${m.top}|${m.left}|${m.right}`
    let i = this.matKey.get(key)
    if (i === undefined) {
      this.mats.push(m)
      i = this.mats.length
      this.matKey.set(key, i)
    }
    return i
  }

  ok(u: number, v: number, z: number): boolean {
    return (
      u >= 0 && v >= 0 && z >= 0 && u < this.nu && v < this.nv && z < this.nz
    )
  }

  /** material index at (u, v, z), 0 = empty or outside */
  at(u: number, v: number, z: number): number {
    if (!this.ok(u, v, z)) return 0
    return this.cells[(z * this.nv + v) * this.nu + u] as number
  }

  filled(u: number, v: number, z: number): boolean {
    return this.at(u, v, z) > 0
  }

  matAt(u: number, v: number, z: number): Mat | null {
    const i = this.at(u, v, z)
    return i > 0 ? (this.mats[i - 1] as Mat) : null
  }

  set(u: number, v: number, z: number, m: Mat | null): void {
    if (!this.ok(u, v, z)) return
    this.cells[(z * this.nv + v) * this.nu + u] = m ? this.m(m) : 0
  }

  /** fill the box [u0,u0+a) x [v0,v0+b) x [z0,z0+h) */
  box(
    u0: number,
    v0: number,
    z0: number,
    a: number,
    b: number,
    h: number,
    m: Mat | null,
  ): void {
    const k = m ? this.m(m) : 0
    for (let z = z0; z < z0 + h; z++) {
      for (let v = v0; v < v0 + b; v++) {
        for (let u = u0; u < u0 + a; u++) {
          if (this.ok(u, v, z)) {
            this.cells[(z * this.nv + v) * this.nu + u] = k
          }
        }
      }
    }
  }

  /** recolour only filled voxels of a box */
  paint(
    u0: number,
    v0: number,
    z0: number,
    a: number,
    b: number,
    h: number,
    m: Mat,
  ): void {
    const k = this.m(m)
    for (let z = z0; z < z0 + h; z++) {
      for (let v = v0; v < v0 + b; v++) {
        for (let u = u0; u < u0 + a; u++) {
          if (this.ok(u, v, z) && this.filled(u, v, z)) {
            this.cells[(z * this.nv + v) * this.nu + u] = k
          }
        }
      }
    }
  }

  /** vertical cylinder centred at (cu, cv) (may be .5), radius r */
  cylinder(
    cu: number,
    cv: number,
    z0: number,
    r: number,
    h: number,
    m: Mat | null,
  ): void {
    for (let v = Math.floor(cv - r); v <= Math.ceil(cv + r); v++) {
      for (let u = Math.floor(cu - r); u <= Math.ceil(cu + r); u++) {
        const du = u + 0.5 - cu
        const dv = v + 0.5 - cv
        if (du * du + dv * dv <= r * r + 0.25) {
          this.box(u, v, z0, 1, 1, h, m)
        }
      }
    }
  }

  /** ellipsoid / sphere centred at (cu, cv, cz) with radii */
  blob(
    cu: number,
    cv: number,
    cz: number,
    ru: number,
    rv: number,
    rz: number,
    m: Mat | ((u: number, v: number, z: number) => Mat | null),
  ): void {
    for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
      for (let v = Math.floor(cv - rv); v <= Math.ceil(cv + rv); v++) {
        for (let u = Math.floor(cu - ru); u <= Math.ceil(cu + ru); u++) {
          const du = (u + 0.5 - cu) / ru
          const dv = (v + 0.5 - cv) / rv
          const dz = (z + 0.5 - cz) / rz
          if (du * du + dv * dv + dz * dz <= 1.05) {
            const mm = typeof m === 'function' ? m(u, v, z) : m
            if (mm) this.set(u, v, z, mm)
          }
        }
      }
    }
  }

  /** highest filled z in column (u, v), or -1 */
  topAt(u: number, v: number): number {
    for (let z = this.nz - 1; z >= 0; z--) if (this.filled(u, v, z)) return z
    return -1
  }
}

export interface RenderOpts {
  /** depth bias added to every voxel (layering several volumes) */
  bias?: number
}

/**
 * Painter's render of `vox` into `img`; (ox, oy) = top vertex of the z = 0
 * floor (see header). Voxels fully enclosed on their visible sides are
 * skipped.
 */
export function renderVox(
  img: Img,
  vox: Vox,
  ox: number,
  oy: number,
  opts: RenderOpts = {},
): void {
  const bias = opts.bias ?? 0
  const maxD = vox.nu - 1 + vox.nv - 1 + 2 * (vox.nz - 1)
  const mats = vox.mats.map((m) => ({
    top: pidx(m.top),
    left: pidx(m.left),
    right: pidx(m.right),
  }))
  const paint = (x: number, y: number, c: number, depth: number) => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return
    const k = y * img.w + x
    img.px[k] = c
    img.depth[k] = depth
  }
  for (let d = 0; d <= maxD; d++) {
    for (let z = 0; z < vox.nz; z++) {
      const s = d - 2 * z
      if (s < 0) break
      const uLo = Math.max(0, s - (vox.nv - 1))
      const uHi = Math.min(vox.nu - 1, s)
      for (let u = uLo; u <= uHi; u++) {
        const v = s - u
        const k = vox.at(u, v, z)
        if (k === 0) continue
        const upOpen = !vox.filled(u, v, z + 1)
        const leftOpen = !vox.filled(u, v + 1, z)
        const rightOpen = !vox.filled(u + 1, v, z)
        if (!upOpen && !leftOpen && !rightOpen) continue
        const m = mats[k - 1] as { top: number; left: number; right: number }
        const x0 = ox + 2 * (u - v) - 2
        const y0 = oy + u + v - z - 1
        const depth = d + bias
        // full hexagon (hidden faces are overdrawn by nearer voxels)
        for (let i = 0; i < 4; i++) {
          paint(x0 + i, y0, m.top, depth)
          paint(x0 + i, y0 + 1, m.top, depth)
        }
        paint(x0, y0 + 2, m.left, depth)
        paint(x0 + 1, y0 + 2, m.left, depth)
        paint(x0 + 2, y0 + 2, m.right, depth)
        paint(x0 + 3, y0 + 2, m.right, depth)
      }
    }
  }
}

/**
 * Paint the z = 0 floor plane: cell (u, v) of an nu x nv grid gets the
 * colour `colour(u, v)` (null = leave transparent). Floor pixels get
 * FLOOR_DEPTH: they are never marked by depthEdges, and every voxel pixel
 * bordering the floor is (the object's contour against its ground patch).
 */
export function renderFloor(
  img: Img,
  nu: number,
  nv: number,
  ox: number,
  oy: number,
  colour: (u: number, v: number) => string | null,
): void {
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const c = colour(u, v)
      if (c === null) continue
      const ci = pidx(c)
      const x0 = ox + 2 * (u - v) - 2
      const y0 = oy + u + v
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) {
          const x = x0 + i
          const y = y0 + j
          if (!inside(img, x, y)) continue
          img.px[y * img.w + x] = ci
          img.depth[y * img.w + x] = FLOOR_DEPTH
        }
      }
    }
  }
}

/** screen position (top-left of the top face) of voxel (u, v, z) */
export function voxScreen(
  ox: number,
  oy: number,
  u: number,
  v: number,
  z: number,
): { x: number; y: number } {
  return { x: ox + 2 * (u - v) - 2, y: oy + u + v - z - 1 }
}

/** Fill a 2:1 diamond `w` wide with bottom vertex row `bottomY` at cx. */
export function diamondImg(
  img: Img,
  cx: number,
  bottomY: number,
  w: number,
  id: string,
  depth = FLOOR_DEPTH,
): void {
  const spans = diamondSpans(w)
  const row0 = bottomY - spans.length + 1
  spans.forEach(([x0, x1], r) => {
    for (let x = x0; x <= x1; x++) put(img, cx - w / 2 + x, row0 + r, id, depth)
  })
}

// ===========================================================================
// Building kit (style-guide §4.2): the procedural vocabulary shared by
// buildings.ts, exterior.ts and vehicles.ts — plots, boxes, windows,
// shopfronts, awnings, roofs (flat / gable / hip / sawtooth / dome),
// chimneys with smoke anchors, tanks, antennas, silos, balconies, trees.
// Everything is built in a Vox over the footprint grid and rendered by
// finish(): floor -> voxels -> internal edges -> outline -> shadow strip.
// ===========================================================================

// ---------------------------------------------------------------------------
// Materials (right = base, left = +1, top = +2 — style-guide §1.2)

export const M = {
  brick: rampMat('orange', 0),
  brickLight: rampMat('orange', 1),
  cream: rampMat('grey', 3),
  concrete: rampMat('grey', 2),
  metal: rampMat('grey', 1),
  darkMetal: rampMat('grey', 0),
  plasterY: rampMat('yellow', 1),
  mustard: rampMat('yellow', 0),
  purple: rampMat('purple', 0),
  pink: mat('pink1', 'pink1', 'pink0'),
  wood: rampMat('brown', 1),
  woodDark: rampMat('brown', 0),
  leaf: rampMat('leaf', 0),
  grass: rampMat('grass', 1),
  grassDark: rampMat('grass', 0),
  blue: rampMat('blue', 0),
  roofTerra: rampMat('orange', 0),
  roofPurple: rampMat('purple', 0),
  roofGreen: rampMat('leaf', 0),
  roofGrey: rampMat('grey', 1),
  roofFlat: mat('grey4', 'grey3', 'grey2'),
  glassLit: mat('blue2', 'blue2', 'blue1'),
  glassDark: mat('grey1', 'grey1', 'grey0'),
  glassWarm: mat('yellow3', 'yellow3', 'yellow2'),
  door: mat('brown2', 'brown1', 'brown0'),
  doorDark: mat('grey1', 'grey0', 'grey0'),
  white: mat('grey5', 'grey5', 'grey4'),
  sign: mat('yellow3', 'yellow2', 'yellow1'),
  skin: mat('skin0'),
} as const

export type MatName = keyof typeof M

// ---------------------------------------------------------------------------
// Context

export interface FloorCell {
  c: string
  /** colour of the cell's north-west edge pixels (joint along v) */
  nw?: string
  /** colour of the cell's north-east edge pixels (joint along u) */
  ne?: string
}

export interface Kit {
  d: DrawCtx
  rng: Rng
  /** footprint in tiles */
  fp: number
  /** footprint in units (16 fp) */
  N: number
  W: number
  H: number
  ox: number
  oy: number
  vox: Vox
  floor: (FloorCell | null)[]
  /** 2-D paint run after the voxel render (signs, glints) */
  overlays: ((img: Img) => void)[]
  /** internal-edge depth threshold (depthEdges) */
  edge: number
  /** paint the §1.2 shadow strip */
  shadow: boolean
  /** 'all' = silhouette outline; 'objects' = only voxel pixels (tiles keep
   *  seamless edges); 'none' */
  outline: 'all' | 'objects' | 'none'
}

export function newKit(
  d: DrawCtx,
  opts: { fp?: number; canvas?: [number, number]; ground?: boolean } = {},
): Kit {
  const [W, H] = opts.canvas ?? d.entry.canvas
  const fp = opts.fp ?? d.entry.footprint?.[0] ?? Math.round(W / 64)
  const N = 16 * fp
  const oy = H - 2 * N
  // tall enough for anything that still fits the canvas (voxel top row >= 0)
  const nz = oy + 2 * N
  return {
    d,
    rng: d.rng,
    fp,
    N,
    W,
    H,
    ox: W / 2,
    oy,
    vox: new Vox(N, N, nz),
    floor: Array.from<FloorCell | null>({ length: N * N }).fill(null),
    overlays: [],
    edge: 5,
    shadow: true,
    outline: 'all',
  }
}

export function setFloor(
  k: Kit,
  u: number,
  v: number,
  cell: FloorCell | null,
): void {
  if (u < 0 || v < 0 || u >= k.N || v >= k.N) return
  k.floor[v * k.N + u] = cell
}

export function floorAt(k: Kit, u: number, v: number): FloorCell | null {
  if (u < 0 || v < 0 || u >= k.N || v >= k.N) return null
  return k.floor[v * k.N + u] ?? null
}

/** paint a rectangle of floor cells */
export function floorRect(
  k: Kit,
  u0: number,
  v0: number,
  a: number,
  b: number,
  c: string | ((u: number, v: number) => FloorCell | string | null),
): void {
  for (let v = v0; v < v0 + b; v++) {
    for (let u = u0; u < u0 + a; u++) {
      const r = typeof c === 'function' ? c(u, v) : c
      setFloor(k, u, v, typeof r === 'string' ? { c: r } : r)
    }
  }
}

// ---------------------------------------------------------------------------
// Ground patches (style-guide §4.2: pavement / grass / concrete)

export type Ground =
  | 'pavement'
  | 'plaza'
  | 'grass'
  | 'concrete'
  | 'dirt'
  | 'asphalt'
  | 'sand'
  | 'water'
  | 'lawn'

/** One ground cell for the pattern `g` at (u, v); seeded noise via hash. */
export function groundCell(
  g: Ground,
  u: number,
  v: number,
  seed = 0,
): FloorCell {
  const h = cellHash(u, v, seed)
  switch (g) {
    case 'pavement': {
      const c: FloorCell = { c: 'grey4' }
      if (u % 4 === 0) c.nw = 'grey3'
      if (v % 4 === 0) c.ne = 'grey3'
      return c
    }
    case 'plaza': {
      const check = (Math.floor(u / 4) + Math.floor(v / 4)) % 2 === 0
      const c: FloorCell = { c: check ? 'grey4' : 'grey5' }
      if (u % 4 === 0) c.nw = 'grey3'
      if (v % 4 === 0) c.ne = 'grey3'
      return c
    }
    case 'concrete': {
      const c: FloorCell = { c: h % 23 === 0 ? 'grey2' : 'grey3' }
      if (u % 8 === 0) c.nw = 'grey2'
      if (v % 8 === 0) c.ne = 'grey2'
      return c
    }
    case 'asphalt':
      return { c: h % 29 === 0 ? 'grey2' : 'grey1' }
    case 'dirt':
      return { c: h % 7 === 0 ? 'brown2' : h % 11 === 0 ? 'brown3' : 'brown2' }
    case 'sand':
      return { c: h % 9 === 0 ? 'yellow2' : 'yellow3' }
    case 'water':
      return { c: h % 13 === 0 ? 'water2' : 'water1' }
    case 'lawn': {
      const stripe = Math.floor(u / 4) % 2 === 0
      return { c: stripe ? 'grass2' : 'grass3' }
    }
    case 'grass':
    default: {
      if (h % 17 === 0) return { c: 'grass3' }
      if (h % 19 === 0) return { c: 'grass1' }
      return { c: 'grass2' }
    }
  }
}

export function cellHash(u: number, v: number, seed: number): number {
  let h = (u * 73856093) ^ (v * 19349663) ^ (seed * 83492791)
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  h ^= h >>> 15
  return h >>> 0
}

export function plot(k: Kit, g: Ground, seed = 0): void {
  floorRect(k, 0, 0, k.N, k.N, (u, v) => groundCell(g, u, v, seed))
}

/** ground of the district (style-guide §4.2) */
export function districtGround(district: string | undefined): Ground {
  switch (district) {
    case 'downtown':
      return 'pavement'
    case 'highres':
      return 'pavement'
    case 'lowres':
    case 'civic':
    case 'rural':
      return 'grass'
    case 'industrial':
    case 'docks':
    case 'airport':
      return 'concrete'
    default:
      return 'pavement'
  }
}

/** a path of floor cells from (u0, v0) to the front edge along +v or +u */
export function floorPath(
  k: Kit,
  u0: number,
  v0: number,
  w: number,
  dir: 'u' | 'v',
  g: Ground | string,
): void {
  const cell = (u: number, v: number): FloorCell =>
    isGround(g) ? groundCell(g, u, v) : { c: g }
  if (dir === 'v') floorRect(k, u0, v0, w, k.N - v0, cell)
  else floorRect(k, u0, v0, k.N - u0, w, cell)
}

function isGround(g: string): g is Ground {
  return [
    'pavement',
    'plaza',
    'grass',
    'concrete',
    'dirt',
    'asphalt',
    'sand',
    'water',
    'lawn',
  ].includes(g)
}

// ---------------------------------------------------------------------------
// Boxes and faces

export interface Box {
  u0: number
  v0: number
  z0: number
  a: number
  b: number
  h: number
}

/** solid box; returns its record (top = z0 + h) */
export function box(
  k: Kit,
  u0: number,
  v0: number,
  z0: number,
  a: number,
  b: number,
  h: number,
  m: Mat,
): Box {
  k.vox.box(u0, v0, z0, a, b, h, m)
  return { u0, v0, z0, a, b, h }
}

export function top(b: Box): number {
  return b.z0 + b.h
}

/**
 * Visit the visible wall voxels of a box face. 'left' = the +v face
 * (v = v0 + b - 1, lit), 'right' = the +u face (u = u0 + a - 1).
 * `t` runs along the face (0 = the back end), z is absolute.
 */
export function onFace(
  bx: Box,
  face: 'left' | 'right',
  fn: (u: number, v: number, z: number, t: number) => void,
): void {
  const len = face === 'left' ? bx.a : bx.b
  for (let z = bx.z0; z < bx.z0 + bx.h; z++) {
    for (let t = 0; t < len; t++) {
      if (face === 'left') fn(bx.u0 + t, bx.v0 + bx.b - 1, z, t)
      else fn(bx.u0 + bx.a - 1, bx.v0 + t, z, t)
    }
  }
}

export function faceLen(bx: Box, face: 'left' | 'right'): number {
  return face === 'left' ? bx.a : bx.b
}

/** voxel position of face coordinate (t, z), offset `out` units outward */
export function facePos(
  bx: Box,
  face: 'left' | 'right',
  t: number,
  out = 0,
): [number, number] {
  return face === 'left'
    ? [bx.u0 + t, bx.v0 + bx.b - 1 + out]
    : [bx.u0 + bx.a - 1 + out, bx.v0 + t]
}

export interface WindowOpts {
  /** first window storey z (absolute), default box z0 + 2 */
  z?: number
  /** storey height (window rows repeat every `storey` units) */
  storey: number
  /** window height in units (rows) */
  wh?: number
  /** window width in units (1 unit = 2 px) */
  ww?: number
  /** units between window starts along the face */
  pitch?: number
  /** margin from the face ends */
  margin?: number
  /** fraction of lit panes */
  lit?: number
  /** storeys to skip at the top (e.g. parapet) */
  stopBelow?: number
  litMat?: Mat
  darkMat?: Mat
  /** sill under each window: a Mat, null = none, 'auto' (default) = the
   *  wall's own lighter shade (keeps the material at <= 3 shades) */
  sill?: Mat | null | 'auto'
  faces?: ('left' | 'right')[]
}

/** window grid on the visible faces of a box (style-guide §4.2 windows) */
export function windows(k: Kit, bx: Box, o: WindowOpts): void {
  const wh = o.wh ?? 2
  const ww = o.ww ?? 1
  const pitch = o.pitch ?? 3
  const margin = o.margin ?? 1
  const lit = o.lit ?? 0.6
  const zFirst = o.z ?? bx.z0 + 2
  const zStop = bx.z0 + bx.h - (o.stopBelow ?? 1)
  const litMat = o.litMat ?? M.glassLit
  const darkMat = o.darkMat ?? M.glassDark
  for (const face of o.faces ?? ['left', 'right']) {
    const len = faceLen(bx, face)
    const usable = len - 2 * margin
    const n = Math.max(0, Math.floor((usable - ww) / pitch) + 1)
    const span = (n - 1) * pitch + ww
    const start = margin + Math.floor((usable - span) / 2)
    for (let z = zFirst; z + wh <= zStop; z += o.storey) {
      for (let i = 0; i < n; i++) {
        const t0 = start + i * pitch
        const m = k.rng.chance(lit) ? litMat : darkMat
        for (let dt = 0; dt < ww; dt++) {
          const [u, v] = facePos(bx, face, t0 + dt)
          const sill = o.sill === undefined ? 'auto' : o.sill
          if (sill === 'auto') {
            const cur = k.vox.matAt(u, v, z - 1)
            if (cur) k.vox.set(u, v, z - 1, mat(cur.top, cur.top, cur.left))
          } else if (sill) k.vox.set(u, v, z - 1, sill)
          for (let dz = 0; dz < wh; dz++) k.vox.set(u, v, z + dz, m)
        }
      }
    }
  }
}

/** a band (string course) of material `m` around the visible faces */
export function band(k: Kit, bx: Box, z: number, h: number, m: Mat): void {
  for (const face of ['left', 'right'] as const) {
    for (let t = 0; t < faceLen(bx, face); t++) {
      const [u, v] = facePos(bx, face, t)
      for (let dz = 0; dz < h; dz++) k.vox.set(u, v, z + dz, m)
    }
  }
}

/** door: `w` x `h` units of material on a face at face coordinate t0 */
export function door(
  k: Kit,
  bx: Box,
  face: 'left' | 'right',
  t0: number,
  w = 2,
  h = 5,
  m: Mat = M.door,
): void {
  for (let dt = 0; dt < w; dt++) {
    const [u, v] = facePos(bx, face, t0 + dt)
    for (let dz = 0; dz < h; dz++) k.vox.set(u, v, bx.z0 + dz, m)
  }
}

/**
 * Awning: a sloped striped canopy projecting `depth` units from a face at
 * height z (its top edge at the wall), stripes alternate every `stripe`.
 */
export function awning(
  k: Kit,
  bx: Box,
  face: 'left' | 'right',
  z: number,
  t0: number,
  len: number,
  depth: number,
  a: Mat,
  b: Mat,
  stripe = 1,
): void {
  for (let t = t0; t < t0 + len; t++) {
    const m = Math.floor((t - t0) / stripe) % 2 === 0 ? a : b
    for (let o = 1; o <= depth; o++) {
      const [u, v] = facePos(bx, face, t, o)
      const zz = z - Math.floor((o - 1) / 2)
      k.vox.set(u, v, zz, m)
    }
  }
}

/** projecting slab (balcony / canopy) with an optional rail on the edge */
export function balcony(
  k: Kit,
  bx: Box,
  face: 'left' | 'right',
  z: number,
  t0: number,
  len: number,
  depth: number,
  slab: Mat,
  rail: Mat | null,
): void {
  for (let t = t0; t < t0 + len; t++) {
    for (let o = 1; o <= depth; o++) {
      const [u, v] = facePos(bx, face, t, o)
      k.vox.set(u, v, z, slab)
      if (rail && (o === depth || t === t0 || t === t0 + len - 1)) {
        k.vox.set(u, v, z + 1, rail)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Roofs

/** flat roof: recolour the top layer, parapet ring of `h` units */
export function roofFlat(
  k: Kit,
  bx: Box,
  roof: Mat = M.roofFlat,
  parapet: Mat | null = null,
  ph = 1,
): void {
  const z = top(bx) - 1
  k.vox.paint(bx.u0, bx.v0, z, bx.a, bx.b, 1, roof)
  if (!parapet) return
  for (let u = bx.u0; u < bx.u0 + bx.a; u++) {
    for (let v = bx.v0; v < bx.v0 + bx.b; v++) {
      const edge =
        u === bx.u0 ||
        v === bx.v0 ||
        u === bx.u0 + bx.a - 1 ||
        v === bx.v0 + bx.b - 1
      if (edge) k.vox.box(u, v, z + 1, 1, 1, ph, parapet)
    }
  }
}

/**
 * Gable roof over a box. axis 'u' = ridge along u (gables on the right
 * faces), 'v' = ridge along v (gable on the left face). `pitch` z units per
 * unit of run; `over` = eave overhang in units. Slope facing the light
 * (+v / -u) uses the ramp's light shade.
 */
export function roofGable(
  k: Kit,
  bx: Box,
  axis: 'u' | 'v',
  roof: Mat,
  wall: Mat,
  pitch = 1,
  over = 1,
): number {
  const z0 = top(bx)
  const span = axis === 'u' ? bx.b : bx.a
  const half = span / 2
  const L = roof.top
  const Mi = roof.left
  const D = roof.right
  // axis u: slopes face +v (lit) / -v; axis v: slopes face +u / -u (lit)
  const frontM = axis === 'u' ? mat(L, L, D) : mat(Mi, D, Mi)
  const backM = axis === 'u' ? mat(Mi, Mi, D) : mat(L, D, Mi)
  const gableWall = mat(wall.top, wall.left, wall.right)
  let peak = 0
  const along0 = (axis === 'u' ? bx.u0 : bx.v0) - over
  const alongN = (axis === 'u' ? bx.a : bx.b) + 2 * over
  for (let s = 0; s < span; s++) {
    const dist = Math.min(s + 1, span - s)
    const rise = Math.max(1, Math.round(dist * pitch))
    peak = Math.max(peak, rise)
    const front = s + 0.5 >= half
    for (let a = 0; a < alongN; a++) {
      const al = along0 + a
      const end = a < over || a >= alongN - over
      const [u, v] = axis === 'u' ? [al, bx.v0 + s] : [bx.u0 + s, al]
      for (let dz = 0; dz < rise; dz++) {
        const surface = dz >= rise - 1 - Math.ceil(pitch) + 1
        if (end && !surface) continue
        let m: Mat
        if (surface) m = front ? frontM : backM
        else m = gableWall
        k.vox.set(u, v, z0 + dz, m)
      }
    }
  }
  return z0 + peak
}

/** hip roof: slopes on all four sides (pyramid when square) */
export function roofHip(
  k: Kit,
  bx: Box,
  roof: Mat,
  pitch = 1,
  over = 0,
  maxRise = Infinity,
): number {
  const z0 = top(bx)
  const u0 = bx.u0 - over
  const v0 = bx.v0 - over
  const a = bx.a + 2 * over
  const b = bx.b + 2 * over
  const L = roof.top
  const Mi = roof.left
  const D = roof.right
  const sw = mat(L, L, D) // slope facing +v (lit)
  const ne = mat(Mi, Mi, D) // slope facing -v
  const se = mat(Mi, D, Mi) // slope facing +u
  const nw = mat(L, D, Mi) // slope facing -u
  let peak = 0
  for (let v = 0; v < b; v++) {
    for (let u = 0; u < a; u++) {
      const du = Math.min(u + 1, a - u)
      const dv = Math.min(v + 1, b - v)
      const raw = Math.max(1, Math.round(Math.min(du, dv) * pitch))
      const rise = Math.min(raw, maxRise)
      peak = Math.max(peak, rise)
      // which side the cell slopes toward (flat mansard top = lit)
      let m: Mat
      if (raw > maxRise) m = mat(L, Mi, D)
      else if (dv <= du) m = v + 0.5 >= b / 2 ? sw : ne
      else m = u + 0.5 >= a / 2 ? se : nw
      for (let dz = 0; dz < rise; dz++) k.vox.set(u0 + u, v0 + v, z0 + dz, m)
    }
  }
  return z0 + peak
}

/** sawtooth roof: `teeth` ridges along u, glazed vertical faces facing +u */
export function roofSawtooth(
  k: Kit,
  bx: Box,
  teeth: number,
  roof: Mat,
  glass: Mat = M.glassLit,
  rise = 5,
): number {
  const z0 = top(bx)
  const len = bx.a / teeth
  for (let i = 0; i < teeth; i++) {
    const s0 = Math.round(i * len)
    const s1 = Math.round((i + 1) * len)
    for (let u = s0; u < s1; u++) {
      const f = (u - s0 + 1) / (s1 - s0)
      const hgt = Math.max(1, Math.round(f * rise))
      const last = u === s1 - 1
      for (let v = 0; v < bx.b; v++) {
        for (let dz = 0; dz < hgt; dz++) {
          const m = last && dz > 0 ? glass : roof
          k.vox.set(bx.u0 + u, bx.v0 + v, z0 + dz, m)
        }
      }
    }
  }
  return z0 + rise
}

/** dome (half ellipsoid) centred on a box top */
export function roofDome(
  k: Kit,
  bx: Box,
  r: number,
  hz: number,
  m: Mat,
): number {
  const cu = bx.u0 + bx.a / 2
  const cv = bx.v0 + bx.b / 2
  const z0 = top(bx)
  k.vox.blob(cu, cv, z0, r, r, hz, (_u, _v, z) => (z >= z0 ? m : null))
  return z0 + hz
}

// ---------------------------------------------------------------------------
// Extras

/**
 * Chimney whose top-face centre lands on the canvas pixel (sx, sy): a
 * `w` x `w` column at depth s = u + v (the caller picks s so it stands on
 * or behind the building); returns the voxel column used.
 */
export function chimneyAt(
  k: Kit,
  sx: number,
  sy: number,
  s: number,
  w: number,
  m: Mat,
  capM: Mat = M.darkMetal,
): { u: number; v: number; zTop: number } {
  const diff = (sx - k.ox) / 2 // u - v of the column's centre
  // w x w column [u, u+w) x [v, v+w): centre x = ox + 2((u - v)), centre row
  // of its top face = oy + (u + v) + (w - 1) - zTop - 1 + 1
  const u = Math.round((s + diff) / 2 - (w - 1) / 2)
  const v = u - Math.round(diff)
  const zTop = k.oy + u + v + (w - 1) - sy
  k.vox.box(u, v, 0, w, w, zTop, m)
  k.vox.box(u, v, zTop, w, w, 1, capM)
  return { u, v, zTop }
}

/** plain chimney stack on a roof */
export function chimney(
  k: Kit,
  u: number,
  v: number,
  z0: number,
  h: number,
  m: Mat = M.brick,
  w = 2,
): void {
  k.vox.box(u, v, z0, w, w, h, m)
  k.vox.box(u, v, z0 + h, w, w, 1, M.darkMetal)
}

/** water tank on legs (style-guide §4.2 extras) */
export function waterTank(
  k: Kit,
  cu: number,
  cv: number,
  z0: number,
  m: Mat = M.wood,
): void {
  for (const [du, dv] of [
    [-2, -2],
    [1, -2],
    [-2, 1],
    [1, 1],
  ] as const) {
    k.vox.box(Math.floor(cu) + du, Math.floor(cv) + dv, z0, 1, 1, 4, M.metal)
  }
  k.vox.cylinder(cu, cv, z0 + 4, 2.6, 6, m)
  k.vox.cylinder(cu, cv, z0 + 10, 1.6, 1, M.darkMetal)
  k.vox.set(Math.floor(cu), Math.floor(cv), z0 + 11, M.darkMetal)
}

/** antenna mast with a beacon */
export function antenna(
  k: Kit,
  u: number,
  v: number,
  z0: number,
  h: number,
  beacon: Mat = M.sign,
): void {
  k.vox.box(u, v, z0, 1, 1, h, M.metal)
  k.vox.set(u, v, z0 + h, beacon)
}

/** silo: cylinder with a domed cap */
export function silo(
  k: Kit,
  cu: number,
  cv: number,
  r: number,
  h: number,
  body: Mat,
  cap: Mat,
): void {
  k.vox.cylinder(cu, cv, 0, r, h, body)
  k.vox.blob(cu, cv, h, r, r, Math.max(2, r * 0.7), (_u, _v, z) =>
    z >= h ? cap : null,
  )
}

/** deciduous tree: trunk + leafy blob (crown radius r) */
export function tree(
  k: Kit,
  u: number,
  v: number,
  r = 3,
  trunk = 3,
  crown: Mat = M.leaf,
  z0 = 0,
): void {
  k.vox.box(u, v, z0, 1, 1, trunk + 1, M.woodDark)
  const cz = z0 + trunk + r * 1.1
  const rz = r * 1.25
  // a main crown plus two seeded lobes; leafy notches on the surface
  k.vox.blob(u + 0.5, v + 0.5, cz, r, r, rz, crown)
  const lobes = r >= 2 ? 2 : 0
  for (let i = 0; i < lobes; i++) {
    const du = k.rng.int(-1, 1) * r * 0.45
    const dv = k.rng.int(-1, 1) * r * 0.45
    k.vox.blob(
      u + 0.5 + du,
      v + 0.5 + dv,
      cz + r * 0.35,
      r * 0.7,
      r * 0.7,
      rz * 0.7,
      crown,
    )
  }
  const R = Math.ceil(r) + 1
  for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz + r); z++) {
    for (let vv = v - R; vv <= v + R; vv++) {
      for (let uu = u - R; uu <= u + R; uu++) {
        if (!k.vox.filled(uu, vv, z) || k.vox.filled(uu, vv, z + 1)) continue
        if (k.vox.matAt(uu, vv, z)?.top !== crown.top) continue
        const h = (uu * 7 + vv * 13 + z * 5) % 9
        if (h === 0 && r > 1.5) k.vox.set(uu, vv, z, null)
      }
    }
  }
}

/** conifer: stacked shrinking discs */
export function pine(
  k: Kit,
  u: number,
  v: number,
  h = 10,
  r = 3,
  z0 = 0,
): void {
  k.vox.box(u, v, z0, 1, 1, 2, M.woodDark)
  for (let z = 0; z < h; z++) {
    const rr = r * (1 - z / h) + 0.4
    k.vox.cylinder(u + 0.5, v + 0.5, z0 + 2 + z, rr, 1, M.leaf)
  }
}

/** low hedge / planter row along u or v */
export function hedge(
  k: Kit,
  u0: number,
  v0: number,
  len: number,
  dir: 'u' | 'v',
  h = 2,
  m: Mat = M.leaf,
): void {
  if (dir === 'u') k.vox.box(u0, v0, 0, len, 1, h, m)
  else k.vox.box(u0, v0, 0, 1, len, h, m)
}

/** small flat sign board standing on a face (no text, §1.3.6) */
export function faceSign(
  k: Kit,
  bx: Box,
  face: 'left' | 'right',
  t0: number,
  len: number,
  z: number,
  h: number,
  m: Mat = M.sign,
): void {
  for (let t = t0; t < t0 + len; t++) {
    const [u, v] = facePos(bx, face, t, 1)
    for (let dz = 0; dz < h; dz++) k.vox.set(u, v, z + dz, m)
  }
}

/** billboard on posts standing on a roof, facing +v (the lit side) */
export function billboard(
  k: Kit,
  u0: number,
  v: number,
  z0: number,
  len: number,
  h: number,
  m: Mat = M.sign,
): void {
  k.vox.box(u0 + 1, v, z0, 1, 1, 3, M.metal)
  k.vox.box(u0 + len - 2, v, z0, 1, 1, 3, M.metal)
  k.vox.box(u0, v, z0 + 3, len, 1, h, m)
  k.vox.box(u0, v, z0 + 3 + h, len, 1, 1, M.metal)
}

/** flag pole with a small flag */
export function flag(
  k: Kit,
  u: number,
  v: number,
  z0: number,
  h: number,
  cloth: Mat,
): void {
  k.vox.box(u, v, z0, 1, 1, h, M.white)
  for (let i = 1; i <= 4; i++) {
    k.vox.box(u, v + i, z0 + h - 3, 1, 1, 3, cloth)
  }
}

/** row of free-standing columns in front of a face (civic portico) */
export function colonnade(
  k: Kit,
  bx: Box,
  face: 'left' | 'right',
  h: number,
  pitch = 3,
  m: Mat = M.white,
  depth = 2,
): void {
  const len = faceLen(bx, face)
  for (let t = 1; t < len - 1; t += pitch) {
    const [u, v] = facePos(bx, face, t, depth)
    k.vox.box(u, v, 0, 1, 1, h, m)
  }
  // entablature over the columns
  for (let t = 0; t < len; t++) {
    for (let o = 1; o <= depth; o++) {
      const [u, v] = facePos(bx, face, t, o)
      k.vox.box(u, v, h, 1, 1, 2, m)
    }
  }
}

// ---------------------------------------------------------------------------
// Finish

/** render the kit into an Img (floor, voxels, edges, outline, shadow) */
export function finish(k: Kit): Img {
  const img = newImg(k.W, k.H)
  // floor cells: 4x2 pixel blocks with optional edge joints
  for (let v = 0; v < k.N; v++) {
    for (let u = 0; u < k.N; u++) {
      const cell = k.floor[v * k.N + u]
      if (!cell) continue
      const x0 = k.ox + 2 * (u - v) - 2
      const y0 = k.oy + u + v
      const ci = pidx(cell.c)
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 4; i++) {
          const x = x0 + i
          const y = y0 + j
          if (!inside(img, x, y)) continue
          let c = ci
          if (j === 0 && i < 2 && cell.nw) c = pidx(cell.nw)
          if (j === 0 && i >= 2 && cell.ne) c = pidx(cell.ne)
          img.px[y * img.w + x] = c
          img.depth[y * img.w + x] = FLOOR_DEPTH
        }
      }
    }
  }
  renderVox(img, k.vox, k.ox, k.oy)
  if (k.edge > 0) depthEdges(img, k.edge)
  for (const o of k.overlays) o(img)
  if (k.outline === 'all') outlineImg(img)
  else if (k.outline === 'objects') outlineObjects(img)
  if (k.shadow) shadowStrip(img, k.ox, k.H - 1, k.N * 4)
  return img
}

/** outline only non-floor pixels that touch transparency (tile props) */
export function outlineObjects(img: Img, id = 'outline'): void {
  const o = pidx(id)
  const marks: number[] = []
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const k = y * img.w + x
      if ((img.px[k] as number) < 0) continue
      if ((img.depth[k] as number) <= FLOOR_DEPTH) continue
      const near = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const
      if (near.some(([nx, ny]) => !opaque(img, nx, ny))) marks.push(k)
    }
  }
  for (const k of marks) img.px[k] = o
}

/** highest canvas row a voxel of the kit reaches (negative = clipped) */
export function topRow(k: Kit): number {
  let best = Infinity
  const { vox } = k
  for (let z = vox.nz - 1; z >= 0; z--) {
    for (let v = 0; v < vox.nv; v++) {
      for (let u = 0; u < vox.nu; u++) {
        if (!vox.filled(u, v, z)) continue
        best = Math.min(best, k.oy + u + v - z - 1)
      }
    }
  }
  return best
}
