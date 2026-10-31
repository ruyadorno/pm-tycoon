// spec §4.1-§4.2, §4.6 vehicles: every state transition fires its enter
// event, movement along cached paths at class speed with prev/pos, headings
// and the wheel frame, 1.5 s stops, buy on a free parking tile, the last
// vehicle unsellable, sell from any state returning cargo past cap (inbound
// onto the dock conveyor, outbound to the shelf) and freeing dock / queue /
// reservations / driver.

import { describe, expect, it } from 'vitest'
import type { SimEventName } from '../../src/sim/events.ts'
import type { Sim } from '../../src/sim/sim.ts'
import { auditState } from '../../src/sim/sim.ts'
import {
  hasDriver,
  MILLI,
  removeVehicle,
} from '../../src/sim/systems/vehicles.ts'
import { laneNode } from '../../src/sim/types.ts'
import type { VehicleState } from '../../src/sim/types.ts'
import {
  buy,
  collect,
  dataFixture,
  injectParcel,
  quietSim,
  runTicks,
  runUntil,
  shelveParcel,
  vehicleById,
} from './helpers.ts'

const data = dataFixture()

const VEHICLE_EVENTS: SimEventName[] = [
  'vehicle:bought',
  'vehicle:parked',
  'vehicle:queued',
  'vehicle:docked',
  'vehicle:unloaded',
  'vehicle:departed',
  'vehicle:collecting',
  'vehicle:returning',
  'vehicle:inactive',
  'vehicle:sold',
]

/** vehicle:* events with the vehicle's state when each fired. */
function stateLog(sim: Sim): { name: string; state: VehicleState | null }[] {
  const out: { name: string; state: VehicleState | null }[] = []
  sim.addTap((name, p) => {
    if (!VEHICLE_EVENTS.includes(name)) return
    const id = (p as { id: number }).id
    out.push({
      name,
      state: sim.state.vehicles.find((v) => v.id === id)?.state ?? null,
    })
  })
  return out
}

describe('vehicle state machine (spec §4.6)', () => {
  it('every transition fires its enter event: bought → collecting → returning → queued → docked → unloaded → departed → returning → … → parked', () => {
    const sim = quietSim(1)
    const log = stateLog(sim)
    const bike = buy(sim, 'bike')
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runUntil(sim, () => log.at(-1)?.name === 'vehicle:parked', 3000)
    expect(log).toEqual([
      { name: 'vehicle:bought', state: 'idle_lot' },
      { name: 'vehicle:collecting', state: 'collecting' },
      { name: 'vehicle:returning', state: 'returning' },
      { name: 'vehicle:queued', state: 'queued' },
      { name: 'vehicle:docked', state: 'docked_unloading' },
      { name: 'vehicle:unloaded', state: 'docked_loading' },
      { name: 'vehicle:departed', state: 'delivering' },
      // empty after the last stop, nothing to collect: back to the dock (§4.5 step 5)
      { name: 'vehicle:returning', state: 'returning' },
      { name: 'vehicle:queued', state: 'queued' },
      { name: 'vehicle:docked', state: 'docked_unloading' },
      { name: 'vehicle:unloaded', state: 'docked_loading' },
      { name: 'vehicle:parked', state: 'idle_lot' },
    ])
    expect(vehicleById(sim, bike.id).dockId).toBeNull()
    expect(sim.state.lane.docks[0]?.vehicleId).toBeNull()
  })

  it('idle_lot → queued when only an eligible shelf parcel exists; docked_loading → collecting when parcels wait', () => {
    const sim = quietSim(1)
    const log = stateLog(sim)
    buy(sim, 'bike')
    shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runTicks(sim, 10)
    expect(log.map((e) => e.name)).toEqual(['vehicle:bought', 'vehicle:queued'])
    // while it drives in, a parcel appears to collect: after loading + delivering it collects
    injectParcel(sim, 'dt_cache_cafe', 'hr_towers_a')
    runUntil(sim, () => log.some((e) => e.name === 'vehicle:collecting'), 3000)
    expect(log.map((e) => e.name).slice(0, 6)).toEqual([
      'vehicle:bought',
      'vehicle:queued',
      'vehicle:docked',
      'vehicle:unloaded',
      'vehicle:departed',
      'vehicle:collecting',
    ])
  })

  it('collecting: a vehicle sent from idle_lot that ends up collecting nothing (its parcels reserved by others meanwhile) → idle_lot', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runTicks(sim, 10) // idle pass → collecting, p reserved
    const v = vehicleById(sim, bike.id)
    expect(v.state).toBe('collecting')
    expect(v.reserved).toEqual([p.id])
    // meanwhile another vehicle claims it
    v.reserved = []
    p.reservedBy = 999
    const log = stateLog(sim)
    runUntil(sim, () => log.length > 0, 600)
    expect(log).toEqual([{ name: 'vehicle:parked', state: 'idle_lot' }])
    expect(v.cargo).toEqual([])
    expect(sim.state.buildings.hr_towers_a?.waiting).toEqual([p.id])
  })

  it('docked_loading with nothing to load and no lane parcels leaves at once: → collecting when parcels wait in its zone', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    const lure = shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runTicks(sim, 10) // idle pass: queued for the shelf parcel
    expect(vehicleById(sim, bike.id).state).toBe('queued')
    lure.reservedBy = 999 // gone before it docks (another dock's set)
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    const log = stateLog(sim)
    runUntil(sim, () => log.some((e) => e.name === 'vehicle:collecting'), 300)
    expect(log.map((e) => e.name)).toEqual([
      'vehicle:docked',
      'vehicle:unloaded',
      'vehicle:collecting',
    ])
    expect(vehicleById(sim, bike.id).dockId).toBeNull()
    expect(sim.state.lane.docks[0]?.vehicleId).toBeNull()
    expect(vehicleById(sim, bike.id).stops[0]?.buildingId).toBe(
      'dt_registry_tower',
    )
  })
})

describe('movement (spec §4.2)', () => {
  it('moves speedTilesPerS / 10 per tick along a 4-connected path; prev = last tick; heading from the edge; wheel toggles every 2 ticks', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runUntil(sim, () => vehicleById(sim, bike.id).path.length > 0, 20)
    const v = vehicleById(sim, bike.id)
    const step =
      data.vehicles.types.find((t) => t.id === 'bike')!.speedTilesPerS / 10
    const wheels: number[] = []
    for (let i = 0; i < 40; i++) {
      const before = { ...v.pos }
      sim.tick()
      expect(v.prev).toEqual(before)
      const d = Math.abs(v.pos.tx - before.tx) + Math.abs(v.pos.ty - before.ty)
      expect(d).toBeCloseTo(step, 6)
      const dx = v.pos.tx - before.tx
      const dy = v.pos.ty - before.ty
      const heading =
        Math.abs(dx) > 1e-9 ? (dx > 0 ? 'SE' : 'NW') : dy > 0 ? 'SW' : 'NE'
      expect(v.heading).toBe(heading)
      wheels.push(v.wheel)
    }
    expect(Number.isInteger(v.edgeT)).toBe(true)
    expect(v.edgeT).toBeLessThan(MILLI)
    // toggles every 2 ticks
    expect(new Set(wheels).size).toBe(2)
    for (let i = 2; i < wheels.length; i++) {
      expect(wheels[i]).toBe(1 - (wheels[i - 2] as number))
    }
  })

  it('stops 1.5 s at a building anchor: pickup on arrival, then stopS × 10 full stationary ticks (the leg logic runs as the stop ends, it moves on the tick after)', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const picked = collect(sim, 'parcel:pickedUp')
    runUntil(sim, () => picked.length > 0)
    const t0 = sim.state.tick
    const v = vehicleById(sim, bike.id)
    const anchor = { tx: 19, ty: 29 } // Node Heights Towers A anchor
    const stopTicks = data.vehicles.stopS * 10
    expect(v.pos).toEqual(anchor)
    expect(v.waitUntilTick).toBe(t0 + stopTicks)
    expect(sim.state.parcels[String(p.id)]?.state).toBe('picked_up')
    // the same convention as the dock (1 parcel/s = 10 stationary ticks per
    // parcel): a 1.5 s stop is 15 ticks in which the vehicle does not move
    for (let i = 1; i <= stopTicks; i++) {
      sim.tick()
      expect(v.prev, `tick +${i}`).toEqual(anchor)
      expect(v.pos, `tick +${i}`).toEqual(anchor)
    }
    expect(v.state).toBe('returning') // the stop ended at t0 + stopTicks
    runTicks(sim, 1)
    expect(v.pos).not.toEqual(anchor)
  })
})

describe('buy / sell (spec §4.1)', () => {
  it('buy: pops in idle on a free parking tile, zone any, driver hired; a second one takes the next tile', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    const b = buy(sim, 'bike')
    const parking = data.map.lot.parking
    expect(a).toMatchObject({ state: 'idle_lot', zone: 'any', name: 'Bike 1' })
    expect([a.pos.tx, a.pos.ty]).toEqual(parking[0])
    expect([b.pos.tx, b.pos.ty]).toEqual(parking[1])
    const driver = sim.state.employees.find((e) => e.vehicleId === a.id)
    expect(driver).toMatchObject({
      role: 'driver',
      salaryPerDay: 8,
      active: true,
    })
  })

  it('the last vehicle cannot be sold', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    expect(sim.dispatch({ kind: 'sellVehicle', id: a.id })).toEqual({
      ok: false,
      reason: 'last-vehicle',
    })
    expect(sim.dispatch({ kind: 'sellVehicle', id: 99 })).toEqual({
      ok: false,
      reason: 'no-vehicle',
    })
  })

  it('sell returns carried parcels past cap — inbound ones onto the dock conveyor (§6.4: never waved through), outbound ones to the shelf — frees the dock and reservations, removes the driver', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    buy(sim, 'bike')
    const shelf = laneNode(sim.state.lane, 'shelf')!
    const conv = laneNode(sim.state.lane, 'conv1')!
    for (let i = 0; i < shelf.cap!; i++)
      shelveParcel(sim, 'dt_cache_cafe', 'dt_bundle_boutique', { size: 'L' })
    const p1 = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      malware: true,
    })
    const p2 = injectParcel(sim, 'hr_towers_a', 'dt_registry_tower')
    const picked = collect(sim, 'parcel:pickedUp')
    runUntil(sim, () => picked.length === 2)
    while (conv.queue.length < conv.cap!) {
      const q = injectParcel(sim, 'dt_cache_cafe', 'hr_towers_b')
      const b = sim.state.buildings.dt_cache_cafe!
      b.waiting.splice(b.waiting.indexOf(q.id), 1)
      conv.queue.push(q.id)
      q.state = 'in_conveyor'
      q.nodeId = conv.id
    }
    // an outbound parcel aboard too (loaded at the dock earlier)
    const out = shelveParcel(sim, 'hr_towers_b', 'dt_peer_plaza')
    shelf.queue.pop()
    const va = vehicleById(sim, a.id)
    va.cargo.push(out.id)
    va.unitsUsed += 1
    Object.assign(out, {
      state: 'in_transit_out',
      nodeId: null,
      vehicleId: a.id,
    })
    // a third parcel reserved by the same bike elsewhere
    const p3 = injectParcel(sim, 'hr_towers_b', 'dt_cache_cafe')
    p3.reservedBy = a.id
    va.reserved.push(p3.id)
    const returned = collect(sim, 'parcel:returned')
    const unloaded = collect(sim, 'parcel:unloaded')
    const sold = collect(sim, 'vehicle:sold')
    expect(sim.dispatch({ kind: 'sellVehicle', id: a.id })).toEqual({
      ok: true,
    })
    expect(returned.map((r) => r.id)).toEqual([out.id])
    expect(shelf.queue.length).toBe(shelf.cap! + 1)
    expect(sim.state.parcels[String(out.id)]).toMatchObject({
      state: 'on_shelf',
      vehicleId: null,
    })
    expect(unloaded).toEqual([
      { id: p1.id, dockId: 'dock1' },
      { id: p2.id, dockId: 'dock1' },
    ])
    expect(conv.queue.length).toBe(conv.cap! + 2)
    expect(sim.state.parcels[String(p1.id)]).toMatchObject({
      state: 'in_conveyor',
      vehicleId: null,
    })
    expect(sim.state.parcels[String(p1.id)]?.trace.at(-1)).toMatchObject({
      what: 'unloaded',
      text: 'Unloaded (Bike 1 sold)',
    })
    expect(sim.state.parcels[String(p3.id)]?.reservedBy).toBeNull()
    expect(sold).toEqual([{ id: a.id }])
    expect(sim.state.vehicles.map((v) => v.id)).not.toContain(a.id)
    expect(sim.state.employees.some((e) => e.vehicleId === a.id)).toBe(false)
    expect(auditState(sim.state, data)).toEqual([])
    // the malware parcel still meets the desk: it never reaches the shelf unchecked
    const flagged = collect(sim, 'parcel:flagged')
    const shelved = collect(sim, 'parcel:shelved')
    shelf.cap = 1000
    runUntil(
      sim,
      () =>
        sim.state.parcels[String(p1.id)]?.state !== 'in_conveyor' &&
        sim.state.parcels[String(p1.id)]?.state !== 'in_slot',
      3000,
    )
    const p1Now = sim.state.parcels[String(p1.id)]!
    expect(
      p1Now.trace.some((t) => t.ref === 'slot1' && t.chk !== undefined),
    ).toBe(true)
    expect(
      flagged.some((f) => f.id === p1.id) ||
        shelved.some((x) => x.id === p1.id),
    ).toBe(true)
  })

  it('selling a docked vehicle frees the dock at once; selling a queued one leaves the queue', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    const b = buy(sim, 'bike')
    buy(sim, 'bike')
    shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runUntil(sim, () => vehicleById(sim, a.id).state === 'docked_loading')
    expect(sim.state.lane.dockQueue).toContain(b.id)
    sim.dispatch({ kind: 'sellVehicle', id: a.id })
    expect(sim.state.lane.docks[0]?.vehicleId).toBeNull()
    sim.dispatch({ kind: 'sellVehicle', id: b.id })
    expect(sim.state.lane.dockQueue).not.toContain(b.id)
    runTicks(sim, 5)
    expect(sim.state.lane.docks[0]?.vehicleId).not.toBeNull() // the next in line took it
  })

  it.todo(
    'inactive after the next unload once the driver walked out (spec §4.6, §7.4 — M3 payroll)',
  )
})

describe('build 3: absence and removeVehicle (B3 §3.5)', () => {
  it('hasDriver is false while the vehicle is away (absentUntilTick > tick), true again at the tick it ends', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    expect(hasDriver(sim, bike)).toBe(true)
    bike.absentUntilTick = sim.state.tick + 5
    expect(hasDriver(sim, bike)).toBe(false)
    runTicks(sim, 5)
    expect(hasDriver(sim, bike)).toBe(true)
  })

  it('removeVehicle: sold = the drivers leave silently with the refund; lost = worker:fired {event}, no refund; neither emits vehicle:sold', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    const b = buy(sim, 'bike')
    const fired = collect(sim, 'worker:fired')
    const sold = collect(sim, 'vehicle:sold')
    const money = collect(sim, 'money:changed')
    const goneA = removeVehicle(sim, a, { refund: true, why: 'sold' })
    expect(goneA.map((e) => e.vehicleId)).toEqual([a.id])
    expect(fired).toEqual([])
    expect(money).toEqual([
      {
        delta: Math.round(a.purchasePrice * data.economy.sellRefund),
        reason: 'refund',
        balance: sim.state.economy.balance,
      },
    ])
    const before = sim.state.economy.balance
    const goneB = removeVehicle(sim, b, { refund: false, why: 'lost' })
    expect(fired.map((f) => [f.employeeId, f.reason])).toEqual([
      [goneB[0]!.id, 'event'],
    ])
    expect(sim.state.economy.balance).toBe(before)
    expect(sold).toEqual([])
    expect(sim.state.vehicles).toEqual([])
    expect(sim.state.employees.some((e) => e.role === 'driver')).toBe(false)
    expect(auditState(sim.state, data)).toEqual([])
  })
})
