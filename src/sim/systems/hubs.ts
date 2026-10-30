// Overseas hubs (spec-core §5.6, spec-build2 §4.1; design-m8-m9 §4.1; tick
// step 8). Docks go live at L3 (the Airport at L5): spawn.ts already sends
// parcels.spawn.overseasShare of the non-same-district spawns to the live
// hubs (by hubWeight among the hubs taking the size, then a pier by `recv`)
// with the overseas malware share ×overseasMult — nothing here draws on the
// rng.
//
// Hand-off (vehicles step 4, dispatch.ts deliverAt on a 'handoff' stop — the
// usual 1.5 s stop at the pier anchor): the parcel leaves the vehicle,
// `handed_off`, its value LOCKED at f(age now) × mult (value.ts lockValue),
// the clearance timer set clearanceS out, trace 'handedOff', then
// `parcel:handedOff`. No satisfaction (hubs have none, SC §9.1), no
// delivery stats, no money.
//
// Clearance (tick step 8, after the lane and the Hold Bay station, before the
// level step — so a clearance that crosses a threshold levels up the same
// tick): every parcel whose clearTick is due, in (clearTick, id) order,
// becomes `cleared` (trace 'customsCleared', stats.cleared) and emits
// `parcel:cleared {paid, malware, hub, buildingId, onTime}` — onTime = the
// hand-off was on time (age at hand-off ≤ onTimeMaxS, the Golden Release
// counter of M7). Clean: the locked value is credited ('clearance', lifetime
// earned) and added to the hub's District.earned. Malware: $0,
// stats.malwareMissed and one life (economy.ts loseLife, the card's
// `viaClearance`; "… Cleared 14:47 — the ship has sailed"). Then one
// `hub:departure {hub, count}` per hub that cleared ≥ 1 parcel this tick, in
// districts.json order (the renderer sails the vessel; R3).
//
// A `handed_off` parcel is placeless (sim.ts OFF_MAP) until it clears; the
// state never enters 'clearing' (design R4). gc removes `cleared` parcels at
// the end of the tick.

import type { GameData, OverseasDistrictDef } from '../../data/types.ts'
import type { CommandResult } from '../commands.ts'
import { buildingDef, mapIndex } from '../map.ts'
import type { Sim } from '../sim.ts'
import type {
  DistrictId,
  Parcel,
  SimState,
  Strain,
  Tick,
  Vehicle,
} from '../types.ts'
import { ticksFromS } from '../types.ts'
import { ageS, isOnTime, lockValue } from '../value.ts'
import { appendDebugRoute, loseLife } from './economy.ts'
import { debugParcel } from './holdbay.ts'

/** The districts.json row of an overseas hub, or null (not a hub). */
export function hubDef(
  data: GameData,
  id: DistrictId,
): OverseasDistrictDef | null {
  const d = mapIndex(data).districtById[id]
  return d?.kind === 'overseas' ? d : null
}

/** The tick a handed-off parcel was handed off: clearTick − clearanceS. */
export function handOffTick(data: GameData, p: Parcel): Tick | null {
  const hub = hubDef(data, p.destRegion)
  if (!hub || p.clearTick === null) return null
  return p.clearTick - ticksFromS(hub.clearanceS)
}

/**
 * Hand a delivering vehicle's parcel off at its overseas pier / terminal
 * (dispatch.ts deliverAt, after taking it out of the cargo and the units).
 * `v` is the delivering vehicle (null for a debug hand-off); nothing here
 * depends on it or its driver — a walked-out driver's vehicle still hands
 * off the stop it drove to (the §7.4 trip end is dispatch.ts's).
 */
export function handOff(sim: Sim, v: Vehicle | null, p: Parcel): void {
  const s = sim.state
  const data = sim.data
  const hub = hubDef(data, p.destRegion)
  if (!hub) {
    throw new Error(
      `handOff: parcel ${p.id} is bound for ${p.destRegion}, not an overseas hub`,
    )
  }
  p.state = 'handed_off'
  p.vehicleId = null
  p.reservedBy = null
  p.nodeId = null
  p.nodeEnterTick = null
  p.nodeDoneTick = null
  p.lockedValue = lockValue(data, p, s.tick)
  p.clearTick = s.tick + ticksFromS(hub.clearanceS)
  p.trace.push({
    tick: s.tick,
    what: 'handedOff',
    ref: p.dest,
    text: `Handed off at ${buildingDef(data, p.dest).name}`,
  })
  sim.emit('parcel:handedOff', {
    id: p.id,
    hub: hub.id,
    lockedValue: p.lockedValue,
    buildingId: p.dest,
  })
}

/** Clearance order: clearTick, then id. */
const byClearance = (a: Parcel, b: Parcel): number =>
  (a.clearTick ?? 0) - (b.clearTick ?? 0) || a.id - b.id

/** Parcels handed off and not yet cleared (optionally of one hub): clearTick asc, then id. */
export function clearingParcels(state: SimState, hub?: DistrictId): Parcel[] {
  const out: Parcel[] = []
  for (const p of Object.values(state.parcels)) {
    if (p.state !== 'handed_off') continue
    if (hub !== undefined && p.destRegion !== hub) continue
    out.push(p)
  }
  return out.toSorted(byClearance)
}

/** Tick step 8: due clearances pay (or cost a life), then the departures. */
export function clearanceStep(sim: Sim): void {
  const s = sim.state
  const data = sim.data
  const due: Parcel[] = []
  for (const p of Object.values(s.parcels)) {
    if (
      p.state === 'handed_off' &&
      p.clearTick !== null &&
      p.clearTick <= s.tick
    ) {
      due.push(p)
    }
  }
  if (due.length === 0) return
  const counts: Record<string, number> = {}
  for (const p of due.toSorted(byClearance)) {
    const hub = hubDef(data, p.destRegion)
    if (!hub) continue // validate.ts: a handed_off parcel is bound for a hub
    const at = handOffTick(data, p) ?? s.tick
    const paid = p.malware ? 0 : (p.lockedValue ?? 0)
    p.state = 'cleared'
    p.trace.push({
      tick: s.tick,
      what: 'customsCleared',
      ref: hub.id,
      text: 'Cleared',
    })
    s.stats.cleared += 1
    counts[hub.id] = (counts[hub.id] ?? 0) + 1
    sim.emit('parcel:cleared', {
      id: p.id,
      paid,
      malware: p.malware,
      hub: hub.id,
      buildingId: p.dest,
      onTime: isOnTime(data, ageS(p, at)),
    })
    if (p.malware) {
      // The ship has sailed (§5.6): no payout, a life at clearance.
      s.stats.malwareMissed += 1
      loseLife(sim, p, true)
      continue
    }
    if (paid > 0) {
      sim.credit(paid, 'clearance', true)
      const d = s.districts[hub.id]
      if (d) d.earned += paid
    }
  }
  for (const d of data.districts) {
    const count = counts[d.id]
    if (count !== undefined) sim.emit('hub:departure', { hub: d.id, count })
  }
}

// Debug (ViewSim debug.forceOverseasMalware; shots, tests) -----------------------------

/**
 * Hand a malware parcel off at a live hub now (the `lost-life-overseas` shot
 * and the "ship has sailed" test): the latest announced strain, bound for
 * the hub's first receiving building, with a plausible back-dated route
 * through the current lane (economy.ts appendDebugRoute), then the normal
 * hand-off — so it costs a life clearanceS later, like a real one.
 */
export function debugOverseasMalware(sim: Sim, hub: DistrictId): CommandResult {
  const s = sim.state
  const data = sim.data
  const def = hubDef(data, hub)
  if (!def) return { ok: false, reason: 'invalid' }
  if (s.districts[hub]?.live !== true) return { ok: false, reason: 'locked' }
  const dest = data.buildings.find((b) => b.district === hub && b.recv > 0)
  if (!dest) return { ok: false, reason: 'invalid' }
  const announced = data.parcels.malware.strains.filter(
    (x) => s.level.announced[x.id] !== undefined,
  )
  const strain: Strain = announced.at(-1)?.id ?? 'metal'
  const p = debugParcel(sim, s.nextId.parcel, true, strain, dest.id)
  const v = s.vehicles[0] ?? null
  appendDebugRoute(sim, p, v)
  handOff(sim, v, p)
  return { ok: true }
}
