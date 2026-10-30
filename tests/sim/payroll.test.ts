// spec §7.3-§7.4 payroll, unpaid marks, walkouts and re-hire (+ §4.6
// `inactive`, §6.7; plan.md §12.6 tasks 2 + 11): payday on every day
// boundary in the fixed order (inspectors by hire, then sorters — M6,
// people.test.ts — then drivers by vehicle purchase), balance ≥ salary → paid, else unpaid; the second consecutive
// unpaid payday walks the worker out (an inspector leaves the desk, a driver's
// vehicle finishes its trip, unloads and parks inactive); one paid payday
// clears the mark; re-hire = one day's salary, immediate; the balance never
// goes negative; walked-out inspectors keep their desk seat.

import { describe, expect, it } from 'vitest'
import { auditState, replay, Sim, stateHash } from '../../src/sim/sim.ts'
import type { Command } from '../../src/sim/commands.ts'
import {
  payOrder,
  ticksToPayday,
  walkOut,
} from '../../src/sim/systems/payroll.ts'
import type { Employee, Vehicle } from '../../src/sim/types.ts'
import { laneNode, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import { salaryOf } from '../../src/sim/systems/people.ts'
import {
  buy,
  collect,
  dataFixture,
  eventLog,
  hireInspector,
  injectParcel,
  makeSim,
  openingA,
  quietSim,
  runTicks,
  runUntil,
  shelveParcel,
} from './helpers.ts'

const data = dataFixture()
/** The standard 3/3/0 inspector's salary (Audrey, the helpers' hires): $20. */
const INSPECTOR = salaryOf(data, 'inspector', { eye: 3, pace: 3, charisma: 0 })
const salary = (type: string): number =>
  data.vehicles.types.find((t) => t.id === type)!.driverSalaryPerDay

/** Ticks until (and including) the next day boundary. */
function toPayday(sim: Sim): void {
  runTicks(sim, TICKS_PER_DAY - (sim.state.tick % TICKS_PER_DAY))
}

const employee = (sim: Sim, id: number): Employee =>
  sim.state.employees.find((e) => e.id === id)!
const driverOf = (sim: Sim, v: Vehicle): Employee => employee(sim, v.driverId!)
const inspectorIds = (sim: Sim): number[] =>
  sim.state.employees.filter((e) => e.role === 'inspector').map((e) => e.id)

describe('payday (spec §7.3)', () => {
  it('payday 1 under opening A totals $28 (inspector $20 + bike driver $8), one ledger line at t = 60 s', () => {
    const sim = makeSim(1)
    openingA(sim)
    const paid = collect(sim, 'payroll:paid')
    const short = collect(sim, 'payroll:short')
    const log = eventLog(sim)
    runTicks(sim, TICKS_PER_DAY - 1)
    expect(paid).toEqual([])
    runTicks(sim, 1)
    expect(paid).toEqual([{ amount: 28 }])
    expect(INSPECTOR + salary('bike')).toBe(28)
    expect(short).toEqual([])
    const ledger = log.filter(
      (e) =>
        e.name === 'money:changed' &&
        (e.p as { reason: string }).reason === 'payroll',
    )
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ tick: 600, p: { delta: -28 } })
    expect(sim.state.economy.lastPayroll).toEqual({
      tick: 600,
      paid: 28,
      shortEmployeeIds: [],
    })
    expect(sim.state.stats.payrollPaid).toBe(28)
    // payroll lands before day:ended (the HUD's daily line counts it)
    const order = log
      .filter((e) => e.tick === 600)
      .map((e) => e.name)
      .filter((n) => n === 'payroll:paid' || n === 'day:ended')
    expect(order).toEqual(['payroll:paid', 'day:ended'])
  })

  it('pay order: inspectors by hire time, then drivers by vehicle purchase — a later-hired inspector is paid before an earlier-bought driver', () => {
    const sim = quietSim(1)
    const bikeA = buy(sim, 'bike') // tick 0
    runTicks(sim, 10)
    sim.state.economy.balance = 100
    expect(hireInspector(sim)).toMatchObject({ ok: true })
    runTicks(sim, 10)
    const bikeB = buy(sim, 'bike')
    const [insp1, insp2] = inspectorIds(sim) as [number, number]
    expect(payOrder(sim).map((e) => e.id)).toEqual([
      insp1,
      insp2,
      driverOf(sim, bikeA).id,
      driverOf(sim, bikeB).id,
    ])
    // $48 pays both inspectors and driver A, not driver B
    sim.state.economy.balance = 2 * INSPECTOR + salary('bike')
    const paid = collect(sim, 'payroll:paid')
    const short = collect(sim, 'payroll:short')
    toPayday(sim)
    expect(paid).toEqual([{ amount: 48 }])
    expect(short).toEqual([{ employeeIds: [driverOf(sim, bikeB).id] }])
    expect(sim.state.economy.balance).toBe(0)
    // each worker against what is left: $28 pays inspector 1, skips
    // inspector 2 ($8 left), and still pays driver A ($8 ≥ $8)
    sim.state.economy.balance = INSPECTOR + salary('bike')
    toPayday(sim)
    expect(paid.at(-1)).toEqual({ amount: 28 })
    expect(short.at(-1)).toEqual({
      employeeIds: [insp2, driverOf(sim, bikeB).id],
    })
    expect(employee(sim, insp1).unpaidPaydays).toBe(0)
    expect(employee(sim, insp2).unpaidPaydays).toBe(1)
    expect(driverOf(sim, bikeA).unpaidPaydays).toBe(0)
    // driver B: unpaid twice in a row → walked out
    expect(driverOf(sim, bikeB).active).toBe(false)
  })
})

describe('unpaid marks and walkouts (spec §7.4)', () => {
  it('walkout on the second consecutive unpaid payday: the inspector leaves the desk (station −1, desk stays), the idle driver parks inactive', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    sim.state.economy.balance = 0
    const [insp] = inspectorIds(sim) as [number]
    const short = collect(sim, 'payroll:short')
    const out = collect(sim, 'worker:walkedOut')
    const inactive = collect(sim, 'vehicle:inactive')
    toPayday(sim)
    expect(short).toEqual([{ employeeIds: [insp, driverOf(sim, bike).id] }])
    expect(out).toEqual([])
    expect(employee(sim, insp)).toMatchObject({
      active: true,
      unpaidPaydays: 1,
    })
    expect(createViewSim(sim).payroll()).toMatchObject({ short: true })
    expect(createViewSim(sim).vehicles[0]!.unpaid).toBe(true)
    toPayday(sim)
    expect(out).toEqual([
      { employeeId: insp, role: 'inspector', nodeId: 'slot1', vehicleId: null },
      {
        employeeId: driverOf(sim, bike).id,
        role: 'driver',
        nodeId: null,
        vehicleId: bike.id,
      },
    ])
    const desk = laneNode(sim.state.lane, 'slot1')!
    expect(desk.fixture?.kind).toBe('desk')
    if (desk.fixture?.kind !== 'desk') throw new Error('no desk')
    expect(desk.fixture.inspectorIds).toEqual([])
    expect(desk.fixture.walkedOutIds).toEqual([insp])
    expect(desk.stations).toEqual([])
    expect(desk.fixture.checker.stations).toBe(0)
    expect(employee(sim, insp)).toMatchObject({
      active: false,
      unpaidPaydays: 2,
    })
    expect(inactive).toEqual([{ id: bike.id }])
    expect(sim.state.vehicles[0]!.state).toBe('inactive')
    // nobody on the payroll any more: no payroll line, nobody short
    const paid = collect(sim, 'payroll:paid')
    const short2 = collect(sim, 'payroll:short')
    toPayday(sim)
    expect(paid).toEqual([])
    expect(short2).toEqual([])
    expect(createViewSim(sim).payroll()).toMatchObject({
      perDay: 0,
      inspectors: 0,
      drivers: 0,
    })
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('one paid payday clears the mark: unpaid, paid, unpaid → no walkout', () => {
    const sim = quietSim(1)
    const [insp] = inspectorIds(sim) as [number]
    sim.state.economy.balance = 0
    toPayday(sim)
    expect(employee(sim, insp).unpaidPaydays).toBe(1)
    sim.state.economy.balance = INSPECTOR
    toPayday(sim)
    expect(employee(sim, insp).unpaidPaydays).toBe(0)
    toPayday(sim) // $0 again
    expect(employee(sim, insp)).toMatchObject({
      unpaidPaydays: 1,
      active: true,
    })
  })

  it('payroll().short (the Garage `!`, red payroll line) holds while a worker the last payday missed is still owed, and clears once everyone short is re-hired', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    const [insp] = inspectorIds(sim) as [number]
    sim.state.economy.balance = 0
    toPayday(sim)
    expect(createViewSim(sim).payroll().short).toBe(true)
    toPayday(sim) // second miss: both walk out
    const driver = driverOf(sim, bike)
    expect(employee(sim, insp).active).toBe(false)
    expect(driver.active).toBe(false)
    expect(sim.state.economy.lastPayroll?.shortEmployeeIds).toEqual([
      insp,
      driver.id,
    ])
    sim.state.economy.balance = 1_000
    expect(sim.dispatch({ kind: 'rehire', employeeId: insp }).ok).toBe(true)
    expect(sim.dispatch({ kind: 'rehire', employeeId: driver.id }).ok).toBe(
      true,
    )
    // the last payday's list still names them, but nobody is owed any more
    expect(sim.state.economy.lastPayroll?.shortEmployeeIds).toHaveLength(2)
    expect(createViewSim(sim).payroll().short).toBe(false)
  })

  it('inactive vehicle finishes its trip and unloads first: the walked-out driver brings the cargo in, unloads every parcel, then parks inactive — never docked or dispatched again, no payroll line', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    sim.state.economy.balance = 10_000
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const v = sim.state.vehicles[0]!
    expect(runUntil(sim, () => v.cargo.length === 2)).toBeGreaterThan(0)
    const aboard = v.cargo.slice()
    const log = eventLog(sim)
    walkOut(sim, driverOf(sim, bike))
    expect(v.state).not.toBe('inactive') // mid-trip: it carries on
    expect(runUntil(sim, () => v.state === 'inactive', 3000)).toBeGreaterThan(0)
    const names = log.map((e) => e.name)
    const unloaded = log
      .filter((e) => e.name === 'parcel:unloaded')
      .map((e) => (e.p as { id: number }).id)
    expect(unloaded.toSorted()).toEqual(aboard.toSorted())
    expect(names.indexOf('vehicle:unloaded')).toBeGreaterThan(
      names.lastIndexOf('parcel:unloaded'),
    )
    expect(names.indexOf('vehicle:inactive')).toBeGreaterThan(
      names.indexOf('vehicle:unloaded'),
    )
    expect(names).not.toContain('parcel:loaded') // never loads again
    expect(v.cargo).toEqual([])
    expect(v.dockId).toBeNull()
    expect(sim.state.lane.docks[0]!.vehicleId).toBeNull()
    // work waiting everywhere: still never dispatched, docked or queued
    shelveParcel(sim, 'hr_towers_b', 'dt_cache_cafe')
    injectParcel(sim, 'dt_cache_cafe', 'hr_towers_b')
    const later = eventLog(sim)
    const paid = collect(sim, 'payroll:paid')
    runTicks(sim, 2 * TICKS_PER_DAY)
    expect(v.state).toBe('inactive')
    expect(
      later.filter(
        (e) =>
          e.name.startsWith('vehicle:') && (e.p as { id: number }).id === v.id,
      ),
    ).toEqual([])
    expect(sim.state.lane.dockQueue).not.toContain(v.id)
    // the inspector is paid; the walked-out driver has no line
    expect(paid).toEqual([{ amount: INSPECTOR }, { amount: INSPECTOR }])
    const lot = sim.data.map.lot.parking.map((t) => `${t[0]},${t[1]}`)
    expect(lot).toContain(`${Math.round(v.pos.tx)},${Math.round(v.pos.ty)}`)
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('a driver walking out while queued with nothing aboard leaves the queue and parks inactive at once', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    const b = buy(sim, 'bike')
    sim.state.economy.balance = 10_000
    for (let i = 0; i < 4; i++)
      shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runUntil(sim, () => sim.state.lane.dockQueue.includes(b.id), 200)
    const vb = sim.state.vehicles.find((x) => x.id === b.id)!
    expect(vb.state).toBe('queued')
    expect(vb.cargo).toEqual([])
    const lengths = collect(sim, 'dock:queueLength')
    walkOut(sim, driverOf(sim, vb))
    expect(vb.state).toBe('inactive')
    expect(sim.state.lane.dockQueue).not.toContain(b.id)
    expect(lengths.at(-1)?.n).toBe(sim.state.lane.dockQueue.length)
    expect(a.id).not.toBe(b.id)
    runTicks(sim, 300)
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('a driver walking out while the vehicle returns with nothing aboard: it parks inactive on arrival — never queues or docks (same rule as queued with nothing aboard)', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    sim.state.economy.balance = 10_000
    // one shelf parcel: load, deliver, nothing to collect → back home empty
    shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const v = sim.state.vehicles[0]!
    expect(runUntil(sim, () => v.state === 'returning', 3000)).toBeGreaterThan(
      0,
    )
    expect(v.cargo).toEqual([])
    const log = eventLog(sim)
    walkOut(sim, driverOf(sim, bike))
    expect(v.state).toBe('returning') // still driving home
    expect(runUntil(sim, () => v.state === 'inactive', 3000)).toBeGreaterThan(0)
    const mine = log
      .filter(
        (e) =>
          e.name.startsWith('vehicle:') && (e.p as { id: number }).id === v.id,
      )
      .map((e) => e.name)
    expect(mine).toEqual(['vehicle:inactive'])
    expect(sim.state.lane.dockQueue).not.toContain(v.id)
    expect(sim.state.lane.docks[0]!.vehicleId).toBeNull()
    runTicks(sim, 300)
    expect(v.state).toBe('inactive')
    expect(auditState(sim.state, data)).toEqual([])
  })
  it('a driver walking out while the vehicle waits in the dock with nothing aboard (the idle wait for its own parcels to clear the lane) parks inactive at once — it never loads a new outbound set and never leaves on a delivery trip', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    sim.state.economy.balance = 10_000
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const v = sim.state.vehicles[0]!
    // Collect, return, unload: then the dock idle wait (its parcel is in the lane).
    expect(
      runUntil(
        sim,
        () => v.state === 'docked_loading' && v.waitUntilTick !== null,
        3000,
      ),
    ).toBeGreaterThan(0)
    expect(v.cargo).toEqual([])
    const log = eventLog(sim)
    walkOut(sim, driverOf(sim, bike))
    expect(v.state).toBe('inactive')
    expect(sim.state.lane.docks[0]!.vehicleId).toBeNull()
    runTicks(sim, 600)
    const mine = log
      .filter(
        (e) =>
          e.name.startsWith('vehicle:') && (e.p as { id: number }).id === v.id,
      )
      .map((e) => e.name)
    expect(mine).toEqual(['vehicle:inactive'])
    expect(v.state).toBe('inactive')
    expect(sim.state.stats.deliveries).toBe(0)
    // The parcel cleared the lane and waits on the shelf for a driven vehicle.
    expect(laneNode(sim.state.lane, 'shelf')!.queue).toHaveLength(1)
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('…and one whose driver walks out between the idle-wait timer and the recompute (no walkout hook ran) leaves the dock inactive instead of loading', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    sim.state.economy.balance = 10_000
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const v = sim.state.vehicles[0]!
    expect(
      runUntil(
        sim,
        () => v.state === 'docked_loading' && v.waitUntilTick !== null,
        3000,
      ),
    ).toBeGreaterThan(0)
    // An older save: the driver already out, the vehicle still waiting.
    driverOf(sim, bike).active = false
    runTicks(sim, 600)
    expect(v.state).toBe('inactive')
    expect(sim.state.stats.deliveries).toBe(0)
    expect(auditState(sim.state, data)).toEqual([])
  })
})

describe('re-hire (spec §7.4) and the desk seats', () => {
  it("re-hire costs one day's salary and clears the mark: the driver drives again (inactive → idle_lot), the inspector takes a desk station again", () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    sim.state.economy.balance = 0
    const [insp] = inspectorIds(sim) as [number]
    toPayday(sim)
    toPayday(sim) // $0 twice: both walk out
    const v = sim.state.vehicles[0]!
    const driver = driverOf(sim, bike)
    expect(v.state).toBe('inactive')
    sim.state.economy.balance = 5
    expect(sim.dispatch({ kind: 'rehire', employeeId: driver.id })).toEqual({
      ok: false,
      reason: 'insufficient-funds',
    })
    expect(driver.active).toBe(false)
    sim.state.economy.balance = 100
    const money = collect(sim, 'money:changed')
    const hired = collect(sim, 'worker:hired')
    const parked = collect(sim, 'vehicle:parked')
    const vs = createViewSim(sim)
    expect(vs.rehireDriver(v.id)).toEqual({ ok: true })
    expect(money).toEqual([
      { delta: -salary('bike'), reason: 'hire', balance: 100 - salary('bike') },
    ])
    expect(hired).toEqual([
      {
        employeeId: driver.id,
        role: 'driver',
        nodeId: null,
        vehicleId: v.id,
        pips: { speed: 3, energy: 3, charisma: 0 },
        star: false,
        rehire: true,
      },
    ])
    expect(driver).toMatchObject({ active: true, unpaidPaydays: 0 })
    expect(parked).toEqual([{ id: v.id }])
    expect(v.state).toBe('idle_lot')
    // it works again
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(runUntil(sim, () => v.state === 'collecting', 50)).toBeGreaterThan(0)
    // the inspector, through the lane facade
    expect(vs.lane.rehire(insp)).toEqual({ ok: true })
    expect(money.at(-1)).toMatchObject({ delta: -INSPECTOR, reason: 'hire' })
    const desk = laneNode(sim.state.lane, 'slot1')!
    if (desk.fixture?.kind !== 'desk') throw new Error('no desk')
    expect(desk.fixture.inspectorIds).toEqual([insp])
    expect(desk.fixture.walkedOutIds).toEqual([])
    expect(desk.stations).toHaveLength(1)
    expect(employee(sim, insp)).toMatchObject({
      active: true,
      unpaidPaydays: 0,
    })
    // re-hiring someone on the payroll is not a thing
    expect(sim.dispatch({ kind: 'rehire', employeeId: insp })).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('hiring counts walked-out inspectors against maxPerDesk (they keep their seat for a re-hire)', () => {
    const sim = quietSim(1)
    sim.state.economy.balance = 1000
    const max = data.employees.desks.maxPerDesk
    for (let i = 1; i < max; i++) {
      expect(hireInspector(sim)).toMatchObject({ ok: true })
    }
    const [first] = inspectorIds(sim) as [number]
    walkOut(sim, employee(sim, first))
    expect(hireInspector(sim)).toEqual({
      ok: false,
      reason: 'desk-full',
    })
    expect(sim.dispatch({ kind: 'rehire', employeeId: first })).toEqual({
      ok: true,
    })
    const desk = laneNode(sim.state.lane, 'slot1')!
    expect(desk.stations).toHaveLength(max)
  })
})

describe('money and the clock (spec §7.2-§7.3)', () => {
  it('balance never negative: random fleets, hires and balances over 12 paydays (seeds 1-8)', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const sim = makeSim(seed)
      openingA(sim)
      let r = seed * 7919
      const rand = (): number => {
        r = (r * 1103515245 + 12345) % 2147483648
        return r / 2147483648
      }
      const paid = collect(sim, 'payroll:paid')
      for (let day = 0; day < 12; day++) {
        if (rand() < 0.4) buy(sim, rand() < 0.7 ? 'bike' : 'van')
        if (rand() < 0.4) {
          sim.state.economy.balance += 40
          hireInspector(sim)
        }
        sim.state.economy.balance = Math.floor(rand() * 60)
        for (let t = 0; t < TICKS_PER_DAY; t++) {
          sim.tick()
          const bal = sim.state.economy.balance
          expect(Number.isSafeInteger(bal) && bal >= 0, `seed ${seed}`).toBe(
            true,
          )
        }
      }
      expect(paid.reduce((s, p) => s + p.amount, 0)).toBe(
        sim.state.stats.payrollPaid,
      )
      expect(auditState(sim.state, data), `seed ${seed}`).toEqual([])
    }
  }, 30_000)

  it('ticksToPayday counts down to the day boundary (the Garage "Payday in 0:23")', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    expect(vs.ticksToPayday).toBe(TICKS_PER_DAY)
    runTicks(sim, 1)
    expect(vs.ticksToPayday).toBe(TICKS_PER_DAY - 1)
    runTicks(sim, TICKS_PER_DAY - 2)
    expect(ticksToPayday(sim.state, data)).toBe(1)
    runTicks(sim, 1)
    expect(vs.ticksToPayday).toBe(TICKS_PER_DAY)
  })

  it('walkouts and an inactive vehicle survive a JSON save round trip (same hash after 3 more days)', () => {
    const live = quietSim(3)
    buy(live, 'bike')
    live.state.economy.balance = 0
    toPayday(live)
    toPayday(live)
    expect(live.state.vehicles[0]!.state).toBe('inactive')
    const loaded = Sim.load(data, JSON.parse(JSON.stringify(live.snapshot())))
    for (const sim of [live, loaded]) {
      sim.state.economy.balance = 50
      sim.dispatch({ kind: 'rehire', employeeId: sim.state.employees[0]!.id })
      runTicks(sim, 3 * TICKS_PER_DAY)
    }
    expect(stateHash(loaded.state)).toBe(stateHash(live.state))
  })
  it('walkouts mid-trip, re-hires and the L2 level-up survive JSON round trips (randomized starved economy, seeds 1-8; a save on the tick after each driver walkout): every reload = the uninterrupted run, seed + log replay = the same hash, inactive vehicles never docked or queued, balance never negative', () => {
    // L2 at lifetime $400 so the level boundary falls inside the run.
    const ovr = {
      economy: { startMoney: 500 },
      levels: [{}, { threshold: 400 }],
    }
    const seen = { walkouts: 0, levelUps: 0, midTrip: 0, acrossLevelUp: 0 }
    for (let seed = 1; seed <= 8; seed++) {
      let a = (seed * 2654435761) >>> 0
      const r = (): number => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      const pick = <T>(xs: readonly T[]): T | undefined =>
        xs[Math.floor(r() * xs.length)]
      const live = makeSim(seed, ovr)
      live.addTap((name) => {
        if (name === 'worker:walkedOut') seen.walkouts += 1
        if (name === 'level:up') seen.levelUps += 1
      })
      const slots = ['slot1', 'slot2', 'slot3', 'slot4']
      const command = (): Command | null => {
        const s = live.state
        const held = laneNode(s.lane, 'hold')!.queue
        const k = r()
        if (k < 0.35 && held.length > 0) {
          return { kind: r() < 0.8 ? 'toss' : 'clear', parcelId: pick(held)! }
        }
        if (k < 0.5) {
          const e = pick(s.employees.filter((x) => !x.active))
          return e ? { kind: 'rehire', employeeId: e.id } : null
        }
        if (k < 0.66) {
          // M6: a pool driver (replay-safe), or now and then "Hire later".
          return {
            kind: 'buyVehicle',
            type: pick(['bike', 'bike', 'truck'] as const)!,
            applicantId:
              r() < 0.9 ? (s.applicants.driver[0]?.id ?? null) : null,
          }
        }
        if (k < 0.74) {
          return {
            kind: 'buyMachine',
            defId: pick(['metal_detector', 'shaky_shaker'])!,
            nodeId: pick(slots)!,
          }
        }
        if (k < 0.8) {
          const desk = s.lane.nodes.find((n) => n.fixture?.kind === 'desk')
          const hiree = s.applicants.inspector[0]
          return desk && hiree
            ? {
                kind: 'hire',
                role: 'inspector',
                applicantId: hiree.id,
                target: { nodeId: desk.id },
              }
            : null
        }
        if (k < 0.84) {
          const e = pick(s.employees.filter((x) => x.role === 'inspector'))
          return e ? { kind: 'fire', employeeId: e.id } : null
        }
        if (k < 0.88) {
          return { kind: 'moveFixture', from: pick(slots)!, to: pick(slots)! }
        }
        if (k < 0.92) {
          const v = pick(s.vehicles)
          return v ? { kind: 'sellVehicle', id: v.id } : null
        }
        const b = pick(
          Object.values(s.buildings).filter((x) => x.waiting.length > 0),
        )
        return b ? { kind: 'rush', buildingId: b.id } : null
      }
      const end = 14 * TICKS_PER_DAY
      // a save every 1.5 days from day 2 (some at L1 before the level-up),
      // plus one on the tick after every driver walkout (vehicle mid-trip)
      const saveAt = Array.from(
        { length: 8 },
        (_, i) => 2 * TICKS_PER_DAY + i * 900 + Math.floor(r() * 900),
      )
      const snaps: string[] = []
      const midTrip = (): boolean =>
        live.state.vehicles.some(
          (v) =>
            v.state !== 'inactive' &&
            live.state.employees.some((e) => e.id === v.driverId && !e.active),
        )
      let walkedOutAt = -1
      live.addTap((name, p) => {
        if (
          name === 'worker:walkedOut' &&
          (p as { role: string }).role === 'driver'
        ) {
          walkedOutAt = live.state.tick
        }
      })
      for (let t = 0; t < end; t++) {
        const afterWalkout = walkedOutAt >= 0 && live.state.tick === walkedOutAt
        if (saveAt.includes(t) || (afterWalkout && midTrip())) {
          snaps.push(JSON.stringify(live.snapshot()))
          if (midTrip()) seen.midTrip += 1
        }
        if (r() < 0.04) {
          const cmd = command()
          if (cmd) live.dispatch(cmd)
        }
        live.tick()
        expect(live.state.economy.balance).toBeGreaterThanOrEqual(0)
        for (const v of live.state.vehicles) {
          if (v.state !== 'inactive') continue
          expect(v.dockId).toBeNull()
          expect(live.state.lane.dockQueue).not.toContain(v.id)
        }
        if (t % TICKS_PER_DAY === 0) {
          expect(
            auditState(live.state, live.data),
            `seed ${seed} @${t}`,
          ).toEqual([])
        }
      }
      for (const snap of snaps) {
        const loaded = Sim.load(live.data, JSON.parse(snap))
        const rest = live.commandLog.filter((e) => e.tick >= loaded.state.tick)
        let i = 0
        while (loaded.state.tick < end) {
          while (i < rest.length && rest[i]!.tick === loaded.state.tick) {
            loaded.dispatch(rest[i]!.cmd)
            i += 1
          }
          loaded.tick()
        }
        expect(stateHash(loaded.state), `seed ${seed}`).toBe(
          stateHash(live.state),
        )
      }
      // snapshots taken at L1 in a run that reached L2: round trips across the level-up
      if (live.state.level.level === 2) {
        seen.acrossLevelUp += snaps.filter(
          (x) =>
            (JSON.parse(x) as { state: { level: { level: number } } }).state
              .level.level === 1,
        ).length
      }
      const again = replay(live.data, seed, live.commandLog, end)
      expect(stateHash(again.state), `seed ${seed} replay`).toBe(
        stateHash(live.state),
      )
    }
    expect(seen.walkouts).toBeGreaterThan(0)
    expect(seen.levelUps).toBeGreaterThanOrEqual(6)
    expect(seen.acrossLevelUp).toBeGreaterThan(0)
    expect(seen.midTrip).toBeGreaterThan(0)
  }, 60_000)
})
