// fx drawers (style-guide.md §2.5, §2.8; city-view.md §1.3, §2, §3.3, §6.1;
// warehouse-view.md §3.3): short frame-stepped effects, all outlined so they
// read over any ground, palette-only (fx may use red and gold, never mal).
//   fx_ping   32x32 f0..f3  expanding scanner ring on a flag
//   fx_pop    32x32 f0..f3  vehicle pop-in/out puff burst
//   fx_boom   32x32 f0..f5  explosion on the destination building
//   fx_puff   16x16 f0..f3  puff over the emptied life slot
//   fx_smoke  16x16 f0..f3  chimney smoke rising (anchor = bottom-centre)
//   fx_dust   32x32 f0..f3  tier-up construction: scaffold, dust, dust, reveal
//   ring      16x16 _0.._8  decay coin ring, _0 = full, _8 = empty
//   rush_ring 16x16 _0.._3  rush timer ring, _0 = full, _3 = a quarter left

import type { DrawCtx } from './draw-api.ts'
import { registerDrawer } from './drawers.ts'
import { Grid, gridFrames } from './icons.ts'

type Shades = readonly [string, string, string] // base, light, dark

/** [cx, cy, r] in pixel-edge coordinates */
type Blob = readonly [number, number, number]

/**
 * A cartoon cloud from overlapping discs: base fill, a light cap offset to
 * the top-left inside each blob, a dark rim on the bottom-right, then the
 * outer outline.
 */
function cloud(
  g: Grid,
  blobs: readonly Blob[],
  s: Shades,
  holes: readonly Blob[] = [],
): void {
  const inBlob = (x: number, y: number, b: Blob) => {
    const dx = x + 0.5 - b[0]
    const dy = y + 0.5 - b[1]
    return dx * dx + dy * dy <= b[2] * b[2]
  }
  const mask = (x: number, y: number) =>
    blobs.some((b) => inBlob(x, y, b)) && !holes.some((h) => inBlob(x, y, h))
  const layer = new Grid(g.w, g.h)
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!mask(x, y)) continue
      const lit = blobs.some(
        (b) =>
          b[2] >= 2.5 &&
          inBlob(x, y, [b[0] - b[2] * 0.3, b[1] - b[2] * 0.35, b[2] * 0.55]),
      )
      const rim = !mask(x + 1, y + 1) || !mask(x, y + 1)
      layer.set(x, y, rim ? s[2] : lit ? s[1] : s[0])
    }
  }
  layer.outline()
  g.blit(layer, 0, 0)
}

/** outlined ring band rIn..rOut (colour bands listed inside -> out) */
function bandRing(
  g: Grid,
  cx: number,
  cy: number,
  rIn: number,
  bands: readonly string[],
): void {
  g.ring(cx, cy, rIn - 1, rIn, 'outline')
  bands.forEach((c, i) => g.ring(cx, cy, rIn + i, rIn + i + 1, c))
  const rOut = rIn + bands.length
  g.ring(cx, cy, rOut, rOut + 1, 'outline')
}

/** 4-point star sparkle with an outline */
function sparkle(
  g: Grid,
  x: number,
  y: number,
  big: boolean,
  outlined = true,
  c = 'grey5',
  tip = 'yellow3',
): void {
  const s = new Grid(g.w, g.h)
  s.set(x, y, c)
  const arm = big ? 2 : 1
  for (let k = 1; k <= arm; k++) {
    const col = k === arm ? tip : c
    s.set(x - k, y, col)
    s.set(x + k, y, col)
    s.set(x, y - k, col)
    s.set(x, y + k, col)
  }
  if (outlined) s.outline()
  g.blit(s, 0, 0)
}

const SMOKE: Shades = ['grey4', 'grey5', 'grey3']
const SMOKE_DARK: Shades = ['grey2', 'grey3', 'grey1']
const DUST: Shades = ['brown3', 'grey5', 'brown2']
const FIRE: Shades = ['orange2', 'yellow3', 'red1']

// ---------------------------------------------------------------------------

function ping(i: number): Grid {
  const g = new Grid(32, 32)
  const r = [4, 7, 10, 13][i] as number
  const bands = i < 3 ? ['yellow3', 'yellow2'] : ['yellow2']
  bandRing(g, 16, 16, r, bands)
  if (i === 0) {
    // the flagged dot in the middle
    g.disc(16, 16, 2, 'yellow3')
    g.ring(16, 16, 2, 3, 'outline')
  }
  return g
}

function pop(i: number): Grid {
  const g = new Grid(32, 32)
  if (i === 0) {
    cloud(g, [[16, 16, 5]], SMOKE)
    sparkle(g, 15, 15, true, false)
    return g
  }
  const rad = [0, 7, 10, 12][i] as number
  const pr = [0, 4, 3, 2][i] as number
  const n = 6
  const blobs: Blob[] = []
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (i === 2 ? 0.5 : 0)
    blobs.push([16 + Math.cos(a) * rad, 16 + Math.sin(a) * rad, pr])
  }
  if (i === 3) {
    for (const [x, y] of blobs.filter((_b, k) => k % 2 === 0))
      sparkle(g, Math.floor(x), Math.floor(y), false)
    cloud(
      g,
      blobs.filter((_b, k) => k % 2 === 1),
      SMOKE,
    )
    return g
  }
  cloud(g, blobs, SMOKE)
  if (i === 1) sparkle(g, 15, 15, true)
  return g
}

function boom(i: number): Grid {
  const g = new Grid(32, 32)
  switch (i) {
    case 0: {
      // flash: a bright star with rays
      const s = new Grid(32, 32)
      s.disc(16, 16, 4, 'yellow3')
      for (let k = 5; k <= 9; k++) {
        s.set(15, 16 - k, 'yellow3')
        s.set(16, 16 - k, 'yellow3')
        s.set(15, 15 + k, 'yellow3')
        s.set(16, 15 + k, 'yellow3')
        s.set(16 - k, 15, 'yellow3')
        s.set(16 - k, 16, 'yellow3')
        s.set(15 + k, 15, 'yellow3')
        s.set(15 + k, 16, 'yellow3')
      }
      s.disc(16, 16, 2.5, 'grey5')
      s.outline()
      g.blit(s, 0, 0)
      return g
    }
    case 1:
      cloud(g, [[16, 16, 8]], FIRE)
      g.disc(15, 15, 4, 'yellow3')
      return g
    case 2:
      cloud(
        g,
        [
          [16, 17, 9],
          [10, 12, 6],
          [22, 12, 6],
          [16, 8, 6],
          [9, 21, 5],
          [23, 21, 5],
        ],
        FIRE,
      )
      g.disc(15, 15, 5, 'yellow2')
      g.disc(14, 14, 3, 'yellow3')
      return g
    case 3:
      cloud(
        g,
        [
          [16, 15, 9],
          [9, 11, 6],
          [23, 11, 6],
          [16, 7, 6],
          [9, 21, 6],
          [23, 21, 6],
          [16, 24, 6],
        ],
        SMOKE_DARK,
      )
      cloud(g, [[16, 17, 5]], FIRE)
      return g
    case 4:
      cloud(
        g,
        [
          [16, 14, 8],
          [9, 10, 6],
          [23, 10, 6],
          [16, 6, 5],
          [10, 20, 6],
          [22, 20, 6],
        ],
        SMOKE_DARK,
      )
      return g
    default:
      cloud(
        g,
        [
          [9, 9, 4],
          [22, 7, 4],
          [16, 15, 5],
          [8, 21, 3],
          [24, 20, 4],
        ],
        SMOKE,
      )
      return g
  }
}

function puff(i: number): Grid {
  const g = new Grid(16, 16)
  const sets: Blob[][] = [
    [[8, 9, 3]],
    [
      [7, 9, 4],
      [10, 7, 3],
    ],
    [
      [6, 8, 4],
      [10, 6, 3.5],
      [10, 10, 3.5],
    ],
    [
      [4, 6, 2],
      [11, 4, 2],
      [9, 11, 2.5],
    ],
  ]
  cloud(g, sets[i] as Blob[], i === 2 ? SMOKE : SMOKE_DARK)
  return g
}

/** chimney smoke: one puff rising and growing; the anchor is bottom-centre */
function smoke(i: number): Grid {
  const g = new Grid(16, 16)
  const sets: Blob[][] = [
    [[8, 12.5, 2.5]],
    [
      [8, 10, 3],
      [9, 12.5, 2],
    ],
    [
      [7.5, 7, 3.5],
      [10, 9, 2.5],
    ],
    [
      [8, 5, 4],
      [11, 3.5, 2.5],
    ],
  ]
  cloud(g, sets[i] as Blob[], SMOKE)
  return g
}

function dust(i: number): Grid {
  const g = new Grid(32, 32)
  if (i === 0) {
    // scaffold: poles and planks over a low dust skirt
    const s = new Grid(32, 32)
    for (const x of [6, 15, 24]) s.rect(x, 4, 2, 22, 'brown1')
    for (const y of [6, 15]) s.rect(4, y, 24, 2, 'brown2')
    s.line(7, 7, 15, 15, 'brown1')
    s.line(16, 7, 24, 15, 'brown1')
    s.outline()
    g.blit(s, 0, 0)
    cloud(
      g,
      [
        [8, 26, 4],
        [16, 27, 4],
        [24, 26, 4],
      ],
      DUST,
    )
    return g
  }
  if (i === 1) {
    cloud(
      g,
      [
        [16, 18, 9],
        [8, 14, 6],
        [24, 14, 6],
        [12, 8, 5],
        [21, 8, 5],
        [7, 24, 5],
        [25, 24, 5],
      ],
      DUST,
    )
    return g
  }
  if (i === 2) {
    cloud(
      g,
      [
        [7, 10, 5],
        [24, 9, 5],
        [15, 18, 6],
        [6, 24, 4],
        [25, 23, 4],
      ],
      DUST,
      [[15, 12, 2]],
    )
    return g
  }
  // reveal: sparkles and a last wisp
  sparkle(g, 9, 9, true)
  sparkle(g, 23, 12, true)
  sparkle(g, 15, 22, false)
  cloud(
    g,
    [
      [6, 25, 3.5],
      [26, 24, 3],
    ],
    DUST,
  )
  return g
}

/** decay coin ring: a gold coin inside a track that drains clockwise */
function coinRing(k: number, steps: number, fill: Shades, coin: boolean): Grid {
  const g = new Grid(16, 16)
  const left = (steps - k) / steps
  g.ring(8, 8, 6, 7, 'outline')
  // track: 2 px; filled part lit on the outer band, empty part grey
  g.ring(8, 8, 4, 6, 'grey2')
  if (left > 0) {
    g.ring(8, 8, 5, 6, fill[1], (a) => a < left - 1e-9)
    g.ring(8, 8, 4, 5, fill[0], (a) => a < left - 1e-9)
  }
  g.ring(8, 8, 3, 4, 'outline')
  if (coin) {
    g.disc(8, 8, 3, 'gold1')
    g.set(7, 6, 'gold2')
    g.set(6, 7, 'gold2')
    g.set(9, 9, 'gold0')
  }
  // the start tick at 12 o'clock so the drain direction reads
  g.set(7, 1, 'outline')
  g.set(8, 1, 'outline')
  return g
}

// ---------------------------------------------------------------------------

const FRAME_SETS: Record<string, (i: number) => Grid> = {
  fx_ping: ping,
  fx_pop: pop,
  fx_boom: boom,
  fx_puff: puff,
  fx_smoke: smoke,
  fx_dust: dust,
  ring: (i) => coinRing(i, 8, ['gold1', 'gold2', 'gold0'], true),
  rush_ring: (i) => coinRing(i, 4, ['blue1', 'blue2', 'blue0'], false),
}

for (const [id, build] of Object.entries(FRAME_SETS)) {
  registerDrawer({ id }, (d: DrawCtx) =>
    gridFrames(
      d,
      d.entry.frames.map((_s, i) => build(i)),
    ),
  )
}
