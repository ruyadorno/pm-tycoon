// The drive graph (spec §3.1, §4.2; plan.md §6.4): the 4-connected avenue
// tiles of map.json minus the trimmed stretches over scenery (roadTiles()
// already applies the trimming), plus the warehouse lot's drivable tiles,
// which join the roads ONLY at the lot entrance (19, 23) — the lot is a
// dead-end pocket, so it is never a shortcut between two road tiles and road
// distances are those of the avenue graph alone. Locked regions' roads are
// routable for transit (§3.5). Built once per GameData, never serialised.

import { roadTiles } from '../data/index.ts'
import type { GameData } from '../data/types.ts'
import { anchorOf, mapIndex } from './map.ts'
import type { TileXY } from './types.ts'

export const NODE_NONE = 0
export const NODE_ROAD = 1
export const NODE_LOT = 2

/** Neighbour order (N, E, S, W) — fixed, so every search is deterministic. */
const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

export class RoadGraph {
  readonly w: number
  readonly h: number
  /** Per tile (index y·w + x): NODE_NONE | NODE_ROAD | NODE_LOT. */
  readonly kind: Uint8Array
  /** Road tiles, row-major. */
  readonly roads: readonly TileXY[]
  /** Drivable lot tiles. */
  readonly lot: readonly TileXY[]
  readonly entrance: TileXY
  readonly #entranceIdx: number

  constructor(data: GameData) {
    const [w, h] = data.map.size
    this.w = w
    this.h = h
    this.kind = new Uint8Array(w * h)
    this.roads = roadTiles(data.map).map(([x, y]) => ({ x, y }))
    for (const t of this.roads) this.kind[t.y * w + t.x] = NODE_ROAD
    const lot = mapIndex(data).lot
    this.lot = lot.drive
    for (const t of this.lot) {
      if (this.kind[t.y * w + t.x] === NODE_NONE) {
        this.kind[t.y * w + t.x] = NODE_LOT
      }
    }
    this.entrance = lot.entrance
    this.#entranceIdx = lot.entrance.y * w + lot.entrance.x
  }

  index(x: number, y: number): number {
    return y * this.w + x
  }

  #kindAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return NODE_NONE
    return this.kind[y * this.w + x] ?? NODE_NONE
  }

  isRoad(x: number, y: number): boolean {
    return this.#kindAt(x, y) === NODE_ROAD
  }

  isLot(x: number, y: number): boolean {
    return this.#kindAt(x, y) === NODE_LOT
  }

  isNode(x: number, y: number): boolean {
    return this.#kindAt(x, y) !== NODE_NONE
  }

  /**
   * Neighbour tile indices of node `i` in N, E, S, W order. Road–road and
   * lot–lot tiles connect; a road and a lot tile connect only through the
   * lot entrance.
   */
  neighbours(i: number): number[] {
    const x = i % this.w
    const y = (i - x) / this.w
    const k = this.#kindAt(x, y)
    const out: number[] = []
    if (k === NODE_NONE) return out
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      const nk = this.#kindAt(nx, ny)
      if (nk === NODE_NONE) continue
      const j = ny * this.w + nx
      if (nk === k || i === this.#entranceIdx || j === this.#entranceIdx) {
        out.push(j)
      }
    }
    return out
  }

  /** Node indices reachable from `start` (BFS). */
  reachable(start: TileXY): Set<number> {
    const seen = new Set<number>()
    if (!this.isNode(start.x, start.y)) return seen
    const s = this.index(start.x, start.y)
    const queue = [s]
    seen.add(s)
    for (let q = 0; q < queue.length; q++) {
      for (const j of this.neighbours(queue[q] as number)) {
        if (!seen.has(j)) {
          seen.add(j)
          queue.push(j)
        }
      }
    }
    return seen
  }

  /**
   * Boot validation (plan.md §6.4): the lot entrance and every building
   * anchor are road nodes, every road and lot tile is connected to the
   * entrance, and every dock / queue / parking tile is a lot node.
   */
  problems(data: GameData): string[] {
    const out: string[] = []
    const e = this.entrance
    if (!this.isRoad(e.x, e.y)) {
      out.push(`lot entrance (${e.x},${e.y}) is not a road tile`)
      return out
    }
    const seen = this.reachable(e)
    for (const t of [...this.roads, ...this.lot]) {
      if (!seen.has(this.index(t.x, t.y))) {
        out.push(`tile (${t.x},${t.y}) is not connected to the lot entrance`)
      }
    }
    for (const b of data.buildings) {
      const a = anchorOf(data, b.id)
      if (!this.isRoad(a.x, a.y)) {
        out.push(`${b.id}: anchor (${a.x},${a.y}) is not a road tile`)
      }
    }
    const lot = mapIndex(data).lot
    for (const t of [...lot.docks, ...lot.queue, ...lot.parking]) {
      if (!this.isLot(t.x, t.y)) {
        out.push(`lot tile (${t.x},${t.y}) is not drivable`)
      }
    }
    return out
  }
}

const cache = new WeakMap<GameData, RoadGraph>()

/** The graph for these data tables (built once; throws on a broken map). */
export function roadGraph(data: GameData): RoadGraph {
  const hit = cache.get(data)
  if (hit) return hit
  const g = new RoadGraph(data)
  const problems = g.problems(data)
  if (problems.length > 0) {
    throw new Error(`road graph: ${problems.slice(0, 10).join('; ')}`)
  }
  cache.set(data, g)
  return g
}
