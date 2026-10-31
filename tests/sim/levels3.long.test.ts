// plan-build2 §8.5 task 8 ("the policy's L3 window on seeds 1-10") and its
// acceptance; spec-build2 §7.2 L3 row, §7.3; design-m8-m9 §5.1, §7 M8 item 6:
// the competent policy over seeds 1-10 × 25 min reaches L3 on every seed with
// the L3 median inside economy.pacingTargets.level3Min, and the first
// overseas clearance lands ≤ firstOverseasClearedAfterLevel3MaxMin after L3
// by median; at L3 every seed buys the Battery checker first (REPLACEing
// COUNTERS' 2nd Metal detector) and then dock 2, in plan order; the levels
// come in order (M9: the cap is 5, so L4 may land inside the 25 minutes —
// the L3 plan still comes first); the CLI invariants hold. Tagged [long]:
// excluded from `vlr check:quick` (tools/check.mjs), run by the full
// `vlr check`.
//
// Build 3 (M11, B3 §2.1-§2.2: L3 $3,700 → $3,250): the balance at L3 is
// thinner ($233-$390 on seven of seeds 1-10), so the Battery checker
// ($500, price + buffer) lands on the first tick the policy can afford it
// at or after L3 (21-96 s later), with nothing bought in between and the
// REPLACE on that tick. L4 can now arrive before dock 2 (seeds 7 and 8):
// NEW STRAIN FIRST (levelPlan.ts) then buys the X-ray ahead of dock 2,
// which may fall past the 25 minutes.
//
// Build 3, M12: SIM_FEATURES.events is on, but these are the pass-1 pacing
// runs (B3 §2.3, §3.9: the level rows gated "pass 1 with events off, pass 2
// on") — the decision draw stays off here until M14's pass 2 re-gates them
// with the deck (the M12 deck-on drift is in docs/status.md).

import { describe, expect, it } from 'vitest'
import { createPolicy } from '../../src/sim/policy.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import { median } from '../../tools/sim/report.ts'
import { dataFixture, withDecisions } from './helpers.ts'

const data = dataFixture()
const targets = data.economy.pacingTargets
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const MINUTES = 25

let cached: RunResult[] | null = null
/** The 10-seed × 25-min competent runs (computed once for this file). */
function runs(): RunResult[] {
  cached ??= withDecisions(false, () =>
    SEEDS.map((seed) => runSeed(data, seed, MINUTES, createPolicy)),
  )
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

  it('the plan at L3: the Battery checker first (on the first affordable tick at or after L3, nothing bought before it, the REPLACE of the duplicate Metal detector on its tick), then dock 2 before any L4 purchase — unless L4 lands first, when the X-ray goes ahead of it; the levels in order', () => {
    const BUYS = new Set([
      'lane:fixturePlaced',
      'dock:bought',
      'vehicle:bought',
    ])
    const isChecker = (e: RunResult['events'][number], id: string): boolean =>
      e.name === 'lane:fixturePlaced' &&
      (e.fixture as { checker?: { defId?: string } }).checker?.defId === id
    const late: string[] = []
    for (const r of runs()) {
      const l3 = r.events.find((e) => e.name === 'level:up' && e.level === 3)!
      const l4 = r.events.find((e) => e.name === 'level:up' && e.level === 4)
      const placed = r.events.find((e) => isChecker(e, 'battery_checker'))
      expect(placed, `seed ${r.seed}`).toBeDefined()
      expect(placed!.tick, `seed ${r.seed}`).toBeGreaterThanOrEqual(l3.tick)
      // Nothing else is bought between L3 and the Battery checker.
      expect(
        r.events
          .filter(
            (e) =>
              BUYS.has(e.name) && e.tick >= l3.tick && e.tick < placed!.tick,
          )
          .map((e) => [e.tick, e.name]),
        `seed ${r.seed}`,
      ).toEqual([])
      const removed = r.events.filter(
        (e) => e.name === 'lane:fixtureRemoved' && e.tick === placed!.tick,
      )
      expect(removed, `seed ${r.seed}`).toHaveLength(1)
      expect(removed[0]!.nodeId, `seed ${r.seed}`).toBe(placed!.nodeId)
      const dock = r.events.find((e) => e.name === 'dock:bought')
      const xray = r.events.find((e) => isChecker(e, 'xray'))
      const l4First =
        l4 !== undefined && (dock === undefined || l4.tick < dock.tick)
      if (dock !== undefined) {
        expect(dock, `seed ${r.seed}`).toMatchObject({ index: 2 })
        expect(dock.tick, `seed ${r.seed}`).toBeGreaterThan(placed!.tick)
      } else {
        // Dock 2 falls past the run only behind NEW STRAIN FIRST's X-ray.
        expect(l4First, `seed ${r.seed}: no dock 2 and no L4`).toBe(true)
      }
      if (l4First) late.push(`${r.seed}`)
      if (xray !== undefined) {
        expect(xray.tick, `seed ${r.seed}`).toBeGreaterThanOrEqual(l4!.tick)
        // M9: the L4 X-ray waits for the whole L3 plan (dock 2 included)
        // when dock 2 came before L4.
        if (!l4First)
          expect(xray.tick, `seed ${r.seed}`).toBeGreaterThan(dock!.tick)
      }
      const ups = r.events
        .filter((e) => e.name === 'level:up')
        .map((e) => e.level as number)
      expect(ups.slice(0, 2), `seed ${r.seed}`).toEqual([2, 3])
      expect(ups, `seed ${r.seed}`).toEqual(ups.map((_, i) => i + 2))
    }
    console.log(
      `[levels3] L4 before dock 2 (NEW STRAIN FIRST): seeds ${late.join(',') || 'none'}`,
    )
  }, 120_000)

  it('every seed: the CLI invariants hold (conservation incl. cleared, no stuck vehicle, balance ≥ 0)', () => {
    for (const r of runs()) {
      expect(r.result.asserts, `seed ${r.seed}`).toEqual([])
      expect(r.conservation.ok, `seed ${r.seed}`).toBe(true)
    }
  }, 120_000)
})
