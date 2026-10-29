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
    'level-up',
    'payroll-short',
    'l2-lane',
  ]) {
    it(`${name}.json is current (else: its fixture.regenerate)`, () => {
      const { fx } = read(name)
      expect(fx.dataHash, fx.fixture.regenerate).toBe(dataFixture().hash)
      expect(() => load(name)).not.toThrow()
    })
  }
})

describe('the M2/M3 fixtures are plain runs (seed + command log, no state patching)', () => {
  for (const name of [
    'holdbay-full',
    'malware-cleared',
    'one-life',
    'level-up',
    'l2-lane',
  ]) {
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

describe('level-up: lifetime ≈ $1,990, one payout from the L2 threshold (spec §8, city-view §9.6)', () => {
  it('is at L1 with lifetime earned just under the L2 threshold, tier 1, Industrial locked', () => {
    const { sim, fx } = load('level-up')
    const st = sim.state
    expect(st.level.level).toBe(1)
    expect(st.level.warehouseTier).toBe(1)
    expect(fx.fixture.threshold).toBe(st.level.nextThreshold)
    expect(st.economy.lifetimeEarned).toBe(fx.fixture.lifetime)
    const next = st.level.nextThreshold ?? Infinity
    expect(st.economy.lifetimeEarned).toBeLessThan(next)
    expect(st.economy.lifetimeEarned).toBeGreaterThanOrEqual(next - 50)
    expect(st.districts.industrial!.live).toBe(false)
  })

  it('under ?policy=1 level:up {2} lands at fixture.levelUpInS, then region:unlocked industrial on the same tick', () => {
    const { sim, fx } = load('level-up')
    const order: string[] = []
    sim.events.on('level:up', (p) => order.push(`level:${p.level}`))
    sim.events.on('region:unlocked', (p) => order.push(`region:${p.district}`))
    const t0 = sim.state.tick
    let upTick = -1
    withPolicy(sim, 10, () => {
      if (upTick < 0 && sim.state.level.level === 2) upTick = sim.state.tick
      return upTick >= 0
    })
    expect(order).toEqual(['level:2', 'region:industrial'])
    expect((upTick - t0) / TICKS_PER_S).toBe(fx.fixture.levelUpInS)
    expect(sim.state.level.warehouseTier).toBe(2)
    expect(sim.state.districts.industrial!.live).toBe(true)
  })
})

describe('payroll-short: $0 just before a payday with staff (spec §7.3, city-view §9.7)', () => {
  it('has a $0 balance, active staff and no unpaid mark yet', () => {
    const { sim, fx } = load('payroll-short')
    const st = sim.state
    expect(fx.fixture.patched).toBe('economy.balance = 0')
    expect(st.economy.balance).toBe(0)
    const staff = st.employees.filter((e) => e.active)
    expect(staff.map((e) => e.id)).toEqual(fx.fixture.unpaid)
    expect(staff.every((e) => e.unpaidPaydays === 0)).toBe(true)
  })

  it('without the policy, payroll:short names every worker at fixture.paydayInS — nobody paid, nobody walks out', () => {
    const { sim, fx } = load('payroll-short')
    const short = collect(sim, 'payroll:short')
    const paid = collect(sim, 'payroll:paid')
    const walked = collect(sim, 'worker:walkedOut')
    const t0 = sim.state.tick
    while (short.length === 0 && sim.state.tick - t0 < 10 * TICKS_PER_S)
      sim.tick()
    expect(short.length).toBe(1)
    expect((sim.state.tick - t0) / TICKS_PER_S).toBe(fx.fixture.paydayInS)
    expect(short[0]!.employeeIds).toEqual(fx.fixture.unpaid)
    expect(paid.filter((p) => p.amount > 0)).toEqual([])
    expect(walked).toEqual([])
    expect(sim.state.economy.balance).toBeGreaterThanOrEqual(0)
    for (const id of fx.fixture.unpaid as number[])
      expect(sim.state.employees.find((e) => e.id === id)!.unpaidPaydays).toBe(
        1,
      )
  })
})

describe('l2-lane: L2 with four live slots and the Shaky shaker (warehouse-view §5.2, §7.5)', () => {
  it('is at L2, tier 2, slots 1-4 live, the shaker in fixture.shakerSlot, a truck owned', () => {
    const { sim, fx } = load('l2-lane')
    const st = sim.state
    expect(st.level.level).toBe(2)
    expect(st.level.warehouseTier).toBe(2)
    const live = st.lane.nodes
      .filter((n) => n.kind === 'slot' && !n.locked)
      .map((n) => n.id)
    expect(live).toEqual(fx.fixture.slots)
    expect(live.length).toBe(4)
    const f = laneNode(st.lane, String(fx.fixture.shakerSlot))!.fixture
    expect(f?.kind === 'machine' ? f.checker.defId : null).toBe('shaky_shaker')
    expect(st.vehicles.some((v) => v.type === 'truck')).toBe(true)
  })

  it('under ?policy=1 no level:up past the playtest cap and no life lost in the next 30 s', () => {
    const { sim } = load('l2-lane')
    const ups = collect(sim, 'level:up')
    const lost = collect(sim, 'life:lost')
    withPolicy(sim, 30)
    expect(ups).toEqual([])
    expect(lost).toEqual([])
  })
})
