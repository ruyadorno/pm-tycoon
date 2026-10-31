// M6 people (spec-build2 §2, §7.1, §8, §9; design-m6 §4, §7; plan-build2
// §8.3 task 11): the pip tables ("eye 3 / pace 3 / charisma 0 = 0.85 at 4 s,
// $20"), the salary corners, the driver multipliers ("speed 5 van = 2.76
// tiles/s"), applicant determinism on its own rng stream, the day refresh and
// ★ applicants, hire / fire / postAd, buyVehicle with a picked driver or
// "Hire later", Replace (on the lot at once, mid-trip after the unload), the
// pay order with sorters, walkouts holding seats, desk 2 at L3 (Q-B2-4), and
// a save round trip with a pending Replace and a running sorter clock.

import { describe, expect, it } from 'vitest'
import { auditState, Sim, stateHash } from '../../src/sim/sim.ts'
import { stopTicks } from '../../src/sim/systems/dispatch.ts'
import { payOrder, walkOut } from '../../src/sim/systems/payroll.ts'
import {
  addStarApplicant,
  driverNumbers,
  effectiveP,
  FACE_LOOKS,
  giftStarName,
  hireFeeOf,
  hireStar,
  inspectorNumbers,
  resyncDesks,
  salaryOf,
  setPip,
  sorterNumbers,
} from '../../src/sim/systems/people.ts'
import { speedPerTick } from '../../src/sim/systems/vehicles.ts'
import type { Pips, Role } from '../../src/sim/types.ts'
import { laneNode, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  buy,
  collect,
  dataFixture,
  eventLog,
  fund,
  heldParcel,
  hireInspector,
  injectParcel,
  makeSim,
  quiet,
  quietSim,
  runTicks,
  runUntil,
  shelveParcel,
  standardApplicant,
} from './helpers.ts'

const data = dataFixture()

/** debug.forceLevel; a quiet sim stays quiet (the new region's timer stopped). */
function forceLevel(sim: Sim, level: number): void {
  const quietBefore = Object.values(sim.state.districts).every(
    (d) => d.nextSpawnTick === null,
  )
  const res = sim.dispatch({ kind: 'debugForceLevel', level })
  if (!res.ok) throw new Error(`forceLevel ${level}: ${res.reason}`)
  if (quietBefore) quiet(sim)
}

function hireSorter(sim: Sim, pips?: Pips) {
  const a = standardApplicant(sim, 'sorter', pips)
  return sim.dispatch({
    kind: 'hire',
    role: 'sorter',
    applicantId: a.id,
    target: { station: 'hold' },
  })
}

/** Hire a driver applicant (standard, or `pips`) into vehicle `vehicleId`. */
function hireDriver(sim: Sim, vehicleId: number, pips?: Pips) {
  const a = standardApplicant(sim, 'driver', pips)
  return {
    a,
    res: sim.dispatch({
      kind: 'hire',
      role: 'driver',
      applicantId: a.id,
      target: { vehicleId },
    }),
  }
}

/** Run until toPayday's boundary. */
function toPayday(sim: Sim): void {
  runTicks(sim, TICKS_PER_DAY - (sim.state.tick % TICKS_PER_DAY))
}

/** One delivery by a bike whose driver has this charisma: the positive deltas. */
const charismaRun = (charisma: number) => {
  const sim = fund(quietSim(1))
  buy(sim, 'bike', { speed: 3, energy: 3, charisma })
  injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
  const sat = collect(sim, 'satisfaction:changed')
  const done = collect(sim, 'parcel:delivered')
  runUntil(sim, () => done.length > 0, 6000)
  return sat.filter((e) => e.delta > 0)
}

describe('pips → numbers (spec-build2 §2.1-§2.2)', () => {
  it('eye 3 / pace 3 / charisma 0 = 0.85 at 4 s, $20 — Audrey at the start is playtest 1’s inspector', () => {
    const sim = makeSim(1)
    const audrey = sim.state.employees[0]!
    expect(audrey).toMatchObject({
      id: 1,
      role: 'inspector',
      name: 'Audrey',
      pips: { eye: 3, pace: 3, charisma: 0 },
      affinity: 'none',
      look: 0,
      star: false,
      salaryPerDay: 20,
      nodeId: 'slot1',
    })
    expect(inspectorNumbers(data, audrey.pips)).toEqual({
      p: 0.85,
      decoyFlag: 0.15,
      processTicks: 40,
    })
    const desk = laneNode(sim.state.lane, 'slot1')!
    expect(desk.fixture).toMatchObject({ kind: 'desk', index: 1 })
    expect(desk.stations).toEqual([
      {
        parcelId: null,
        doneTick: null,
        employeeId: 1,
        p: 0.85,
        decoyFlag: 0.15,
        processTicks: 40,
      },
    ])
    expect(desk.fixture!.checker).toMatchObject({
      pMatch: 0.85,
      pOther: 0.85,
      decoyFlag: 0.15,
      processTicks: 40,
      stations: 1,
    })
    expect(effectiveP(data, audrey.pips, [])).toBe(0.85)
    // Never in a pool.
    for (const r of ['inspector', 'sorter', 'driver'] as const) {
      expect(sim.state.applicants[r].map((a) => a.name)).not.toContain('Audrey')
    }
  })

  it('salary corners: inspector $20 / $12 / $36, sorter $28 / $16 / $40, driver bike $8 / $13, truck $40, van $9; the fee = one day, $0 for ★', () => {
    const insp = (eye: number, pace: number, charisma: number) =>
      salaryOf(data, 'inspector', { eye, pace, charisma })
    const sort = (judgement: number, pace: number) =>
      salaryOf(data, 'sorter', { judgement, pace })
    const drv = (
      speed: number,
      energy: number,
      charisma: number,
      type: 'bike' | 'van' | 'truck',
    ) => salaryOf(data, 'driver', { speed, energy, charisma }, type)
    expect([insp(3, 3, 0), insp(1, 1, 0), insp(5, 5, 2)]).toEqual([20, 12, 36])
    expect([sort(3, 3), sort(1, 1), sort(5, 5)]).toEqual([28, 16, 40])
    expect([
      drv(3, 3, 0, 'bike'),
      drv(5, 5, 2, 'bike'),
      drv(5, 5, 2, 'truck'),
      drv(1, 1, 0, 'van'),
    ]).toEqual([8, 13, 40, 9])
    // (3,3,0) = the class base, like playtest 1's implicit driver.
    for (const t of data.vehicles.types) {
      expect(drv(3, 3, 0, t.id)).toBe(t.driverSalaryPerDay)
    }
    const pips = { eye: 5, pace: 3, charisma: 1 }
    expect(hireFeeOf(data, { role: 'inspector', pips, star: false })).toBe(
      salaryOf(data, 'inspector', pips),
    )
    expect(hireFeeOf(data, { role: 'inspector', pips, star: true })).toBe(0)
  })

  it('sorter numbers: judgement 3 = 85 %, pace 3 = one call / 6 s', () => {
    expect(sorterNumbers(data, { judgement: 3, pace: 3 })).toEqual({
      correct: 0.85,
      decisionTicks: 60,
    })
    expect(sorterNumbers(data, { judgement: 5, pace: 5 })).toEqual({
      correct: 0.95,
      decisionTicks: 40,
    })
  })

  it('speed 5 van = 2.76 tiles/s (276 / tick); speed 4 + van affinity in a van → pip 5 → ×1.15; energy 1 → a 20-tick stop, energy 5 → 12', () => {
    const sim = quietSim(1)
    const van5 = buy(sim, 'van', { speed: 5, energy: 3, charisma: 0 })
    expect(speedPerTick(sim, van5)).toBe(276)
    const fan = buy(sim, 'van', { speed: 4, energy: 1, charisma: 0 }, 'van')
    expect(
      driverNumbers(data, { speed: 4, energy: 1, charisma: 0 }, 'van', 'van')
        .speedMult,
    ).toBe(1.15)
    expect(speedPerTick(sim, fan)).toBe(276)
    expect(stopTicks(sim, fan)).toBe(20)
    const bike = buy(sim, 'bike', { speed: 4, energy: 5, charisma: 0 }, 'van')
    expect(speedPerTick(sim, bike)).toBe(216) // affinity only in its type: ×1.08
    expect(stopTicks(sim, bike)).toBe(12)
    const std = buy(sim, 'bike')
    expect(speedPerTick(sim, std)).toBe(200) // playtest 1's bike
    expect(stopTicks(sim, std)).toBe(15)
  })

  it('a charisma-2 driver adds +1 per on-time delivery and +1 per pickup (inside positiveCapPerDay)', () => {
    // Bike = Highres' favoured vehicle: +favouredPickup; Downtown favours vans.
    expect(charismaRun(0).map((e) => [e.district, e.delta])).toEqual([
      ['highres', 1],
      ['downtown', 2],
    ])
    expect(charismaRun(2).map((e) => [e.district, e.delta])).toEqual([
      ['highres', 2], // + pickupBonus
      ['downtown', 3], // + deliveryBonus
    ])
  })
})

describe('applicant pools (spec-build2 §2.7, design D1)', () => {
  it('three per role, the role’s stats, unique names, faces 0-11; the same seed rolls the same pools at tick 0 and after 3 day boundaries', () => {
    const a = makeSim(5)
    const b = makeSim(5)
    expect(a.state.applicants).toEqual(b.state.applicants)
    const names: string[] = a.state.employees.map((e) => e.name)
    for (const role of ['inspector', 'sorter', 'driver'] as const) {
      const pool = a.state.applicants[role]
      expect(pool).toHaveLength(3)
      for (const x of pool) {
        expect(x.role).toBe(role)
        expect(Object.keys(x.pips)).toEqual(data.employees.roles[role].stats)
        expect(x.look).toBeGreaterThanOrEqual(0)
        expect(x.look).toBeLessThan(FACE_LOOKS)
        expect(x.star).toBe(false)
        expect(x.leavesOnDay).toBeNull()
        if (role !== 'driver') expect(x.affinity).toBe('none')
        names.push(x.name)
      }
    }
    expect(new Set(names).size).toBe(names.length)
    expect(makeSim(6).state.applicants).not.toEqual(a.state.applicants)
    const refreshed = collect(a, 'applicants:refreshed')
    runTicks(a, 3 * TICKS_PER_DAY)
    runTicks(b, 3 * TICKS_PER_DAY)
    expect(a.state.applicants).toEqual(b.state.applicants)
    expect(refreshed).toHaveLength(9)
    expect(refreshed.slice(0, 3)).toEqual([
      { role: 'inspector', reason: 'day' },
      { role: 'sorter', reason: 'day' },
      { role: 'driver', reason: 'day' },
    ])
    expect(auditState(a.state, a.data)).toEqual([])
  })

  it('postAd and hire draw on the applicant stream only: state.rng untouched, the run unchanged', () => {
    const sim = makeSim(3)
    const twin = makeSim(3)
    runTicks(sim, 100)
    runTicks(twin, 100)
    const word = sim.state.rng
    const pools = sim.state.applicants.rng
    const ad = collect(sim, 'applicants:refreshed')
    const before = sim.state.applicants.driver.map((x) => x.id)
    expect(sim.dispatch({ kind: 'postAd', role: 'driver' })).toEqual({
      ok: true,
    })
    expect(ad).toEqual([{ role: 'driver', reason: 'ad' }])
    expect(sim.state.economy.balance).toBe(450 - 30)
    expect(sim.state.applicants.driver.map((x) => x.id)).not.toEqual(before)
    const a = sim.state.applicants.inspector[1]!
    expect(
      sim.dispatch({
        kind: 'hire',
        role: 'inspector',
        applicantId: a.id,
        target: { nodeId: 'slot1' },
      }),
    ).toMatchObject({ ok: true })
    expect(sim.state.rng).toBe(word)
    expect(sim.state.applicants.rng).not.toBe(pools)
    // The spawns and rolls of the main stream are untouched.
    runTicks(sim, 600)
    runTicks(twin, 600)
    expect(Object.keys(sim.state.parcels)).toEqual(
      Object.keys(twin.state.parcels),
    )
  })

  it('a hire removes the applicant and rolls a replacement at once (pool length 3; worker:hired → applicants:refreshed {hire})', () => {
    const sim = quietSim(2)
    const pool = sim.state.applicants.inspector
    const pick = pool[0]!
    const others = pool.slice(1).map((x) => x.id)
    const log = eventLog(sim)
    const res = sim.dispatch({
      kind: 'hire',
      role: 'inspector',
      applicantId: pick.id,
      target: { nodeId: 'slot1' },
    })
    expect(res).toEqual({ ok: true, employeeId: 2 })
    const now = sim.state.applicants.inspector
    expect(now).toHaveLength(3)
    expect(now.map((x) => x.id).slice(0, 2)).toEqual(others)
    expect(now.map((x) => x.id)).not.toContain(pick.id)
    expect(log.map((e) => e.name)).toEqual([
      'money:changed',
      'worker:hired',
      'applicants:refreshed',
    ])
    expect(sim.state.employees.at(-1)).toMatchObject({
      name: pick.name,
      pips: pick.pips,
      look: pick.look,
      salaryPerDay: salaryOf(data, 'inspector', pick.pips),
    })
    // A stale tap: that applicant took another job.
    expect(
      sim.dispatch({
        kind: 'hire',
        role: 'inspector',
        applicantId: pick.id,
        target: { nodeId: 'slot1' },
      }),
    ).toEqual({ ok: false, reason: 'no-applicant' })
  })

  it('★ applicants: free, kept by the day refresh, leave at the boundary of day + starExpiryDays with a ticker line, the pool topped up', () => {
    const sim = quietSim(4)
    const vera = addStarApplicant(sim, {
      role: 'inspector',
      name: 'Vera',
      pips: { eye: 5, pace: 3, charisma: 1 },
    })
    expect(vera).toMatchObject({ star: true, leavesOnDay: 2, name: 'Vera' })
    const pool = () => sim.state.applicants.inspector
    expect(pool()).toHaveLength(3)
    expect(pool()[0]).toBe(vera)
    const vs = createViewSim(sim)
    expect(vs.applicants('inspector')[0]).toMatchObject({
      star: true,
      hireFee: 0,
      leavesInDays: 2,
      salaryPerDay: 28,
    })
    // The same ★ again only refreshes the expiry.
    expect(
      addStarApplicant(sim, {
        role: 'inspector',
        name: 'Vera',
        pips: { eye: 5, pace: 3, charisma: 1 },
      }),
    ).toBe(vera)
    expect(pool().filter((x) => x.star)).toHaveLength(1)
    const news = collect(sim, 'ticker:news')
    const refreshed = collect(sim, 'applicants:refreshed')
    toPayday(sim) // day 1: refreshed, Vera stays
    expect(pool()[0]).toBe(vera)
    expect(pool()).toHaveLength(3)
    toPayday(sim) // day 2: Vera leaves
    expect(pool().some((x) => x.star)).toBe(false)
    expect(pool()).toHaveLength(3)
    expect(news).toContainEqual({
      text: 'Vera took another job',
      kind: 'worker',
    })
    expect(refreshed).toContainEqual({ role: 'inspector', reason: 'starLeft' })
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('★ hire is free; a ★ whose name an employee holds becomes "Name 2"', () => {
    const sim = quietSim(4)
    const star = addStarApplicant(sim, {
      role: 'inspector',
      name: 'Audrey',
      pips: { eye: 5, pace: 3, charisma: 1 },
    })
    expect(star.name).toBe('Audrey 2')
    const balance = sim.state.economy.balance
    expect(
      sim.dispatch({
        kind: 'hire',
        role: 'inspector',
        applicantId: star.id,
        target: { nodeId: 'slot1' },
      }),
    ).toMatchObject({ ok: true })
    expect(sim.state.economy.balance).toBe(balance)
    expect(sim.state.employees.at(-1)).toMatchObject({
      name: 'Audrey 2',
      star: true,
      salaryPerDay: 28,
    })
  })
})

describe('★ expiry and identity (M6 review)', () => {
  it('a ★ that arrives on a day\'s last tick still stays starExpiryDays (2) full days; the card reads 2d, 1d, then "today"', () => {
    const sim = quietSim(4)
    runTicks(sim, TICKS_PER_DAY - 1) // tick 599, the last tick of day 0
    const t0 = sim.state.tick
    const vera = addStarApplicant(sim, {
      role: 'inspector',
      name: 'Vera',
      pips: { eye: 5, pace: 3, charisma: 1 },
    })
    expect(vera.leavesOnDay).toBe(3) // not day + 2 = 2 (601 ticks)
    const vs = createViewSim(sim)
    const days = () =>
      vs.applicants('inspector').find((a) => a.id === vera.id)?.leavesInDays
    expect(days()).toBe(2)
    const here = () =>
      sim.state.applicants.inspector.some((a) => a.id === vera.id)
    runTicks(sim, 2 * TICKS_PER_DAY - 1)
    expect(sim.state.tick - t0).toBe(2 * TICKS_PER_DAY - 1)
    expect(here()).toBe(true)
    expect(days()).toBe(0) // `leaves today`
    runTicks(sim, 1)
    expect(sim.state.tick - t0).toBe(2 * TICKS_PER_DAY)
    expect(here()).toBe(true) // ≥ 2 full days
    toPayday(sim)
    expect(here()).toBe(false)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('the same ★ again refreshes its expiry even after a rename ("Audrey 2"): no duplicate, no regular pushed out', () => {
    const sim = quietSim(4)
    const def = {
      role: 'inspector' as const,
      name: 'Audrey',
      pips: { eye: 5, pace: 3, charisma: 1 },
    }
    const first = addStarApplicant(sim, def)
    expect(first).toMatchObject({ name: 'Audrey 2', starKey: 'Audrey' })
    const regulars = sim.state.applicants.inspector.filter((a) => !a.star)
    toPayday(sim)
    const again = addStarApplicant(sim, def)
    expect(again).toBe(first)
    expect(again.leavesOnDay).toBe(3)
    const pool = sim.state.applicants.inspector
    expect(pool.filter((a) => a.star)).toHaveLength(1)
    expect(pool).toHaveLength(3)
    expect(regulars).toHaveLength(2)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})

describe('★ name rules (design §4.1, the M7 contract)', () => {
  it('a regular applicant holding the ★ name anywhere is re-rolled in place (new id, another name); names stay unique', () => {
    const sim = quietSim(6) // seed 6 rolls a regular driver named Vera
    const at = sim.state.applicants.driver.findIndex((a) => a.name === 'Vera')
    expect(at).toBeGreaterThanOrEqual(0)
    const holder = sim.state.applicants.driver[at]!
    const star = addStarApplicant(sim, {
      role: 'inspector',
      name: 'Vera',
      pips: { eye: 5, pace: 3, charisma: 1 },
    })
    expect(star.name).toBe('Vera')
    const rolled = sim.state.applicants.driver[at]!
    expect(rolled.id).not.toBe(holder.id)
    expect(rolled.name).not.toBe('Vera')
    const names = [
      ...sim.state.employees.map((e) => e.name),
      ...sim.state.applicants.inspector.map((a) => a.name),
      ...sim.state.applicants.sorter.map((a) => a.name),
      ...sim.state.applicants.driver.map((a) => a.name),
    ]
    expect(new Set(names).size).toBe(names.length)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})

describe('drivers (spec-build2 §2.5, design D2)', () => {
  it('buyVehicle with an applicant hires that driver: price + fee debited, {vehicleId, employeeId}', () => {
    const sim = quietSim(1)
    const a = sim.state.applicants.driver[1]!
    const fee = hireFeeOf(data, a, 'bike')
    const hired = collect(sim, 'worker:hired')
    const res = sim.dispatch({
      kind: 'buyVehicle',
      type: 'bike',
      applicantId: a.id,
    })
    expect(res).toEqual({ ok: true, vehicleId: 1, employeeId: 2 })
    expect(sim.state.economy.balance).toBe(450 - 200 - fee)
    const v = sim.state.vehicles[0]!
    expect(v).toMatchObject({
      driverId: 2,
      nextDriverId: null,
      state: 'idle_lot',
    })
    expect(hired).toEqual([
      {
        employeeId: 2,
        role: 'driver',
        nodeId: null,
        vehicleId: 1,
        pips: a.pips,
        star: false,
        rehire: false,
      },
    ])
    expect(createViewSim(sim).vehicles[0]).toMatchObject({
      driverName: a.name,
      driverId: 2,
      driverPips: a.pips,
      driverAffinity: a.affinity,
      nextDriverName: null,
    })
  })

  it('Hire later → inactive, driverName null, never dispatched, no payroll line; hiring into it → idle_lot and it works', () => {
    const sim = fund(quietSim(1))
    const bought = collect(sim, 'vehicle:bought')
    const inactive = collect(sim, 'vehicle:inactive')
    const res = sim.dispatch({
      kind: 'buyVehicle',
      type: 'bike',
      applicantId: null,
    })
    expect(res).toEqual({ ok: true, vehicleId: 1 })
    expect(bought).toEqual([{ id: 1, free: false }])
    expect(inactive).toEqual([{ id: 1 }])
    const v = sim.state.vehicles[0]!
    expect(v).toMatchObject({ state: 'inactive', driverId: null })
    const vs = createViewSim(sim)
    expect(vs.vehicles[0]).toMatchObject({ driverName: null, driverId: null })
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runTicks(sim, 300)
    expect(v.state).toBe('inactive')
    expect(vs.payroll()).toMatchObject({ drivers: 0, perDay: 20 })
    const { res: hire } = hireDriver(sim, v.id)
    expect(hire).toEqual({ ok: true, employeeId: 2, vehicleId: 1 })
    expect(v.state).toBe('idle_lot')
    expect(runUntil(sim, () => v.state === 'collecting', 50)).toBeGreaterThan(0)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('Replace on the lot is immediate: the old driver leaves (worker:fired {replaced}) before the money and the hire events', () => {
    const sim = fund(quietSim(1))
    const v = buy(sim, 'bike')
    const old = v.driverId!
    const log = eventLog(sim)
    const { res } = hireDriver(sim, v.id, { speed: 5, energy: 3, charisma: 0 })
    expect(res).toMatchObject({ ok: true })
    expect(v.driverId).toBe(sim.state.employees.at(-1)!.id)
    expect(v.nextDriverId).toBeNull()
    expect(sim.state.employees.some((e) => e.id === old)).toBe(false)
    expect(log.map((e) => e.name)).toEqual([
      'worker:fired',
      'money:changed',
      'worker:hired',
      'applicants:refreshed',
    ])
    expect(log[0]!.p).toEqual({
      employeeId: old,
      role: 'driver',
      nodeId: null,
      vehicleId: v.id,
      reason: 'replaced',
    })
  })

  it('Replace mid-trip keeps the old driver until the unload; then the new one takes over and the old gets worker:fired {replaced}', () => {
    const sim = fund(quietSim(1))
    const v = buy(sim, 'bike')
    const old = v.driverId!
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(runUntil(sim, () => v.cargo.length > 0, 3000)).toBeGreaterThan(0)
    const { a, res } = hireDriver(sim, v.id, {
      speed: 5,
      energy: 5,
      charisma: 0,
    })
    expect(res).toMatchObject({ ok: true })
    const next = sim.state.employees.at(-1)!.id
    expect(v.driverId).toBe(old)
    expect(v.nextDriverId).toBe(next)
    const vs = createViewSim(sim)
    expect(vs.vehicles[0]).toMatchObject({ nextDriverName: a.name })
    expect(vs.people().find((p) => p.id === next)).toMatchObject({
      pending: true,
      vehicleId: v.id,
    })
    expect(speedPerTick(sim, v)).toBe(200) // still the old driver's speed
    expect(auditState(sim.state, sim.data)).toEqual([])
    const log = eventLog(sim)
    expect(runUntil(sim, () => v.nextDriverId === null, 3000)).toBeGreaterThan(
      0,
    )
    const names = log.map((e) => e.name)
    const fired = log.find((e) => e.name === 'worker:fired')!
    expect(fired.p).toMatchObject({ employeeId: old, reason: 'replaced' })
    expect(names.indexOf('worker:fired')).toBeGreaterThan(
      names.indexOf('vehicle:unloaded'),
    )
    expect(v.driverId).toBe(next)
    expect(v.cargo).toEqual([])
    expect(speedPerTick(sim, v)).toBe(230)
    runTicks(sim, 20)
    expect(v.state).not.toBe('inactive')
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('Fire a driver mid-trip: the trip finishes (cargo unloaded), then the vehicle parks No driver', () => {
    const sim = fund(quietSim(1))
    const v = buy(sim, 'bike')
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(runUntil(sim, () => v.cargo.length > 0, 3000)).toBeGreaterThan(0)
    const fired = collect(sim, 'worker:fired')
    expect(sim.dispatch({ kind: 'fire', employeeId: v.driverId! })).toEqual({
      ok: true,
    })
    expect(fired[0]).toMatchObject({ role: 'driver', reason: 'fired' })
    expect(v.driverId).toBeNull()
    expect(v.state).not.toBe('inactive')
    const unloaded = collect(sim, 'parcel:unloaded')
    expect(runUntil(sim, () => v.state === 'inactive', 3000)).toBeGreaterThan(0)
    expect(unloaded).toHaveLength(1)
    expect(v.cargo).toEqual([])
    expect(createViewSim(sim).vehicles[0]!.driverName).toBeNull()
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})

describe('drivers: M6 review edge cases', () => {
  it('a driver fired mid-trip leaves their pace with the vehicle until it parks (no faster unpaid trip)', () => {
    const sim = fund(quietSim(1))
    const v = buy(sim, 'bike', { speed: 1, energy: 1, charisma: 0 })
    expect(speedPerTick(sim, v)).toBe(170)
    expect(stopTicks(sim, v)).toBe(20)
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(runUntil(sim, () => v.state === 'collecting', 3000)).toBeGreaterThan(
      0,
    )
    expect(sim.dispatch({ kind: 'fire', employeeId: v.driverId! })).toEqual({
      ok: true,
    })
    expect(v.driverId).toBeNull()
    expect(v.tripMults).toEqual({ speedMult: 0.85, stopMult: 1.3 })
    expect(speedPerTick(sim, v)).toBe(170)
    expect(stopTicks(sim, v)).toBe(20)
    expect(runUntil(sim, () => v.state === 'inactive', 6000)).toBeGreaterThan(0)
    expect(v.tripMults).toBeUndefined()
    // A driver hired into it drives at their own pace.
    hireDriver(sim, v.id, { speed: 5, energy: 3, charisma: 0 })
    expect(speedPerTick(sim, v)).toBe(230)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('a Replace pending at the end of a delivery run swaps drivers on the lot: the vehicle drives home first (spec-build2 §2.5)', () => {
    const sim = fund(quietSim(1))
    const v = buy(sim, 'bike')
    const old = v.driverId!
    shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(runUntil(sim, () => v.state === 'delivering', 3000)).toBeGreaterThan(
      0,
    )
    const { res } = hireDriver(sim, v.id)
    expect(res).toMatchObject({ ok: true })
    const next = v.nextDriverId!
    expect(next).not.toBeNull()
    let swapAt: { x: number; y: number; state: string } | null = null
    sim.addTap((name, p) => {
      if (name !== 'worker:fired' || swapAt) return
      const e = p as { employeeId: number; reason: string }
      if (e.employeeId === old && e.reason === 'replaced')
        swapAt = {
          x: Math.round(v.pos.tx),
          y: Math.round(v.pos.ty),
          state: v.state,
        }
    })
    const states = collect(sim, 'vehicle:returning')
    expect(runUntil(sim, () => v.nextDriverId === null, 6000)).toBeGreaterThan(
      0,
    )
    expect(states.some((e) => e.id === v.id)).toBe(true)
    expect(swapAt).toEqual({
      ...sim.roads.entrance,
      state: 'returning',
    })
    expect(v.driverId).toBe(next)
    expect(v.state).toBe('idle_lot')
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('a pending Replace driver who walks out cancels the Replace at once: the paid, working driver stays', () => {
    const sim = fund(quietSim(1))
    const v = buy(sim, 'bike')
    const old = v.driverId!
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(runUntil(sim, () => v.cargo.length > 0, 3000)).toBeGreaterThan(0)
    hireDriver(sim, v.id)
    const pending = sim.state.employees.find((e) => e.id === v.nextDriverId)!
    const fired = collect(sim, 'worker:fired')
    walkOut(sim, pending)
    expect(v.nextDriverId).toBeNull()
    expect(v.driverId).toBe(old)
    expect(sim.state.employees.some((e) => e.id === pending.id)).toBe(false)
    expect(fired).toEqual([
      {
        employeeId: pending.id,
        role: 'driver',
        nodeId: null,
        vehicleId: v.id,
        reason: 'replaced',
      },
    ])
    expect(createViewSim(sim).vehicles[0]).toMatchObject({
      nextDriverName: null,
    })
    // The trip carries on and the old driver keeps the wheel after it.
    expect(runUntil(sim, () => v.state === 'idle_lot', 6000)).toBeGreaterThan(0)
    expect(v.driverId).toBe(old)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('a walked-out driver whose Replace waits cannot be re-hired (the swap lets them go): no fee taken', () => {
    const sim = fund(quietSim(1))
    const v = buy(sim, 'bike')
    const old = sim.state.employees.find((e) => e.id === v.driverId)!
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(runUntil(sim, () => v.cargo.length > 0, 3000)).toBeGreaterThan(0)
    hireDriver(sim, v.id)
    walkOut(sim, old)
    const balance = sim.state.economy.balance
    expect(sim.dispatch({ kind: 'rehire', employeeId: old.id })).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(sim.state.economy.balance).toBe(balance)
    expect(old.active).toBe(false)
  })
})

describe('payroll, walkouts and seats with sorters (spec-build2 §2.2, design §4.4, D10)', () => {
  it('pay order: inspectors → sorters → drivers; a short balance leaves the drivers unpaid first', () => {
    const sim = fund(quietSim(1))
    forceLevel(sim, 2)
    const bike = buy(sim, 'bike')
    expect(hireSorter(sim)).toMatchObject({ ok: true })
    const sorter = sim.state.employees.find((e) => e.role === 'sorter')!
    expect(sorter.salaryPerDay).toBe(28)
    expect(payOrder(sim).map((e) => e.role)).toEqual([
      'inspector',
      'sorter',
      'driver',
    ])
    expect(createViewSim(sim).payroll()).toMatchObject({
      perDay: 20 + 28 + 8,
      inspectors: 1,
      sorters: 1,
      drivers: 1,
    })
    sim.state.economy.balance = 20 + 28
    const short = collect(sim, 'payroll:short')
    toPayday(sim)
    expect(short).toEqual([{ employeeIds: [bike.driverId!] }])
  })

  it('a walked-out sorter holds the seat (idle, no calls); re-hire returns it; Fire frees the seat', () => {
    const sim = quietSim(1)
    fund(sim)
    forceLevel(sim, 2)
    expect(hireSorter(sim)).toMatchObject({ ok: true })
    const sorter = sim.state.employees.find((e) => e.role === 'sorter')!
    walkOut(sim, sorter)
    const hs = sim.state.lane.holdStation
    expect(hs).toEqual({ fixture: sorter.id, nextDecisionTick: null })
    const vs = createViewSim(sim)
    expect(vs.holdStation).toMatchObject({
      kind: 'sorter',
      unlocked: true,
      sorter: { id: sorter.id, active: false },
      working: false,
    })
    heldParcel(sim, { malware: true })
    const decided = collect(sim, 'sorter:decided')
    runTicks(sim, 200)
    expect(decided).toEqual([])
    expect(hs.nextDecisionTick).toBeNull()
    expect(sim.dispatch({ kind: 'rehire', employeeId: sorter.id })).toEqual({
      ok: true,
    })
    expect(sorter.active).toBe(true)
    runTicks(sim, 61)
    expect(decided).toHaveLength(1)
    walkOut(sim, sorter)
    expect(sim.dispatch({ kind: 'fire', employeeId: sorter.id })).toEqual({
      ok: true,
    })
    expect(hs).toEqual({ fixture: null, nextDecisionTick: null })
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('hiring a sorter into an occupied station replaces the seated one (design D11)', () => {
    const sim = fund(quietSim(1))
    forceLevel(sim, 2)
    hireSorter(sim)
    const first = sim.state.lane.holdStation.fixture
    const fired = collect(sim, 'worker:fired')
    expect(hireSorter(sim, { judgement: 5, pace: 5 })).toMatchObject({
      ok: true,
    })
    expect(fired).toEqual([
      {
        employeeId: first,
        role: 'sorter',
        nodeId: 'hold',
        vehicleId: null,
        reason: 'replaced',
      },
    ])
    expect(sim.state.employees.filter((e) => e.role === 'sorter')).toHaveLength(
      1,
    )
  })

  it('Fire frees a walked-out inspector’s held seat (D10)', () => {
    const sim = fund(quietSim(1))
    for (let i = 0; i < 2; i++) hireInspector(sim)
    const [, second] = sim.state.employees
    walkOut(sim, second!)
    expect(hireInspector(sim)).toEqual({ ok: false, reason: 'desk-full' })
    expect(sim.dispatch({ kind: 'fire', employeeId: second!.id })).toEqual({
      ok: true,
    })
    const desk = laneNode(sim.state.lane, 'slot1')!
    if (desk.fixture?.kind !== 'desk') throw new Error('no desk')
    expect(desk.fixture.walkedOutIds).toEqual([])
    expect(hireInspector(sim)).toMatchObject({ ok: true })
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})

describe('desk 2 (spec-build2 §2.4, Q-B2-4)', () => {
  it('desk-locked at L2; debug.forceLevel(3) → placeDesk(slot, 2) for $400; a second desk 2 → desk-exists; charisma stays per desk', () => {
    const sim = quietSim(1)
    sim.state.economy.balance = 1000
    forceLevel(sim, 2)
    expect(
      sim.dispatch({ kind: 'placeDesk', nodeId: 'slot2', index: 2 }),
    ).toEqual({ ok: false, reason: 'desk-locked' })
    const vs = createViewSim(sim, { debug: true })
    const earned = sim.state.economy.lifetimeEarned
    expect(vs.debug!.forceLevel(3)).toEqual({ ok: true })
    expect(sim.state.level.level).toBe(3)
    // Forcing books no income (final review): lifetime earned is unchanged.
    expect(sim.state.economy.lifetimeEarned).toBe(earned)
    const placed = collect(sim, 'desk:placed')
    sim.state.economy.balance = 399
    expect(vs.lane.placeDesk('slot2', 2)).toEqual({
      ok: false,
      reason: 'insufficient-funds',
    })
    sim.state.economy.balance = 1000
    expect(vs.lane.placeDesk('slot2', 2)).toEqual({ ok: true })
    expect(sim.state.economy.balance).toBe(600)
    expect(placed).toEqual([{ index: 2, nodeId: 'slot2' }])
    expect(vs.lane.placeDesk('slot3', 2)).toEqual({
      ok: false,
      reason: 'desk-exists',
    })
    const desk2 = laneNode(sim.state.lane, 'slot2')!
    expect(desk2.fixture).toMatchObject({ kind: 'desk', index: 2 })
    expect(desk2.stations).toEqual([]) // passes parcels through until someone sits
    const a = standardApplicant(sim, 'inspector', {
      eye: 3,
      pace: 3,
      charisma: 2,
    })
    expect(vs.hire('inspector', a.id, { nodeId: 'slot2' })).toMatchObject({
      ok: true,
    })
    expect(desk2.stations.map((st) => st.p)).toEqual([0.85])
    expect(laneNode(sim.state.lane, 'slot1')!.stations[0]!.p).toBe(0.85)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})

describe('saves (design §4.9)', () => {
  it('a pending Replace and a running sorter clock survive a JSON round trip: the reload continues identically', () => {
    const live = fund(quietSim(9))
    forceLevel(live, 2)
    const v = buy(live, 'bike')
    injectParcel(live, 'hr_towers_a', 'dt_cache_cafe')
    expect(runUntil(live, () => v.cargo.length > 0, 3000)).toBeGreaterThan(0)
    hireSorter(live)
    heldParcel(live, { malware: true })
    heldParcel(live, { decoy: 'metal' })
    runTicks(live, 1)
    expect(live.state.lane.holdStation.nextDecisionTick).not.toBeNull()
    hireDriver(live, v.id, { speed: 5, energy: 4, charisma: 2 })
    expect(v.nextDriverId).not.toBeNull()
    const loaded = Sim.load(
      live.data,
      JSON.parse(JSON.stringify(live.snapshot())),
    )
    expect(loaded.state).toEqual(live.state)
    runTicks(live, 900)
    runTicks(loaded, 900)
    expect(live.state.vehicles[0]!.nextDriverId).toBeNull()
    expect(stateHash(loaded.state)).toBe(stateHash(live.state))
    expect(loaded.peopleRng.next()).toBe(live.peopleRng.next())
    expect(auditState(loaded.state, loaded.data)).toEqual([])
  })
})

describe('roles of the ViewSim (design §3.4)', () => {
  it('applicants(role, vehicleType) prices a driver for that class; people() lists everyone with numbers', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    const a = standardApplicant(sim, 'driver', {
      speed: 5,
      energy: 5,
      charisma: 2,
    })
    const pick = (type: 'bike' | 'truck') =>
      vs.applicants('driver', type).find((x) => x.id === a.id)!
    expect(pick('bike')).toMatchObject({ salaryPerDay: 13, hireFee: 13 })
    expect(pick('truck')).toMatchObject({ salaryPerDay: 40, hireFee: 40 })
    expect(pick('bike').numbers).toEqual({
      speedMult: 1.15,
      stopMult: 0.8,
      deliveryBonus: 1,
      pickupBonus: 1,
    })
    const roles: Role[] = vs.people().map((p) => p.role)
    expect(roles).toEqual(['inspector'])
    expect(vs.people()[0]!.numbers).toEqual({
      p: 0.85,
      pEff: 0.85,
      decoyFlag: 0.15,
      processS: 4,
    })
    expect(vs.holdStation).toMatchObject({
      unlockLevel: 2,
      unlocked: false,
      kind: null,
      sorter: null,
    })
  })
})

describe('build 3 event helpers (B3 §3.5; M11 stream C)', () => {
  it('setPip: a permanent change clamped to 1–5 (charisma 0–2), the salary kept; a stat the role lacks is left alone', () => {
    const sim = quietSim(1)
    const e = sim.state.employees[0]!
    const salary = e.salaryPerDay
    setPip(e, 'eye', 4)
    setPip(e, 'charisma', 5)
    setPip(e, 'pace', -9)
    expect(e.pips).toEqual({ eye: 5, pace: 1, charisma: 2 })
    setPip(e, 'speed', 1)
    expect(e.pips).toEqual({ eye: 5, pace: 1, charisma: 2 })
    expect(e.salaryPerDay).toBe(salary)
    resyncDesks(sim)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('hireStar: seated outside the pools — no pool change, fee 0, the normal salary, ★, the look one people-stream draw', () => {
    const sim = fund(quietSim(1), 500)
    const s = sim.state
    const pools = structuredClone([
      s.applicants.inspector,
      s.applicants.sorter,
      s.applicants.driver,
    ])
    const word = s.applicants.rng
    const balance = s.economy.balance
    const nextApplicant = s.nextId.applicant
    const refreshed = collect(sim, 'applicants:refreshed')
    const def = {
      role: 'inspector' as const,
      name: 'Audrey',
      pips: { eye: 4, pace: 4, charisma: 1 },
    }
    expect(giftStarName(s, def)).toBe('Audrey 2') // Audrey is on the staff
    const e = hireStar(sim, def, { nodeId: 'slot1' })
    expect(e).toMatchObject({
      name: 'Audrey 2',
      role: 'inspector',
      star: true,
      nodeId: 'slot1',
      pips: def.pips,
      salaryPerDay: salaryOf(data, 'inspector', def.pips),
    })
    expect(e.look).toBeGreaterThanOrEqual(0)
    expect(e.look).toBeLessThan(FACE_LOOKS)
    expect(s.economy.balance).toBe(balance)
    expect([
      s.applicants.inspector,
      s.applicants.sorter,
      s.applicants.driver,
    ]).toEqual(pools)
    expect(refreshed).toEqual([])
    expect(s.nextId.applicant).toBe(nextApplicant + 1)
    expect(s.applicants.rng).not.toBe(word)
    expect(laneNode(s.lane, 'slot1')!.stations).toHaveLength(2)
    expect(auditState(s, sim.data)).toEqual([])
  })
})
