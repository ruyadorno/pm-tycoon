// M4 robustness hunt, the long sweeps of the hostile players (plan.md
// §12.7): the bad player on 20 seeds and the rich chaos player on 10 seeds,
// 30 min each, under the invariant Monitor of tests/sim/robust.ts; JSON saves
// at random ticks and right after every hostile moment (walkouts, sells,
// lost lives, game over, desk removals, Clears, a full Hold Bay, mid-catch,
// relief, a driverless trip) continue identically for one in-game minute,
// and the whole command log replays to the same hash. ~35 s of CPU: tagged
// [long], excluded from `vlr check:quick` (tools/check.mjs), run by the full
// `vlr check`. Seeds 1-3 / 1-2 also run in robustness.test.ts.

import { describe, expect, it } from 'vitest'
import { replay, Sim, stateHash } from '../../src/sim/sim.ts'
import { TICKS_PER_DAY } from '../../src/sim/types.ts'
import { dataFixture } from './helpers.ts'
import {
  badPlayer,
  chaosPlayer,
  continuationProblems,
  hostileRun,
} from './robust.ts'

describe('[long] the bad player, 20 seeds × 30 min', () => {
  const data = dataFixture()
  const saved = new Set<string>()
  it.each(Array.from({ length: 20 }, (_, i) => i + 1))(
    'seed %i',
    (seed) => {
      const sim = new Sim(data, seed)
      const run = hostileRun(sim, badPlayer(seed), 30, seed, {
        allowPlayerStall: true,
      })
      for (const snap of run.snapshots) saved.add(snap.why)
      expect(run.monitor.problems).toEqual([])
      expect(continuationProblems(run, TICKS_PER_DAY)).toEqual([])
      const again = replay(data, seed, sim.commandLog, sim.state.tick)
      expect(stateHash(again.state)).toBe(stateHash(sim.state))
    },
    30_000,
  )

  it('…and between them a save landed on every awkward moment (Q-RUN1 relief: tests/sim/dispatcher.test.ts)', () => {
    for (const why of [
      'level:up',
      'worker:walkedOut',
      'driverless trip',
      'life:lost',
      'game:over',
      'vehicle:sold',
      'lane:fixtureRemoved',
      'parcel:cleared_by_player',
      'Hold Bay full',
      'mid-catch',
      'mid-process + held',
    ]) {
      expect(saved.has(why), why).toBe(true)
    }
  })
})

describe('[long] the chaos player, rich, 10 seeds × 30 min', () => {
  const rich = dataFixture({ economy: { startMoney: 20000 } })
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))(
    'seed %i',
    (seed) => {
      const sim = new Sim(rich, seed)
      const run = hostileRun(sim, chaosPlayer(seed), 30, seed, {
        allowPlayerStall: true,
        stuck: 'progress',
      })
      expect(run.monitor.problems).toEqual([])
      expect(continuationProblems(run, TICKS_PER_DAY)).toEqual([])
      const again = replay(rich, seed, sim.commandLog, sim.state.tick)
      expect(stateHash(again.state)).toBe(stateHash(sim.state))
    },
    30_000,
  )
})
