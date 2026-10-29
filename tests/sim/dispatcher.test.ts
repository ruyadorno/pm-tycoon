// spec §4.5 greedy dispatcher + §4.1 rush + §4.6 dock idle wait: outbound
// set (rushed first then oldest; zone / allowed / size / units filters;
// target-region fill), nearest-neighbour delivery stops, the 12-tile collect
// radius vs the first pickup, reservations, the idle pass (collect / queue /
// stay), the dock idle wait ending when a vehicle queues, Industrial =
// trucks only, rush retarget / flag / reasons / expiry.

import { describe, expect, it } from 'vitest'
import {
  collectCandidates,
  deliveryStops,
  outboundSet,
  pickCollectTarget,
} from '../../src/sim/systems/dispatch.ts'
import { joinQueue, originTile } from '../../src/sim/systems/vehicles.ts'
import { laneNode, TICKS_PER_S } from '../../src/sim/types.ts'
import {
  buy,
  collect,
  dataFixture,
  injectParcel,
  makeSim,
  quietSim,
  runTicks,
  runUntil,
  shelveParcel,
  unlockDistrict,
  vehicleById,
} from './helpers.ts'

const data = dataFixture()

describe('§4.5 step 1 — the outbound set', () => {
  it('rushed destinations first, then oldest spawn', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    sim.state.tick = 1000
    const young = shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      spawnedTick: 900,
    })
    const old = shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      spawnedTick: 100,
    })
    const mid = shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      spawnedTick: 500,
    })
    const rushedDest = shelveParcel(sim, 'hr_towers_a', 'dt_bundle_boutique', {
      spawnedTick: 950,
    })
    sim.state.buildings.dt_bundle_boutique!.rushUntilTick = 1600
    expect(outboundSet(sim, bike)).toEqual([
      rushedDest.id,
      old.id,
      mid.id,
      young.id,
    ])
  })

  it('filters: zone, the destination region allows the type, size allowed, units fit', () => {
    const sim = quietSim(1)
    unlockDistrict(sim, 'industrial')
    const bike = buy(sim, 'bike')
    const toIndustrial = shelveParcel(
      sim,
      'dt_cache_cafe',
      'in_lodash_smelting',
    )
    const large = shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      size: 'L',
    })
    const toHeights = shelveParcel(sim, 'dt_cache_cafe', 'hr_towers_a')
    const toDowntown = shelveParcel(sim, 'hr_towers_a', 'dt_registry_tower')
    expect(outboundSet(sim, bike)).toEqual([toHeights.id, toDowntown.id])
    bike.zone = 'downtown'
    expect(outboundSet(sim, bike)).toEqual([toDowntown.id])
    const truck = buy(sim, 'truck')
    // target region Industrial (oldest), then the rest in age order
    expect(outboundSet(sim, truck)).toEqual([
      toIndustrial.id,
      large.id,
      toHeights.id,
      toDowntown.id,
    ])
  })

  it('target region = the first candidate’s; fill it first, then any other permitted region, until units are full', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike') // 4 units
    const a = shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      spawnedTick: 0,
    })
    const b = shelveParcel(sim, 'dt_cache_cafe', 'hr_towers_b', {
      spawnedTick: 1,
      size: 'M',
    })
    const c = shelveParcel(sim, 'hr_towers_b', 'dt_registry_tower', {
      spawnedTick: 2,
    })
    const d = shelveParcel(sim, 'dt_cache_cafe', 'hr_towers_a', {
      spawnedTick: 3,
    })
    const e = shelveParcel(sim, 'hr_towers_a', 'dt_bundle_boutique', {
      spawnedTick: 4,
      size: 'M',
    })
    // downtown (a's region): a (1) + c (1) + e (2) = 4 units — full before Node Heights
    expect(outboundSet(sim, bike)).toEqual([a.id, c.id, e.id])
    e.reservedBy = 99
    expect(outboundSet(sim, bike)).toEqual([a.id, c.id, b.id])
    expect(d.id).toBeGreaterThan(0)
  })

  it('reserved shelf parcels are never in another vehicle’s set', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    const p = shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    p.reservedBy = 42
    expect(outboundSet(sim, a)).toEqual([])
  })
})

describe('§4.5 steps 3-4 — stops and collection', () => {
  it('deliver stops in nearest-neighbour order from the dock (ties → lower building id)', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    const far = injectParcel(sim, 'dt_cache_cafe', 'hr_buffer_block')
    const near = injectParcel(sim, 'dt_cache_cafe', 'hr_towers_a')
    const mid = injectParcel(sim, 'dt_cache_cafe', 'hr_callback_court')
    bike.cargo = [far.id, near.id, mid.id]
    const stops = deliveryStops(sim, bike, { x: 20, y: 22 })
    // (19,29) Towers A, then (19,33) Callback Court, then (43,21) Buffer Block
    expect(stops.map((s) => s.buildingId)).toEqual([
      'hr_towers_a',
      'hr_callback_court',
      'hr_buffer_block',
    ])
    expect(stops.every((s) => s.kind === 'deliver')).toBe(true)
    // two buildings on one anchor: lower buildings.json row first
    const x = injectParcel(sim, 'hr_towers_a', 'dt_hoist_insurance')
    const y = injectParcel(sim, 'hr_towers_a', 'dt_semver_bank')
    bike.cargo = [x.id, y.id]
    expect(
      deliveryStops(sim, bike, { x: 19, y: 23 }).map((s) => s.buildingId),
    ).toEqual(['dt_semver_bank', 'dt_hoist_insurance'])
  })

  it('12-tile radius: the first pickup of a leg may be any distance; later ones must be within collectRadiusTiles', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    // Measure from the lot entrance, not from whichever parking slot it got.
    bike.pos = { tx: 19, ty: 23 }
    bike.prev = { tx: 19, ty: 23 }
    injectParcel(sim, 'hr_buffer_block', 'dt_cache_cafe') // anchor (43,21)
    const lot = originTile(bike)
    expect(sim.paths.distance(lot, { x: 43, y: 21 })).toBeGreaterThan(
      data.vehicles.collectRadiusTiles,
    )
    expect(pickCollectTarget(sim, bike)?.buildingId).toBe('hr_buffer_block')
    bike.collectedThisLeg = true
    expect(pickCollectTarget(sim, bike)).toBeNull()
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe') // (19,29): 6 tiles away
    expect(pickCollectTarget(sim, bike)?.buildingId).toBe('hr_towers_a')
  })

  it('nearest first; ties → more parcels waiting, then lower building id', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    // dt_semver_bank and dt_hoist_insurance share the anchor (27,13)
    injectParcel(sim, 'dt_hoist_insurance', 'hr_towers_a')
    injectParcel(sim, 'dt_semver_bank', 'hr_towers_a')
    expect(pickCollectTarget(sim, bike)?.buildingId).toBe('dt_semver_bank')
    injectParcel(sim, 'dt_hoist_insurance', 'hr_towers_a')
    expect(pickCollectTarget(sim, bike)?.buildingId).toBe('dt_hoist_insurance')
  })

  it('reservations: two vehicles never target the same parcel; a full vehicle has no candidates', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    const b = buy(sim, 'bike')
    const p1 = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { size: 'M' })
    const p2 = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { size: 'M' })
    const p3 = injectParcel(sim, 'hr_towers_b', 'dt_cache_cafe')
    runTicks(sim, 10) // idle pass
    const va = vehicleById(sim, a.id)
    const vb = vehicleById(sim, b.id)
    expect(va.state).toBe('collecting')
    expect(va.reserved.toSorted()).toEqual([p1.id, p2.id])
    expect(vb.state).toBe('collecting')
    expect(vb.reserved).toEqual([p3.id])
    expect(sim.state.parcels[String(p1.id)]?.reservedBy).toBe(a.id)
    expect(collectCandidates(sim, va, originTile(va), true)).toEqual([])
  })

  it('Industrial is trucks only: a bike never collects there nor takes an Industrial-bound parcel; a truck does', () => {
    const sim = quietSim(1)
    unlockDistrict(sim, 'industrial')
    const bike = buy(sim, 'bike')
    injectParcel(sim, 'in_lodash_smelting', 'dt_cache_cafe')
    expect(collectCandidates(sim, bike, originTile(bike), true)).toEqual([])
    runTicks(sim, 100)
    expect(vehicleById(sim, bike.id).state).toBe('idle_lot')
    const truck = buy(sim, 'truck')
    expect(pickCollectTarget(sim, truck)?.buildingId).toBe('in_lodash_smelting')
    expect(
      sim.dispatch({ kind: 'setZone', id: bike.id, zone: 'industrial' }),
    ).toEqual({
      ok: false,
      reason: 'trucks-only',
    })
  })
})

describe('§4.5 step 2 — the idle pass, and the dock idle wait (§4.6)', () => {
  it('idle pass every dispatchTickS: collect if parcels wait in its zone, else queue for an eligible shelf parcel, else stay', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    runTicks(sim, 30)
    expect(vehicleById(sim, a.id).state).toBe('idle_lot')
    shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const queued = collect(sim, 'vehicle:queued')
    runTicks(sim, 9)
    expect(queued).toEqual([])
    runTicks(sim, 1) // tick 40: a dispatcher tick
    expect(queued).toEqual([{ id: a.id, position: 0 }])
    const b = buy(sim, 'bike')
    vehicleById(sim, b.id).zone = 'highres'
    injectParcel(sim, 'dt_cache_cafe', 'hr_towers_a') // downtown: outside b's zone
    runTicks(sim, 10)
    expect(vehicleById(sim, b.id).state).toBe('idle_lot')
    injectParcel(sim, 'hr_towers_b', 'dt_cache_cafe')
    runTicks(sim, 10)
    expect(vehicleById(sim, b.id).state).toBe('collecting')
  })

  it('dock idle wait: nothing to load but carriable parcels still in the lane → waits up to dockIdleWaitS, ends at once when a vehicle queues', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    const b = buy(sim, 'bike')
    vehicleById(sim, b.id).zone = 'highres' // b stays put for now
    laneNode(sim.state.lane, 'shelf')!.cap = 0 // the lane backs up: parcels stay in it
    injectParcel(sim, 'dt_cache_cafe', 'hr_towers_a')
    const unloaded = collect(sim, 'vehicle:unloaded')
    runUntil(sim, () => unloaded.length > 0)
    const va = vehicleById(sim, a.id)
    expect(va.state).toBe('docked_loading')
    expect(va.waitUntilTick).toBe(
      sim.state.tick + data.vehicles.dockIdleWaitS * TICKS_PER_S,
    )
    runTicks(sim, 30)
    expect(va.state).toBe('docked_loading') // still waiting
    joinQueue(sim, vehicleById(sim, b.id))
    runTicks(sim, 1)
    expect(va.state).not.toBe('docked_loading')
    expect(va.dockId).toBeNull()
    expect(sim.state.lane.docks[0]?.vehicleId).toBe(b.id)
  })

  // KNOWN SPEC GAP (sim review, reported to the orchestrator): §4.6 claims
  // "with one dock and two bikes the cycle cannot deadlock", but §6.4 / §1
  // ("Stall") make a docked vehicle keep waiting while the conveyor is full,
  // and only a docked vehicle that finished unloading may load (§4.6
  // docked_loading, "never interleaved"). Once the shelf is at cap with
  // parcels nobody loads (all bikes zoned to one district at L1; Industrial
  // parcels without a truck at L2) the conveyor fills, the docked vehicle can
  // never finish unloading, nobody can load, and the shelf never drains —
  // permanently, even after the player fixes the zones (or buys a truck,
  // which queues behind it). Every fix contradicts one of those sentences, so
  // it needs a design call; un-skip this once one lands.
  it.skip('§4.6 one dock cannot deadlock: a full shelf never strands the docked vehicle once the fleet can carry the shelf again', () => {
    const sim = makeSim(2)
    const bikes = [buy(sim, 'bike'), buy(sim, 'bike'), buy(sim, 'bike')]
    for (const b of bikes) {
      sim.dispatch({ kind: 'setZone', id: b.id, zone: 'highres' })
    }
    // highres bikes bank downtown-bound parcels on the shelf until it is
    // full, then the conveyor fills behind it and the docked bike is stuck
    const conv = laneNode(sim.state.lane, 'conv1')!
    const stuck = (): boolean =>
      sim.state.lane.stallReason === 'shelfFull' &&
      conv.queue.length === conv.cap &&
      sim.state.vehicles.some((v) => v.state === 'docked_unloading')
    expect(runUntil(sim, stuck, 600 * 30)).toBeGreaterThan(0)
    for (const b of bikes) {
      sim.dispatch({ kind: 'setZone', id: b.id, zone: 'any' })
    }
    const before = sim.state.stats.deliveries
    runTicks(sim, 600 * 5)
    expect(sim.state.stats.deliveries).toBeGreaterThan(before)
    expect(sim.state.lane.stalled).toBe(false)
  })

  it('§6.5 dock:occupancy {dockId, pct} fires once per in-game minute: the share of the minute a vehicle held the dock', () => {
    const sim = quietSim(1)
    buy(sim, 'bike')
    for (let i = 0; i < 4; i++) {
      shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    }
    const occ = collect(sim, 'dock:occupancy')
    let busy = 0
    for (let t = 0; t < 2 * 600; t++) {
      sim.tick()
      if (t < 600 && sim.state.lane.docks[0]?.vehicleId !== null) busy += 1
    }
    expect(occ).toHaveLength(2)
    expect(busy).toBeGreaterThan(0)
    expect(occ[0]).toEqual({
      dockId: 'dock1',
      pct: Math.round((100 * busy) / 600),
    })
    expect(occ[1]).toEqual({ dockId: 'dock1', pct: 0 }) // nothing docked in minute 2
  })

  it('without a queue the idle wait lasts dockIdleWaitS, then recomputes once and leaves', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    laneNode(sim.state.lane, 'shelf')!.cap = 0
    injectParcel(sim, 'dt_cache_cafe', 'hr_towers_a')
    const unloaded = collect(sim, 'vehicle:unloaded')
    runUntil(sim, () => unloaded.length > 0)
    const t0 = sim.state.tick
    const parked = collect(sim, 'vehicle:parked')
    runUntil(sim, () => parked.length > 0, 400)
    expect(sim.state.tick - t0).toBe(data.vehicles.dockIdleWaitS * TICKS_PER_S)
    expect(vehicleById(sim, a.id).state).toBe('idle_lot')
  })
})

describe('rush (spec §4.1)', () => {
  it('retargets the nearest eligible vehicle (road distance) and flags the building for rushExpireS', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike') // parking[0] (26,25)
    const b = buy(sim, 'bike') // parking[1] (26,24): one tile further
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const rushed = collect(sim, 'building:rushed')
    const res = sim.dispatch({ kind: 'rush', buildingId: 'hr_towers_a' })
    expect(res).toEqual({ ok: true, vehicleId: a.id })
    const until = sim.state.tick + data.vehicles.rushExpireS * TICKS_PER_S
    expect(rushed).toEqual([
      { buildingId: 'hr_towers_a', vehicleId: a.id, untilTick: until },
    ])
    expect(vehicleById(sim, a.id)).toMatchObject({
      state: 'collecting',
      rushBuildingId: 'hr_towers_a',
    })
    expect(vehicleById(sim, b.id).state).toBe('idle_lot')
    expect(sim.dispatch({ kind: 'rush', buildingId: 'hr_towers_a' })).toEqual({
      ok: false,
      reason: 'already-rushed',
    })
    expect(sim.commandLog).toHaveLength(3) // 2 buys + the rush
  })

  it('a collecting vehicle is retargeted: its current target goes back to the pool', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    const first = injectParcel(sim, 'hr_buffer_block', 'dt_cache_cafe')
    runTicks(sim, 10)
    expect(vehicleById(sim, a.id).reserved).toEqual([first.id])
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(
      sim.dispatch({ kind: 'rush', buildingId: 'hr_towers_a' }),
    ).toMatchObject({ ok: true })
    const va = vehicleById(sim, a.id)
    expect(va.stops[0]?.buildingId).toBe('hr_towers_a')
    expect(sim.state.parcels[String(first.id)]?.reservedBy).toBeNull()
  })

  it('served (a pickup there) clears the flag: building:rushCleared', () => {
    const sim = quietSim(1)
    buy(sim, 'bike')
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    sim.dispatch({ kind: 'rush', buildingId: 'hr_towers_a' })
    const cleared = collect(sim, 'building:rushCleared')
    runUntil(sim, () => cleared.length > 0)
    expect(cleared).toEqual([{ buildingId: 'hr_towers_a' }])
    expect(sim.state.buildings.hr_towers_a?.rushUntilTick).toBeNull()
    expect(sim.state.vehicles[0]?.rushBuildingId).toBeNull()
  })

  it('no eligible vehicle: the flag stays set (logged as applied), the reason says why, it expires after rushExpireS', () => {
    const sim = quietSim(1)
    unlockDistrict(sim, 'industrial')
    expect(sim.dispatch({ kind: 'rush', buildingId: 'hr_towers_a' })).toEqual({
      ok: false,
      reason: 'invalid', // nothing waiting
    })
    injectParcel(sim, 'in_lodash_smelting', 'dt_cache_cafe')
    injectParcel(sim, 'dt_cache_cafe', 'hr_towers_a', { size: 'L' })
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(sim.dispatch({ kind: 'rush', buildingId: 'hr_towers_a' })).toEqual({
      ok: false,
      reason: 'no-vehicle',
      applied: true,
    })
    buy(sim, 'bike')
    expect(
      sim.dispatch({ kind: 'rush', buildingId: 'in_lodash_smelting' }),
    ).toEqual({
      ok: false,
      reason: 'trucks-only',
      applied: true,
    })
    expect(sim.dispatch({ kind: 'rush', buildingId: 'dt_cache_cafe' })).toEqual(
      {
        ok: false,
        reason: 'needs-van',
        applied: true,
      },
    )
    expect(sim.state.buildings.dt_cache_cafe?.rushUntilTick).not.toBeNull()
    expect(
      sim.dispatch({ kind: 'rush', buildingId: 'hr_powers' as string }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
    })
    // the earlier flag on Towers A is re-evaluated on the dispatcher tick: the new bike takes it
    const rushed = collect(sim, 'building:rushed')
    runTicks(sim, 10)
    expect(rushed).toEqual([
      expect.objectContaining({
        buildingId: 'hr_towers_a',
        vehicleId: sim.state.vehicles[0]!.id,
      }),
    ])
    const cleared = collect(sim, 'building:rushCleared')
    runTicks(sim, data.vehicles.rushExpireS * TICKS_PER_S)
    expect(cleared.map((c) => c.buildingId)).toContain('in_lodash_smelting')
    expect(sim.state.buildings.in_lodash_smelting?.rushUntilTick).toBeNull()
    expect(sim.commandLog.map((e) => e.cmd.kind)).toEqual([
      'rush',
      'buyVehicle',
      'rush',
      'rush',
    ])
  })

  it('one rush per vehicle: a vehicle already sent on a rush is not eligible for a second flag, which takes it on the first dispatcher tick after the first is served', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    injectParcel(sim, 'hr_buffer_block', 'dt_cache_cafe')
    expect(sim.dispatch({ kind: 'rush', buildingId: 'hr_towers_a' })).toEqual({
      ok: true,
      vehicleId: bike.id,
    })
    // the only bike already carries a rush: the second flag stays up, unassigned
    expect(
      sim.dispatch({ kind: 'rush', buildingId: 'hr_buffer_block' }),
    ).toEqual({ ok: false, reason: 'no-vehicle', applied: true })
    expect(sim.state.buildings.hr_buffer_block?.rushUntilTick).not.toBeNull()
    const rushed = collect(sim, 'building:rushed')
    const cleared = collect(sim, 'building:rushCleared')
    runUntil(sim, () => cleared.length > 0) // Towers A served
    expect(cleared).toEqual([{ buildingId: 'hr_towers_a' }])
    expect(rushed).toEqual([])
    runUntil(sim, () => rushed.length > 0, 10) // the next dispatcher tick
    expect(rushed).toEqual([
      expect.objectContaining({
        buildingId: 'hr_buffer_block',
        vehicleId: bike.id,
      }),
    ])
    const v = vehicleById(sim, bike.id)
    expect(v.rushBuildingId).toBe('hr_buffer_block')
    runUntil(sim, () => v.stops[0]?.buildingId === 'hr_buffer_block', 30)
    expect(v.state).toBe('collecting')
  })

  it('§4.5 step 4: a rushed building is chosen first regardless of distance, even past the 12-tile radius after a pickup', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe') // (19,29): near the lot
    injectParcel(sim, 'hr_buffer_block', 'dt_cache_cafe') // (43,21): far
    expect(pickCollectTarget(sim, bike)?.buildingId).toBe('hr_towers_a')
    sim.state.buildings.hr_buffer_block!.rushUntilTick = sim.state.tick + 600
    expect(pickCollectTarget(sim, bike)?.buildingId).toBe('hr_buffer_block')
    bike.collectedThisLeg = true // radius rule now applies to unrushed buildings
    expect(
      sim.paths.distance(originTile(bike), { x: 43, y: 21 }),
    ).toBeGreaterThan(data.vehicles.collectRadiusTiles)
    expect(pickCollectTarget(sim, bike)?.buildingId).toBe('hr_buffer_block')
    // a rushed building outside the vehicle's zone is not a candidate
    bike.zone = 'downtown'
    expect(pickCollectTarget(sim, bike)).toBeNull()
  })

  it('locked buildings cannot be rushed', () => {
    const sim = quietSim(1)
    expect(
      sim.dispatch({ kind: 'rush', buildingId: 'in_lodash_smelting' }),
    ).toEqual({
      ok: false,
      reason: 'locked',
    })
  })
})
