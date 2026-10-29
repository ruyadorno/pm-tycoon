// spec §4.2 / plan.md §6.4 astar.ts: hand-rolled A* (Manhattan heuristic),
// inclusive paths cached per (from, to); road distance = path length − 1;
// trimmed tiles are never on a path.

import { describe, expect, it } from 'vitest'
import { isTrimmedTile } from '../../src/data/index.ts'
import { NoPathError, Pathfinder, pathfinder } from '../../src/sim/astar.ts'
import { roadGraph } from '../../src/sim/roads.ts'
import { dataFixture } from './helpers.ts'

const data = dataFixture()

const steps = (p: readonly { x: number; y: number }[]): boolean =>
  p.every(
    (t, i) =>
      i === 0 ||
      Math.abs(t.x - p[i - 1]!.x) + Math.abs(t.y - p[i - 1]!.y) === 1,
  )

describe('A* paths (spec §4.2)', () => {
  it('straight line along an avenue: inclusive, 4-connected, length = tiles + 1', () => {
    const pf = new Pathfinder(roadGraph(data))
    const p = pf.path({ x: 19, y: 23 }, { x: 19, y: 29 })
    expect(p).toHaveLength(7)
    expect(p[0]).toEqual({ x: 19, y: 23 })
    expect(p.at(-1)).toEqual({ x: 19, y: 29 })
    expect(p.every((t) => t.x === 19)).toBe(true)
    expect(pf.distance({ x: 19, y: 23 }, { x: 19, y: 29 })).toBe(6)
  })

  it('around the lake: (27,43) → (43,27) is 32 tiles and never touches the lake or a trimmed tile', () => {
    const pf = new Pathfinder(roadGraph(data))
    const p = pf.path({ x: 27, y: 43 }, { x: 43, y: 27 })
    expect(p.length - 1).toBe(32)
    expect(steps(p)).toBe(true)
    for (const t of p) {
      expect(isTrimmedTile(data.map, t.x, t.y)).toBe(false)
      const inLake = t.x >= 28 && t.x <= 42 && t.y >= 36 && t.y <= 42
      expect(inLake).toBe(false)
    }
  })

  it('the lot pocket forces the detour through the entrance: dock bay (20,22) → (19,22) is 3 steps', () => {
    const pf = new Pathfinder(roadGraph(data))
    const p = pf.path({ x: 20, y: 22 }, { x: 19, y: 22 })
    expect(p).toEqual([
      { x: 20, y: 22 },
      { x: 20, y: 23 },
      { x: 19, y: 23 },
      { x: 19, y: 22 },
    ])
  })

  it('cache hit on the second call (same array instance)', () => {
    const pf = new Pathfinder(roadGraph(data))
    const a = pf.path({ x: 3, y: 3 }, { x: 43, y: 19 })
    expect(pf.misses).toBe(1)
    const b = pf.path({ x: 3, y: 3 }, { x: 43, y: 19 })
    expect(pf.hits).toBe(1)
    expect(b).toBe(a)
    expect(pathfinder(data)).toBe(pathfinder(data))
  })

  it('no path through trimmed tiles: a trimmed tile is not routable', () => {
    const pf = new Pathfinder(roadGraph(data))
    expect(() => pf.path({ x: 19, y: 23 }, { x: 35, y: 40 })).toThrow(
      NoPathError,
    )
    expect(pf.distance({ x: 19, y: 23 }, { x: 43, y: 30 })).toBe(
      Number.POSITIVE_INFINITY,
    )
  })

  it('road distance (BFS field) = A* path length − 1 for every anchor pair from the entrance and two hubs', () => {
    const pf = new Pathfinder(roadGraph(data))
    const sources = [
      { x: 19, y: 23 },
      { x: 3, y: 29 },
      { x: 43, y: 25 },
    ]
    for (const from of sources) {
      for (const b of data.buildings) {
        const to = { x: b.anchor[0], y: b.anchor[1] }
        const p = pf.path(from, to)
        expect(steps(p)).toBe(true)
        expect(pf.distance(from, to)).toBe(p.length - 1)
        // Manhattan heuristic is a lower bound
        expect(p.length - 1).toBeGreaterThanOrEqual(
          Math.abs(from.x - to.x) + Math.abs(from.y - to.y),
        )
      }
    }
  })
})
