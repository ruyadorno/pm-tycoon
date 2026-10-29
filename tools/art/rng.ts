// Seeded randomness for procedural art (style-guide.md §4.2: every drawer is
// seeded by mulberry32(hash(id)) so rebuilds are byte-identical). Never use
// Math.random in tools/art drawers.

export interface Rng {
  /** uniform float in [0, 1) */
  next(): number
  /** integer in [lo, hi] inclusive */
  int(lo: number, hi: number): number
  /** one element of a non-empty array */
  pick<T>(items: readonly T[]): T
  /** true with probability p */
  chance(p: number): boolean
  /** a child stream, independent of later calls on this one */
  fork(label: string): Rng
}

/** FNV-1a 32-bit hash of a string (stable across platforms and runs). */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(seed)
  const rng: Rng = {
    next,
    int(lo, hi) {
      return lo + Math.floor(next() * (hi - lo + 1))
    },
    pick(items) {
      if (items.length === 0) throw new Error('rng.pick: empty array')
      return items[Math.floor(next() * items.length)] as (typeof items)[number]
    },
    chance(p) {
      return next() < p
    },
    fork(label) {
      return makeRng(hash(`${seed}:${label}`))
    },
  }
  return rng
}

/** The seeded stream for a manifest id: mulberry32(hash(id)). */
export function rngFor(id: string): Rng {
  return makeRng(hash(id))
}
