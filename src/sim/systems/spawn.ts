// Parcel spawning (spec §5.1, §5.2, §5.4; plan.md §6.4 tick step 2).
//
// Each live district has its own timer: the next spawn is due
// spawnIntervalS × m(satisfaction) after the last (§9.3), the first one
// firstSpawnDelayS after the district went live (start state / unlock).
// One spawn draws, in this order (the rng stream depends on it):
//   1. origin  — weighted by `send` among the district's buildings with fewer
//                than maxWaitingPerBuilding waiting (none → skipped silently,
//                no draw);
//   2. size    — weighted by the district's sizeMix;
//   3. branch  — one next(): < sameDistrictShare → another building of the
//                same district; < + overseasShare and a hub is live → an
//                overseas hub (by hubWeight among hubs taking the size);
//                otherwise a building of another live district. The building
//                is then picked weighted by `recv` (one draw). Origin ≠ dest.
//                overseasShare is ignored while no hub is live (playtest 1);
//   4. malware — after the grace (graceS AND graceCount spawns) and once a
//                strain is announced + newStrainDelayS: chance(share), then a
//                uniform strain;
//   5. decoy   — clean parcels only: chance(decoyShare), uniform trait;
//   6. label   — malware / decoy / clean list of puns.json.
// The first spawn at or after firstScripted.atS is forced malware
// (firstScripted.strain, size firstScripted.size, origin among the districts
// an owned vehicle may serve) with `scripted` = forcedCatch; with no checker
// in the lane it is deferred ≤ deferUntilCheckerS, then spawns as ordinary
// malware. Run decision Q-RUN3 (M3): its origin is further narrowed to where
// a vehicle collects next (a collecting vehicle's target, a delivering
// vehicle's last stop — nextPickupOrigins), so the §4.5 nearest-first tail
// no longer leaves it waiting minutes; while no such building has room the
// forced spawn stays due (a later spawn retries), and from atS +
// deferUntilCheckerS any servable building with room takes it.
// Malware / decoy flags stay hidden until a checker flags them.

import type {
  BuildingDef,
  DistrictDef,
  LiveDistrictDef,
  OverseasDistrictDef,
  SizeId,
  StrainId,
} from '../../data/types.ts'
import {
  mapIndex,
  sizeAllowed,
  typeAllowedIn,
  unitsOf,
  vehicleTypeDef,
  zonePermits,
} from '../map.ts'
import type { Sim } from '../sim.ts'
import type { Parcel, Strain } from '../types.ts'
import { malwareShare, ticksFromS, TICKS_PER_S } from '../types.ts'
import { hasActiveChecker } from './lane.ts'
import { freeUnits, hasDriver } from './vehicles.ts'
import { spawnMultiplier } from './satisfaction.ts'

const SIZES: readonly SizeId[] = ['S', 'M', 'L', 'XL']

/** Ticks until the district's next spawn: spawnIntervalS × m(s) (§5.2, §9.3). */
export function spawnIntervalTicks(
  sim: Sim,
  def: LiveDistrictDef,
  satisfaction: number,
): number {
  const s = def.spawnIntervalS * spawnMultiplier(sim, satisfaction)
  return Math.max(1, Math.round(s * TICKS_PER_S))
}

/** Tick step 2: every live district whose timer is due spawns one parcel. */
export function spawnStep(sim: Sim): void {
  const s = sim.state
  for (const def of sim.data.districts) {
    if (def.kind !== 'district') continue
    const st = s.districts[def.id]
    if (!st?.live || st.nextSpawnTick === null || s.tick < st.nextSpawnTick) {
      continue
    }
    spawnOne(sim, def)
    st.nextSpawnTick = s.tick + spawnIntervalTicks(sim, def, st.satisfaction)
  }
}

type Forced = 'none' | 'scripted' | 'ordinary'

/** §5.4 first scripted malware: due, deferred (no checker) or done. */
function forcedMode(sim: Sim): Forced {
  const s = sim.state
  const sp = s.spawn
  const fs = sim.data.parcels.malware.firstScripted
  if (sp.scriptedDone || s.tick < ticksFromS(fs.atS)) return 'none'
  if (hasActiveChecker(s.lane)) return 'scripted'
  if (sp.scriptedDeferredUntilTick === null) {
    sp.scriptedDeferredUntilTick = s.tick + ticksFromS(fs.deferUntilCheckerS)
    return 'none'
  }
  return s.tick >= sp.scriptedDeferredUntilTick ? 'ordinary' : 'none'
}

const underCap = (sim: Sim, b: BuildingDef): boolean =>
  (sim.state.buildings[b.id]?.waiting.length ?? 0) <
  sim.data.parcels.spawn.maxWaitingPerBuilding

/**
 * Origin pool of the scripted malware (§5.4 servableOrigin): buildings of the
 * live districts at least one owned, driven vehicle may serve (type allowed,
 * home zone permits, size carried). Null when no vehicle is owned (the normal
 * origin rule applies).
 */
function servableOrigins(sim: Sim, size: SizeId): BuildingDef[] | null {
  const s = sim.state
  const fleet = s.vehicles.filter(
    (v) => v.state !== 'inactive' && hasDriver(sim, v),
  )
  if (fleet.length === 0) return null
  const out: BuildingDef[] = []
  for (const d of sim.data.districts) {
    if (d.kind !== 'district' || !s.districts[d.id]?.live) continue
    const served = fleet.some(
      (v) =>
        typeAllowedIn(sim.data, v.type, d.id) &&
        zonePermits(sim.data, v.zone, d.id) &&
        sizeAllowed(vehicleTypeDef(sim.data, v.type), size),
    )
    if (served)
      out.push(...(mapIndex(sim.data).buildingsByDistrict[d.id] ?? []))
  }
  return out
}

/**
 * Run decision Q-RUN3 (M3): the scripted malware's origin pool narrowed to
 * the buildings of `pool` a vehicle is about to collect at — a collecting
 * vehicle's current target, when a parcel of `size` still fits beside what
 * it carries and has reserved, and a delivering vehicle's last stop, where
 * its next collect leg starts nearest-first (§4.5 step 4: the building at
 * its own anchor is the nearest candidate). Vehicles whose driver walked out
 * start no new leg and are skipped.
 */
function nextPickupOrigins(
  sim: Sim,
  pool: readonly BuildingDef[],
  size: SizeId,
): BuildingDef[] {
  const ids: string[] = []
  for (const v of sim.state.vehicles) {
    if (!hasDriver(sim, v)) continue
    if (!sizeAllowed(vehicleTypeDef(sim.data, v.type), size)) continue
    if (v.state === 'collecting') {
      const stop = v.stops[v.stopIndex]
      if (stop && freeUnits(sim, v) >= unitsOf(sim.data, size)) {
        ids.push(stop.buildingId)
      }
    } else if (v.state === 'delivering') {
      const last = v.stops.at(-1)
      if (last) ids.push(last.buildingId)
    }
  }
  return pool.filter((b) => ids.includes(b.id))
}

/** Strains that may spawn now (§5.4: level ≤ company level, announced + delay). */
export function availableStrains(sim: Sim): Strain[] {
  const s = sim.state
  const m = sim.data.parcels.malware
  const delay = ticksFromS(m.newStrainDelayS)
  return m.strains
    .filter((st) => {
      const at = s.level.announced[st.id]
      return (
        st.level <= s.level.level && at !== undefined && s.tick >= at + delay
      )
    })
    .map((st) => st.id)
}

/** Live overseas hubs accepting this size (§5.2; none in playtest 1). */
function liveHubs(sim: Sim, size: SizeId): OverseasDistrictDef[] {
  return sim.data.districts.filter(
    (d): d is OverseasDistrictDef =>
      d.kind === 'overseas' &&
      sim.state.districts[d.id]?.live === true &&
      d.sizes.includes(size),
  )
}

const recv = (b: BuildingDef): number => b.recv

/** §5.2 destination: same district / overseas hub / another live district. */
export function pickDestination(
  sim: Sim,
  origin: BuildingDef,
  size: SizeId,
): BuildingDef | null {
  const rng = sim.rng
  const idx = mapIndex(sim.data)
  const sp = sim.data.parcels.spawn
  const sameDistrict = (): BuildingDef | null =>
    rng.weighted(
      (idx.buildingsByDistrict[origin.district] ?? []).filter(
        (b) => b.id !== origin.id,
      ),
      recv,
    )
  const otherDistricts = (): BuildingDef | null => {
    const pool: BuildingDef[] = []
    for (const d of sim.data.districts) {
      if (d.kind !== 'district' || d.id === origin.district) continue
      if (!sim.state.districts[d.id]?.live) continue
      pool.push(...(idx.buildingsByDistrict[d.id] ?? []))
    }
    return rng.weighted(pool, recv)
  }
  const r = rng.next()
  if (r < sp.sameDistrictShare) {
    return sameDistrict() ?? otherDistricts()
  }
  const hubs = liveHubs(sim, size)
  if (hubs.length > 0 && r < sp.sameDistrictShare + sp.overseasShare) {
    const hub = rng.weighted(hubs, (h) => h.hubWeight)
    const piers = hub ? (idx.buildingsByDistrict[hub.id] ?? []) : []
    const pier = rng.weighted(piers, recv)
    if (pier) return pier
  }
  return otherDistricts() ?? sameDistrict()
}

function spawnOne(sim: Sim, district: LiveDistrictDef): void {
  const s = sim.state
  const data = sim.data
  const rng = sim.rng
  const m = data.parcels.malware
  let forced = forcedMode(sim)
  const forcedSize = m.firstScripted.size

  // 1. origin
  let pool = (mapIndex(data).buildingsByDistrict[district.id] ?? []).filter(
    (b) => underCap(sim, b),
  )
  if (forced !== 'none' && m.firstScripted.servableOrigin) {
    const servable = servableOrigins(sim, forcedSize)
    if (servable !== null) {
      const open = servable.filter((b) => underCap(sim, b))
      // Q-RUN3: where a vehicle collects next; else it stays due (a later
      // spawn retries) until deferUntilCheckerS past atS, then any servable
      // building with room.
      const soon = nextPickupOrigins(sim, open, forcedSize)
      const fs = m.firstScripted
      const late = s.tick >= ticksFromS(fs.atS + fs.deferUntilCheckerS)
      if (soon.some((b) => b.send > 0)) pool = soon
      else if (late && open.some((b) => b.send > 0)) pool = open
      else forced = 'none' // stays due
    }
  }
  const origin = rng.weighted(pool, (b) => b.send)
  if (!origin) return

  // 2. size
  const size: SizeId =
    forced !== 'none'
      ? forcedSize
      : (rng.weighted(SIZES, (z) => district.sizeMix[z]) ?? 'S')

  // 3. destination
  const dest = pickDestination(sim, origin, size)
  if (!dest) return
  const destDistrict = mapIndex(data).districtById[dest.district] as DistrictDef
  const overseas = destDistrict.kind === 'overseas'

  // 4. malware
  let malware = false
  let strain: Strain | null = null
  if (forced !== 'none') {
    malware = true
    strain = m.firstScripted.strain
  } else if (
    s.tick >= ticksFromS(m.graceS) &&
    s.spawn.spawnedCount >= m.graceCount
  ) {
    const strains = availableStrains(sim)
    if (strains.length > 0 && rng.chance(malwareShare(s, data, overseas))) {
      malware = true
      strain = rng.pick(strains)
    }
  }

  // 5. decoy trait (clean parcels only)
  let decoy: StrainId | null = null
  if (!malware && rng.chance(data.parcels.decoyShare)) {
    decoy = rng.pick(m.strains.map((x) => x.id))
  }

  // 6. label
  const puns = data.puns
  const label =
    malware && strain
      ? rng.pick(puns.malwareLabels[strain])
      : decoy
        ? rng.pick(puns.decoyLabels[decoy])
        : rng.pick(puns.cleanLabels)

  const id = s.nextId.parcel
  s.nextId.parcel += 1
  const p: Parcel = {
    id,
    size,
    baseValue: data.parcels.sizes[size].value,
    mult: destDistrict.kind === 'overseas' ? destDistrict.valueMult : 1,
    origin: origin.id,
    dest: dest.id,
    destRegion: dest.district,
    spawnedTick: s.tick,
    label,
    malware,
    strain,
    decoy,
    magic: false,
    scripted: forced === 'scripted' && m.firstScripted.forcedCatch,
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
    trace: [{ tick: s.tick, what: 'spawned', ref: origin.id }],
  }
  s.parcels[String(id)] = p
  s.buildings[origin.id]?.waiting.push(id)
  s.spawn.spawnedCount += 1
  if (malware) {
    s.spawn.malwareCount += 1
    s.stats.malwareSpawned += 1
  }
  if (forced !== 'none') s.spawn.scriptedDone = true
  sim.emit('parcel:spawned', {
    id,
    origin: origin.id,
    dest: dest.id,
    size,
    label,
  })
}
