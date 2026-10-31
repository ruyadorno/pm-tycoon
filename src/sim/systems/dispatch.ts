// The greedy dispatcher and the vehicle leg logic (spec §4.1 rush, §4.5
// steps 1-5, §4.6 state machine; plan.md §6.4 tick step 3).
//
// Selection (pure reads): outboundSet (step 1), collectCandidates /
// pickCollectTarget (step 4), nearestEligibleVehicle (rush). Transitions
// (each fires its §4.6 enter event): startCollecting → `vehicle:collecting`,
// goReturning → `vehicle:returning`, goIdle → `vehicle:parked`, joinQueue →
// `vehicle:queued`, departDelivering → `vehicle:departed` (docks.ts calls
// it). LEG_HOOKS is what vehicles.ts calls on an arrival or a stop end.
//
// Resolved ambiguities (reported):
// - "lower building id" (step 4 tie-break, nearest-neighbour stops) = the
//   earlier row of buildings.json (the data-file order of plan.md §6.4).
// - Step 4 picks one building at a time: the next one is chosen at the end
//   of the 1.5 s stop, from the new position (so parcels spawned meanwhile
//   count); a building's fitting parcels are reserved on selection, oldest
//   first, and on arrival the vehicle also takes any other unreserved
//   parcel there that still fits.
// - A collecting vehicle that ends its leg with an empty cargo parks
//   (idle_lot) instead of returning empty, whatever started the leg.
// - Rush retarget of a collecting vehicle replaces its current target (whose
//   reservations go back to the pool); during a stop the rushed building is
//   reserved now and visited when the stop ends. A rush is "served" (flag
//   cleared) by any pickup at the building.
// - §11 in_transit_in starts when the vehicle turns for the warehouse
//   (`vehicle:returning`), in_transit_out on `vehicle:departed`.
// - M3, a driver who walked out (§7.4, payroll.ts): the vehicle "finishes its
//   trip" — it serves the stop it is driving to or standing at, then starts
//   no new collect target or leg (back to the warehouse with cargo, else it
//   parks); it is never rush-eligible; and wherever it would park `idle_lot`
//   it parks `inactive` instead (goInactive), as it does right after its
//   next unload (docks.ts) and when it reaches the lot with nothing aboard
//   (it never queues for a dock with nothing to unload).
// - M7, the magic parcel (design-m7 Q7, a VIP): it rides first — the
//   outbound sort key is magic 0, a rushed destination 1, the rest 2 (then
//   spawn tick, id), so its region is the leg's target region — and the stop
//   holding it is the leg's first stop (the rest nearest-neighbour from
//   there). At its origin it is reserved and picked up first too (after a
//   vehicle's earlier reservations, which it keeps), and a pickup that
//   leaves it behind does not clear the building's rush flag.

import type { CommandResult, FailReason } from '../commands.ts'
import {
  anchorOf,
  buildingOrder,
  districtDef,
  districtOf,
  isLive,
  sizeAllowed,
  typeAllowedIn,
  unitsOf,
  vehicleTypeDef,
  zonePermits,
} from '../map.ts'
import { modMult } from '../modifiers.ts'
import type { Sim } from '../sim.ts'
import type { BuildingId, Parcel, Stop, TileXY, Vehicle } from '../types.ts'
import { ticksFromS } from '../types.ts'
import { deliverParcel } from './economy.ts'
import { handOff, hubDef } from './hubs.ts'
import { laneParcelIds, shelfNode } from './lane.ts'
import { driverNumbers, driverOf, swapPendingDriver } from './people.ts'
import { changeSatisfaction } from './satisfaction.ts'
import {
  driverMults,
  emitQueueLength,
  freeUnits,
  hasDriver,
  joinQueue,
  leaveDockBay,
  originTile,
  parkingTile,
  releaseReservations,
  repositionQueue,
  routeTo,
  typeOf,
  type LegHooks,
} from './vehicles.ts'

// Selection -------------------------------------------------------------------------

const parcelOf = (sim: Sim, id: number): Parcel | null =>
  sim.state.parcels[String(id)] ?? null

/** A building's rush flag is up (§4.1). */
export function isRushed(sim: Sim, buildingId: BuildingId): boolean {
  const until = sim.state.buildings[buildingId]?.rushUntilTick ?? null
  return until !== null && until > sim.state.tick
}

/**
 * Step-1 filters: destination inside the vehicle's zone, the destination
 * region allows the type, the size is allowed and fits an empty vehicle.
 */
export function outboundEligible(sim: Sim, v: Vehicle, p: Parcel): boolean {
  const def = typeOf(sim, v)
  return (
    zonePermits(sim.data, v.zone, p.destRegion) &&
    typeAllowedIn(sim.data, v.type, p.destRegion) &&
    sizeAllowed(def, p.size) &&
    unitsOf(sim.data, p.size) <= def.capacityUnits
  )
}

/**
 * §4.5 step 1, the outbound set: unreserved shelf parcels passing the
 * filters, a magic parcel first (M7), rushed destinations next, then oldest
 * spawn (then id); the first
 * candidate's region is the target region; fill with candidates to it, then
 * to any other permitted region, until the units are full.
 */
export function outboundSet(sim: Sim, v: Vehicle): number[] {
  const shelf = shelfNode(sim.state.lane)
  const cands = shelf.queue
    .map((id) => parcelOf(sim, id))
    .filter(
      (p): p is Parcel =>
        p !== null && p.reservedBy === null && outboundEligible(sim, v, p),
    )
    .toSorted((a, b) => {
      const ra = a.magic ? 0 : isRushed(sim, a.dest) ? 1 : 2
      const rb = b.magic ? 0 : isRushed(sim, b.dest) ? 1 : 2
      if (ra !== rb) return ra - rb
      if (a.spawnedTick !== b.spawnedTick) return a.spawnedTick - b.spawnedTick
      return a.id - b.id
    })
  const first = cands[0]
  if (!first) return []
  let free = freeUnits(sim, v)
  const out: number[] = []
  const take = (p: Parcel): void => {
    const u = unitsOf(sim.data, p.size)
    if (u <= free) {
      out.push(p.id)
      free -= u
    }
  }
  for (const p of cands)
    if (free > 0 && p.destRegion === first.destRegion) take(p)
  for (const p of cands)
    if (free > 0 && p.destRegion !== first.destRegion) take(p)
  return out
}

/** ≥ 1 unreserved shelf parcel passes the step-1 filters (§4.5 step 2). */
export function shelfHasEligible(sim: Sim, v: Vehicle): boolean {
  return shelfNode(sim.state.lane).queue.some((id) => {
    const p = parcelOf(sim, id)
    return p !== null && p.reservedBy === null && outboundEligible(sim, v, p)
  })
}

/** Parcels it could carry are still inside the lane (§4.6 docked_loading wait). */
export function carriableInLane(sim: Sim, v: Vehicle): boolean {
  return laneParcelIds(sim.state.lane).some((id) => {
    const p = parcelOf(sim, id)
    return p !== null && outboundEligible(sim, v, p)
  })
}

export interface CollectCandidate {
  buildingId: BuildingId
  /** Road distance from the vehicle's current tile. */
  dist: number
  /** Unreserved parcels waiting there (step-4 tie-break). */
  waiting: number
  rushed: boolean
  /** buildings.json row (the "lower building id" tie-break). */
  order: number
}

/** An unreserved waiting parcel the vehicle may carry within `free` units. */
function fits(sim: Sim, v: Vehicle, p: Parcel | null, free: number): boolean {
  return (
    p !== null &&
    p.reservedBy === null &&
    sizeAllowed(typeOf(sim, v), p.size) &&
    unitsOf(sim.data, p.size) <= free
  )
}

/**
 * §4.5 step 4 candidates from `from`: live buildings in the vehicle's zone
 * and allowed for its type with ≥ 1 unreserved waiting parcel fitting the
 * remaining units, within collectRadiusTiles road tiles unless `anyDistance`
 * (nothing picked up yet this leg) or the building is rushed.
 */
export function collectCandidates(
  sim: Sim,
  v: Vehicle,
  from: TileXY,
  anyDistance: boolean,
): CollectCandidate[] {
  const free = freeUnits(sim, v)
  if (free <= 0) return []
  const s = sim.state
  const radius = sim.data.vehicles.collectRadiusTiles
  const out: CollectCandidate[] = []
  sim.data.buildings.forEach((b, order) => {
    const st = s.buildings[b.id]
    if (!st || st.waiting.length === 0 || !isLive(s, b.district)) return
    if (!zonePermits(sim.data, v.zone, b.district)) return
    if (!typeAllowedIn(sim.data, v.type, b.district)) return
    let waiting = 0
    let ok = false
    for (const id of st.waiting) {
      const p = parcelOf(sim, id)
      if (p && p.reservedBy === null) waiting += 1
      if (!ok && fits(sim, v, p, free)) ok = true
    }
    if (!ok) return
    const rushed = isRushed(sim, b.id)
    const dist = sim.paths.distance(from, anchorOf(sim.data, b.id))
    if (!rushed && !anyDistance && dist > radius) return
    out.push({ buildingId: b.id, dist, waiting, rushed, order })
  })
  return out
}

/** Nearest first; ties → more parcels waiting, then lower building id. */
function byNearest(a: CollectCandidate, b: CollectCandidate): number {
  if (a.dist !== b.dist) return a.dist - b.dist
  if (a.waiting !== b.waiting) return b.waiting - a.waiting
  return a.order - b.order
}

/** §4.5 step 4: the next building to collect from (rushed first), or null. */
export function pickCollectTarget(
  sim: Sim,
  v: Vehicle,
): CollectCandidate | null {
  const list = collectCandidates(sim, v, originTile(v), !v.collectedThisLeg)
  const rushed = list.filter((c) => c.rushed)
  const pool = rushed.length > 0 ? rushed : list
  return pool.toSorted(byNearest)[0] ?? null
}

/** Collectable parcels exist in its zone (any distance; §4.5 step 2, §4.6). */
export function hasCollectable(sim: Sim, v: Vehicle): boolean {
  return collectCandidates(sim, v, originTile(v), true).length > 0
}

/**
 * A building's waiting ids in pickup order: the golden parcel first (M7, the
 * VIP rule of design Q7 at the origin too), then oldest first.
 */
function pickupOrder(sim: Sim, waiting: readonly number[]): number[] {
  const magic = waiting.filter((id) => parcelOf(sim, id)?.magic === true)
  if (magic.length === 0) return waiting.slice()
  return [...magic, ...waiting.filter((id) => !magic.includes(id))]
}

/** Reserve the fitting unreserved parcels of a building, the golden one first, then oldest first. */
export function reserveAt(
  sim: Sim,
  v: Vehicle,
  buildingId: BuildingId,
): number[] {
  const st = sim.state.buildings[buildingId]
  if (!st) return []
  let free = freeUnits(sim, v)
  const ids: number[] = []
  for (const id of pickupOrder(sim, st.waiting)) {
    const p = parcelOf(sim, id)
    if (!p || !fits(sim, v, p, free)) continue
    p.reservedBy = v.id
    v.reserved.push(id)
    free -= unitsOf(sim.data, p.size)
    ids.push(id)
  }
  return ids
}

// Rush (§4.1) ---------------------------------------------------------------------------

/**
 * Rush eligibility: allowed in the building's district, home zone permits,
 * `idle_lot` or on a collecting leg, no rush already, and ≥ 1 unreserved
 * waiting parcel there that fits its free units.
 */
export function rushEligible(
  sim: Sim,
  v: Vehicle,
  buildingId: BuildingId,
): boolean {
  if (v.rushBuildingId !== null) return false
  if (v.state !== 'idle_lot' && v.state !== 'collecting') return false
  if (!hasDriver(sim, v)) return false
  const district = districtOf(sim.data, buildingId)
  if (!typeAllowedIn(sim.data, v.type, district)) return false
  if (!zonePermits(sim.data, v.zone, district)) return false
  const free = typeOf(sim, v).capacityUnits - v.unitsUsed
  const st = sim.state.buildings[buildingId]
  return (st?.waiting ?? []).some((id) => fits(sim, v, parcelOf(sim, id), free))
}

/** The nearest (road distance) rush-eligible vehicle; ties → lower vehicle id. */
export function nearestEligibleVehicle(
  sim: Sim,
  buildingId: BuildingId,
): Vehicle | null {
  const anchor = anchorOf(sim.data, buildingId)
  let best: Vehicle | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const v of sim.state.vehicles) {
    if (!rushEligible(sim, v, buildingId)) continue
    const d = sim.paths.distance(originTile(v), anchor)
    if (d < bestD) {
      best = v
      bestD = d
    }
  }
  return best
}

/**
 * Why no vehicle can take a rush (the tooltip, §4.1 / city-view.md §6.1):
 * no owned type is allowed there → 'trucks-only' when only trucks are
 * (Industrial), else 'no-vehicle'; no owned allowed type carries any waiting
 * size → 'needs-van' (or 'trucks-only' when only a truck could); otherwise
 * every eligible vehicle is busy → 'no-vehicle'.
 */
export function rushBlockReason(sim: Sim, buildingId: BuildingId): FailReason {
  const district = districtDef(sim.data, districtOf(sim.data, buildingId))
  const owned = sim.state.vehicles.filter((v) => v.state !== 'inactive')
  const allowedOwned = owned.filter((v) =>
    typeAllowedIn(sim.data, v.type, district.id),
  )
  if (allowedOwned.length === 0) {
    return district.allowed.every((t) => t === 'truck') && owned.length > 0
      ? 'trucks-only'
      : 'no-vehicle'
  }
  const sizes = (sim.state.buildings[buildingId]?.waiting ?? [])
    .map((id) => parcelOf(sim, id))
    .filter((p): p is Parcel => p !== null)
    .map((p) => p.size)
  const carried = allowedOwned.some((v) =>
    sizes.some((z) => sizeAllowed(typeOf(sim, v), z)),
  )
  if (!carried && sizes.length > 0) {
    const vanCarries =
      district.allowed.includes('van') &&
      sizes.some((z) => sizeAllowed(vehicleTypeDef(sim.data, 'van'), z))
    return vanCarries ? 'needs-van' : 'trucks-only'
  }
  return 'no-vehicle'
}

/** Point an eligible vehicle at the rushed building as its next stop. */
function retargetForRush(sim: Sim, v: Vehicle, buildingId: BuildingId): void {
  v.rushBuildingId = buildingId
  if (v.state === 'idle_lot') {
    startCollecting(sim, v, buildingId)
    return
  }
  if (v.waitUntilTick !== null) {
    // Mid-stop: reserve now, go there when the stop ends (continueCollecting).
    reserveAt(sim, v, buildingId)
    return
  }
  releaseReservations(sim, v)
  setCollectTarget(sim, v, buildingId)
}

/** Clear a building's rush flag (served or expired). */
export function clearRush(sim: Sim, buildingId: BuildingId): void {
  const st = sim.state.buildings[buildingId]
  if (!st || st.rushUntilTick === null) return
  st.rushUntilTick = null
  for (const v of sim.state.vehicles) {
    if (v.rushBuildingId === buildingId) v.rushBuildingId = null
  }
  sim.emit('building:rushCleared', { buildingId })
}

/**
 * The rush command (§4.1): set the rushExpireS flag and retarget the
 * nearest eligible vehicle. With none, the flag stays set (re-evaluated
 * every dispatcher tick) and the result is a failure reason marked
 * `applied` (logged, so replays stay exact).
 */
export function applyRush(sim: Sim, buildingId: BuildingId): CommandResult {
  const s = sim.state
  const st = s.buildings[buildingId]
  if (!st) return { ok: false, reason: 'invalid' }
  if (!isLive(s, districtOf(sim.data, buildingId))) {
    return { ok: false, reason: 'locked' }
  }
  if (isRushed(sim, buildingId)) return { ok: false, reason: 'already-rushed' }
  if (st.waiting.length === 0) return { ok: false, reason: 'invalid' }
  const untilTick = s.tick + ticksFromS(sim.data.vehicles.rushExpireS)
  st.rushUntilTick = untilTick
  const v = nearestEligibleVehicle(sim, buildingId)
  if (v) retargetForRush(sim, v, buildingId)
  sim.emit('building:rushed', {
    buildingId,
    vehicleId: v ? v.id : null,
    untilTick,
  })
  if (v) return { ok: true, vehicleId: v.id }
  return { ok: false, reason: rushBlockReason(sim, buildingId), applied: true }
}

/**
 * Every tick: expire flags at rushExpireS. On dispatcher ticks: give every
 * flagged building without a rushing vehicle the nearest eligible one
 * (`building:rushed` again, now with the vehicle id).
 */
function rushStep(sim: Sim, pass: boolean): void {
  const s = sim.state
  for (const b of sim.data.buildings) {
    const st = s.buildings[b.id]
    if (!st || st.rushUntilTick === null) continue
    if (s.tick >= st.rushUntilTick) {
      clearRush(sim, b.id)
      continue
    }
    if (!pass || st.waiting.length === 0) continue
    if (s.vehicles.some((v) => v.rushBuildingId === b.id)) continue
    const v = nearestEligibleVehicle(sim, b.id)
    if (!v) continue
    retargetForRush(sim, v, b.id)
    sim.emit('building:rushed', {
      buildingId: b.id,
      vehicleId: v.id,
      untilTick: st.rushUntilTick,
    })
  }
}

// Leg transitions (§4.6) ----------------------------------------------------------------

/**
 * A building stop: vehicles.stopS × the driver's stopMult (energy pip, M6)
 * × the stop modifier fold (build 3, B3 §3.6).
 */
export function stopTicks(sim: Sim, v: Vehicle): number {
  return ticksFromS(
    sim.data.vehicles.stopS *
      driverMults(sim, v).stopMult *
      modMult(sim, 'stop'),
  )
}

/** Make `buildingId` the current collect stop (reserving its parcels) and drive there. */
function setCollectTarget(sim: Sim, v: Vehicle, buildingId: BuildingId): void {
  const already = v.reserved.filter(
    (id) => parcelOf(sim, id)?.origin === buildingId,
  )
  const ids = [...already, ...reserveAt(sim, v, buildingId)]
  const tile = anchorOf(sim.data, buildingId)
  v.stops = [{ kind: 'collect', buildingId, tile, parcelIds: ids }]
  v.stopIndex = 0
  routeTo(sim, v, tile)
}

/** → collecting (`vehicle:collecting`), first target `target` or the step-4 pick. */
export function startCollecting(
  sim: Sim,
  v: Vehicle,
  target: BuildingId | null = null,
): void {
  v.state = 'collecting'
  v.collectedThisLeg = false
  v.stops = []
  v.stopIndex = 0
  v.waitUntilTick = null
  sim.emit('vehicle:collecting', { id: v.id })
  const pick = target ?? pickCollectTarget(sim, v)?.buildingId ?? null
  if (pick) setCollectTarget(sim, v, pick)
  else endCollecting(sim, v)
}

/** Next collect stop (reserved parcels — a pending rush — first), or end the leg. */
function continueCollecting(sim: Sim, v: Vehicle): void {
  v.stops = []
  v.stopIndex = 0
  // Parcels already reserved (a rush taken during the stop) are served first.
  const pending = v.reserved
    .map((id) => parcelOf(sim, id))
    .find((p) => p !== null && p.state === 'waiting')
  if (pending) {
    setCollectTarget(sim, v, pending.origin)
    return
  }
  releaseReservations(sim, v)
  const more = freeUnits(sim, v) > 0 && hasDriver(sim, v)
  const c = more ? pickCollectTarget(sim, v) : null
  if (c) setCollectTarget(sim, v, c.buildingId)
  else endCollecting(sim, v)
}

/** Collect leg over: back to the warehouse with cargo, else park. */
function endCollecting(sim: Sim, v: Vehicle): void {
  releaseReservations(sim, v)
  if (v.cargo.length > 0) goReturning(sim, v)
  else goIdle(sim, v)
}

/** → returning (`vehicle:returning`): drive to the lot entrance. */
export function goReturning(sim: Sim, v: Vehicle): void {
  v.state = 'returning'
  v.stops = []
  v.stopIndex = 0
  v.waitUntilTick = null
  releaseReservations(sim, v)
  for (const id of v.cargo) {
    const p = parcelOf(sim, id)
    if (p && p.state === 'picked_up') p.state = 'in_transit_in'
  }
  sim.emit('vehicle:returning', { id: v.id })
  routeTo(sim, v, sim.roads.entrance)
}

/**
 * → idle_lot (`vehicle:parked`): drive to a free parking tile. A vehicle
 * whose driver walked out parks `inactive` instead (§4.6).
 */
export function goIdle(sim: Sim, v: Vehicle): void {
  if (!hasDriver(sim, v)) {
    goInactive(sim, v)
    return
  }
  v.state = 'idle_lot'
  v.stops = []
  v.stopIndex = 0
  v.waitUntilTick = null
  v.collectedThisLeg = false
  releaseReservations(sim, v)
  sim.emit('vehicle:parked', { id: v.id })
  routeTo(sim, v, parkingTile(sim, v.id))
}

/**
 * → inactive (`vehicle:inactive`, §4.6 / §7.4): the driver walked out (or
 * was fired, or there is none) and the trip is over (nothing aboard). Leaves
 * the dock queue / bay if in one, drops its reservations and rush, and
 * drives to a free parking tile; never dispatched, never docked, no payroll
 * line until a driver is re-hired / hired (payroll.ts rehire, people.ts →
 * goIdle). Every "trip over without a working driver" path reaches here, so
 * a pending Replace (M6, `nextDriverId`) lands here instead: the new driver
 * takes over ON THE LOT (spec-build2 §2.5) and the vehicle parks idle
 * (people.ts swapPendingDriver) — a trip that ends in the city (the last
 * delivery or collect stop, nothing aboard) first drives home (`returning`;
 * its arrival at the entrance comes back here).
 */
export function goInactive(sim: Sim, v: Vehicle): void {
  if (
    v.nextDriverId !== null &&
    (v.state === 'collecting' || v.state === 'delivering')
  ) {
    goReturning(sim, v)
    return
  }
  const q = sim.state.lane.dockQueue
  const qi = q.indexOf(v.id)
  if (qi >= 0) q.splice(qi, 1)
  leaveDockBay(sim, v)
  if (v.nextDriverId !== null) {
    swapPendingDriver(sim, v)
    goIdle(sim, v)
  } else {
    delete v.tripMults
    v.state = 'inactive'
    v.stops = []
    v.stopIndex = 0
    v.waitUntilTick = null
    v.collectedThisLeg = false
    v.rushBuildingId = null
    releaseReservations(sim, v)
    sim.emit('vehicle:inactive', { id: v.id })
    routeTo(sim, v, parkingTile(sim, v.id))
  }
  if (qi >= 0) {
    emitQueueLength(sim)
    repositionQueue(sim)
  }
}

/**
 * §4.5 step 3: deliver stops in nearest-neighbour order from `from` (ties →
 * lower building id); M7: the stop holding a magic parcel goes first.
 */
export function deliveryStops(sim: Sim, v: Vehicle, from: TileXY): Stop[] {
  const groups: { buildingId: BuildingId; ids: number[]; magic: boolean }[] = []
  for (const id of v.cargo) {
    const p = parcelOf(sim, id)
    if (!p) continue
    const g = groups.find((x) => x.buildingId === p.dest)
    if (g) {
      g.ids.push(id)
      if (p.magic) g.magic = true
    } else groups.push({ buildingId: p.dest, ids: [id], magic: p.magic })
  }
  const stops: Stop[] = []
  let cur = from
  while (groups.length > 0) {
    // The magic parcel's stop first (a VIP), else the nearest.
    let bi = groups.findIndex((g) => g.magic)
    if (bi < 0) {
      bi = 0
      let bd = Number.POSITIVE_INFINITY
      groups.forEach((g, i) => {
        const d = sim.paths.distance(cur, anchorOf(sim.data, g.buildingId))
        const better =
          d < bd ||
          (d === bd &&
            buildingOrder(sim.data, g.buildingId) <
              buildingOrder(sim.data, (groups[bi] as typeof g).buildingId))
        if (better) {
          bi = i
          bd = d
        }
      })
    }
    const g = groups.splice(bi, 1)[0] as (typeof groups)[number]
    const tile = anchorOf(sim.data, g.buildingId)
    const hub = districtDef(sim.data, districtOf(sim.data, g.buildingId))
    stops.push({
      kind: hub.kind === 'overseas' ? 'handoff' : 'deliver',
      buildingId: g.buildingId,
      tile,
      parcelIds: g.ids,
    })
    cur = tile
  }
  return stops
}

/** docked_loading → delivering (`vehicle:departed {stops}`), leaving the dock. */
export function departDelivering(sim: Sim, v: Vehicle): void {
  const from = originTile(v)
  leaveDockBay(sim, v)
  v.stops = deliveryStops(sim, v, from)
  v.stopIndex = 0
  v.state = 'delivering'
  v.collectedThisLeg = false
  v.waitUntilTick = null
  for (const id of v.cargo) {
    const p = parcelOf(sim, id)
    if (p) p.state = 'in_transit_out'
  }
  sim.emit('vehicle:departed', { id: v.id, stops: v.stops.length })
  const first = v.stops[0]
  if (first) routeTo(sim, v, first.tile)
  else goReturning(sim, v)
}

/** docked_loading with nothing loaded: leave to collect, else park (§4.6). */
export function leaveDock(sim: Sim, v: Vehicle): void {
  leaveDockBay(sim, v)
  v.waitUntilTick = null
  if (hasDriver(sim, v) && hasCollectable(sim, v)) startCollecting(sim, v)
  else goIdle(sim, v)
}

/** Deliveries done: collect if it has room and candidates exist, else return (§4.6). */
function afterDelivering(sim: Sim, v: Vehicle): void {
  v.stops = []
  v.stopIndex = 0
  if (!hasDriver(sim, v)) {
    // Walked out (§7.4): the trip ends here — home to unload, else park.
    if (v.cargo.length > 0) goReturning(sim, v)
    else goInactive(sim, v)
    return
  }
  if (freeUnits(sim, v) > 0 && hasCollectable(sim, v)) startCollecting(sim, v)
  else goReturning(sim, v)
}

/** Pick up at a collect stop: its reservations first, then whatever else fits. */
function pickupAt(sim: Sim, v: Vehicle, buildingId: BuildingId): void {
  const s = sim.state
  const st = s.buildings[buildingId]
  if (!st) return
  const def = typeOf(sim, v)
  const mine = pickupOrder(sim, st.waiting).filter(
    (id) => parcelOf(sim, id)?.reservedBy === v.id,
  )
  const picked: number[] = []
  const take = (id: number): void => {
    const p = parcelOf(sim, id)
    if (!p) return
    st.waiting.splice(st.waiting.indexOf(id), 1)
    v.cargo.push(id)
    v.unitsUsed += unitsOf(sim.data, p.size)
    p.state = 'picked_up'
    p.reservedBy = null
    p.vehicleId = v.id
    p.trace.push({
      tick: s.tick,
      what: 'pickedUp',
      ref: String(v.id),
      text: `Picked up by ${v.name}`,
    })
    picked.push(id)
  }
  for (const id of mine) take(id)
  v.reserved = v.reserved.filter((id) => !picked.includes(id))
  for (const id of pickupOrder(sim, st.waiting)) {
    const free = freeUnits(sim, v)
    if (fits(sim, v, parcelOf(sim, id), free)) take(id)
  }
  const district = districtDef(sim.data, districtOf(sim.data, buildingId))
  const favoured = district.favoured.includes(def.id)
  // M6: a charisma-2 driver adds pickupBonus per pickup (inside the cap).
  const driver = driverOf(sim, v)
  const bonus = driver
    ? driverNumbers(sim.data, driver.pips, driver.affinity, v.type).pickupBonus
    : 0
  const delta =
    (favoured ? sim.data.economy.satisfaction.favouredPickup : 0) + bonus
  for (const id of picked) {
    sim.emit('parcel:pickedUp', { id, vehicleId: v.id })
    if (delta > 0) changeSatisfaction(sim, district.id, delta, 'positive')
  }
  if (picked.length > 0) {
    v.collectedThisLeg = true
    // Served — unless the golden parcel still waits there (M7): the bell
    // stays up and the next dispatcher pass sends another vehicle.
    const magicLeft = st.waiting.some((id) => parcelOf(sim, id)?.magic)
    if (st.rushUntilTick !== null && !magicLeft) clearRush(sim, buildingId)
  }
  if (v.rushBuildingId === buildingId) v.rushBuildingId = null
}

/**
 * Deliver the stop's parcels still aboard (§4.5 step 3); a parcel bound for
 * an overseas hub (its stop is a 'handoff' at the pier / terminal, §5.6,
 * M8) is handed off instead — the value locks and the clearance timer runs
 * (hubs.ts). The parcel's destRegion decides, not the stop's kind, so
 * handOff only ever sees a hub-bound parcel (validate.ts checks both agree).
 */
function deliverAt(sim: Sim, v: Vehicle, stop: Stop): void {
  for (const id of stop.parcelIds) {
    const i = v.cargo.indexOf(id)
    const p = parcelOf(sim, id)
    if (i < 0 || !p) continue
    v.cargo.splice(i, 1)
    v.unitsUsed -= unitsOf(sim.data, p.size)
    if (hubDef(sim.data, p.destRegion)) handOff(sim, v, p)
    else deliverParcel(sim, v, p)
  }
}

/** A queued vehicle reached its dock bay → docked_unloading (`vehicle:docked`). */
function dockArrive(sim: Sim, v: Vehicle): void {
  const dock = sim.state.lane.docks.find((d) => d.id === v.dockId)
  if (!dock) return
  v.state = 'docked_unloading'
  v.waitUntilTick = null
  dock.stuckSinceTick = null
  dock.nextTransferTick =
    sim.state.tick + ticksFromS(1 / sim.data.vehicles.dockUnloadPerS)
  for (const id of v.cargo) {
    const p = parcelOf(sim, id)
    if (p) p.state = 'unloading'
  }
  sim.emit('vehicle:docked', { id: v.id, dockId: dock.id })
}

/** The §4.6 leg logic vehicles.ts calls (arrivals and stop ends). */
export const LEG_HOOKS: LegHooks = {
  onArrive(sim, v) {
    switch (v.state) {
      case 'collecting': {
        const stop = v.stops[v.stopIndex]
        if (!stop) {
          continueCollecting(sim, v)
          return
        }
        pickupAt(sim, v, stop.buildingId)
        v.waitUntilTick = sim.state.tick + stopTicks(sim, v)
        return
      }
      case 'delivering': {
        const stop = v.stops[v.stopIndex]
        if (!stop) {
          afterDelivering(sim, v)
          return
        }
        deliverAt(sim, v, stop)
        v.waitUntilTick = sim.state.tick + stopTicks(sim, v)
        return
      }
      case 'returning':
        // Walked out (§7.4) with nothing aboard: nothing to unload, so the
        // trip ends here — park inactive instead of queueing for a dock (the
        // payroll.ts rule for a vehicle queued with nothing aboard).
        if (v.cargo.length === 0 && !hasDriver(sim, v)) goInactive(sim, v)
        else joinQueue(sim, v)
        return
      case 'queued':
        if (v.dockId !== null) dockArrive(sim, v)
        return
      default:
        return
    }
  },
  onStopEnd(sim, v) {
    if (v.state === 'collecting') {
      continueCollecting(sim, v)
      return
    }
    if (v.state !== 'delivering') return
    v.stopIndex += 1
    const next = v.stops[v.stopIndex]
    if (next) routeTo(sim, v, next.tile)
    else afterDelivering(sim, v)
  },
}

// The dispatcher tick (step 3) ------------------------------------------------------------

/**
 * §4.5 step 2, the `idle_lot` pass (vehicle id order): collectable parcels
 * in its zone → collecting; else an eligible shelf parcel → queued; else stay.
 *
 * Run decision Q-RUN1 (b), STALL PREFERENCE: while the lane is stalled on a
 * full shelf the two checks swap — a vehicle that could load ≥ 1 shelf
 * parcel re-queues (empty) to load before it goes collecting, so an empty
 * van / truck docks, loads and drains the shelf (with (a), the dock yield in
 * docks.ts, this ends the single-dock full-shelf deadlock).
 */
export function idlePass(sim: Sim): void {
  const lane = sim.state.lane
  const drainShelf = lane.stalled && lane.stallReason === 'shelfFull'
  for (const v of sim.state.vehicles.slice()) {
    if (v.state !== 'idle_lot') continue
    if (drainShelf && shelfHasEligible(sim, v)) joinQueue(sim, v)
    else if (hasCollectable(sim, v)) startCollecting(sim, v)
    else if (shelfHasEligible(sim, v)) joinQueue(sim, v)
  }
}

/** Tick step 3: rush expiry every tick; rush re-evaluation + the idle pass every dispatchTickS. */
export function dispatchStep(sim: Sim): void {
  const every = Math.max(1, ticksFromS(sim.data.vehicles.dispatchTickS))
  const pass = sim.state.tick % every === 0
  rushStep(sim, pass)
  if (pass) idlePass(sim)
}
