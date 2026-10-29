// Seeded PRNG (plan.md §6.4, spec §2): mulberry32 over ONE uint32 word that
// lives in the sim state (`state.rng`), so a snapshot resumes the exact
// stream. One stream for the whole sim; systems draw in tick-step order, so
// same seed + same commands = same run. Rendering never draws from it.

/** Where the state word lives (the SimState, or a box in tests). */
export interface RngCell {
  rng: number
}

/** Normalise a seed to the initial state word. */
export function seedWord(seed: number): number {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(`seed must be a safe integer, got ${seed}`)
  }
  return seed >>> 0
}

export class Rng {
  /** Resolved on every draw, so replacing sim.state keeps the stream. */
  readonly cell: () => RngCell

  constructor(cell: () => RngCell) {
    this.cell = cell
  }

  /** A standalone stream on its own cell (tests, tools). */
  static fromSeed(seed: number): Rng {
    const box: RngCell = { rng: seedWord(seed) }
    return new Rng(() => box)
  }

  /** Uniform float in [0, 1); advances the state word once. */
  next(): number {
    const cell = this.cell()
    const a = (cell.rng + 0x6d2b79f5) | 0
    cell.rng = a >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Integer in [0, n); one draw. */
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError(`int(n) needs a positive integer, got ${n}`)
    }
    return Math.floor(this.next() * n)
  }

  /** True with probability p; always exactly one draw (chance(0) false, chance(1) true). */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** Uniform element; one draw. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() from an empty array')
    return items[this.int(items.length)] as T
  }

  /**
   * Weighted pick. Weights ≤ 0 (or non-finite) are never picked. Returns null
   * without drawing when no item has a positive weight; otherwise one draw.
   */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T | null {
    const weights = items.map((it) => {
      const w = weightOf(it)
      return Number.isFinite(w) && w > 0 ? w : 0
    })
    let total = 0
    for (const w of weights) total += w
    if (total <= 0) return null
    const r = this.next() * total
    let acc = 0
    let last = -1
    for (let i = 0; i < items.length; i++) {
      const w = weights[i] as number
      if (w <= 0) continue
      acc += w
      last = i
      if (r < acc) return items[i] as T
    }
    return items[last] as T
  }
}
