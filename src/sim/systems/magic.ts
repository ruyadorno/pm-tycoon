// The magic parcel (spec §5.5, spec-build2 §3.3; design-m7 §3.5): spawned by
// the `magic_parcel` quest on Accept at building A — the busiest sender
// (max static `send`) of a servable district — bound for B, a building of
// another servable district within `maxRoadTiles` road tiles of the lot
// entrance (Q-B2-13, so a bike can make the countdown). Size S, golden
// (`magic: true`), never malware; checkers skip it (lane.ts / detection.ts),
// so it is never flagged, held or judged by the sorter. Everything else is an
// ordinary parcel (decay, satisfaction, the waiting penalty, a sold vehicle's
// return); the dispatcher loads it first and makes its stop the first one
// (dispatch.ts, design Q7). Its countdown, cash, life and maxAlive are
// parcels.json `magic` only — quests.json carries no copy.
//
// Servable district (design Q6): live, kind 'district', not a hard-rule
// district (truck-only Industrial would make the countdown a truck lottery),
// and some active, driven vehicle may serve it with a size-S parcel (type
// allowed, home zone permits). Draws: only on the QUEST stream
// (Sim.questRng) — ≤ 1 pick among tied senders, 1 weighted pick of B by
// `recv`; `draw = false` (offer eligibility) never draws. Never sim.rng.

import type { BuildingDef } from '../../data/types.ts'
import {
  anchorOf,
  buildingDef,
  mapIndex,
  sizeAllowed,
  typeAllowedIn,
  vehicleTypeDef,
  zonePermits,
} from '../map.ts'
import type { Sim } from '../sim.ts'
import type {
  BuildingId,
  DistrictId,
  Parcel,
  SimState,
  Size,
} from '../types.ts'
import { hasDriver } from './vehicles.ts'

/** B2 §3.3 "size S" (a rule, not a balance number). */
export const MAGIC_SIZE: Size = 'S'

export interface MagicRoute {
  origin: BuildingId
  dest: BuildingId
}

/** A golden parcel (checkers and the sorter skip it). */
export function isMagicParcel(p: Pick<Parcel, 'magic'>): boolean {
  return p.magic
}

/** Terminal parcel states (sim.ts audit TERMINAL): the parcel is gone. */
const MAGIC_GONE: readonly Parcel['state'][] = [
  'delivered',
  'tossed',
  'cleared',
  'lost',
]

/**
 * The golden parcel still on its way (not delivered), or null — at most
 * parcels.json magic.maxAlive of them, so the first; outlives a failed or
 * abandoned quest (B2 §3.3 "while it is alive").
 */
export function liveMagicParcel(state: SimState): Parcel | null {
  if (state.spawn.magicAlive <= 0) return null
  for (const p of Object.values(state.parcels)) {
    if (p.magic && !MAGIC_GONE.includes(p.state)) return p
  }
  return null
}

/** Districts (districts.json order) a magic parcel may start or end in now. */
export function servableDistricts(sim: Sim): DistrictId[] {
  const s = sim.state
  const data = sim.data
  const fleet = s.vehicles.filter(
    (v) => v.state !== 'inactive' && hasDriver(sim, v),
  )
  const out: DistrictId[] = []
  for (const d of data.districts) {
    if (d.kind !== 'district' || d.hardRule || !s.districts[d.id]?.live) {
      continue
    }
    const served = fleet.some(
      (v) =>
        typeAllowedIn(data, v.type, d.id) &&
        zonePermits(data, v.zone, d.id) &&
        sizeAllowed(vehicleTypeDef(data, v.type), MAGIC_SIZE),
    )
    if (served) out.push(d.id)
  }
  return out
}

/**
 * A (busiest sender with room) and B (another servable district, recv > 0,
 * ≤ maxRoadTiles road tiles from the lot entrance), or null when either is
 * missing. `draw` false: the first max-send A and the first B, no draw.
 */
export function magicRoute(
  sim: Sim,
  maxRoadTiles: number,
  draw: boolean,
): MagicRoute | null {
  const s = sim.state
  const data = sim.data
  const idx = mapIndex(data)
  const servable = servableDistricts(sim)
  if (servable.length < 2) return null
  const entrance = sim.roads.entrance
  const near = (b: BuildingDef): boolean =>
    b.recv > 0 &&
    sim.paths.distance(entrance, anchorOf(data, b.id)) <= maxRoadTiles
  const bFor = (origin: DistrictId): BuildingDef[] =>
    servable
      .filter((d) => d !== origin)
      .flatMap((d) => idx.buildingsByDistrict[d] ?? [])
      .filter(near)
  const room = data.parcels.spawn.maxWaitingPerBuilding
  const senders = servable
    .flatMap((d) => idx.buildingsByDistrict[d] ?? [])
    .filter(
      (b) =>
        b.send > 0 &&
        (s.buildings[b.id]?.waiting.length ?? room) < room &&
        bFor(b.district).length > 0,
    )
  if (senders.length === 0) return null
  const busiest = senders.reduce((m, b) => Math.max(m, b.send), 0)
  const tied = senders.filter((b) => b.send === busiest)
  const a =
    draw && tied.length > 1 ? sim.questRng.pick(tied) : (tied[0] as BuildingDef)
  const bs = bFor(a.district)
  const b = draw ? sim.questRng.weighted(bs, (x) => x.recv) : (bs[0] ?? null)
  if (!b) return null
  return { origin: a.id, dest: b.id }
}

/**
 * Spawn the golden parcel at `route.origin` now: like spawn.ts (size S, its
 * base value, mult 1, a clean label without a draw — cleanLabels[spawnedCount
 * % n]), `magic: true`; spawnedCount (conservation) and spawn.magicAlive +1;
 * `parcel:spawned`. Not malware, so not in malwareCount.
 */
export function spawnMagicParcel(sim: Sim, route: MagicRoute): Parcel {
  const s = sim.state
  const data = sim.data
  const dest = buildingDef(data, route.dest)
  const labels = data.puns.cleanLabels
  const label = labels[s.spawn.spawnedCount % labels.length] ?? 'golden'
  const id = s.nextId.parcel
  s.nextId.parcel += 1
  const p: Parcel = {
    id,
    size: MAGIC_SIZE,
    baseValue: data.parcels.sizes[MAGIC_SIZE].value,
    mult: 1,
    origin: route.origin,
    dest: route.dest,
    destRegion: dest.district,
    spawnedTick: s.tick,
    label,
    malware: false,
    strain: null,
    decoy: null,
    magic: true,
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
    trace: [{ tick: s.tick, what: 'spawned', ref: route.origin }],
  }
  s.parcels[String(id)] = p
  s.buildings[route.origin]?.waiting.push(id)
  s.spawn.spawnedCount += 1
  s.spawn.magicAlive += 1
  sim.emit('parcel:spawned', {
    id,
    origin: route.origin,
    dest: route.dest,
    size: p.size,
    label,
  })
  return p
}
