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
import { driverNumbers, driverOf } from './people.ts'
import { mapIndex, sameTile, unitsOf, vehicleTypeDef } from '../map.ts'
import type { Sim } from '../sim.ts'
import type { Heading, TileXY, Vehicle } from '../types.ts'
import { TICKS_PER_S } from '../types.ts'

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

/** Edge progress per tick (1/MILLI tile); a speed-5 driver in a van: 276. */
export function speedPerTick(sim: Sim, v: Vehicle): number {
  const mult = driverMults(sim, v).speedMult
  return Math.max(
    1,
    Math.round((typeOf(sim, v).speedTilesPerS * mult * MILLI) / TICKS_PER_S),
  )
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
 * walked out (Employee.active false) and until re-hire, and while a Replace
 * waits (`nextDriverId`, heading home for the swap) — the vehicle then
 * finishes its trip and parks (`inactive`, or swaps drivers: dispatch.ts
 * goInactive).
 */
export function hasDriver(sim: Sim, v: Vehicle): boolean {
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

/** The bay tile of a loading dock (lot.docks in lane.docks order). */
export function dockTile(sim: Sim, dockId: string): TileXY {
  const i = sim.state.lane.docks.findIndex((d) => d.id === dockId)
  const t = mapIndex(sim.data).lot.docks[Math.max(0, i)] as TileXY
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
 * §4.1 Sell, from any state: carried parcels return to the warehouse past
 * cap — outbound ones (§11 loaded / in_transit_out) to the shelf, inbound
 * ones to the dock conveyor so they still pass every checker (§6.4, M2
 * review: the shelf would wave a malware parcel through) — reservations and
 * its rush go back to the pool, a docked vehicle frees its dock at once, a
 * queued one leaves the queue, the driver (and a pending Replace) leave the
 * payroll silently, then the sellRefund × price refund and vehicle:sold.
 */
export function sellVehicle(sim: Sim, v: Vehicle): void {
  const s = sim.state
  for (const id of v.cargo) {
    const p = s.parcels[String(id)]
    if (!p) continue
    if (INBOUND.has(p.state)) returnToConveyor(sim, p, v.dockId, v.name)
    else returnToShelf(sim, p)
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
  s.employees = s.employees.filter(
    (e) => !(e.role === 'driver' && e.vehicleId === v.id),
  )
  s.vehicles = s.vehicles.filter((x) => x.id !== v.id)
  if (qi >= 0) repositionQueue(sim)
  sim.credit(sellRefund(sim, v), 'refund', false)
  sim.emit('vehicle:sold', { id: v.id })
}
