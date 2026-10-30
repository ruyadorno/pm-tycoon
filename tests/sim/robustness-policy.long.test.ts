// M4 robustness hunt, the long sweep of the §7 policy (plan.md §12.7, §6.9.2):
// 20 seeds × 90 min (the 60-min checkpoint included) under the invariant
// Monitor of tests/sim/robust.ts (the cross-reference scan every 10 ticks,
// money / lives / caps / stuck every tick, auditState every 600 ticks); JSON
// saves at random ticks, the level-up, the first flag, lost lives, game over,
// a full Hold Bay, mid-catch and mid-process continue identically for two
// in-game minutes; every 10th seed's whole log replays to the same hash.
// ~40 s of CPU: tagged [long], excluded from `vlr check:quick` like
// policy.test.ts (tools/check.mjs), run by the full `vlr check`.
// Build 2, M6 (spec-build2 §7.2; design-m6 §5.2, §4.9 "saves mid-state"):
// the `delegating` policy — a sorter hired at L2 who takes over the Hold Bay
// — 5 seeds × 60 min under the same Monitor, with saves while the sorter's
// clock runs and while a tagged parcel waits, continuing identically.
// Build 2, M8: both sweeps end at the playtest cap (L3 — the plan's Battery
// checker REPLACE, dock 2, a van and a 2nd truck in the run). M9: the cap is
// the top level (5) — the competent sweep runs L4-L5 (X-ray, dock 3, the
// Sorter Arm, the Golden Release, endless mode); the delegating sweep ends
// at L4 or L5 by 60 min (asserted ≥ L4). Both use the CLI's stuck rule
// (stuck 'progress'): on the L4-L5 map a truck's 12-stop delivering leg
// keeps it in one state for more than 120 s while it still drives.

import { describe, expect, it } from 'vitest'
import { createPolicy } from '../../src/sim/policy.ts'
import { replay, Sim, stateHash } from '../../src/sim/sim.ts'
import { laneNode, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { dataFixture } from './helpers.ts'
import {
  continuationProblems,
  midCatch,
  midProcessAndHeld,
  policyPlayer,
  randomTicks,
  recordRun,
} from './robust.ts'

const data = dataFixture()

describe('[long] the §7 policy, 20 seeds × 90 min: every invariant holds; saves continue identically', () => {
  it.each(Array.from({ length: 20 }, (_, i) => i + 1))(
    'seed %i',
    (seed) => {
      const sim = new Sim(data, seed)
      const run = recordRun(sim, policyPlayer(sim), 90, {
        at: randomTicks(seed, 90, 3),
        onEvent: ['level:up', 'parcel:flagged', 'life:lost', 'game:over'],
        when: [
          {
            why: 'Hold Bay full',
            test: (s) => s.state.lane.stallReason === 'holdBayFull',
          },
          { why: 'mid-catch', test: midCatch },
          { why: 'mid-process + held', test: midProcessAndHeld },
        ],
        monitor: { every: 10, stuck: 'progress' },
      })
      expect(run.monitor.problems).toEqual([])
      const s = sim.state
      expect(s.tick).toBe(90 * TICKS_PER_DAY)
      expect(s.level.level).toBe(data.economy.playtestMaxLevel) // M9: L5
      expect(s.stats.minutes).toHaveLength(90)
      // The 60-minute checkpoint.
      const at60 = s.stats.minutes[59]!
      expect(at60.money).toBeGreaterThanOrEqual(0)
      expect(at60.lives).toBeGreaterThanOrEqual(0)
      expect(at60.deliv).toBeGreaterThan(300)
      expect(continuationProblems(run)).toEqual([])
      if (seed % 10 === 0) {
        const again = replay(data, seed, sim.commandLog, s.tick)
        expect(stateHash(again.state)).toBe(stateHash(s))
      }
    },
    30_000,
  )
})

/** A held parcel the sorter tagged `looks clean` waits in the Hold Bay. */
const taggedHeld = (sim: Sim): boolean => {
  const st = sim.state
  const hold = laneNode(st.lane, st.lane.holdBayNodeId)
  return (hold?.queue ?? []).some(
    (id) => st.parcels[String(id)]?.sorted !== undefined,
  )
}

describe('[long] the delegating policy, 5 seeds × 60 min: every invariant holds with a sorter on the station; saves mid-call continue identically', () => {
  it.each([1, 2, 3, 4, 5])(
    'seed %i',
    (seed) => {
      const sim = new Sim(data, seed)
      const policy = createPolicy(sim, 'delegating')
      const run = recordRun(
        sim,
        { name: 'delegating', step: () => policy.step() },
        60,
        {
          at: randomTicks(seed, 60, 2),
          onEvent: ['level:up', 'sorter:decided', 'life:lost', 'game:over'],
          when: [
            {
              why: 'sorter clock running',
              test: (s) => s.state.lane.holdStation.nextDecisionTick !== null,
            },
            { why: 'tagged parcel held', test: taggedHeld },
          ],
          monitor: { every: 10, stuck: 'progress' },
        },
      )
      expect(run.monitor.problems).toEqual([])
      const s = sim.state
      expect(s.tick).toBe(60 * TICKS_PER_DAY)
      expect(s.level.level).toBeGreaterThanOrEqual(4) // M9: L4-L5 by 60 min
      // The policy hired one sorter at L2 and never fires, so it holds the station.
      const sorters = s.employees.filter((e) => e.role === 'sorter')
      expect(sorters).toHaveLength(1)
      expect(s.lane.holdStation.fixture).toBe(sorters[0]!.id)
      expect(
        run.snapshots.map((x) => x.why),
        'a save while the sorter decides',
      ).toContain('sorter clock running')
      expect(continuationProblems(run)).toEqual([])
      if (seed === 5) {
        const again = replay(data, seed, sim.commandLog, s.tick)
        expect(stateHash(again.state)).toBe(stateHash(s))
      }
    },
    30_000,
  )
})
