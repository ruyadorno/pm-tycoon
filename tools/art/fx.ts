// fx drawers (style-guide.md §2.5, §2.8; city-view.md §1.3, §2, §3.3, §6.1;
// warehouse-view.md §3.3): short frame-stepped effects, all outlined so they
// read over any ground, palette-only (fx may use red and gold, never mal).
//   fx_ping   32x32 f0..f3  expanding scanner ring on a flag
//   fx_pop    32x32 f0..f3  vehicle pop-in/out puff burst
//   fx_boom   32x32 f0..f5  explosion on the destination building
//   fx_puff   16x16 f0..f3  puff over the emptied life slot
//   fx_smoke  16x16 f0..f3  chimney smoke rising (anchor = bottom-centre)
//   fx_dust  256x224 f0..f3  tier-up construction over the whole exterior,
//                            one cloud per frame (build 2, report §6.23):
//                            scaffold, dust, dust settling, reveal
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

/**
 * fx_dust (build 2, report §6.23): ONE construction cloud per frame over the
 * whole warehouse exterior, on the exterior's own frame of reference — the
 * canvas is 256 wide (the 4x4 footprint) and DUST_H tall, placed like
 * wh_ext with setOrigin(0.5, 1) at the lot's footprint anchor, so the cloud
 * sits on the footprint diamond and rises over the walls and roof. The
 * playtest-1 drawing was a 32x32 puff tiled in a jittered grid, which read
 * as a field of separate puffs. Frames: f0 the scaffold rising out of a
 * low dust skirt, f1 the cloud engulfing the building, f2 the cloud
 * settling (lower, thinner), f3 the reveal: a last wisp along the base and
 * sparkles. Every cloud is one connected mass (overlapping discs), shaded
 * and outlined once.
 */
export const DUST_W = 256
export const DUST_H = 224

/** small integer hash for the seeded jitter of the cloud discs */
function jit(a: number, b: number, n: number): number {
  let h = (a * 374761393 + b * 668265263) >>> 0
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0
  return (h % (2 * n + 1)) - n
}

/**
 * discs filling the exterior's silhouette (the 4x4 box over the footprint
 * diamond, bottom vertex at (128, DUST_H - 1)) from the lower diamond edges
 * up to `height` px above the upper edges; radius r, spacing `step` (< 2r,
 * so the mass stays connected); `shrink` pulls the side columns in
 */
function massBlobs(
  height: number,
  r: number,
  step: number,
  shrink = 0,
): Blob[] {
  const out: Blob[] = []
  const cx = DUST_W / 2
  const by = DUST_H - 1
  let col = 0
  for (let x = r + 4 + shrink; x <= DUST_W - r - 5 - shrink; x += step, col++) {
    const d = Math.abs(x - cx) / 2
    const bottom = by - r - d + r / 2
    const top = Math.max(r + 2, by - 128 + d - height)
    let row = 0
    for (let y = bottom; y >= top; y -= step, row++) {
      out.push([
        x + jit(col, row, 3),
        y + jit(row, col, 3),
        r + jit(col + row, 5, 2),
      ])
    }
  }
  return out
}

/** one row of discs along the lower diamond edges (a dust skirt) */
function skirtBlobs(r: number, step: number, shrink = 0): Blob[] {
  const out: Blob[] = []
  const cx = DUST_W / 2
  const by = DUST_H - 1
  let col = 0
  for (let x = r + 4 + shrink; x <= DUST_W - r - 5 - shrink; x += step, col++) {
    const d = Math.abs(x - cx) / 2
    out.push([
      x + jit(col, 1, 2),
      by - r - d + 2 + jit(1, col, 2),
      r + jit(col, 3, 1),
    ])
  }
  return out
}

/**
 * One cloud mass from overlapping discs, shaded as a single body (not per
 * disc): a light band along its upper-left edge, a dark band along its
 * lower-right edge, the base fill between, a few billow crescents inside
 * (the upper-left arc of every third disc), then one outline.
 */
function massCloud(g: Grid, blobs: readonly Blob[], s: Shades): void {
  const inDisc = (x: number, y: number, b: Blob, r = b[2]) => {
    const dx = x + 0.5 - b[0]
    const dy = y + 0.5 - b[1]
    return dx * dx + dy * dy <= r * r
  }
  const layer = new Grid(g.w, g.h)
  const mask = new Uint8Array(g.w * g.h)
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (blobs.some((b) => inDisc(x, y, b))) mask[y * g.w + x] = 1
    }
  }
  const m = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < g.w && y < g.h && mask[y * g.w + x] === 1
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!m(x, y)) continue
      const lit = !m(x - 3, y - 5) || !m(x - 1, y - 3)
      const dark = !m(x + 2, y + 3) || !m(x + 1, y + 2)
      layer.set(x, y, dark ? s[2] : lit ? s[1] : s[0])
    }
  }
  // billows: a 2-px light crescent on the upper-left rim of every third
  // disc, a 1-px dark line under it, only inside the mass
  blobs.forEach((b, k) => {
    if (k % 3 !== 1 || b[2] < 8) return
    for (let y = Math.floor(b[1] - b[2]); y <= b[1]; y++) {
      for (let x = Math.floor(b[0] - b[2]); x <= b[0] + b[2] * 0.3; x++) {
        if (!m(x, y) || layer.get(x, y) !== s[0]) continue
        const onRim = inDisc(x, y, b) && !inDisc(x, y, b, b[2] - 2)
        if (onRim) layer.set(x, y, s[1])
        else if (inDisc(x, y, b, b[2] - 2) && !inDisc(x, y, b, b[2] - 3)) {
          layer.set(x, y, s[2])
        }
      }
    }
  })
  layer.outline()
  g.blit(layer, 0, 0)
}

function dust(i: number): Grid {
  const g = new Grid(DUST_W, DUST_H)
  if (i === 0) {
    // scaffold: poles along the front walls, two plank levels, rising out
    // of a low dust skirt along the lower diamond edges
    const s = new Grid(DUST_W, DUST_H)
    const by = DUST_H - 1
    for (const x of [24, 64, 104, 152, 192, 232]) {
      const foot = by - 4 - Math.abs(x - 128) / 2
      s.rect(x, foot - 120, 3, 120, 'brown1')
    }
    for (const lift of [50, 96]) {
      for (let x = 24; x <= 234; x++) {
        const y = Math.round(by - 4 - Math.abs(x - 128) / 2 - lift)
        s.rect(x, y, 1, 3, 'brown2')
      }
    }
    s.outline()
    g.blit(s, 0, 0)
    massCloud(g, skirtBlobs(14, 14), DUST)
    return g
  }
  if (i === 1) {
    massCloud(g, massBlobs(110, 26, 22), DUST)
    return g
  }
  if (i === 2) {
    massCloud(g, massBlobs(40, 22, 20, 14), DUST)
    return g
  }
  // reveal: a last low wisp along the base and sparkles over the roof
  massCloud(g, skirtBlobs(9, 12, 28), DUST)
  sparkle(g, 70, 64, true)
  sparkle(g, 150, 40, true)
  sparkle(g, 196, 92, false)
  sparkle(g, 104, 112, false)
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
