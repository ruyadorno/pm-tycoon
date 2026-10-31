// The Hold Bay (spec §6.6, §9.1, §7.3; plan.md §12.5 task 3; warehouse-view.md
// §3): flagged parcels wait here (cap from the level row) for the player.
//
//   Toss  → the Quarantine Bin (`parcel:tossed {id, wasMalware, bounty,
//           source, employeeId}` — by the player, the sorter or the Sorter
//           Arm, M6; a malware label joins `state.wanted`):
//           malware pays economy.tossBounty (balance AND lifetime earned,
//           "DEFUSED"); a clean parcel is destroyed (its value is lost), the
//           sender is compensated economy.wrongTossFee (clamped to the
//           balance, which never goes negative) and the origin and
//           destination districts take satisfaction.wrongToss each (once
//           per distinct district). Quarantine counters count both.
//   Clear → straight onto the shelf, skipping the slots it has not passed
//           (`parcel:cleared_by_player`); refused with 'shelf-full' while the
//           shelf is at cap (Q35 — Toss always works). A cleared malware
//           parcel costs a life when delivered, and the card says when it
//           was cleared (the 'cleared' trace entry).
// Any Toss / Clear frees a bay (the other held parcels keep theirs — stable
// bays, M3: lane.ts holdBays); a flagged parcel waiting in its slot diverts
// on the next lane step (`lane:resumed`) into the lowest free bay.

import { checkerName, slotLabel } from '../detection.ts'
import type { TossSource } from '../events.ts'
import { modMult } from '../modifiers.ts'
import type { Sim } from '../sim.ts'
import type { BuildingId, Parcel, Strain } from '../types.ts'
import { laneNode, liveSlotIds } from '../types.ts'
import { mapIndex } from '../map.ts'
import {
  enterNode,
  holdNode,
  isActiveSlot,
  shelfNode,
  takeFrom,
} from './lane.ts'
import { addWanted, employeeById } from './people.ts'
import { changeSatisfaction } from './satisfaction.ts'

/** A parcel id currently in the Hold Bay. */
export function isHeld(sim: Sim, parcelId: number): boolean {
  const p = sim.state.parcels[String(parcelId)]
  return p !== undefined && p.state === 'held'
}

/** Who tosses (M6): the player (default), the seated sorter, or the Sorter Arm. */
export interface TossBy {
  source: TossSource
  /** The sorter's Employee id; null for the player and the Arm. */
  employeeId: number | null
}

const BY_PLAYER: TossBy = { source: 'player', employeeId: null }

/** §6.6 Toss. Returns the bounty paid (0 on a wrong Toss). */
export function tossParcel(
  sim: Sim,
  p: Parcel,
  by: TossBy = BY_PLAYER,
): number {
  const s = sim.state
  const lane = s.lane
  const eco = sim.data.economy
  takeFrom(holdNode(lane), p.id)
  delete p.bay
  p.state = 'tossed'
  p.nodeId = lane.binNodeId
  p.nodeEnterTick = s.tick
  const who =
    by.source === 'arm'
      ? 'the Sorter Arm'
      : by.employeeId === null
        ? null
        : (employeeById(s, by.employeeId)?.name ?? null)
  p.trace.push({
    tick: s.tick,
    what: 'tossed',
    ref: lane.binNodeId,
    ...(who === null ? {} : { text: `Tossed by ${who}` }),
  })
  const q = lane.quarantine
  q.count += 1
  const source = { source: by.source, employeeId: by.employeeId }
  if (p.malware) {
    q.malware += 1
    addWanted(s, p.label)
    // Build 3 (B3 §3.6): the tossBounty modifier, read once so the event,
    // the credit and the return agree (still earned: it moves the level
    // clock, Q-B3-3 covers event cash only).
    const bounty = Math.round(eco.tossBounty * modMult(sim, 'tossBounty'))
    sim.emit('parcel:tossed', {
      id: p.id,
      wasMalware: true,
      bounty,
      ...source,
    })
    sim.credit(bounty, 'bounty', true)
    return bounty
  }
  q.clean += 1
  s.stats.wrongToss += 1
  sim.emit('parcel:tossed', {
    id: p.id,
    wasMalware: false,
    bounty: 0,
    ...source,
  })
  // Build 3 (B3 §3.6): × the wrongTossFee modifier, clamped to the balance.
  const fee = Math.min(
    Math.round(eco.wrongTossFee * modMult(sim, 'wrongTossFee')),
    s.economy.balance,
  )
  if (fee > 0) sim.debit(fee, 'wrongToss')
  const origin = mapIndex(sim.data).buildingIdx[p.origin]
  const originDistrict =
    origin === undefined ? null : (sim.data.buildings[origin]?.district ?? null)
  const hit = [originDistrict, p.destRegion].filter(
    (d, i, all): d is string => d !== null && all.indexOf(d) === i,
  )
  for (const d of hit) {
    changeSatisfaction(sim, d, eco.satisfaction.wrongToss, 'other')
  }
  return 0
}

/** §6.6 Clear → the shelf (skips the remaining slots); 'shelf-full' at cap. */
export function clearParcel(sim: Sim, p: Parcel): 'shelf-full' | null {
  const s = sim.state
  const lane = s.lane
  const shelf = shelfNode(lane)
  if (shelf.cap !== null && shelf.queue.length >= shelf.cap) return 'shelf-full'
  const hold = holdNode(lane)
  takeFrom(hold, p.id)
  delete p.bay
  p.trace.push({
    tick: s.tick,
    what: 'cleared',
    ref: hold.id,
    text: 'Cleared by you',
  })
  shelf.queue.push(p.id)
  p.state = 'on_shelf'
  p.nodeId = shelf.id
  p.nodeEnterTick = s.tick
  p.nodeDoneTick = null
  sim.emit('parcel:cleared_by_player', { id: p.id })
  return null
}

// Debug (ViewSim debug.fillHoldBay; debug builds, shots) ------------------------------

/** Announced strains in parcels.json order (the L1 strain at least). */
function strainsNow(sim: Sim): Strain[] {
  const out = sim.data.parcels.malware.strains
    .filter((x) => sim.state.level.announced[x.id] !== undefined)
    .map((x) => x.id)
  return out.length > 0 ? out : ['metal']
}

/** Buildings of live districts (data order), for debug parcels. */
export function liveBuildingIds(sim: Sim): BuildingId[] {
  return sim.data.buildings
    .filter((b) => {
      const d = mapIndex(sim.data).districtById[b.district]
      return d?.kind === 'district' && sim.state.districts[b.district]?.live
    })
    .map((b) => b.id)
}

/**
 * A new parcel object (not placed anywhere yet; the caller places it). M8:
 * `destId` overrides the destination (an overseas pier — the parcel then
 * carries the hub's valueMult).
 */
export function debugParcel(
  sim: Sim,
  k: number,
  malware: boolean,
  strain: Strain,
  destId?: BuildingId,
): Parcel {
  const s = sim.state
  const data = sim.data
  const ids = liveBuildingIds(sim)
  const n = Math.max(1, ids.length)
  const origin = ids[(k * 5) % n] ?? data.buildings[0]?.id ?? ''
  let dest = ids[(k * 5 + 7) % n] ?? origin
  if (dest === origin) dest = ids[(k * 5 + 8) % n] ?? origin
  if (destId !== undefined) dest = destId
  const destDef = data.buildings.find((b) => b.id === dest)
  const destDistrict = destDef
    ? mapIndex(data).districtById[destDef.district]
    : undefined
  const labels = malware
    ? data.puns.malwareLabels[strain]
    : data.puns.decoyLabels[strain]
  const id = s.nextId.parcel
  s.nextId.parcel += 1
  const p: Parcel = {
    id,
    size: 'S',
    baseValue: data.parcels.sizes.S.value,
    mult: destDistrict?.kind === 'overseas' ? destDistrict.valueMult : 1,
    origin,
    dest,
    destRegion: destDef?.district ?? '',
    spawnedTick: s.tick,
    label: labels[k % labels.length] ?? 'debug',
    malware,
    strain: malware ? strain : null,
    decoy: malware ? null : strain,
    magic: false,
    scripted: false,
    state: 'waiting',
    reservedBy: null,
    vehicleId: null,
    nodeId: null,
    nodeEnterTick: null,
    nodeDoneTick: null,
    flaggedBy: null,
    flaggedStrain: null,
    lockedValue: null,
    clearTick: null,
    trace: [{ tick: s.tick, what: 'spawned', ref: origin }],
  }
  s.parcels[String(id)] = p
  s.spawn.spawnedCount += 1
  if (malware) {
    s.spawn.malwareCount += 1
    s.stats.malwareSpawned += 1
  }
  sim.emit('parcel:spawned', {
    id,
    origin,
    dest,
    size: p.size,
    label: p.label,
  })
  return p
}

/**
 * Fill every free bay with a freshly flagged parcel (malware and decoys in
 * turn, over the announced strains) — the "Hold Bay full" setup for shots.
 * Returns how many were added.
 */
export function debugFillHoldBay(sim: Sim): number {
  const s = sim.state
  const lane = s.lane
  const hold = holdNode(lane)
  const strains = strainsNow(sim)
  const slots = liveSlotIds(lane)
  // Flagged "by" the first active checker, in its slot (the Hold Bay card's
  // "Flagged by" line), else by the last slot.
  const active = slots
    .map((id) => laneNode(lane, id))
    .find((n) => n !== null && isActiveSlot(n))
  const checker = active?.fixture?.checker
  const flagNode = active?.id ?? slots.at(-1) ?? hold.id
  const where = checker
    ? `${slotLabel(flagNode)} ${checkerName(sim.data, checker)}`
    : slotLabel(flagNode)
  let k = 0
  while (hold.cap !== null && hold.queue.length < hold.cap) {
    const malware = k % 2 === 0
    const strain = strains[k % strains.length] as Strain
    const p = debugParcel(sim, s.nextId.parcel + k, malware, strain)
    const checkerId = checker?.id ?? 'debug'
    p.flaggedBy = checkerId
    p.flaggedStrain = strain
    p.trace.push({
      tick: s.tick,
      what: 'flagged',
      ref: flagNode,
      text: `${where}: flagged (${strain})`,
      ...(checker ? { chk: checker.id } : {}),
    })
    if (malware) {
      s.stats.malwareCaught += 1
      if (s.stats.firstCatchTick === null) s.stats.firstCatchTick = s.tick
    }
    sim.emit('parcel:flagged', {
      id: p.id,
      checkerId,
      strain,
      nodeId: flagNode,
      scripted: false,
    })
    enterNode(sim, p, hold)
    k += 1
  }
  return k
}
