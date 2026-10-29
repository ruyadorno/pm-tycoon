// plan.md §6.4 PRNG and determinism: one rng stream, defined iteration order,
// integer money — two sims with the same seed and command log produce the
// identical state hash every in-game minute for 30 minutes; a replay of the
// log reproduces the run; different seeds differ.

import { describe, expect, it } from 'vitest'
import { createPolicy } from '../../src/sim/policy.ts'
import { replay, Sim, stateHash } from '../../src/sim/sim.ts'
import { TICKS_PER_DAY } from '../../src/sim/types.ts'
import { dataFixture } from './helpers.ts'

const MINUTES = 30

/** Policy-driven run; the state hash at every minute boundary. */
function hashes(seed: number): { sim: Sim; perMinute: string[] } {
  const sim = new Sim(dataFixture(), seed)
  const policy = createPolicy(sim, 'competent')
  const perMinute: string[] = []
  for (let i = 0; i < MINUTES * TICKS_PER_DAY; i++) {
    policy.step()
    sim.tick()
    if (sim.state.tick % TICKS_PER_DAY === 0)
      perMinute.push(stateHash(sim.state))
  }
  return { sim, perMinute }
}

describe('determinism (plan.md §6.4)', () => {
  it('same seed + same command log → identical state hash each minute for 30 min; the replay matches', () => {
    const a = hashes(7)
    const b = hashes(7)
    expect(a.perMinute).toHaveLength(MINUTES)
    expect(b.perMinute).toEqual(a.perMinute)
    expect(b.sim.commandLog).toEqual(a.sim.commandLog)
    expect(a.sim.state.stats.deliveries).toBeGreaterThan(100)
    const again = replay(a.sim.data, 7, a.sim.commandLog, a.sim.state.tick)
    expect(stateHash(again.state)).toBe(a.perMinute.at(-1))
    // money is integer throughout
    for (const row of a.sim.state.stats.minutes) {
      expect(Number.isInteger(row.money)).toBe(true)
      expect(Number.isInteger(row.earned)).toBe(true)
    }
  }, 60_000)

  it('different seeds differ', () => {
    const a = hashes(1).perMinute
    const b = hashes(2).perMinute
    expect(a[0]).not.toBe(b[0])
    expect(a.at(-1)).not.toBe(b.at(-1))
  }, 60_000)
})
