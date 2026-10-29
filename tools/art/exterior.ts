// Warehouse exterior, lot/dock props and city props (style-guide.md §2.4,
// §2.5, §4.3): wh_ext_t1/_t2 (the 4x4 company building), the city props
// (tree_round, tree_pine, bush, lamp_post, bench, fence), the docks crane
// and ship, and the sign boards sign_locked / sign_days / sign_pop.
//
// Props have no ground patch. Placement rule (same as buildings): the
// sprite is placed with setOrigin(0.5, 1) at the tile's bottom vertex
// (tileToScreen + HH), so the object stands on the tile centre = canvas
// (W/2, H - 16). Board signs are screen-facing (text is BitmapText on the
// face rect SIGN_FACE / SIGN_LOCKED_FACE). dk_ship (dock-prop 128x96) sits on a 2x2-tile
// water footprint with the same anchor rule.

import type { DrawCtx, DrawnFrame, Drawer } from './draw-api.ts'
import { registerDrawer } from './drawers.ts'
import {
  type Box,
  type Img,
  type Kit,
  type Mat,
  M,
  antenna,
  box,
  floorRect,
  finish,
  groundCell,
  imgToCanvas,
  lineImg,
  mat,
  newImg,
  newKit,
  outlineImg,
  pine,
  put,
  rampMat,
  rect,
  roofGable,
  top,
  tree,
  windows,
} from './iso.ts'

// ---------------------------------------------------------------------------
// Warehouse exterior (warehouse-ext 256x256, footprint 4x4)

function corrugated(k: Kit, bx: Box, m: Mat): void {
  const dark = mat(m.top, m.right, m.right)
  for (let t = 1; t < bx.a; t += 2) {
    for (let z = bx.z0; z < top(bx); z++) {
      const cur = k.vox.matAt(bx.u0 + t, bx.v0 + bx.b - 1, z)
      if (cur && cur.left === m.left) {
        k.vox.set(bx.u0 + t, bx.v0 + bx.b - 1, z, dark)
      }
    }
  }
  for (let t = 1; t < bx.b; t += 2) {
    for (let z = bx.z0; z < top(bx); z++) {
      const cur = k.vox.matAt(bx.u0 + bx.a - 1, bx.v0 + t, z)
      if (cur && cur.right === m.right) {
        k.vox.set(bx.u0 + bx.a - 1, bx.v0 + t, z, dark)
      }
    }
  }
}

/** loading bay on the lit (+v) face: open dock or shuttered door */
function bay(
  k: Kit,
  bx: Box,
  t0: number,
  w: number,
  h: number,
  open: boolean,
): void {
  const v = bx.v0 + bx.b - 1
  for (let t = t0; t < t0 + w; t++) {
    for (let z = 3; z < 3 + h; z++) {
      let m: Mat
      if (open) m = mat('grey0', 'grey0', 'grey0')
      else m = z % 2 === 0 ? M.metal : M.darkMetal
      k.vox.set(bx.u0 + t, v, z, m)
    }
    // hazard-striped frame
    k.vox.set(bx.u0 + t, v, 3 + h, (t - t0) % 2 ? M.sign : M.darkMetal)
  }
  for (let z = 3; z < 3 + h; z++) {
    k.vox.set(bx.u0 + t0 - 1, v, z, M.sign)
    k.vox.set(bx.u0 + t0 + w, v, z, M.sign)
  }
  // rubber bumpers on the dock platform
  k.vox.box(bx.u0 + t0, v + 3, 1, 1, 1, 2, M.darkMetal)
  k.vox.box(bx.u0 + t0 + w - 1, v + 3, 1, 1, 1, 2, M.darkMetal)
}

export function drawWarehouseExt(d: DrawCtx, tier: 1 | 2): Img {
  const k = newKit(d, { fp: 4, canvas: [256, 256] })
  const N = k.N // 64
  // the lot apron: concrete with yellow lane lines in front of the bays
  floorRect(k, 0, 0, N, N, (u, v) => {
    const c = groundCell('concrete', u, v)
    if (v >= 50 && v < 62 && u >= 6 && u < 34 && (u - 6) % 9 === 0) {
      return { c: 'yellow2' }
    }
    if (v === 61 && u >= 4 && u < 36) return { c: 'yellow2' }
    return c
  })
  const wall = tier === 1 ? M.metal : rampMat('blue', 0)
  const shed = box(k, 4, 6, 0, 52, 40, 34, wall)
  corrugated(k, shed, wall)
  // the loading platform along the bays (west end of the lit face)
  k.vox.box(4, 46, 0, 32, 3, 3, M.concrete)
  bay(k, shed, 4, 7, 14, true) // dock 1 (open)
  bay(k, shed, 15, 7, 14, false) // dock 2 (L3, shuttered)
  bay(k, shed, 26, 7, 14, false) // dock 3 (L4, shuttered)
  // high clerestory windows on the lit face
  windows(k, shed, {
    z: 23,
    storey: 20,
    wh: 4,
    ww: 3,
    pitch: 6,
    margin: 36,
    lit: 1,
    faces: ['left'],
  })
  windows(k, shed, {
    z: 23,
    storey: 20,
    wh: 4,
    ww: 3,
    pitch: 6,
    margin: 4,
    lit: tier === 1 ? 0.5 : 1,
    faces: ['right'],
  })
  // low gable roof with skylights
  const roofM = tier === 1 ? M.roofGrey : rampMat('grey', 2)
  roofGable(k, shed, 'u', roofM, wall, 0.3, 1)
  for (const u of [12, 24, 36, 48]) {
    k.vox.box(u, 26, top(shed) + 4, 4, 2, 1, M.glassLit)
    k.vox.box(u, 18, top(shed) + 4, 4, 2, 1, M.glassLit)
  }
  // the office box at the east end (front corner)
  const officeWall = tier === 1 ? M.cream : M.white
  const office = box(k, 40, 30, 0, 18, 22, 26, officeWall)
  windows(k, office, { z: 14, storey: 13, wh: 5, ww: 2, pitch: 4, lit: 0.8 })
  k.vox.box(44, 51, 0, 3, 1, 9, M.door)
  k.vox.box(40, 30, 26, 18, 22, 1, M.concrete)
  if (tier === 1) {
    // scrappy start-up: rust patches, a tiny wooden sign, an AC box
    for (const [u, v] of [
      [10, 10],
      [30, 34],
      [20, 30],
    ] as const) {
      const z = k.vox.topAt(u, v)
      k.vox.box(u, v, z, 3, 2, 1, M.brick)
    }
    k.vox.box(42, 52, 12, 6, 1, 3, M.wood)
    k.vox.box(50, 36, 27, 4, 4, 3, M.metal)
    // pallets and a dumpster on the apron
    k.vox.box(40, 56, 0, 4, 3, 1, M.wood)
    k.vox.box(40, 56, 1, 3, 2, 2, rampMat('brown', 1))
    k.vox.box(58, 22, 0, 4, 6, 4, rampMat('grass', 0))
  } else {
    // tier 2: painted walls, the company sign board over the bays,
    // a clean roof, a rooftop unit and planters
    k.vox.box(6, 46, 22, 26, 1, 8, M.sign)
    k.vox.box(8, 47, 24, 22, 1, 4, M.blue)
    k.vox.box(12, 47, 25, 14, 1, 2, M.white)
    k.vox.box(41, 52, 15, 10, 1, 4, M.sign)
    k.vox.box(48, 34, 27, 6, 6, 4, M.metal)
    antenna(k, 52, 40, 31, 10)
    for (const u of [38, 52]) {
      k.vox.box(u, 56, 0, 3, 2, 2, M.wood)
      k.vox.blob(u + 1.5, 57, 3, 1.6, 1.2, 1.6, M.leaf)
    }
  }
  return finish(k)
}

// ---------------------------------------------------------------------------
// City props (prop 64x128): standing on the tile centre

function propKit(d: DrawCtx): Kit {
  const k = newKit(d, { fp: 1 })
  k.shadow = false
  k.edge = 4
  return k
}

function treeRound(k: Kit): void {
  tree(k, 8, 8, 6.5, 8, M.leaf)
}

function treePine(k: Kit): void {
  pine(k, 8, 8, 30, 6.5)
}

function bush(k: Kit): void {
  k.vox.blob(8.5, 8.5, 3, 5, 5, 4, M.leaf)
  k.vox.blob(6.5, 10, 5, 3, 3, 2.6, M.leaf)
  k.vox.set(10, 6, 6, M.sign)
  k.vox.set(6, 11, 4, mat('pink1', 'pink1', 'pink0'))
  k.vox.set(11, 10, 5, M.white)
}

function lampPost(k: Kit): void {
  k.vox.box(7, 7, 0, 2, 2, 1, M.darkMetal)
  k.vox.box(8, 8, 1, 1, 1, 26, M.darkMetal)
  k.vox.box(8, 9, 26, 1, 3, 1, M.darkMetal)
  k.vox.box(8, 11, 24, 1, 2, 2, mat('yellow3', 'yellow3', 'yellow2'))
  k.vox.box(8, 11, 26, 1, 2, 1, M.darkMetal)
}

function bench(k: Kit): void {
  for (const u of [4, 11]) {
    k.vox.box(u, 8, 0, 1, 1, 3, M.darkMetal)
    k.vox.box(u, 7, 0, 1, 1, 5, M.darkMetal)
  }
  k.vox.box(3, 8, 3, 10, 2, 1, M.wood)
  k.vox.box(3, 7, 4, 10, 1, 2, M.wood)
}

function fence(k: Kit): void {
  for (let u = 0; u < 16; u += 3) k.vox.box(u, 8, 0, 1, 1, 6, M.woodDark)
  k.vox.box(0, 8, 2, 16, 1, 1, M.wood)
  k.vox.box(0, 8, 4, 16, 1, 1, M.wood)
}

function crane(k: Kit): void {
  const y = mat('yellow3', 'yellow2', 'yellow1')
  // lattice tower: corner posts + alternating braces
  const T = 64
  for (const [du, dv] of [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ] as const) {
    k.vox.box(7 + du, 7 + dv, 0, 1, 1, T, y)
  }
  for (let z = 2; z < T; z += 4) {
    k.vox.box(7, 9, z, 3, 1, 1, y)
    k.vox.box(9, 7, z, 1, 3, 1, y)
    k.vox.box(8, 9, z + 2, 1, 1, 1, y)
    k.vox.box(9, 8, z + 2, 1, 1, 1, y)
  }
  // the cab, jib (+u, over the water) and counter-jib with ballast
  k.vox.box(6, 6, T, 5, 5, 5, mat('grey5', 'grey4', 'grey3'))
  k.vox.box(10, 7, T + 1, 1, 3, 3, M.glassLit)
  k.vox.box(-1, 8, T + 5, 16, 1, 2, y)
  for (let u = 0; u < 15; u += 2) k.vox.set(u, 8, T + 7, y)
  k.vox.box(0, 7, T + 2, 3, 3, 3, M.darkMetal)
  k.vox.box(8, 8, T + 5, 1, 1, 6, y)
  // cable + hook at the jib tip
  k.vox.box(14, 8, T - 10, 1, 1, 15, M.darkMetal)
  k.vox.box(14, 8, T - 12, 1, 1, 2, M.sign)
}

// ---------------------------------------------------------------------------
// The ship (dock-prop 128x96, a 2x2-tile footprint on the water)

function ship(k: Kit): void {
  const hull = rampMat('orange', 0)
  const deck = mat('grey4', 'grey3', 'grey2')
  // hull along u with a pointed bow at +u
  for (let u = 2; u < 30; u++) {
    const taper = u > 24 ? u - 24 : 0
    const v0 = 10 + taper
    const b = 12 - 2 * taper
    if (b <= 0) continue
    k.vox.box(u, v0, 0, 1, b, 7, hull)
    k.vox.box(u, v0, 7, 1, b, 1, deck)
  }
  // white waterline band
  for (let u = 2; u < 28; u++) {
    k.vox.set(u, 21, 2, M.white)
  }
  // containers mid-ship
  const cols = ['blue', 'yellow', 'grass', 'purple', 'orange'] as const
  let i = 0
  for (let u = 9; u < 23; u += 5) {
    for (const v of [11, 15]) {
      const ramp = cols[i++ % cols.length] as string
      const base = ramp === 'yellow' || ramp === 'orange' ? 1 : 0
      k.vox.box(u, v, 8, 4, 4, 5, rampMat(ramp, base))
      if ((u + v) % 2 === 0) {
        k.vox.box(u, v, 13, 4, 4, 4, rampMat(cols[i % 5] as string, 1))
      }
    }
  }
  // the bridge at the stern + funnel
  k.vox.box(3, 11, 8, 5, 10, 12, M.white)
  k.vox.box(3, 20, 15, 5, 1, 2, M.glassLit)
  k.vox.box(7, 11, 15, 1, 10, 2, M.glassLit)
  k.vox.box(4, 14, 20, 3, 3, 6, mat('yellow2', 'yellow1', 'yellow0'))
  k.vox.box(4, 14, 26, 3, 3, 1, M.darkMetal)
}

// ---------------------------------------------------------------------------
// Board signs: screen-facing boards on two posts, feet on row H - 17 (the
// tile centre). sign_days is 64x40 (one short line); sign_locked and its
// unlock pop sign_pop are 96x52 so "Unlocks at Lv N" (81 px in m5x7) plus
// the Industrial "Trucks only" line sit on the face.

interface FaceRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** face rect of sign_days (64x40), canvas px (BitmapText goes here) */
export const SIGN_FACE = { x: 4, y: 3, w: 56, h: 15 } as const
/** face rect of sign_locked (96x52): two 14-px m5x7 lines */
export const SIGN_LOCKED_FACE = { x: 4, y: 3, w: 88, h: 26 } as const

function board(
  img: Img,
  face: string,
  frame = 'brown2',
  f: FaceRect = SIGN_FACE,
): void {
  const W = img.w
  const bottom = f.y + f.h + 1 // last frame row (brown1)
  const feet = img.h - 17
  const postH = feet - bottom + 1
  const px = [Math.round(W * 0.16), W - Math.round(W * 0.16) - 3]
  // posts
  for (const x of px) {
    rect(img, x, bottom, 3, postH, 'brown1')
    rect(img, x, bottom, 1, postH, 'brown2')
  }
  // frame + face
  rect(img, 1, 0, W - 2, bottom + 1, frame)
  rect(img, 1, 0, W - 2, 1, 'brown3')
  rect(img, 1, bottom, W - 2, 1, 'brown1')
  rect(img, f.x, f.y, f.w, f.h, face)
  rect(img, f.x, f.y + f.h - 1, f.w, 1, 'grey4')
}

function signLocked(): Img {
  const img = newImg(96, 52)
  board(img, 'grey5', 'brown2', SIGN_LOCKED_FACE)
  // nail heads
  for (const x of [3, 92]) put(img, x, 2, 'grey2')
  outlineImg(img)
  return img
}

function signDays(cracked: boolean): Img {
  const img = newImg(64, 40)
  board(img, 'grey5', 'yellow2')
  // hazard stripes on the top rail
  for (let x = 1; x < 63; x++) {
    if ((x >> 2) % 2 === 0) put(img, x, 1, 'grey0')
    if (((x + 2) >> 2) % 2 === 0) put(img, x, 2, 'grey0')
  }
  if (cracked) {
    // a crack across the face and a chipped corner
    const pts: [number, number][] = [
      [40, 3],
      [36, 7],
      [41, 10],
      [35, 14],
      [38, 17],
    ]
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = pts[i] as [number, number]
      const [c, e] = pts[i + 1] as [number, number]
      lineImg(img, a, b, c, e, 'grey1')
    }
    for (let y = 0; y < 4; y++) {
      for (let x = 62 - (3 - y); x < 63; x++) put(img, x, y, null)
    }
    // the board hangs a little: lower-right post shifted
    rect(img, 51, 22, 3, 2, null)
  }
  outlineImg(img)
  return img
}

/** sign_pop is drawn on the 64x40 grid, scaled 1.5x to the 96x52 board */
const pop15 = (v: number): number => Math.round(v * 1.5)

function signPop(f: number): Img {
  const img = newImg(96, 52)
  const k = pop15
  const plank = (x: number, y: number, w: number, h: number, c: string): void =>
    rect(img, k(x), k(y), k(x + w) - k(x), k(y + h) - k(y), c)
  const dot = (x: number, y: number, c: string): void => plank(x, y, 1, 1, c)
  if (f === 0) {
    // squash: the board flattens and widens a little, sparkles out
    plank(0, 6, 64, 14, 'brown2')
    plank(3, 8, 58, 10, 'grey5')
    for (const [x, y] of [
      [6, 2],
      [32, 0],
      [58, 3],
    ] as const) {
      dot(x, y, 'yellow3')
      dot(x + 1, y, 'yellow3')
    }
  } else if (f === 1) {
    // burst: planks fly, a white puff
    for (const [x, y, w] of [
      [4, 4, 12],
      [44, 2, 14],
      [20, 16, 10],
      [38, 18, 12],
    ] as const) {
      plank(x, y, w, 3, 'brown2')
    }
    plank(22, 6, 20, 8, 'grey5')
    plank(18, 8, 28, 4, 'grey5')
    for (const [x, y] of [
      [2, 12],
      [60, 10],
      [30, 1],
    ] as const) {
      dot(x, y, 'yellow3')
    }
  } else {
    // dust settles: a few sparkles and specks
    for (const [x, y] of [
      [10, 10],
      [26, 4],
      [40, 14],
      [54, 8],
      [32, 20],
    ] as const) {
      plank(x, y, 2, 2, 'grey4')
    }
    dot(18, 2, 'yellow3')
    dot(48, 3, 'yellow3')
  }
  outlineImg(img)
  return img
}

// ---------------------------------------------------------------------------
// Registration

function voxProp(paint: (k: Kit) => void): Drawer {
  return (d): DrawnFrame[] => {
    const k = propKit(d)
    paint(k)
    const canvas = imgToCanvas(finish(k), d)
    return d.entry.frames.map((suffix) => ({ suffix, canvas }))
  }
}

registerDrawer({ id: 'wh_ext' }, (d): DrawnFrame[] =>
  d.entry.frames.map((suffix) => ({
    suffix,
    canvas: imgToCanvas(drawWarehouseExt(d, suffix === '_t2' ? 2 : 1), d),
  })),
)
registerDrawer({ id: 'tree_round' }, voxProp(treeRound))
registerDrawer({ id: 'tree_pine' }, voxProp(treePine))
registerDrawer({ id: 'bush' }, voxProp(bush))
registerDrawer({ id: 'lamp_post' }, voxProp(lampPost))
registerDrawer({ id: 'bench' }, voxProp(bench))
registerDrawer({ id: 'fence' }, voxProp(fence))
registerDrawer({ id: 'dk_crane' }, voxProp(crane))
registerDrawer({ id: 'dk_ship' }, (d): DrawnFrame[] => {
  const k = newKit(d, { fp: 2, canvas: d.entry.canvas })
  k.shadow = false
  ship(k)
  const canvas = imgToCanvas(finish(k), d)
  return d.entry.frames.map((suffix) => ({ suffix, canvas }))
})
registerDrawer({ id: 'sign_locked' }, (d) =>
  d.entry.frames.map((suffix) => ({
    suffix,
    canvas: imgToCanvas(signLocked(), d),
  })),
)
registerDrawer({ id: 'sign_days' }, (d) =>
  d.entry.frames.map((suffix) => ({
    suffix,
    canvas: imgToCanvas(signDays(suffix === '_cracked'), d),
  })),
)
registerDrawer({ id: 'sign_pop' }, (d) =>
  d.entry.frames.map((suffix, i) => ({
    suffix,
    canvas: imgToCanvas(signPop(i), d),
  })),
)
