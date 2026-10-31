// Vehicles (spec §4.1-§4.2, §4.6; plan.md §6.4 tick step 4): the class table
// rules (capacity units, allowed sizes, speed), buy / sell, movement along
// cached A* paths with prev/pos for render interpolation, headings, the wheel
// frame, the 1.5 s building stops, and the lot moves (entrance → queue tile →
// dock bay, dock → parking) over the lot's drive tiles.
//
// This module only moves vehicles and keeps their bookkeeping; what a vehicle
// does on arriving or at the end of a stop is the §4.5/§4.6 leg logic in
// dispatch.ts, passed in as hooks (no import cycle).
//
// Movement is integer: progress along the current unit edge is `edgeT` in
// 1/MILLI tile, advanced by round(speedTilesPerS × speedMult × MILLI /
// TICKS_PER_S) per tick — speedMult from the driver's speed pip (+ the
// affinity pip in its favourite type, M6, spec-build2 §2.5; a driver fired
// mid-trip keeps theirs until it parks; 1.0 with no driver) — so a path's
// timing is tick-exact (plan.md §6.4); pos is derived.

import type { VehicleTypeDef } from '../../data/types.ts'
import { sellRefund } from './economy.ts'
import { returnToConveyor, returnToShelf } from './lane.ts'
import { driverNumbers, driverOf, dropEmployee } from './people.ts'
import { mapIndex, sameTile, unitsOf, vehicleTypeDef } from '../map.ts'
import { modMult } from '../modifiers.ts'
import type { Sim } from '../sim.ts'
import type { Employee, Heading, TileXY, Vehicle } from '../types.ts'
import { dockNumber, isAbsent, TICKS_PER_S } from '../types.ts'

/** Edge progress units per tile. */
export const MILLI = 1000

export interface LegHooks {
  /** The vehicle reached the end of its path this tick. */
  onArrive(sim: Sim, v: Vehicle): void
  /** A collecting / delivering vehicle's 1.5 s stop ended this tick. */
  onStopEnd(sim: Sim, v: Vehicle): void
}

export function typeOf(sim: Sim, v: Vehicle): VehicleTypeDef {
  return vehicleTypeDef(sim.data, v.type)
}

/**
 * The driver's speedMult / stopMult in this vehicle (a walked-out driver's
 * still apply while the trip finishes); with no driver, those of a driver
 * fired mid-trip (Vehicle.tripMults) until it parks, else 1.0 / 1.0.
 */
export function driverMults(
  sim: Sim,
  v: Vehicle,
): { speedMult: number; stopMult: number } {
  const e = driverOf(sim, v)
  if (!e) return v.tripMults ?? { speedMult: 1, stopMult: 1 }
  return driverNumbers(sim.data, e.pips, e.affinity, v.type)
}

/**
 * Edge progress per tick (1/MILLI tile); a speed-5 driver in a van: 276.
 * Build 3 (B3 §3.6): × the speed modifier fold for this vehicle's type.
 */
export function speedPerTick(sim: Sim, v: Vehicle): number {
  const mult = driverMults(sim, v).speedMult
  const mod = modMult(sim, 'speed', v.type)
  return Math.max(
    1,
    Math.round(
      (typeOf(sim, v).speedTilesPerS * mult * mod * MILLI) / TICKS_PER_S,
    ),
  )
}

/**
 * §4.1 Buy: pops in on the lot, home zone 'any' — `idle_lot` when a driver
 * is about to be seated (people.ts hireApplicant), else `inactive` with no
 * driver ("Hire later", spec-build2 §2.5). `price` = what was paid (build 3:
 * the vehiclePrice modifier's price, 0 for an event's gift) — the sell
 * refund follows it.
 */
export function createVehicle(
  sim: Sim,
  def: VehicleTypeDef,
  withDriver: boolean,
  price: number,
): Vehicle {
  const s = sim.state
  const usedNames = s.vehicles.map((v) => v.name)
  let n = 1
  while (usedNames.includes(`${def.name} ${n}`)) n += 1
  const id = s.nextId.vehicle
  s.nextId.vehicle += 1
  const tile = parkingTile(sim, id)
  const pos = { tx: tile.x, ty: tile.y }
  const v: Vehicle = {
    id,
    type: def.id,
    name: `${def.name} ${n}`,
    driverId: null,
    nextDriverId: null,
    state: withDriver ? 'idle_lot' : 'inactive',
    zone: 'any',
    pos,
    prev: { ...pos },
    heading: 'SE',
    wheel: 0,
    path: [],
    pathIndex: 0,
    edgeT: 0,
    stops: [],
    stopIndex: 0,
    cargo: [],
    unitsUsed: 0,
    reserved: [],
    dockId: null,
    waitUntilTick: null,
    rushBuildingId: null,
    collectedThisLeg: false,
    purchasePrice: price,
    boughtTick: s.tick,
  }
  s.vehicles.push(v)
  return v
}

/** Units of the parcels in `ids` (missing ids count 0). */
export function unitsOfIds(sim: Sim, ids: readonly number[]): number {
  let u = 0
  for (const id of ids) {
    const p = sim.state.parcels[String(id)]
    if (p) u += unitsOf(sim.data, p.size)
  }
  return u
}

/** Capacity left after the cargo and the parcels reserved for this vehicle. */
export function freeUnits(sim: Sim, v: Vehicle): number {
  return (
    typeOf(sim, v).capacityUnits - v.unitsUsed - unitsOfIds(sim, v.reserved)
  )
}

/**
 * The vehicle has a driver who keeps working (spec §7.4, spec-build2 §2.5):
 * false with no driver (bought with "Hire later", or fired), once the driver
 * walked out (Employee.active false) and until re-hire, while a Replace
 * waits (`nextDriverId`, heading home for the swap), and (build 3, B3 §3.5)
 * while the vehicle is parked by an event (`absentUntilTick`) — the vehicle
 * then finishes its trip and parks (`inactive`, or swaps drivers:
 * dispatch.ts goInactive); effects.ts absenceStep brings it back.
 */
export function hasDriver(sim: Sim, v: Vehicle): boolean {
  if (isAbsent(v, sim.state.tick)) return false
  if (v.driverId === null || v.nextDriverId !== null) return false
  const e = sim.state.employees.find((x) => x.id === v.driverId)
  return e?.active ?? false
}

/** Release every parcel reserved for `v` (collection or loading). */
export function releaseReservations(sim: Sim, v: Vehicle): void {
  for (const id of v.reserved) {
    const p = sim.state.parcels[String(id)]
    if (p && p.reservedBy === v.id) p.reservedBy = null
  }
  v.reserved = []
}

// Movement --------------------------------------------------------------------

const roundTile = (v: Vehicle): TileXY => ({
  x: Math.round(v.pos.tx),
  y: Math.round(v.pos.ty),
})

/** True while the vehicle has a path to follow (arrival fires on the next step). */
export function isMoving(v: Vehicle): boolean {
  return v.path.length > 0
}

/** Where the vehicle is headed now: the end of its path, else its tile. */
export function targetTile(v: Vehicle): TileXY {
  const last = v.path[v.path.length - 1]
  return last ? { x: last.x, y: last.y } : roundTile(v)
}

/**
 * The tile a new route starts from: mid-edge, the far end of the current
 * edge (the vehicle finishes it first); otherwise its tile. Also the
 * "current tile" for the dispatcher's road distances.
 */
export function originTile(v: Vehicle): TileXY {
  if (v.path.length > 0 && v.edgeT > 0) {
    const b = v.path[v.pathIndex + 1]
    if (b) return { x: b.x, y: b.y }
  }
  const a = v.path.length > 0 ? v.path[v.pathIndex] : undefined
  return a ? { x: a.x, y: a.y } : roundTile(v)
}

/**
 * Route the vehicle to a drive-graph tile along the cached A* path (§4.2).
 * Mid-edge it finishes the current edge first; already there = a one-tile
 * path, so arrival still fires on the next movement step.
 */
const copyPath = (p: readonly TileXY[]): TileXY[] =>
  p.map((t) => ({ x: t.x, y: t.y }))

export function routeTo(sim: Sim, v: Vehicle, target: TileXY): void {
  if (v.path.length > 0 && v.edgeT > 0) {
    const a = v.path[v.pathIndex] as TileXY
    const b = v.path[v.pathIndex + 1] as TileXY
    v.path = [{ x: a.x, y: a.y }, ...copyPath(sim.paths.path(b, target))]
    v.pathIndex = 0
    return
  }
  v.path = copyPath(sim.paths.path(originTile(v), target))
  v.pathIndex = 0
  v.edgeT = 0
}

/** Edge direction → heading (city-view.md §2: +tx se, +ty sw, −tx nw, −ty ne). */
export function headingOf(a: TileXY, b: TileXY): Heading {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 'SE' : 'NW'
  return dy > 0 ? 'SW' : 'NE'
}

/** Advance along the path; returns [moved, arrived]. */
function advance(sim: Sim, v: Vehicle): [boolean, boolean] {
  if (v.path.length === 0) return [false, false]
  let budget = speedPerTick(sim, v)
  let moved = false
  while (v.pathIndex < v.path.length - 1 && budget > 0) {
    const a = v.path[v.pathIndex] as TileXY
    const b = v.path[v.pathIndex + 1] as TileXY
    const len = MILLI * (Math.abs(b.x - a.x) + Math.abs(b.y - a.y))
    v.heading = headingOf(a, b)
    moved = true
    const left = len - v.edgeT
    if (budget < left) {
      v.edgeT += budget
      budget = 0
    } else {
      budget -= left
      v.pathIndex += 1
      v.edgeT = 0
    }
  }
  const a = v.path[v.pathIndex] as TileXY
  const b = v.path[v.pathIndex + 1]
  if (b && v.edgeT > 0) {
    const len = MILLI * (Math.abs(b.x - a.x) + Math.abs(b.y - a.y))
    const t = v.edgeT / len
    v.pos = { tx: a.x + (b.x - a.x) * t, ty: a.y + (b.y - a.y) * t }
  } else {
    v.pos = { tx: a.x, ty: a.y }
  }
  if (v.pathIndex >= v.path.length - 1) {
    v.path = []
    v.pathIndex = 0
    v.edgeT = 0
    return [moved, true]
  }
  return [moved, false]
}

/**
 * Tick step 4: prev ← pos; end due stops; move; fire arrivals. The wheel
 * frame toggles every 2 ticks while moving (plan.md §6.4).
 *
 * A stop that starts at tick t (arrival, waitUntilTick = t + stopS × 10)
 * ends at tick waitUntilTick: the leg logic runs then and the vehicle moves
 * from the next tick, so it stands still for stopS × 10 full ticks — the
 * convention of the dock timers (spec §4.2 "stops for 1.5 s").
 */
export function vehiclesStep(sim: Sim, hooks: LegHooks): void {
  const s = sim.state
  for (const v of s.vehicles.slice()) {
    v.prev = { tx: v.pos.tx, ty: v.pos.ty }
    const stopping =
      (v.state === 'collecting' || v.state === 'delivering') &&
      v.waitUntilTick !== null
    if (stopping) {
      if (s.tick < (v.waitUntilTick as number)) continue
      v.waitUntilTick = null
      hooks.onStopEnd(sim, v)
      continue
    }
    const [moved, arrived] = advance(sim, v)
    if (moved) v.wheel = (Math.floor(s.tick / 2) % 2) as 0 | 1
    if (arrived) hooks.onArrive(sim, v)
  }
}

// The lot -----------------------------------------------------------------------

function occupies(o: Vehicle, t: TileXY): boolean {
  return sameTile(targetTile(o), t)
}

/** First lot.parking tile no other vehicle stands on or is driving to. */
export function parkingTile(sim: Sim, forId: number | null): TileXY {
  const lot = mapIndex(sim.data).lot
  const others = sim.state.vehicles.filter((o) => o.id !== forId)
  const free = lot.parking.find((t) => !others.some((o) => occupies(o, t)))
  if (free) return { x: free.x, y: free.y }
  const k = Math.max(0, (forId ?? 1) - 1) % lot.parking.length
  const t = lot.parking[k] as TileXY
  return { x: t.x, y: t.y }
}

/** Lot queue tile for dock-queue position `i` (the line ends at its last tile). */
export function queueTile(sim: Sim, i: number): TileXY {
  const q = mapIndex(sim.data).lot.queue
  const t = q[Math.min(i, q.length - 1)] as TileXY
  return { x: t.x, y: t.y }
}

/**
 * The bay tile of a loading dock by its NUMBER (M8): `dockN` drives onto
 * lot.docks[N − 1], whichever docks are owned (dock 3 may come before
 * dock 2).
 */
export function dockTile(sim: Sim, dockId: string): TileXY {
  const bays = mapIndex(sim.data).lot.docks
  const n = dockNumber(dockId)
  const t = (bays[Number.isInteger(n) ? n - 1 : 0] ?? bays[0]) as TileXY
  return { x: t.x, y: t.y }
}

/** dock:queueLength for every dock (one shared FIFO queue, §4.3). */
export function emitQueueLength(sim: Sim): void {
  const n = sim.state.lane.dockQueue.length
  for (const d of sim.state.lane.docks) {
    sim.emit('dock:queueLength', { dockId: d.id, n })
  }
}

/** Re-route every queued vehicle to the queue tile of its position. */
export function repositionQueue(sim: Sim): void {
  sim.state.lane.dockQueue.forEach((id, i) => {
    const v = sim.state.vehicles.find((x) => x.id === id)
    if (!v) return
    const t = queueTile(sim, i)
    if (!sameTile(targetTile(v), t)) routeTo(sim, v, t)
  })
}

/** §4.6 `queued`: join the FIFO dock queue on the lot. */
export function joinQueue(sim: Sim, v: Vehicle): void {
  const q = sim.state.lane.dockQueue
  q.push(v.id)
  v.state = 'queued'
  v.waitUntilTick = null
  v.stops = []
  v.stopIndex = 0
  routeTo(sim, v, queueTile(sim, q.length - 1))
  sim.emit('vehicle:queued', { id: v.id, position: q.length - 1 })
  emitQueueLength(sim)
}

/** Free a vehicle's loading dock (and its transfer timer). */
export function leaveDockBay(sim: Sim, v: Vehicle): void {
  const dock = sim.state.lane.docks.find((d) => d.id === v.dockId)
  if (dock && dock.vehicleId === v.id) {
    dock.vehicleId = null
    dock.nextTransferTick = null
    dock.stuckSinceTick = null
    delete dock.relief
  }
  v.dockId = null
}

// Sell (§4.1; buy is commands.ts createVehicle + parkingTile) ----------------------

/** Cargo not yet through the lane (§11 picked_up → in_transit_in → unloading). */
const INBOUND = new Set(['picked_up', 'in_transit_in', 'unloading'])

/**
 * A vehicle leaves the fleet, from any state (§4.1 Sell; build 3 B3 §3.5
 * `vehicle {lose}`): carried parcels return to the warehouse past cap —
 * outbound ones (§11 loaded / in_transit_out) to the shelf, inbound ones to
 * the dock conveyor so they still pass every checker (§6.4, M2 review: the
 * shelf would wave a malware parcel through; the trace names `why`) —
 * reservations and its rush go back to the pool, a docked vehicle frees its
 * dock at once, a queued one leaves the queue; its driver and a pending
 * Replace driver leave: silently when sold, through `worker:fired {reason:
 * 'event'}` when lost (M11 critique 31); then, with `refund`, the
 * sellRefund × paid price. Returns the drivers who left. The caller emits
 * `vehicle:sold` / `vehicle:lost`.
 */
export function removeVehicle(
  sim: Sim,
  v: Vehicle,
  opts: { refund: boolean; why: 'sold' | 'lost' },
): Employee[] {
  const s = sim.state
  for (const id of v.cargo) {
    const p = s.parcels[String(id)]
    if (!p) continue
    if (INBOUND.has(p.state)) {
      returnToConveyor(sim, p, v.dockId, v.name, opts.why)
    } else {
      returnToShelf(sim, p)
    }
  }
  v.cargo = []
  v.unitsUsed = 0
  releaseReservations(sim, v)
  v.rushBuildingId = null
  leaveDockBay(sim, v)
  const qi = s.lane.dockQueue.indexOf(v.id)
  if (qi >= 0) {
    s.lane.dockQueue.splice(qi, 1)
    emitQueueLength(sim)
  }
  const drivers = s.employees.filter(
    (e) => e.role === 'driver' && e.vehicleId === v.id,
  )
  if (opts.why === 'lost') {
    for (const e of drivers) dropEmployee(sim, e, 'event')
  } else {
    s.employees = s.employees.filter((e) => !drivers.includes(e))
  }
  s.vehicles = s.vehicles.filter((x) => x.id !== v.id)
  if (qi >= 0) repositionQueue(sim)
  if (opts.refund) sim.credit(sellRefund(sim, v), 'refund', false)
  return drivers
}

/**
 * §4.1 Sell (removeVehicle with the refund — sellRefund × the price paid —
 * the drivers leaving the payroll silently), then vehicle:sold.
 */
export function sellVehicle(sim: Sim, v: Vehicle): void {
  removeVehicle(sim, v, { refund: true, why: 'sold' })
  sim.emit('vehicle:sold', { id: v.id })
}
