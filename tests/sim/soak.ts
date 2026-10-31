// Randomized loading-dock soak scenarios (run decision Q-RUN1; spec §4.6
// "with one dock the cycle cannot deadlock", §6.4 "nothing is dropped,
// ever"; M8: the same with docks 2-3 bought, design-m8-m9 §7 M8 4).
// Each scenario is a quiet L2 game with a random fleet and random home
// zones, a shelf filled to its cap with random destinations (often ones the
// fleet cannot serve yet — the full-shelf jam), random parcels already in
// the lane and waiting in the city, a player who Tosses every flag, and —
// part-way through — a random "capability event" (every zone → any, or a
// truck / van / bike bought). Afterwards, while some vehicle could carry a
// shelf parcel, the docks must keep turning over and the shelf must drain.
// The scenario rng is the test's own (never the sim stream); `docks: 1` (the
// default) draws exactly as before M8, so its seeds are the M2 review's.

import { auditState } from '../../src/sim/sim.ts'
import type { Sim } from '../../src/sim/sim.ts'
import { cardOptions } from '../../src/sim/systems/deck.ts'
import { outboundEligible } from '../../src/sim/systems/dispatch.ts'
import { addDock } from '../../src/sim/systems/docks.ts'
import type {
  BuildingId,
  Size,
  Vehicle,
  VehicleType,
} from '../../src/sim/types.ts'
import { laneNode } from '../../src/sim/types.ts'
import {
  buy,
  fund,
  injectParcel,
  laneParcel,
  placeMachine,
  quietSim,
  shelveParcel,
  unlockDistrict,
} from './helpers.ts'

/** mulberry32 — the scenario's own stream. */
function scenarioRng(seed: number): () => number {
  let a = (seed * 0x9e3779b1) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SoakResult {
  seed: number
  /** Human-readable failure, or null when every check held. */
  failure: string | null
  /** The capability event applied part-way through. */
  event: string
  /** Seconds from the event until the shelf first dropped below its cap (−1 never, 0 already). */
  drainS: number
  /** Longest continuous dock stay (s) by one vehicle after the event. */
  maxDockedS: number
  deliveriesAfter: number
  /** Most parcels the shelf held past its cap after the event (Q-RUN1 (c) relief). */
  maxShelfOver: number
}

const TYPES: VehicleType[] = ['bike', 'bike', 'van', 'truck']
const SIZES: Size[] = ['S', 'S', 'S', 'M', 'L', 'XL']

/** The parcel sizes a district hands out to its buildings in this soak. */
function sizeFor(r: () => number, district: string): Size {
  const z = SIZES[Math.floor(r() * SIZES.length)] as Size
  if (district === 'industrial') return z
  return z === 'XL' ? 'L' : z
}

/** Some owned vehicle could carry ≥ 1 shelf parcel (step-1 filters). */
export function fleetCanDrain(sim: Sim): boolean {
  const shelf = laneNode(sim.state.lane, sim.state.lane.shelfNodeId)
  if (!shelf) return false
  return sim.state.vehicles.some((v) =>
    shelf.queue.some((id) => {
      const p = sim.state.parcels[String(id)]
      return p !== undefined && outboundEligible(sim, v, p)
    }),
  )
}

const DOCKED = new Set(['docked_unloading', 'docked_loading'])

/**
 * One scenario. `beforeS` / `afterS` bound the two phases (sim seconds).
 * Checks, after the capability event: conservation (auditState) every
 * 10 s; while the fleet can drain the shelf, the shelf drops below its cap
 * within `afterS` and no vehicle stays docked continuously > maxDockS.
 */
export function soakScenario(
  seed: number,
  opts: {
    beforeS?: number
    afterS?: number
    maxDockS?: number
    /** Loading docks owned (M8: 2 = dock 2 bought, 3 = docks 2 and 3). */
    docks?: 1 | 2 | 3
  } = {},
): SoakResult {
  const r = scenarioRng(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
  const beforeS = opts.beforeS ?? 60 + Math.floor(r() * 120)
  const afterS = opts.afterS ?? 300
  const maxDockS = opts.maxDockS ?? 120
  const sim = quietSim(seed)
  const natural = r() < 0.5
  if (natural) {
    for (const d of Object.values(sim.state.districts)) {
      if (d.live) d.nextSpawnTick = 1 + Math.floor(r() * 50)
    }
  }
  sim.state.level.level = 2
  const docks = opts.docks ?? 1
  for (let k = 2; k <= docks; k++) addDock(sim, k)
  const industrial = r() < 0.6
  if (industrial) unlockDistrict(sim, 'industrial')
  const live = sim.state.level.unlocked.slice()
  if (r() < 0.4) placeMachine(sim, 'metal_detector', pick(['slot2', 'slot3']))
  const buildings = (district: string): BuildingId[] =>
    sim.data.buildings.filter((b) => b.district === district).map((b) => b.id)

  // Fleet + zones.
  const n = 1 + Math.floor(r() * 4)
  const fleet: Vehicle[] = []
  for (let i = 0; i < n; i++) {
    const type = industrial ? pick(TYPES) : pick(TYPES.slice(0, 3))
    const v = buy(sim, type)
    const zones = ['any', ...live].filter(
      (z) => z === 'any' || type === 'truck' || z !== 'industrial',
    )
    const zone = r() < 0.4 ? 'any' : pick(zones)
    sim.dispatch({ kind: 'setZone', id: v.id, zone })
    fleet.push(v)
  }
  fund(sim) // payroll (M3) is not what this soak is about: nobody walks out

  // A full shelf, random parcels in the lane and waiting in the city.
  const shelf = laneNode(sim.state.lane, 'shelf')
  if (!shelf || shelf.cap === null) throw new Error('soak: no shelf cap')
  const randomParcel = (): { o: BuildingId; d: BuildingId; size: Size } => {
    const od = pick(live)
    const dd = pick(live)
    const o = pick(buildings(od))
    let d = pick(buildings(dd))
    if (d === o)
      d = pick(
        buildings(dd)
          .filter((b) => b !== o)
          .concat(d),
      )
    return { o, d, size: sizeFor(r, od) }
  }
  // Shelf parcels the fleet cannot carry yet, when such a parcel exists
  // (a zone it does not serve, Industrial without a truck, L without a van).
  const nobodyCarries = (x: { d: BuildingId; size: Size }): boolean => {
    const probe = shelveParcel(
      sim,
      x.d === 'hr_towers_a' ? 'hr_towers_b' : 'hr_towers_a',
      x.d,
      { size: x.size },
    )
    const out = !sim.state.vehicles.some((v) => outboundEligible(sim, v, probe))
    shelf.queue.pop()
    delete sim.state.parcels[String(probe.id)]
    sim.state.spawn.spawnedCount -= 1
    return out
  }
  const fill = shelf.cap - Math.floor(r() * 3)
  for (let i = 0; i < fill; i++) {
    let x = randomParcel()
    for (let k = 0; k < 20 && !nobodyCarries(x); k++) x = randomParcel()
    shelveParcel(sim, x.o, x.d, { size: x.size })
  }
  const laneNodes = [
    ...sim.state.lane.docks.map((d) => d.conveyorNodeId),
    'slot1',
    'slot2',
    'slot3',
  ]
  const inLane = Math.floor(r() * 10)
  for (let i = 0; i < inLane; i++) {
    const id = pick(laneNodes)
    const node = laneNode(sim.state.lane, id)
    if (!node || node.cap === null || node.queue.length >= node.cap) continue
    const x = randomParcel()
    laneParcel(sim, id, { size: x.size, malware: r() < 0.1 }, x.o, x.d)
  }
  const waiting = 6 + Math.floor(r() * 24)
  for (let i = 0; i < waiting; i++) {
    const x = randomParcel()
    const b = sim.state.buildings[x.o]
    if (!b || b.waiting.length >= 3) continue
    injectParcel(sim, x.o, x.d, { size: x.size, malware: r() < 0.05 })
  }

  // The player Tosses every flag on the tick it is held (and, build 3,
  // answers any open event card at random on its own stream — the deck is
  // off in this quiet sim, so none opens; D-8).
  const step = (): void => {
    const hold = laneNode(sim.state.lane, 'hold')
    for (const id of hold?.queue.slice() ?? []) {
      sim.dispatch({ kind: 'toss', parcelId: id })
    }
    const open = sim.state.events.open
    if (open !== null) {
      const answers = cardOptions(sim, open).filter(
        (o) => o.visible && o.affordable,
      )
      const o = answers[Math.floor(r() * answers.length)]
      if (o)
        sim.dispatch({
          kind: 'decideEvent',
          eventId: open.eventId,
          option: o.index,
        })
    }
    sim.tick()
  }
  let failure: string | null = null
  const audit = (): void => {
    if (failure !== null) return
    const problems = auditState(sim.state, sim.data)
    if (problems.length > 0) failure = `audit: ${problems.join('; ')}`
  }
  for (let t = 0; t < beforeS * 10; t++) {
    step()
    if (t % 100 === 0) audit()
  }

  // The capability event.
  const roll = r()
  let event: string
  if (roll < 0.35) {
    event = 'zones→any'
    for (const v of sim.state.vehicles) {
      sim.dispatch({ kind: 'setZone', id: v.id, zone: 'any' })
    }
  } else if (roll < 0.55 && industrial) {
    event = 'buy truck'
    buy(sim, 'truck')
  } else if (roll < 0.7) {
    event = 'buy van'
    buy(sim, 'van')
  } else if (roll < 0.85) {
    event = 'buy bike'
    buy(sim, 'bike')
  } else {
    event = 'none'
  }

  // Afterwards.
  const docked: Record<number, number> = {}
  let maxDocked = 0
  let drainTick = shelf.queue.length < shelf.cap ? 0 : -1
  const t0 = sim.state.tick
  const d0 = sim.state.stats.deliveries
  // The shelf parcels some vehicle can carry now: oldest on the shelf, so
  // they are the first ones loaded (§6.8 oldest-first).
  const capable = shelf.queue.filter((id) => {
    const p = sim.state.parcels[String(id)]
    return (
      p !== undefined &&
      sim.state.vehicles.some((v) => outboundEligible(sim, v, p))
    )
  })
  const want = Math.min(capable.length, 4)
  let loaded = 0
  sim.events.on('parcel:loaded', (e) => {
    if (capable.includes(e.id)) loaded += 1
  })
  let maxShelfOver = 0
  for (let t = 0; t < afterS * 10; t++) {
    step()
    if (t % 100 === 0) audit()
    maxShelfOver = Math.max(maxShelfOver, shelf.queue.length - shelf.cap)
    if (drainTick < 0 && shelf.queue.length < shelf.cap) {
      drainTick = sim.state.tick - t0
    }
    // A dock stay counts only while some vehicle could drain the shelf (a
    // shelf nobody can carry from is the player's stall to fix, §6.4).
    const drainable = fleetCanDrain(sim)
    for (const v of sim.state.vehicles) {
      if (DOCKED.has(v.state) && drainable) {
        docked[v.id] = (docked[v.id] ?? 0) + 1
        maxDocked = Math.max(maxDocked, docked[v.id] as number)
      } else {
        docked[v.id] = 0
      }
    }
  }
  audit()
  const deliveriesAfter = sim.state.stats.deliveries - d0
  const states = (): string =>
    sim.state.vehicles
      .map((v) => `${v.type}/${v.zone}/${v.state}/${v.unitsUsed}u`)
      .join(' ')
  if (failure === null && loaded < want) {
    failure = `only ${loaded} of the ${capable.length} carriable shelf parcels loaded in ${afterS} s (event ${event}; ${states()})`
  }
  if (failure === null && want > 0 && maxDocked > maxDockS * 10) {
    failure = `a vehicle stayed docked ${maxDocked / 10} s > ${maxDockS} s (event ${event}; ${states()})`
  }
  return {
    seed,
    failure,
    event,
    drainS: drainTick < 0 ? -1 : drainTick / 10,
    maxDockedS: maxDocked / 10,
    deliveriesAfter,
    maxShelfOver,
  }
}
