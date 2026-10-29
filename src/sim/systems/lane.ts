// The intake lane (spec §6.1-§6.4, §6.8; plan.md §6.4 tick step 6) as the
// generic LaneNode[] of spec §6.9: dock1 → conv1 → slot1 … slotN → shelf,
// flagged parcels diverting to the Hold Bay. Flow follows `next` edges and
// passes straight through locked slots (nextLiveNodeId), so no code assumes
// slot indices are the only topology.
//
// M1 = PASS-THROUGH: every slot forwards its buffer head (≤ 1 parcel per node
// per tick) whether or not it holds a fixture; the inspector desk in slot1
// does not process yet. TODO(M2, SIM_FEATURES.lane): stations, process
// timers and the §6.3 roll in place of passThrough() for occupied slots.
//
// Each tick nodes move downstream-first (the shelf end first), so a node's
// space frees before its upstream neighbour pushes; the conveyors then feed
// the first slot round-robin, at most one parcel per tick in total (§6.4).
// A node holding a parcel it cannot push — next buffer full (and not
// draining), Hold Bay full, shelf at cap — keeps it; the most downstream such
// node is the stall root:
// `lane:stalled {reason, nodeId}` when it appears or changes,
// `lane:resumed` when it clears, +0.1 s of stallSecondsToday per stalled
// tick. Nothing is dropped, ever.

import type { StallReason } from '../events.ts'
import type { Sim } from '../sim.ts'
import type { Lane, LaneNode, Parcel } from '../types.ts'
import { laneNode, liveSlotIds, nextLiveNodeId } from '../types.ts'

export function shelfNode(lane: Lane): LaneNode {
  const n = laneNode(lane, lane.shelfNodeId)
  if (!n) throw new Error('lane: no shelf node')
  return n
}

/** A node can take one more parcel (its cap counts its queue; null = unbounded). */
export function hasRoom(node: LaneNode): boolean {
  return node.cap === null || node.queue.length < node.cap
}

/** Any live slot with a fixture and ≥ 1 station (a desk with no inspector is pass-through). */
export function hasActiveChecker(lane: Lane): boolean {
  return liveSlotIds(lane).some((id) => {
    const n = laneNode(lane, id)
    return n !== null && n.fixture !== null && n.stations.length > 0
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
  const tick = sim.state.tick
  node.queue.push(p.id)
  p.nodeId = node.id
  p.nodeEnterTick = tick
  p.nodeDoneTick = null
  if (node.kind === 'slot') {
    p.state = 'in_slot'
    p.trace.push({ tick, what: 'slot', ref: node.id })
    sim.emit('parcel:enteredSlot', { id: p.id, nodeId: node.id, slot: node.id })
  } else if (node.kind === 'shelf') {
    p.state = 'on_shelf'
    p.trace.push({ tick, what: 'shelved', ref: node.id })
    sim.emit('parcel:shelved', { id: p.id })
  } else if (node.kind === 'conveyor') {
    p.state = 'in_conveyor'
  }
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

/** Remove a parcel id from a node's queue (no-op when absent). */
export function takeFrom(node: LaneNode, id: number): void {
  const i = node.queue.indexOf(id)
  if (i >= 0) node.queue.splice(i, 1)
}

/** Forward the buffer head one node downstream if it has room. */
function passThrough(sim: Sim, node: LaneNode, next: LaneNode): boolean {
  const head = node.queue[0]
  if (head === undefined || !hasRoom(next)) return false
  const p = sim.state.parcels[String(head)]
  if (!p) return false
  node.queue.shift()
  enterNode(sim, p, next)
  return true
}

function stallReasonFor(target: LaneNode): StallReason {
  if (target.kind === 'shelf') return 'shelfFull'
  if (target.kind === 'holdBay') return 'holdBayFull'
  return 'bufferFull'
}

/** Tick step 6. */
export function laneStep(sim: Sim): void {
  const s = sim.state
  const lane = s.lane
  const chain = flowChain(lane)
  const nodes = chain.map((id) => laneNode(lane, id))
  /** chain index → the node forwarded a parcel this tick (it is flowing). */
  const moved = nodes.map(() => false)

  // Slots, downstream first (the last chain entry is the shelf).
  for (let i = nodes.length - 2; i >= 0; i--) {
    const node = nodes[i]
    const next = nodes[i + 1]
    if (node && next) moved[i] = passThrough(sim, node, next)
  }

  // Conveyors → the first slot, round-robin, ≤ 1 parcel per tick.
  const head = nodes[0]
  const convs = conveyorIds(lane)
  if (head && convs.length > 0) {
    for (let k = 0; k < convs.length; k++) {
      const conv = laneNode(lane, convs[(s.tick + k) % convs.length] as string)
      if (conv && conv.queue.length > 0) {
        passThrough(sim, conv, head)
        break
      }
    }
  }

  // Stall root: the most downstream node holding a parcel it cannot push
  // into a full target that is not itself flowing (a full buffer that
  // forwarded a parcel this tick is backpressure, not a stall).
  const blocked = (target: LaneNode, ti: number): boolean =>
    !hasRoom(target) && !(moved[ti] ?? false)
  let root: { reason: StallReason; nodeId: string } | null = null
  for (let i = nodes.length - 2; i >= 0 && !root; i--) {
    const node = nodes[i]
    const next = nodes[i + 1]
    if (node && next && node.queue.length > 0 && blocked(next, i + 1)) {
      root = { reason: stallReasonFor(next), nodeId: node.id }
    }
  }
  if (!root && head) {
    for (const id of convs) {
      const conv = laneNode(lane, id)
      if (conv && conv.queue.length > 0 && blocked(head, 0)) {
        root = { reason: stallReasonFor(head), nodeId: conv.id }
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
