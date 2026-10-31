// The original 48-colour palette (style-guide.md §1.8) and the colour rules of
// §1.4 (one meaning per colour) used by every drawer, quantize and lint.
//
// - PALETTE: art/palette.json loaded once (ids like 'grass1', 'outline').
// - subsetFor(class, {district}): the colours a class may use. Implements
//   §1.8 (reserved mal/gold only in parcel, icon16, ui) and §1.4/A07 (red =
//   danger only: parcel, icon16, ui, fx and the interior classes; water only
//   on tile, dock-prop, ui/icon16/parcel/fx and docks-district buildings).
// - nearest(rgb, subset): nearest colour in RGB (no dithering), §3.7 quantize.
// - fogColor(hex): the locked-region look (spec §3.5): 45 % toward grey5, fully
//   desaturated, re-quantized to the nearest grey ramp colour. Computed, never
//   hand-picked; FOG_MAP holds it for every palette colour.
// - renderSwatch(): art/palette.png (48 x 1 at 1x, usable as a PixelLab
//   color_image) + art/contact/palette-ramps@4x.png (15 ramps + fog row).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import type { AssetClass } from './manifest.ts'

export type RGB = readonly [number, number, number]

export interface PaletteColor {
  id: string
  hex: string
  ramp: string
  step: number
  reserved: boolean
  rgb: RGB
}

export interface Palette {
  name: string
  /** palette id of the game background colour (water1) */
  background: string
  ramps: string[]
  colors: PaletteColor[]
  byId: Map<string, PaletteColor>
  byHex: Map<string, PaletteColor>
  /** '#rrggbb' of a palette id; throws on an unknown id */
  hex(id: string): string
  /** the colours of one ramp, dark -> light */
  ramp(name: string): PaletteColor[]
}

export const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const PALETTE_PATH = join(ROOT, 'art/palette.json')

export function hexToRgb(hex: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`bad hex colour: ${hex}`)
  const n = Number.parseInt(m[1] as string, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(rgb: RGB): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

interface PaletteFile {
  name: string
  background: string
  ramps: string[]
  colors: Omit<PaletteColor, 'rgb'>[]
}

export function loadPalette(path: string = PALETTE_PATH): Palette {
  const file = JSON.parse(readFileSync(path, 'utf8')) as PaletteFile
  const colors: PaletteColor[] = file.colors.map((c) => ({
    ...c,
    hex: c.hex.toLowerCase(),
    rgb: hexToRgb(c.hex),
  }))
  const byId = new Map(colors.map((c) => [c.id, c]))
  const byHex = new Map(colors.map((c) => [c.hex, c]))
  return {
    name: file.name,
    background: file.background,
    ramps: file.ramps,
    colors,
    byId,
    byHex,
    hex(id) {
      const c = byId.get(id)
      if (!c) throw new Error(`unknown palette colour: ${id}`)
      return c.hex
    },
    ramp(name) {
      return colors.filter((c) => c.ramp === name)
    },
  }
}

export const PALETTE: Palette = loadPalette()

// ---------------------------------------------------------------------------
// Colour meaning rules (style-guide.md §1.4, §1.8, lint A07)

/** Classes that get the full palette (§1.8) — reserved ramps allowed. */
export const FULL_PALETTE_CLASSES: readonly AssetClass[] = [
  'parcel',
  'icon16',
  'ui',
  'font',
]

/** "interior" in the §1.4 table (dock light, Hold Bay light, chute stripes). */
export const INTERIOR_CLASSES: readonly AssetClass[] = [
  'interior-tile',
  'fixture',
  'fixture-rack',
  'fixture-shelf',
  'fixture-door',
  'fixture-desk',
  'dock-tail',
  'sign',
  'interior-prop',
  'machine',
  'worker',
]

/**
 * Ramps restricted to some classes. Ramps not listed are allowed everywhere.
 * fx gets red (fx_boom) and gold (the decay coin ring) but never mal.
 */
export const RAMP_RULES: Readonly<Record<string, readonly AssetClass[]>> = {
  mal: [...FULL_PALETTE_CLASSES],
  // build 3 (B3 §5): the event category pictures are card art — coins and
  // stars (gold), a heart or a warning (red), rain and sea (water) — but
  // never the malware ramp (a purple mask must not read as malware)
  gold: [...FULL_PALETTE_CLASSES, 'fx', 'event-pic'],
  red: [...FULL_PALETTE_CLASSES, 'fx', 'event-pic', ...INTERIOR_CLASSES],
  water: [...FULL_PALETTE_CLASSES, 'fx', 'event-pic', 'tile', 'dock-prop'],
}

/** Districts whose building sprites may paint water (piers stand in it). */
export const WATER_DISTRICTS: readonly string[] = ['docks']

/**
 * Build 3 (B3 §5, STYLE.md §4 "one meaning per colour"): the event pictures
 * whose subject is a reward — the coins, the job board's gold star, the
 * gift — are the only event-pic ids that keep the reserved gold ramp; on
 * the other ten (a clipboard board, a magnifier rim) gold would borrow the
 * reward meaning, so it snaps to the yellow ramp instead.
 */
export const GOLD_PICTURES: readonly string[] = [
  'ev_pic_money',
  'ev_pic_job',
  'ev_pic_luck',
]

/**
 * Per-id narrowing of RAMP_RULES for ids whose class takes the full
 * palette: the victory art (class ui) never paints the malware ramp —
 * STYLE.md §4 keeps `mal` for malware parcels and the Hold Bay border, and
 * a night sky or a dark van shade in it would read as malware.
 */
export const ID_RAMP_DENY: Readonly<Record<string, readonly string[]>> = {
  victory_art: ['mal'],
}

export interface SubsetOpts {
  district?: string
  /** the manifest id: GOLD_PICTURES and ID_RAMP_DENY narrow by id */
  id?: string
}

export function rampAllowed(
  ramp: string,
  cls: AssetClass,
  opts: SubsetOpts = {},
): boolean {
  if (opts.id !== undefined) {
    if (ID_RAMP_DENY[opts.id]?.includes(ramp)) return false
    if (cls === 'event-pic' && ramp === 'gold') {
      return GOLD_PICTURES.includes(opts.id)
    }
  }
  const allowed = RAMP_RULES[ramp]
  if (!allowed) return true
  if (allowed.includes(cls)) return true
  return (
    ramp === 'water' &&
    opts.district !== undefined &&
    WATER_DISTRICTS.includes(opts.district)
  )
}

/** The quantization subset of a class (§1.8 + §1.4). */
export function subsetFor(
  cls: AssetClass,
  opts: SubsetOpts = {},
): PaletteColor[] {
  return PALETTE.colors.filter((c) => rampAllowed(c.ramp, cls, opts))
}

function dist2(a: RGB, b: RGB): number {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return dr * dr + dg * dg + db * db
}

/** Nearest palette colour in RGB (ties -> earlier palette order). */
export function nearest(
  rgb: RGB,
  subset: readonly PaletteColor[] = PALETTE.colors,
): PaletteColor {
  let best = subset[0]
  if (!best) throw new Error('nearest: empty subset')
  let bestD = dist2(rgb, best.rgb)
  for (const c of subset) {
    const d = dist2(rgb, c.rgb)
    if (d < bestD) {
      best = c
      bestD = d
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Fog (spec §3.5, style-guide.md §1.8): computed, never hand-picked

export const FOG_MIX = 0.45
export const FOG_TARGET = 'grey5'
export const FOG_RAMP = 'grey'

export function fogColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex.toLowerCase())
  const [tr, tg, tb] = hexToRgb(PALETTE.hex(FOG_TARGET))
  const mr = r + (tr - r) * FOG_MIX
  const mg = g + (tg - g) * FOG_MIX
  const mb = b + (tb - b) * FOG_MIX
  // Rec. 601 luma: full desaturation
  const l = Math.round(0.299 * mr + 0.587 * mg + 0.114 * mb)
  return nearest([l, l, l], PALETTE.ramp(FOG_RAMP)).hex
}

/** palette hex -> fogged palette hex, for every palette colour */
export const FOG_MAP: ReadonlyMap<string, string> = new Map(
  PALETTE.colors.map((c) => [c.hex, fogColor(c.hex)]),
)

// ---------------------------------------------------------------------------
// Measurements and checks (printed by `vlr art:palette`)

function hsv(rgb: RGB): { h: number; s: number; v: number } {
  const [r, g, b] = rgb.map((x) => x / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export interface PaletteStats {
  count: number
  meanS: number
  meanV: number
  darkCount: number
  /** min RGB distance from each reserved ramp to any non-reserved colour */
  reservedGap: Record<string, number>
  problems: string[]
}

export function paletteStats(): PaletteStats {
  const all = PALETTE.colors
  const hs = all.map((c) => hsv(c.rgb))
  const meanS = hs.reduce((a, x) => a + x.s, 0) / all.length
  const meanV = hs.reduce((a, x) => a + x.v, 0) / all.length
  const dark = all.filter((c) => hsv(c.rgb).v < 0.25)
  const problems: string[] = []
  if (all.length !== 48) problems.push(`expected 48 colours, got ${all.length}`)
  for (const c of dark) {
    if (c.id !== 'outline' && c.id !== 'mal0') {
      problems.push(`A11: ${c.id} has V < 0.25`)
    }
  }
  const reservedGap: Record<string, number> = {}
  for (const ramp of ['mal', 'gold']) {
    let min = Infinity
    for (const c of PALETTE.ramp(ramp)) {
      for (const o of all) {
        if (o.reserved) continue
        min = Math.min(min, Math.sqrt(dist2(c.rgb, o.rgb)))
      }
    }
    reservedGap[ramp] = Math.round(min * 10) / 10
  }
  const hexes = new Set(all.map((c) => c.hex))
  if (hexes.size !== all.length) problems.push('duplicate hex in palette')
  return {
    count: all.length,
    meanS,
    meanV,
    darkCount: dark.length,
    reservedGap,
    problems,
  }
}

// ---------------------------------------------------------------------------
// Swatch + ramp sheet

export const PALETTE_PNG = join(ROOT, 'art/palette.png')
export const RAMPS_PNG = join(ROOT, 'art/contact/palette-ramps@4x.png')
const FONT_PATH = join(ROOT, 'art/fonts/m5x7.ttf')

function writeIfChanged(path: string, buf: Buffer): boolean {
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path) && readFileSync(path).equals(buf)) return false
  writeFileSync(path, buf)
  return true
}

export function renderSwatch(): { palette: string; ramps: string } {
  // 48 x 1 at 1x, palette order
  const strip = createCanvas(PALETTE.colors.length, 1)
  const sctx = strip.getContext('2d')
  PALETTE.colors.forEach((c, i) => {
    sctx.fillStyle = c.hex
    sctx.fillRect(i, 0, 1, 1)
  })
  writeIfChanged(PALETTE_PNG, strip.toBuffer('image/png'))

  // ramp sheet at 4x: label | shades | fog of each shade
  const S = 4
  const cell = 8 * S
  const labelW = 44 * S
  const gap = 2 * S
  const maxSteps = Math.max(...PALETTE.ramps.map((r) => PALETTE.ramp(r).length))
  const fogX = labelW + maxSteps * cell + 6 * S
  const w = fogX + maxSteps * cell + 2 * S
  const headH = 4 * S + 4 * S
  const h = headH + PALETTE.ramps.length * (cell + gap) + 2 * S
  const sheet = createCanvas(w, h)
  const ctx = sheet.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = PALETTE.hex('grey5')
  ctx.fillRect(0, 0, w, h)
  // header: the 1x strip, scaled
  const stripCell = Math.floor((w - 4 * S) / PALETTE.colors.length)
  PALETTE.colors.forEach((c, i) => {
    ctx.fillStyle = c.hex
    ctx.fillRect(2 * S + i * stripCell, S, stripCell, 4 * S)
  })
  let fontOk = false
  try {
    if (existsSync(FONT_PATH)) {
      fontOk = GlobalFonts.registerFromPath(FONT_PATH, 'm5x7') !== null
    }
  } catch {
    fontOk = false
  }
  PALETTE.ramps.forEach((ramp, row) => {
    const y = headH + row * (cell + gap)
    const shades = PALETTE.ramp(ramp)
    shades.forEach((c, i) => {
      ctx.fillStyle = PALETTE.hex('outline')
      ctx.fillRect(labelW + i * cell, y, cell, cell)
      ctx.fillStyle = c.hex
      ctx.fillRect(labelW + i * cell + S, y + S, cell - 2 * S, cell - 2 * S)
      const fog = fogColor(c.hex)
      ctx.fillStyle = PALETTE.hex('outline')
      ctx.fillRect(fogX + i * cell, y, cell, cell)
      ctx.fillStyle = fog
      ctx.fillRect(fogX + i * cell + S, y + S, cell - 2 * S, cell - 2 * S)
    })
    if (fontOk) {
      const reserved = shades[0]?.reserved ? ' *' : ''
      ctx.fillStyle = PALETTE.hex('outline')
      ctx.font = '32px m5x7'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${ramp}${reserved}`, 2 * S, y + cell / 2)
    }
  })
  writeIfChanged(RAMPS_PNG, sheet.toBuffer('image/png'))
  return { palette: PALETTE_PNG, ramps: RAMPS_PNG }
}

/** `vlr art:palette` */
export function run(): number {
  const stats = paletteStats()
  const out = renderSwatch()
  const fogged = new Set(FOG_MAP.values())
  console.log(
    `palette: ${stats.count} colours, mean S ${stats.meanS.toFixed(2)}, ` +
      `mean V ${stats.meanV.toFixed(2)}, ${stats.darkCount} with V < 0.25; ` +
      `reserved gap mal ${stats.reservedGap.mal}, gold ${stats.reservedGap.gold}; ` +
      `fog -> ${fogged.size} greys`,
  )
  console.log(`palette: wrote ${out.palette} and ${out.ramps}`)
  for (const p of stats.problems) console.error(`palette: ${p}`)
  return stats.problems.length > 0 ? 1 : 0
}
