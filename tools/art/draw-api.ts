// THE DRAW CONTRACT — every procedural generator in tools/art obeys this.
//
//   import { registerDrawer } from './drawers.ts'
//   import { type Drawer, frame, fill } from './draw-api.ts'
//   const drawVan: Drawer = (d) =>
//     d.entry.frames.map((suffix) => {
//       const { canvas, ctx } = d.newCanvas(d.entry.canvas[0], d.entry.canvas[1])
//       fill(ctx, d, 'blue1', 4, 8, 20, 12)
//       return { suffix, canvas }
//     })
//   registerDrawer({ id: 'van' }, drawVan)
//
// Rules
// 1. A Drawer receives a DrawCtx and returns one DrawnFrame per suffix in
//    d.entry.frames (same order, same strings; '' = the single frame). Each
//    canvas is exactly d.entry.canvas ([w, h]). Variants (_locked) are NOT
//    drawn: the variants pass derives them. `vlr art:draw` rejects a missing,
//    extra or mis-sized frame and falls back to the generic placeholder.
// 2. Determinism: all randomness comes from d.rng (= mulberry32(hash(id)));
//    no Math.random, Date or environment reads. Same input -> same pixels.
// 3. Colours: palette ids only, through d.hex(id) / the helpers below, and
//    only ids of d.subset (= subsetFor(class, {district}); style-guide §1.4:
//    red = danger, mal/gold reserved, water not on buildings).
// 4. Pixels: integer fillRect / setPixel only; no paths, arcs, strokes,
//    text, scaling or alpha < 1 (they anti-alias; lint A02 fails semi-alpha).
//    Transparent = untouched. The 1-px `outline` around the silhouette may be
//    left to the outline pass (or drawn with outlineSilhouette()).
// 5. City classes paint their own footprint diamond (ground patch included);
//    the anchor = the diamond's bottom vertex = canvas bottom-centre
//    (style-guide §1.5). Use footprintDiamond() for it.
// 6. Drawers register by id (exact string or RegExp) or by class; id matches
//    win over class matches (drawers.ts). Unmatched entries get fallback.ts.

import { createCanvas } from '@napi-rs/canvas'
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas'
import type { ManifestEntry } from './manifest.ts'
import type { Palette, PaletteColor } from './palette.ts'
import type { Rng } from './rng.ts'

export type { Canvas, SKRSContext2D } from '@napi-rs/canvas'

/** suffix from entry.frames (e.g. '_ne_0', '_f2', '') */
export interface DrawnFrame {
  suffix: string
  canvas: Canvas
}

export interface DrawCtx {
  entry: ManifestEntry
  /** mulberry32(hash(entry.id)) */
  rng: Rng
  pal: Palette
  /** the colours this entry may use: subsetFor(class, {district}) */
  subset: readonly PaletteColor[]
  /** '#rrggbb' of a palette id; throws on unknown ids and on ids outside subset */
  hex(name: string): string
  /** a transparent canvas with image smoothing off */
  newCanvas(w: number, h: number): { canvas: Canvas; ctx: SKRSContext2D }
}

export type Drawer = (d: DrawCtx) => DrawnFrame[]

/** Options passed to every build step module's run(opts). */
export interface StepOpts {
  /** --ids a,b,c (null = all entries) */
  ids: string[] | null
  /** --offline: never call PixelLab */
  offline: boolean
  /** --n candidates per sprite (default 3) */
  n: number
  /** positional args after the subcommand */
  args: string[]
  /** repo root, absolute, with a trailing slash */
  root: string
}

/** A build step module (tools/art/<step>.ts) exports this. */
export type StepRun = (opts: StepOpts) => number | void | Promise<number | void>

export function makeCanvas(
  w: number,
  h: number,
): { canvas: Canvas; ctx: SKRSContext2D } {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  return { canvas, ctx }
}

// ---------------------------------------------------------------------------
// Pixel helpers. `c` is a palette id ('grass1') resolved via d.hex.

type Col = string

/** fillRect with a palette id (integer coords). */
export function fill(
  ctx: SKRSContext2D,
  d: DrawCtx,
  c: Col,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (w <= 0 || h <= 0) return
  ctx.fillStyle = d.hex(c)
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

/** one pixel */
export function setPixel(
  ctx: SKRSContext2D,
  d: DrawCtx,
  c: Col,
  x: number,
  y: number,
): void {
  fill(ctx, d, c, x, y, 1, 1)
}

/** horizontal run [x0, x1] inclusive */
export function hline(
  ctx: SKRSContext2D,
  d: DrawCtx,
  c: Col,
  x0: number,
  x1: number,
  y: number,
): void {
  fill(ctx, d, c, Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1)
}

/** vertical run [y0, y1] inclusive */
export function vline(
  ctx: SKRSContext2D,
  d: DrawCtx,
  c: Col,
  x: number,
  y0: number,
  y1: number,
): void {
  fill(ctx, d, c, x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1)
}

/** Bresenham line, 1 px, no anti-aliasing. */
export function line(
  ctx: SKRSContext2D,
  d: DrawCtx,
  c: Col,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  let x = Math.round(x0)
  let y = Math.round(y0)
  const xe = Math.round(x1)
  const ye = Math.round(y1)
  const dx = Math.abs(xe - x)
  const dy = -Math.abs(ye - y)
  const sx = x < xe ? 1 : -1
  const sy = y < ye ? 1 : -1
  let err = dx + dy
  for (;;) {
    setPixel(ctx, d, c, x, y)
    if (x === xe && y === ye) break
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

/**
 * Row spans of a 2:1 iso diamond `w` px wide (h = w/2), stair-stepped in
 * 2-px runs. Row r (0 = top) covers [cx - half(r), cx + half(r) - 1] where
 * cx = left + w/2. Returns [x0, x1] per row, inclusive.
 */
export function diamondSpans(w: number): [number, number][] {
  const h = w / 2
  const spans: [number, number][] = []
  for (let r = 0; r < h; r++) {
    const k = r < h / 2 ? r : h - 1 - r
    const half = 2 * (k + 1)
    spans.push([w / 2 - half, w / 2 + half - 1])
  }
  return spans
}

/**
 * Fill a 2:1 diamond `w` px wide whose bottom vertex row is `bottomY` and
 * whose centre column pair is (cx - 1, cx). For a city sprite:
 * footprintDiamond(ctx, d, c, W / 2, H - 1, 64 * footprint[0]).
 */
export function footprintDiamond(
  ctx: SKRSContext2D,
  d: DrawCtx,
  c: Col,
  cx: number,
  bottomY: number,
  w: number,
): void {
  const spans = diamondSpans(w)
  const top = bottomY - spans.length + 1
  spans.forEach(([x0, x1], r) => {
    fill(ctx, d, c, cx - w / 2 + x0, top + r, x1 - x0 + 1, 1)
  })
}

/**
 * Outline pass for one canvas: every opaque pixel that touches a transparent
 * pixel (4-neighbour, canvas edge counts as transparent) becomes `c`.
 */
export function outlineSilhouette(
  ctx: SKRSContext2D,
  d: DrawCtx,
  w: number,
  h: number,
  c: Col = 'outline',
): void {
  const img = ctx.getImageData(0, 0, w, h)
  const a = img.data
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && (a[(y * w + x) * 4 + 3] ?? 0) > 0
  const edge: [number, number][] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue
      if (
        !opaque(x - 1, y) ||
        !opaque(x + 1, y) ||
        !opaque(x, y - 1) ||
        !opaque(x, y + 1)
      ) {
        edge.push([x, y])
      }
    }
  }
  for (const [x, y] of edge) setPixel(ctx, d, c, x, y)
}

/** the same picture for every suffix of entry.frames */
export function sameForAllFrames(
  d: DrawCtx,
  paint: (ctx: SKRSContext2D, frameIndex: number, suffix: string) => void,
): DrawnFrame[] {
  const [w, h] = d.entry.canvas
  return d.entry.frames.map((suffix, i) => {
    const { canvas, ctx } = d.newCanvas(w, h)
    paint(ctx, i, suffix)
    return { suffix, canvas }
  })
}
