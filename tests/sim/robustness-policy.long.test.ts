// M4 robustness hunt, the long sweep of the §7 policy (plan.md §12.7, §6.9.2):
// 20 seeds × 90 min (the 60-min checkpoint included) under the invariant
// Monitor of tests/sim/robust.ts (the cross-reference scan every 10 ticks,
// money / lives / caps / stuck every tick, auditState every 600 ticks); JSON
// saves at random ticks, the level-up, the first flag, lost lives, game over,
// a full Hold Bay, mid-catch and mid-process continue identically for two
// in-game minutes; every 10th seed's whole log replays to the same hash.
// ~40 s of CPU: tagged [long], excluded from `vlr check:quick` like
// policy.test.ts (tools/check.mjs), run by the full `vlr check`.

import { describe, expect, it } from 'vitest'
import { replay, Sim, stateHash } from '../../src/sim/sim.ts'
import { TICKS_PER_DAY } from '../../src/sim/types.ts'
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
        monitor: { every: 10 },
      })
      expect(run.monitor.problems).toEqual([])
      const s = sim.state
      expect(s.tick).toBe(90 * TICKS_PER_DAY)
      expect(s.level.level).toBe(2)
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
