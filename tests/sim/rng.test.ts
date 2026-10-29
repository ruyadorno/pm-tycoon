// plan.md §6.4 "PRNG and determinism" / spec §2: mulberry32 over one state
// word stored in SimState; one stream; same seed → same stream.

import { describe, expect, it } from 'vitest'
import { Rng, seedWord } from '../../src/sim/rng.ts'
import type { RngCell } from '../../src/sim/rng.ts'
import { makeSim } from './helpers.ts'

const take = (rng: Rng, n: number): number[] =>
  Array.from({ length: n }, () => rng.next())

describe('rng (mulberry32, plan.md §6.4)', () => {
  it("known answer: seed 1's first three values", () => {
    expect(take(Rng.fromSeed(1), 3)).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ])
  })

  it('the stream lives in state.rng (the Sim draws the same known answer)', () => {
    const sim = makeSim(1)
    expect(sim.state.rng).toBe(1)
    expect(sim.rng.next()).toBe(0.6270739405881613)
    expect(sim.state.rng).not.toBe(1)
    // A snapshot of the word resumes the exact stream.
    const box: RngCell = { rng: sim.state.rng }
    const resumed = new Rng(() => box)
    expect(take(resumed, 5)).toEqual(take(sim.rng, 5))
  })

  it('same seed, same stream; different seeds differ', () => {
    expect(take(Rng.fromSeed(42), 1000)).toEqual(take(Rng.fromSeed(42), 1000))
    expect(take(Rng.fromSeed(1), 20)).not.toEqual(take(Rng.fromSeed(2), 20))
  })

  it('next() is uniform-ish in [0, 1)', () => {
    const xs = take(Rng.fromSeed(7), 10_000)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThan(1)
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean).toBeGreaterThan(0.48)
    expect(mean).toBeLessThan(0.52)
  })

  it('weighted never picks a zero (or negative / NaN) weight', () => {
    const rng = Rng.fromSeed(3)
    const items = ['zero', 'one', 'neg', 'three', 'nan'] as const
    const w = { zero: 0, one: 1, neg: -5, three: 3, nan: Number.NaN }
    const counts: Record<string, number> = {}
    for (let i = 0; i < 10_000; i++) {
      const got = rng.weighted(items, (x) => w[x]) as string
      counts[got] = (counts[got] ?? 0) + 1
    }
    expect(Object.keys(counts).toSorted()).toEqual(['one', 'three'])
    const ratio = (counts.three ?? 0) / (counts.one ?? 1)
    expect(ratio).toBeGreaterThan(2.7)
    expect(ratio).toBeLessThan(3.3)
  })

  it('weighted with no positive weight returns null without drawing', () => {
    const box: RngCell = { rng: seedWord(9) }
    const rng = new Rng(() => box)
    expect(rng.weighted(['a', 'b'], () => 0)).toBeNull()
    expect(rng.weighted([], () => 1)).toBeNull()
    expect(box.rng).toBe(9)
  })

  it('int / chance / pick draw exactly once and respect their bounds', () => {
    const box: RngCell = { rng: seedWord(11) }
    const rng = new Rng(() => box)
    const ref = Rng.fromSeed(11)
    for (let i = 0; i < 200; i++) {
      const n = rng.int(6)
      expect(Number.isInteger(n) && n >= 0 && n < 6).toBe(true)
      expect(n).toBe(Math.floor(ref.next() * 6))
    }
    expect(rng.chance(0)).toBe(false)
    expect(rng.chance(1)).toBe(true)
    ref.next()
    ref.next()
    expect(rng.pick(['x', 'y', 'z'])).toBe(
      ['x', 'y', 'z'][Math.floor(ref.next() * 3)],
    )
    expect(rng.next()).toBe(ref.next())
    expect(() => rng.int(0)).toThrow(RangeError)
    expect(() => rng.pick([])).toThrow(RangeError)
  })

  it('seeds must be safe integers; negatives wrap to uint32', () => {
    expect(seedWord(-1)).toBe(0xffffffff)
    expect(() => seedWord(1.5)).toThrow(RangeError)
    expect(() => makeSim(Number.NaN)).toThrow(RangeError)
  })
})
