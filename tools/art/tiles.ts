// Ground tiles (style-guide.md §2.2, class `tile`, 64x32, all procedural):
// lawns, rural ground, sand/shore, animated water, pavement/plaza, the
// warehouse lot and its foundation slab (lot_slab_a/b/c, lot_ramp; build 2,
// B2 §6.1), the 16-mask road autotile, themed road edges, airport
// ground, the tree-line filler and the district kerb overlays.
//
// Tiles are flat 16 x 16-unit floors (iso.ts) so every pattern repeats with
// a period dividing 16 and tiles join without seams; no silhouette outline
// (tiles abut), only small props (bollards, trees) are outlined.
//
// Road autotile: road_<mask> with mask = N | E | S | W bits, N = 1 (tile
// -y, screen up-right), E = 2 (+x, down-right), S = 4 (+y, down-left),
// W = 8 (-x, up-left); zero-padded decimal frame suffix _00.._15
// (roadAutotile()). Kerbs kerb_n/e/s/w use the same compass: kerb_n is the
// 2-px strip along the tile's north (up-right) edge, drawn in grey5 so the
// bake's tint gives it the district colour (city-view.md §1.2).

import type { DrawnFrame, Drawer } from './draw-api.ts'
import { registerDrawer } from './drawers.ts'
import {
  type FloorCell,
  type Img,
  type Kit,
  M,
  cellHash,
  finish,
  groundCell,
  imgToCanvas,
  newKit,
  pine,
  setFloor,
  floorRect,
} from './iso.ts'

export const ROAD_N = 1
export const ROAD_E = 2
export const ROAD_S = 4
export const ROAD_W = 8

const N = 16
/** sidewalk width in units on an unconnected road side */
const SIDE = 3

function tileKit(d: Parameters<Drawer>[0]): Kit {
  const k = newKit(d, { fp: 1, canvas: [64, 32] })
  k.shadow = false
  k.outline = 'objects'
  k.edge = 0
  return k
}

function all(k: Kit, fn: (u: number, v: number) => FloorCell | string): void {
  floorRect(k, 0, 0, N, N, (u, v) => {
    const r = fn(u, v)
    return typeof r === 'string' ? { c: r } : r
  })
}

const seedOf = (id: string) => {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

// ---------------------------------------------------------------------------
// Natural ground

function grass(k: Kit, seed: number): void {
  all(k, (u, v) => {
    const h = cellHash(u, v, seed)
    if (h % 13 === 0) return 'grass3'
    if (h % 29 === 0) return 'grass1'
    return 'grass2'
  })
}

function grassB(k: Kit): void {
  // clover lawn: denser light tufts and a few daisies
  all(k, (u, v) => {
    const h = cellHash(u, v, 7)
    if (h % 41 === 0) return 'grey5'
    if (h % 37 === 0) return 'yellow3'
    if (h % 5 === 0) return 'grass3'
    if (h % 23 === 0) return 'grass1'
    return 'grass2'
  })
}

function pasture(k: Kit): void {
  all(k, (u, v) => {
    const h = cellHash(u, v, 11)
    if (h % 23 === 0) return 'yellow3'
    if (h % 7 === 0) return 'grass3'
    if (h % 17 === 0) return 'grass1'
    return 'grass2'
  })
}

function fieldRows(k: Kit): void {
  // crop rows along u: 2 units soil, 2 units crop (period 4)
  all(k, (u, v) => {
    const row = v % 4
    if (row < 2) return cellHash(u, v, 3) % 11 === 0 ? 'brown1' : 'brown2'
    return row === 2 ? 'grass2' : 'grass3'
  })
}

function dirt(k: Kit): void {
  all(k, (u, v) => {
    const h = cellHash(u, v, 5)
    if (h % 9 === 0) return 'brown3'
    if (h % 13 === 0) return 'brown1'
    return 'brown2'
  })
}

function sandCell(u: number, v: number): string {
  const h = cellHash(u, v, 19)
  if (h % 11 === 0) return 'yellow3'
  if (h % 17 === 0) return 'brown2'
  return 'brown3'
}

function sand(k: Kit): void {
  all(k, sandCell)
}

/** water frame f (0..3): shimmer dashes drift along u, 2-colour dither */
function waterCell(u: number, v: number, f: number): string {
  const phase = (u + 2 * v + 4 * f) % 16
  if (v % 4 === 1 && phase < 2) return 'water2'
  if (v % 4 === 3 && (phase + 8) % 16 < 1) return 'water3'
  // ordered dither speckle (the one allowed dither, style-guide §1.3.2)
  if ((u + v + f) % 8 === 0 && v % 2 === 0) return 'water2'
  return 'water1'
}

function water(k: Kit, f: number): void {
  all(k, (u, v) => waterCell(u, v, f))
}

/** shore: water on one side, a foam line, then sand */
function shore(k: Kit, side: 'w' | 's'): void {
  all(k, (u, v) => {
    const d = side === 'w' ? u : N - 1 - v
    const wob = cellHash(side === 'w' ? v : u, 0, 23) % 2
    if (d < 5 + wob) return waterCell(u, v, 0)
    if (d === 5 + wob) return 'grey5'
    if (d === 6 + wob) return 'yellow3'
    return sandCell(u, v)
  })
}

// ---------------------------------------------------------------------------
// Paved ground

function pavement(k: Kit): void {
  all(k, (u, v) => groundCell('pavement', u, v))
}

function plaza(k: Kit): void {
  all(k, (u, v) => groundCell('plaza', u, v))
}

function lotConcrete(k: Kit): void {
  all(k, (u, v) => {
    const c: FloorCell = {
      c: cellHash(u, v, 41) % 37 === 0 ? 'grey2' : 'grey3',
    }
    if (u % 8 === 0) c.nw = 'grey2'
    if (v % 8 === 0) c.ne = 'grey2'
    return c
  })
}

function lotParking(k: Kit): void {
  // asphalt with white bay lines along v (bays 8 units wide)
  all(k, (u, v) => {
    const c: FloorCell = { c: 'grey1' }
    if (u % 4 === 0 && v >= 2 && v < 14) c.nw = 'grey5'
    if (v === 13) c.c = 'grey5'
    return c
  })
}

function lotQueue(k: Kit): void {
  // asphalt with a yellow hatched queue lane (chevrons) along u
  all(k, (u, v) => {
    if (v === 2 || v === 13) return 'yellow2'
    if (v > 3 && v < 12 && (u + v) % 6 === 0) return 'yellow2'
    return 'grey1'
  })
}

/**
 * The warehouse foundation slab (B2 §6.1, build 2): cast concrete one
 * shade lighter than the lot, with an expansion joint along the tile's two
 * upper edges, so a 4x4 stamp shows the footprint grid exactly. Variants:
 * a plain, b a hairline crack, c a drain grate.
 */
function slabCell(u: number, v: number, variant: number): FloorCell {
  const h = cellHash(u, v, 83 + variant)
  // the joint is a 1-unit row of cells (edge marks on the tile border are
  // clipped by the diamond)
  const c: FloorCell = {
    c: u === 0 || v === 0 || h % 41 === 0 ? 'grey3' : 'grey4',
  }
  if (variant === 1) {
    // a hairline crack wandering across the tile
    const w = 5 + (u >> 2) + (cellHash(u >> 2, 0, 89) % 2)
    if (v === w && u >= 3 && u <= 12) c.c = 'grey3'
  }
  if (variant === 2 && u >= 9 && u <= 12 && v >= 9 && v <= 12) {
    // a drain grate: dark slots in a steel frame
    const edge = u === 9 || u === 12 || v === 9 || v === 12
    c.c = edge ? 'grey2' : u % 2 === 0 ? 'grey1' : 'grey2'
  }
  return c
}

function lotSlab(k: Kit, variant: number): void {
  all(k, (u, v) => slabCell(u, v, variant))
}

/**
 * The slab edge where the dock tiles meet the lot (B2 §6.1): a ramp with
 * hazard stripes on the tile's W side (-x, screen up-left; the side facing
 * the lot entrance), a white kerb line, then slab.
 */
function lotRamp(k: Kit): void {
  all(k, (u, v) => {
    if (u < 4) return (u + v) % 4 < 2 ? 'yellow2' : 'grey1'
    if (u === 4) return 'grey5'
    return slabCell(u, v, 0)
  })
}

function tarmac(k: Kit): void {
  all(k, (u, v) => {
    const c: FloorCell = { c: 'grey2' }
    if (u % 8 === 0) c.nw = 'grey1'
    if (v % 8 === 0) c.ne = 'grey1'
    return c
  })
}

function runway(k: Kit): void {
  all(k, (u, v) =>
    cellHash(u, v, 61) % 19 === 0
      ? 'grey0'
      : u === 0 || u === 15
        ? 'grey2'
        : 'grey1',
  )
}

function runwayStripe(k: Kit): void {
  // runway runs along y (v): white centre dashes on the u = 8 line
  all(k, (u, v) => {
    const c: FloorCell = { c: 'grey1' }
    if (u === 8 && v % 8 < 5) c.nw = 'grey5'
    if (u === 7 && v % 8 < 5) c.c = 'grey5'
    return c
  })
}

function treeLine(k: Kit): void {
  grass(k, 71)
  pine(k, 7, 12, 8, 2.4)
  pine(k, 12, 8, 7, 2.2)
}

// ---------------------------------------------------------------------------
// Roads

/** is cell (u, v) asphalt for connection mask `mask` */
export function roadAsphalt(mask: number, u: number, v: number): boolean {
  const lo = SIDE
  const hi = N - SIDE
  const inU = u >= lo && u < hi
  const inV = v >= lo && v < hi
  if (inU && inV) return true
  if (inU && v < lo) return (mask & ROAD_N) !== 0
  if (inU && v >= hi) return (mask & ROAD_S) !== 0
  if (inV && u >= hi) return (mask & ROAD_E) !== 0
  if (inV && u < lo) return (mask & ROAD_W) !== 0
  return false
}

/** one road cell: sidewalk, kerb, asphalt, centre dashes, zebra stripes */
export function roadCell(mask: number, u: number, v: number): FloorCell {
  if (!roadAsphalt(mask, u, v)) {
    const isKerb =
      roadAsphalt(mask, u + 1, v) ||
      roadAsphalt(mask, u - 1, v) ||
      roadAsphalt(mask, u, v + 1) ||
      roadAsphalt(mask, u, v - 1)
    if (isKerb) return { c: 'grey5' }
    return groundCell('pavement', u, v)
  }
  const n = [ROAD_N, ROAD_E, ROAD_S, ROAD_W].filter((b) => mask & b).length
  const c: FloorCell = { c: 'grey1' }
  const lo = SIDE
  const hi = N - SIDE
  const centre = u >= lo && u < hi && v >= lo && v < hi
  const ns = (mask & (ROAD_N | ROAD_S)) !== 0
  const ew = (mask & (ROAD_E | ROAD_W)) !== 0
  const straightNS = mask === (ROAD_N | ROAD_S)
  const straightEW = mask === (ROAD_E | ROAD_W)
  // dashed centre line on the arms (and through the middle when straight)
  const armNS = !centre || straightNS
  const armEW = !centre || straightEW
  if (
    ns &&
    armNS &&
    (v < lo || v >= hi || straightNS) &&
    u === 8 &&
    v % 4 < 2
  ) {
    c.nw = 'yellow3'
  }
  if (
    ew &&
    armEW &&
    (u < lo || u >= hi || straightEW) &&
    v === 8 &&
    u % 4 < 2
  ) {
    c.ne = 'yellow3'
  }
  // zebra crossings on the arms of junctions (3+ connections)
  if (n >= 3) {
    if ((v === lo - 2 || v === lo - 1) && u >= lo && u < hi && u % 2 === 0) {
      c.c = 'grey5'
    }
    if ((v === hi || v === hi + 1) && u >= lo && u < hi && u % 2 === 0) {
      c.c = 'grey5'
    }
    if ((u === lo - 2 || u === lo - 1) && v >= lo && v < hi && v % 2 === 0) {
      c.c = 'grey5'
    }
    if ((u === hi || u === hi + 1) && v >= lo && v < hi && v % 2 === 0) {
      c.c = 'grey5'
    }
  }
  return c
}

/** style-guide §3.1: the 16 masks from one routine */
export function roadAutotile(k: Kit, mask: number): void {
  all(k, (u, v) => roadCell(mask, u, v))
}

// ---------------------------------------------------------------------------
// Overlays (transparent outside their strip)

function kerb(k: Kit, side: 'n' | 'e' | 's' | 'w'): void {
  for (let t = 0; t < N; t++) {
    if (side === 'n') setFloor(k, t, 0, { c: 'grey5' })
    if (side === 'e') setFloor(k, N - 1, t, { c: 'grey5' })
    if (side === 's') setFloor(k, t, N - 1, { c: 'grey5' })
    if (side === 'w') setFloor(k, 0, t, { c: 'grey5' })
  }
}

function edgeQuayW(k: Kit): void {
  // quay coping on the west (u = 0) side of a north-south road
  floorRect(k, 0, 0, SIDE, N, (u, v) => {
    if (u === 0) return { c: 'grey2' }
    const c: FloorCell = { c: 'grey3' }
    if (v % 4 === 0) c.ne = 'grey2'
    return c
  })
  for (const v of [3, 11]) k.vox.box(1, v, 0, 1, 1, 2, M.darkMetal)
}

function edgeBeachE(k: Kit): void {
  // sand drifting over the east (u = 15) sidewalk
  floorRect(k, N - SIDE - 1, 0, SIDE + 1, N, (u, v) => {
    const reach = N - SIDE - 1 + (cellHash(0, v, 29) % 2)
    if (u < reach) return null
    return { c: sandCell(u, v) }
  })
}

function edgeLakeS(k: Kit): void {
  // promenade railing along the south (v = 15) side of an east-west road
  floorRect(k, 0, N - SIDE, N, SIDE, (u, v) =>
    v === N - 1 ? { c: 'grey5' } : groundCell('plaza', u, v),
  )
  for (let u = 1; u < N; u += 3) k.vox.box(u, N - 1, 0, 1, 1, 2, M.white)
}

function edgeSeaS(k: Kit): void {
  // sea wall blocks along the south (v = 15) side of an east-west road
  floorRect(k, 0, N - SIDE, N, SIDE, (u, v) => {
    const c: FloorCell = { c: v === N - 1 ? 'grey2' : 'grey3' }
    if (u % 4 === 0) c.nw = 'grey2'
    return c
  })
}

// ---------------------------------------------------------------------------
// Registration

type Painter = (k: Kit, frame: string, index: number) => void

const PAINTERS: Record<string, Painter> = {
  grass: (k) => grass(k, 13),
  grass_b: (k) => grassB(k),
  pasture: (k) => pasture(k),
  field_rows: (k) => fieldRows(k),
  dirt: (k) => dirt(k),
  sand: (k) => sand(k),
  shore_w: (k) => shore(k, 'w'),
  shore_s: (k) => shore(k, 's'),
  water: (k, _f, i) => water(k, i),
  pavement: (k) => pavement(k),
  plaza: (k) => plaza(k),
  lot_concrete: (k) => lotConcrete(k),
  lot_parking: (k) => lotParking(k),
  lot_queue: (k) => lotQueue(k),
  lot_slab: (k, _f, i) => lotSlab(k, i),
  lot_ramp: (k) => lotRamp(k),
  road: (k, f) => roadAutotile(k, Number(f.slice(1))),
  edge_quay_w: (k) => edgeQuayW(k),
  edge_beach_e: (k) => edgeBeachE(k),
  edge_lake_s: (k) => edgeLakeS(k),
  edge_sea_s: (k) => edgeSeaS(k),
  tarmac: (k) => tarmac(k),
  runway: (k) => runway(k),
  runway_stripe: (k) => runwayStripe(k),
  tree_line: (k) => treeLine(k),
  kerb_n: (k) => kerb(k, 'n'),
  kerb_e: (k) => kerb(k, 'e'),
  kerb_s: (k) => kerb(k, 's'),
  kerb_w: (k) => kerb(k, 'w'),
}

/** tile ids whose frames are partial overlays (no full diamond, lint A04) */
export const OVERLAY_TILES: readonly string[] = [
  'edge_quay_w',
  'edge_beach_e',
  'edge_lake_s',
  'edge_sea_s',
  'kerb_n',
  'kerb_e',
  'kerb_s',
  'kerb_w',
]

export function drawTileImg(
  d: Parameters<Drawer>[0],
  frame: string,
  index: number,
): Img {
  const paint = PAINTERS[d.entry.id]
  if (!paint) throw new Error(`tiles: no painter for ${d.entry.id}`)
  const k = tileKit({ ...d, rng: d.rng.fork(`${seedOf(d.entry.id)}`) })
  paint(k, frame, index)
  return finish(k)
}

const tileDrawer: Drawer = (d): DrawnFrame[] =>
  d.entry.frames.map((suffix, i) => ({
    suffix,
    canvas: imgToCanvas(drawTileImg(d, suffix, i), d),
  }))

for (const id of Object.keys(PAINTERS)) registerDrawer({ id }, tileDrawer)
