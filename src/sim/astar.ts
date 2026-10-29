// Hand-rolled A* over the drive graph (spec §4.2, plan.md §6.4): Manhattan
// heuristic, binary heap, inclusive tile paths cached per "x,y>x,y" pair
// (lazy, never serialised). Road distance = path length − 1 (§4.2); the
// dispatcher's "nearest" queries read it from a BFS distance field cached per
// source tile, which on this unit-weight graph equals the A* path length − 1
// exactly (tests/sim/astar.test.ts pins the equality). Ties in the heap break
// on h, then insertion order, so every path is deterministic.

import { roadGraph, type RoadGraph } from './roads.ts'
import type { GameData } from '../data/types.ts'
import type { TileXY } from './types.ts'

/** Min-heap of node indices keyed by (f, h, seq). */
class NodeHeap {
  readonly #ids: number[] = []
  readonly #f: number[] = []
  readonly #h: number[] = []
  readonly #seq: number[] = []
  #n = 0

  get size(): number {
    return this.#ids.length
  }

  #less(a: number, b: number): boolean {
    const fa = this.#f[a] as number
    const fb = this.#f[b] as number
    if (fa !== fb) return fa < fb
    const ha = this.#h[a] as number
    const hb = this.#h[b] as number
    if (ha !== hb) return ha < hb
    return (this.#seq[a] as number) < (this.#seq[b] as number)
  }

  #swap(a: number, b: number): void {
    for (const arr of [this.#ids, this.#f, this.#h, this.#seq]) {
      const t = arr[a] as number
      arr[a] = arr[b] as number
      arr[b] = t
    }
  }

  push(id: number, f: number, h: number): void {
    this.#ids.push(id)
    this.#f.push(f)
    this.#h.push(h)
    this.#seq.push(this.#n++)
    let i = this.#ids.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.#less(i, p)) break
      this.#swap(i, p)
      i = p
    }
  }

  pop(): number {
    const top = this.#ids[0] as number
    const last = this.#ids.length - 1
    this.#swap(0, last)
    this.#ids.pop()
    this.#f.pop()
    this.#h.pop()
    this.#seq.pop()
    let i = 0
    const n = this.#ids.length
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < n && this.#less(l, m)) m = l
      if (r < n && this.#less(r, m)) m = r
      if (m === i) break
      this.#swap(i, m)
      i = m
    }
    return top
  }
}

export class NoPathError extends Error {}

export class Pathfinder {
  readonly graph: RoadGraph
  readonly #paths = new Map<string, readonly TileXY[]>()
  readonly #fields = new Map<number, Int32Array>()
  /** Cache counters (tests / perf). */
  hits = 0
  misses = 0

  constructor(graph: RoadGraph) {
    this.graph = graph
  }

  /**
   * Inclusive tile path from → to (both drive-graph nodes); cached and shared,
   * so callers copy before storing it in state. Throws NoPathError when `to`
   * is unreachable or either end is off the graph.
   */
  path(from: TileXY, to: TileXY): readonly TileXY[] {
    const key = `${from.x},${from.y}>${to.x},${to.y}`
    const hit = this.#paths.get(key)
    if (hit) {
      this.hits += 1
      return hit
    }
    this.misses += 1
    const p = this.#search(from, to)
    this.#paths.set(key, p)
    return p
  }

  /** Road distance in tiles (path length − 1); Infinity when unreachable. */
  distance(from: TileXY, to: TileXY): number {
    const g = this.graph
    if (!g.isNode(to.x, to.y)) return Number.POSITIVE_INFINITY
    const d = this.field(from)[g.index(to.x, to.y)] ?? -1
    return d < 0 ? Number.POSITIVE_INFINITY : d
  }

  /** BFS distance field from `from` (−1 = unreachable), cached per source. */
  field(from: TileXY): Int32Array {
    const g = this.graph
    const s = g.index(from.x, from.y)
    const hit = this.#fields.get(s)
    if (hit) return hit
    const dist = new Int32Array(g.w * g.h).fill(-1)
    if (g.isNode(from.x, from.y)) {
      dist[s] = 0
      const queue = [s]
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q] as number
        const di = dist[i] as number
        for (const j of g.neighbours(i)) {
          if (dist[j] === -1) {
            dist[j] = di + 1
            queue.push(j)
          }
        }
      }
    }
    this.#fields.set(s, dist)
    return dist
  }

  #search(from: TileXY, to: TileXY): readonly TileXY[] {
    const g = this.graph
    if (!g.isNode(from.x, from.y) || !g.isNode(to.x, to.y)) {
      throw new NoPathError(
        `no path (${from.x},${from.y}) → (${to.x},${to.y}): off the drive graph`,
      )
    }
    const start = g.index(from.x, from.y)
    const goal = g.index(to.x, to.y)
    if (start === goal) return [{ x: from.x, y: from.y }]
    const n = g.w * g.h
    const gScore = new Int32Array(n).fill(-1)
    const came = new Int32Array(n).fill(-1)
    const closed = new Uint8Array(n)
    const hOf = (i: number): number => {
      const x = i % g.w
      return Math.abs(x - to.x) + Math.abs((i - x) / g.w - to.y)
    }
    const open = new NodeHeap()
    gScore[start] = 0
    open.push(start, hOf(start), hOf(start))
    while (open.size > 0) {
      const i = open.pop()
      if (closed[i]) continue
      if (i === goal) break
      closed[i] = 1
      const gi = gScore[i] as number
      for (const j of g.neighbours(i)) {
        if (closed[j]) continue
        const gj = gi + 1
        const old = gScore[j] as number
        if (old !== -1 && old <= gj) continue
        gScore[j] = gj
        came[j] = i
        const h = hOf(j)
        open.push(j, gj + h, h)
      }
    }
    if (gScore[goal] === -1) {
      throw new NoPathError(
        `no path (${from.x},${from.y}) → (${to.x},${to.y}): unreachable`,
      )
    }
    const back: TileXY[] = []
    for (let i = goal; i !== -1; i = came[i] as number) {
      const x = i % g.w
      back.push({ x, y: (i - x) / g.w })
      if (i === start) break
    }
    return back.toReversed()
  }
}

const cache = new WeakMap<GameData, Pathfinder>()

/** One shared pathfinder per data tables (paths are pure functions of the map). */
export function pathfinder(data: GameData): Pathfinder {
  const hit = cache.get(data)
  if (hit) return hit
  const p = new Pathfinder(roadGraph(data))
  cache.set(data, p)
  return p
}
