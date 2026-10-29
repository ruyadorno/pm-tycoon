// Generic placeholder drawer: used by `vlr art:draw` for any manifest entry
// no generator module claims, so `draw` always completes and every frame of
// the manifest exists. Palette-exact, deterministic, grid-exact (footprint
// diamond + anchor for city classes, 1-px transparent margin elsewhere), but
// deliberately plain: a flat box/diamond in a seeded ramp with an outline.

import {
  type DrawCtx,
  type DrawnFrame,
  type Drawer,
  type SKRSContext2D,
  diamondSpans,
  fill,
  footprintDiamond,
  outlineSilhouette,
} from './draw-api.ts'
import { HEIGHT_BUDGET } from './manifest.ts'

/** Ramps with >= 3 shades usable as a body (never reserved/red/water). */
const BODY_RAMPS = [
  'orange',
  'yellow',
  'blue',
  'purple',
  'brown',
  'grey',
  'leaf',
  'grass',
]

/** [dark, mid, light] palette ids of a seeded ramp allowed for the entry */
function bodyShades(d: DrawCtx, preferred?: string): [string, string, string] {
  const allowed = new Set(d.subset.map((c) => c.ramp))
  const choices = BODY_RAMPS.filter((r) => allowed.has(r))
  const ramp =
    preferred && allowed.has(preferred) ? preferred : d.rng.pick(choices)
  const ids = d.pal.ramp(ramp).map((c) => c.id)
  const base = ids.length >= 4 ? d.rng.int(0, ids.length - 3) : 0
  return [ids[base], ids[base + 1], ids[base + 2]] as [string, string, string]
}

/** [top, bottom] inclusive rows of column x of a diamond w wide */
function columnSpan(w: number, x: number): [number, number] {
  const h = w / 2
  const j = x < w / 2 ? x : w - 1 - x
  const kMin = Math.max(0, Math.ceil((w / 2 - j) / 2) - 1)
  return [kMin, h - 1 - kMin]
}

/**
 * Iso box standing on a diamond `bw` wide whose bottom vertex is at row
 * `by`, centre between columns cx-1 and cx, `bh` px tall.
 * Faces per style-guide §1.2: top = light, left = mid, right = dark.
 */
function isoBox(
  ctx: SKRSContext2D,
  d: DrawCtx,
  shades: [string, string, string],
  cx: number,
  by: number,
  bw: number,
  bh: number,
): void {
  const [dark, mid, light] = shades
  const top = by - bw / 2 + 1
  const left = cx - bw / 2
  for (let x = 0; x < bw; x++) {
    const [, b] = columnSpan(bw, x)
    fill(ctx, d, x < bw / 2 ? mid : dark, left + x, top + b - bh, 1, bh + 1)
  }
  footprintDiamond(ctx, d, light, cx, by - bh, bw)
}

function groundId(d: DrawCtx): string {
  const id = d.entry.id
  const has = (name: string) => d.subset.some((c) => c.id === name)
  if (/water|sea|lake|shore/.test(id) && has('water1')) return 'water1'
  if (/grass|pasture|tree|field|lawn/.test(id)) return 'grass1'
  if (/sand|beach|dirt/.test(id)) return 'brown3'
  if (/road|tarmac|runway|lot|quay/.test(id)) return 'grey2'
  const district = d.entry.district ?? ''
  if (['lowres', 'rural', 'civic'].includes(district)) return 'grass1'
  if (['industrial', 'docks', 'airport'].includes(district)) return 'grey2'
  return 'grey3'
}

function drawTile(ctx: SKRSContext2D, d: DrawCtx, i: number): void {
  const [w, h] = d.entry.canvas
  footprintDiamond(ctx, d, groundId(d), w / 2, h - 1, w)
  // frame marker: animated tiles differ by a 2-px fleck per frame
  if (d.entry.frames.length > 1) {
    fill(ctx, d, 'grey4', w / 2 - 8 + 4 * (i % 4), h / 2, 2, 1)
  }
}

function drawCity(ctx: SKRSContext2D, d: DrawCtx): void {
  const [w, h] = d.entry.canvas
  const fw = d.entry.footprint?.[0] ?? Math.round(w / 64)
  const gw = 64 * fw
  const cx = w / 2
  const by = h - 1
  // ground patch: the full footprint diamond
  footprintDiamond(ctx, d, groundId(d), cx, by, gw)
  // shadow strip: 2 px of outline along the right (south-east) base edge
  const left = cx - gw / 2
  const top = by - gw / 2 + 1
  for (let x = gw / 2; x < gw; x++) {
    const [, b] = columnSpan(gw, x)
    fill(ctx, d, 'outline', left + x, top + b - 1, 1, 2)
  }
  // body: a box inset 8 px per side (4 rows) on the footprint
  const bw = gw - 16
  const budget = HEIGHT_BUDGET[d.entry.class] ?? Math.max(16, h - gw / 2 - 8)
  const bh = Math.max(12, Math.round(budget * (0.45 + 0.45 * d.rng.next())))
  isoBox(ctx, d, bodyShades(d), cx, by - 4, bw, Math.min(bh, h - bw / 2 - 6))
}

function drawVehicle(ctx: SKRSContext2D, d: DrawCtx, i: number): void {
  const [w, h] = d.entry.canvas
  const bw = d.entry.class === 'vehicle-bike' ? 8 : w - 12
  const bh = d.entry.class === 'vehicle-bike' ? 10 : Math.round(h / 3)
  const ramp = d.entry.bodyRamp
  isoBox(ctx, d, bodyShades(d, ramp), w / 2, h - 5, bw, bh)
  // wheel frame: hubs shift 1 px on odd frames
  const off = i % 2
  fill(ctx, d, 'outline', w / 2 - bw / 2 + 1 + off, h - 5, 2, 2)
  fill(ctx, d, 'outline', w / 2 + bw / 2 - 3 - off, h - 5, 2, 2)
}

function drawFlat(ctx: SKRSContext2D, d: DrawCtx, i: number): void {
  const [w, h] = d.entry.canvas
  const m = w >= 8 && h >= 8 ? 1 : 0
  const [dark, mid, light] = bodyShades(d)
  fill(ctx, d, mid, m, m, w - 2 * m, h - 2 * m)
  // top-left light, bottom/right dark bevel (style-guide §1.2 interior light)
  if (w >= 6 && h >= 6) {
    fill(ctx, d, light, m + 1, m + 1, w - 2 * m - 2, 1)
    fill(ctx, d, dark, m + 1, h - m - 2, w - 2 * m - 2, 1)
  }
  // frame marker so frame sets are visibly distinct
  if (d.entry.frames.length > 1 && w >= 8 && h >= 8) {
    const step = Math.max(
      1,
      Math.floor((w - 2 * m - 6) / d.entry.frames.length),
    )
    fill(
      ctx,
      d,
      dark,
      m + 2 + ((i * step) % Math.max(1, w - 2 * m - 6)),
      m + 3,
      2,
      2,
    )
  }
}

function drawProp(ctx: SKRSContext2D, d: DrawCtx): void {
  const [w, h] = d.entry.canvas
  if (h <= 48) {
    drawFlat(ctx, d, 0)
    return
  }
  // trunk/pole + crown, anchored bottom-centre
  const [dark, mid, light] = bodyShades(
    d,
    /tree|bush/.test(d.entry.id) ? 'leaf' : undefined,
  )
  fill(ctx, d, 'brown1', w / 2 - 2, h - 24, 4, 23)
  const cw = Math.min(w - 4, 28)
  const ch = Math.min(h - 28, 32)
  fill(ctx, d, mid, w / 2 - cw / 2, h - 24 - ch, cw, ch)
  fill(ctx, d, light, w / 2 - cw / 2 + 2, h - 24 - ch + 2, cw / 2 - 2, 2)
  fill(ctx, d, dark, w / 2, h - 26, cw / 2, 2)
}

function paintFrame(ctx: SKRSContext2D, d: DrawCtx, i: number): void {
  const cls = d.entry.class
  if (cls === 'tile') drawTile(ctx, d, i)
  else if (cls.startsWith('building') || cls === 'warehouse-ext')
    drawCity(ctx, d)
  else if (cls.startsWith('vehicle-')) drawVehicle(ctx, d, i)
  else if (cls === 'prop') drawProp(ctx, d)
  else drawFlat(ctx, d, i)
}

/** Tiles tile seamlessly: no silhouette outline on ground/floor tiles. */
const NO_OUTLINE = new Set(['tile', 'interior-tile'])

export const fallbackDrawer: Drawer = (d: DrawCtx): DrawnFrame[] => {
  const [w, h] = d.entry.canvas
  // diamondSpans is the shared geometry; touch it so widths stay in sync
  if (d.entry.class === 'tile' && diamondSpans(w).length !== h) {
    throw new Error(`fallback: tile canvas ${w}x${h} is not 2:1`)
  }
  return d.entry.frames.map((suffix, i) => {
    const { canvas, ctx } = d.newCanvas(w, h)
    // same seeded stream for every frame: frames differ only by frame index
    paintFrame(ctx, { ...d, rng: d.rng.fork('fallback') }, i)
    if (!NO_OUTLINE.has(d.entry.class)) outlineSilhouette(ctx, d, w, h)
    return { suffix, canvas }
  })
}
