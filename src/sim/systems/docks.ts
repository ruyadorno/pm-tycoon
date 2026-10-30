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
// short drive onto the bay) → `dock:occupancy` per in-game minute (tick.ts);
// `blockedTicksThisDay` (M3) every tick a docked vehicle's due unload is
// refused by a full conveyor — the "dock blocked" seconds the §7 policy
// hires its 2nd / 3rd inspector on (policy.ts). A vehicle whose driver
// walked out (§7.4) parks `inactive` right after it has unloaded (M3).
//
// Resolved ambiguity (reported): the idle wait ends at the FIRST of
// dockIdleWaitS elapsed, a vehicle joining the queue
// (dockIdleWaitOnlyIfQueueEmpty), the lane holding no parcel it could carry
// any more, or (M2) a parcel it could carry reaching the shelf — §4.3 "a
// vehicle with nothing loadable waits": with the 4 s inspector desk the
// first parcels leave the lane one by one, and waiting the full 10 s for the
// rest pushed the first delivery past 60 s — and is followed by the single
// recompute; a non-empty recompute loads even if a vehicle queued meanwhile.
//
// Run decision Q-RUN1 (a), YIELD (the single-dock full-shelf deadlock of the
// M1 review): a docked_unloading vehicle whose unloads have been blocked
// (conveyor full) for ≥ dockIdleWaitS while ≥ 1 vehicle is queued leaves the
// dock keeping its remaining cargo (inbound parcels never skip the checkers)
// and joins the BACK of the queue (`vehicle:queued`), so the next vehicle —
// e.g. an empty truck sent by the stall preference of dispatch.ts — can dock,
// load and drain the shelf. `dock.stuckSinceTick` times the blocked run.
//
// Run decision Q-RUN1 (c), RELIEF (M2 review): (a) + (b) cannot end the jam
// when every vehicle holds inbound cargo (the M1 review's own scenario: the
// zones switched to `any`, nobody empty — the yield only rotates them
// through the dock and nothing is ever loaded). So when the dock has been
// blocked ≥ dockIdleWaitS with the shelf at its cap and the docked vehicle
// could carry ≥ 1 shelf parcel (§4.5 step-1 filters), and no empty vehicle
// that could is queued behind it (that one would drain the shelf without
// it: (a) yields to it), the dock enters RELIEF: the shelf takes the lane's
// parcels past its cap — as it takes a sold vehicle's cargo (§4.1, §6.8) —
// until this vehicle has unloaded; it then loads its outbound set as usual.
// Unloading and loading never interleave, inbound parcels never skip a
// checker, and the overflow is bounded by the lane's contents plus one
// vehicle's cargo. A docked vehicle that cannot carry any shelf parcel still
// yields (a) or waits alone for the player.
//
// M8 (spec-build2 §4.1, design-m8-m9 §4.2): docks 2-3 are bought
// (`buyDock {index}`, economy.docks rows) — a `dockN` node feeding its own
// `convN` conveyor (cap machines.conveyorCapPerDock) whose `next` is conv1's
// (the first slot); lane.ts feeds the slot from the conveyors round-robin
// (lane.feedIndex). Every rule above is per dock: a full conveyor blocks its
// own dock only (blockedTicksThisDay, the yield, relief), while the queue is
// shared and `emptyDrainerQueued` / `canRelieve` read the one shelf; a dock
// in relief takes every slot-1 feed while its conveyor holds a parcel
// (lane.ts step 4), so it unloads as fast as with one dock and the other
// conveyors add to the overflow only while it has nothing to feed. A dock
// may be bought out of order (dock 3 at L4 before dock 2): lane.docks and the
// node pairs stay sorted by number, and the lot bay is `lot.docks[n − 1]`
// (vehicles.ts dockTile). Docks are never sold and draw no salary. The
// Q-RUN1 (a) yield with several docks: a blocked vehicle yields only while
// more vehicles wait in the queue than docks are free right now (vehicles
// that yielded this tick not counted) — one queued vehicle frees one dock,
// not every blocked one; with one dock this is "≥ 1 queued", as before.

import type { CommandResult } from '../commands.ts'
import type { Sim } from '../sim.ts'
import type { LaneNode, LoadingDock, Vehicle } from '../types.ts'
import { dockNumber, laneNode, ticksFromS } from '../types.ts'
import { unitsOf } from '../map.ts'
import {
  carriableInLane,
  departDelivering,
  goInactive,
  leaveDock,
  outboundSet,
  shelfHasEligible,
} from './dispatch.ts'
import { enterNode, hasRoom, shelfNode, takeFrom } from './lane.ts'
import {
  dockTile,
  emitQueueLength,
  hasDriver,
  joinQueue,
  leaveDockBay,
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
  delete dock.relief
  sim.emit('vehicle:unloaded', { id: v.id })
  if (!hasDriver(sim, v)) {
    // §4.6 / §7.4: the driver walked out — the trip's cargo is unloaded, so
    // the vehicle leaves the dock and parks `inactive` (never loads again).
    goInactive(sim, v)
    return
  }
  beginLoading(sim, dock, v)
}

/**
 * Q-RUN1 (a) yield condition (M8, several docks): more vehicles wait than
 * docks are free now, the vehicles that yielded earlier this tick excluded.
 * One dock: the queue is non-empty (the dock is this vehicle's).
 */
function yieldWanted(sim: Sim, yielded: readonly number[]): boolean {
  const lane = sim.state.lane
  const waiting = lane.dockQueue.filter((id) => !yielded.includes(id)).length
  const free = lane.docks.filter((d) => d.vehicleId === null).length
  return waiting > free
}

function unloadTick(
  sim: Sim,
  dock: LoadingDock,
  v: Vehicle,
  yielded: number[],
): void {
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
      dock.stuckSinceTick = null
    } else {
      dock.blockedTicksThisDay = (dock.blockedTicksThisDay ?? 0) + 1
      if ((dock.stuckSinceTick ?? null) === null) dock.stuckSinceTick = s.tick
    }
  }
  if (v.cargo.length === 0) {
    finishUnloading(sim, dock, v)
    return
  }
  const stuck = dock.stuckSinceTick ?? null
  if (
    stuck === null ||
    s.tick - stuck < ticksFromS(sim.data.vehicles.dockIdleWaitS)
  ) {
    return
  }
  if (dock.relief !== true && !emptyDrainerQueued(sim) && canRelieve(sim, v)) {
    // Q-RUN1 (c): the shelf takes the lane past its cap until v unloads; the
    // blocked-run timer restarts (a jam that relief cannot clear — a full
    // Hold Bay — still yields dockIdleWaitS later).
    dock.relief = true
    dock.stuckSinceTick = s.tick
    return
  }
  if (yieldWanted(sim, yielded)) {
    yieldDock(sim, v)
    yielded.push(v.id)
  }
}

/** The shelf is at its cap and `v` could carry ≥ 1 of its parcels (Q-RUN1 (c)). */
function canRelieve(sim: Sim, v: Vehicle): boolean {
  const shelf = shelfNode(sim.state.lane)
  return (
    shelf.cap !== null &&
    shelf.queue.length >= shelf.cap &&
    shelfHasEligible(sim, v)
  )
}

/** A queued vehicle with no cargo could load a shelf parcel at once (Q-RUN1 (a) suffices). */
function emptyDrainerQueued(sim: Sim): boolean {
  return sim.state.lane.dockQueue.some((id) => {
    const q = vehicleById(sim, id)
    return q !== null && q.cargo.length === 0 && shelfHasEligible(sim, q)
  })
}

/**
 * Q-RUN1 (a): leave the dock with the remaining cargo for the back of the
 * queue (the cargo goes back to in_transit_in until it docks again).
 */
function yieldDock(sim: Sim, v: Vehicle): void {
  leaveDockBay(sim, v)
  for (const id of v.cargo) {
    const p = sim.state.parcels[String(id)]
    if (p && p.state === 'unloading') p.state = 'in_transit_in'
  }
  joinQueue(sim, v)
}

function loadTick(sim: Sim, dock: LoadingDock, v: Vehicle): void {
  const s = sim.state
  if (!hasDriver(sim, v) && v.cargo.length === 0) {
    // §7.4: a walked-out driver starts no new trip — nothing aboard, so it
    // parks `inactive` (payroll.ts walkOut does this at once; this covers a
    // state saved before it did).
    goInactive(sim, v)
    return
  }
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
      p.trace.push({
        tick: s.tick,
        what: 'loaded',
        ref: String(v.id),
        text: `Loaded onto ${v.name}`,
      })
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
      !carriableInLane(sim, v) ||
      shelfHasEligible(sim, v)
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
    dock.stuckSinceTick = null
    delete dock.relief
    v.dockId = dock.id
    routeTo(sim, v, dockTile(sim, dock.id))
    emitQueueLength(sim)
    repositionQueue(sim)
  }
}

/** Tick step 5. */
export function docksStep(sim: Sim): void {
  const s = sim.state
  /** Vehicles that yielded a dock this tick (Q-RUN1 (a), yieldWanted). */
  const yielded: number[] = []
  for (const dock of s.lane.docks) {
    const v = vehicleById(sim, dock.vehicleId)
    if (!v) continue
    if (v.state === 'docked_unloading') unloadTick(sim, dock, v, yielded)
    else if (v.state === 'docked_loading') loadTick(sim, dock, v)
  }
  assignDocks(sim)
  for (const dock of s.lane.docks) {
    if (dock.vehicleId !== null) dock.busyTicksThisDay += 1
  }
}

// Docks 2-3 (M8) ------------------------------------------------------------------------

/** A loading dock's node or its conveyor. */
const isDockPart = (n: LaneNode): boolean =>
  (n.kind === 'dock' || n.kind === 'conveyor') && n.dockId !== null

/**
 * Add loading dock `index` to the lane (topology only — no price, no event;
 * buyDock, tests, debug): the node pair `dock<index>` → `conv<index>` (the
 * conveyor's `next` = conv1's, its cap machines.conveyorCapPerDock) among
 * the dock / conveyor nodes in number order, and a LoadingDock into
 * lane.docks in number order. The caller checked the index is free.
 */
export function addDock(sim: Sim, index: number): LoadingDock {
  const lane = sim.state.lane
  const id = `dock${index}`
  const convId = `conv${index}`
  const first = lane.docks[0]
  const conv1 = first ? laneNode(lane, first.conveyorNodeId) : null
  if (!conv1) throw new Error('addDock: the lane has no first conveyor')
  const node = (
    nodeId: string,
    kind: 'dock' | 'conveyor',
    next: string[],
    cap: number | null,
  ): LaneNode => ({
    id: nodeId,
    kind,
    next,
    cap,
    queue: [],
    fixture: null,
    stations: [],
    dockId: id,
  })
  const pair = [
    node(id, 'dock', [convId], null),
    node(
      convId,
      'conveyor',
      [...conv1.next],
      sim.data.machines.conveyorCapPerDock,
    ),
  ]
  let at = lane.nodes.findIndex(
    (n) => isDockPart(n) && dockNumber(n.dockId as string) > index,
  )
  if (at < 0) at = lane.nodes.findLastIndex(isDockPart) + 1
  lane.nodes.splice(at, 0, ...pair)
  const dock: LoadingDock = {
    id,
    conveyorNodeId: convId,
    vehicleId: null,
    nextTransferTick: null,
    busyTicksThisDay: 0,
    blockedTicksThisDay: 0,
    stuckSinceTick: null,
  }
  const di = lane.docks.findIndex((d) => dockNumber(d.id) > index)
  if (di < 0) lane.docks.push(dock)
  else {
    lane.docks.splice(di, 0, dock)
    // The feed pointer keeps naming the same conveyor (lane.ts step 4).
    if (lane.feedIndex >= di) lane.feedIndex += 1
  }
  return dock
}

/**
 * The buyDock command (design-m8-m9 §3.1): `invalid` (no economy.docks row
 * with that index — dock 1 included — or already owned), `locked` (level
 * below the row's unlockLevel), `insufficient-funds`; else the dock is
 * added, its price debited and `dock:bought {index, dockId}` emitted. The
 * next assignDocks pass hands it the first queued vehicle.
 */
export function buyDock(sim: Sim, index: number): CommandResult {
  const s = sim.state
  const row = sim.data.economy.docks.find((r) => r.index === index)
  if (!row) return { ok: false, reason: 'invalid' }
  if (s.lane.docks.some((d) => d.id === `dock${index}`)) {
    return { ok: false, reason: 'invalid' }
  }
  if (s.level.level < row.unlockLevel) return { ok: false, reason: 'locked' }
  if (s.economy.balance < row.price) {
    return { ok: false, reason: 'insufficient-funds' }
  }
  const dock = addDock(sim, index)
  if (row.price > 0) sim.debit(row.price, 'purchase')
  sim.emit('dock:bought', { index, dockId: dock.id })
  return { ok: true }
}
