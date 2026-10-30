// icon16 drawers (style-guide.md §2.5, §2.8): HUD / card icons, the parcel
// minis, wh_dock_light and the onboarding arrow. Every icon is a 16x16 frame
// with a >= 1-px transparent margin and a 1-px `outline` silhouette, lit from
// the top-left (light edge top/left, dark edge bottom/right). Icons are never
// scaled in-engine, so each one is drawn at its final 1x size.
//
// This file also holds the small pixel toolkit shared by the interior/UI art
// modules (warehouse.ts, parcels.ts, ui.ts, fx.ts):
//   Grid      a palette-id pixel buffer (compose, shade, outline, blit, paint)
//   tpl()     ASCII template -> Grid, chars mapped through CHARS
//   shade()   automatic top-left light / bottom-right dark per material
//   box3q()   a top-down 3/4 box (top face + front face) used by parcels/props
// All of it is integer, palette-only and deterministic (draw-api.ts contract).

import { registerDrawer } from './drawers.ts'
import type { DrawCtx, DrawnFrame, Drawer, SKRSContext2D } from './draw-api.ts'

// ---------------------------------------------------------------------------
// Pixel toolkit

/** A palette-id pixel buffer; null = transparent. */
export class Grid {
  w: number
  h: number
  px: (string | null)[]

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.px = Array.from({ length: w * h }, () => null)
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }

  get(x: number, y: number): string | null {
    return this.inside(x, y) ? (this.px[y * this.w + x] ?? null) : null
  }

  set(x: number, y: number, c: string | null): void {
    if (this.inside(x, y)) this.px[y * this.w + x] = c
  }

  rect(x: number, y: number, w: number, h: number, c: string | null): void {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) this.set(x + i, y + j, c)
    }
  }

  hline(x0: number, x1: number, y: number, c: string | null): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c)
  }

  vline(x: number, y0: number, y1: number, c: string | null): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c)
  }

  /** Bresenham line */
  line(x0: number, y0: number, x1: number, y1: number, c: string | null): void {
    let x = x0
    let y = y0
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      this.set(x, y, c)
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

  /** filled disc; (cx, cy) in pixel-edge coordinates (8, 8 = canvas centre) */
  disc(cx: number, cy: number, r: number, c: string | null): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        if (dx * dx + dy * dy <= r * r) this.set(x, y, c)
      }
    }
  }

  /** annulus r0 < d <= r1, optionally limited to an angular fraction */
  ring(
    cx: number,
    cy: number,
    r0: number,
    r1: number,
    c: string | null,
    keep?: (angle: number) => boolean,
  ): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        const d2 = dx * dx + dy * dy
        if (d2 <= r0 * r0 || d2 > r1 * r1) continue
        // angle 0 = 12 o'clock, clockwise, in [0, 1)
        const a = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1
        if (!keep || keep(a)) this.set(x, y, c)
      }
    }
  }

  /** paint another grid on top (null pixels are skipped) */
  blit(g: Grid, dx: number, dy: number): void {
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const c = g.get(x, y)
        if (c !== null) this.set(dx + x, dy + y, c)
      }
    }
  }

  clone(): Grid {
    const g = new Grid(this.w, this.h)
    g.px = this.px.slice()
    return g
  }

  /** mirrored left-right copy */
  mirrorX(): Grid {
    const g = new Grid(this.w, this.h)
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) g.set(this.w - 1 - x, y, this.get(x, y))
    }
    return g
  }

  /** replace colour a by b everywhere */
  swap(a: string, b: string): void {
    for (let i = 0; i < this.px.length; i++)
      if (this.px[i] === a) this.px[i] = b
  }

  /**
   * Outer outline: every transparent pixel 4-adjacent to a non-outline opaque
   * pixel becomes `c` (the silhouette grows by 1 px). `diag` also fills
   * 8-adjacent corners.
   */
  outline(c = 'outline', diag = false): void {
    const src = this.px.slice()
    const at = (x: number, y: number) =>
      this.inside(x, y) ? (src[y * this.w + x] ?? null) : null
    const solid = (x: number, y: number) => {
      const v = at(x, y)
      return v !== null && v !== c
    }
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (at(x, y) !== null) continue
        let hit =
          solid(x - 1, y) ||
          solid(x + 1, y) ||
          solid(x, y - 1) ||
          solid(x, y + 1)
        if (!hit && diag) {
          hit =
            solid(x - 1, y - 1) ||
            solid(x + 1, y - 1) ||
            solid(x - 1, y + 1) ||
            solid(x + 1, y + 1)
        }
        if (hit) this.set(x, y, c)
      }
    }
  }

  /** Inner outline: opaque pixels touching transparency (or the edge) -> c. */
  edge(c = 'outline', canvasEdge = true): void {
    const src = this.px.slice()
    const empty = (x: number, y: number) =>
      this.inside(x, y) ? src[y * this.w + x] === null : canvasEdge
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src[y * this.w + x] === null) continue
        if (
          empty(x - 1, y) ||
          empty(x + 1, y) ||
          empty(x, y - 1) ||
          empty(x, y + 1)
        ) {
          this.set(x, y, c)
        }
      }
    }
  }

  /** opaque bounding box [x0, y0, x1, y1] inclusive, or null */
  bbox(): [number, number, number, number] | null {
    let x0 = this.w
    let y0 = this.h
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) === null) continue
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
    return x1 < 0 ? null : [x0, y0, x1, y1]
  }

  /** paint onto a canvas context through d.hex (run-length per row) */
  paint(ctx: SKRSContext2D, d: DrawCtx, ox = 0, oy = 0): void {
    for (let y = 0; y < this.h; y++) {
      let x = 0
      while (x < this.w) {
        const c = this.get(x, y)
        if (c === null) {
          x++
          continue
        }
        let e = x + 1
        while (e < this.w && this.get(e, y) === c) e++
        ctx.fillStyle = d.hex(c)
        ctx.fillRect(ox + x, oy + y, e - x, 1)
        x = e
      }
    }
  }
}

/** One material: [base, light (top/left edge), dark (bottom/right edge)]. */
export type Mat = readonly [string, string, string]

/**
 * ASCII template alphabet shared by every module. Lower-case letters are
 * shaded materials (auto light/dark edges), everything else is one flat
 * palette colour. '.' and ' ' are transparent.
 */
export const CHARS: Readonly<Record<string, string | Mat>> = {
  // shaded materials
  c: ['gold1', 'gold2', 'gold0'],
  r: ['red1', 'red2', 'red0'],
  y: ['yellow2', 'yellow3', 'yellow1'],
  b: ['blue1', 'blue2', 'blue0'],
  g: ['grass2', 'grass3', 'grass1'],
  w: ['grey5', 'grey5', 'grey4'],
  l: ['grey4', 'grey5', 'grey3'],
  m: ['grey3', 'grey4', 'grey2'],
  d: ['grey1', 'grey2', 'grey0'],
  n: ['brown2', 'brown3', 'brown1'],
  t: ['brown1', 'brown2', 'brown0'],
  a: ['orange2', 'orange3', 'orange1'],
  p: ['pink1', 'pink1', 'pink0'],
  v: ['mal1', 'mal2', 'mal0'],
  u: ['purple1', 'purple2', 'purple0'],
  f: ['leaf1', 'leaf2', 'leaf0'],
  e: ['grass1', 'grass2', 'grass0'],
  s: ['skin0', 'skin0', 'orange3'],
  // flat colours
  o: 'outline',
  K: 'grey0',
  D: 'grey1',
  G: 'grey2',
  M: 'grey3',
  L: 'grey4',
  W: 'grey5',
  R: 'red0',
  P: 'red2',
  Y: 'yellow3',
  U: 'yellow1',
  O: 'yellow0',
  C: 'gold0',
  Q: 'gold2',
  B: 'blue0',
  H: 'blue2',
  E: 'grass1',
  N: 'brown1',
  T: 'brown0',
  A: 'orange1',
  V: 'mal0',
  X: 'mal2',
  S: 'skin0',
  I: 'pink0',
  Z: 'purple0',
  F: 'leaf0',
  J: 'leaf2',
  '+': 'grass3',
  '=': 'grass2',
  '~': 'red1',
  '*': 'yellow2',
  '^': 'blue1',
  '#': 'outline',
}

/**
 * Template rows -> Grid of size (w, h), template placed at (ox, oy).
 * Shaded materials get their light colour where the top or left neighbour
 * is transparent/outline (and not the bottom/right), their dark colour in
 * the mirrored case, else the base colour.
 */
export function tpl(
  rows: readonly string[],
  w: number,
  h: number,
  ox = 0,
  oy = 0,
  chars: Readonly<Record<string, string | Mat>> = CHARS,
): Grid {
  const g = new Grid(w, h)
  const ch = (x: number, y: number) => {
    const row = rows[y]
    if (!row || x < 0 || x >= row.length) return '.'
    return row[x] as string
  }
  const open = (x: number, y: number) => {
    const c = ch(x, y)
    return c === '.' || c === ' ' || c === 'o'
  }
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] as string
    for (let x = 0; x < row.length; x++) {
      const c = row[x] as string
      if (c === '.' || c === ' ') continue
      const m = chars[c]
      if (m === undefined) throw new Error(`tpl: no colour for '${c}'`)
      if (typeof m === 'string') {
        g.set(ox + x, oy + y, m)
        continue
      }
      const lightEdge = open(x, y - 1) || open(x - 1, y)
      const darkEdge = open(x, y + 1) || open(x + 1, y)
      const col =
        lightEdge && !darkEdge ? m[1] : darkEdge && !lightEdge ? m[2] : m[0]
      g.set(ox + x, oy + y, col)
    }
  }
  return g
}

/** template centred on a w x h grid (ties toward the top-left) */
export function tplCentred(
  rows: readonly string[],
  w: number,
  h: number,
): Grid {
  const tw = Math.max(...rows.map((r) => r.length))
  const th = rows.length
  return tpl(rows, w, h, Math.floor((w - tw) / 2), Math.floor((h - th) / 2))
}

/** paint a grid as the only picture of every frame of the entry */
export function gridFrames(d: DrawCtx, grids: readonly Grid[]): DrawnFrame[] {
  return d.entry.frames.map((suffix, i) => {
    const g = grids[i]
    if (!g) throw new Error(`${d.entry.id}: no grid for frame '${suffix}'`)
    const { canvas, ctx } = d.newCanvas(d.entry.canvas[0], d.entry.canvas[1])
    g.paint(ctx, d)
    return { suffix, canvas }
  })
}

/** Drawer from one grid builder called per frame suffix. */
export function perFrame(
  build: (suffix: string, i: number, d: DrawCtx) => Grid,
): Drawer {
  return (d) =>
    gridFrames(
      d,
      d.entry.frames.map((s, i) => build(s, i, d)),
    )
}

/** Palette scheme of a top-down 3/4 box (parcels, crates, props). */
export interface BoxScheme {
  top: string
  topHi: string
  front: string
  frontLo: string
  tape?: string
  tapeFront?: string
}

export const CARDBOARD: BoxScheme = {
  top: 'brown2',
  topHi: 'brown3',
  front: 'brown1',
  frontLo: 'brown1',
  tape: 'brown3',
  tapeFront: 'brown2',
}

/**
 * Top-down 3/4 box with its 1-px outline included in (w, h): the top face
 * (lit, a highlight row under the top outline) over the front face (the
 * base step), split at `topRows` (default ~58 % of the inner height).
 * Light comes from the top-left (style-guide §1.2 interior rule).
 */
export function box3q(
  g: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
  s: BoxScheme,
  topRows?: number,
): void {
  const iw = w - 2
  const ih = h - 2
  const tr = topRows ?? Math.max(1, Math.round(ih * 0.58))
  g.rect(x, y, w, h, 'outline')
  g.rect(x + 1, y + 1, iw, tr, s.top)
  g.hline(x + 1, x + iw, y + 1, s.topHi)
  g.vline(x + 1, y + 1, y + tr, s.topHi)
  g.rect(x + 1, y + 1 + tr, iw, ih - tr, s.front)
  if (ih - tr >= 3) g.hline(x + 1, x + iw, y + ih, s.frontLo)
  if (s.tape && iw >= 4) {
    const tw = iw >= 10 ? 2 : 1
    const tx = x + 1 + Math.floor((iw - tw) / 2)
    g.rect(tx, y + 1, tw, tr, s.tape)
    g.rect(tx, y + 1 + tr, tw, ih - tr, s.tapeFront ?? s.tape)
  }
  // the edge between top and front reads as a crisp crease
  if (ih - tr >= 2 && tr >= 2)
    g.hline(x + 1, x + iw, y + tr, s.top === s.topHi ? s.front : s.top)
}

// ---------------------------------------------------------------------------
// Icon templates (body <= 12x12; the outline pass adds 1 px around it)

const ICON = 16

/** icon grid: template centred on 16x16, then the outer outline */
export function iconGrid(rows: readonly string[]): Grid {
  const g = tplCentred(rows, ICON, ICON)
  g.outline()
  return g
}

const COIN = [
  '....cccc....',
  '..cccccccc..',
  '.cccccCcccc.',
  '.ccccCCCCcc.',
  'ccccCcCccccc',
  'cccccCCCcccc',
  'ccccccCcCccc',
  'ccccCCCCcccc',
  '.cccccCcccc.',
  '.cccccccccc.',
  '..cccccccc..',
  '....cccc....',
]

// a round bomb, body d=10 with a metal cap at the top-right
function bomb(body: string, fuse: readonly string[]): string[] {
  const b = [
    '..........',
    '......mmm.',
    '...bbbmmm.',
    '..bbbbbbb.',
    '.bbbbbbbbb',
    'bbbbbbbbbb',
    'bbbbbbbbbb',
    'bbbbbbbbbb',
    'bbbbbbbbbb',
    '.bbbbbbbb.',
    '..bbbbbb..',
    '...bbbb...',
  ].map((r) => r.replaceAll('b', body))
  // fuse rows overlay the first rows (2 extra columns to the right)
  return b.map((r, i) => {
    const f = fuse[i] ?? '..'
    return r + f
  })
}

const FUSE_UNLIT = ['.D', 'D.']
const FUSE_SPARK0 = ['YP', 'D.']
const FUSE_SPARK1 = ['PY', 'Y.']

function face(mat: string, mouth: readonly string[], brows = false): string[] {
  const rows = [
    '....ffff....',
    '..ffffffff..',
    '.ffffffffff.',
    '.ffffffffff.',
    'ffffffffffff',
    'ffffffffffff',
    'ffffffffffff',
    'ffffffffffff',
    '.ffffffffff.',
    '.ffffffffff.',
    '..ffffffff..',
    '....ffff....',
  ].map((r) => r.split(''))
  const put = (x: number, y: number) => {
    const row = rows[y]
    if (row) row[x] = 'o'
  }
  // eyes 1x2
  put(3, 4)
  put(3, 5)
  put(8, 4)
  put(8, 5)
  if (brows) {
    put(2, 2)
    put(3, 3)
    put(9, 2)
    put(8, 3)
  }
  mouth.forEach((m, j) => {
    for (let i = 0; i < m.length; i++) if (m[i] === 'o') put(i, 7 + j)
  })
  return rows.map((r) => r.join('').replaceAll('f', mat))
}

const ICONS: Record<string, readonly string[]> = {
  ic_money: COIN,
  ic_life_on: bomb('r', FUSE_UNLIT),
  ic_life_off: bomb('d', ['..', '..']).map((r) => r.replaceAll('m', 'd')),
  ic_bomb: bomb('r', FUSE_SPARK0),
  ic_shield: [
    '.wwwwwwllll.',
    'wwwwwwwlllll',
    'wwwwwwwlllll',
    'wwwwwwwlllll',
    'wwwwwwwlllll',
    'wwwwwwwlllll',
    '.wwwwwwllll.',
    '.wwwwwwllll.',
    '..wwwwwlll..',
    '...wwwwll...',
    '....wwwl....',
    '.....wl.....',
  ],
  ic_mood_happy: face('g', ['..o......o..', '...oooooo...']),
  ic_mood_neutral: face('y', ['............', '...oooooo...']),
  ic_mood_angry: face(
    'r',
    ['............', '...oooooo...', '..o......o..'],
    true,
  ),
  ic_bike: [
    '.nnnn.......',
    '.nnnn...aa..',
    '.nnnn....a..',
    '..aaaaaaaa..',
    '..a.a...a...',
    '.KKKa..KKK..',
    'KKKKK.KKKKK.',
    'KKMKK.KKMKK.',
    'KKKKK.KKKKK.',
    '.KKK...KKK..',
  ],
  ic_van: [
    'bbbbbbbb....',
    'bbbbbbbbbb..',
    'bbbbbbbbHHb.',
    'bbbbbbbbHHbb',
    'bbbbbbbbbbbb',
    'bbbbbbbbbbbb',
    'bbKKbbbbKKbb',
    '.KKKK..KKKK.',
    '..KK....KK..',
  ],
  ic_truck: [
    'yyyyyyyy....',
    'yyyyyyyy.bb.',
    'yyyyyyyy.bHb',
    'yyyyyyyy.bbb',
    'yyyyyyyy.bbb',
    'DDDDDDDDDDDD',
    'DKKDDDDKKDKK',
    '.KKK..KKK.KK',
  ],
  ic_warehouse: [
    '.....aa.....',
    '....aaaa....',
    '...aaaaaa...',
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    'aaaaaaaaaaaa',
    '.llllllllll.',
    '.llDDDDDDll.',
    '.llDGGGGDll.',
    '.llDDDDDDll.',
    '.llDGGGGDll.',
    '.llDDDDDDll.',
  ],
  ic_city: [
    '...bbbb.....',
    '...bHbH.....',
    '...bbbb.....',
    '...bHbH.....',
    '...bbbb.aaaa',
    '...bHbH.aYaY',
    'mmmbbbb.aaaa',
    'mYmbHbH.aYaY',
    'mmmbbbb.aaaa',
    'mYmbHbH.aYaY',
    'mmmbbbbaaaaa',
    'mmmbbbbaaaaa',
  ],
  ic_garage: [
    '....uuuu....',
    '..uuuuuuuu..',
    'uuuuuuuuuuuu',
    '.mmmmmmmmmm.',
    '.mDDDDDDDDm.',
    '.mGGGGGGGGm.',
    '.mDDDDDDDDm.',
    '.mGGGGGGGGm.',
    '.mDDDDDDDDm.',
    '.mGGGGGGGGm.',
    '.mDDDDDDDDm.',
    '.mmmmmmmmmm.',
  ],
  ic_person: [
    '....TTTT....',
    '...TTTTTT...',
    '...TTTTTTTT.',
    '...ssssss...',
    '...sosso....',
    '...ssssss...',
    '....ssss....',
    '..yyyyyyyy..',
    '.yyyWyyWyyy.',
    '.yyyWyyWyyy.',
    '.yyyyyyyyyy.',
    '.yyyyyyyyyy.',
  ],
  // build 2 M6 (B2 §6.7): the ★ applicant / employee mark (gold = reward,
  // STYLE.md §4), drawn top-right of a face on the hire cards and rows
  ic_star: [
    '.....c.....',
    '....ccc....',
    '....ccc....',
    'ccccccccccc',
    '.ccccccccc.',
    '..ccccccc..',
    '..ccccccc..',
    '.cccc.cccc.',
    '.ccc...ccc.',
    'cc.......cc',
  ],
  // build 2 M7 (design-m7 §6.1, B2 §3.1): the job board — a clipboard with
  // a gold ★ on its sheet (QuestCard masthead, the HUD quest chip, the
  // district panel's quest row, the newspaper's quest picture)
  ic_quest: [
    '...mmmmm...',
    'nnnmDDDmnnn',
    'nwwwwwwwwwn',
    'nwwwwcwwwwn',
    'nwwwcccwwwn',
    'nwcccccccwn',
    'nwwcccccwwn',
    'nwwccwccwwn',
    'nwwCwwwCwwn',
    'nwGGGGGGGwn',
    'nwwwwwwwwwn',
    'nnnnnnnnnnn',
  ],
  // build 2 M7 (B2 §3.3): the golden parcel — the parcel_s_magic look at
  // 16 px (gold box, pink ribbon and bow, a 1-px sparkle on the lid), over
  // the magic parcel's A and B buildings, on the hops and the quest chip
  ic_magic: [
    '..pp....pp..',
    '..pppIIppp..',
    '...ppIIpp...',
    'cccccppccccc',
    'cccccppccWcc',
    'pppppIIppppp',
    'cccccppccccc',
    'cccccppccccc',
    'CCCCCIICCCCC',
    'CCCCCIICCCCC',
    'CCCCCIICCCCC',
  ],
  // build 2 M8 (B2 §4.1, design-m8-m9 §6.2-§6.4): the overseas hubs.
  // parcel:handedOff — the parcel's value is locked at the pier (a padlock
  // on the box); parcel:cleared — a round green customs stamp with a check
  ic_handoff: [
    'nnnnnnnnn...',
    'nnnnNnnnn...',
    'nnnnNnnnn...',
    'nnnnNnnnn...',
    'tttttmmmm...',
    'ttttmm..mm..',
    'ttttm....m..',
    'ttttyyyyyyyy',
    'ttttyyyooyyy',
    '....yyyooyyy',
    '....yyyyoyyy',
    '....yyyyyyyy',
  ],
  ic_cleared: [
    '...gggggg...',
    '.ggWWWWWWgg.',
    '.gWWWWWWWEg.',
    'gWWWWWWWEEWg',
    'gWWWWWWEEWWg',
    'gWEEWWEEWWWg',
    'gWWEEEEWWWWg',
    'gWWWEEWWWWWg',
    '.gWWWWWWWWg.',
    '.ggWWWWWWgg.',
    '...gggggg...',
  ],
  // the hubs themselves (DistrictPanel hub rows, toasts): the Docks' cargo
  // ship (orange hull, containers, white bridge) and, from M9, the Airport's
  // cargo plane seen from above (nose up)
  ic_ship: [
    '........ww..',
    '........wHw.',
    '..bbyyggwww.',
    '..bbyyggwww.',
    '..bbyyggwww.',
    'aaaaaaaaaaaa',
    '.aaaaaaaaaaa',
    '..aaaaaaaaaa',
    '...AAAAAAAA.',
  ],
  ic_plane: [
    '.....ll.....',
    '.....ll.....',
    '....llll....',
    '....lHHl....',
    '.bbllllllbb.',
    'bblllllllllb',
    '.....ll.....',
    '.....ll.....',
    '....llll....',
    '...bb..bb...',
  ],
  ic_honk: [
    '.wwwwwwwwww.',
    'wwwwwwwwwwww',
    'wwwwwwwwyyww',
    'wwrrwwwyyywo',
    'wrrrryyyyyww',
    'wrrrryyyyywo',
    'wwrrwwwyyyww',
    'wwwwwwwwyywo',
    '.wwwwwwwwww.',
    '.www........',
    '.ww.........',
    '.w..........',
  ],
  ic_alert: [
    '....rrrr....',
    '..rrrrrrrr..',
    '.rrrrWWrrrr.',
    '.rrrrWWrrrr.',
    'rrrrrWWrrrrr',
    'rrrrrWWrrrrr',
    'rrrrrWWrrrrr',
    'rrrrrrrrrrrr',
    '.rrrrWWrrrr.',
    '.rrrrWWrrrr.',
    '..rrrrrrrr..',
    '....rrrr....',
  ],
  ic_plus: [
    '....bbbb....',
    '..bbbbbbbb..',
    '.bbbbWWbbbb.',
    '.bbbbWWbbbb.',
    'bbbbbWWbbbbb',
    'bbWWWWWWWWbb',
    'bbWWWWWWWWbb',
    'bbbbbWWbbbbb',
    '.bbbbWWbbbb.',
    '.bbbbWWbbbb.',
    '..bbbbbbbb..',
    '....bbbb....',
  ],
  ic_angry: [
    '...rr..rr...',
    '...rr..rr...',
    '...rr..rr...',
    'rrrrr..rrrrr',
    'rrrr....rrrr',
    '............',
    '............',
    'rrrr....rrrr',
    'rrrrr..rrrrr',
    '...rr..rr...',
    '...rr..rr...',
    '...rr..rr...',
  ],
  ic_flower: [
    '....pp......',
    '...pppp.pp..',
    '.pp.pp.pppp.',
    'pppp..y.pp..',
    '.pp..yyy....',
    '..pp.yy.pp..',
    '.pppp..pppp.',
    '..pp.f..pp..',
    '.....f......',
    '..ff.f.ff...',
    '...fff.f....',
    '.....f......',
  ],
  ic_pause: [
    'www..www',
    'www..www',
    'www..www',
    'www..www',
    'www..www',
    'www..www',
    'www..www',
    'www..www',
    'www..www',
    'www..www',
  ],
  ic_play: [
    'ww........',
    'wwww......',
    'wwwwww....',
    'wwwwwwww..',
    'wwwwwwwwww',
    'wwwwwwwwww',
    'wwwwwwww..',
    'wwwwww....',
    'wwww......',
    'ww........',
  ],
  ic_speed1: [
    'ww.....',
    'www....',
    '.www...',
    '..www..',
    '...www.',
    '...www.',
    '..www..',
    '.www...',
    'www....',
    'ww.....',
  ],
  ic_speed2: [
    'ww...ww.....',
    'www..www....',
    '.www..www...',
    '..www..www..',
    '...www..www.',
    '...www..www.',
    '..www..www..',
    '.www..www...',
    'www..www....',
    'ww...ww.....',
  ],
  ic_bell: [
    '.....yy.....',
    '....yyyy....',
    '...yyyyyy...',
    '..yyyyyyyy..',
    '..yyyyyyyy..',
    '..yyyyyyyy..',
    '.yyyyyyyyyy.',
    '.yyyyyyyyyy.',
    'yyyyyyyyyyyy',
    'UUUUUUUUUUUU',
    '.....DD.....',
    '.....DD.....',
  ],
  ic_lock: [
    '...mmmmmm...',
    '..mm....mm..',
    '..m......m..',
    '..m......m..',
    '..m......m..',
    'yyyyyyyyyyyy',
    'yyyyyyyyyyyy',
    'yyyyyooyyyyy',
    'yyyyyooyyyyy',
    'yyyyyyoyyyyy',
    'yyyyyyyyyyyy',
    'yyyyyyyyyyyy',
  ],
  ic_check: [
    '.........ggg',
    '........ggg.',
    '.......ggg..',
    '......ggg...',
    'gg...ggg....',
    'ggg.ggg.....',
    '.ggggg......',
    '..ggg.......',
  ],
  ic_cross: [
    'rr......rr',
    'rrr....rrr',
    '.rrr..rrr.',
    '..rrrrrr..',
    '...rrrr...',
    '...rrrr...',
    '..rrrrrr..',
    '.rrr..rrr.',
    'rrr....rrr',
    'rr......rr',
  ],
  ic_strain_metal: [
    '...mmmmmm...',
    '..mmmmmmmm..',
    '.mmmmmmmmmm.',
    'mmmmmooommmm',
    'mmmmoKKKommm',
    'mmmmoKKKommm',
    'mmmmoKKKommm',
    'mmmmmooommmm',
    '.mmmmmmmmmm.',
    '..mmmmmmmm..',
    '...mmmmmm...',
  ],
  ic_strain_rattle: [
    '...pppp...o.',
    '..pppppp.o..',
    '.ppWppWpp...',
    '.pppppppp.oo',
    '.ppWppWpp...',
    '..pppppp....',
    '...pppp.....',
    '....yy......',
    '.....yy.....',
    '......yy....',
    '.......yyy..',
    '........yy..',
  ],
  ic_strain_battery: [
    '....dddd....',
    '...dddddd...',
    '..aaaaaaaa..',
    '..aaaaYaaa..',
    '..aaaaYaaa..',
    '..aaaYYaaa..',
    '..aaYYYYaa..',
    '..aaaYYaaa..',
    '..aaaYaaaa..',
    '..aaaYaaaa..',
    '..aaaaaaaa..',
    '..dddddddd..',
  ],
  ic_strain_dense: [
    '....dddd....',
    '...dd..dd...',
    '...d....d...',
    '...dd..dd...',
    '...dddddd...',
    '..dddddddd..',
    '..ddddddddd.',
    '.dddddddddd.',
    '.ddddddddddd',
    'dddddddddddd',
    'dddddddddddd',
  ],
  arrow: ['yyyyyy', 'yyyyyy', 'yyyyyy', '.yyyy.', '..yy..'],
  ic_up: ['....gg....', '...gggg...', '..gggggg..', '.gggggggg.', 'gggggggggg'],
  ic_down: [
    'rrrrrrrrrr',
    '.rrrrrrrr.',
    '..rrrrrr..',
    '...rrrr...',
    '....rr....',
  ],
  ic_flat: ['yyyyyyyyyy', 'yyyyyyyyyy', 'yyyyyyyyyy'],
  ic_sax: [
    'oo..........',
    '.yy.........',
    '..yy........',
    '...yy.......',
    '...yyy......',
    '...yoy...OOO',
    '...yyy..yyyy',
    '...yoy..yyy.',
    '...yyy..yyy.',
    '...yyyy.yyy.',
    '....yyyyyy..',
    '.....yyyy...',
  ],
}

// the muted mute button: the sax puts on sunglasses (city-view §4.3)
ICONS.ic_sax_shades = (ICONS.ic_sax as readonly string[]).map((r, i) => {
  if (i === 3) return 'ooooooo.....'
  if (i === 4) return 'oWoyoWo.....'
  if (i === 5) return 'oooyooo..OOO'
  return r
})

// lit fuse frames of a lost life
const FUSE_FRAMES: Record<string, readonly string[]> = {
  _0: bomb('r', FUSE_SPARK0),
  _1: bomb('r', FUSE_SPARK1),
}

for (const [id, rows] of Object.entries(ICONS)) {
  registerDrawer({ id }, (d) =>
    gridFrames(
      d,
      d.entry.frames.map(() => iconGrid(rows)),
    ),
  )
}

registerDrawer({ id: 'ic_life_fuse' }, (d) =>
  gridFrames(
    d,
    d.entry.frames.map((s) =>
      iconGrid(FUSE_FRAMES[s] ?? bomb('r', FUSE_SPARK0)),
    ),
  ),
)

// ---------------------------------------------------------------------------
// Parcel icons: ic_parcel_{s,m,l,xl} (HUD) and parcel_mini_{s,m,l,xl} (shelf)

/** outline-inclusive box sizes per parcel size */
const HUD_BOX: Record<string, [number, number]> = {
  s: [8, 8],
  m: [10, 10],
  l: [12, 12],
  xl: [14, 14],
}
const MINI_BOX: Record<string, [number, number]> = {
  s: [6, 6],
  m: [8, 8],
  l: [10, 8],
  xl: [10, 10],
}

function sizeOf(id: string): string {
  const m = /_(s|m|l|xl)$/.exec(id)
  if (!m) throw new Error(`no parcel size in ${id}`)
  return m[1] as string
}

registerDrawer({ id: /^ic_parcel_(s|m|l|xl)$/ }, (d) => {
  const [w, h] = HUD_BOX[sizeOf(d.entry.id)] as [number, number]
  const g = new Grid(ICON, ICON)
  box3q(
    g,
    Math.floor((ICON - w) / 2),
    Math.floor((ICON - h) / 2),
    w,
    h,
    CARDBOARD,
  )
  return gridFrames(d, [g])
})

// minis sit bottom-aligned inside the 10x10 cell at (3..12, 3..12)
registerDrawer({ id: /^parcel_mini_(s|m|l|xl)$/ }, (d) => {
  const [w, h] = MINI_BOX[sizeOf(d.entry.id)] as [number, number]
  const g = new Grid(ICON, ICON)
  box3q(g, 3 + Math.floor((10 - w) / 2), 13 - h, w, h, CARDBOARD)
  return gridFrames(d, [g])
})

// ---------------------------------------------------------------------------
// wh_dock_light: the lot dock's two-lamp signal (_red / _green)

/** a lit lamp's three rows, or the dark lamp */
function lampRows(lit: boolean, a: string, b: string, c: string): string[] {
  return lit ? [a, b, c] : ['KKKK', 'KKKK', 'KKKK']
}

function dockLight(red: boolean): string[] {
  const top = lampRows(red, 'P~~R', '~~~R', '~RRR')
  const bot = lampRows(!red, '+==E', '===E', '=EEE')
  return [
    '.dddddd.',
    `dd${top[0]}dd`,
    `dd${top[1]}dd`,
    `dd${top[2]}dd`,
    'dddddddd',
    `dd${bot[0]}dd`,
    `dd${bot[1]}dd`,
    `dd${bot[2]}dd`,
    '.dddddd.',
    '...dd...',
    '...dd...',
  ]
}

registerDrawer({ id: 'wh_dock_light' }, (d) =>
  gridFrames(
    d,
    d.entry.frames.map((s) => iconGrid(dockLight(s === '_red'))),
  ),
)

// ---------------------------------------------------------------------------
// Stat pips (build 2 M6, design-m6 §6.5): class `ui` 8x8 — a 6x6 dot at
// (1, 1), lit pip = yellow3 with an ink outline (yellow2 shade on its
// bottom-right), empty pip = a grey2 ring around a grey4 socket. Drawn at a
// 7-px pitch on the hire cards, the desk rows and the follow strip, so the
// 1-px transparent column/row on the right/bottom keeps the pips apart.

const PIP_ROWS: Record<string, readonly string[]> = {
  ic_pip_on: [
    '........',
    '..oooo..',
    '.oYYYYo.',
    '.oYYYyo.',
    '.oYYyyo.',
    '.oYyyyo.',
    '..oooo..',
    '........',
  ],
  ic_pip_off: [
    '........',
    '..GGGG..',
    '.GLLLLG.',
    '.GLLLLG.',
    '.GLLLLG.',
    '.GLLLLG.',
    '..GGGG..',
    '........',
  ],
}

/** flat colours of the pip templates (no auto-shading) */
const PIP_CHARS: Readonly<Record<string, string>> = {
  o: 'outline',
  Y: 'yellow3',
  y: 'yellow2',
  G: 'grey2',
  L: 'grey4',
}

/** one pip as an 8x8 Grid */
export function pipGrid(id: string): Grid {
  const rows = PIP_ROWS[id]
  if (!rows) throw new Error(`unknown pip ${id}`)
  const g = new Grid(8, 8)
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const c = PIP_CHARS[r[x] as string]
      if (c) g.set(x, y, c)
    }
  })
  return g
}

for (const id of Object.keys(PIP_ROWS)) {
  registerDrawer({ id }, (d) =>
    gridFrames(
      d,
      d.entry.frames.map(() => pipGrid(id)),
    ),
  )
}

export const ICON_IDS: readonly string[] = Object.keys(ICONS)

/** one icon as a Grid (parcels.ts insets ic_bomb into the dark parcel) */
export function iconRows(id: string): readonly string[] {
  const rows = ICONS[id]
  if (!rows) throw new Error(`unknown icon ${id}`)
  return rows
}
