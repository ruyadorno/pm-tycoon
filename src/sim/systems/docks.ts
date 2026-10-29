// Loading docks (spec §4.3, §4.6, §6.5; plan.md §6.4 tick step 5).
//
// One shared FIFO queue on the lot (lane.dockQueue); the first in line takes
// the first free dock and drives onto its bay (state `queued` until it gets
// there, then `docked_unloading` + `vehicle:docked`, dispatch.ts). At the
// dock: unload dockUnloadPerS into the dock's conveyor, paused while the
// conveyor is full (`parcel:unloaded`); when the cargo is empty →
// `docked_loading` + `vehicle:unloaded` and the §4.5 step-1 outbound set is
// computed ONCE. Non-empty → load dockLoadPerS from the shelf
// (`parcel:loaded`) → depart (`vehicle:departed`). Empty while parcels it
// could carry are still inside the lane and nobody is queued → wait up to
// dockIdleWaitS, then recompute once; still empty → leave to collect, else
// park. `busyTicksThisDay` counts every tick a dock is assigned (incl. the
// short drive onto the bay) → `dock:occupancy` per in-game minute (tick.ts).
//
// Resolved ambiguity (reported): the idle wait ends at the FIRST of
// dockIdleWaitS elapsed, a vehicle joining the queue
// (dockIdleWaitOnlyIfQueueEmpty), or the lane holding no parcel it could
// carry any more (they all reached the shelf) — "wait up to" — and is
// followed by the single recompute; a non-empty recompute loads even if a
// vehicle queued meanwhile.

import type { Sim } from '../sim.ts'
import type { LoadingDock, Vehicle } from '../types.ts'
import { laneNode, ticksFromS } from '../types.ts'
import { unitsOf } from '../map.ts'
import {
  carriableInLane,
  departDelivering,
  leaveDock,
  outboundSet,
} from './dispatch.ts'
import { enterNode, hasRoom, shelfNode, takeFrom } from './lane.ts'
import {
  dockTile,
  emitQueueLength,
  repositionQueue,
  routeTo,
} from './vehicles.ts'

const vehicleById = (sim: Sim, id: number | null): Vehicle | null =>
  id === null ? null : (sim.state.vehicles.find((v) => v.id === id) ?? null)

function unloadTicks(sim: Sim): number {
  return ticksFromS(1 / sim.data.vehicles.dockUnloadPerS)
}

function loadTicks(sim: Sim): number {
  return ticksFromS(1 / sim.data.vehicles.dockLoadPerS)
}

/** The idle wait may run: nobody queued (when dockIdleWaitOnlyIfQueueEmpty). */
function queueAllowsWait(sim: Sim): boolean {
  return (
    !sim.data.vehicles.dockIdleWaitOnlyIfQueueEmpty ||
    sim.state.lane.dockQueue.length === 0
  )
}

function startLoading(sim: Sim, dock: LoadingDock, v: Vehicle, ids: number[]) {
  for (const id of ids) {
    const p = sim.state.parcels[String(id)]
    if (p) p.reservedBy = v.id
  }
  v.reserved = [...ids]
  dock.nextTransferTick = sim.state.tick + loadTicks(sim)
}

/** docked_loading entry: the outbound set, computed once (§4.5 step 1). */
function beginLoading(sim: Sim, dock: LoadingDock, v: Vehicle): void {
  const set = outboundSet(sim, v)
  if (set.length > 0) {
    startLoading(sim, dock, v, set)
    return
  }
  if (carriableInLane(sim, v) && queueAllowsWait(sim)) {
    v.waitUntilTick =
      sim.state.tick + ticksFromS(sim.data.vehicles.dockIdleWaitS)
    return
  }
  leaveDock(sim, v)
}

function finishUnloading(sim: Sim, dock: LoadingDock, v: Vehicle): void {
  v.state = 'docked_loading'
  dock.nextTransferTick = null
  sim.emit('vehicle:unloaded', { id: v.id })
  // TODO(M3, SIM_FEATURES.payroll): a driver who walked out parks the vehicle
  // `inactive` here, after the trip's cargo is unloaded (§4.6, §7.4).
  beginLoading(sim, dock, v)
}

function unloadTick(sim: Sim, dock: LoadingDock, v: Vehicle): void {
  const s = sim.state
  const due = dock.nextTransferTick === null || s.tick >= dock.nextTransferTick
  if (v.cargo.length > 0 && due) {
    const conv = laneNode(s.lane, dock.conveyorNodeId)
    const id = v.cargo[0] as number
    const p = s.parcels[String(id)]
    if (conv && p && hasRoom(conv)) {
      v.cargo.shift()
      v.unitsUsed -= unitsOf(sim.data, p.size)
      p.vehicleId = null
      enterNode(sim, p, conv)
      p.trace.push({ tick: s.tick, what: 'unloaded', ref: dock.id })
      sim.emit('parcel:unloaded', { id, dockId: dock.id })
      dock.nextTransferTick = s.tick + unloadTicks(sim)
    }
  }
  if (v.cargo.length === 0) finishUnloading(sim, dock, v)
}

function loadTick(sim: Sim, dock: LoadingDock, v: Vehicle): void {
  const s = sim.state
  if (v.reserved.length > 0) {
    if (dock.nextTransferTick !== null && s.tick < dock.nextTransferTick) return
    const id = v.reserved.shift() as number
    const p = s.parcels[String(id)]
    if (p) {
      takeFrom(shelfNode(s.lane), id)
      v.cargo.push(id)
      v.unitsUsed += unitsOf(sim.data, p.size)
      p.state = 'loaded'
      p.reservedBy = null
      p.vehicleId = v.id
      p.nodeId = null
      p.nodeEnterTick = null
      p.trace.push({ tick: s.tick, what: 'loaded', ref: String(v.id) })
      sim.emit('parcel:loaded', { id, vehicleId: v.id })
    }
    dock.nextTransferTick = s.tick + loadTicks(sim)
    if (v.reserved.length === 0) departDelivering(sim, v)
    return
  }
  if (v.waitUntilTick !== null) {
    const over =
      s.tick >= v.waitUntilTick ||
      !queueAllowsWait(sim) ||
      !carriableInLane(sim, v)
    if (!over) return
    v.waitUntilTick = null
    const set = outboundSet(sim, v)
    if (set.length > 0) startLoading(sim, dock, v, set)
    else leaveDock(sim, v)
    return
  }
  if (v.cargo.length > 0) departDelivering(sim, v)
  else leaveDock(sim, v)
}

/** The first queued vehicle takes each free dock and drives onto its bay. */
function assignDocks(sim: Sim): void {
  const s = sim.state
  for (const dock of s.lane.docks) {
    if (dock.vehicleId !== null || s.lane.dockQueue.length === 0) continue
    const v = vehicleById(sim, s.lane.dockQueue.shift() as number)
    if (!v) continue
    dock.vehicleId = v.id
    dock.nextTransferTick = null
    v.dockId = dock.id
    routeTo(sim, v, dockTile(sim, dock.id))
    emitQueueLength(sim)
    repositionQueue(sim)
  }
}

/** Tick step 5. */
export function docksStep(sim: Sim): void {
  const s = sim.state
  for (const dock of s.lane.docks) {
    const v = vehicleById(sim, dock.vehicleId)
    if (!v) continue
    if (v.state === 'docked_unloading') unloadTick(sim, dock, v)
    else if (v.state === 'docked_loading') loadTick(sim, dock, v)
  }
  assignDocks(sim)
  for (const dock of s.lane.docks) {
    if (dock.vehicleId !== null) dock.busyTicksThisDay += 1
  }
}
