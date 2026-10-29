// Procedural building generator (style-guide.md §4.2): drawBuilding(spec)
// seeded by mulberry32(hash(id)) through DrawCtx.rng. One design per
// manifest id (the 34 live buildings, the 16 locked-scenery sprites and the
// docks container filler) so every building has one feature no neighbour
// has (§1.3.4), plus the mood_* overlays (§2.8, city-view.md §3.3). Ids
// without a design fall back to the district's generic block. Built from
// the voxel kit in iso.ts: footprint diamond ground patch, box/setback
// masses, district wall ramps, roofs, windows, shopfronts and extras;
// light rule top +2 / left +1 / right base, outline + 2-px shadow strip.

import type { DrawCtx, DrawnFrame, Drawer } from './draw-api.ts'
import { registerDrawer } from './drawers.ts'
import {
  type Box,
  type Ground,
  type Img,
  type Kit,
  type Mat,
  M,
  antenna,
  awning,
  balcony,
  band,
  billboard,
  box,
  chimney,
  chimneyAt,
  colonnade,
  districtGround,
  door,
  faceSign,
  finish,
  flag,
  floorRect,
  groundCell,
  hedge,
  imgToCanvas,
  mat,
  newKit,
  plot,
  rampMat,
  roofDome,
  roofFlat,
  roofGable,
  roofHip,
  roofSawtooth,
  silo,
  top,
  topRow,
  tree,
  waterTank,
  windows,
} from './iso.ts'

export interface BuildingSpec {
  id: string
  district?: string
  /** footprint in tiles (1..4) */
  footprint: number
  smokeAnchors?: [number, number][]
}

type Design = (k: Kit, spec: BuildingSpec) => void

// storey heights in units (= px), style-guide §4.2
const STOREY: Record<number, number> = { 1: 12, 2: 14, 3: 16, 4: 16 }

// ---------------------------------------------------------------------------
// Shared building blocks

/** a box with a window grid and a flat roof — the workhorse */
function block(
  k: Kit,
  u0: number,
  v0: number,
  a: number,
  b: number,
  storeys: number,
  wall: Mat,
  o: {
    storey?: number
    ground?: number
    wh?: number
    ww?: number
    pitch?: number
    lit?: number
    roof?: Mat | null
    parapet?: Mat | null
    sill?: Mat | null | 'auto'
    z0?: number
    windows?: boolean
  } = {},
): Box {
  const st = o.storey ?? STOREY[k.fp] ?? 12
  const g = o.ground ?? st
  const h = g + (storeys - 1) * st
  const bx = box(k, u0, v0, o.z0 ?? 0, a, b, h, wall)
  if (o.windows !== false) {
    const wh = o.wh ?? (k.fp >= 3 ? 6 : k.fp === 2 ? 5 : 4)
    windows(k, bx, {
      z: bx.z0 + g + Math.max(2, Math.floor((st - wh) / 2)),
      storey: st,
      wh,
      ww: o.ww ?? 2,
      pitch: o.pitch ?? (k.fp >= 3 ? 5 : 4),
      lit: o.lit,
      sill: o.sill,
    })
  }
  if (o.roof !== null) roofFlat(k, bx, o.roof ?? M.roofFlat, o.parapet ?? wall)
  return bx
}

/** ground-floor shopfront: big panes + door on both visible faces */
function shopfront(
  k: Kit,
  bx: Box,
  h: number,
  doorFace: 'left' | 'right' = 'left',
  glass: Mat = M.glassLit,
): void {
  for (const face of ['left', 'right'] as const) {
    const len = face === 'left' ? bx.a : bx.b
    for (let t = 1; t < len - 1; t++) {
      if ((t - 1) % 4 === 3) continue // mullions
      const [u, v] =
        face === 'left'
          ? [bx.u0 + t, bx.v0 + bx.b - 1]
          : [bx.u0 + bx.a - 1, bx.v0 + t]
      for (let z = bx.z0 + 1; z < bx.z0 + h - 1; z++) k.vox.set(u, v, z, glass)
    }
  }
  const len = doorFace === 'left' ? bx.a : bx.b
  door(k, bx, doorFace, Math.floor(len / 2) - 1, 2, h - 2, M.doorDark)
}

/** plain pavement plot with a kerb ring of grey3 at the edge cells */
function pavedPlot(k: Kit, g: Ground = 'pavement'): void {
  plot(k, g, 0)
}

/** a tidy row of small trees along the front edges of the plot */
function frontTrees(k: Kit, n: number, r = 2, inset = 2): void {
  const N = k.N
  for (let i = 0; i < n; i++) {
    const t = Math.round(((i + 0.5) * N) / n)
    if (i % 2 === 0) tree(k, t, N - inset - 1, r, 3)
    else tree(k, N - inset - 1, t, r, 3)
  }
}

/** container: corrugated box `a` x `b` x 6 in one colour ramp */
function container(
  k: Kit,
  u: number,
  v: number,
  z: number,
  a: number,
  b: number,
  ramp: string,
): void {
  const base = ramp === 'grey' ? 2 : ramp === 'pink' ? 0 : 0
  const m = rampMat(ramp, base)
  const rib = mat(m.left, m.right, m.right)
  k.vox.box(u, v, z, a, b, 6, m)
  // ribs on the long visible face
  for (let t = 1; t < Math.max(a, b) - 1; t += 2) {
    if (a >= b) k.vox.box(u + t, v + b - 1, z + 1, 1, 1, 4, rib)
    else k.vox.box(u + a - 1, v + t, z + 1, 1, 1, 4, rib)
  }
}

function crates(k: Kit, u: number, v: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const du = (i % 3) * 3
    const dv = Math.floor(i / 3) * 3
    const h = k.rng.int(1, 2) * 2
    k.vox.box(u + du, v + dv, 0, 2, 2, h, M.wood)
  }
}

/** roller door: horizontal stripes on a face */
function rollerDoor(
  k: Kit,
  bx: Box,
  face: 'left' | 'right',
  t0: number,
  w: number,
  h: number,
): void {
  for (let dt = 0; dt < w; dt++) {
    for (let z = 0; z < h; z++) {
      const [u, v] =
        face === 'left'
          ? [bx.u0 + t0 + dt, bx.v0 + bx.b - 1]
          : [bx.u0 + bx.a - 1, bx.v0 + t0 + dt]
      k.vox.set(u, v, bx.z0 + z, z % 2 === 0 ? M.metal : M.concrete)
    }
  }
}

/** vertical corrugation on the visible faces (industrial sheds) */
function corrugate(k: Kit, bx: Box, m: Mat): void {
  const dark = mat(m.top, m.right, m.right)
  for (const face of ['left', 'right'] as const) {
    const len = face === 'left' ? bx.a : bx.b
    for (let t = 1; t < len; t += 2) {
      for (let z = bx.z0; z < top(bx); z++) {
        const [u, v] =
          face === 'left'
            ? [bx.u0 + t, bx.v0 + bx.b - 1]
            : [bx.u0 + bx.a - 1, bx.v0 + t]
        if (k.vox.matAt(u, v, z) === null) continue
        const cur = k.vox.matAt(u, v, z) as Mat
        if (cur.top === m.top && cur.left === m.left) k.vox.set(u, v, z, dark)
      }
    }
  }
}

/** horizontal pipe along u at (v, z) */
function pipeU(
  k: Kit,
  u0: number,
  len: number,
  v: number,
  z: number,
  m: Mat,
): void {
  k.vox.box(u0, v, z, len, 2, 2, m)
}

/** tall chimneys at the manifest smoke anchors, depth s chosen per stack */
function smokeStacks(
  k: Kit,
  spec: BuildingSpec,
  depths: number[],
  m: Mat,
  w = 3,
): void {
  ;(spec.smokeAnchors ?? []).forEach(([sx, sy], i) => {
    const s = depths[i] ?? depths[0] ?? k.N
    const c = chimneyAtStack(k, sx, sy, s, w, m)
    // a lighter band near the top of every stack
    k.vox.box(c.u, c.v, c.zTop - 4, w, w, 1, M.cream)
  })
}

function chimneyAtStack(
  k: Kit,
  sx: number,
  sy: number,
  s: number,
  w: number,
  m: Mat,
): { u: number; v: number; zTop: number } {
  return chimneyAt(k, sx, sy, s, w, m)
}

// ---------------------------------------------------------------------------
// Downtown (§2.3: tall + glass; storeys 3–6)

const designs: Record<string, Design> = {
  dt_registry_tower(k) {
    pavedPlot(k, 'plaza')
    const podium = block(k, 6, 6, 36, 36, 2, M.concrete, {
      roof: M.roofFlat,
      parapet: M.cream,
    })
    shopfront(k, podium, 12, 'left')
    // the glass tower: blue curtain wall with steel mullions
    const t0 = top(podium)
    const tw = box(k, 11, 11, t0, 24, 24, 84, M.blue)
    for (const face of ['left', 'right'] as const) {
      for (let t = 0; t < 24; t += 4) {
        for (let z = t0; z < top(tw); z++) {
          const [u, v] = face === 'left' ? [11 + t, 34] : [34, 11 + t]
          k.vox.set(u, v, z, M.cream)
        }
      }
    }
    band(k, tw, t0 + 20, 1, M.cream)
    band(k, tw, t0 + 41, 1, M.cream)
    band(k, tw, t0 + 62, 1, M.cream)
    // crown: setback cap + antenna (the tallest silhouette in town)
    const cap = box(k, 15, 15, top(tw), 16, 16, 6, M.cream)
    roofFlat(k, cap, M.roofFlat, null)
    antenna(k, 22, 22, top(cap), 18)
    antenna(k, 18, 26, top(cap), 8, M.white)
  },

  dt_semver_bank(k) {
    pavedPlot(k, 'plaza')
    const bx = block(k, 5, 4, 20, 22, 3, M.cream, {
      roof: null,
      sill: M.white,
      wh: 5,
    })
    // steps and the portico on the lit face
    floorRect(k, 3, 27, 24, 3, 'grey5')
    colonnade(k, bx, 'left', 30, 3, M.white, 2)
    roofHip(k, bx, M.roofGreen, 0.6, 1)
    k.vox.blob(15, 15, top(bx) + 5, 3, 3, 3, mat('grass3', 'grass2', 'grass1'))
    frontTrees(k, 2, 2, 1)
  },

  dt_peer_plaza(k) {
    pavedPlot(k, 'plaza')
    const a = block(k, 3, 3, 16, 16, 5, M.concrete, { lit: 0.7 })
    const b = block(k, 29, 3, 16, 16, 5, M.concrete, { lit: 0.7 })
    // skybridge between the twins
    k.vox.box(19, 7, 48, 10, 6, 8, M.glassLit)
    k.vox.box(19, 7, 47, 10, 6, 1, M.cream)
    roofFlat(k, a, M.roofFlat, M.cream)
    roofFlat(k, b, M.roofFlat, M.cream)
    k.vox.box(8, 8, top(a), 5, 5, 4, M.metal)
    k.vox.box(34, 8, top(b), 5, 5, 4, M.metal)
    // the plaza: planters with trees and benches
    for (const [u, v] of [
      [8, 28],
      [20, 34],
      [32, 28],
      [38, 40],
      [10, 40],
    ] as const) {
      k.vox.box(u - 1, v - 1, 0, 3, 3, 1, M.cream)
      tree(k, u, v, 3, 4)
    }
    floorRect(k, 18, 20, 12, 12, (u, v) =>
      (u + v) % 2 === 0 ? 'grey5' : 'grey4',
    )
  },

  dt_lockfile_legal(k) {
    pavedPlot(k)
    const bx = block(k, 6, 6, 20, 20, 4, M.brick, {
      roof: null,
      sill: M.cream,
      wh: 5,
      lit: 0.5,
    })
    band(k, bx, 13, 1, M.cream)
    door(k, bx, 'left', 9, 2, 8, M.door)
    // steep purple mansard with dormers — the only purple roof downtown
    const peak = roofHip(k, bx, M.roofPurple, 1.4, 1)
    for (const t of [5, 11]) {
      k.vox.box(6 + t, 24, top(bx) + 2, 2, 2, 4, M.cream)
      k.vox.box(6 + t, 25, top(bx) + 3, 2, 1, 2, M.glassLit)
    }
    chimney(k, 9, 9, peak - 4, 6, M.brick)
  },

  dt_hoist_insurance(k) {
    pavedPlot(k)
    const bx = box(k, 5, 7, 0, 22, 18, 64, M.concrete)
    // ribbon windows: one continuous band per storey
    for (let z = 16; z < 62; z += 12) band(k, bx, z, 4, M.glassLit)
    shopfront(k, bx, 12, 'right')
    roofFlat(k, bx, M.roofFlat, M.cream)
    // the yellow billboard on the roof
    billboard(k, 8, 18, top(bx) + 1, 16, 9, M.sign)
    k.vox.box(20, 10, top(bx), 4, 4, 3, M.metal)
  },

  dt_monorepo_media(k) {
    pavedPlot(k, 'plaza')
    const bx = block(k, 6, 8, 34, 30, 5, M.cream, {
      lit: 0.7,
      sill: null,
    })
    band(k, bx, 15, 2, mat('pink1', 'pink1', 'pink0'))
    shopfront(k, bx, 15, 'left')
    // satellite dish and the tall sign mast
    const z = top(bx)
    k.vox.box(12, 13, z, 2, 2, 6, M.metal)
    k.vox.cylinder(13, 14, z + 6, 6, 1, M.cream)
    k.vox.cylinder(13, 14, z + 7, 5, 1, M.white)
    k.vox.box(12, 13, z + 8, 2, 2, 3, M.metal)
    k.vox.box(30, 30, z, 2, 2, 46, M.metal)
    k.vox.box(31, 29, z + 20, 1, 3, 22, mat('pink1', 'pink1', 'pink0'))
    k.vox.box(30, 30, z + 46, 2, 2, 1, M.sign)
    k.vox.box(20, 18, z, 6, 6, 5, M.metal)
  },

  dt_tarball_hotel(k) {
    pavedPlot(k, 'plaza')
    const bx = block(k, 5, 5, 34, 32, 6, M.cream, {
      sill: M.white,
      roof: null,
      lit: 0.65,
    })
    // pink awnings over every ground-floor bay
    const pinkA = mat('pink1', 'pink1', 'pink0')
    for (let t = 2; t < 31; t += 5) {
      awning(k, bx, 'left', 11, t, 3, 2, pinkA, pinkA)
      awning(k, bx, 'right', 11, t, 3, 2, pinkA, pinkA)
    }
    // entrance canopy on the lit side
    balcony(k, bx, 'left', 12, 14, 6, 4, M.white, null)
    k.vox.box(19, 39, 0, 1, 1, 12, M.white)
    k.vox.box(24, 39, 0, 1, 1, 12, M.white)
    roofFlat(k, bx, M.roofFlat, M.white)
    // penthouse with a purple mansard and the hotel flag
    const ph = box(k, 12, 12, top(bx), 18, 16, 8, M.cream)
    windows(k, ph, { z: top(bx) + 2, storey: 8, wh: 4, ww: 2, pitch: 4 })
    roofHip(k, ph, M.roofPurple, 1.4, 1, 6)
    flag(k, 20, 18, top(ph) + 6, 16, mat('pink1', 'pink1', 'pink0'))
  },

  dt_cache_cafe(k) {
    pavedPlot(k)
    const bx = block(k, 2, 2, 11, 11, 2, M.cream, {
      ground: 12,
      roof: M.roofFlat,
      parapet: M.cream,
    })
    shopfront(k, bx, 11, 'left')
    awning(k, bx, 'left', 11, 0, 11, 2, M.sign, M.white)
    awning(k, bx, 'right', 11, 0, 11, 2, M.sign, M.white)
    // outdoor tables with parasols — the café terrace
    for (const [u, v] of [
      [5, 13],
      [9, 14],
    ] as const) {
      k.vox.box(u, v, 0, 1, 1, 3, M.woodDark)
      k.vox.blob(u + 0.5, v + 0.5, 6, 2, 2, 1, M.sign)
    }
    k.vox.box(14, 6, 0, 1, 1, 3, M.woodDark)
    k.vox.blob(14.5, 6.5, 6, 2, 2, 1, mat('pink1', 'pink1', 'pink0'))
    k.vox.box(4, 4, top(bx), 2, 2, 3, M.metal)
  },

  dt_scope_offices(k) {
    pavedPlot(k)
    const bx = block(k, 5, 5, 22, 22, 4, M.brickLight, {
      roof: mat('grass2', 'grass1', 'grass0'),
      parapet: M.cream,
      sill: M.cream,
    })
    shopfront(k, bx, 14, 'left')
    // the roof garden: shrubs, two small trees and a pergola
    const z = top(bx)
    tree(k, 10, 10, 3, 3, M.leaf, z)
    tree(k, 20, 18, 2, 2, M.leaf, z)
    hedge(k, 8, 22, 12, 'u', 2)
    k.vox.box(8, 22, z, 12, 1, 2, M.leaf)
    k.vox.box(20, 8, z, 1, 1, 6, M.wood)
    k.vox.box(24, 8, z, 1, 1, 6, M.wood)
    k.vox.box(20, 8, z + 6, 5, 4, 1, M.wood)
    k.vox.box(20, 11, z, 1, 1, 6, M.wood)
    k.vox.box(24, 11, z, 1, 1, 6, M.wood)
  },

  dt_bundle_boutique(k) {
    pavedPlot(k)
    const bx = block(k, 2, 2, 11, 11, 3, mat('grey5', 'grey4', 'grey3'), {
      ground: 12,
      roof: null,
      sill: null,
    })
    shopfront(k, bx, 11, 'left')
    const purp = M.purple
    const purpL = mat('purple2', 'purple2', 'purple1')
    awning(k, bx, 'left', 11, 0, 11, 2, purp, purpL)
    awning(k, bx, 'right', 11, 0, 11, 2, purp, purpL)
    roofHip(k, bx, M.roofPurple, 1.6, 1, 7)
    // potted topiary at the door
    k.vox.box(6, 14, 0, 1, 1, 1, M.cream)
    k.vox.blob(6.5, 14.5, 2.5, 1.2, 1.2, 1.4, M.leaf)
    k.vox.box(10, 14, 0, 1, 1, 1, M.cream)
    k.vox.blob(10.5, 14.5, 2.5, 1.2, 1.2, 1.4, M.leaf)
  },

  dt_transpile_campus(k) {
    plot(k, 'lawn')
    floorRect(k, 0, 0, 48, 48, (u, v) =>
      u >= 14 && u < 34 && v >= 14 && v < 34
        ? groundCell('lawn', u, v)
        : groundCell('pavement', u, v),
    )
    const glass = mat('blue2', 'blue1', 'blue0')
    const wings: [number, number, number, number][] = [
      [3, 3, 42, 10],
      [3, 13, 10, 30],
      [35, 13, 10, 22],
    ]
    for (const [u0, v0, a, b] of wings) {
      const bx = box(k, u0, v0, 0, a, b, 32, glass)
      for (let z = 15; z < 32; z += 16) band(k, bx, z, 2, M.white)
      roofFlat(k, bx, M.roofFlat, M.white)
    }
    // the lawn: a big tree, paths, benches
    floorRect(k, 22, 14, 4, 34, (u, v) => groundCell('pavement', u, v))
    tree(k, 28, 24, 4, 5)
    tree(k, 18, 30, 3, 4)
    k.vox.box(10, 8, 32, 6, 4, 3, M.metal)
  },

  dt_yarn_tailors(k) {
    pavedPlot(k)
    const bx = block(k, 3, 2, 10, 11, 2, M.plasterY, {
      ground: 12,
      roof: null,
      sill: M.white,
    })
    shopfront(k, bx, 11, 'left', M.glassLit)
    // a big spool sign hanging off the corner — the tailor's mark
    k.vox.box(13, 13, 14, 1, 1, 1, M.woodDark)
    k.vox.box(13, 14, 10, 1, 1, 5, M.woodDark)
    k.vox.blob(13.5, 15.5, 8, 1.4, 1.4, 2.2, mat('pink1', 'pink1', 'pink0'))
    roofGable(k, bx, 'v', M.roofTerra, M.plasterY, 1, 1)
  },

  // -------------------------------------------------------------------------
  // High-density residential (§2.3: window grids + balconies; storeys 3–5)

  hr_towers_a(k) {
    pavedPlot(k)
    const bx = block(k, 12, 12, 24, 24, 6, M.cream, {
      roof: M.roofFlat,
      parapet: M.cream,
      lit: 0.55,
    })
    // stacked balconies on both lit faces
    for (let z = 31; z < top(bx) - 4; z += 16) {
      for (const t of [2, 10, 18]) {
        balcony(k, bx, 'left', z, t, 4, 2, M.white, M.white)
        balcony(k, bx, 'right', z, t, 4, 2, M.white, M.white)
      }
    }
    shopfront(k, bx, 15, 'left')
    k.vox.box(16, 16, top(bx), 6, 6, 6, M.cream)
    frontTrees(k, 4, 2, 3)
  },

  hr_towers_b(k) {
    pavedPlot(k)
    const wall = mat('grey4', 'blue2', 'blue1')
    const bx = block(k, 10, 14, 28, 20, 6, wall, {
      roof: M.roofFlat,
      parapet: M.concrete,
      sill: M.white,
      lit: 0.6,
    })
    shopfront(k, bx, 15, 'left')
    // the rooftop water tank (big, unique)
    waterTank(k, 20, 22, top(bx))
    k.vox.box(28, 18, top(bx), 5, 5, 5, M.concrete)
    frontTrees(k, 3, 2, 2)
  },

  hr_callback_court(k) {
    pavedPlot(k)
    const st = 14
    const wings = [
      box(k, 3, 3, 0, 26, 8, 4 * st, M.brick),
      box(k, 3, 11, 0, 8, 18, 4 * st, M.brick),
      box(k, 21, 11, 0, 8, 18, 4 * st, M.brick),
    ]
    for (const w of wings) {
      windows(k, w, { z: 18, storey: st, wh: 4, sill: M.cream })
      roofFlat(k, w, M.roofFlat, M.brickLight)
    }
    // the courtyard: lawn, a tree and a bench
    floorRect(k, 11, 11, 10, 18, (u, v) => groundCell('grass', u, v))
    tree(k, 15, 18, 3, 4)
    k.vox.box(13, 25, 0, 4, 1, 1, M.wood)
    door(k, wings[1] as Box, 'left', 3, 2, 6)
  },

  hr_promise_place(k) {
    pavedPlot(k)
    const bx = block(k, 5, 6, 22, 20, 4, M.plasterY, {
      roof: null,
      sill: M.white,
      lit: 0.6,
    })
    door(k, bx, 'left', 10, 2, 7)
    const peak = roofGable(k, bx, 'u', M.roofTerra, M.plasterY, 0.8, 1)
    // dormers along the lit slope
    for (const t of [4, 10, 16]) {
      k.vox.box(5 + t, 22, top(bx), 3, 3, 5, M.white)
      k.vox.box(5 + t + 1, 24, top(bx) + 1, 1, 1, 3, M.glassLit)
    }
    chimney(k, 8, 10, peak - 3, 5, M.brick)
  },

  hr_async_arms(k) {
    pavedPlot(k)
    const bx = block(k, 5, 5, 22, 22, 4, M.brickLight, {
      roof: null,
      sill: M.cream,
      lit: 0.6,
    })
    // corner bay windows running up the front corner
    for (let z = 16; z < top(bx) - 2; z += 14) {
      k.vox.box(23, 27, z, 4, 1, 6, M.glassLit)
      k.vox.box(27, 23, z, 1, 4, 6, M.glassLit)
      k.vox.box(23, 27, z - 1, 5, 1, 1, M.cream)
      k.vox.box(27, 23, z - 1, 1, 4, 1, M.cream)
    }
    door(k, bx, 'left', 8, 2, 7)
    const peak = roofHip(k, bx, M.roofGreen, 0.8, 1)
    chimney(k, 9, 12, peak - 6, 7, M.brick)
    tree(k, 3, 29, 2, 3)
  },

  hr_event_loop_lofts(k) {
    pavedPlot(k)
    const bx = box(k, 5, 6, 0, 22, 20, 54, M.brick)
    // huge loft windows (3 storeys of 18)
    windows(k, bx, {
      z: 4,
      storey: 18,
      wh: 11,
      ww: 3,
      pitch: 5,
      lit: 0.7,
      sill: M.cream,
    })
    roofSawtooth(k, bx, 3, M.roofGrey, M.glassLit, 6)
    // the old factory chimney kept from the conversion
    chimney(k, 6, 8, top(bx), 22, M.brick, 3)
  },

  hr_is_odd_store(k) {
    pavedPlot(k)
    const bx = block(k, 2, 2, 11, 11, 2, M.brickLight, {
      ground: 12,
      roof: M.roofFlat,
      parapet: M.brickLight,
    })
    shopfront(k, bx, 11, 'left')
    awning(k, bx, 'left', 11, 0, 11, 2, M.blue, M.white)
    awning(k, bx, 'right', 11, 0, 11, 2, M.blue, M.white)
    // produce crates out front
    const fruit = [mat('grass3', 'grass2', 'grass1'), M.brickLight, M.sign]
    fruit.forEach((m, i) => {
      k.vox.box(4 + i * 2, 14, 0, 2, 1, 1, M.wood)
      k.vox.box(4 + i * 2, 14, 1, 2, 1, 1, m)
    })
    k.vox.box(5, 5, top(bx), 3, 3, 3, M.metal)
  },

  hr_rimraf_laundry(k) {
    pavedPlot(k)
    const bx = block(k, 2, 2, 11, 11, 2, M.cream, {
      ground: 12,
      roof: M.roofFlat,
      parapet: M.cream,
    })
    shopfront(k, bx, 11, 'right')
    // the pink sign over the door and steam vents on the roof
    faceSign(k, bx, 'left', 1, 9, 12, 3, mat('pink1', 'pink1', 'pink0'))
    faceSign(k, bx, 'right', 1, 9, 12, 3, mat('pink1', 'pink1', 'pink0'))
    for (const [u, v] of [
      [5, 5],
      [8, 5],
      [5, 8],
    ] as const) {
      k.vox.box(u, v, top(bx), 1, 1, 5, M.metal)
    }
    k.vox.blob(5.5, 5.5, top(bx) + 8, 1.6, 1.6, 1.4, M.white)
  },

  hr_closure_coop(k) {
    pavedPlot(k)
    const bx = block(k, 4, 7, 24, 16, 3, M.cream, {
      roof: null,
      sill: M.brickLight,
      lit: 0.6,
    })
    for (const t of [4, 11, 18]) door(k, bx, 'left', t, 2, 6)
    const peak = roofGable(k, bx, 'u', M.roofTerra, M.cream, 0.9, 1)
    // a row of chimneys + solar panels — the co-op's terracotta ridge
    for (const u of [7, 14, 21]) chimney(k, u, 13, peak - 2, 4, M.brick)
    floorRect(k, 4, 24, 24, 6, (u, v) => groundCell('grass', u, v))
    hedge(k, 4, 29, 24, 'u', 1)
  },

  hr_buffer_block(k) {
    pavedPlot(k)
    const bx = block(k, 6, 5, 20, 22, 5, M.concrete, {
      roof: M.roofFlat,
      parapet: M.purple,
      lit: 0.6,
    })
    // purple trim: string courses between storeys
    for (let z = 14; z < top(bx); z += 14) band(k, bx, z, 1, M.purple)
    shopfront(k, bx, 13, 'left')
    antenna(k, 10, 10, top(bx), 10)
    k.vox.box(18, 16, top(bx), 4, 4, 3, M.metal)
  },

  hr_pizza(k) {
    pavedPlot(k)
    const bx = block(k, 3, 2, 10, 11, 2, M.brick, {
      ground: 12,
      roof: M.roofFlat,
      parapet: M.brick,
      sill: M.cream,
    })
    shopfront(k, bx, 11, 'left', M.glassWarm)
    const orange = rampMat('orange', 1)
    awning(k, bx, 'left', 11, 0, 10, 2, orange, M.white)
    awning(k, bx, 'right', 11, 0, 11, 2, orange, M.white)
    // the wood-oven chimney (tall, round-capped)
    chimney(k, 4, 3, top(bx), 12, M.brickLight, 2)
    k.vox.box(4, 3, top(bx) + 13, 2, 2, 1, M.brick)
  },

  hr_daycare(k) {
    plot(k, 'grass')
    floorRect(k, 2, 2, 18, 14, (u, v) => groundCell('pavement', u, v))
    const bx = block(k, 3, 3, 16, 12, 2, M.plasterY, {
      roof: null,
      sill: M.blue,
      wh: 5,
    })
    door(k, bx, 'left', 6, 2, 6, M.blue)
    roofGable(k, bx, 'u', rampMat('blue', 0), M.plasterY, 0.7, 1)
    // the playground: slide, sandpit, swings
    floorRect(k, 18, 18, 8, 8, 'yellow3')
    k.vox.box(20, 8, 0, 3, 3, 8, M.sign)
    for (let i = 0; i < 6; i++) {
      k.vox.box(20, 11 + i, 7 - i, 3, 1, 1, M.blue)
    }
    k.vox.box(6, 22, 0, 1, 1, 8, M.blue)
    k.vox.box(13, 22, 0, 1, 1, 8, M.blue)
    k.vox.box(6, 22, 8, 8, 1, 1, M.blue)
    k.vox.box(9, 22, 3, 1, 1, 1, mat('pink1', 'pink1', 'pink0'))
    k.vox.box(11, 22, 3, 1, 1, 1, M.sign)
    hedge(k, 1, 30, 30, 'u', 2)
    hedge(k, 30, 1, 30, 'v', 2)
  },

  // -------------------------------------------------------------------------
  // Industrial (§2.3: chimneys + sawtooth roofs; storeys 1–2)

  in_lodash_smelting(k, spec) {
    plot(k, 'concrete')
    const hall = box(k, 4, 16, 0, 38, 24, 26, M.brick)
    windows(k, hall, { z: 12, storey: 16, wh: 8, ww: 2, pitch: 6, lit: 0.8 })
    // orange glow doors
    const glow = mat('yellow3', 'orange3', 'orange2')
    for (const t of [8, 22]) door(k, hall, 'left', t, 4, 12, glow)
    roofGable(k, hall, 'u', M.roofGrey, M.brick, 0.5, 1)
    // the two tall chimneys at the manifest smoke anchors
    smokeStacks(k, spec, [28, 30], M.brick, 3)
    // ingot stacks in the yard
    for (const [u, v] of [
      [30, 6],
      [35, 6],
      [40, 10],
    ] as const) {
      k.vox.box(u, v, 0, 4, 2, 2, M.metal)
      k.vox.box(u + 1, v, 2, 2, 2, 1, M.concrete)
    }
  },

  in_chalk_pigment(k, spec) {
    plot(k, 'concrete')
    const shed = box(k, 6, 4, 0, 30, 26, 22, M.cream)
    windows(k, shed, { z: 8, storey: 16, wh: 6, ww: 2, pitch: 5 })
    roofSawtooth(k, shed, 4, M.roofGrey, M.glassLit, 6)
    // colourful pigment tanks
    const tanks: [number, number, Mat][] = [
      [12, 38, mat('pink1', 'pink1', 'pink0')],
      [22, 39, M.sign],
      [32, 37, M.blue],
      [41, 30, rampMat('purple', 0)],
      [41, 20, rampMat('grass', 1)],
    ]
    for (const [u, v, m] of tanks) {
      k.vox.cylinder(u, v, 0, 3.2, 14, m)
      k.vox.cylinder(u, v, 14, 2, 1, M.metal)
    }
    pipeU(k, 12, 30, 34, 10, M.metal)
    smokeStacks(k, spec, [26], M.metal, 2)
  },

  in_tarball_packing(k, spec) {
    plot(k, 'concrete')
    const hall = box(k, 4, 8, 0, 34, 28, 28, M.wood)
    corrugate(k, hall, M.wood)
    for (const t of [3, 11, 19]) rollerDoor(k, hall, 'right', t, 5, 14)
    for (const t of [6, 18]) rollerDoor(k, hall, 'left', t, 6, 14)
    roofGable(k, hall, 'v', M.roofGrey, M.wood, 0.4, 1)
    // loading bays + crates
    crates(k, 40, 10, 6)
    crates(k, 8, 39, 5)
    smokeStacks(k, spec, [22], M.brick, 3)
  },

  in_gzip_compressors(k, spec) {
    plot(k, 'concrete')
    const a = box(k, 4, 4, 0, 18, 30, 24, M.concrete)
    const b = box(k, 26, 10, 0, 18, 24, 20, M.concrete)
    corrugate(k, a, M.concrete)
    corrugate(k, b, M.concrete)
    roofGable(k, a, 'v', M.roofGrey, M.concrete, 0.5, 1)
    roofGable(k, b, 'v', M.roofGrey, M.concrete, 0.5, 1)
    rollerDoor(k, a, 'left', 6, 6, 12)
    // pipes running between the sheds and over the yard
    pipeU(k, 18, 12, 20, 14, M.metal)
    pipeU(k, 18, 12, 26, 8, M.sign)
    k.vox.box(20, 36, 0, 2, 8, 2, M.metal)
    k.vox.cylinder(12, 41, 0, 3, 8, M.metal)
    k.vox.cylinder(36, 40, 0, 3, 8, M.metal)
    smokeStacks(k, spec, [36], M.metal, 3)
  },

  in_minify_metal(k, spec) {
    plot(k, 'concrete')
    const hall = box(k, 6, 6, 0, 36, 30, 24, rampMat('blue', 0))
    corrugate(k, hall, rampMat('blue', 0))
    roofSawtooth(k, hall, 5, M.roofGrey, M.glassLit, 6)
    rollerDoor(k, hall, 'left', 12, 8, 14)
    // sheet-metal piles
    for (const [u, v] of [
      [8, 40],
      [16, 41],
      [40, 40],
    ] as const) {
      for (let z = 0; z < 4; z++) k.vox.box(u, v, z, 5, 3, 1, M.metal)
    }
    smokeStacks(k, spec, [24], M.brick, 3)
  },

  in_webpack_warehouse(k) {
    plot(k, 'concrete')
    const blueM = rampMat('blue', 0)
    const bx = box(k, 4, 5, 0, 24, 22, 22, blueM)
    corrugate(k, bx, blueM)
    rollerDoor(k, bx, 'left', 4, 6, 12)
    rollerDoor(k, bx, 'left', 13, 6, 12)
    rollerDoor(k, bx, 'right', 6, 6, 12)
    roofGable(k, bx, 'u', M.roofGrey, blueM, 0.35, 1)
    k.vox.box(2, 28, 0, 6, 3, 3, M.wood)
  },

  in_rimraf_yard(k) {
    plot(k, 'dirt')
    // site cabin
    const cab = box(k, 3, 3, 0, 10, 6, 10, M.sign)
    windows(k, cab, { z: 4, storey: 10, wh: 3, ww: 2, pitch: 4, lit: 1 })
    roofFlat(k, cab, M.roofFlat, null)
    // rubble piles
    k.vox.blob(22, 8, 0, 6, 5, 6, (u, v, z) =>
      (u + v + z) % 3 === 0 ? M.brick : M.concrete,
    )
    k.vox.blob(8, 24, 0, 5, 4, 4, M.concrete)
    // the yellow excavator
    const yel = M.plasterY
    k.vox.box(16, 18, 0, 8, 3, 2, M.darkMetal)
    k.vox.box(16, 23, 0, 8, 3, 2, M.darkMetal)
    k.vox.box(16, 18, 2, 8, 8, 3, yel)
    k.vox.box(17, 19, 5, 5, 5, 6, yel)
    k.vox.box(18, 24, 6, 3, 1, 4, M.glassLit)
    k.vox.box(24, 21, 6, 3, 2, 2, yel)
    k.vox.box(27, 21, 3, 2, 2, 5, yel)
    k.vox.box(27, 21, 1, 3, 3, 2, M.darkMetal)
    // fence
    for (let t = 2; t < 30; t += 3) k.vox.box(t, 30, 0, 1, 1, 4, M.metal)
  },

  in_polyfill_plastics(k) {
    plot(k, 'concrete')
    const shed = box(k, 3, 3, 0, 14, 24, 18, M.concrete)
    corrugate(k, shed, M.concrete)
    roofGable(k, shed, 'v', M.roofGrey, M.concrete, 0.5, 1)
    rollerDoor(k, shed, 'right', 6, 6, 10)
    // white tanks (the plant's signature)
    for (const [u, v] of [
      [22, 8],
      [22, 17],
      [26, 26],
    ] as const) {
      k.vox.cylinder(u, v, 0, 3.6, 18, M.white)
      k.vox.blob(u, v, 18, 3.6, 3.6, 2, (_a, _b, z) =>
        z >= 18 ? M.white : null,
      )
      k.vox.box(Math.floor(u) - 1, v + 3, 4, 2, 1, 1, M.metal)
    }
    pipeU(k, 17, 6, 11, 14, M.metal)
  },

  in_esbuild_engines(k) {
    plot(k, 'concrete')
    const bx = box(k, 5, 5, 0, 22, 20, 26, M.brick)
    windows(k, bx, {
      z: 16,
      storey: 14,
      wh: 5,
      ww: 2,
      pitch: 5,
      sill: M.cream,
    })
    band(k, bx, 14, 1, M.cream)
    // the big roller door on the lit face
    rollerDoor(k, bx, 'left', 5, 10, 13)
    roofGable(k, bx, 'u', M.roofGrey, M.brick, 0.6, 1)
    // an engine block on a pallet + oil drums
    k.vox.box(10, 28, 0, 6, 3, 1, M.wood)
    k.vox.box(11, 28, 1, 4, 3, 3, M.darkMetal)
    k.vox.box(12, 28, 4, 2, 2, 1, M.metal)
    k.vox.cylinder(28, 9, 0, 1.2, 3, M.blue)
    k.vox.cylinder(28, 12, 0, 1.2, 3, M.sign)
  },

  in_glob_silos(k) {
    plot(k, 'concrete')
    const shed = box(k, 3, 16, 0, 22, 12, 16, M.wood)
    corrugate(k, shed, M.wood)
    roofGable(k, shed, 'u', M.roofGrey, M.wood, 0.6, 1)
    rollerDoor(k, shed, 'left', 8, 6, 10)
    // the two grain silos behind the shed
    silo(k, 10, 9, 5.5, 44, M.metal, M.cream)
    silo(k, 22, 8, 5.5, 44, M.metal, M.cream)
    k.vox.box(15, 8, 44, 3, 1, 2, M.metal)
    for (let z = 8; z < 44; z += 10) {
      k.vox.cylinder(10, 9, z, 5.6, 1, M.concrete)
      k.vox.cylinder(22, 8, z, 5.6, 1, M.concrete)
    }
  },

  // -------------------------------------------------------------------------
  // Locked scenery (§2.4; shown fogged in playtest 1)

  lr_house_a(k) {
    plot(k, 'grass')
    floorRect(k, 6, 12, 3, 4, (u, v) => groundCell('pavement', u, v))
    const bx = box(k, 3, 4, 0, 10, 8, 14, M.cream)
    windows(k, bx, { z: 5, storey: 14, wh: 4, sill: M.white })
    door(k, bx, 'left', 4, 2, 7)
    const peak = roofGable(k, bx, 'u', M.roofTerra, M.cream, 1, 1)
    chimney(k, 10, 5, peak - 3, 4, M.brick)
    hedge(k, 1, 15, 4, 'u', 2)
    tree(k, 13, 13, 2, 3)
  },

  lr_house_b(k) {
    plot(k, 'grass')
    floorRect(k, 12, 6, 4, 3, (u, v) => groundCell('pavement', u, v))
    const bx = box(k, 3, 3, 0, 10, 10, 13, M.plasterY)
    windows(k, bx, { z: 5, storey: 13, wh: 4, sill: M.white })
    door(k, bx, 'right', 4, 2, 7)
    roofHip(k, bx, M.roofTerra, 1, 1)
    tree(k, 3, 14, 2, 2, M.leaf)
    k.vox.box(14, 12, 0, 1, 3, 2, M.wood)
  },

  lr_house_c(k) {
    plot(k, 'grass')
    floorRect(k, 12, 22, 4, 10, (u, v) => groundCell('pavement', u, v))
    const bx = box(k, 5, 6, 0, 20, 14, 26, M.pink)
    windows(k, bx, { z: 4, storey: 13, wh: 5, sill: M.white })
    door(k, bx, 'left', 8, 2, 8)
    // porch
    balcony(k, bx, 'left', 9, 6, 8, 3, M.white, null)
    k.vox.box(11, 22, 0, 1, 1, 9, M.white)
    k.vox.box(18, 22, 0, 1, 1, 9, M.white)
    const peak = roofGable(k, bx, 'u', M.roofTerra, M.pink, 0.9, 1)
    chimney(k, 20, 9, peak - 4, 5, M.brick)
    tree(k, 27, 26, 3, 4)
    hedge(k, 1, 30, 10, 'u', 2)
    hedge(k, 19, 30, 12, 'u', 2)
  },

  lr_villa(k) {
    plot(k, 'grass')
    const a = box(k, 4, 4, 0, 22, 12, 26, M.cream)
    const b = box(k, 4, 16, 0, 10, 10, 26, M.cream)
    for (const bx of [a, b]) {
      windows(k, bx, { z: 4, storey: 13, wh: 5, sill: M.white })
      roofHip(k, bx, M.roofGrey, 0.8, 1)
    }
    door(k, a, 'left', 14, 2, 8)
    floorRect(k, 18, 16, 3, 16, (u, v) => groundCell('pavement', u, v))
    // the hedge-lined yard
    hedge(k, 1, 30, 17, 'u', 2)
    hedge(k, 21, 30, 10, 'u', 2)
    hedge(k, 30, 1, 30, 'v', 2)
    tree(k, 26, 22, 3, 4)
  },

  ru_farm(k) {
    plot(k, 'grass')
    // the pasture with a fence
    for (let t = 24; t < 46; t += 3) {
      k.vox.box(t, 24, 0, 1, 1, 3, M.wood)
      k.vox.box(24, t, 0, 1, 1, 3, M.wood)
    }
    k.vox.box(24, 24, 2, 22, 1, 1, M.wood)
    k.vox.box(24, 24, 2, 1, 22, 1, M.wood)
    floorRect(k, 25, 25, 22, 22, (u, v) =>
      (u + v) % 7 === 0 ? 'grass3' : 'grass2',
    )
    // farmhouse
    const house = box(k, 4, 4, 0, 14, 10, 14, M.cream)
    windows(k, house, { z: 5, storey: 14, wh: 4, sill: M.white })
    door(k, house, 'left', 5, 2, 7)
    roofGable(k, house, 'u', M.roofTerra, M.cream, 1, 1)
    // barn
    const barn = box(k, 26, 3, 0, 16, 14, 18, M.brickLight)
    door(k, barn, 'left', 5, 6, 12, M.wood)
    roofGable(k, barn, 'v', M.roofGrey, M.brickLight, 1, 1)
    // hay bales
    for (const [u, v] of [
      [8, 28],
      [12, 31],
      [8, 34],
    ] as const) {
      k.vox.cylinder(u, v, 0, 1.6, 3, M.sign)
    }
    tree(k, 4, 22, 3, 4)
  },

  ru_barn(k) {
    plot(k, 'grass')
    floorRect(k, 8, 20, 10, 12, (u, v) => groundCell('dirt', u, v))
    const bx = box(k, 5, 4, 0, 20, 16, 18, M.brickLight)
    door(k, bx, 'left', 7, 6, 13, M.wood)
    // gambrel roof: steep lower slopes then a gentle top
    const z0 = top(bx)
    for (let s = 0; s < 16; s++) {
      const d = Math.min(s + 1, 16 - s)
      const rise = d <= 4 ? d * 2 : 8 + Math.round((d - 4) * 0.5)
      const front = s >= 8
      const m = front
        ? mat('orange2', 'orange2', 'orange0')
        : mat('orange1', 'orange1', 'orange0')
      for (let u = 4; u < 26; u++) {
        for (let dz = Math.max(0, rise - 3); dz < rise; dz++) {
          k.vox.set(u, 4 + s, z0 + dz, m)
        }
        if (u >= 5 && u < 25) {
          for (let dz = 0; dz < rise - 3; dz++) {
            k.vox.set(u, 4 + s, z0 + dz, M.brickLight)
          }
        }
      }
    }
    // hay bales
    for (const [u, v] of [
      [24, 24],
      [27, 22],
      [26, 27],
    ] as const) {
      k.vox.cylinder(u, v, 0, 1.8, 3, M.sign)
    }
  },

  ru_orchard(k) {
    plot(k, 'grass')
    const shed = box(k, 3, 3, 0, 8, 6, 9, M.wood)
    door(k, shed, 'left', 3, 2, 6)
    roofGable(k, shed, 'u', M.roofGrey, M.wood, 0.8, 1)
    // fruit trees in rows, fruit in orange/yellow
    const fruit = [M.brickLight, M.sign]
    for (let v = 6; v < 32; v += 8) {
      for (let u = 14; u < 32; u += 8) {
        tree(k, u, v, 3, 3)
        const f = fruit[(u + v) % 2] as Mat
        k.vox.set(u + 1, v + 2, 5, f)
        k.vox.set(u - 1, v + 1, 7, f)
      }
    }
    for (let u = 3; u < 12; u += 4) tree(k, u, 20, 3, 3)
    tree(k, 6, 28, 3, 3)
  },

  ru_farmhouse(k) {
    plot(k, 'grass')
    floorRect(k, 6, 12, 3, 4, (u, v) => groundCell('dirt', u, v))
    const bx = box(k, 3, 4, 0, 10, 7, 13, M.wood)
    windows(k, bx, { z: 5, storey: 13, wh: 4, sill: M.cream })
    door(k, bx, 'left', 4, 2, 7, M.woodDark)
    // the porch along the lit face
    balcony(k, bx, 'left', 7, 0, 10, 2, M.woodDark, null)
    for (const u of [3, 7, 12]) k.vox.box(u, 12, 0, 1, 1, 7, M.woodDark)
    const peak = roofGable(k, bx, 'u', M.roofTerra, M.wood, 1, 1)
    chimney(k, 4, 5, peak - 3, 4, M.brick)
  },

  dk_pier(k) {
    plot(k, 'water')
    // the pier deck over the water, bollards on the edge
    floorRect(k, 0, 0, 48, 48, (u, v) =>
      v >= 10 && v < 38
        ? { c: u % 4 === 0 ? 'brown1' : 'brown2' }
        : groundCell('water', u, v),
    )
    k.vox.box(0, 10, 0, 48, 28, 1, M.wood)
    for (let u = 3; u < 48; u += 6) {
      k.vox.box(u, 37, 1, 1, 1, 2, M.darkMetal)
      k.vox.box(u, 10, 1, 1, 1, 2, M.darkMetal)
    }
    // pilings
    for (let u = 2; u < 48; u += 5) {
      k.vox.box(u, 38, 0, 1, 1, 1, M.woodDark)
    }
    const shed = box(k, 4, 14, 1, 14, 10, 12, M.wood)
    corrugate(k, shed, M.wood)
    roofGable(k, shed, 'u', M.roofGrey, M.wood, 0.5, 1)
    for (const u of [24, 30]) container(k, u, 14, 1, 6, 3, 'blue')
    container(k, 24, 14, 7, 6, 3, 'orange')
    container(k, 36, 26, 1, 3, 6, 'yellow')
  },

  dk_customs(k) {
    plot(k, 'pavement')
    const bx = block(k, 5, 6, 20, 18, 3, M.brick, {
      roof: null,
      sill: M.cream,
      wh: 5,
    })
    band(k, bx, 14, 1, M.cream)
    door(k, bx, 'left', 9, 3, 8, M.door)
    roofHip(k, bx, M.roofGrey, 0.6, 1)
    // the harbour clock tower
    const tw = box(k, 20, 8, 0, 6, 6, 58, M.brick)
    k.vox.box(20, 13, 46, 6, 1, 6, M.white)
    k.vox.box(25, 8, 46, 1, 6, 6, M.white)
    roofHip(k, tw, M.roofGreen, 1.2, 1)
    void bx
  },

  ap_terminal(k) {
    plot(k, 'concrete')
    const hall = box(k, 3, 18, 0, 42, 22, 22, M.glassLit)
    for (let t = 0; t < 42; t += 6) {
      for (let z = 0; z < 22; z++) k.vox.set(3 + t, 39, z, M.white)
    }
    band(k, hall, 10, 1, M.white)
    // curved white roof
    for (let s = 0; s < 22; s++) {
      const d = Math.min(s + 1, 22 - s)
      const rise = Math.round(Math.sqrt(d) * 2)
      for (let u = 2; u < 46; u++) {
        k.vox.box(u, 18 + s, 22, 1, 1, rise, M.white)
      }
    }
    // control tower
    k.vox.cylinder(10, 9, 0, 2.5, 50, M.cream)
    k.vox.cylinder(10, 9, 50, 4.5, 6, M.glassLit)
    k.vox.cylinder(10, 9, 56, 4.5, 2, M.white)
    antenna(k, 10, 9, 58, 6)
  },

  ap_hangar(k) {
    plot(k, 'concrete')
    // barrel-vault hangar along u, big doors facing +v (lit side)
    const r = 18
    for (let v = 0; v < 2 * r; v++) {
      const dv = v + 0.5 - r
      const hgt = Math.round(Math.sqrt(r * r - dv * dv) * 1.1)
      for (let u = 4; u < 44; u++) {
        const end = u === 43
        const m = end
          ? M.concrete
          : v >= r
            ? M.roofGrey
            : mat('grey3', 'grey3', 'grey1')
        k.vox.box(u, 6 + v, 0, 1, 1, hgt, m)
      }
    }
    // the big doors on the right (+u) end
    for (let v = 10; v < 38; v++) {
      for (let z = 0; z < 16; z++) {
        if (k.vox.filled(43, 6 + v - 6, z)) {
          k.vox.set(43, 6 + v - 6, z, z % 2 ? M.metal : M.concrete)
        }
      }
    }
  },

  cv_hall(k) {
    plot(k, 'grass')
    floorRect(k, 0, 36, 48, 12, (u, v) => groundCell('pavement', u, v))
    const bx = block(k, 6, 6, 36, 28, 3, M.cream, {
      roof: M.roofFlat,
      parapet: M.white,
      sill: M.white,
      wh: 6,
    })
    colonnade(k, bx, 'left', 34, 3, M.white, 3)
    roofGable(
      k,
      { u0: 14, v0: 34, z0: 34, a: 20, b: 3, h: 2 },
      'v',
      M.cream,
      M.white,
      0.6,
      0,
    )
    // drum + dome + flag
    const drum = box(k, 16, 12, top(bx), 16, 16, 8, M.white)
    roofDome(k, drum, 8, 10, M.roofGreen)
    flag(k, 24, 20, top(drum) + 10, 10, M.blue)
  },

  cv_stadium(k) {
    plot(k, 'concrete')
    // the pitch
    floorRect(k, 12, 12, 24, 24, (u, v) =>
      u === 23 || v === 12 || v === 35 || u === 12 || u === 35
        ? { c: 'grey5' }
        : groundCell('lawn', u, v),
    )
    // stepped stands on all four sides
    const seats = [M.blue, M.cream, M.blue]
    for (let i = 0; i < 3; i++) {
      const h = 4 + i * 4
      const o = 11 - i * 3
      const m = seats[i] as Mat
      k.vox.box(o - 2, o - 2, 0, 50 - 2 * o + 4, 3, h, m)
      k.vox.box(o - 2, o - 2, 0, 3, 50 - 2 * o + 4, h, m)
      k.vox.box(o - 2, 48 - o - 1, 0, 50 - 2 * o + 4, 3, Math.max(2, h - 6), m)
      k.vox.box(48 - o - 1, o - 2, 0, 3, 50 - 2 * o + 4, Math.max(2, h - 6), m)
    }
    // floodlight masts at the back corners
    for (const [u, v] of [
      [3, 3],
      [44, 3],
      [3, 44],
    ] as const) {
      k.vox.box(u, v, 0, 1, 1, 34, M.metal)
      k.vox.box(u - 1, v - 1, 34, 3, 3, 2, M.sign)
    }
  },

  cv_civic_2x2(k) {
    plot(k, 'grass')
    floorRect(k, 0, 26, 32, 6, (u, v) => groundCell('pavement', u, v))
    const bx = block(k, 5, 5, 22, 18, 2, M.cream, {
      roof: null,
      sill: M.white,
      wh: 6,
    })
    colonnade(k, bx, 'left', 28, 3, M.white, 3)
    roofGable(k, bx, 'v', M.roofGrey, M.cream, 0.5, 1)
    roofGable(
      k,
      { u0: 9, v0: 23, z0: 28, a: 14, b: 3, h: 2 },
      'v',
      M.cream,
      M.white,
      0.5,
      0,
    )
    flag(k, 16, 14, top(bx) + 8, 14, M.blue)
    tree(k, 28, 8, 3, 4)
  },

  cv_pavilion(k) {
    plot(k, 'grass')
    floorRect(k, 3, 3, 10, 10, (u, v) => groundCell('pavement', u, v))
    // octagonal ring of columns under a round roof
    for (const [u, v] of [
      [4, 7],
      [7, 4],
      [11, 7],
      [7, 11],
      [5, 5],
      [10, 5],
      [5, 10],
      [10, 10],
    ] as const) {
      k.vox.box(u, v, 0, 1, 1, 10, M.white)
    }
    k.vox.cylinder(8, 8, 10, 6, 1, M.white)
    k.vox.blob(8, 8, 11, 6, 6, 6, (_u, _v, z) => (z >= 11 ? M.roofGreen : null))
    k.vox.box(7, 7, 17, 2, 2, 2, M.sign)
  },

  dk_containers(k) {
    plot(k, 'concrete')
    container(k, 2, 2, 0, 12, 4, 'blue')
    container(k, 2, 2, 6, 12, 4, 'orange')
    container(k, 2, 7, 0, 12, 4, 'yellow')
    container(k, 2, 7, 6, 12, 4, 'grass')
    container(k, 2, 7, 12, 12, 4, 'purple')
    container(k, 2, 12, 0, 12, 3, 'orange')
  },
}

// ---------------------------------------------------------------------------
// Generic fallback by district (any building id without a design)

function generic(k: Kit, spec: BuildingSpec): void {
  plot(k, districtGround(spec.district))
  const N = k.N
  const m = Math.max(2, Math.round(N * 0.12))
  const storeys: Record<string, [number, number]> = {
    downtown: [3, 6],
    highres: [3, 5],
    industrial: [1, 2],
    lowres: [1, 2],
    rural: [1, 1],
    civic: [2, 3],
    docks: [1, 1],
    airport: [1, 2],
  }
  const [lo, hi] = storeys[spec.district ?? ''] ?? [2, 3]
  const n = k.rng.int(lo, hi)
  const walls = [M.brick, M.cream, M.plasterY, M.concrete]
  const bx = block(k, m, m, N - 2 * m, N - 2 * m, n, k.rng.pick(walls), {
    roof: null,
  })
  roofHip(k, bx, k.rng.pick([M.roofTerra, M.roofGrey, M.roofPurple]), 0.8, 1)
}

// ---------------------------------------------------------------------------
// Mood overlays (§2.8 mood_*, city-view.md §3.3 scorch)

function moodHappy(k: Kit): void {
  const N = k.N
  const flowers = [mat('pink1', 'pink1', 'pink0'), M.sign, M.white]
  const boxes = Math.max(2, k.fp * 2)
  for (let i = 0; i < boxes; i++) {
    const t = Math.round(((i + 0.5) * (N - 4)) / boxes) + 2
    const f = flowers[i % flowers.length] as Mat
    // planters along both front edges of the plot
    k.vox.box(t - 1, N - 2, 0, 3, 1, 1, M.wood)
    k.vox.box(t - 1, N - 2, 1, 3, 1, 1, M.leaf)
    k.vox.set(t, N - 2, 2, f)
    k.vox.box(N - 2, t - 1, 0, 1, 3, 1, M.wood)
    k.vox.box(N - 2, t - 1, 1, 1, 3, 1, M.leaf)
    k.vox.set(N - 2, t, 2, flowers[(i + 1) % flowers.length] as Mat)
  }
  // bunting balloons at the front corner
  k.vox.box(N - 2, N - 2, 0, 1, 1, 8, M.white)
  k.vox.blob(
    N - 1.5,
    N - 2.5,
    10,
    1.4,
    1.4,
    1.6,
    mat('pink1', 'pink1', 'pink0'),
  )
  k.vox.blob(N - 2.5, N - 1.5, 11, 1.4, 1.4, 1.6, M.sign)
}

function moodUnhappy(k: Kit): void {
  const N = k.N
  const bags = Math.max(2, k.fp * 2)
  for (let i = 0; i < bags; i++) {
    const t = Math.round(((i + 0.5) * (N - 4)) / bags) + 2
    k.vox.blob(t + 0.5, N - 1.5, 1, 1.3, 1, 1.4, M.metal)
    if (i % 2 === 0) k.vox.blob(N - 1.5, t + 0.5, 1, 1, 1.3, 1.4, M.darkMetal)
  }
  // a toppled bin and spray-paint tags on the apron
  k.vox.box(N - 4, N - 3, 0, 2, 1, 1, M.blue)
  for (let i = 0; i < k.fp * 3; i++) {
    const u = 2 + ((i * 7) % (N - 4))
    k.floor[(N - 1) * N + u] = { c: i % 2 ? 'purple1' : 'pink0' }
    k.floor[u * N + (N - 1)] = { c: i % 2 ? 'pink0' : 'purple1' }
  }
}

function moodScorch(k: Kit): void {
  const N = k.N
  const scorch = ['grey0', 'grey1', 'brown0']
  for (let i = 0; i < k.fp * 10; i++) {
    const t = 1 + ((i * 11) % (N - 2))
    const depth = 1 + (i % 3)
    const c = scorch[i % scorch.length] as string
    for (let o = 0; o < depth; o++) {
      k.floor[(N - 1 - o) * N + t] = { c }
      k.floor[t * N + (N - 1 - o)] = { c }
    }
  }
  // embers and a curl of smoke at the front corner
  k.vox.box(N - 3, N - 3, 0, 2, 2, 1, M.woodDark)
  k.vox.set(N - 3, N - 3, 1, mat('yellow3', 'orange2', 'orange1'))
  k.vox.blob(N - 4, N - 4, 8, 2, 2, 2, mat('grey4', 'grey3', 'grey3'))
  k.vox.blob(N - 6, N - 6, 13, 1.6, 1.6, 1.6, mat('grey5', 'grey4', 'grey4'))
}

// ---------------------------------------------------------------------------
// Drawer

/** draw one building (or mood overlay) to an Img (tests, gallery, exterior) */
export function drawBuildingImg(d: DrawCtx, spec: BuildingSpec): Img {
  const k = newKit(d, { fp: spec.footprint })
  const id = spec.id
  if (id.startsWith('mood_')) {
    k.shadow = false
    if (id.startsWith('mood_happy')) moodHappy(k)
    else if (id.startsWith('mood_unhappy')) moodUnhappy(k)
    else moodScorch(k)
  } else {
    const design = designs[id] ?? generic
    design(k, spec)
  }
  const row = topRow(k)
  if (row < 0) {
    throw new Error(`buildings: ${id} is ${-row} px taller than its canvas`)
  }
  return finish(k)
}

/** style-guide §4.2 entry point: one canvas per manifest building */
export function drawBuilding(d: DrawCtx, spec: BuildingSpec) {
  return imgToCanvas(drawBuildingImg(d, spec), d)
}

export const buildingDrawer: Drawer = (d): DrawnFrame[] => {
  const e = d.entry
  const spec: BuildingSpec = {
    id: e.id,
    district: e.district,
    footprint: e.footprint?.[0] ?? Math.round(e.canvas[0] / 64),
    smokeAnchors: e.smokeAnchors,
  }
  const canvas = drawBuilding(d, spec)
  return e.frames.map((suffix) => ({ suffix, canvas }))
}

/** ids with a bespoke design (the rest of the class uses generic()) */
export const DESIGNED_IDS: readonly string[] = Object.keys(designs)

registerDrawer({ class: 'building1x1' }, buildingDrawer)
registerDrawer({ class: 'building2x2' }, buildingDrawer)
registerDrawer({ class: 'building3x3' }, buildingDrawer)
