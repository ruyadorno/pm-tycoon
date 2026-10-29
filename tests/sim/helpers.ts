// Shared sim test helpers (plan.md §6.9.1): makeSim, runSeconds, collect,
// openingA, dataFixture, plus the M1 scenario helpers (quiet sims, injected
// parcels, buying, unlocking). Node environment, no Phaser.

import { applyConfig, buildGameData } from '../../src/data/index.ts'
import type { GameData } from '../../src/data/types.ts'
import { onSimEvent } from '../../src/sim/events.ts'
import type { SimEventName, SimEventPayloads } from '../../src/sim/events.ts'
import { Sim } from '../../src/sim/sim.ts'
import type {
  BuildingId,
  DistrictId,
  Parcel,
  Size,
  Vehicle,
  VehicleType,
} from '../../src/sim/types.ts'
import { liveSlotIds, laneNode, TICKS_PER_S } from '../../src/sim/types.ts'
import { holdBays } from '../../src/sim/systems/lane.ts'
import { loadRawData } from '../../tools/sim/load.node.ts'

let shipped: GameData | null = null

/**
 * The shipped tables, validated (cached; sims never mutate GameData), or a
 * fresh copy with a config-style patch deep-merged first
 * (`{economy: {startMoney: 600}}`, arrays by index).
 */
export function dataFixture(overrides?: unknown): GameData {
  if (overrides === undefined) {
    shipped ??= buildGameData(loadRawData())
    return shipped
  }
  return buildGameData(applyConfig(loadRawData(), overrides, 'test overrides'))
}

/** A new game on the shipped (or patched) data. */
export function makeSim(seed = 1, overrides?: unknown): Sim {
  return new Sim(dataFixture(overrides), seed)
}

export function runTicks(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick()
}

/** Advance `s` sim seconds (10 ticks each). */
export function runSeconds(sim: Sim, s: number): void {
  runTicks(sim, Math.round(s * TICKS_PER_S))
}

/** Every payload of `name` emitted from now on (deep copies, in order). */
export function collect<K extends SimEventName>(
  sim: Sim,
  name: K,
): SimEventPayloads[K][] {
  const out: SimEventPayloads[K][] = []
  onSimEvent(sim.events, name, (p) => {
    out.push(structuredClone(p))
  })
  return out
}

/** Spec §7.1 opening A: a bike + a Metal detector in the first empty live slot. */
export function openingA(sim: Sim): void {
  const bike = sim.dispatch({ kind: 'buyVehicle', type: 'bike' })
  if (!bike.ok) throw new Error(`openingA: bike refused (${bike.reason})`)
  const lane = sim.state.lane
  const slot = liveSlotIds(lane).find((id) => !laneNode(lane, id)?.fixture)
  if (!slot) throw new Error('openingA: no empty slot')
  const md = sim.dispatch({
    kind: 'buyMachine',
    defId: 'metal_detector',
    nodeId: slot,
  })
  if (!md.ok) throw new Error(`openingA: detector refused (${md.reason})`)
}

// M1 scenario helpers -----------------------------------------------------------

/** Stop every spawn timer (scenario tests inject their own parcels). */
export function quiet(sim: Sim): Sim {
  for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
  return sim
}

/** A new game with no spawns. */
export function quietSim(seed = 1, overrides?: unknown): Sim {
  return quiet(makeSim(seed, overrides))
}

/** Buy a vehicle (topping the balance up first) and return it. */
export function buy(sim: Sim, type: VehicleType): Vehicle {
  const def = sim.data.vehicles.types.find((t) => t.id === type)
  if (!def) throw new Error(`no type ${type}`)
  if (def.unlockLevel > sim.state.level.level) {
    sim.state.level.level = def.unlockLevel
  }
  if (sim.state.economy.balance < def.price) {
    sim.state.economy.balance = def.price
  }
  const res = sim.dispatch({ kind: 'buyVehicle', type })
  if (!res.ok) throw new Error(`buy ${type}: ${res.reason}`)
  return sim.state.vehicles.at(-1) as Vehicle
}

/**
 * Give a scenario enough money that payroll (spec §7.3-§7.4, M3) never runs
 * short — for tests about something else, whose `buy` calls leave $0 and
 * whose drivers would otherwise walk out after two paydays.
 */
export function fund(sim: Sim, amount = 1_000_000): Sim {
  sim.state.economy.balance = Math.max(sim.state.economy.balance, amount)
  return sim
}

/** Make a locked district live (scenario setup without a level-up). */
export function unlockDistrict(sim: Sim, id: DistrictId, spawn = false): void {
  const d = sim.state.districts[id]
  if (!d) throw new Error(`no district ${id}`)
  d.live = true
  d.nextSpawnTick = spawn ? sim.state.tick + 1 : null
  if (!sim.state.level.unlocked.includes(id)) sim.state.level.unlocked.push(id)
}

export interface InjectOptions {
  size?: Size
  malware?: boolean
  /** Spawn tick (default now); older parcels are worth less (spec §5.3). */
  spawnedTick?: number
}

/** Put a waiting parcel at `origin` bound for `dest`, exactly like a spawn would. */
export function injectParcel(
  sim: Sim,
  origin: BuildingId,
  dest: BuildingId,
  opts: InjectOptions = {},
): Parcel {
  const s = sim.state
  const size = opts.size ?? 'S'
  const destDef = sim.data.buildings.find((b) => b.id === dest)
  if (!destDef) throw new Error(`no building ${dest}`)
  const id = s.nextId.parcel
  s.nextId.parcel += 1
  const malware = opts.malware ?? false
  const p: Parcel = {
    id,
    size,
    baseValue: sim.data.parcels.sizes[size].value,
    mult: 1,
    origin,
    dest,
    destRegion: destDef.district,
    spawnedTick: opts.spawnedTick ?? s.tick,
    label: 'test@1.0.0',
    malware,
    strain: malware ? 'metal' : null,
    decoy: null,
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
    trace: [],
  }
  s.parcels[String(id)] = p
  const b = s.buildings[origin]
  if (!b) throw new Error(`no building ${origin}`)
  b.waiting.push(id)
  s.spawn.spawnedCount += 1
  if (malware) s.stats.malwareSpawned += 1
  return p
}

/** Put a parcel straight onto the shelf (as if it had come through the lane). */
export function shelveParcel(
  sim: Sim,
  origin: BuildingId,
  dest: BuildingId,
  opts: InjectOptions = {},
): Parcel {
  const p = injectParcel(sim, origin, dest, opts)
  const b = sim.state.buildings[origin] as { waiting: number[] }
  b.waiting.splice(b.waiting.indexOf(p.id), 1)
  const shelf = laneNode(sim.state.lane, sim.state.lane.shelfNodeId)
  shelf?.queue.push(p.id)
  p.state = 'on_shelf'
  p.nodeId = sim.state.lane.shelfNodeId
  return p
}

/** Tick until `pred` holds (checked after each tick); returns the ticks run, or -1. */
export function runUntil(
  sim: Sim,
  pred: () => boolean,
  maxTicks = 6000,
): number {
  for (let i = 1; i <= maxTicks; i++) {
    sim.tick()
    if (pred()) return i
  }
  return -1
}

export function vehicleById(sim: Sim, id: number): Vehicle {
  const v = sim.state.vehicles.find((x) => x.id === id)
  if (!v) throw new Error(`no vehicle ${id}`)
  return v
}

/** Every event name emitted from now on, in order (with the tick). */
export function eventLog(
  sim: Sim,
): { tick: number; name: string; p: unknown }[] {
  const out: { tick: number; name: string; p: unknown }[] = []
  sim.addTap((name, p, tick) => {
    out.push({ tick, name, p: structuredClone(p) })
  })
  return out
}

// M2 lane helpers ------------------------------------------------------------------

/** Take every fixture out of the lane (all slots pass through; no checker). */
export function noCheckers(sim: Sim): Sim {
  for (const n of sim.state.lane.nodes) {
    if (n.kind === 'slot' && n.fixture) {
      const res = sim.dispatch({ kind: 'removeFixture', nodeId: n.id })
      if (!res.ok) throw new Error(`noCheckers: ${n.id} ${res.reason}`)
    }
  }
  return sim
}

/** Buy a machine into a slot (topping the balance up and the level gate first). */
export function placeMachine(sim: Sim, defId: string, nodeId: string): void {
  const def = sim.data.machines.checkers.find((c) => c.id === defId)
  if (!def) throw new Error(`no machine ${defId}`)
  if (def.unlockLevel > sim.state.level.level) {
    sim.state.level.level = def.unlockLevel
  }
  const node = laneNode(sim.state.lane, nodeId)
  if (node?.locked) delete node.locked
  sim.state.economy.balance = Math.max(sim.state.economy.balance, def.price)
  const res = sim.dispatch({ kind: 'buyMachine', defId, nodeId })
  if (!res.ok)
    throw new Error(`placeMachine ${defId} → ${nodeId}: ${res.reason}`)
}

export interface LaneParcelOptions extends InjectOptions {
  decoy?: Parcel['decoy']
  strain?: Parcel['strain']
  /** The §5.4 forced catch: the first checker flags it with certainty. */
  scripted?: boolean
  magic?: boolean
}

/**
 * A parcel put straight into a lane node's queue (a conveyor or a slot
 * buffer), as if it had been unloaded; `in_conveyor` / `in_slot`.
 */
export function laneParcel(
  sim: Sim,
  nodeId: string,
  opts: LaneParcelOptions = {},
  origin: BuildingId = 'hr_towers_a',
  dest: BuildingId = 'dt_cache_cafe',
): Parcel {
  const p = injectParcel(sim, origin, dest, opts)
  const b = sim.state.buildings[origin] as { waiting: number[] }
  b.waiting.splice(b.waiting.indexOf(p.id), 1)
  if (opts.strain !== undefined) p.strain = opts.strain
  if (opts.decoy !== undefined) p.decoy = opts.decoy
  if (opts.scripted) p.scripted = true
  if (opts.magic) p.magic = true
  const node = laneNode(sim.state.lane, nodeId)
  if (!node) throw new Error(`no node ${nodeId}`)
  node.queue.push(p.id)
  p.nodeId = node.id
  p.nodeEnterTick = sim.state.tick
  p.state = node.kind === 'slot' ? 'in_slot' : 'in_conveyor'
  return p
}

/**
 * A flagged parcel put straight into the Hold Bay (`held`), flagged by the
 * first active checker (or 'test').
 */
export function heldParcel(
  sim: Sim,
  opts: LaneParcelOptions = {},
  origin: BuildingId = 'hr_towers_a',
  dest: BuildingId = 'dt_cache_cafe',
): Parcel {
  const p = laneParcel(sim, 'conv1', opts, origin, dest)
  const conv = laneNode(sim.state.lane, 'conv1') as { queue: number[] }
  conv.queue.splice(conv.queue.indexOf(p.id), 1)
  const hold = laneNode(sim.state.lane, sim.state.lane.holdBayNodeId)
  if (!hold) throw new Error('no Hold Bay')
  // The lowest free bay, as a real arrival takes it (stable bays, M3).
  const used = Object.values(holdBays(sim.state, hold))
  let bay = 0
  while (used.includes(bay)) bay += 1
  hold.queue.push(p.id)
  p.bay = bay
  p.state = 'held'
  p.nodeId = hold.id
  p.flaggedBy =
    sim.state.lane.nodes.find((n) => n.fixture)?.fixture?.checker.id ?? 'test'
  p.flaggedStrain = p.strain ?? p.decoy ?? 'metal'
  return p
}

/** Keep conv1 topped up with fresh clean parcels until `total` have been fed. */
export function feeder(
  sim: Sim,
  total: number,
  opts: LaneParcelOptions = {},
): () => number {
  let fed = 0
  return () => {
    const conv = laneNode(sim.state.lane, 'conv1')
    const room = conv ? (conv.cap ?? 0) - conv.queue.length : 0
    for (let i = 0; i < room && fed < total; i++) {
      laneParcel(sim, 'conv1', opts)
      fed += 1
    }
    return fed
  }
}
