// The `vlr shots` fixtures under tests/fixtures/ (plan.md §6.9.3, §12.5 task
// 11): each one loads under the shipped data hash (a stale fixture is
// refused by __pm.load, so `vlr check` catches it before `vlr shots` does)
// and still holds the scenario its shot needs. Regenerate with
// `node tools/fixtures/late-waiting.ts` / `node tools/fixtures/warehouse.ts`.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createPolicy } from '../../src/sim/policy.ts'
import { replay, Sim, stateHash } from '../../src/sim/sim.ts'
import { laneNode, TICKS_PER_S } from '../../src/sim/types.ts'
import { collect, dataFixture } from '../sim/helpers.ts'

interface Fixture {
  dataHash: string
  fixture: Record<string, unknown> & { name: string; regenerate: string }
}

function read(name: string): { text: string; fx: Fixture } {
  const text = readFileSync(
    new URL(`../fixtures/${name}.json`, import.meta.url),
    'utf8',
  )
  return { text, fx: JSON.parse(text) as Fixture }
}

function load(name: string): { sim: Sim; fx: Fixture } {
  const { text, fx } = read(name)
  return { sim: Sim.load(dataFixture(), JSON.parse(text)), fx }
}

/** Run `s` seconds the way ?policy=1 does (policy.step() before each tick). */
function withPolicy(sim: Sim, s: number, stop?: () => boolean): void {
  const policy = createPolicy(sim, 'competent')
  for (let i = 0; i < Math.round(s * TICKS_PER_S); i++) {
    if (stop?.()) break
    policy.step()
    sim.tick()
  }
  policy.dispose?.()
}

describe('shot fixtures load under the shipped data hash', () => {
  for (const name of [
    'late-waiting',
    'holdbay-full',
    'malware-cleared',
    'one-life',
  ]) {
    it(`${name}.json is current (else: its fixture.regenerate)`, () => {
      const { fx } = read(name)
      expect(fx.dataHash, fx.fixture.regenerate).toBe(dataFixture().hash)
      expect(() => load(name)).not.toThrow()
    })
  }
})

describe('the M2 fixtures are plain runs (seed + command log, no state patching)', () => {
  for (const name of ['holdbay-full', 'malware-cleared', 'one-life']) {
    it(`${name}.json replays to the same state hash`, () => {
      const { sim } = load(name)
      const again = replay(
        dataFixture(),
        sim.state.seed,
        sim.commandLog,
        sim.state.tick,
      )
      expect(stateHash(again.state)).toBe(stateHash(sim.state))
    })
  }
})

describe('holdbay-full: a full Hold Bay stalls the slot holding the next flag (§6.4, §6.6)', () => {
  it('is stalled on holdBayFull with the bay at cap and a flagged parcel waiting in its slot', () => {
    const { sim, fx } = load('holdbay-full')
    const lane = sim.state.lane
    const hold = laneNode(lane, lane.holdBayNodeId)!
    expect(lane.stalled).toBe(true)
    expect(lane.stallReason).toBe('holdBayFull')
    expect(lane.stallNodeId).toBe(fx.fixture.stallNodeId)
    expect(hold.queue.length).toBe(hold.cap)
    const p = sim.state.parcels[String(fx.fixture.waitingParcelId)]!
    expect(p.state).toBe('in_slot')
    expect(p.nodeId).toBe(fx.fixture.stallNodeId)
    expect(p.flaggedBy).not.toBeNull()
  })

  it('a Toss frees a bay and the waiting parcel diverts on the next tick (lane:resumed)', () => {
    const { sim, fx } = load('holdbay-full')
    const lane = sim.state.lane
    const hold = laneNode(lane, lane.holdBayNodeId)!
    const resumed = collect(sim, 'lane:resumed')
    expect(sim.dispatch({ kind: 'toss', parcelId: hold.queue[0]! }).ok).toBe(
      true,
    )
    sim.tick()
    expect(resumed.length).toBe(1)
    const p = sim.state.parcels[String(fx.fixture.waitingParcelId)]!
    expect(p.state).toBe('held')
  })
})

describe('malware-cleared: a cleared malware parcel costs a life on delivery (§6.6, §10)', () => {
  it('holds the cleared malware on the shelf, 3 lives', () => {
    const { sim, fx } = load('malware-cleared')
    const p = sim.state.parcels[String(fx.fixture.parcelId)]!
    expect(p.malware).toBe(true)
    expect(p.state).toBe('on_shelf')
    expect(p.trace.some((e) => e.what === 'cleared')).toBe(true)
    expect(sim.state.economy.lives).toBe(3)
  })

  it('under ?policy=1 life:lost lands at fixture.lifeLostInS, "cleared by you"', () => {
    const { sim, fx } = load('malware-cleared')
    const lost = collect(sim, 'life:lost')
    const t0 = sim.state.tick
    withPolicy(sim, 120, () => lost.length > 0)
    expect(lost.length).toBe(1)
    expect(lost[0]!.parcelId).toBe(fx.fixture.parcelId)
    expect(lost[0]!.clearedByPlayerAt).toBe(fx.fixture.clearedAtTick)
    expect((sim.state.tick - t0) / TICKS_PER_S).toBe(fx.fixture.lifeLostInS)
    expect(sim.state.economy.lives).toBe(2)
  })
})

describe('one-life: the third malware delivery ends the game (§10)', () => {
  it('has 1 life and the cleared malware on the shelf', () => {
    const { sim, fx } = load('one-life')
    expect(sim.state.economy.lives).toBe(1)
    expect(sim.state.economy.gameOver).toBe(false)
    const p = sim.state.parcels[String(fx.fixture.parcelId)]!
    expect(p.malware).toBe(true)
    expect(p.state).toBe('on_shelf')
  })

  it('under ?policy=1 game:over fires at fixture.gameOverInS, lives 0', () => {
    const { sim, fx } = load('one-life')
    const over = collect(sim, 'game:over')
    const t0 = sim.state.tick
    withPolicy(sim, 120, () => over.length > 0)
    expect(over.length).toBe(1)
    expect((sim.state.tick - t0) / TICKS_PER_S).toBe(fx.fixture.gameOverInS)
    expect(sim.state.economy.lives).toBe(0)
    expect(sim.state.economy.gameOver).toBe(true)
  })
})
