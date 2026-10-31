// Build 3 (B3 §5, plan-build3 §6 + R24): procedural fallbacks for the event
// category pictures (`ev_pic_*`, class event-pic, 48x48) and the victory
// illustration (`victory_art`, class ui, 208x104). They are what ships while
// an id is still a placeholder (no token, or three failed PixelLab rounds),
// so the build works with no token at all:
//   ev_pic_<category>  two existing icon16 templates composed on a 48x48
//                      plate: the main one redrawn at 2x (each template
//                      pixel a 2x2 block, re-shaded and re-outlined at 1 px
//                      — never a scaled image), the second as a 1x badge in
//                      the lower right; weather and press have no icon of
//                      their own, so they get two small templates here in
//                      the same alphabet (a rain cloud, a sun, a newspaper)
//   victory_art        a skyline-and-fireworks plate: a blue sky with
//                      bursts in the gold / pink / yellow / water ramps,
//                      the glass HQ with its neon parcel sign between two
//                      neighbours, the fleet (bike, vans, trucks) lined up
//                      on the street in front, confetti specks
// Palette ids only, inside the entry's subset (palette.ts: event-pic takes
// gold / red / water but never mal, gold only on GOLD_PICTURES; the ui
// victory art takes everything but mal). Deterministic: no randomness
// beyond d.rng.

import type { DrawCtx } from './draw-api.ts'
import { registerDrawer } from './drawers.ts'
import { Grid, gridFrames, iconGrid, iconRows, tpl } from './icons.ts'
import { GOLD_PICTURES } from './palette.ts'

const PIC = 48

/** the 13 category ids (B3 §5), in deck order */
export const EVENT_PIC_IDS = [
  'ev_pic_staff',
  'ev_pic_fleet',
  'ev_pic_customers',
  'ev_pic_security',
  'ev_pic_money',
  'ev_pic_cityhall',
  'ev_pic_weather',
  'ev_pic_press',
  'ev_pic_underworld',
  'ev_pic_tech',
  'ev_pic_port',
  'ev_pic_luck',
  'ev_pic_job',
] as const

// ---------------------------------------------------------------------------
// Templates the icon set lacks (CHARS alphabet of icons.ts, body <= 12x12)

const TEMPLATES: Record<string, readonly string[]> = {
  // a rain cloud: white puffs, a grey belly, three blue drops
  cloud: [
    '....wwww....',
    '..wwwwwwww..',
    '.wwwwwwwwwww',
    'wwwwwwwwwwww',
    'wwwwwwwwwwww',
    'llllllllllll',
    '.llllllllll.',
    '............',
    '.^...^...^..',
    '.^...^...^..',
    '...^...^....',
    '...^...^....',
  ],
  sun: [
    '.....Y......',
    '..Y.....Y...',
    '....yyy.....',
    '...yyyyy....',
    'Y..yyyyy..Y.',
    '...yyyyy....',
    '....yyy.....',
    '..Y.....Y...',
    '.....Y......',
  ],
  // a folded newspaper: masthead bar, a picture box, greeked columns
  newspaper: [
    'wwwwwwwwwwww',
    'wDDDDDDDDDDw',
    'wwwwwwwwwwww',
    'wbbbbwMMMMMw',
    'wbHbbwwwwwww',
    'wbbbbwMMMMMw',
    'wwwwwwwwwwww',
    'wMMMMMwMMMMw',
    'wwwwwwwwwwww',
    'wMMMMMwMMMMw',
    'wwwwwwwwwwww',
    'lllllllllll.',
  ],
}

function rowsOf(id: string): readonly string[] {
  return TEMPLATES[id] ?? iconRows(id)
}

/** [main template, badge template, plate colour, plate shade] */
export const EVENT_PIC_RECIPES: Readonly<
  Record<string, readonly [string, string, string, string]>
> = {
  ev_pic_staff: ['ic_person', 'ic_star', 'brown3', 'brown2'],
  ev_pic_fleet: ['ic_van', 'ic_bike', 'grey4', 'grey3'],
  ev_pic_customers: ['ic_mood_happy', 'ic_flower', 'pink1', 'pink0'],
  ev_pic_security: ['ic_shield', 'ic_bomb', 'blue2', 'blue1'],
  ev_pic_money: ['ic_money', 'ic_up', 'grass3', 'grass2'],
  ev_pic_cityhall: ['ic_city', 'ic_cleared', 'purple2', 'purple1'],
  ev_pic_weather: ['cloud', 'sun', 'water3', 'water2'],
  ev_pic_press: ['newspaper', 'ic_honk', 'grey5', 'grey4'],
  ev_pic_underworld: ['ic_lock', 'ic_angry', 'grey2', 'grey1'],
  ev_pic_tech: ['ic_strain_metal', 'ic_alert', 'leaf2', 'leaf1'],
  ev_pic_port: ['ic_ship', 'ic_cleared', 'water2', 'water1'],
  ev_pic_luck: ['ic_magic', 'ic_star', 'yellow3', 'yellow2'],
  ev_pic_job: ['ic_quest', 'ic_check', 'orange3', 'orange2'],
}

/** template rows at 2x: every character becomes a 2x2 block */
export function doubled(rows: readonly string[]): string[] {
  const out: string[] = []
  for (const r of rows) {
    const wide = [...r].map((c) => c + c).join('')
    out.push(wide, wide)
  }
  return out
}

/**
 * The main icon at 2x on a w x h grid: the doubled template re-shaded by
 * tpl (a 1-px light / dark edge, not a 2-px one) and outlined at 1 px.
 */
export function bigIcon(id: string, w: number, h: number): Grid {
  const rows = doubled(rowsOf(id))
  const tw = Math.max(...rows.map((r) => r.length))
  const g = tpl(
    rows,
    w,
    h,
    Math.floor((w - tw) / 2),
    Math.floor((h - rows.length) / 2),
  )
  g.outline()
  return g
}

/**
 * The plate: a disc of radius 21 on the 48x48 canvas, the plate colour with
 * a light crescent upper-left and its shade along the lower-right rim, a
 * 1-px outline ring.
 */
export function plate(fillId: string, shadeId: string): Grid {
  const g = new Grid(PIC, PIC)
  const c = PIC / 2
  g.disc(c, c, 22, 'outline')
  g.disc(c, c, 21, shadeId)
  g.disc(c - 1, c - 1, 20, fillId)
  // a light crescent: grey5 on the upper-left rim (not on a cream plate)
  if (fillId !== 'grey5') {
    g.ring(c, c, 19, 21, 'grey5', (a) => a > 0.72 && a < 0.92)
    g.disc(c - 1, c - 1, 19, fillId)
  }
  return g
}

/** one category picture: plate, the main icon at 2x, the badge at 1x */
export function eventPic(id: string): Grid {
  const r = EVENT_PIC_RECIPES[id]
  if (!r) throw new Error(`eventPics: no recipe for ${id}`)
  const [main, badge, fillId, shadeId] = r
  const g = plate(fillId, shadeId)
  // the main icon sits up-left of centre so the badge has the corner
  g.blit(bigIcon(main, 30, 30), 7, 6)
  // the badge: 1x, centred on 16x16 and outlined (iconGrid)
  g.blit(iconGrid(rowsOf(badge)), 30, 29)
  // gold means reward (STYLE.md §4): off the reward pictures (palette.ts
  // GOLD_PICTURES) a gold template pixel takes the matching yellow
  if (!GOLD_PICTURES.includes(id)) {
    g.px = g.px.map((c) => (c?.startsWith('gold') ? `yellow${c.slice(4)}` : c))
  }
  return g
}

for (const id of EVENT_PIC_IDS) {
  registerDrawer({ id }, (d: DrawCtx) =>
    gridFrames(
      d,
      d.entry.frames.map(() => eventPic(id)),
    ),
  )
}

// ---------------------------------------------------------------------------
// victory_art fallback (208x104)

const VW = 208
const VH = 104

/** a firework burst: 8 rays of `len` px, a dot ring, the core lit */
function burst(
  g: Grid,
  cx: number,
  cy: number,
  len: number,
  ramp: readonly [string, string],
): void {
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]
  for (const [dx, dy] of dirs) {
    for (let k = 2; k <= len; k++) {
      const diag = dx !== 0 && dy !== 0
      const step = diag ? Math.round(k * 0.75) : k
      g.set(cx + dx * step, cy + dy * step, k > len - 2 ? ramp[1] : ramp[0])
    }
    // the spark at the end of every ray
    const diag = dx !== 0 && dy !== 0
    const end = (diag ? Math.round((len + 2) * 0.75) : len + 2) as number
    g.set(cx + dx * end, cy + dy * end, ramp[1])
  }
  g.set(cx, cy, ramp[1])
}

/** a side-view vehicle: body box, cab, two wheels (outline discs) */
function vehicle(
  g: Grid,
  x: number,
  base: number,
  kind: 'bike' | 'van' | 'truck',
  body: string,
  light: string,
): number {
  const L = new Grid(g.w, g.h)
  if (kind === 'bike') {
    // the courier: helmet, body, cargo box, two thin wheels
    L.rect(x + 3, base - 13, 4, 3, 'grey5')
    L.rect(x + 4, base - 10, 3, 4, 'blue1')
    L.rect(x, base - 9, 4, 4, 'brown2')
    L.rect(x + 1, base - 6, 9, 1, 'grey2')
    L.disc(x + 2, base - 2, 2.2, 'grey0')
    L.disc(x + 9, base - 2, 2.2, 'grey0')
    L.outline()
    g.blit(L, 0, 0)
    return 14
  }
  const w = kind === 'van' ? 18 : 28
  const h = kind === 'van' ? 11 : 13
  L.rect(x, base - h - 2, w - 6, h, body)
  L.hline(x, x + w - 7, base - h - 2, light)
  L.rect(x + w - 6, base - h + 2, 6, h - 4, kind === 'van' ? body : 'grey5')
  L.rect(x + w - 5, base - h + 3, 3, 3, 'water3')
  L.disc(x + 4, base - 2, 2.6, 'grey0')
  L.disc(x + w - 4, base - 2, 2.6, 'grey0')
  L.outline()
  g.blit(L, 0, 0)
  return w + 3
}

/** the window grid of a skyline building */
function windowsOn(
  g: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
  lit: string,
  dark: string,
  step = 4,
): void {
  for (let j = y + 2; j < y + h - 2; j += step) {
    for (let i = x + 2; i < x + w - 2; i += 3) {
      g.set(i, j, (i + j) % 7 === 0 ? dark : lit)
      g.set(i, j + 1, (i + j) % 7 === 0 ? dark : lit)
    }
  }
}

export function victoryPlate(d: DrawCtx | null = null): Grid {
  const g = new Grid(VW, VH)
  // the plate: sky, outline border
  g.rect(0, 0, VW, VH, 'outline')
  g.rect(1, 1, VW - 2, VH - 2, 'blue1')
  g.rect(1, 1, VW - 2, 28, 'blue0')
  // stars
  const rng = d?.rng
  for (let k = 0; k < 26; k++) {
    const x = rng ? rng.int(3, VW - 4) : (k * 37) % (VW - 6)
    const y = rng ? rng.int(3, 40) : (k * 13) % 38
    g.set(x, y, k % 3 === 0 ? 'yellow3' : 'grey5')
  }
  // fireworks
  burst(g, 34, 22, 8, ['pink1', 'grey5'])
  burst(g, 172, 18, 9, ['gold1', 'yellow3'])
  burst(g, 132, 34, 6, ['water3', 'grey5'])
  burst(g, 70, 40, 5, ['grass3', 'yellow3'])
  burst(g, 102, 12, 5, ['orange3', 'yellow3'])
  // skyline: neighbours left and right of the HQ
  const ground = VH - 22
  const blds: [number, number, number, string][] = [
    [6, 30, 22, 'purple0'],
    [26, 44, 18, 'purple1'],
    [42, 24, 20, 'blue0'],
    [144, 36, 20, 'purple1'],
    [162, 26, 18, 'blue0'],
    [178, 46, 24, 'purple0'],
  ]
  for (const [x, h, w, c] of blds) {
    const L = new Grid(VW, VH)
    L.rect(x, ground - h, w, h, c)
    windowsOn(L, x, ground - h, w, h, 'yellow2', 'grey1')
    L.outline()
    g.blit(L, 0, 0)
  }
  // the glass HQ: a tower with a podium, cream frame, glass grid, the neon
  // parcel sign on the roof (pink box, purple tape)
  const H = new Grid(VW, VH)
  H.rect(66, ground - 26, 76, 26, 'grey4')
  H.rect(84, ground - 62, 40, 36, 'water2')
  for (let y = ground - 60; y < ground - 28; y += 5) {
    H.hline(85, 122, y, 'water3')
  }
  for (let x = 88; x < 122; x += 6)
    H.vline(x, ground - 61, ground - 27, 'blue2')
  H.rect(70, ground - 22, 68, 14, 'water2')
  for (let x = 72; x < 136; x += 6)
    H.vline(x, ground - 21, ground - 9, 'water3')
  H.rect(98, ground - 12, 12, 12, 'grey1')
  // neon sign
  H.rect(94, ground - 76, 20, 12, 'pink1')
  H.rect(103, ground - 76, 2, 12, 'purple1')
  H.rect(94, ground - 71, 20, 2, 'purple1')
  H.rect(102, ground - 64, 4, 2, 'grey3')
  H.outline()
  g.blit(H, 0, 0)
  // the street and the fleet lined up in front
  g.rect(1, ground, VW - 2, VH - ground - 1, 'grey3')
  g.hline(1, VW - 2, ground, 'grey4')
  for (let x = 6; x < VW - 6; x += 14) g.hline(x, x + 6, VH - 6, 'grey5')
  const base = VH - 8
  let x = 8
  x += vehicle(g, x, base, 'bike', 'orange2', 'orange3')
  x += vehicle(g, x, base, 'bike', 'orange2', 'orange3')
  x += vehicle(g, x, base, 'van', 'yellow2', 'yellow3')
  x += vehicle(g, x, base, 'van', 'yellow2', 'yellow3')
  x += vehicle(g, x, base, 'truck', 'blue1', 'blue2')
  x += vehicle(g, x, base, 'truck', 'orange2', 'orange3')
  x += vehicle(g, x, base, 'van', 'yellow2', 'yellow3')
  x += vehicle(g, x, base, 'bike', 'orange2', 'orange3')
  vehicle(g, x, base, 'bike', 'orange2', 'orange3')
  // confetti specks over everything
  const conf = ['pink1', 'yellow3', 'grass3', 'water3', 'gold1', 'orange3']
  for (let k = 0; k < 40; k++) {
    const cx = rng ? rng.int(4, VW - 6) : (k * 53) % (VW - 8)
    const cy = rng ? rng.int(4, ground - 4) : (k * 29) % (ground - 6)
    const c = conf[k % conf.length] as string
    g.set(cx, cy, c)
    g.set(cx + (k % 2), cy + ((k + 1) % 2), c)
  }
  // re-close the border the specks may have touched
  g.hline(0, VW - 1, 0, 'outline')
  g.hline(0, VW - 1, VH - 1, 'outline')
  g.vline(0, 0, VH - 1, 'outline')
  g.vline(VW - 1, 0, VH - 1, 'outline')
  return g
}

registerDrawer({ id: 'victory_art' }, (d: DrawCtx) =>
  gridFrames(
    d,
    d.entry.frames.map(() => victoryPlate(d)),
  ),
)
