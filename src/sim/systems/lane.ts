// The intake lane (spec §6.1-§6.4, §6.6-§6.8; plan.md §6.4 tick step 6) as
// the generic LaneNode[] of spec §6.9: dock1 → conv1 (cap 6) → slot1 … slotN
// (each empty | machine | desk, input buffer cap 2) → shelf, flagged parcels
// diverting to the Hold Bay (`hold`, cap from the level row). Flow follows
// `next` edges and passes straight through locked slots (nextLiveNodeId), so
// no code assumes slot indices are the only topology.
//
// A slot with a fixture and ≥ 1 station is ACTIVE: a parcel entering it waits
// in the buffer until a station is free (`parcel:processing`), is processed
// for the checker's processTicks (stations in parallel — a desk seats 1-3
// inspectors), then rolled once on exit (detection.ts; `parcel:flagged`).
// Flagged → the Hold Bay at once (`parcel:held`), skipping every downstream
// checker; otherwise on to the next node. Any other slot is PASS-THROUGH
// (0 s). Every node hands on at most one parcel per tick.
//
// One tick, in order:
//   1. completions, lane order (slot1 first): stations whose time is up roll
//      (so the rng and the flag events follow the lane order);
//   2. diverts, lane order: one flagged, finished parcel per slot → the Hold
//      Bay if a bay is free (bays fill in lane order, warehouse-view.md §3.5);
//   3. forwards, shelf end first: one clean, finished parcel (pass-through:
//      the buffer head) → the next node if it has room; then the slot seats
//      its buffer head(s) in free stations — so a station freed this tick
//      starts its next parcel this tick (1 inspector = 15/min exactly) and the
//      buffer has room before the node upstream pushes;
//   4. the conveyors feed the first slot round-robin, ≤ 1 parcel per tick:
//      from lane.feedIndex on, the first conveyor holding a parcel is the
//      candidate (none fed if the head has no room); a feed moves the pointer
//      past it (M8 — with the 4 s desk slot 1 frees on a fixed tick parity,
//      so a tick-parity rotation starved one conveyor; one conveyor keeps
//      feedIndex 0, bit-identical to playtest 1) — except that while a dock
//      in Q-RUN1 relief (docks.ts) has a parcel on its conveyor, the
//      lowest-numbered such dock is the candidate and takes every feed: its
//      vehicle unloads at the lane's full rate, as with one dock, instead of
//      1/n of it while the other docks' conveyors push the shelf further past
//      its cap (M8 review: a relieving truck stayed docked 2-3 min with two
//      docks). One relieving dock at a time ends each relief soonest;
//   5. the stall root (below).
//
// Stalls (§6.4, nothing is ever dropped): the most downstream node holding a
// finished parcel it cannot hand on — a flagged one with every bay full
// (`holdBayFull`), a clean one with the shelf at cap (`shelfFull`), or a full
// next buffer that is neither moving nor processing (`bufferFull`). A slot
// that is busy processing is backpressure, not a stall, and so is every full
// buffer upstream of it (so a saturated desk never flaps the warehouse
// button, in whichever slot it sits). While a docked vehicle that can
// drain the shelf is in Q-RUN1 relief (docks.ts) the shelf takes parcels
// past its cap. `lane:stalled {reason, nodeId}` when the
// root appears or changes, `lane:resumed` when it clears, +0.1 s of
// stallSecondsToday per stalled tick.
//
// Desks (M6, spec-build2 §2.3): each station is one seated inspector with its
// own p / decoyFlag / process time (people.ts syncDesk keeps them in step
// with the crew); a parcel at a desk rolls the processing inspector's p.
//
// Fixtures (§6.2, warehouse-view.md §2.3 / Q31): parcels belong to the node,
// not the fixture. When a slot's fixture changes (bought, moved, swapped,
// removed) `reseat` re-seats the station parcels
// under the new fixture: a parcel mid-process restarts its process time, a
// finished one keeps its roll; with no station left (or more parcels than
// stations) they go back to the front of the buffer, which may then sit
// above its cap until it drains (hasRoom refuses new parcels meanwhile), and
// pass through when the slot is now empty.

import {
  checkerName,
  rollChecker,
  rolledBy,
  slotLabel,
  slotResultEntry,
  stationChecker,
} from '../detection.ts'
import type { StallReason } from '../events.ts'
import type { Sim } from '../sim.ts'
import type {
  Checker,
  Fixture,
  Lane,
  LaneNode,
  Parcel,
  SimState,
  Station,
  Strain,
} from '../types.ts'
import { laneNode, liveSlotIds, nextLiveNodeId } from '../types.ts'
import { employeeById, fireEmployee, syncDesk } from './people.ts'

export function shelfNode(lane: Lane): LaneNode {
  const n = laneNode(lane, lane.shelfNodeId)
  if (!n) throw new Error('lane: no shelf node')
  return n
}

export function holdNode(lane: Lane): LaneNode {
  const n = laneNode(lane, lane.holdBayNodeId)
  if (!n) throw new Error('lane: no Hold Bay node')
  return n
}

/** A node can take one more parcel (its cap counts its queue; null = unbounded). */
export function hasRoom(node: LaneNode): boolean {
  return node.cap === null || node.queue.length < node.cap
}

/** A live slot with a fixture and ≥ 1 station (a desk with no inspector is pass-through). */
export function isActiveSlot(node: LaneNode): boolean {
  return (
    node.kind === 'slot' &&
    !node.locked &&
    node.fixture !== null &&
    node.stations.length > 0
  )
}

/** Any live slot with a fixture and ≥ 1 station. */
export function hasActiveChecker(lane: Lane): boolean {
  return liveSlotIds(lane).some((id) => {
    const n = laneNode(lane, id)
    return n !== null && isActiveSlot(n)
  })
}

/** Conveyor node ids in lane.docks order. */
export function conveyorIds(lane: Lane): string[] {
  return lane.docks.map((d) => d.conveyorNodeId)
}

/**
 * Parcel ids inside the lane before the shelf (conveyors, slot buffers and
 * stations), upstream first — the "parcels still inside the lane" of the
 * dock idle-wait rule (§4.6). The Hold Bay is not included: a held parcel
 * only moves on the player's Toss / Clear.
 */
export function laneParcelIds(lane: Lane): number[] {
  const out: number[] = []
  for (const id of conveyorIds(lane)) {
    out.push(...(laneNode(lane, id)?.queue ?? []))
  }
  for (const id of liveSlotIds(lane)) {
    const n = laneNode(lane, id)
    if (!n) continue
    out.push(...n.queue)
    for (const st of n.stations) if (st.parcelId !== null) out.push(st.parcelId)
  }
  return out
}

/** Live node ids a parcel visits after the conveyors, ending with the first non-slot (the shelf). */
function flowChain(lane: Lane): string[] {
  const out: string[] = []
  const first = conveyorIds(lane)[0]
  let id = first === undefined ? null : nextLiveNodeId(lane, first)
  for (let guard = 0; id !== null && guard <= lane.nodes.length; guard++) {
    out.push(id)
    const n = laneNode(lane, id)
    if (!n || n.kind !== 'slot') break
    id = nextLiveNodeId(lane, id)
  }
  return out
}

/** Put a parcel into a node (state, trace and the node's enter event). */
export function enterNode(sim: Sim, p: Parcel, node: LaneNode): void {
  const s = sim.state
  const tick = s.tick
  node.queue.push(p.id)
  p.nodeId = node.id
  p.nodeEnterTick = tick
  p.nodeDoneTick = null
  if (node.kind === 'slot') {
    p.state = 'in_slot'
    sim.emit('parcel:enteredSlot', { id: p.id, nodeId: node.id, slot: node.id })
  } else if (node.kind === 'shelf') {
    p.state = 'on_shelf'
    p.trace.push({ tick, what: 'shelved', ref: node.id })
    sim.emit('parcel:shelved', { id: p.id })
  } else if (node.kind === 'conveyor') {
    p.state = 'in_conveyor'
  } else if (node.kind === 'holdBay') {
    p.state = 'held'
    p.bay = freeBay(s, node, p.id)
    p.trace.push({ tick, what: 'held', ref: node.id })
    s.stats.holdBayEvents += 1
    sim.emit('parcel:held', { id: p.id })
  }
}

/**
 * The Hold Bay rack position of every held parcel (M3, stable bays): its own
 * `bay` when it has one (kept from arrival until it leaves); a parcel without
 * one (held in a pre-M3 save, or put there by a test) takes the lowest bay
 * left free, in arrival order. Parcel id → bay.
 */
export function holdBays(
  state: SimState,
  hold: LaneNode,
): Record<string, number> {
  const out: Record<string, number> = {}
  const used: number[] = []
  for (const id of hold.queue) {
    const b = state.parcels[String(id)]?.bay
    if (b !== undefined && !used.includes(b)) {
      out[String(id)] = b
      used.push(b)
    }
  }
  for (const id of hold.queue) {
    if (out[String(id)] !== undefined) continue
    let b = 0
    while (used.includes(b)) b += 1
    out[String(id)] = b
    used.push(b)
  }
  return out
}

/** The lowest bay no other held parcel occupies (the arriving `id` excluded). */
function freeBay(state: SimState, hold: LaneNode, id: number): number {
  const taken = holdBays(state, {
    ...hold,
    queue: hold.queue.filter((x) => x !== id),
  })
  const used = Object.values(taken)
  let b = 0
  while (used.includes(b)) b += 1
  return b
}

/** Sold-vehicle cargo (§4.1, §6.8): back on the shelf, accepted past cap. */
export function returnToShelf(sim: Sim, p: Parcel): void {
  const shelf = shelfNode(sim.state.lane)
  const tick = sim.state.tick
  shelf.queue.push(p.id)
  p.state = 'on_shelf'
  p.nodeId = shelf.id
  p.nodeEnterTick = tick
  p.nodeDoneTick = null
  p.vehicleId = null
  p.reservedBy = null
  p.trace.push({ tick, what: 'returned', ref: shelf.id })
  sim.emit('parcel:returned', { id: p.id })
}

/**
 * A sold vehicle's INBOUND cargo (picked up, not yet through the lane): onto
 * its dock's conveyor (the first one when it was not docked), accepted past
 * the cap like the shelf takes outbound cargo (§4.1) — it still passes every
 * checker: nothing is waved through (§6.4). `parcel:unloaded` as if the
 * vehicle had unloaded it.
 */
export function returnToConveyor(
  sim: Sim,
  p: Parcel,
  dockId: string | null,
  vehicleName: string,
): void {
  const lane = sim.state.lane
  const dock = lane.docks.find((d) => d.id === dockId) ?? lane.docks[0]
  const conv = dock ? laneNode(lane, dock.conveyorNodeId) : null
  if (!dock || !conv) {
    returnToShelf(sim, p)
    return
  }
  p.vehicleId = null
  p.reservedBy = null
  enterNode(sim, p, conv)
  p.trace.push({
    tick: sim.state.tick,
    what: 'unloaded',
    ref: dock.id,
    text: `Unloaded (${vehicleName} sold)`,
  })
  sim.emit('parcel:unloaded', { id: p.id, dockId: dock.id })
}

/**
 * The parcel's latest 'unloaded' hop is returnToConveyor's (a sold vehicle's
 * cargo, taken past the conveyor's cap) — the only 'unloaded' entry that
 * stores its card line (it names the vehicle); a dock unload stores none
 * (docks.ts unloadTick). auditState bounds a conveyor by its cap plus these.
 */
export function isSoldInbound(p: Parcel): boolean {
  const t = p.trace.findLast((x) => x.what === 'unloaded')
  return t !== undefined && t.text !== undefined
}

/** Remove a parcel id from a node's queue (no-op when absent). */
export function takeFrom(node: LaneNode, id: number): void {
  const i = node.queue.indexOf(id)
  if (i >= 0) node.queue.splice(i, 1)
}

// Processing ------------------------------------------------------------------------

const parcelOf = (sim: Sim, id: number | null): Parcel | null =>
  id === null ? null : (sim.state.parcels[String(id)] ?? null)

/** A flagged parcel still in a slot waits to divert to the Hold Bay. */
const isFlagged = (p: Parcel): boolean => p.flaggedBy !== null

/**
 * Seat a parcel in a free station: a parcel already rolled at this node (it
 * came back from a fixture change), a magic one (checkers skip it, §5.5) or
 * one this very checker already rolled in another slot (one roll per parcel
 * per checker, §6.3 — trace "already checked") is done at once; anything
 * else starts its process time (`parcel:processing`).
 */
function seat(sim: Sim, node: LaneNode, st: Station, id: number): void {
  const tick = sim.state.tick
  const p = parcelOf(sim, id)
  const c = node.fixture?.checker
  st.parcelId = id
  if (!p || !c || p.nodeDoneTick !== null || p.magic) {
    st.doneTick = tick
    return
  }
  if (rolledBy(p, c.id)) {
    // One roll per parcel per checker (§6.3): this checker already rolled
    // it in another slot (it was moved downstream of the parcel) — done.
    st.doneTick = tick
    p.nodeDoneTick = tick
    p.trace.push({
      tick,
      what: 'skipped',
      ref: node.id,
      text: `${slotLabel(node.id)} ${checkerName(sim.data, c)}: already checked`,
    })
    return
  }
  st.doneTick = tick + (st.processTicks ?? c.processTicks)
  sim.emit('parcel:processing', { id, nodeId: node.id })
}

/** Fill the free stations of an active slot from its buffer head. */
function seatFromBuffer(sim: Sim, node: LaneNode): void {
  for (const st of node.stations) {
    if (st.parcelId !== null) continue
    const id = node.queue.shift()
    if (id === undefined) return
    seat(sim, node, st, id)
  }
}

/** Flag a parcel at a checker (§6.3, §6.6): the reveal; it diverts next. */
function flag(
  sim: Sim,
  node: LaneNode,
  c: Checker,
  p: Parcel,
  strain: Strain,
): void {
  const s = sim.state
  p.flaggedBy = c.id
  p.flaggedStrain = strain
  if (p.malware) {
    s.stats.malwareCaught += 1
    if (s.stats.firstCatchTick === null) s.stats.firstCatchTick = s.tick
  }
  sim.emit('parcel:flagged', {
    id: p.id,
    checkerId: c.id,
    strain,
    nodeId: node.id,
    scripted: p.scripted,
  })
}

/**
 * A station's process time is up: the one roll on exit (detection.ts) — at a
 * desk with the processing inspector's own p / decoyFlag (same checker id,
 * so still one roll per parcel per desk), and the result names them.
 */
function finishProcessing(
  sim: Sim,
  node: LaneNode,
  st: Station,
  p: Parcel,
): void {
  const c = node.fixture?.checker
  if (!c) return
  const tick = sim.state.tick
  p.nodeDoneTick = tick
  const sc = stationChecker(c, st)
  const strain = p.magic ? null : rollChecker(sim, sc, p)
  const e =
    st.employeeId === undefined ? null : employeeById(sim.state, st.employeeId)
  const who = e ? { id: e.id, name: e.name } : undefined
  p.trace.push(slotResultEntry(sim.data, tick, node, sc, p, strain, who))
  if (strain !== null) flag(sim, node, c, p, strain)
}

interface Ready {
  p: Parcel
  /** The station holding it, or null for a pass-through buffer head. */
  st: Station | null
}

/**
 * Parcels at a slot that may leave this tick, in exit order: a pass-through
 * slot's buffer head (FIFO); an active slot's finished station parcels,
 * earliest finish first (ties → lower station).
 */
function readyParcels(sim: Sim, node: LaneNode): Ready[] {
  if (!isActiveSlot(node)) {
    const p = parcelOf(sim, node.queue[0] ?? null)
    return p ? [{ p, st: null }] : []
  }
  const out: { r: Ready; done: number; i: number }[] = []
  node.stations.forEach((st, i) => {
    const p = parcelOf(sim, st.parcelId)
    if (p && p.nodeDoneTick !== null) {
      out.push({ r: { p, st }, done: st.doneTick ?? 0, i })
    }
  })
  return out.toSorted((a, b) => a.done - b.done || a.i - b.i).map((x) => x.r)
}

/** Move a ready parcel out of `node` into `target`. */
function handOn(sim: Sim, node: LaneNode, r: Ready, target: LaneNode): void {
  if (r.st) {
    r.st.parcelId = null
    r.st.doneTick = null
  } else {
    takeFrom(node, r.p.id)
    if (r.p.nodeDoneTick === null && !isFlagged(r.p)) {
      // Passed an empty slot (or one whose fixture left mid-process).
      r.p.trace.push(
        slotResultEntry(sim.data, sim.state.tick, node, null, r.p, null),
      )
    }
  }
  enterNode(sim, r.p, target)
}

/** An active slot with a station still processing (backpressure, not a stall). */
function busy(sim: Sim, node: LaneNode): boolean {
  if (!isActiveSlot(node)) return false
  return node.stations.some((st) => {
    const p = parcelOf(sim, st.parcelId)
    return p !== null && p.nodeDoneTick === null
  })
}

/** Tick step 6. */
export function laneStep(sim: Sim): void {
  const s = sim.state
  const lane = s.lane
  const hold = holdNode(lane)
  const chain = flowChain(lane)
    .map((id) => laneNode(lane, id))
    .filter((n): n is LaneNode => n !== null)
  const slots = chain.filter((n) => n.kind === 'slot')
  /** Node id → it handed a parcel on this tick. */
  const moved: Record<string, boolean> = {}
  // Q-RUN1 (c) relief (docks.ts): the shelf takes the lane's parcels past
  // its cap while a docked vehicle that can drain it unloads.
  const relief = lane.docks.some((d) => d.relief === true)
  const accepts = (target: LaneNode): boolean =>
    hasRoom(target) || (relief && target.kind === 'shelf')

  // 1. completions, lane order.
  for (const node of slots) {
    if (!isActiveSlot(node)) continue
    for (const st of node.stations) {
      if (st.doneTick === null || s.tick < st.doneTick) continue
      const p = parcelOf(sim, st.parcelId)
      if (p && p.nodeDoneTick === null) finishProcessing(sim, node, st, p)
    }
  }

  // 2. diverts to the Hold Bay, lane order.
  for (const node of slots) {
    if (!hasRoom(hold)) break
    // (A pass-through slot offers only its buffer head: FIFO.)
    const flagged = readyParcels(sim, node).find((x) => isFlagged(x.p))
    if (flagged) {
      handOn(sim, node, flagged, hold)
      moved[node.id] = true
    }
  }

  // 3. forwards, shelf end first; then seat the buffer.
  for (let i = chain.length - 2; i >= 0; i--) {
    const node = chain[i] as LaneNode
    const next = chain[i + 1] as LaneNode
    if (!moved[node.id] && accepts(next)) {
      const r = readyParcels(sim, node).find((x) => !isFlagged(x.p))
      if (r) {
        handOn(sim, node, r, next)
        moved[node.id] = true
      }
    }
    if (isActiveSlot(node)) seatFromBuffer(sim, node)
  }

  // 4. conveyors → the first node, round-robin from lane.feedIndex, ≤ 1
  // parcel per tick — except that the lowest-numbered dock in Q-RUN1 relief
  // whose conveyor holds a parcel takes every feed (see the header).
  const head = chain[0]
  const convs = conveyorIds(lane)
  const n = convs.length
  if (head && n > 0) {
    const ri = lane.docks.findIndex(
      (d) =>
        d.relief === true &&
        (laneNode(lane, d.conveyorNodeId)?.queue.length ?? 0) > 0,
    )
    const from = ri >= 0 ? ri : lane.feedIndex % n
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n
      const conv = laneNode(lane, convs[i] as string)
      if (!conv || conv.queue.length === 0) continue
      const p = parcelOf(sim, conv.queue[0] ?? null)
      if (p && hasRoom(head)) {
        conv.queue.shift()
        enterNode(sim, p, head)
        moved[conv.id] = true
        lane.feedIndex = (i + 1) % n
      }
      break
    }
  }

  // 5. the stall root, shelf end first. A full target that is moving or
  // processing — or that is itself only held up by such a node further
  // down (`backed`) — is backpressure, a queue and not a stall, wherever
  // the slow checker sits (a desk behind a machine or in slot 3 included).
  const backed: Record<string, boolean> = {}
  const blocked = (target: LaneNode): StallReason | 'backpressure' | null => {
    if (accepts(target)) return null
    if (target.kind === 'holdBay') return 'holdBayFull'
    if (target.kind === 'shelf') return 'shelfFull'
    if (moved[target.id] || busy(sim, target) || backed[target.id]) {
      return 'backpressure'
    }
    return 'bufferFull'
  }
  let root: { reason: StallReason; nodeId: string } | null = null
  for (let i = chain.length - 2; i >= 0 && !root; i--) {
    const node = chain[i] as LaneNode
    const next = chain[i + 1] as LaneNode
    for (const r of readyParcels(sim, node)) {
      const reason = blocked(isFlagged(r.p) ? hold : next)
      if (reason === 'backpressure') {
        backed[node.id] = true
      } else if (reason) {
        root = { reason, nodeId: node.id }
        break
      }
    }
  }
  if (!root && head) {
    for (const id of convs) {
      const conv = laneNode(lane, id)
      const reason = conv && conv.queue.length > 0 ? blocked(head) : null
      if (conv && reason && reason !== 'backpressure') {
        root = { reason, nodeId: conv.id }
        break
      }
    }
  }
  setStall(sim, root)
}

function setStall(
  sim: Sim,
  root: { reason: StallReason; nodeId: string } | null,
): void {
  const lane = sim.state.lane
  if (root) {
    const changed =
      !lane.stalled ||
      lane.stallReason !== root.reason ||
      lane.stallNodeId !== root.nodeId
    if (!lane.stalled) lane.stallSinceTick = sim.state.tick
    lane.stalled = true
    lane.stallReason = root.reason
    lane.stallNodeId = root.nodeId
    lane.stallSecondsToday = Math.round(lane.stallSecondsToday * 10 + 1) / 10
    if (changed) sim.emit('lane:stalled', { ...root })
  } else if (lane.stalled) {
    lane.stalled = false
    lane.stallReason = null
    lane.stallNodeId = null
    lane.stallSinceTick = null
    sim.emit('lane:resumed', {})
  }
}

// Fixtures (§6.2, §6.7; warehouse-view.md §2.3) ---------------------------------------------

/**
 * Re-seat a slot's station parcels under its current fixture (Q31): as many
 * stations as the fixture has (a desk: one per seated inspector, rebuilt by
 * people.ts syncDesk); parcels mid-process restart their process time,
 * finished ones stay finished; the rest go back to the front of the buffer
 * (and pass through if the slot is now empty).
 */
export function reseat(sim: Sim, node: LaneNode): void {
  const ids = node.stations.flatMap((st) =>
    st.parcelId === null ? [] : [st.parcelId],
  )
  if (node.fixture?.kind === 'desk') {
    node.stations = []
    syncDesk(sim, node)
  } else {
    const n = node.fixture ? node.fixture.checker.stations : 0
    node.stations = Array.from({ length: n }, () => ({
      parcelId: null,
      doneTick: null,
    }))
  }
  const back: number[] = []
  for (const id of ids) {
    const st = node.stations.find((x) => x.parcelId === null)
    if (st) seat(sim, node, st, id)
    else back.push(id)
  }
  if (back.length > 0) node.queue.unshift(...back)
}

/** Point a desk's inspectors (and walked-out ones) at the node it now sits in. */
function relinkDesk(sim: Sim, node: LaneNode): void {
  const f = node.fixture
  if (f?.kind !== 'desk') return
  for (const e of sim.state.employees) {
    if (f.inspectorIds.includes(e.id) || f.walkedOutIds.includes(e.id)) {
      e.nodeId = node.id
    }
  }
}

/** Install a fixture in an empty slot (bought machine / placed desk). */
export function placeFixture(sim: Sim, node: LaneNode, fixture: Fixture): void {
  node.fixture = fixture
  relinkDesk(sim, node)
  reseat(sim, node)
}

/**
 * Move `from`'s fixture to `to` (free, §6.2); an occupied `to` swaps (Q30).
 * Parcels stay in their nodes and re-seat under the new fixtures (Q31).
 * Returns whether it was a swap.
 */
export function moveFixture(sim: Sim, from: LaneNode, to: LaneNode): boolean {
  const a = from.fixture
  const b = to.fixture
  to.fixture = a
  from.fixture = b
  relinkDesk(sim, to)
  relinkDesk(sim, from)
  reseat(sim, from)
  reseat(sim, to)
  return b !== null
}

/**
 * Take the fixture out of a slot: the desk's inspectors (active and walked
 * out) leave for good — `worker:fired {reason: 'deskRemoved'}` each, no
 * refund; the station parcels pass through (Q31). Returns the removed
 * fixture.
 */
export function removeFixture(sim: Sim, node: LaneNode): Fixture | null {
  const f = node.fixture
  if (!f) return null
  node.fixture = null
  reseat(sim, node)
  if (f.kind === 'desk') {
    for (const id of [...f.inspectorIds, ...f.walkedOutIds]) {
      const e = employeeById(sim.state, id)
      if (e) fireEmployee(sim, e, 'deskRemoved')
    }
  }
  return f
}
