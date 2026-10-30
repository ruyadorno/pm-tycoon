// plan-build2 §8.5 task 8 ("the policy's L3 window on seeds 1-10") and its
// acceptance; spec-build2 §7.2 L3 row, §7.3; design-m8-m9 §5.1, §7 M8 item 6:
// the competent policy over seeds 1-10 × 25 min reaches L3 on every seed with
// the L3 median inside economy.pacingTargets.level3Min, and the first
// overseas clearance lands ≤ firstOverseasClearedAfterLevel3MaxMin after L3
// by median; at L3 every seed buys the Battery checker on the L3 tick
// (REPLACEing COUNTERS' 2nd Metal detector) and then dock 2, in plan order;
// nothing past the M8 cap (no level:up {4}); the CLI invariants hold. Tagged
// [long]: excluded from `vlr check:quick` (tools/check.mjs), run by the full
// `vlr check`.

import { describe, expect, it } from 'vitest'
import { createPolicy } from '../../src/sim/policy.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import { median } from '../../tools/sim/report.ts'
import { dataFixture } from './helpers.ts'

const data = dataFixture()
const targets = data.economy.pacingTargets
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const MINUTES = 25

let cached: RunResult[] | null = null
/** The 10-seed × 25-min competent runs (computed once for this file). */
function runs(): RunResult[] {
  cached ??= SEEDS.map((seed) => runSeed(data, seed, MINUTES, createPolicy))
  return cached
}

describe('the L3 window under the competent policy (seeds 1-10 × 25 min) [long]', () => {
  it('every seed reaches L3; the median is inside level3Min', () => {
    const l3 = runs().map((r) => r.result.metrics.level3Min)
    for (const [i, m] of l3.entries()) {
      expect(m, `seed ${SEEDS[i]}`).not.toBeNull()
    }
    const [lo, hi] = targets.level3Min
    const med = median(l3)!
    expect(med).toBeGreaterThanOrEqual(lo)
    expect(med).toBeLessThanOrEqual(hi)
  }, 120_000)

  it('the first overseas clearance lands ≤ firstOverseasClearedAfterLevel3MaxMin after L3 (median); every seed clears overseas', () => {
    const m = runs().map((r) => r.result.metrics)
    for (const x of m) {
      expect(x.overseasCleared, `seed ${x.seed}`).toBeGreaterThan(0)
    }
    expect(
      median(m.map((x) => x.firstOverseasClearedAfterLevel3Min))!,
    ).toBeLessThanOrEqual(targets.firstOverseasClearedAfterLevel3MaxMin)
  }, 120_000)

  it('the plan at L3: the Battery checker on the L3 tick (REPLACE of the duplicate Metal detector), then dock 2; never a level past the cap', () => {
    for (const r of runs()) {
      const l3 = r.events.find((e) => e.name === 'level:up' && e.level === 3)!
      const placed = r.events.find(
        (e) =>
          e.name === 'lane:fixturePlaced' &&
          (e.fixture as { checker?: { defId?: string } }).checker?.defId ===
            'battery_checker',
      )
      expect(placed?.tick, `seed ${r.seed}`).toBe(l3.tick)
      const removed = r.events.filter(
        (e) => e.name === 'lane:fixtureRemoved' && e.tick === l3.tick,
      )
      expect(removed, `seed ${r.seed}`).toHaveLength(1)
      const dock = r.events.find((e) => e.name === 'dock:bought')
      expect(dock, `seed ${r.seed}`).toMatchObject({ index: 2 })
      expect(dock!.tick).toBeGreaterThan(l3.tick)
      expect(
        r.events.filter((e) => e.name === 'level:up').map((e) => e.level),
        `seed ${r.seed}`,
      ).toEqual([2, 3])
    }
  }, 120_000)

  it('every seed: the CLI invariants hold (conservation incl. cleared, no stuck vehicle, balance ≥ 0)', () => {
    for (const r of runs()) {
      expect(r.result.asserts, `seed ${r.seed}`).toEqual([])
      expect(r.conservation.ok, `seed ${r.seed}`).toBe(true)
    }
  }, 120_000)
})
