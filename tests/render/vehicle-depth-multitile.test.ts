// city-view.md §1.3 depth rule, M4 bug hunt: a vehicle in front of a
// multi-tile footprint's SE (+tx) or SW (+ty) face draws over it along the
// whole face — with the plain fractional tx + ty a truck beside the back
// tiles of a 3×3 tower sorted below the tower's max tx + ty and its wall
// clipped the truck. Behind the NE / NW faces it stays under; a vehicle that
// would have to be both above one footprint and below another keeps the
// plain rule; vehicles lifted over the same face keep their order.
import { describe, expect, it } from 'vitest'
import { buildGameData, isRoadTile } from '../../src/data/index.ts'
import {
  BASE_ORDER,
  IN_FRONT_BIAS,
  sortDepth,
  type Occluder,
  type SpriteRect,
} from '../../src/render/vehicleDepth.ts'
import { loadRawData } from '../../tools/sim/load.node.ts'

const data = buildGameData(loadRawData())

/** An n×n footprint at (x0, y0) whose sprite covers a big screen rect. */
function box(x0: number, y0: number, n: number): Occluder {
  return {
    x0,
    y0,
    x1: x0 + n - 1,
    y1: y0 + n - 1,
    depth: x0 + n - 1 + y0 + n - 1,
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
  }
}
const ON: SpriteRect = { left: 40, top: 40, right: 60, bottom: 60 }
const OFF: SpriteRect = { left: 200, top: 200, right: 220, bottom: 220 }
const depth = (tx: number, ty: number, os: Occluder[], r = ON): number =>
  sortDepth(tx, ty, tx + ty, r, os)

describe('sortDepth: vehicles in front of a multi-tile face draw over it', () => {
  const tower = box(10, 10, 3) // tiles 10..12 × 10..12, depth 24

  it('lifts a vehicle along the whole SE face above the footprint', () => {
    for (let ty = 9.55; ty <= 12.5; ty += 0.05) {
      const d = depth(13, ty, [tower])
      expect(d, `(13, ${ty.toFixed(2)})`).toBeGreaterThan(tower.depth)
    }
  })

  it('lifts a vehicle along the whole SW face above the footprint', () => {
    for (let tx = 9.55; tx <= 12.5; tx += 0.05)
      expect(depth(tx, 13, [tower])).toBeGreaterThan(tower.depth)
  })

  it('was hidden before: the plain tx + ty is below the footprint there', () => {
    expect(13 + 10).toBeLessThan(tower.depth)
    expect(depth(13, 10, [tower])).toBeCloseTo(
      tower.depth + IN_FRONT_BIAS + 23 * BASE_ORDER,
    )
  })

  it('keeps a vehicle behind the NE and NW faces under the footprint', () => {
    for (let t = 9.5; t <= 12.5; t += 0.25) {
      expect(depth(t, 9, [tower])).toBeLessThan(tower.depth)
      expect(depth(9, t, [tower])).toBeLessThan(tower.depth)
      expect(depth(t, 9, [tower])).toBe(t + 9)
    }
  })

  it('leaves the plain rule when the sprites do not overlap on screen', () => {
    expect(depth(13, 10, [tower], OFF)).toBe(23)
  })

  it('ignores a footprint seen from a diagonal corner or from inside it', () => {
    expect(depth(13, 9, [tower])).toBe(22) // east corner: in front and behind
    expect(depth(11, 11, [tower])).toBe(22) // inside (the lot's dock pose)
  })

  it('never lifts past a footprint the vehicle is strictly behind', () => {
    // In front of `low`'s SE face and behind `high`'s NW face at once, with
    // high.depth below low.depth + bias: no depth satisfies both.
    const low = box(10, 10, 3) // depth 24
    const high = { ...box(14, 9, 2), depth: 24 } // forced conflict
    expect(depth(13, 10, [low, high])).toBe(23)
    // Without the conflict the lift applies.
    const far = { ...box(14, 9, 2), depth: 30 }
    expect(depth(13, 10, [low, far])).toBeGreaterThan(low.depth)
    expect(depth(13, 10, [low, far])).toBeLessThan(far.depth)
  })

  it('keeps two vehicles on the same face in tx + ty order', () => {
    const a = depth(13, 10, [tower])
    const b = depth(13, 10.5, [tower])
    expect(b).toBeGreaterThan(a)
    expect(b - tower.depth).toBeLessThan(IN_FRONT_BIAS + 0.02)
  })
})

describe('sortDepth over the shipped map (buildings.json + the warehouse)', () => {
  const map = data.map
  const foots = [
    ...data.buildings.map((b) => ({ id: b.id, tile: b.tile, fp: b.footprint })),
    {
      id: 'warehouse',
      tile: map.lot.warehouse.tile,
      fp: map.lot.warehouse.footprint,
    },
  ].filter((f) => f.fp[0] >= 2)

  it('has multi-tile footprints to test', () => {
    expect(foots.length).toBeGreaterThan(5)
  })

  it('draws a vehicle on any road tile along a SE / SW face in front of it', () => {
    let checked = 0
    for (const f of foots) {
      const o = box(f.tile[0], f.tile[1], f.fp[0])
      for (let i = 0; i < f.fp[0]; i++) {
        const se: [number, number] = [o.x1 + 1, o.y0 + i]
        const sw: [number, number] = [o.x0 + i, o.y1 + 1]
        for (const [tx, ty] of [se, sw]) {
          if (!isRoadTile(map, tx, ty)) continue
          checked++
          expect(
            depth(tx, ty, [o]),
            `${f.id} at (${tx}, ${ty})`,
          ).toBeGreaterThan(o.depth)
        }
        const ne: [number, number] = [o.x0 + i, o.y0 - 1]
        const nw: [number, number] = [o.x0 - 1, o.y0 + i]
        for (const [tx, ty] of [ne, nw]) {
          if (!isRoadTile(map, tx, ty)) continue
          expect(depth(tx, ty, [o]), `${f.id} at (${tx}, ${ty})`).toBeLessThan(
            o.depth,
          )
        }
      }
    }
    expect(checked).toBeGreaterThan(10)
  })
})
