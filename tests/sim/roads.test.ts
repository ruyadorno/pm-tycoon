// spec §3.1 road grid + plan.md §6.4 roads.ts: the avenue graph minus the
// stretches trimmed over scenery, connected, every anchor and the lot
// entrance (19, 23) routable; the warehouse lot joins it only at the entrance.

import { describe, expect, it } from 'vitest'
import { isAvenueTile } from '../../src/data/index.ts'
import { mapIndex } from '../../src/sim/map.ts'
import { roadGraph } from '../../src/sim/roads.ts'
import { dataFixture } from './helpers.ts'

const data = dataFixture()
const g = roadGraph(data)

describe('road graph (spec §3.1)', () => {
  it('avenue tile count: 6 + 6 lines over 3..43, minus crossings, minus the 45 trimmed tiles = 411', () => {
    const lines = data.map.avenues.length
    const span = data.map.avenues.at(-1)! - data.map.avenues[0]! + 1
    const avenueTiles = 2 * lines * span - lines * lines
    expect(avenueTiles).toBe(456)
    expect(g.roads).toHaveLength(411)
    expect(g.roads.every((t) => isAvenueTile(data.map, t.x, t.y))).toBe(true)
  })

  it('trimmed tiles are absent: x=35 ∧ y≥36, y=35 ∧ x≥36, x=43 ∧ y≥28, y=43 ∧ x≥28', () => {
    for (let k = 36; k <= 43; k++) {
      expect(g.isRoad(35, k)).toBe(false)
      expect(g.isRoad(k, 35)).toBe(false)
    }
    for (let k = 28; k <= 43; k++) {
      expect(g.isRoad(43, k)).toBe(false)
      expect(g.isRoad(k, 43)).toBe(false)
    }
    // one-sided avenues stay: x = 43 ends at (43, 27), y = 35 at (35, 35)
    expect(g.isRoad(43, 27)).toBe(true)
    expect(g.isRoad(35, 35)).toBe(true)
    expect(g.isRoad(3, 43)).toBe(true) // seafront / quay corner
    expect(g.isRoad(27, 43)).toBe(true)
  })

  it('the graph is connected: every road tile is reachable from the lot entrance (19, 23)', () => {
    const seen = g.reachable(g.entrance)
    expect(g.entrance).toEqual({ x: 19, y: 23 })
    expect(g.isRoad(19, 23)).toBe(true)
    for (const t of g.roads) expect(seen.has(g.index(t.x, t.y))).toBe(true)
  })

  it('every building anchor is a routable road tile', () => {
    const seen = g.reachable(g.entrance)
    for (const b of data.buildings) {
      const [x, y] = b.anchor
      expect(g.isRoad(x, y), b.id).toBe(true)
      expect(seen.has(g.index(x, y)), b.id).toBe(true)
    }
    expect(g.problems(data)).toEqual([])
  })

  it('the lot is a pocket: its drive tiles join the roads only at the entrance', () => {
    const lot = mapIndex(data).lot
    // block (2,2) = x 20-26, y 20-26 minus the 4×4 warehouse and the sign tile
    expect(g.lot).toHaveLength(49 - 16 - 1)
    for (const t of [...lot.docks, ...lot.queue, ...lot.parking]) {
      expect(g.isLot(t.x, t.y)).toBe(true)
    }
    for (let y = 21; y <= 24; y++) {
      for (let x = 21; x <= 24; x++) expect(g.isNode(x, y)).toBe(false)
    }
    // (20,22) sits next to the avenue tile (19,22) but does not connect to it
    expect(g.neighbours(g.index(20, 22))).not.toContain(g.index(19, 22))
    expect(g.neighbours(g.index(19, 23))).toContain(g.index(20, 23))
    expect(g.neighbours(g.index(20, 23))).toContain(g.index(19, 23))
  })
})
