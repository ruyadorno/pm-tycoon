// The `vlr shots` fixtures under tests/fixtures/ (plan.md §6.9.3, §12.5 task
// 11): each one loads under the shipped data hash (a stale fixture is
// refused by __pm.load, so `vlr check` catches it before `vlr shots` does)
// and still holds the scenario its shot needs. Regenerate with
// `node tools/fixtures/late-waiting.ts` / `node tools/fixtures/warehouse.ts`.
// Build 2 (B2 §5, plan-build2 §8.2 task 2): src/assets/attract.json, the
// Title's attract city, must equal a fresh run of tools/fixtures/attract.ts
// (`vlr fixtures:attract`; regenerated with every data or state-version
// change, R19), load with ignoreDataHash like the Title does, show the M5 L2
// city and keep delivering under the competent policy.
// Build 2, M6 (plan-build2 §8.3 task 12; design-m6 §8 B): people-l3.json
// (two desks at a forced L3, the per-desk charisma bonus) and
// sorter-duty.json (a sorter on duty, a held parcel it tagged `looks clean`)
// from `node tools/fixtures/people.ts` — plain runs like the M2/M3 ones.
// Build 2, M8 (plan-build2 §8.5 tasks 9-10; design-m8-m9 §8 lane G):
// level-up-3.json (3 s before the policy's real L3), l3-docks.json (dock 2
// owned, a Docks clearance ≥ 20 s ahead) and overseas-malware.json (a
// malware parcel handed off at a pier: the life goes at clearance, never
// before) from `node tools/fixtures/m8.ts`; the attract city is the L3 one
// (level ≥ 3, ≥ 6 vehicles incl. a van and two trucks, Docks live) at the
// first whole minute in 24–30 that shows it.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createPolicy } from '../../src/sim/policy.ts'
import { auditState, replay, Sim, stateHash } from '../../src/sim/sim.ts'
import { clearingParcels } from '../../src/sim/systems/hubs.ts'
import { effectiveP, sorterNumbers } from '../../src/sim/systems/people.ts'
import { laneNode, TICKS_PER_S } from '../../src/sim/types.ts'
import { collect, dataFixture } from '../sim/helpers.ts'
import {
  ATTRACT_FLEET,
  ATTRACT_LIVE,
  ATTRACT_MAX_MINUTES,
  ATTRACT_MIN_LEVEL,
  ATTRACT_MIN_MINUTES,
  ATTRACT_MIN_VEHICLES,
  ATTRACT_OUT,
  ATTRACT_SEED,
  attractJson,
  attractMinute,
  attractProblems,
  attractSummary,
  REGENERATE,
  runAttract,
} from '../../tools/fixtures/attract.ts'

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
    'people-l3',
    'sorter-duty',
    'level-up-3',
    'l3-docks',
    'overseas-malware',
  ]) {
    it(`${name}.json is current (else: its fixture.regenerate)`, () => {
      const { fx } = read(name)
      expect(fx.dataHash, fx.fixture.regenerate).toBe(dataFixture().hash)
      expect(() => load(name)).not.toThrow()
    })
  }
})

describe('the M2/M3/M6/M8 fixtures are plain runs (seed + command log, no state patching)', () => {
  for (const name of [
    'holdbay-full',
    'malware-cleared',
    'one-life',
    'level-up',
    'l2-lane',
    'people-l3',
    'sorter-duty',
    'level-up-3',
    'l3-docks',
    'overseas-malware',
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

  it('under ?policy=1 no level:up and no life lost in the next 30 s', () => {
    const { sim } = load('l2-lane')
    const ups = collect(sim, 'level:up')
    const lost = collect(sim, 'life:lost')
    withPolicy(sim, 30)
    expect(ups).toEqual([])
    expect(lost).toEqual([])
  })
})

interface DeskRecord {
  index: number
  nodeId: string
  inspectorIds: number[]
  p: number[]
  readoutP: number
}

describe('people-l3: two desks at L3 (real since M8, forced before), the charisma bonus per desk (B2 §2.3-§2.4)', () => {
  it('is at L3 with desk 1 and desk 2 placed, desk 2 seating two inspectors (one of charisma 2) with their effective p and the mean readout', () => {
    const { sim, fx } = load('people-l3')
    const st = sim.state
    const data = sim.data
    expect(st.level.level).toBe(fx.fixture.level)
    // M8: the cap is 3, so seed 7 reaches L3 for real (no debugForceLevel).
    expect(sim.commandLog.some((e) => e.cmd.kind === 'debugForceLevel')).toBe(
      fx.fixture.forced,
    )
    expect(st.economy.gameOver).toBe(false)
    const desks = fx.fixture.desks as DeskRecord[]
    expect(desks.map((d) => d.index)).toEqual([1, 2])
    const removed = fx.fixture.removed as { nodeId: string; defId: string }
    expect(desks[1]!.nodeId).toBe(removed.nodeId)
    for (const d of desks) {
      const node = laneNode(st.lane, d.nodeId)!
      const f = node.fixture
      expect(f?.kind === 'desk' ? f.index : null).toBe(d.index)
      if (f?.kind !== 'desk') continue
      expect(f.inspectorIds).toEqual(d.inspectorIds)
      expect(f.walkedOutIds).toEqual([])
      // Each station: own p + the charisma bonus of the other inspectors at
      // THIS desk (≤ pCap); the readout holds the mean (B2 §2.3, Q-B2-5).
      const crew = f.inspectorIds.map((id) =>
        st.employees.find((e) => e.id === id)!,
      )
      const ps = crew.map((e) =>
        effectiveP(
          data,
          e.pips,
          crew.filter((c) => c !== e).map((c) => c.pips),
        ),
      )
      expect(node.stations.map((x) => x.p)).toEqual(ps)
      expect(ps).toEqual(d.p)
      const mean = ps.reduce((a, b) => a + b, 0) / ps.length
      expect(f.checker.pMatch).toBeCloseTo(mean, 4)
      expect(f.checker.pMatch).toBe(d.readoutP)
    }
    const d2 = desks[1]!
    expect(d2.inspectorIds).toHaveLength(2)
    const ch = fx.fixture.charismaInspector as { id: number; name: string }
    const star = st.employees.find((e) => e.id === ch.id)!
    expect(star.name).toBe(ch.name)
    expect(star.pips.charisma).toBe(2)
    expect(d2.inspectorIds).toContain(ch.id)
    // The colleague gains charismaBonus[2] (capped); desk 1 gains nothing.
    const mate = st.employees.find(
      (e) => d2.inspectorIds.includes(e.id) && e.id !== ch.id,
    )!
    const r = data.employees.roles.inspector
    const own = r.p[(mate.pips.eye ?? 3) - 1]!
    const bonus = r.charismaBonus[2]!
    expect(d2.p[d2.inspectorIds.indexOf(mate.id)]).toBe(
      Math.min(r.pCap, Math.round((own + bonus) * 1e4) / 1e4),
    )
    expect(auditState(st, data)).toEqual([])
  })

  it('keeps running under ?policy=1 for 30 s with both desks crewed and the state sound', () => {
    const { sim, fx } = load('people-l3')
    withPolicy(sim, 30)
    const desks = fx.fixture.desks as DeskRecord[]
    const f = laneNode(sim.state.lane, desks[1]!.nodeId)!.fixture
    expect(f?.kind === 'desk' ? f.inspectorIds : null).toEqual(
      desks[1]!.inspectorIds,
    )
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})

describe('sorter-duty: a sorter on duty and a parcel it tagged looks clean (B2 §2.6)', () => {
  it('has an active sorter on the station and the tagged parcel held, its hint line the last trace entry', () => {
    const { sim, fx } = load('sorter-duty')
    const st = sim.state
    expect(st.level.level).toBe(fx.fixture.level)
    const rec = fx.fixture.sorter as { id: number; name: string }
    expect(st.lane.holdStation.fixture).toBe(rec.id)
    const sorter = st.employees.find((e) => e.id === rec.id)!
    expect(sorter.role).toBe('sorter')
    expect(sorter.active).toBe(true)
    expect(sorter.name).toBe(rec.name)
    const p = st.parcels[String(fx.fixture.parcelId)]!
    expect(p.state).toBe('held')
    expect(p.label).toBe(fx.fixture.label)
    const pct = Math.round(100 * sorterNumbers(sim.data, sorter.pips).correct)
    expect(p.sorted).toEqual({ by: sorter.id, name: sorter.name, pct })
    expect(fx.fixture.pct).toBe(pct)
    expect(p.trace.at(-1)?.text).toBe(fx.fixture.holdCardLine)
    expect(fx.fixture.holdCardLine).toBe(
      `${sorter.name}: looks clean (${pct}%)`,
    )
  })

  it('without the policy the sorter never Clears it: still held 20 s later (only the player Clears)', () => {
    const { sim, fx } = load('sorter-duty')
    const cleared = collect(sim, 'parcel:cleared_by_player')
    for (let i = 0; i < 20 * TICKS_PER_S; i++) sim.tick()
    expect(cleared).toEqual([])
    expect(sim.state.parcels[String(fx.fixture.parcelId)]!.state).toBe('held')
  })
})

describe('level-up-3: lifetime just under the L3 threshold, one payout from L3 (B2 §4.1, plan-build2 §8.5 task 9)', () => {
  it('is at L2, tier 2, the Docks locked, lifetime earned just under the L3 threshold', () => {
    const { sim, fx } = load('level-up-3')
    const st = sim.state
    expect(st.level.level).toBe(2)
    expect(st.level.warehouseTier).toBe(2)
    expect(fx.fixture.threshold).toBe(st.level.nextThreshold)
    expect(st.economy.lifetimeEarned).toBe(fx.fixture.lifetime)
    const next = st.level.nextThreshold ?? Infinity
    expect(st.economy.lifetimeEarned).toBeLessThan(next)
    expect(st.economy.lifetimeEarned).toBeGreaterThanOrEqual(next - 200)
    expect(st.districts.docks!.live).toBe(false)
  })

  it('under ?policy=1 level:up {3} lands at fixture.levelUpInS, then region:unlocked docks on the same tick: tier 3, the Docks live', () => {
    const { sim, fx } = load('level-up-3')
    const order: string[] = []
    sim.events.on('level:up', (p) => order.push(`level:${p.level}`))
    sim.events.on('region:unlocked', (p) => order.push(`region:${p.district}`))
    const t0 = sim.state.tick
    let upTick = -1
    withPolicy(sim, 10, () => {
      if (upTick < 0 && sim.state.level.level === 3) upTick = sim.state.tick
      return upTick >= 0
    })
    expect(order).toEqual(['level:3', `region:${String(fx.fixture.region)}`])
    expect((upTick - t0) / TICKS_PER_S).toBe(fx.fixture.levelUpInS)
    expect(sim.state.level.warehouseTier).toBe(3)
    expect(sim.state.districts.docks!.live).toBe(true)
  })
})

describe('l3-docks: two docks at L3 and a Docks clearance ahead (B2 §4.1, §4.4; design §4.1-§4.2)', () => {
  it('is at L3, tier 3, docks 1 and 2 owned with their conveyors, the fixture parcel the soonest Docks clearance', () => {
    const { sim, fx } = load('l3-docks')
    const st = sim.state
    expect(st.level.level).toBe(fx.fixture.level)
    expect(st.level.warehouseTier).toBe(3)
    expect(st.lane.docks.map((d) => d.id)).toEqual(fx.fixture.docks)
    expect(fx.fixture.docks).toEqual(['dock1', 'dock2'])
    for (const id of ['dock1', 'conv1', 'dock2', 'conv2'])
      expect(laneNode(st.lane, id), id).toBeTruthy()
    const clearing = clearingParcels(st, 'docks')
    expect(clearing.length).toBe(fx.fixture.clearing)
    const p = clearing[0]!
    expect(p.id).toBe(fx.fixture.clearingParcelId)
    expect(p.state).toBe('handed_off')
    expect(p.dest).toBe(fx.fixture.pierId)
    expect(p.lockedValue).toBe(fx.fixture.lockedValue)
    expect(fx.fixture.clearInS).toBeGreaterThanOrEqual(20)
    expect((p.clearTick! - st.tick) / TICKS_PER_S).toBe(fx.fixture.clearInS)
    expect(fx.fixture.officeId).toBe(
      sim.data.map.hubs.find((h) => h.district === 'docks')!.office,
    )
    expect(auditState(st, sim.data)).toEqual([])
  })

  for (const policy of [true, false]) {
    it(`${policy ? 'with' : 'without'} ?policy=1 the parcel clears at fixture.clearInS (its locked value paid), then hub:departure {docks} on that tick`, () => {
      const { sim, fx } = load('l3-docks')
      const id = fx.fixture.clearingParcelId as number
      const order: string[] = []
      let clearedTick = -1
      let paid = -1
      sim.events.on('parcel:cleared', (p) => {
        if (p.id !== id) return
        order.push(`cleared:${p.hub}:${String(p.malware)}`)
        clearedTick = sim.state.tick
        paid = p.paid
      })
      sim.events.on('hub:departure', (p) => {
        if (clearedTick >= 0 && order.length === 1)
          order.push(`depart:${p.hub}`)
      })
      const t0 = sim.state.tick
      const s = (fx.fixture.clearInS as number) + 1
      if (policy) withPolicy(sim, s, () => order.length >= 2)
      else
        for (let i = 0; i < s * TICKS_PER_S && order.length < 2; i++) sim.tick()
      expect(order).toEqual(['cleared:docks:false', 'depart:docks'])
      expect((clearedTick - t0) / TICKS_PER_S).toBe(fx.fixture.clearInS)
      expect(paid).toBe(fx.fixture.lockedValue)
    })
  }
})

describe('overseas-malware: a handed-off malware parcel costs a life at clearance, never before (spec-core §5.6, B2 §4.1)', () => {
  it('holds the malware parcel handed off at its pier, the lives of fixture.lives, the debug command in the log', () => {
    const { sim, fx } = load('overseas-malware')
    const st = sim.state
    expect(st.level.level).toBe(fx.fixture.level)
    expect(st.economy.lives).toBe(fx.fixture.lives)
    const p = st.parcels[String(fx.fixture.parcelId)]!
    expect(p.malware).toBe(true)
    expect(p.state).toBe('handed_off')
    expect(p.dest).toBe(fx.fixture.destBuildingId)
    expect(p.destRegion).toBe(fx.fixture.hub)
    expect(p.label).toBe(fx.fixture.label)
    expect((p.clearTick! - st.tick) / TICKS_PER_S).toBe(fx.fixture.lifeLostInS)
    expect(p.trace.some((e) => e.what === 'handedOff')).toBe(true)
    expect(
      sim.commandLog.filter((e) => e.cmd.kind === 'debugOverseasMalware'),
    ).toHaveLength(1)
  })

  it('under ?policy=1 life:lost {viaClearance} lands at fixture.lifeLostInS with handedOff + customsCleared in its path; the ship has sailed', () => {
    const { sim, fx } = load('overseas-malware')
    const lost = collect(sim, 'life:lost')
    const cleared = collect(sim, 'parcel:cleared')
    const lives = sim.state.economy.lives
    const t0 = sim.state.tick
    const id = fx.fixture.parcelId as number
    const lead = (fx.fixture.lifeLostInS as number) - 0.1
    withPolicy(sim, lead)
    expect(lost.filter((l) => l.parcelId === id)).toEqual([])
    expect(sim.state.economy.lives).toBe(lives)
    withPolicy(sim, 10, () => lost.some((l) => l.parcelId === id))
    const l = lost.find((x) => x.parcelId === id)!
    expect(l).toBeTruthy()
    expect(l.report.viaClearance).toBe(true)
    const whats = l.report.path.map((e) => e.what)
    expect(whats).toContain('handedOff')
    expect(whats.at(-1)).toBe('customsCleared')
    expect((sim.state.tick - t0) / TICKS_PER_S).toBe(fx.fixture.lifeLostInS)
    expect(sim.state.economy.lives).toBe(lives - 1)
    const c = cleared.find((x) => x.id === id)!
    expect(c).toMatchObject({ paid: 0, malware: true, hub: 'docks' })
  })
})

/** The committed attract snapshot's text. */
const attractText = (): string => readFileSync(ATTRACT_OUT, 'utf8')

/** The committed snapshot as the Title loads it (ignoreDataHash). */
const loadAttract = (): Sim =>
  Sim.load(dataFixture(), JSON.parse(attractText()), { ignoreDataHash: true })

describe('attract.json: the Title attract city (B2 §5; M8: the L3 city)', () => {
  it('equals a fresh run of tools/fixtures/attract.ts (else: vlr fixtures:attract)', () => {
    const sim = runAttract(dataFixture())
    expect(attractProblems(sim), attractSummary(sim)).toEqual([])
    expect(
      attractText() === attractJson(sim),
      `src/assets/attract.json is stale: run \`${REGENERATE}\` (${attractSummary(sim)})`,
    ).toBe(true)
  }, 60_000)

  it('is a plain snapshot: seed 7, the first whole minute in 24-30 that shows the L3 city, no fixture record', () => {
    const snap = JSON.parse(attractText()) as Record<string, unknown> & {
      seed: number
      state: { tick: number }
    }
    expect(snap.seed).toBe(ATTRACT_SEED)
    const perMin = 60 * TICKS_PER_S
    expect(snap.state.tick % perMin).toBe(0)
    const min = snap.state.tick / perMin
    expect(min).toBeGreaterThanOrEqual(ATTRACT_MIN_MINUTES)
    expect(min).toBeLessThanOrEqual(ATTRACT_MAX_MINUTES)
    expect(Object.keys(snap).toSorted()).toEqual(
      ['commandLog', 'dataHash', 'seed', 'state', 'version'].toSorted(),
    )
    // No earlier whole minute of the scan shows the city (the scan's rule).
    const sim = new Sim(dataFixture(), ATTRACT_SEED)
    const policy = createPolicy(sim, 'competent')
    for (let m = ATTRACT_MIN_MINUTES; m < min; m++) {
      while (sim.state.tick < m * perMin) {
        policy.step()
        sim.tick()
      }
      expect(attractProblems(sim), `minute ${m}`).not.toEqual([])
    }
    policy.dispose?.()
  }, 60_000)

  it('loads with ignoreDataHash and shows the M8 L3 city: level ≥ 3, ≥ 6 vehicles incl. a van and two trucks, Industrial and Docks live, the lane flowing', () => {
    const sim = loadAttract()
    const st = sim.state
    expect(st.level.level).toBeGreaterThanOrEqual(ATTRACT_MIN_LEVEL)
    expect(st.level.level).toBeGreaterThanOrEqual(3)
    expect(st.vehicles.length).toBeGreaterThanOrEqual(ATTRACT_MIN_VEHICLES)
    expect(ATTRACT_MIN_VEHICLES).toBeGreaterThanOrEqual(6)
    expect(ATTRACT_FLEET).toEqual({ van: 1, truck: 2 })
    expect(
      st.vehicles.filter((v) => v.type === 'van').length,
    ).toBeGreaterThanOrEqual(1)
    expect(
      st.vehicles.filter((v) => v.type === 'truck').length,
    ).toBeGreaterThanOrEqual(2)
    expect(ATTRACT_LIVE).toContain('docks')
    expect(st.districts.industrial!.live).toBe(true)
    expect(st.districts.docks!.live).toBe(true)
    expect(st.lane.stalled).toBe(false)
    expect(st.economy.gameOver).toBe(false)
    expect(attractProblems(sim)).toEqual([])
    expect(attractMinute(sim)).toBe(st.tick / (60 * TICKS_PER_S))
  })

  it('under the competent policy the demo keeps delivering for 2 minutes: no stall, no life lost', () => {
    const sim = loadAttract()
    const delivered = collect(sim, 'parcel:delivered')
    const lost = collect(sim, 'life:lost')
    const stalls = collect(sim, 'lane:stalled')
    withPolicy(sim, 120)
    expect(delivered.length).toBeGreaterThan(0)
    expect(lost).toEqual([])
    expect(stalls).toEqual([])
    expect(sim.state.economy.gameOver).toBe(false)
  })
})
