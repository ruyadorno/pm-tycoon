// plan.md §6.4 PRNG and determinism: one rng stream, defined iteration order,
// integer money — two sims with the same seed and command log produce the
// identical state hash every in-game minute for 30 minutes; a replay of the
// log reproduces the run; different seeds differ; (M8) an L3 game — forced
// level, dock 2, overseas hand-offs and clearances — replays to the same
// hash.

import { describe, expect, it } from 'vitest'
import { createPolicy } from '../../src/sim/policy.ts'
import { replay, Sim, stateHash } from '../../src/sim/sim.ts'
import type { Command } from '../../src/sim/commands.ts'
import { liveSlotIds, laneNode, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { answerCards, dataFixture, firstApplicant } from './helpers.ts'

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

  it('an L3 replay (debugForceLevel, buyDock, pool hires, a Toss-everything player; overseas hand-offs and clearances) reproduces the state hash', () => {
    // A rich start (the replay runs on the same tables) so the fleet grows.
    const data = dataFixture({ economy: { startMoney: 20_000 } })
    const sim = new Sim(data, 11)
    const run = (cmd: Command): void => {
      const res = sim.dispatch(cmd)
      if (!res.ok) throw new Error(`${cmd.kind}: ${res.reason}`)
    }
    run({ kind: 'debugForceLevel', level: 3 })
    run({ kind: 'debugFillHoldBay' })
    const handed: number[] = []
    const cleared: number[] = []
    sim.events.on('parcel:handedOff', (e) => handed.push(e.id))
    sim.events.on('parcel:cleared', (e) => cleared.push(e.id))
    for (let i = 0; i < 20 * TICKS_PER_DAY; i++) {
      const s = sim.state
      // Commands between ticks (logged; the replay re-dispatches them).
      if (i % 50 === 0) {
        const hold = laneNode(s.lane, s.lane.holdBayNodeId)
        for (const id of hold?.queue.slice() ?? []) {
          run({ kind: 'toss', parcelId: id })
        }
        const owned = s.vehicles.length
        const type = owned % 2 === 0 ? 'bike' : 'van'
        const price = data.vehicles.types.find((t) => t.id === type)!.price
        if (owned < 4 && s.economy.balance >= price + 200) {
          run({
            kind: 'buyVehicle',
            type,
            applicantId: firstApplicant(sim, 'driver').id,
          })
        }
        if (s.lane.docks.length === 1 && s.economy.balance >= 1200) {
          run({ kind: 'buyDock', index: 2 })
        }
        const empty = liveSlotIds(s.lane).find(
          (id) => laneNode(s.lane, id)?.fixture === null,
        )
        if (empty && s.economy.balance >= 1500 && s.lane.docks.length > 1) {
          run({ kind: 'buyMachine', defId: 'battery_checker', nodeId: empty })
        }
      }
      // Build 3: a job card would hold this policy-less run (B3 §6) —
      // decline it (a logged decideEvent, so the replay answers it too).
      answerCards(sim, 'default')
      sim.tick()
    }
    expect(sim.state.lane.docks.map((d) => d.id)).toEqual(['dock1', 'dock2'])
    expect(handed.length).toBeGreaterThan(5)
    expect(cleared.length).toBeGreaterThan(3)
    expect(sim.state.stats.cleared).toBe(cleared.length)
    const again = replay(data, 11, sim.commandLog, sim.state.tick)
    expect(again.state.stats.cleared).toBe(cleared.length)
    expect(stateHash(again.state)).toBe(stateHash(sim.state))
  }, 60_000)
})
