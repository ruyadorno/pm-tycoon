// Warehouse interior drawers (style-guide.md §1.2 interior light, §1.5,
// §2.7, §4.3; warehouse-view.md §1-§5, §9). Top-down 3/4 view lit from the
// top-left: the top face of a fixture is its lightest step, the front (south)
// face the base step, with a 1-px `outline` shadow under the south edge.
// Tier 1 = concrete, corrugated tin, bare bulb, cardboard, chalk; tier 2 =
// light-blue painted floor with yellow lane lines, cream panels with blue
// trim, strip lights, printed signage.
//
// Geometry contracts the renderer relies on (room px from warehouse-view.md
// §1.3 mapped into each canvas):
// - belt_h/belt_v/belt_corner: the belt band is px 3..28 across the run
//   (rails 3..6 and 25..28, tread 7..24, a 1-px shadow at 29); belt_h runs
//   east, belt_v south; frame k shifts the tread +2k px along the run.
//   belt_corner takes the belt in at its west edge and out at its south edge.
// - floor_t2_lane: floor_t2 with 2-px yellow lane lines at x 0-1 and 30-31,
//   meant for the belt column c4 so the lines show beside the belt rails.
// - chute_v: the 16-px rail occupies x 0..15 of the 32x32 canvas (place the
//   canvas at x 172 with origin 0,0); it tiles vertically every 32 px.
// - lane_arrow: floor chevrons pointing south (the lane's flow), _f0/_f1
//   alternate which chevron is lit.
// - machines: arch over the belt; transparent opening x 12..35 below the
//   header (rows 16..47), so the parcel under it stays visible.
// - holdbay_rack: pads at (4, 4 + 48i) 44x44, lamp spot at (52, 4) 8x8.
// - shelf_t*: mini-parcel grid area x 6..221, y 6..39 (rows at y 6/18/30).
// - bin: front-face label plate centred at (32, 52) for the "xN" counter.
// - sign_t*: text area x 8..191, y 4..19 (16-px BitmapText, centred).
// - worker: feet on row 28 (outline 29), a 2-row ground shadow at rows 30-31
//   (x 8..15), origin (0.5, 1) puts the shadow on the stand point.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DrawCtx } from './draw-api.ts'
import { registerDrawer } from './drawers.ts'
import { type Img, imgToCanvas, newImg, put, readImg } from './iso.ts'
import { FINAL_DIR } from './manifest.ts'
import { SORTER_SWAP, sorterImg } from './variants.ts'
import {
  type BoxScheme,
  CARDBOARD,
  Grid,
  box3q,
  gridFrames,
  tpl,
} from './icons.ts'
import type { Rng } from './rng.ts'

// ---------------------------------------------------------------------------
// Shared helpers

/** register a builder called once per frame suffix */
function reg(
  id: string | RegExp,
  build: (suffix: string, i: number, d: DrawCtx) => Grid,
): void {
  registerDrawer({ id }, (d) =>
    gridFrames(
      d,
      d.entry.frames.map((s, i) => build(s, i, d)),
    ),
  )
}

/** a seeded stream per frame so frames never depend on each other's draws */
function rngOf(d: DrawCtx, label: string): Rng {
  return d.rng.fork(label)
}

/** outlined rectangle with a fill (outline included in w, h) */
function oRect(
  g: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
): void {
  g.rect(x, y, w, h, 'outline')
  g.rect(x + 1, y + 1, w - 2, h - 2, fill)
}

/**
 * Dashed rectangle stroke `t` px thick: corner arms of length `c` and `n`
 * evenly spaced dashes of length `a` per side; each dash is `core` inside an
 * `outline` rim (so every opaque pixel touching transparency is outline).
 */
function dashedRect(
  g: Grid,
  x0: number,
  y0: number,
  w: number,
  h: number,
  core: string,
  c: number,
  a: number,
  t = 3,
): void {
  const along = (p: number, L: number) => {
    if (p < c || p >= L - c) return true
    const mid = L - 2 * c
    const n = Math.max(1, Math.round(mid / (a + a * 0.75)))
    for (let k = 0; k < n; k++) {
      const centre = c + (mid * (k + 0.5)) / n
      if (p >= Math.round(centre - a / 2) && p < Math.round(centre + a / 2))
        return true
    }
    return false
  }
  const on = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false
    const inBand = x < t || y < t || x >= w - t || y >= h - t
    if (!inBand) return false
    if (y < t || y >= h - t) {
      if (along(x, w)) return true
    }
    if (x < t || x >= w - t) {
      if (along(y, h)) return true
    }
    return false
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue
      const rim =
        !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)
      g.set(x0 + x, y0 + y, rim ? 'outline' : core)
    }
  }
}

/** diagonal hazard stripes (period 8) inside a rect */
function hazard(
  g: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
  a = 'yellow2',
  b = 'outline',
): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++)
      g.set(x + i, y + j, (x + i + y + j) % 8 < 4 ? a : b)
  }
}

/** sprinkle single pixels of colour c (n of them) inside a rect */
function specks(
  g: Grid,
  r: Rng,
  n: number,
  c: string,
  x = 0,
  y = 0,
  w = g.w,
  h = g.h,
): void {
  for (let k = 0; k < n; k++) g.set(x + r.int(0, w - 1), y + r.int(0, h - 1), c)
}

/** a thin hairline crack wandering diagonally from (x, y) for `len` px */
function crack(
  g: Grid,
  r: Rng,
  x: number,
  y: number,
  len: number,
  c: string,
  hi?: string,
): void {
  let cx = x
  let cy = y
  const sx = r.chance(0.5) ? 1 : -1
  for (let k = 0; k < len; k++) {
    g.set(cx, cy, k === 0 || r.chance(0.25) ? 'grey1' : c)
    if (hi && k % 3 === 1) g.set(cx + 1, cy, hi)
    // mostly downward, drifting sideways in short runs
    if (r.chance(0.6)) cy++
    else cx += sx
    if (r.chance(0.15)) cx -= sx
  }
}

// ---------------------------------------------------------------------------
// Interior tiles (32x32, opaque, tile seamlessly)

const T = 32

function floorT1(d: DrawCtx, variant: number): Grid {
  const g = new Grid(T, T)
  const r = rngOf(d, `v${variant}`)
  g.rect(0, 0, T, T, 'grey3')
  // slab joints on the top row and left column (32-px slabs)
  g.hline(0, T - 1, 0, 'grey2')
  g.vline(0, 0, T - 1, 'grey2')
  specks(g, r, 6, 'grey4', 2, 2, 28, 28)
  specks(g, r, 5, 'grey2', 2, 2, 28, 28)
  if (variant === 1) {
    crack(g, r, r.int(8, 22), r.int(3, 8), 14, 'grey2', 'grey4')
  } else if (variant === 2) {
    // oil stain + a short hairline crack
    const cx = r.int(12, 20)
    const cy = r.int(12, 20)
    g.disc(cx, cy, 3.6, 'grey2')
    g.disc(cx + 3, cy - 2, 2, 'grey2')
    g.set(cx - 1, cy - 1, 'grey4')
  }
  return g
}

function floorT2(d: DrawCtx, lane: boolean): Grid {
  const g = new Grid(T, T)
  const r = rngOf(d, 'paint')
  g.rect(0, 0, T, T, 'blue2')
  g.hline(0, T - 1, 0, 'blue1')
  g.vline(0, 0, T - 1, 'blue1')
  specks(g, r, 3, 'grey5', 2, 2, 28, 28)
  specks(g, r, 2, 'blue1', 2, 2, 28, 28)
  if (lane) {
    g.rect(0, 0, 2, T, 'yellow2')
    g.rect(30, 0, 2, T, 'yellow2')
    g.vline(1, 0, T - 1, 'yellow1')
    g.vline(31, 0, T - 1, 'yellow1')
  }
  return g
}

/** side walls (west c0, east c10): the wall top seen from above */
function wallT1(d: DrawCtx): Grid {
  const g = new Grid(T, T)
  const r = rngOf(d, 'rust')
  for (let y = 0; y < T; y++) {
    const k = y % 4
    g.hline(0, T - 1, y, k === 0 ? 'grey3' : k === 3 ? 'grey1' : 'grey2')
  }
  g.vline(0, 0, T - 1, 'outline')
  g.vline(T - 1, 0, T - 1, 'outline')
  g.vline(1, 0, T - 1, 'grey1')
  g.vline(T - 2, 0, T - 1, 'grey1')
  specks(g, r, 4, 'orange1', 3, 0, 26, 32)
  return g
}

function wallT2(): Grid {
  const g = new Grid(T, T)
  g.rect(0, 0, T, T, 'grey4')
  g.hline(0, T - 1, 0, 'grey5')
  g.hline(0, T - 1, 15, 'grey3')
  g.hline(0, T - 1, 16, 'grey5')
  g.hline(0, T - 1, 31, 'grey3')
  // blue painted trim along both edges
  g.rect(1, 0, 3, T, 'blue1')
  g.rect(28, 0, 3, T, 'blue1')
  g.vline(1, 0, T - 1, 'blue2')
  g.vline(28, 0, T - 1, 'blue2')
  g.vline(0, 0, T - 1, 'outline')
  g.vline(T - 1, 0, T - 1, 'outline')
  return g
}

/** north wall face: corrugated tin (t1) / cream panels over a blue dado (t2) */
function wallfaceT1(d: DrawCtx): Grid {
  const g = new Grid(T, T)
  const r = rngOf(d, 'rust')
  for (let x = 0; x < T; x++) {
    const k = x % 4
    g.vline(x, 0, T - 1, k === 0 ? 'grey3' : k === 3 ? 'grey1' : 'grey2')
  }
  // top beam and the floor line
  g.hline(0, T - 1, 0, 'outline')
  g.hline(0, T - 1, 1, 'grey1')
  g.hline(0, T - 1, 2, 'grey0')
  g.hline(0, T - 1, 29, 'grey1')
  g.hline(0, T - 1, 30, 'grey0')
  g.hline(0, T - 1, 31, 'outline')
  // rust streaks running down from rivets
  for (let k = 0; k < 2; k++) {
    const x = r.int(2, 29)
    const y = r.int(4, 18)
    g.set(x, y, 'orange1')
    for (let j = 1; j <= r.int(2, 5); j++)
      g.set(x, y + j, j < 3 ? 'orange1' : 'orange0')
  }
  for (const x of [5, 21]) g.set(x, 4, 'grey4')
  return g
}

function wallfaceT2(): Grid {
  const g = new Grid(T, T)
  g.rect(0, 0, T, T, 'grey4')
  g.hline(0, T - 1, 0, 'outline')
  g.hline(0, T - 1, 1, 'grey3')
  g.hline(0, T - 1, 2, 'grey5')
  g.vline(15, 3, 19, 'grey3')
  g.vline(16, 3, 19, 'grey5')
  // blue dado with a lit top edge
  g.rect(0, 20, T, 10, 'blue1')
  g.hline(0, T - 1, 20, 'blue2')
  g.hline(0, T - 1, 28, 'blue0')
  g.hline(0, T - 1, 29, 'blue0')
  g.hline(0, T - 1, 30, 'grey0')
  g.hline(0, T - 1, 31, 'outline')
  return g
}

// Belts -------------------------------------------------------------------

/** rail colours across the band, index = offset from the band edge 3 */
const RAIL_NEAR = ['outline', 'grey4', 'grey3', 'grey1'] // px 3..6
const RAIL_FAR = ['grey1', 'grey3', 'grey2', 'outline', 'outline'] // px 25..29

/** tread colour at position p along the run for frame k */
function tread(p: number, k: number): string {
  const q = (((p - 2 * k) % 8) + 8) % 8
  return q === 7 ? 'outline' : q === 0 ? 'grey1' : 'grey0'
}

function beltV(k: number): Grid {
  const g = new Grid(T, T)
  for (let y = 0; y < T; y++) {
    RAIL_NEAR.forEach((c, i) => g.set(3 + i, y, c))
    RAIL_FAR.forEach((c, i) => g.set(25 + i, y, c))
    g.hline(7, 24, y, tread(y, k))
  }
  // rail bolts (static)
  for (const y of [4, 20]) {
    g.set(5, y, 'grey2')
    g.set(26, y, 'grey2')
  }
  return g
}

function beltH(k: number): Grid {
  const g = new Grid(T, T)
  for (let x = 0; x < T; x++) {
    RAIL_NEAR.forEach((c, i) => g.set(x, 3 + i, c))
    RAIL_FAR.forEach((c, i) => g.set(x, 25 + i, c))
    g.vline(x, 7, 24, tread(x, k))
  }
  for (const x of [4, 20]) {
    g.set(x, 5, 'grey2')
    g.set(x, 26, 'grey2')
  }
  return g
}

/** in at the west edge, out at the south edge; spokes around the inner corner */
function beltCorner(k: number): Grid {
  const g = new Grid(T, T)
  // entry strip x 0..6 (belt_h pattern), exit strip y 25..31 (belt_v)
  for (let x = 0; x <= 6; x++) {
    g.set(x, 3, 'outline')
    g.set(x, 4, 'grey4')
    g.set(x, 5, 'grey3')
    g.set(x, 6, 'grey1')
    g.vline(x, 7, 24, tread(x, k))
    RAIL_FAR.forEach((c, i) => g.set(x, 25 + i, c))
  }
  for (let y = 25; y < T; y++) {
    g.hline(7, 24, y, tread(y, k))
  }
  for (let y = 28; y < T; y++) RAIL_NEAR.forEach((c, i) => g.set(3 + i, y, c))
  g.set(6, 25, 'grey1')
  g.set(6, 26, 'grey1')
  g.set(6, 27, 'grey1')
  // the outer rails: north (rows 3..6) and east (cols 25..29)
  for (let x = 7; x <= 24; x++) {
    g.set(x, 3, 'outline')
    g.set(x, 4, 'grey4')
    g.set(x, 5, 'grey3')
    g.set(x, 6, 'grey1')
  }
  for (let y = 3; y < T; y++) RAIL_FAR.forEach((c, i) => g.set(25 + i, y, c))
  for (let x = 25; x <= 29; x++) g.set(x, 3, 'outline')
  g.set(25, 4, 'grey4')
  g.set(26, 4, 'grey4')
  g.set(25, 5, 'grey3')
  // the turning tread: grooves are spokes from the inner corner (7, 25)
  const cx = 7
  const cy = 25
  const S = 30
  for (let y = 7; y <= 24; y++) {
    for (let x = 7; x <= 24; x++) {
      const dx = x + 0.5 - cx
      const dy = cy - (y + 0.5)
      const rr = Math.hypot(dx, dy)
      const theta = (Math.atan2(dx, dy) * 180) / Math.PI // 0 = north, 90 = east
      const q = (((theta - (S / 4) * k) % S) + S) % S
      const arc = (q * Math.PI * rr) / 180
      const arcBack = ((S - q) * Math.PI * rr) / 180
      g.set(x, y, arcBack < 1 ? 'outline' : arc < 1.2 ? 'grey1' : 'grey0')
    }
  }
  return g
}

/** the red/white chute rail at x 0..15 */
function chuteV(): Grid {
  const g = new Grid(T, T)
  for (let y = 0; y < T; y++) {
    g.set(0, y, 'outline')
    g.set(1, y, 'grey4')
    for (const x of [2, 3, 12, 13])
      g.set(x, y, (x + y) % 8 < 4 ? 'red1' : 'grey5')
    g.set(4, y, 'grey0')
    g.hline(5, 10, y, 'grey1')
    g.set(11, y, 'grey2')
    g.set(14, y, 'grey2')
    g.set(15, y, 'outline')
  }
  // trough slats
  for (const y of [7, 23]) g.hline(5, 10, y, 'grey0')
  return g
}

function laneArrow(k: number): Grid {
  const g = new Grid(T, T)
  const chevron = (top: number, c: string) => {
    const s = new Grid(T, T)
    for (let i = 0; i < 6; i++) {
      s.hline(8 + i, 10 + i, top + i, c)
      s.hline(21 - i, 23 - i, top + i, c)
    }
    s.edge('outline', false)
    s.outline()
    g.blit(s, 0, 0)
  }
  chevron(5, k === 0 ? 'yellow3' : 'yellow1')
  chevron(17, k === 0 ? 'yellow1' : 'yellow3')
  return g
}

// ---------------------------------------------------------------------------
// Interior props

function chuteOutlet(): Grid {
  const g = new Grid(12, 12)
  oRect(g, 0, 0, 12, 11, 'grey3')
  g.hline(1, 10, 1, 'grey4')
  for (let x = 1; x <= 10; x++) g.set(x, 2, x % 4 < 2 ? 'red1' : 'grey5')
  g.rect(2, 4, 8, 5, 'outline')
  g.rect(3, 5, 6, 3, 'grey0')
  g.hline(3, 8, 5, 'grey1')
  g.hline(1, 10, 9, 'grey2')
  g.hline(1, 11, 11, 'outline')
  g.vline(11, 1, 11, 'outline')
  return g
}

function extOutline(): Grid {
  const g = new Grid(56, 24)
  dashedRect(g, 0, 0, 56, 24, 'grey5', 7, 7)
  return g
}

/**
 * The Hold Bay station's dashed outline (48x48 at RoomLayout HOLD_STATION;
 * B2 §2.6): shown while the station is locked (or live without its podium
 * art). Drawn like slot_empty_outline so the room's badges layer stays one
 * image batch (a Graphics there cost a draw call, M6).
 */
function stationOutline(): Grid {
  const g = new Grid(48, 48)
  dashedRect(g, 0, 0, 48, 48, 'grey5', 8, 8)
  return g
}

function bayPad(): Grid {
  const g = new Grid(44, 44)
  oRect(g, 0, 0, 44, 44, 'grey3')
  // raised rim: lit top/left, dark bottom/right
  g.rect(1, 1, 42, 2, 'grey4')
  g.rect(1, 1, 2, 42, 'grey4')
  g.rect(1, 41, 42, 2, 'grey2')
  g.rect(41, 1, 2, 42, 'grey2')
  g.set(1, 42, 'grey3')
  g.set(42, 1, 'grey3')
  g.rect(3, 3, 38, 38, 'grey3')
  // inner recess shadow + painted corner marks
  g.hline(3, 40, 3, 'grey2')
  g.vline(3, 3, 40, 'grey2')
  for (const [x, y, sx, sy] of [
    [5, 5, 1, 1],
    [38, 5, -1, 1],
    [5, 38, 1, -1],
    [38, 38, -1, -1],
  ] as const) {
    for (let i = 0; i < 5; i++) {
      g.set(x + sx * i, y, 'yellow2')
      g.set(x, y + sy * i, 'yellow2')
    }
  }
  return g
}

function bayPadLocked(): Grid {
  const g = new Grid(44, 44)
  oRect(g, 0, 0, 44, 44, 'grey2')
  for (let y = 1; y < 43; y++) {
    for (let x = 1; x < 43; x++) if ((x + y) % 6 === 0) g.set(x, y, 'grey1')
  }
  g.rect(1, 1, 42, 1, 'grey3')
  g.rect(1, 1, 1, 42, 'grey3')
  return g
}

const LAMP_COLOURS: Readonly<Record<string, [string, string, string]>> = {
  _off: ['grey1', 'grey2', 'grey0'],
  _green: ['grass2', 'grass3', 'grass1'],
  _red: ['red1', 'red2', 'red0'],
  _amber: ['yellow2', 'yellow3', 'yellow1'],
}

function lamp(suffix: string): Grid {
  if (suffix === '_lock') {
    // build 2 M8: a dock the player does not own (DockView's lamp row) —
    // a dim grey padlock, never a lit colour
    return tpl(
      [
        '..oooo..',
        '.oGooGo.',
        '.oo..oo.',
        'oooooooo',
        'oLMMMMMo',
        'oMMooMMo',
        'oMMoMMGo',
        'oooooooo',
      ],
      8,
      8,
      0,
      0,
      { o: 'outline', G: 'grey2', L: 'grey4', M: 'grey3' },
    )
  }
  const [base, hi, lo] = LAMP_COLOURS[suffix] ?? ['grey1', 'grey2', 'grey0']
  const rows = [
    '..oooo..',
    '.oXXXXo.',
    'oXHXXXXo',
    'oXXXXXXo',
    'oXXXXXXo',
    'oXXXXXDo',
    '.oXXXXo.',
    '..oooo..',
  ]
  return tpl(rows, 8, 8, 0, 0, { o: 'outline', X: base, H: hi, D: lo })
}

function bulb(lit: boolean): Grid {
  const g = new Grid(16, 24)
  g.vline(7, 0, 7, 'outline')
  oRect(g, 5, 8, 6, 4, 'grey2')
  g.hline(6, 9, 9, 'grey3')
  const body = lit
    ? ['yellow3', 'grey5', 'yellow2']
    : ['yellow1', 'yellow2', 'yellow0']
  const b = new Grid(16, 24)
  b.disc(8, 16.5, 4.6, body[0] as string)
  b.rect(6, 11, 4, 2, body[0] as string)
  b.set(6, 14, body[1] as string)
  b.set(6, 15, body[1] as string)
  b.set(7, 14, body[1] as string)
  b.set(10, 18, body[2] as string)
  b.set(9, 19, body[2] as string)
  b.set(10, 17, body[2] as string)
  b.outline()
  g.blit(b, 0, 0)
  return g
}

function stripLight(): Grid {
  const g = new Grid(64, 8)
  oRect(g, 0, 0, 64, 8, 'grey3')
  g.hline(1, 62, 1, 'grey4')
  g.rect(4, 2, 56, 4, 'grey5')
  g.hline(4, 59, 3, 'yellow3')
  g.hline(4, 59, 5, 'grey4')
  g.rect(1, 2, 3, 4, 'grey2')
  g.rect(60, 2, 3, 4, 'grey2')
  g.hline(1, 62, 6, 'grey2')
  return g
}

/**
 * Tier 5 (M9): a pink neon tube in a white channel, the strip_light canvas
 * (64x8, RoomLayout STRIP_LIGHTS). f0 lit (a white-hot core line and a pink
 * glow on the channel), f1 the dimmer flicker frame.
 */
function neonStrip(lit: boolean): Grid {
  const g = new Grid(64, 8)
  oRect(g, 0, 0, 64, 8, 'grey4')
  g.hline(1, 62, 1, 'grey5')
  g.hline(1, 62, 6, 'grey3')
  g.rect(1, 2, 3, 4, 'grey2')
  g.rect(60, 2, 3, 4, 'grey2')
  g.hline(4, 59, 2, lit ? 'pink1' : 'grey4')
  g.hline(4, 59, 3, lit ? 'grey5' : 'pink1')
  g.hline(4, 59, 4, lit ? 'pink1' : 'pink0')
  g.hline(4, 59, 5, lit ? 'pink0' : 'grey3')
  return g
}

/**
 * The room's south-edge baseboard (final review, mobile #6): a 32×2 strip of
 * `outline`, tiled along the room's bottom edge from the interior atlas. It
 * was a Rectangle between the walls' interior images — a non-atlas object
 * that split the back batch (2 draw calls at every tier).
 */
function baseboard(): Grid {
  const g = new Grid(32, 2)
  g.rect(0, 0, 32, 2, 'outline')
  return g
}

const CARD_DARK: BoxScheme = {
  top: 'brown1',
  topHi: 'brown2',
  front: 'brown0',
  frontLo: 'brown0',
  tape: 'brown2',
  tapeFront: 'brown1',
}

const CARD_LIGHT: BoxScheme = {
  top: 'brown3',
  topHi: 'grey5',
  front: 'brown2',
  frontLo: 'brown1',
  tape: 'grey4',
  tapeFront: 'brown3',
}

/** shadowed 3/4 box: box3q + a 1-px outline shadow under the south edge */
function crate(
  g: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
  s: BoxScheme,
): void {
  box3q(g, x, y, w, h, s)
  g.hline(x + 1, x + w, y + h, 'outline')
}

function propsT1(): Grid {
  const g = new Grid(48, 48)
  // back row, then front row (back-to-front so the front boxes overlap)
  crate(g, 3, 6, 20, 16, CARD_DARK)
  crate(g, 22, 3, 22, 18, CARDBOARD)
  crate(g, 9, 0, 14, 10, CARD_LIGHT)
  crate(g, 1, 22, 24, 22, CARDBOARD)
  crate(g, 26, 24, 19, 16, CARD_LIGHT)
  // a flattened box leaning on the right pair
  g.rect(28, 40, 16, 5, 'outline')
  g.rect(29, 41, 14, 3, 'brown2')
  g.hline(29, 42, 41, 'brown3')
  g.hline(29, 43, 45, 'outline')
  return g
}

function propsT2(): Grid {
  const g = new Grid(48, 64)
  // shelving unit: blue uprights, grey decks, tidy boxes and bins
  oRect(g, 0, 0, 48, 63, 'grey1')
  g.rect(1, 1, 46, 7, 'grey4')
  g.hline(1, 46, 1, 'grey5')
  g.hline(1, 46, 7, 'grey3')
  for (const y of [8, 26, 44]) {
    // bay back wall
    g.rect(4, y, 40, 16, 'grey0')
    g.hline(4, 43, y, 'outline')
  }
  for (const y of [23, 41, 59]) {
    g.rect(1, y, 46, 3, 'grey3')
    g.hline(1, 46, y, 'grey4')
    g.hline(1, 46, y + 2, 'grey2')
  }
  // uprights
  for (const x of [1, 44]) {
    g.rect(x, 1, 3, 61, 'blue1')
    g.vline(x, 1, 61, 'blue2')
    g.vline(x + 2, 1, 61, 'blue0')
  }
  // contents
  crate(g, 6, 12, 12, 11, CARDBOARD)
  crate(g, 19, 14, 10, 9, CARD_LIGHT)
  const tray = (x: number, y: number, c: string, hi: string, lo: string) => {
    oRect(g, x, y, 12, 10, c)
    g.hline(x + 1, x + 10, y + 1, hi)
    g.hline(x + 1, x + 10, y + 8, lo)
    g.rect(x + 4, y + 4, 4, 2, lo)
  }
  tray(30, 13, 'yellow2', 'yellow3', 'yellow1')
  tray(6, 31, 'orange2', 'orange3', 'orange1')
  tray(19, 31, 'orange2', 'orange3', 'orange1')
  crate(g, 31, 28, 12, 13, CARDBOARD)
  crate(g, 6, 47, 16, 12, CARD_DARK)
  tray(24, 49, 'blue1', 'blue2', 'blue0')
  g.hline(0, 47, 63, 'outline')
  return g
}

function posterT1(): Grid {
  const g = new Grid(32, 32)
  // chalkboard in a timber frame with a nail on top
  oRect(g, 1, 2, 30, 28, 'brown1')
  g.hline(2, 29, 3, 'brown2')
  g.vline(2, 3, 28, 'brown2')
  g.rect(4, 5, 24, 22, 'leaf0')
  g.hline(1, 30, 30, 'outline')
  g.set(15, 1, 'outline')
  g.set(16, 1, 'outline')
  // chalk: a scribbled header, the wanted parcel with a fuse, two lines
  for (const [x0, x1] of [
    [7, 11],
    [13, 17],
    [19, 24],
  ] as const) {
    g.hline(x0, x1, 7, 'grey4')
  }
  const c = 'grey5'
  g.hline(10, 20, 11, c)
  g.hline(10, 20, 20, c)
  g.vline(10, 11, 20, c)
  g.vline(20, 11, 20, c)
  g.hline(10, 20, 15, 'grey4')
  // angry eyes on the box
  g.set(13, 13, c)
  g.set(17, 13, c)
  g.line(12, 12, 14, 13, c)
  g.line(18, 12, 16, 13, c)
  // fuse + spark
  g.line(20, 11, 23, 9, 'grey4')
  g.set(24, 8, 'yellow3')
  g.set(24, 9, 'yellow2')
  g.hline(7, 22, 23, 'grey4')
  g.hline(7, 17, 25, 'grey4')
  // chalk smudges
  g.set(25, 21, 'leaf1')
  g.set(6, 18, 'leaf1')
  return g
}

function posterT2(): Grid {
  const g = new Grid(32, 32)
  oRect(g, 3, 1, 26, 30, 'grey5')
  g.rect(4, 2, 24, 5, 'red1')
  g.hline(4, 27, 2, 'red2')
  for (const [x0, x1] of [
    [7, 11],
    [13, 17],
    [19, 24],
  ] as const) {
    g.hline(x0, x1, 4, 'grey5')
  }
  // mugshot frame with a dark parcel and its red bomb
  oRect(g, 8, 8, 16, 14, 'grey3')
  g.rect(11, 11, 10, 8, 'outline')
  g.rect(12, 12, 8, 3, 'grey1')
  g.rect(12, 15, 8, 3, 'grey0')
  g.disc(16, 16.5, 2, 'red1')
  g.set(15, 15, 'red2')
  g.set(18, 13, 'yellow3')
  // printed lines and two pushpins
  g.hline(7, 24, 24, 'grey2')
  g.hline(7, 20, 26, 'grey3')
  g.hline(7, 22, 28, 'grey3')
  g.set(5, 3, 'blue1')
  g.set(26, 3, 'blue1')
  g.hline(4, 29, 31, 'outline')
  g.vline(29, 2, 31, 'outline')
  return g
}

// ---------------------------------------------------------------------------
// Fixtures 64x64

function slotOutline(locked: boolean): Grid {
  const g = new Grid(64, 64)
  if (locked) dashedRect(g, 0, 0, 64, 64, 'grey2', 6, 6)
  else dashedRect(g, 0, 0, 64, 64, 'grey5', 8, 8)
  return g
}

function bin(open: boolean): Grid {
  const g = new Grid(64, 64)
  const x0 = 4
  const w = 56
  // body: top face (lid / opening) y 6..33, front face y 34..59
  oRect(g, x0, 6, w, 54, 'grey2')
  // front face
  g.rect(x0 + 1, 34, w - 2, 25, 'grey2')
  g.hline(x0 + 1, x0 + w - 2, 34, 'grey3')
  hazard(g, x0 + 1, 37, w - 2, 5)
  g.hline(x0 + 1, x0 + w - 2, 36, 'outline')
  g.hline(x0 + 1, x0 + w - 2, 42, 'outline')
  // label plate for the xN counter (centred at 32, 52)
  oRect(g, 18, 45, 28, 13, 'grey4')
  g.hline(19, 44, 46, 'grey5')
  g.hline(x0 + 1, x0 + w - 2, 58, 'grey1')
  // feet + shadow
  g.rect(8, 60, 6, 2, 'outline')
  g.rect(50, 60, 6, 2, 'outline')
  g.hline(x0 + 1, x0 + w, 60, 'outline')
  if (!open) {
    // closed lid: red, lit edges, a grab handle and a hazard triangle
    g.rect(x0 + 1, 7, w - 2, 26, 'red1')
    g.hline(x0 + 1, x0 + w - 2, 7, 'red2')
    g.vline(x0 + 1, 7, 32, 'red2')
    g.hline(x0 + 1, x0 + w - 2, 32, 'red0')
    g.hline(x0 + 1, x0 + w - 2, 33, 'outline')
    oRect(g, 20, 10, 24, 4, 'grey4')
    const tri = new Grid(64, 64)
    for (let i = 0; i < 9; i++) tri.hline(32 - i, 31 + i, 16 + i, 'yellow2')
    tri.outline()
    g.blit(tri, 0, 0)
    g.vline(31, 18, 21, 'outline')
    g.vline(32, 18, 21, 'outline')
    g.set(31, 23, 'outline')
    g.set(32, 23, 'outline')
  } else {
    // open: the lid stands up at the back, the dark inside shows
    g.rect(x0 + 1, 7, w - 2, 26, 'grey1')
    g.rect(x0 + 4, 12, w - 8, 20, 'grey0')
    g.hline(x0 + 4, x0 + w - 5, 12, 'outline')
    // a tossed parcel corner and debris inside
    g.rect(16, 20, 10, 8, 'outline')
    g.rect(17, 21, 8, 3, 'brown1')
    g.rect(17, 24, 8, 3, 'brown0')
    g.rect(36, 22, 8, 6, 'outline')
    g.rect(37, 23, 6, 4, 'grey1')
    g.hline(x0 + 1, x0 + w - 2, 33, 'outline')
    // the lid, edge-on above the bin
    oRect(g, x0, 0, w, 7, 'red1')
    g.hline(x0 + 1, x0 + w - 2, 1, 'red2')
    g.hline(x0 + 1, x0 + w - 2, 5, 'red0')
  }
  return g
}

// ---------------------------------------------------------------------------
// Hold Bay rack 64x256

function rack(): Grid {
  const g = new Grid(64, 256)
  oRect(g, 0, 0, 64, 256, 'grey1')
  // deck under the pads
  g.rect(4, 0, 44, 244, 'grey0')
  // beams between the pads (orange), top of every bay and the base
  for (let i = 0; i <= 5; i++) {
    const y = 48 * i
    if (y > 243) break
    g.rect(1, y, 47, 4, 'orange1')
    g.hline(1, 47, y, i === 0 ? 'outline' : 'orange2')
    g.hline(1, 47, y + 1, 'orange2')
    g.hline(1, 47, y + 3, 'orange0')
  }
  // left upright with perforations
  g.rect(1, 1, 3, 243, 'blue1')
  g.vline(1, 1, 243, 'blue2')
  g.vline(3, 1, 243, 'blue0')
  for (let y = 6; y < 240; y += 6) g.set(2, y, 'grey0')
  // right upright + side panel (lamp spot at 52,4; bay number ticks)
  g.rect(48, 1, 3, 243, 'blue1')
  g.vline(48, 1, 243, 'blue2')
  g.vline(50, 1, 243, 'blue0')
  for (let y = 6; y < 240; y += 6) g.set(49, y, 'grey0')
  g.rect(51, 1, 12, 243, 'grey3')
  g.vline(51, 1, 243, 'grey4')
  g.vline(62, 1, 243, 'grey2')
  oRect(g, 51, 3, 10, 10, 'grey1')
  for (let i = 0; i < 5; i++) {
    const y = 24 + 48 * i
    for (let k = 0; k <= i; k++)
      g.rect(53 + (k % 3) * 3, y + Math.floor(k / 3) * 3, 2, 2, 'grey5')
    g.rect(52, y + 8, 9, 3, 'outline')
    hazard(g, 53, y + 9, 7, 1)
  }
  // base plinth
  g.rect(1, 244, 62, 11, 'grey2')
  g.hline(1, 62, 244, 'grey3')
  g.hline(1, 62, 253, 'grey1')
  g.hline(0, 63, 255, 'outline')
  hazard(g, 4, 247, 56, 4)
  g.hline(4, 59, 246, 'outline')
  g.hline(4, 59, 251, 'outline')
  return g
}

// ---------------------------------------------------------------------------
// Shelf 224x64 (t1 bare timber, t2 painted steel)

function shelf(t2: boolean): Grid {
  const g = new Grid(224, 64)
  const deck = t2 ? 'grey4' : 'brown2'
  const deckHi = t2 ? 'grey5' : 'brown3'
  const seam = t2 ? 'grey3' : 'brown1'
  const lip = t2 ? ['blue2', 'blue1', 'blue0'] : ['brown3', 'brown2', 'brown1']
  const post = t2 ? ['blue2', 'blue1', 'blue0'] : ['brown2', 'brown1', 'brown0']
  oRect(g, 0, 0, 224, 63, deck)
  // back rail
  g.rect(1, 1, 222, 3, t2 ? 'grey2' : 'brown1')
  g.hline(1, 222, 1, t2 ? 'grey3' : 'brown2')
  g.hline(1, 222, 3, 'outline')
  // three deck planks (y 4..15, 16..27, 28..39): seam row, lit row
  for (let k = 0; k < 3; k++) {
    const y = 4 + 12 * k
    if (k > 0) g.hline(1, 222, y, seam)
    g.hline(1, 222, y + 1, deckHi)
  }
  if (!t2) {
    // timber grain
    for (let x = 9; x < 222; x += 23)
      g.hline(x, x + 5, 10 + ((x * 7) % 3) * 12, 'brown1')
  }
  // front lip
  g.rect(1, 40, 222, 5, lip[1] as string)
  g.hline(1, 222, 40, lip[0] as string)
  g.hline(1, 222, 44, lip[2] as string)
  // front face: dark lower bay with a lower shelf board
  g.rect(1, 45, 222, 17, t2 ? 'grey1' : 'brown0')
  g.hline(1, 222, 45, 'outline')
  g.rect(1, 53, 222, 3, t2 ? 'grey3' : 'brown2')
  g.hline(1, 222, 53, t2 ? 'grey4' : 'brown3')
  g.hline(1, 222, 56, 'outline')
  // a few stored boxes on the lower board (behind the posts)
  for (const x of [20, 70, 140, 182]) {
    g.rect(x, 47, 12, 6, 'outline')
    g.rect(x + 1, 48, 10, 5, t2 ? 'brown2' : 'brown1')
    g.hline(x + 1, x + 10, 48, t2 ? 'brown3' : 'brown2')
  }
  if (t2) {
    for (const x of [40, 100, 160]) {
      g.rect(x, 42, 8, 2, 'yellow2')
      g.set(x, 42, 'yellow3')
    }
  }
  // posts at both ends and the middle
  for (const x of [1, 108, 219]) {
    g.rect(x, 40, 4, 22, post[1] as string)
    g.vline(x, 40, 61, post[0] as string)
    g.vline(x + 3, 40, 61, post[2] as string)
  }
  g.hline(0, 223, 62, 'outline')
  g.hline(1, 223, 63, 'outline')
  return g
}

// ---------------------------------------------------------------------------
// Dock door 32x56 (west wall), dock tails 40x40

function door(suffix: string): Grid {
  const g = new Grid(32, 56)
  if (suffix === '_locked') {
    dashedRect(g, 0, 0, 32, 56, 'grey2', 7, 7)
    return g
  }
  oRect(g, 0, 0, 32, 56, 'grey2')
  // hazard-striped jambs top and bottom
  hazard(g, 1, 1, 30, 4)
  hazard(g, 1, 51, 30, 4)
  g.hline(1, 30, 5, 'outline')
  g.hline(1, 30, 50, 'outline')
  if (suffix === '_closed') {
    for (let y = 6; y < 50; y++) {
      const k = (y - 6) % 4
      g.hline(1, 30, y, k === 0 ? 'grey4' : k === 3 ? 'grey2' : 'grey3')
    }
    g.vline(1, 6, 49, 'grey2')
    g.vline(30, 6, 49, 'grey2')
    // handle
    g.rect(26, 26, 3, 4, 'outline')
    g.rect(27, 27, 1, 2, 'grey4')
  } else {
    // open: the lot outside, the shutter drum rolled up along the top jamb
    g.rect(1, 6, 30, 44, 'grey2')
    g.rect(1, 6, 30, 4, 'grey1')
    g.hline(1, 30, 6, 'grey3')
    g.hline(1, 30, 9, 'outline')
    g.rect(1, 10, 30, 3, 'grey0')
    // rubber dock bumpers on the room side
    g.rect(26, 12, 4, 6, 'outline')
    g.rect(26, 38, 4, 6, 'outline')
    g.rect(27, 13, 2, 4, 'grey0')
    g.rect(27, 39, 2, 4, 'grey0')
  }
  return g
}

interface TailStyle {
  y0: number
  y1: number
  roof: [string, string, string] // hi, base, side
  rear: number // x of the rear face
  lights: [number, number]
}

const TAILS: Readonly<Record<string, TailStyle>> = {
  van: {
    y0: 6,
    y1: 33,
    roof: ['blue2', 'blue1', 'blue0'],
    rear: 32,
    lights: [8, 30],
  },
  truck: {
    y0: 2,
    y1: 37,
    roof: ['yellow3', 'yellow2', 'yellow1'],
    rear: 33,
    lights: [4, 34],
  },
}

function tailBox(kind: 'van' | 'truck', open: boolean): Grid {
  const s = TAILS[kind] as TailStyle
  const g = new Grid(40, 40)
  const h = s.y1 - s.y0 + 1
  const roofRows = Math.round(h * 0.7)
  oRect(g, 0, s.y0, s.rear + 2, h, s.roof[1])
  g.hline(1, s.rear, s.y0 + 1, s.roof[0])
  // side (south) face
  g.rect(1, s.y0 + roofRows, s.rear, h - roofRows - 1, s.roof[2])
  g.hline(1, s.rear, s.y0 + roofRows, 'outline')
  if (kind === 'truck') {
    // roof ribs on the trailer
    for (let x = 4; x < s.rear; x += 6)
      g.vline(x, s.y0 + 2, s.y0 + roofRows - 1, s.roof[2])
  } else {
    // roof rack rails
    g.hline(3, s.rear - 4, s.y0 + 5, s.roof[2])
    g.hline(3, s.rear - 4, s.y0 + roofRows - 5, s.roof[2])
  }
  const rx = s.rear
  if (!open) {
    // closed rear: door seam, tail lights, bumper
    g.rect(rx - 2, s.y0 + 1, 2, h - 2, kind === 'truck' ? 'grey3' : s.roof[2])
    g.vline(rx - 2, s.y0 + 1, s.y1 - 1, 'outline')
    g.set(rx - 1, Math.floor((s.y0 + s.y1) / 2), 'outline')
    for (const ly of s.lights) g.rect(rx, ly, 1, 3, 'red1')
    g.rect(rx + 2, s.y0 + 2, 2, h - 4, 'outline')
    g.vline(rx + 2, s.y0 + 3, s.y1 - 3, 'grey1')
  } else {
    // open rear: the dark cargo bay with parcels, doors swung out
    g.rect(rx - 9, s.y0 + 3, 10, h - 6, 'grey0')
    g.vline(rx - 9, s.y0 + 3, s.y1 - 3, 'outline')
    const box = (x: number, y: number, w: number, hh: number) => {
      g.rect(x, y, w, hh, 'outline')
      g.rect(x + 1, y + 1, w - 2, hh - 2, 'brown2')
      g.hline(x + 1, x + w - 2, y + 1, 'brown3')
    }
    box(rx - 8, s.y0 + 5, 6, 6)
    box(rx - 7, s.y1 - 12, 7, 7)
    if (kind === 'truck') box(rx - 8, s.y0 + 14, 6, 7)
    for (const ly of s.lights) g.rect(rx, ly, 1, 3, 'red1')
    // doors folded back along the body sides, poking out past the rear
    const dw = Math.min(8, 40 - rx)
    oRect(g, rx, s.y0 - 2, dw, 3, kind === 'truck' ? 'grey3' : s.roof[1])
    oRect(g, rx, s.y1, dw, 3, kind === 'truck' ? 'grey3' : s.roof[1])
  }
  return g
}

function tailBike(open: boolean): Grid {
  const g = new Grid(40, 40)
  // rear wheel seen from above: a dark tyre with a lit tread line and hub
  const w = new Grid(40, 40)
  w.rect(24, 17, 14, 6, 'grey0')
  w.hline(25, 36, 18, 'grey1')
  w.rect(29, 19, 4, 2, 'grey2')
  w.outline()
  g.blit(w, 0, 0)
  // frame stub and the cargo box on the rear rack
  g.rect(0, 18, 14, 4, 'outline')
  g.rect(0, 19, 13, 2, 'orange1')
  g.hline(0, 12, 19, 'orange2')
  oRect(g, 10, 9, 20, 22, 'orange2')
  g.hline(11, 28, 10, 'orange3')
  g.vline(11, 10, 23, 'orange3')
  g.rect(11, 24, 18, 6, 'orange1')
  g.hline(11, 28, 24, 'outline')
  g.hline(11, 28, 29, 'orange0')
  g.rect(28, 12, 1, 4, 'red1')
  g.rect(28, 24, 1, 4, 'red1')
  if (open) {
    // lid flipped up north, a parcel inside
    g.rect(12, 11, 16, 12, 'grey0')
    g.hline(12, 27, 11, 'outline')
    g.rect(15, 13, 9, 8, 'outline')
    g.rect(16, 14, 7, 6, 'brown2')
    g.hline(16, 22, 14, 'brown3')
    g.vline(19, 14, 19, 'brown3')
    oRect(g, 10, 2, 20, 8, 'orange1')
    g.hline(11, 28, 3, 'orange2')
  } else {
    // lid seam and a latch
    g.hline(11, 28, 16, 'orange1')
    g.rect(18, 17, 4, 2, 'outline')
  }
  g.hline(11, 30, 31, 'outline')
  g.vline(0, 18, 21, 'outline')
  return g
}

// ---------------------------------------------------------------------------
// Desk 48x32

function desk(): Grid {
  const g = new Grid(48, 32)
  // tabletop
  oRect(g, 1, 1, 46, 22, 'brown2')
  g.hline(2, 45, 2, 'brown3')
  g.vline(2, 2, 21, 'brown3')
  for (const [x, y, l] of [
    [8, 17, 9],
    [22, 6, 7],
    [33, 19, 8],
  ] as const) {
    g.hline(x, x + l, y, 'brown1')
  }
  // front face with drawers
  g.rect(2, 22, 44, 6, 'brown1')
  g.hline(2, 45, 22, 'outline')
  g.vline(16, 23, 27, 'brown0')
  g.vline(31, 23, 27, 'brown0')
  for (const x of [8, 23, 38]) g.set(x, 25, 'grey4')
  g.hline(1, 46, 28, 'outline')
  g.vline(1, 22, 28, 'outline')
  g.vline(46, 22, 28, 'outline')
  // legs + shadow
  g.rect(2, 28, 3, 3, 'brown0')
  g.rect(43, 28, 3, 3, 'brown0')
  g.vline(1, 28, 30, 'outline')
  g.vline(5, 28, 30, 'outline')
  g.vline(42, 28, 30, 'outline')
  g.vline(46, 28, 30, 'outline')
  g.hline(1, 47, 31, 'outline')
  // in-tray with a form
  oRect(g, 5, 5, 14, 11, 'grey4')
  g.rect(7, 7, 10, 7, 'grey5')
  g.hline(8, 15, 9, 'grey3')
  g.hline(8, 13, 11, 'grey3')
  // magnifier
  const m = new Grid(48, 32)
  m.disc(29.5, 10.5, 4.5, 'grey4')
  m.disc(29.5, 10.5, 3, 'blue2')
  m.set(28, 9, 'grey5')
  m.line(33, 14, 36, 17, 'brown0')
  m.line(34, 14, 37, 17, 'brown0')
  m.outline()
  g.blit(m, 0, 0)
  // rubber stamp
  oRect(g, 38, 4, 6, 6, 'red1')
  g.hline(39, 42, 5, 'red2')
  return g
}

// ---------------------------------------------------------------------------
// Tier 3 "Regional" (build 2 M8, B2 §4.1 / §6.6, design-m8-m9 §6.4): the
// brick depot of wh_ext_t3 seen from inside — green epoxy floor with yellow
// lane lines, red brick walls over a cream dado, orange-beamed pallet
// racking, a wrapped pallet, a corkboard poster, a cream enamel sign.

function floorT3(d: DrawCtx, lane: boolean): Grid {
  const g = new Grid(T, T)
  const r = rngOf(d, 'epoxy')
  g.rect(0, 0, T, T, 'leaf1')
  // 32-px slab joints (top row, left column), as tiers 1-2
  g.hline(0, T - 1, 0, 'leaf0')
  g.vline(0, 0, T - 1, 'leaf0')
  // polished sheen: a few lit specks and a short scuff
  specks(g, r, 4, 'leaf2', 3, 3, 26, 26)
  specks(g, r, 2, 'leaf0', 3, 3, 26, 26)
  const sx = r.int(6, 20)
  const sy = r.int(6, 24)
  g.hline(sx, sx + 3, sy, 'leaf2')
  if (lane) {
    g.rect(0, 0, 2, T, 'yellow2')
    g.rect(30, 0, 2, T, 'yellow2')
    g.vline(1, 0, T - 1, 'yellow1')
    g.vline(31, 0, T - 1, 'yellow1')
  }
  return g
}

/** red brick courses (running bond, 8x4 bricks) inside a rect */
function bricks(g: Grid, x0: number, y0: number, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const course = Math.floor(y / 4)
    const k = y % 4
    for (let x = 0; x < w; x++) {
      const bx = (x + (course % 2) * 4) % 8
      let c = 'orange1'
      if (k === 3 || bx === 7) c = 'orange0'
      else if (k === 0 && bx < 6) c = 'orange2'
      g.set(x0 + x, y0 + y, c)
    }
  }
}

/** side walls (west c0, east c10): brick between two concrete copings */
function wallT3(): Grid {
  const g = new Grid(T, T)
  bricks(g, 4, 0, 24, T)
  for (const x of [1, 28]) {
    g.rect(x, 0, 3, T, 'grey3')
    g.vline(x, 0, T - 1, 'grey4')
    g.vline(x + 2, 0, T - 1, 'grey2')
  }
  g.vline(0, 0, T - 1, 'outline')
  g.vline(T - 1, 0, T - 1, 'outline')
  return g
}

/** north wall face: brick over a cream painted dado */
function wallfaceT3(): Grid {
  const g = new Grid(T, T)
  g.hline(0, T - 1, 0, 'outline')
  g.rect(0, 1, T, 2, 'grey3')
  g.hline(0, T - 1, 1, 'grey4')
  bricks(g, 0, 3, T, 20)
  // dado: cream panel with a lit top edge and a dark kick plate
  g.hline(0, T - 1, 23, 'outline')
  g.rect(0, 24, T, 6, 'grey4')
  g.hline(0, T - 1, 24, 'grey5')
  g.hline(0, T - 1, 29, 'grey3')
  g.hline(0, T - 1, 30, 'grey0')
  g.hline(0, T - 1, 31, 'outline')
  return g
}

/**
 * Pallet racking 224x64 for the tier >= 3 shelf grid (design-m8-m9 §6.1:
 * 20 x 5 cells @ 11 px from room (35, 388) = canvas (3, 4)): five wire-deck
 * rows y 4 + 11r .. 14 + 11r (seam row 14 + 11r), cell dividers at x
 * 13 + 11c, so every 10x10 mini parcel sits in its own pigeon-hole; blue
 * uprights at both ends, the orange front beam under the last row.
 */
function shelfT3(): Grid {
  const g = new Grid(224, 64)
  oRect(g, 0, 0, 224, 63, 'grey4')
  // back beam
  g.rect(1, 1, 222, 2, 'orange2')
  g.hline(1, 222, 1, 'orange3')
  g.hline(1, 222, 3, 'outline')
  for (let r = 0; r < 5; r++) {
    const y = 4 + 11 * r
    g.hline(1, 222, y, 'grey5')
    g.hline(1, 222, y + 10, 'grey2')
    // wire mesh: a mid line along the row
    g.hline(3, 220, y + 5, 'grey3')
    for (let c = 0; c <= 19; c++) {
      const x = 13 + 11 * c
      if (x > 221) break
      g.vline(x, y + 1, y + 9, 'grey3')
      g.set(x, y, 'grey4')
    }
  }
  // uprights (left lit, right shaded)
  g.rect(1, 4, 2, 55, 'blue1')
  g.vline(1, 4, 58, 'blue2')
  g.rect(222, 4, 1, 55, 'blue0')
  // the orange front beam with its clips
  g.hline(1, 222, 59, 'orange3')
  g.hline(1, 222, 60, 'orange2')
  g.hline(1, 222, 61, 'orange1')
  for (const x of [2, 110, 219]) g.rect(x, 59, 3, 3, 'blue1')
  g.hline(0, 223, 62, 'outline')
  g.hline(1, 223, 63, 'outline')
  return g
}

/**
 * Roller pad 24x56 of docks 2-3 (design-m8-m9 §6.1: conv2 / conv3 east of
 * their door at room (32, door.y)). Flow runs north (to conv1's line), so
 * the rollers run across; six mini-parcel spots centred at (7|18, 11|27|43).
 */
function dockPad(): Grid {
  const g = new Grid(24, 56)
  oRect(g, 0, 0, 24, 56, 'grey2')
  // hazard ends
  hazard(g, 1, 1, 22, 3)
  hazard(g, 1, 52, 22, 3)
  g.hline(1, 22, 4, 'outline')
  g.hline(1, 22, 51, 'outline')
  // rollers between the rails: lit top, body, shadow line
  const ROLL = ['grey4', 'grey3', 'grey3', 'grey1']
  for (let y = 5; y <= 50; y++) {
    g.hline(3, 20, y, ROLL[(y - 5) % 4] as string)
  }
  // side rails with the roller axle ends
  g.rect(1, 5, 2, 46, 'grey3')
  g.vline(1, 5, 50, 'grey4')
  g.rect(21, 5, 2, 46, 'grey1')
  for (let y = 6; y <= 50; y += 4) {
    g.set(2, y, 'grey0')
    g.set(21, y, 'grey0')
  }
  return g
}

/** a 3/4 pallet: slats on the top edge, blocks on the front face */
function pallet(g: Grid, x: number, y: number, w: number): void {
  oRect(g, x, y, w, 7, 'brown2')
  g.hline(x + 1, x + w - 2, y + 1, 'brown3')
  g.rect(x + 1, y + 3, w - 2, 3, 'brown1')
  for (let bx = x + 2; bx < x + w - 3; bx += Math.floor((w - 5) / 2)) {
    g.rect(bx, y + 3, 3, 3, 'brown0')
  }
  g.hline(x + 1, x + w - 1, y + 7, 'outline')
}

function propsT3(): Grid {
  const g = new Grid(48, 64)
  // the wrapped load: back boxes, front boxes, on a pallet
  crate(g, 4, 3, 20, 16, CARDBOARD)
  crate(g, 22, 4, 21, 15, CARD_LIGHT)
  crate(g, 3, 17, 22, 20, CARD_LIGHT)
  crate(g, 23, 18, 21, 19, CARDBOARD)
  pallet(g, 2, 37, 44)
  // stretch film: lit diagonal glints and a pale band round the load
  for (const [x0, y0] of [
    [6, 8],
    [27, 22],
    [9, 26],
    [33, 7],
  ] as const) {
    for (let i = 0; i < 4; i++) g.set(x0 + i, y0 + i, 'grey5')
  }
  g.hline(4, 43, 29, 'blue2')
  g.hline(4, 43, 30, 'grey5')
  // the pallet jack in front: forks under the pallet, body, handle
  g.rect(8, 45, 26, 3, 'grey3')
  g.hline(8, 33, 45, 'grey4')
  g.hline(8, 33, 48, 'outline')
  oRect(g, 30, 44, 12, 10, 'orange2')
  g.hline(31, 40, 45, 'orange3')
  g.hline(31, 40, 52, 'orange1')
  g.rect(33, 49, 6, 2, 'grey1')
  // handle (tilted back toward the viewer) and its grip
  g.vline(36, 54, 60, 'orange1')
  g.vline(37, 54, 60, 'orange2')
  oRect(g, 32, 59, 10, 3, 'grey1')
  // wheels
  g.rect(31, 54, 3, 2, 'outline')
  g.rect(39, 54, 3, 2, 'outline')
  g.hline(30, 43, 63, 'outline')
  return g
}

/** corkboard with the L3 battery-strain WANTED sheet and a sticky note */
function posterT3(): Grid {
  const g = new Grid(32, 32)
  oRect(g, 1, 1, 30, 30, 'brown0')
  g.rect(2, 2, 28, 28, 'brown2')
  g.hline(2, 29, 2, 'brown1')
  g.vline(2, 2, 29, 'brown1')
  for (const [x, y] of [
    [5, 26],
    [27, 6],
    [4, 13],
    [26, 18],
    [12, 28],
    [21, 27],
  ] as const) {
    g.set(x, y, 'brown3')
  }
  // the WANTED sheet
  oRect(g, 5, 4, 19, 23, 'grey5')
  g.rect(6, 5, 17, 4, 'red1')
  g.hline(6, 22, 5, 'red2')
  for (const [x0, x1] of [
    [8, 11],
    [13, 16],
    [18, 21],
  ] as const) {
    g.hline(x0, x1, 7, 'grey5')
  }
  // mugshot: the dark parcel with an orange battery and its yellow bolt
  oRect(g, 8, 10, 13, 11, 'grey1')
  g.rect(9, 11, 11, 3, 'grey2')
  g.rect(12, 13, 5, 7, 'outline')
  g.rect(13, 14, 3, 5, 'orange2')
  g.hline(13, 15, 14, 'orange3')
  g.rect(13, 12, 3, 1, 'grey3')
  g.set(14, 15, 'yellow3')
  g.set(13, 16, 'yellow3')
  g.set(14, 16, 'yellow3')
  g.set(14, 17, 'yellow3')
  // printed lines
  g.hline(8, 20, 22, 'grey3')
  g.hline(8, 17, 24, 'grey3')
  // pins
  g.set(6, 4, 'blue1')
  g.set(22, 4, 'blue1')
  // a yellow sticky note over the corner
  oRect(g, 20, 20, 9, 9, 'yellow3')
  g.hline(21, 27, 21, 'yellow2')
  g.hline(22, 26, 23, 'yellow1')
  g.hline(22, 25, 25, 'yellow1')
  g.set(24, 20, 'red1')
  g.hline(1, 30, 31, 'outline')
  return g
}

// ---------------------------------------------------------------------------
// Tiers 4 "National" and 5 "Tycoon" (build 2 M9, B2 §4.2-§4.4 / §6.6,
// design-m8-m9 §6.4). Tier 4 = wh_ext_t4 from inside: charcoal anti-slip
// epoxy, grey ribbed steel cladding with a blue band, yellow / blue
// high-bay racking, a forklift, a steel notice board. Tier 5 = the glass HQ
// of wh_ext_t5: white terrazzo, blue glass in white mullions, pink neon
// (neon_strip replaces the strip lights), white gloss racking, a palm and a
// delivery robot, a MOST WANTED wall screen. Interior classes have no
// `water` / `gold` ramps (palette.ts RAMP_RULES), so glass is the blue ramp
// and the trim the yellow one.

function floorT4(d: DrawCtx, lane: boolean): Grid {
  const g = new Grid(T, T)
  const r = rngOf(d, 'epoxy4')
  g.rect(0, 0, T, T, 'grey1')
  // 32-px slab joints with a lit bevel
  g.hline(0, T - 1, 0, 'grey0')
  g.vline(0, 0, T - 1, 'grey0')
  g.hline(1, T - 1, 1, 'grey2')
  // anti-slip grit
  specks(g, r, 6, 'grey2', 3, 3, 26, 26)
  specks(g, r, 3, 'grey0', 3, 3, 26, 26)
  if (lane) {
    g.rect(0, 0, 2, T, 'yellow2')
    g.rect(30, 0, 2, T, 'yellow2')
    g.vline(1, 0, T - 1, 'yellow1')
    g.vline(31, 0, T - 1, 'yellow1')
  }
  return g
}

function floorT5(d: DrawCtx, lane: boolean): Grid {
  const g = new Grid(T, T)
  const r = rngOf(d, 'terrazzo')
  g.rect(0, 0, T, T, 'grey5')
  g.hline(0, T - 1, 0, 'grey4')
  g.vline(0, 0, T - 1, 'grey4')
  // terrazzo chips in the HQ's colours, and a pale sheen streak
  specks(g, r, 4, 'grey3', 3, 3, 26, 26)
  specks(g, r, 2, 'pink1', 3, 3, 26, 26)
  specks(g, r, 2, 'blue2', 3, 3, 26, 26)
  specks(g, r, 1, 'yellow3', 3, 3, 26, 26)
  const sx = r.int(4, 18)
  const sy = r.int(5, 24)
  for (let i = 0; i < 5; i++) g.set(sx + i, sy - (i >> 1), 'grey4')
  if (lane) {
    g.rect(0, 0, 2, T, 'pink1')
    g.rect(30, 0, 2, T, 'pink1')
    g.vline(1, 0, T - 1, 'pink0')
    g.vline(31, 0, T - 1, 'pink0')
  }
  return g
}

/** side walls (west c0, east c10): ribbed steel cladding with a blue band */
function wallT4(): Grid {
  const g = new Grid(T, T)
  for (let y = 0; y < T; y++) {
    const k = y % 4
    g.hline(2, T - 3, y, k === 0 ? 'grey4' : k === 3 ? 'grey2' : 'grey3')
  }
  g.rect(13, 0, 6, T, 'blue1')
  g.vline(13, 0, T - 1, 'blue2')
  g.vline(18, 0, T - 1, 'blue0')
  g.vline(1, 0, T - 1, 'grey4')
  g.vline(T - 2, 0, T - 1, 'grey1')
  g.vline(0, 0, T - 1, 'outline')
  g.vline(T - 1, 0, T - 1, 'outline')
  return g
}

/** side walls of the HQ: blue glass in white mullions, seen from above */
function wallT5(): Grid {
  const g = new Grid(T, T)
  g.rect(4, 0, 24, T, 'blue2')
  g.rect(4, 0, 3, T, 'blue1')
  g.vline(27, 0, T - 1, 'blue1')
  // a transom every 16 px and a glint per pane
  for (const y of [0, 16]) {
    g.hline(4, 27, y, 'grey5')
    g.hline(4, 27, y + 1, 'grey4')
    for (let i = 0; i < 4; i++) g.set(10 + i, y + 9 - i, 'grey5')
    g.set(16, y + 9, 'grey5')
  }
  // the white mullions along both edges
  for (const x of [1, 28]) {
    g.rect(x, 0, 3, T, 'grey4')
    g.vline(x, 0, T - 1, 'grey5')
    g.vline(x + 2, 0, T - 1, 'grey3')
  }
  g.vline(0, 0, T - 1, 'outline')
  g.vline(T - 1, 0, T - 1, 'outline')
  return g
}

/** north wall face: ribbed steel cladding, a blue band, a yellow kick rail */
function wallfaceT4(): Grid {
  const g = new Grid(T, T)
  g.hline(0, T - 1, 0, 'outline')
  g.hline(0, T - 1, 1, 'grey4')
  g.hline(0, T - 1, 2, 'grey2')
  for (let x = 0; x < T; x++) {
    const k = x % 4
    const c = k === 0 ? 'grey4' : k === 3 ? 'grey2' : 'grey3'
    g.vline(x, 3, 17, c)
    g.vline(x, 23, 25, c)
  }
  g.rect(0, 18, T, 5, 'blue1')
  g.hline(0, T - 1, 18, 'blue2')
  g.hline(0, T - 1, 22, 'blue0')
  g.hline(0, T - 1, 26, 'outline')
  g.rect(0, 27, T, 3, 'yellow2')
  g.hline(0, T - 1, 27, 'yellow3')
  g.hline(0, T - 1, 29, 'yellow1')
  g.hline(0, T - 1, 30, 'grey0')
  g.hline(0, T - 1, 31, 'outline')
  return g
}

/** north wall face: glass panes in white mullions, a white dado with a pink neon line */
function wallfaceT5(): Grid {
  const g = new Grid(T, T)
  g.hline(0, T - 1, 0, 'outline')
  g.hline(0, T - 1, 1, 'grey5')
  g.hline(0, T - 1, 2, 'grey4')
  g.rect(0, 3, T, 18, 'blue2')
  g.rect(0, 3, T, 2, 'blue1')
  for (const x of [0, 16]) {
    g.vline(x, 3, 20, 'grey5')
    g.vline(x + 1, 3, 20, 'grey4')
    for (let i = 0; i < 5; i++) g.set(x + 5 + i, 15 - i, 'grey5')
    g.set(x + 11, 14, 'grey5')
    g.set(x + 12, 13, 'grey5')
  }
  g.hline(0, T - 1, 21, 'outline')
  g.rect(0, 22, T, 8, 'grey5')
  g.hline(0, T - 1, 24, 'pink0')
  g.hline(0, T - 1, 25, 'pink1')
  g.hline(0, T - 1, 26, 'pink0')
  g.hline(0, T - 1, 29, 'grey4')
  g.hline(0, T - 1, 30, 'grey3')
  g.hline(0, T - 1, 31, 'outline')
  return g
}

interface RackScheme {
  /** deck fill, the mesh line along each row, the cell dividers */
  deck: string
  mesh: string
  divider: string
  /** back beam [lit top, body] */
  back: [string, string]
  /** uprights [lit, body, shade] */
  upright: [string, string, string]
  /** front beam rows y 59 / 60 / 61 */
  front: [string, string, string]
  clip: string
}

/**
 * The tier >= 3 racking geometry of shelfT3 (20 x 5 cells @ 11 px from
 * canvas (3, 4); row tops grey5 at y 4 + 11r, seams grey2 at y 14 + 11r,
 * dividers at x 13 + 11c) in another colour scheme.
 */
function rackShelf(s: RackScheme): Grid {
  const g = new Grid(224, 64)
  oRect(g, 0, 0, 224, 63, s.deck)
  g.rect(1, 1, 222, 2, s.back[1])
  g.hline(1, 222, 1, s.back[0])
  g.hline(1, 222, 3, 'outline')
  for (let r = 0; r < 5; r++) {
    const y = 4 + 11 * r
    g.hline(1, 222, y, 'grey5')
    g.hline(1, 222, y + 10, 'grey2')
    g.hline(3, 220, y + 5, s.mesh)
    for (let c = 0; c <= 19; c++) {
      const x = 13 + 11 * c
      if (x > 221) break
      g.vline(x, y + 1, y + 9, s.divider)
      g.set(x, y, s.deck)
    }
  }
  g.rect(1, 4, 2, 55, s.upright[1])
  g.vline(1, 4, 58, s.upright[0])
  g.rect(222, 4, 1, 55, s.upright[2])
  g.hline(1, 222, 59, s.front[0])
  g.hline(1, 222, 60, s.front[1])
  g.hline(1, 222, 61, s.front[2])
  for (const x of [2, 110, 219]) g.rect(x, 59, 3, 3, s.clip)
  g.hline(0, 223, 62, 'outline')
  g.hline(1, 223, 63, 'outline')
  return g
}

/** tier 4 high-bay racking: steel decks, yellow uprights, a blue front beam */
function shelfT4(): Grid {
  return rackShelf({
    deck: 'grey3',
    mesh: 'grey2',
    divider: 'grey2',
    back: ['blue2', 'blue1'],
    upright: ['yellow3', 'yellow2', 'yellow1'],
    front: ['blue2', 'blue1', 'blue0'],
    clip: 'yellow2',
  })
}

/** tier 5 white gloss racking: chrome uprights, a pink neon front beam */
function shelfT5(): Grid {
  return rackShelf({
    deck: 'grey4',
    mesh: 'grey5',
    divider: 'grey3',
    back: ['pink1', 'pink0'],
    upright: ['grey5', 'grey4', 'grey2'],
    front: ['pink1', 'grey5', 'pink0'],
    clip: 'grey2',
  })
}

const TOTE: BoxScheme = {
  top: 'blue2',
  topHi: 'grey5',
  front: 'blue1',
  frontLo: 'blue0',
}

/**
 * A yellow forklift seen from behind (facing north, into the room) with a
 * pallet of blue totes raised on its forks: load, mast, overhead guard over
 * the seat, the counterweight with its hazard stripe nearest the viewer.
 */
function propsT4(): Grid {
  const g = new Grid(48, 64)
  const f = new Grid(48, 64)
  // wheels first (the body overlaps their inner halves)
  for (const [x, y] of [
    [4, 34],
    [39, 34],
    [4, 50],
    [39, 50],
  ] as const) {
    f.rect(x, y, 5, 8, 'grey0')
    f.vline(x + 1, y + 1, y + 6, 'grey1')
  }
  // counterweight
  f.rect(8, 46, 32, 14, 'yellow2')
  f.hline(8, 39, 46, 'yellow3')
  f.rect(8, 53, 32, 7, 'yellow1')
  hazard(f, 10, 55, 28, 3)
  f.set(9, 54, 'red1')
  f.set(38, 54, 'red1')
  // the seat under the overhead guard
  f.rect(10, 34, 28, 13, 'grey1')
  f.rect(17, 37, 14, 8, 'grey0')
  f.hline(17, 30, 37, 'grey1')
  // guard: two posts each side and roof bars (seat shows between)
  for (const x of [10, 36]) {
    f.rect(x, 33, 2, 14, 'yellow2')
    f.vline(x, 33, 46, 'yellow3')
  }
  f.hline(10, 37, 33, 'yellow3')
  f.hline(10, 37, 34, 'yellow1')
  for (const y of [38, 42]) f.hline(12, 35, y, 'grey2')
  // mast: the two channels and the crossbar behind the load
  f.rect(9, 27, 30, 6, 'grey2')
  f.hline(9, 38, 27, 'grey3')
  f.hline(9, 38, 32, 'grey1')
  f.rect(12, 27, 3, 6, 'grey1')
  f.rect(33, 27, 3, 6, 'grey1')
  f.outline()
  g.blit(f, 0, 0)
  // the pallet and four blue totes on the forks
  pallet(g, 6, 20, 36)
  crate(g, 8, 1, 16, 11, TOTE)
  crate(g, 24, 1, 16, 11, TOTE)
  crate(g, 7, 9, 17, 12, TOTE)
  crate(g, 24, 9, 17, 12, TOTE)
  // tote handles (dark slots on the front faces)
  for (const x of [12, 29]) g.hline(x, x + 6, 17, 'blue0')
  g.hline(4, 44, 61, 'outline')
  return g
}

/**
 * A tall potted palm in a white planter (left) and a small white delivery
 * robot carrying a parcel (right): the HQ's lobby touch.
 */
function propsT5(): Grid {
  const g = new Grid(48, 64)
  const p = new Grid(48, 64)
  // fronds radiating from the crown at (12, 30)
  const tips: readonly [number, number][] = [
    [2, 10],
    [7, 3],
    [15, 1],
    [22, 7],
    [24, 18],
    [1, 22],
    [22, 27],
  ]
  for (const [tx, ty] of tips) {
    p.line(12, 30, tx, ty, 'leaf1')
    p.line(12, 29, tx, ty + 1, 'leaf2')
    // leaflets: short ticks along the frond
    for (let k = 1; k <= 3; k++) {
      const x = Math.round(12 + ((tx - 12) * k) / 4)
      const y = Math.round(30 + ((ty - 30) * k) / 4)
      p.set(x + 1, y + 1, 'grass2')
      p.set(x - 1, y + 1, 'leaf0')
    }
  }
  // trunk
  for (let y = 30; y <= 43; y++) {
    p.hline(11, 13, y, y % 3 === 0 ? 'brown0' : 'brown1')
  }
  p.set(11, 33, 'brown2')
  p.set(12, 39, 'brown2')
  // white planter with a lit rim and a soil top
  p.rect(3, 43, 19, 18, 'grey5')
  p.rect(3, 50, 19, 11, 'grey4')
  p.hline(3, 21, 43, 'grey5')
  p.hline(4, 20, 44, 'brown0')
  p.hline(5, 19, 45, 'brown1')
  p.vline(21, 46, 60, 'grey3')
  p.hline(3, 21, 51, 'pink1')
  p.outline()
  g.blit(p, 0, 0)
  // the robot: a white box on dark wheels, a sensor band with a pink eye
  const b = new Grid(48, 64)
  b.rect(26, 42, 19, 16, 'grey5')
  b.rect(26, 48, 19, 10, 'grey4')
  b.hline(26, 44, 48, 'grey3')
  b.rect(28, 50, 15, 3, 'blue0')
  b.hline(28, 42, 50, 'blue1')
  b.set(35, 51, 'pink1')
  b.set(36, 51, 'pink1')
  b.rect(27, 58, 4, 3, 'grey0')
  b.rect(40, 58, 4, 3, 'grey0')
  b.outline()
  g.blit(b, 0, 0)
  // the parcel riding on top
  crate(g, 29, 33, 13, 10, CARDBOARD)
  g.hline(2, 46, 62, 'outline')
  return g
}

/** steel notice board: the L4 dense-strain WANTED sheet and a blue magnet */
function posterT4(): Grid {
  const g = new Grid(32, 32)
  oRect(g, 1, 1, 30, 30, 'grey3')
  g.rect(2, 2, 28, 28, 'grey4')
  g.hline(2, 29, 2, 'grey5')
  g.vline(2, 2, 29, 'grey5')
  g.hline(2, 29, 29, 'grey2')
  g.vline(29, 2, 29, 'grey2')
  // the WANTED sheet with a blue header
  oRect(g, 5, 4, 19, 23, 'grey5')
  g.rect(6, 5, 17, 4, 'blue1')
  g.hline(6, 22, 5, 'blue2')
  for (const [x0, x1] of [
    [8, 11],
    [13, 16],
    [18, 21],
  ] as const) {
    g.hline(x0, x1, 7, 'grey5')
  }
  // mugshot: the dense parcel, a heavy grey weight with its handle
  oRect(g, 8, 10, 13, 11, 'grey3')
  g.rect(9, 11, 11, 3, 'grey4')
  g.hline(12, 16, 12, 'outline')
  g.set(12, 13, 'outline')
  g.set(16, 13, 'outline')
  for (let y = 14; y <= 19; y++) {
    const w = 2 + (y - 14)
    g.hline(14 - Math.floor(w / 2) - 1, 14 + Math.ceil(w / 2), y, 'grey1')
  }
  g.hline(12, 15, 15, 'grey2')
  // the typosquat label: a yellow tag with a misprinted line
  g.rect(18, 22, 5, 3, 'yellow2')
  g.hline(19, 21, 23, 'outline')
  g.set(20, 23, 'red1')
  g.hline(8, 16, 22, 'grey3')
  g.hline(8, 14, 24, 'grey3')
  // the magnet and a second, older sheet's corner
  g.disc(14, 4, 1.5, 'blue1')
  g.set(13, 3, 'blue2')
  g.rect(25, 18, 4, 9, 'grey5')
  g.vline(28, 18, 26, 'grey3')
  g.hline(1, 30, 31, 'outline')
  return g
}

/** wall screen: MOST WANTED, the four strains' mugshots in a 2x2 grid */
function posterT5(): Grid {
  const g = new Grid(32, 32)
  oRect(g, 1, 2, 30, 26, 'grey5')
  g.hline(2, 29, 26, 'grey4')
  // the display
  g.rect(3, 4, 26, 21, 'blue0')
  g.rect(3, 4, 26, 3, 'pink0')
  for (const [x0, x1] of [
    [5, 9],
    [11, 17],
    [19, 26],
  ] as const) {
    g.hline(x0, x1, 5, 'grey5')
  }
  // four mugshot cells: metal (ring), rattle (pink), battery (orange),
  // dense (grey weight)
  const cells: readonly [number, number][] = [
    [5, 8],
    [17, 8],
    [5, 16],
    [17, 16],
  ]
  for (const [x, y] of cells) {
    g.rect(x, y, 10, 7, 'blue1')
    g.hline(x, x + 9, y, 'blue2')
  }
  // metal: a grey washer
  g.rect(8, 10, 4, 3, 'grey3')
  g.set(9, 11, 'outline')
  g.set(10, 11, 'outline')
  // rattle: a pink ball on a stick
  g.rect(20, 9, 3, 3, 'pink1')
  g.set(23, 12, 'yellow2')
  g.set(24, 13, 'yellow2')
  // battery: an orange cell with its bolt
  g.rect(9, 17, 3, 5, 'orange2')
  g.set(10, 16, 'grey3')
  g.set(10, 19, 'yellow3')
  // dense: a grey weight
  g.hline(21, 23, 17, 'grey2')
  g.rect(20, 18, 5, 4, 'grey1')
  g.hline(21, 23, 18, 'grey2')
  // the stand and a pink status LED
  g.rect(14, 28, 4, 2, 'grey3')
  g.hline(12, 19, 30, 'grey2')
  g.set(27, 26, 'pink1')
  g.hline(11, 20, 31, 'outline')
  g.vline(13, 28, 29, 'outline')
  g.vline(18, 28, 29, 'outline')
  g.set(11, 30, 'outline')
  g.set(20, 30, 'outline')
  return g
}

// ---------------------------------------------------------------------------
// Signs 200x24

/** tier 3: cream enamel face (dark text, as t2), green band with rivets */
function signT3(): Grid {
  const g = new Grid(200, 24)
  oRect(g, 0, 0, 200, 24, 'leaf1')
  g.hline(1, 198, 1, 'leaf2')
  g.vline(1, 1, 22, 'leaf2')
  g.hline(1, 198, 22, 'leaf0')
  g.vline(198, 1, 22, 'leaf0')
  // the cream face inside a 1-px outline
  oRect(g, 3, 3, 194, 18, 'grey5')
  g.hline(4, 195, 19, 'grey4')
  // rivets in the band
  for (const x of [5, 194]) {
    g.set(x, 1, 'grey4')
    g.set(x, 22, 'grey3')
  }
  for (const x of [50, 100, 150]) {
    g.set(x, 1, 'grey4')
    g.set(x, 22, 'grey3')
  }
  return g
}

/**
 * tier 4: a pale face (dark text, as t2 / t3) in a blue band, yellow
 * chevron caps inside the face's ends (x 4..7 / 192..195, outside the text
 * area x 8..191), bolts in the band
 */
function signT4(): Grid {
  const g = new Grid(200, 24)
  oRect(g, 0, 0, 200, 24, 'blue1')
  g.hline(1, 198, 1, 'blue2')
  g.vline(1, 1, 22, 'blue2')
  g.hline(1, 198, 22, 'blue0')
  g.vline(198, 1, 22, 'blue0')
  oRect(g, 3, 3, 194, 18, 'grey5')
  g.hline(4, 195, 19, 'grey4')
  // chevrons pointing inward on yellow
  for (const [x0, dir] of [
    [4, 1],
    [192, -1],
  ] as const) {
    g.rect(x0, 4, 4, 15, 'yellow2')
    g.vline(dir === 1 ? x0 + 4 : x0 - 1, 4, 18, 'outline')
    for (let y = 4; y <= 18; y++) {
      const k = (y - 4) % 6
      const off = k < 3 ? k : 5 - k
      g.set(dir === 1 ? x0 + off : x0 + 3 - off, y, 'outline')
    }
  }
  for (const x of [8, 66, 133, 191]) {
    g.set(x, 1, 'grey4')
    g.set(x, 22, 'grey2')
  }
  return g
}

/**
 * tier 5: a white lightbox face (dark text) in a dark board ringed by a
 * pink neon tube with white-hot corners
 */
function signT5(): Grid {
  const g = new Grid(200, 24)
  oRect(g, 0, 0, 200, 24, 'grey0')
  // the neon tube one pixel inside the outline
  g.hline(1, 198, 1, 'pink1')
  g.hline(1, 198, 22, 'pink1')
  g.vline(1, 1, 22, 'pink1')
  g.vline(198, 1, 22, 'pink1')
  for (const [x, y] of [
    [1, 1],
    [198, 1],
    [1, 22],
    [198, 22],
  ] as const) {
    g.set(x, y, 'grey5')
  }
  // its glow on the board
  g.hline(2, 197, 2, 'pink0')
  g.hline(2, 197, 21, 'pink0')
  g.vline(2, 2, 21, 'pink0')
  g.vline(197, 2, 21, 'pink0')
  oRect(g, 3, 3, 194, 18, 'grey5')
  g.hline(4, 195, 19, 'grey4')
  return g
}

function signT1(): Grid {
  const g = new Grid(200, 24)
  oRect(g, 0, 0, 200, 24, 'brown1')
  g.hline(1, 198, 1, 'brown2')
  g.vline(1, 1, 22, 'brown2')
  g.hline(1, 198, 22, 'brown0')
  g.vline(198, 1, 22, 'brown0')
  g.rect(3, 3, 194, 18, 'leaf0')
  g.hline(3, 196, 3, 'outline')
  g.vline(3, 3, 20, 'outline')
  // a stick of chalk on the bottom ledge
  g.hline(14, 19, 22, 'grey5')
  return g
}

function signT2(): Grid {
  const g = new Grid(200, 24)
  oRect(g, 0, 0, 200, 24, 'grey5')
  g.rect(1, 1, 198, 2, 'blue1')
  g.rect(1, 21, 198, 2, 'blue1')
  g.hline(1, 198, 1, 'blue2')
  g.hline(1, 198, 22, 'blue0')
  // safety striped end caps
  for (const x of [1, 189]) {
    hazard(g, x, 3, 10, 18)
    g.vline(x === 1 ? 11 : 188, 3, 20, 'outline')
  }
  g.hline(12, 187, 20, 'grey4')
  return g
}

function signCrack(full: boolean): Grid {
  const g = new Grid(200, 24)
  const path: [number, number][] = [
    [138, 0],
    [141, 4],
    [139, 8],
    [144, 12],
    [142, 16],
    [146, 20],
    [145, 23],
  ]
  const segs = full ? path.length - 1 : 3
  for (let i = 0; i < segs; i++) {
    const [ax, ay] = path[i] as [number, number]
    const [bx, by] = path[i + 1] as [number, number]
    g.line(ax, ay, bx, by, 'outline')
    g.line(ax + 1, ay, bx + 1, by, 'outline')
  }
  if (full) {
    g.line(144, 12, 151, 10, 'outline')
    g.line(151, 10, 155, 12, 'outline')
    g.line(142, 16, 134, 19, 'outline')
    g.line(139, 8, 132, 6, 'outline')
    // a chipped corner
    g.rect(194, 18, 5, 5, 'outline')
  }
  return g
}

// ---------------------------------------------------------------------------
// Machines 48x48: an arch straddling the belt, opening x 12..35

function metalDetector(scan: boolean): Grid {
  const g = new Grid(48, 48)
  const panel = (x: number) => {
    // a long slab along the belt: top face, then the south front face
    oRect(g, x, 8, 10, 38, 'grey4')
    g.vline(x + 1, 9, 36, 'grey5')
    g.vline(x + 8, 9, 36, 'grey3')
    g.rect(x + 1, 37, 8, 8, 'blue1')
    g.hline(x + 1, x + 8, 37, 'blue2')
    g.hline(x, x + 9, 36, 'outline')
    g.hline(x + 1, x + 8, 44, 'blue0')
    // sensor grille on the top face
    for (let y = 14; y < 34; y += 3) g.hline(x + 3, x + 6, y, 'grey3')
    g.rect(x + 3, 39, 4, 2, scan ? 'yellow2' : 'grass2')
    g.hline(x + 1, x + 9, 46, 'outline')
  }
  panel(2)
  panel(36)
  // header beam across the opening: top face + front face with the light strip
  oRect(g, 1, 1, 46, 15, 'grey3')
  g.rect(2, 2, 44, 6, 'grey4')
  g.hline(2, 45, 2, 'grey5')
  g.hline(1, 46, 8, 'outline')
  g.rect(2, 9, 44, 6, 'grey2')
  g.rect(6, 10, 36, 3, scan ? 'yellow2' : 'blue2')
  g.hline(6, 41, 10, scan ? 'yellow3' : 'blue2')
  g.hline(6, 41, 12, scan ? 'yellow1' : 'blue1')
  g.hline(5, 42, 9, 'outline')
  g.hline(5, 42, 13, 'outline')
  g.vline(5, 9, 13, 'outline')
  g.vline(42, 9, 13, 'outline')
  return g
}

function shakyShaker(shift: number): Grid {
  const g = new Grid(48, 48)
  // static base plates + springs
  for (const x of [1, 35]) {
    oRect(g, x, 36, 12, 10, 'grey2')
    g.hline(x + 1, x + 10, 37, 'grey3')
    g.hline(x, x + 11, 46, 'outline')
    // a coil spring: lit coils on a dark core
    g.rect(x + 3, 30, 6, 6, 'outline')
    for (const y of [30, 32, 34]) g.hline(x + 4, x + 7, y, 'grey4')
  }
  // the shaking upper part
  const u = new Grid(48, 48)
  for (const x of [2, 36]) {
    oRect(u, x, 8, 10, 23, 'orange2')
    u.vline(x + 1, 9, 21, 'orange3')
    u.rect(x + 1, 22, 8, 8, 'orange1')
    u.hline(x, x + 9, 21, 'outline')
    u.hline(x + 1, x + 8, 22, 'orange2')
    u.rect(x + 3, 25, 4, 2, 'outline')
  }
  oRect(u, 1, 1, 46, 13, 'grey3')
  u.rect(2, 2, 44, 5, 'grey4')
  u.hline(2, 45, 2, 'grey5')
  u.hline(1, 46, 7, 'outline')
  u.rect(2, 8, 44, 5, 'grey2')
  hazard(u, 6, 9, 36, 3)
  u.hline(6, 41, 8, 'outline')
  u.hline(6, 41, 12, 'outline')
  // warning light in the middle of the crossbar top
  u.rect(21, 2, 6, 5, 'outline')
  u.rect(22, 3, 4, 3, shift === 0 ? 'yellow1' : 'yellow3')
  u.set(22, 3, shift === 0 ? 'yellow2' : 'grey5')
  g.blit(u, shift, 0)
  if (shift !== 0) {
    // motion ticks on the outside of the side blocks
    const sx = shift < 0 ? 0 : 47
    for (const y of [12, 18, 24]) g.set(sx, y, 'outline')
  }
  return g
}

// Build 2 M6 placeholders of the PixelLab machines (shown only while no
// candidate is chosen): battery_checker and xray keep the metal detector's
// belt-opening contract (x 12..35 empty below row 16), the sorter_arm is a
// 64x64 fixture (pedestal, two segments, a claw; f0 rest, f1 reach toward
// the rack on the left, f2 toss toward the bin on the right).

function batteryChecker(scan: boolean): Grid {
  const g = new Grid(48, 48)
  const pillar = (x: number) => {
    oRect(g, x, 8, 10, 38, 'grass1')
    g.vline(x + 1, 9, 36, 'grass2')
    g.vline(x + 8, 9, 36, 'grass0')
    g.hline(x, x + 9, 36, 'outline')
    g.rect(x + 1, 37, 8, 8, 'grey2')
    g.hline(x + 1, x + 8, 37, 'grey3')
    g.hline(x + 1, x + 9, 46, 'outline')
    // the charge meter: four cells, lit bottom-up
    oRect(g, x + 2, 14, 6, 20, 'outline')
    for (let k = 0; k < 4; k++) {
      const lit = k < (scan ? 4 : 2)
      g.rect(x + 3, 29 - k * 5, 4, 4, lit ? 'grass3' : 'grey1')
    }
  }
  pillar(2)
  pillar(36)
  oRect(g, 1, 3, 46, 13, 'grey3')
  g.rect(2, 4, 44, 4, 'grey4')
  g.hline(2, 45, 4, 'grey5')
  g.hline(1, 46, 8, 'outline')
  g.rect(2, 9, 44, 6, 'grey2')
  g.rect(6, 10, 36, 3, scan ? 'yellow2' : 'blue2')
  g.hline(6, 41, 12, scan ? 'yellow1' : 'blue1')
  g.hline(5, 42, 9, 'outline')
  g.hline(5, 42, 13, 'outline')
  // the battery on the header: body + terminal
  oRect(g, 16, 0, 14, 7, 'grass2')
  g.hline(17, 28, 1, 'grass3')
  g.rect(30, 2, 3, 3, 'outline')
  g.set(31, 3, 'grey4')
  return g
}

function xrayScanner(scan: boolean): Grid {
  const g = new Grid(48, 48)
  // the tunnel housing: thick side walls and a deep roof over the belt
  for (const x of [1, 35]) {
    oRect(g, x, 6, 12, 41, 'grey4')
    g.vline(x + 1, 7, 44, 'grey5')
    g.vline(x + 10, 7, 44, 'grey3')
    g.hline(x + 1, x + 10, 45, 'grey3')
  }
  oRect(g, 0, 1, 48, 16, 'grey4')
  g.rect(1, 2, 46, 6, 'grey5')
  g.hline(0, 47, 8, 'outline')
  g.rect(1, 9, 46, 7, 'grey3')
  // the lead curtain lip and the light strip
  g.rect(12, 14, 24, 2, 'grey1')
  g.rect(8, 10, 32, 2, scan ? 'yellow2' : 'blue2')
  // the monitor on the right wall: a parcel on the screen
  oRect(g, 37, 20, 9, 9, 'outline')
  g.rect(38, 21, 7, 7, scan ? 'blue2' : 'blue0')
  g.rect(40, 23, 3, 3, scan ? 'grey5' : 'blue1')
  return g
}

/** sorter arm pose: shoulder angle per frame (rest, reach, toss) */
function sorterArm(frame: number): Grid {
  const g = new Grid(64, 64)
  // pedestal: a round base plate and a column
  const base = new Grid(64, 64)
  base.disc(32, 55.5, 9, 'grey2')
  base.disc(32, 54.5, 7, 'grey3')
  base.rect(28, 38, 8, 16, 'orange2')
  base.vline(28, 38, 53, 'orange3')
  base.vline(35, 38, 53, 'orange1')
  base.outline()
  g.blit(base, 0, 0)
  // upper arm and forearm as thick segments
  const pose = [
    { elbow: [34, 22], hand: [44, 12] },
    { elbow: [22, 26], hand: [10, 34] },
    { elbow: [42, 24], hand: [54, 30] },
  ][frame] ?? { elbow: [34, 22], hand: [44, 12] }
  const arm = new Grid(64, 64)
  const seg = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        arm.line(x0 + dx, y0 + dy, x1 + dx, y1 + dy, c)
  }
  const [ex, ey] = pose.elbow as [number, number]
  const [hx, hy] = pose.hand as [number, number]
  seg(32, 38, ex, ey, 'yellow2')
  seg(ex, ey, hx, hy, 'yellow1')
  arm.disc(32, 38.5, 3.5, 'grey3')
  arm.disc(ex + 0.5, ey + 0.5, 3, 'grey3')
  // the claw: two fingers either side of the hand
  arm.rect(hx - 3, hy - 1, 7, 3, 'grey2')
  arm.rect(hx - 3, hy + 2, 2, 3, 'grey2')
  arm.rect(hx + 2, hy + 2, 2, 3, 'grey2')
  arm.outline()
  g.blit(arm, 0, 0)
  // status lamp on the column: blue at rest, amber while working
  g.rect(31, 44, 2, 2, frame === 0 ? 'blue2' : 'yellow3')
  return g
}

// ---------------------------------------------------------------------------
// Hold Bay station (build 2 M6, B2 §2.6, design-m6 §6.4/§6.5): the 48x48
// podium right of the rack where the sorter stands (interior back layer;
// the sorter sprite is drawn over it by WorkerSprites). A rubber floor mat
// with painted corner marks (the station zone) and, on its west half, a
// standing desk seen top-down 3/4 with the sorter's clipboard and a roll of
// green `looks clean` tags; the east half of the mat stays clear for the
// sorter's stand point.

function holdStation(): Grid {
  const g = new Grid(48, 48)
  // floor mat: dark rubber with a lit top edge and a dot texture
  oRect(g, 0, 12, 48, 36, 'grey1')
  g.hline(1, 46, 13, 'grey2')
  g.vline(1, 13, 46, 'grey2')
  for (let y = 16; y < 46; y += 3) {
    for (let x = 3 + (y % 2); x < 46; x += 3) g.set(x, y, 'grey0')
  }
  for (const [x, y, sx, sy] of [
    [3, 15, 1, 1],
    [44, 15, -1, 1],
    [3, 44, 1, -1],
    [44, 44, -1, -1],
  ] as const) {
    for (let i = 0; i < 4; i++) {
      g.set(x + sx * i, y, 'yellow2')
      g.set(x, y + sy * i, 'yellow2')
    }
  }
  // the standing desk: top face (lit wood), crease, front face, shadow
  const px = 3
  const pw = 22
  oRect(g, px, 1, pw, 36, 'brown1')
  g.rect(px + 1, 2, pw - 2, 20, 'brown2')
  g.hline(px + 1, px + pw - 2, 2, 'brown3')
  g.vline(px + 1, 2, 21, 'brown3')
  g.hline(px + 1, px + pw - 2, 22, 'outline')
  g.rect(px + 1, 23, pw - 2, 12, 'brown1')
  g.hline(px + 1, px + pw - 2, 23, 'brown2')
  oRect(g, px + 4, 25, pw - 8, 8, 'brown0')
  g.hline(px + 5, px + pw - 6, 26, 'brown1')
  g.hline(px, px + pw - 1, 37, 'outline')
  // the clipboard: board, paper with ticked lines, metal clip
  oRect(g, px + 2, 4, 13, 16, 'brown0')
  g.rect(px + 3, 6, 11, 13, 'grey5')
  for (const y of [9, 12, 15]) {
    g.set(px + 5, y, 'grass1')
    g.set(px + 4, y - 1, 'grass1')
    g.hline(px + 7, px + 12, y, 'grey3')
  }
  oRect(g, px + 6, 3, 5, 3, 'grey3')
  g.set(px + 7, 4, 'grey5')
  // the tag roll beside the clipboard
  oRect(g, px + 16, 6, 5, 7, 'grass2')
  g.hline(px + 17, px + 19, 7, 'grass3')
  g.set(px + 18, 9, 'grey5')
  g.hline(px + 16, px + 20, 13, 'outline')
  return g
}

// ---------------------------------------------------------------------------
// worker_sorter (B2 §6.7): the worker in an orange vest — every `worker`
// final (PixelLab, kept) remapped yellow ramp -> orange ramp
// (variants.ts SORTER_SWAP); without a final (a fresh placeholder run) the
// procedural worker frame is swapped instead.

function sorterFrame(suffix: string): Img {
  const p = join(FINAL_DIR, 'worker', `worker${suffix}.png`)
  if (existsSync(p)) return sorterImg(readImg(p).img)
  const g = workerFrame(suffix)
  for (const [a, b] of SORTER_SWAP) g.swap(a, b)
  const img = newImg(24, 32)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 24; x++) {
      const c = g.get(x, y)
      if (c !== null) put(img, x, y, c)
    }
  }
  return img
}

registerDrawer({ id: 'worker_sorter' }, (d) =>
  d.entry.frames.map((suffix) => ({
    suffix,
    canvas: imgToCanvas(sorterFrame(suffix), d),
  })),
)

/** grey silhouette (fill grey2, outline grey1, style-guide §4.3) */
function silhouette(kind: string): Grid {
  const s = new Grid(48, 48)
  const f = 'grey2'
  if (kind === 'battery') {
    s.rect(3, 10, 8, 35, f)
    s.rect(37, 10, 8, 35, f)
    s.rect(2, 4, 44, 11, f)
    // the battery on the header
    s.rect(14, 0, 18, 9, f)
    s.rect(32, 3, 3, 3, f)
  } else if (kind === 'xray') {
    // a tunnel box over the belt with curtain strips in its mouth
    s.rect(2, 4, 44, 40, f)
    s.rect(0, 12, 2, 24, f)
    s.rect(46, 12, 2, 24, f)
    for (let x = 12; x < 36; x += 4) s.rect(x, 32, 2, 12, null)
  } else {
    // sorter arm: base, two segments, a claw
    s.disc(12, 39, 7, f)
    s.rect(8, 26, 7, 14, f)
    s.line(11, 27, 30, 12, f)
    s.line(12, 28, 31, 13, f)
    s.line(13, 28, 32, 13, f)
    s.line(11, 26, 30, 11, f)
    s.disc(31, 12, 4, f)
    s.rect(33, 13, 9, 3, f)
    s.rect(39, 9, 3, 5, f)
    s.rect(39, 15, 3, 5, f)
  }
  s.outline('grey1')
  return s
}

// ---------------------------------------------------------------------------
// Worker 24x32: 4 facings x idle/walk/scan (2 frames) + jump

const W_CHARS = {
  N: 'brown1',
  T: 'brown0',
  s: ['skin0', 'skin0', 'orange3'] as const,
  o: 'outline',
  y: ['yellow2', 'yellow3', 'yellow1'] as const,
  W: 'grey5',
  b: ['blue1', 'blue2', 'blue0'] as const,
  B: 'blue0',
  K: 'grey0',
  M: 'grey3',
} as const

const SOUTH = [
  '...NNNNNN...',
  '..NTTTTTTN..',
  '..TTTTTTTT..',
  '.TTTTTTTTTT.',
  '..ssssssss..',
  '..sossssos..',
  '..ssssssss..',
  '...ssssss...',
  '..yyyyyyyy..',
  '.byyyWWyyyb.',
  '.byyyyyyyyb.',
  '.byWWWWWWyb.',
  '.byyyyyyyyb.',
  '.syyyyyyyys.',
  '..BBBBBBBB..',
  '..BBB..BBB..',
  '..BBB..BBB..',
  '..KKK..KKK..',
]

const NORTH = [
  '...NNNNNN...',
  '..NTTTTTTN..',
  '..TTTTTTTT..',
  '..TTTKKTTT..',
  '..NNNNNNNN..',
  '..NNNNNNNN..',
  '..sNNNNNNs..',
  '...ssssss...',
  '..yyyyyyyy..',
  '.byyyyyyyyb.',
  '.byWWyyWWyb.',
  '.byyWWWWyyb.',
  '.byWWyyWWyb.',
  '.syyyyyyyys.',
  '..BBBBBBBB..',
  '..BBB..BBB..',
  '..BBB..BBB..',
  '..KKK..KKK..',
]

const EAST = [
  '...NNNNN....',
  '..NTTTTTN...',
  '..TTTTTTTT..',
  '..TTTTTTTTTT',
  '..Nsssssss..',
  '..Nsssssos..',
  '..Nsssssss..',
  '....sssss...',
  '...yyyyyy...',
  '...yyyyyy...',
  '...WWbbWW...',
  '...yybbyy...',
  '...yybbyy...',
  '...yysyyy...',
  '...BBBBBB...',
  '....BBBB....',
  '....BBBB....',
  '....KKKKK...',
]

type Dir = 's' | 'n' | 'e' | 'w'

function setCh(rows: string[], x: number, y: number, c: string): void {
  const r = rows[y]
  if (r === undefined || x < 0 || x >= r.length) return
  rows[y] = r.slice(0, x) + c + r.slice(x + 1)
}

function mirror(rows: readonly string[]): string[] {
  return rows.map((r) => r.split('').toReversed().join(''))
}

/** base template rows of a facing ('w' mirrors 'e') */
function baseRows(dir: Dir): string[] {
  if (dir === 's') return SOUTH.slice()
  if (dir === 'n') return NORTH.slice()
  if (dir === 'e') return EAST.slice()
  return mirror(EAST)
}

/** legs for walking: frame 0 / 1 */
function walkLegs(rows: string[], dir: Dir, f: number): void {
  if (dir === 's' || dir === 'n') {
    if (f === 0) {
      rows[16] = '..BBB..KKK..'
      rows[17] = '..KKK.......'
    } else {
      rows[16] = '..KKK..BBB..'
      rows[17] = '.......KKK..'
    }
    return
  }
  const legs =
    f === 0
      ? ['...BBBBBB...', '...BB..BB...', '..BB....BB..', '..KK....KKK.']
      : ['...BBBBBB...', '....BBBB....', '....BBBB....', '....KKKKK...']
  const l = dir === 'w' ? mirror(legs) : legs
  l.forEach((r, i) => {
    rows[14 + i] = r
  })
}

function idleBob(rows: string[]): string[] {
  // the upper body sinks 1 px (the trouser top row is hidden)
  return ['.'.repeat(12), ...rows.slice(0, 14), ...rows.slice(15)]
}

/** jump: arms flung up and out */
function jumpArms(rows: string[], dir: Dir): void {
  if (dir === 's' || dir === 'n') {
    for (let y = 9; y <= 13; y++) {
      setCh(rows, 1, y, '.')
      setCh(rows, 10, y, '.')
    }
    setCh(rows, 1, 8, 'b')
    setCh(rows, 10, 8, 'b')
    setCh(rows, 0, 7, 'b')
    setCh(rows, 11, 7, 'b')
    setCh(rows, 0, 6, 's')
    setCh(rows, 11, 6, 's')
    if (dir === 's') {
      // surprised mouth
      setCh(rows, 5, 6, 'o')
      setCh(rows, 6, 6, 'o')
    }
    return
  }
  const e = dir === 'e'
  for (let y = 10; y <= 13; y++) {
    setCh(rows, e ? 5 : 6, y, 'y')
    setCh(rows, e ? 6 : 5, y, 'y')
  }
  setCh(rows, 10, 10, 'W')
  setCh(rows, e ? 9 : 2, 8, 'b')
  setCh(rows, e ? 10 : 1, 7, 'b')
  setCh(rows, e ? 11 : 0, 6, 's')
  setCh(rows, e ? 2 : 9, 8, 'b')
  setCh(rows, e ? 1 : 10, 7, 's')
}

/** worker grid for one frame suffix (e.g. '_e_scan_1', '_s_jump') */
function workerFrame(suffix: string): Grid {
  const m = /^_([snew])_(idle|walk|scan|jump)(?:_([01]))?$/.exec(suffix)
  if (!m) throw new Error(`worker: bad frame ${suffix}`)
  const dir = m[1] as Dir
  const pose = m[2] as string
  const f = Number(m[3] ?? 0)
  let rows = baseRows(dir)
  let lift = 0
  if (pose === 'idle' && f === 1) rows = idleBob(rows)
  if (pose === 'walk') walkLegs(rows, dir, f)
  if (pose === 'jump') {
    jumpArms(rows, dir)
    lift = 2
  }
  if (pose === 'scan') {
    if (dir === 'e' || dir === 'w') {
      // the near arm reaches forward with the hand scanner
      const e = dir === 'e'
      for (let y = 10; y <= 13; y++) {
        setCh(rows, e ? 5 : 6, y, 'y')
        setCh(rows, e ? 6 : 5, y, 'y')
      }
      setCh(rows, e ? 3 : 8, 10, 'W')
      setCh(rows, e ? 4 : 7, 10, 'W')
      for (let x = 6; x <= 10; x++) setCh(rows, e ? x : 11 - x, 11, 'b')
      setCh(rows, e ? 11 : 0, 11, 's')
    } else {
      // arm raised overhead holding the scanner up
      const ax = dir === 's' ? 10 : 1
      for (let y = 9; y <= 13; y++) setCh(rows, ax, y, '.')
      setCh(rows, ax + (dir === 's' ? 1 : -1), 9, 'b')
      setCh(rows, ax + (dir === 's' ? 1 : -1), 8, 'b')
      setCh(rows, ax + (dir === 's' ? 1 : -1), 7, 's')
    }
  }
  const ox = 6
  const oy = 11 - lift
  const g = tpl(rows, 24, 32, ox, oy, W_CHARS)
  if (pose === 'scan') {
    const light = f === 0 ? 'grass2' : 'red2'
    if (dir === 'e' || dir === 'w') {
      const e = dir === 'e'
      const hx = ox + (e ? 12 : -1)
      g.set(hx, oy + 11, 'grey3')
      g.set(hx + (e ? 1 : -1), oy + 11, 'grey3')
      g.set(hx + (e ? 2 : -2), oy + 11, light)
      g.set(hx, oy + 10, 'grey2')
      if (f === 1) g.set(hx + (e ? 3 : -3), oy + 11, 'yellow3')
    } else {
      const hx = ox + (dir === 's' ? 11 : 0)
      g.set(hx, oy + 6, 'grey3')
      g.set(hx, oy + 5, 'grey3')
      g.set(hx, oy + 4, light)
      if (f === 1) g.set(hx, oy + 3, 'yellow3')
    }
  }
  g.outline()
  // ground shadow (stays on the ground when jumping)
  g.hline(8, 15, 30, 'outline')
  g.hline(9, 14, 31, 'outline')
  return g
}

// ---------------------------------------------------------------------------
// Registration

reg('floor_t1', (_s, i, d) => floorT1(d, i))
reg('floor_t2', (_s, _i, d) => floorT2(d, false))
reg('floor_t2_lane', (_s, _i, d) => floorT2(d, true))
reg('wall_t1', (_s, _i, d) => wallT1(d))
reg('wall_t2', () => wallT2())
reg('wallface_t1', (_s, _i, d) => wallfaceT1(d))
reg('wallface_t2', () => wallfaceT2())
// build 2 M8: tier 3 (design-m8-m9 §6.4)
reg('floor_t3', (_s, _i, d) => floorT3(d, false))
reg('floor_t3_lane', (_s, _i, d) => floorT3(d, true))
reg('wall_t3', () => wallT3())
reg('wallface_t3', () => wallfaceT3())
reg('shelf_t3', () => shelfT3())
reg('sign_t3', () => signT3())
reg('props_t3', () => propsT3())
reg('wanted_poster_t3', () => posterT3())
reg('dock_pad', () => dockPad())
// build 2 M9: tiers 4-5 (design-m8-m9 §6.4)
reg('floor_t4', (_s, _i, d) => floorT4(d, false))
reg('floor_t4_lane', (_s, _i, d) => floorT4(d, true))
reg('floor_t5', (_s, _i, d) => floorT5(d, false))
reg('floor_t5_lane', (_s, _i, d) => floorT5(d, true))
reg('wall_t4', () => wallT4())
reg('wall_t5', () => wallT5())
reg('wallface_t4', () => wallfaceT4())
reg('wallface_t5', () => wallfaceT5())
reg('shelf_t4', () => shelfT4())
reg('shelf_t5', () => shelfT5())
reg('sign_t4', () => signT4())
reg('sign_t5', () => signT5())
reg('props_t4', () => propsT4())
reg('props_t5', () => propsT5())
reg('wanted_poster_t4', () => posterT4())
reg('wanted_poster_t5', () => posterT5())
reg('neon_strip', (s) => neonStrip(s === '_f0'))
reg('baseboard', () => baseboard())
reg('belt_h', (_s, i) => beltH(i))
reg('belt_v', (_s, i) => beltV(i))
reg('belt_corner', (_s, i) => beltCorner(i))
reg('chute_v', () => chuteV())
reg('lane_arrow', (_s, i) => laneArrow(i))
reg('chute_outlet', () => chuteOutlet())
reg('ext_outline', () => extOutline())
reg('station_outline', () => stationOutline())
reg('bay_pad', () => bayPad())
reg('bay_pad_locked', () => bayPadLocked())
reg('lamp', (s) => lamp(s))
reg('bulb', (s) => bulb(s === '_0'))
reg('strip_light', () => stripLight())
reg('props_t1', () => propsT1())
reg('props_t2', () => propsT2())
reg('wanted_poster_t1', () => posterT1())
reg('wanted_poster_t2', () => posterT2())
reg('slot_empty_outline', () => slotOutline(false))
reg('slot_locked_outline', () => slotOutline(true))
reg('bin', (s) => bin(s === '_open'))
reg('holdbay_rack', () => rack())
reg('shelf_t1', () => shelf(false))
reg('shelf_t2', () => shelf(true))
reg('dock_door', (s) => door(s))
reg('dock_tail_van', (s) => tailBox('van', s === '_open'))
reg('dock_tail_truck', (s) => tailBox('truck', s === '_open'))
reg('dock_tail_bike', (s) => tailBike(s === '_open'))
reg('desk', () => desk())
reg('sign_t1', () => signT1())
reg('sign_t2', () => signT2())
reg('sign_crack', (s) => signCrack(s === '_1'))
reg('metal_detector', (_s, i) => metalDetector(i === 1))
reg('shaky_shaker', (_s, i) => shakyShaker([0, -1, 1][i] ?? 0))
reg('battery_checker', (_s, i) => batteryChecker(i === 1))
reg('xray', (_s, i) => xrayScanner(i === 1))
reg('sorter_arm', (_s, i) => sorterArm(i))
reg('hold_station', () => holdStation())
reg('battery_checker_sil', () => silhouette('battery'))
reg('xray_sil', () => silhouette('xray'))
reg('sorter_arm_sil', () => silhouette('sorter'))
reg('worker', (s) => workerFrame(s))
