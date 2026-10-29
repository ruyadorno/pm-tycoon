// Seeded PRNG for the arranger, the SFX renders and the brush buffers (pure; never Math.random).

/** mulberry32: 32-bit state, uniform floats in [0, 1). */
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

/** Independent stream per purpose: FNV-1a of the label mixed into the seed. */
export function deriveSeed(seed: number, label: string): number {
  let h = 0x811c9dc5 ^ (seed >>> 0)
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function stream(seed: number, label: string): () => number {
  return mulberry32(deriveSeed(seed, label))
}

/** Uniform in [-amount, amount]. */
export function jitter(rng: () => number, amount: number): number {
  return (rng() * 2 - 1) * amount
}

/** Triangular in [-amount, amount] (sum of two uniforms): most offsets small, a few near the edge. */
export function humanize(rng: () => number, amount: number): number {
  return (rng() + rng() - 1) * amount
}

/** Integer in [lo, hi]. */
export function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1))
}

export function pickWeighted<T>(
  rng: () => number,
  items: readonly T[],
  weights: readonly number[],
): T {
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] as number
    if (r < 0) return items[i] as T
  }
  return items[items.length - 1] as T
}
