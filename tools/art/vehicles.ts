// Procedural vehicles (style-guide.md §4.3, §2.6): bike / van / truck as a
// voxel box model (iso.ts) built along the direction of travel and rotated
// into the four iso headings NE/SE/SW/NW — drawn directly from the 2:1 axis
// vectors, never mirrored, so the lit face is the screen-left one in every
// heading (§1.2). Frames _<heading>_<0|1>: frame 1 moves the wheel hubs.
// Body ramps follow the manifest bodyRamp (bike orange — red is reserved
// for danger, §1.4 — van blue, truck yellow).
//
// Placement contract (for CityScene): the footprint centre of the vehicle
// (the point on the road centre line) is at canvas (W/2, FOOT_Y): bike
// (12, 18), van (16, 23), truck (24, 22) — within 2 px of setOrigin(0.5,
// 0.75); every frame keeps a >= 1 px transparent margin (lint A05).
// Headings from tile motion: +x -> se, +y -> sw, -x -> nw, -y -> ne.

import type { DrawnFrame, Drawer } from './draw-api.ts'
import { registerDrawer } from './drawers.ts'
import {
  type Img,
  type Mat,
  M,
  Vox,
  depthEdges,
  imgToCanvas,
  mat,
  newImg,
  outlineImg,
  rampMat,
  renderVox,
} from './iso.ts'

export type Heading = 'ne' | 'se' | 'sw' | 'nw'
export const HEADINGS: readonly Heading[] = ['ne', 'se', 'sw', 'nw']

/** a voxel in model space: f = forward, s = side (0 = left of travel) */
interface Part {
  f: number
  s: number
  z: number
  a: number // length along f
  b: number // width along s
  h: number
  m: Mat
}

interface Model {
  L: number
  Wd: number
  H: number
  parts: Part[]
}

/** footprint centre row per class (see header) */
export const FOOT_Y: Record<string, number> = {
  'vehicle-bike': 18,
  'vehicle-van': 23,
  'vehicle-truck': 22,
}

const TYRE = mat('grey1', 'grey0', 'grey0')
const HUB = mat('grey3', 'grey3', 'grey2')
const GLASS = mat('grey5', 'grey4', 'grey3')
const LAMP = mat('yellow3', 'yellow3', 'yellow2')

function P(
  f: number,
  s: number,
  z: number,
  a: number,
  b: number,
  h: number,
  m: Mat,
): Part {
  return { f, s, z, a, b, h, m }
}

/** wheels at forward positions `fs` (2 units long), both sides */
function wheels(fs: number[], Wd: number, frame: number): Part[] {
  const out: Part[] = []
  for (const f of fs) {
    for (const s of [0, Wd - 1]) {
      out.push(P(f, s, 0, 2, 1, 2, TYRE))
      // hub: the upper voxel at the front or back half of the wheel
      out.push(P(f + (frame % 2), s, 1, 1, 1, 1, HUB))
    }
  }
  return out
}

function van(body: Mat, frame: number): Model {
  const L = 9
  const Wd = 5
  const white = M.white
  return {
    L,
    Wd,
    H: 12,
    parts: [
      // chassis + cargo box + cab (wheels show below the chassis)
      P(0, 1, 1, L, Wd - 2, 1, M.metal),
      P(0, 0, 2, 6, Wd, 9, body),
      P(6, 0, 2, 3, Wd, 6, body),
      P(6, 0, 8, 2, Wd, 1, body),
      // livery stripe along the cargo box
      P(0, 0, 6, 6, 1, 1, white),
      P(0, Wd - 1, 6, 6, 1, 1, white),
      // windscreen + side windows of the cab
      P(8, 1, 5, 1, Wd - 2, 3, GLASS),
      P(6, 0, 5, 2, 1, 3, GLASS),
      P(6, Wd - 1, 5, 2, 1, 3, GLASS),
      // rear doors seam + roof rack
      P(0, 2, 3, 1, 1, 7, mat(body.left, body.right, body.right)),
      P(2, 2, 11, 2, 1, 1, M.metal),
      // lamps + bumper
      P(8, 0, 3, 1, 1, 1, LAMP),
      P(8, Wd - 1, 3, 1, 1, 1, LAMP),
      ...wheels([1, 6], Wd, frame),
    ],
  }
}

function truck(body: Mat, frame: number): Model {
  const L = 11
  const Wd = 5
  const cab = rampMat('blue', 0)
  return {
    L,
    Wd,
    H: 12,
    parts: [
      P(0, 1, 1, L, Wd - 2, 2, M.metal),
      // the long cargo box
      P(0, 0, 3, 8, Wd, 9, body),
      P(0, 0, 11, 8, Wd, 1, mat(body.top, body.top, body.left)),
      // cab
      P(8, 0, 2, 3, Wd, 7, cab),
      P(10, 1, 5, 1, Wd - 2, 3, GLASS),
      P(8, 0, 6, 2, 1, 2, GLASS),
      P(8, Wd - 1, 6, 2, 1, 2, GLASS),
      P(10, 0, 3, 1, 1, 1, LAMP),
      P(10, Wd - 1, 3, 1, 1, 1, LAMP),
      // box ribs
      P(2, 0, 4, 1, 1, 7, mat(body.left, body.right, body.right)),
      P(5, 0, 4, 1, 1, 7, mat(body.left, body.right, body.right)),
      P(2, Wd - 1, 4, 1, 1, 7, mat(body.left, body.right, body.right)),
      P(5, Wd - 1, 4, 1, 1, 7, mat(body.left, body.right, body.right)),
      ...wheels([0, 3, 8], Wd, frame),
    ],
  }
}

function bike(body: Mat, frame: number): Model {
  const L = 6
  const Wd = 2
  const cargo = rampMat('brown', 1)
  const shirt = rampMat('blue', 0)
  return {
    L,
    Wd,
    H: 11,
    parts: [
      // two wheels (centre line)
      P(0, 0, 0, 2, 2, 2, TYRE),
      P(4, 0, 0, 2, 2, 2, TYRE),
      P(frame % 2, 0, 1, 1, 2, 1, HUB),
      P(4 + (frame % 2), 0, 1, 1, 2, 1, HUB),
      // frame + the cargo box over the front wheel
      P(1, 0, 2, 4, 2, 1, body),
      P(3, 0, 3, 3, 2, 4, cargo),
      P(3, 0, 7, 3, 2, 1, body),
      // rider: legs, torso, head with a cap
      P(1, 0, 3, 1, 2, 2, shirt),
      P(1, 0, 5, 2, 2, 3, body),
      P(1, 0, 8, 2, 2, 2, M.skin),
      P(1, 0, 10, 2, 2, 1, shirt),
    ],
  }
}

/** rotate model coordinates into (u, v) for a heading (L x L grid) */
function place(
  h: Heading,
  f: number,
  s: number,
  L: number,
  Wd: number,
): [number, number] {
  switch (h) {
    case 'se':
      return [f, s]
    case 'sw':
      return [Wd - 1 - s, f]
    case 'nw':
      return [L - 1 - f, Wd - 1 - s]
    case 'ne':
      return [s, L - 1 - f]
  }
}

export function renderVehicle(
  model: Model,
  heading: Heading,
  W: number,
  Hc: number,
  footY: number,
): Img {
  const { L, Wd } = model
  const vox = new Vox(L, L, model.H + 1)
  for (const p of model.parts) {
    for (let df = 0; df < p.a; df++) {
      for (let ds = 0; ds < p.b; ds++) {
        const [u, v] = place(heading, p.f + df, p.s + ds, L, Wd)
        vox.box(u, v, p.z, 1, 1, p.h, p.m)
      }
    }
  }
  // footprint extents in (u, v)
  const along = heading === 'se' || heading === 'nw'
  const nu = along ? L : Wd
  const nv = along ? Wd : L
  // footprint centre (nu/2, nv/2) -> canvas (W/2, footY)
  const ox = W / 2 - (nu - nv)
  const oy = footY - (nu + nv) / 2
  const img = newImg(W, Hc)
  renderVox(img, vox, ox, oy)
  depthEdges(img, 4)
  outlineImg(img)
  return img
}

const MODELS: Record<string, (body: Mat, frame: number) => Model> = {
  bike,
  van,
  truck,
}

const DEFAULT_RAMP: Record<string, string> = {
  bike: 'orange',
  van: 'blue',
  truck: 'yellow',
}

export function drawVehicleImg(
  id: string,
  cls: string,
  canvas: [number, number],
  heading: Heading,
  frame: number,
  bodyRamp?: string,
): Img {
  const build = MODELS[id]
  if (!build) throw new Error(`vehicles: no model for ${id}`)
  const ramp = bodyRamp ?? DEFAULT_RAMP[id] ?? 'blue'
  const body = rampMat(ramp, ramp === 'yellow' || ramp === 'orange' ? 1 : 0)
  const model = build(body, frame)
  const footY = FOOT_Y[cls] ?? Math.round(canvas[1] * 0.75)
  return renderVehicle(model, heading, canvas[0], canvas[1], footY)
}

const vehicleDrawer: Drawer = (d): DrawnFrame[] =>
  d.entry.frames.map((suffix) => {
    const m = /^_(ne|se|sw|nw)_(\d)$/.exec(suffix)
    if (!m) throw new Error(`vehicles: bad frame ${suffix}`)
    const img = drawVehicleImg(
      d.entry.id,
      d.entry.class,
      d.entry.canvas,
      m[1] as Heading,
      Number(m[2]),
      d.entry.bodyRamp,
    )
    return { suffix, canvas: imgToCanvas(img, d) }
  })

registerDrawer({ class: 'vehicle-bike' }, vehicleDrawer)
registerDrawer({ class: 'vehicle-van' }, vehicleDrawer)
registerDrawer({ class: 'vehicle-truck' }, vehicleDrawer)
