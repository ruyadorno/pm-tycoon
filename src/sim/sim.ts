// The headless sim (plan.md §6.4): state + data + one seeded rng + typed
// events. dispatch() and tick() are the only mutating entries; rendering
// reads state through the ViewSim facade (view-api.ts). Pure TS: no Phaser,
// DOM, wall clock, Math.random or timers (tools/check-sim-purity.mjs).

import { canonicalJson, fnv1a32 } from '../data/index.ts'
import type { GameData, LevelDef } from '../data/types.ts'
import type { Command, CommandLogEntry, CommandResult } from './commands.ts'
import {
  applyCommand,
  deskChecker,
  hireEmployee,
  isCommand,
} from './commands.ts'
import { createSimEmitter } from './events.ts'
import type {
  MoneyReason,
  SimEmitter,
  SimEventName,
  SimEventPayloads,
  SimTap,
} from './events.ts'
import { pathfinder, type Pathfinder } from './astar.ts'
import { Rng, seedWord } from './rng.ts'
import { roadGraph, type RoadGraph } from './roads.ts'
import { runTick } from './tick.ts'
import type {
  District,
  Building,
  Lane,
  LaneNode,
  SimState,
  Strain,
  Tick,
} from './types.ts'
import { laneNode, TICKS_PER_DAY, ticksFromS } from './types.ts'

/** Dev assertions (Node / Vitest / vite dev); vite build replaces DEV with false. */
const DEV: boolean = import.meta.env?.DEV !== false

/** snapshot() output: everything needed to resume (and replay) a run. */
export interface SimSnapshot {
  version: 1
  dataHash: string
  seed: number
  state: SimState
  /** Successful commands since tick 0 (replay = seed + data + this log). */
  commandLog: CommandLogEntry[]
}

export interface LoadOptions {
  /** Accept a snapshot made with different data tables (fixtures, debugging). */
  ignoreDataHash?: boolean
}

export class SimLoadError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(`Cannot load snapshot:\n${problems.slice(0, 20).join('\n')}`)
    this.name = 'SimLoadError'
    this.problems = problems
  }
}

/**
 * The scripted player of spec §7 (src/sim/policy.ts, M1). The CLI and
 * ?policy=1 call step() once before every tick(), from tick 0; it reads
 * sim.state and acts only through sim.dispatch (never from event handlers).
 */
export interface Policy {
  readonly name: string
  step(): void
  dispose?(): void
}
export type PolicyKind = 'competent'
/** The export src/sim/policy.ts must provide as `createPolicy`. */
export type PolicyFactory = (sim: Sim, kind: PolicyKind) => Policy

export class Sim {
  readonly data: GameData
  readonly events: SimEmitter = createSimEmitter()
  state: SimState
  readonly rng: Rng
  readonly commandLog: CommandLogEntry[] = []
  /** Bumped by every tick, successful dispatch and load (view caches key on it). */
  revision = 0
  /** The drive graph (avenues minus trimmed tiles + the lot), built from data.map. */
  readonly roads: RoadGraph
  /** Cached A* paths + road distances over `roads` (shared per GameData; never serialised). */
  readonly paths: Pathfinder
  #emitDepth = 0
  #ticking = false
  #taps: SimTap[] = []

  constructor(data: GameData, seed: number) {
    this.data = data
    this.roads = roadGraph(data)
    this.paths = pathfinder(data)
    this.state = createStartState(data, seed)
    this.rng = new Rng(() => this.state)
  }

  /** Resume a snapshot (validated: version, data hash, ids, locations). */
  static load(data: GameData, snap: unknown, opts: LoadOptions = {}): Sim {
    const problems = snapshotProblems(data, snap, opts)
    if (problems.length > 0) throw new SimLoadError(problems)
    const s = snap as SimSnapshot
    const sim = new Sim(data, s.seed)
    sim.state = structuredClone(s.state)
    sim.commandLog.push(...structuredClone(s.commandLog))
    sim.revision += 1
    return sim
  }

  /**
   * Validate + apply now + log {tick, cmd}: successful commands, and failed
   * ones marked `applied` (they changed state, e.g. a rush flag with no
   * eligible vehicle), so a replay of the log reproduces the run.
   */
  dispatch(cmd: Command): CommandResult {
    if (DEV && (this.#emitDepth > 0 || this.#ticking)) {
      const kind = isCommand(cmd) ? cmd.kind : 'invalid'
      throw new Error(
        `Sim.dispatch(${kind}) called from ${this.#emitDepth > 0 ? 'a sim event handler' : 'inside tick()'}: handlers never dispatch (plan.md §5)`,
      )
    }
    const res = applyCommand(this, cmd)
    if (res.ok || res.applied === true) {
      this.commandLog.push({ tick: this.state.tick, cmd: structuredClone(cmd) })
      this.revision += 1
    }
    return res
  }

  /** One 100 ms step in the fixed order of tick.ts. */
  tick(): void {
    if (this.#ticking) throw new Error('Sim.tick() re-entered')
    this.#ticking = true
    try {
      runTick(this)
    } finally {
      this.#ticking = false
    }
    this.revision += 1
  }

  /** structuredClone of the state + the data hash + the command log. */
  snapshot(): SimSnapshot {
    return {
      version: 1,
      dataHash: this.data.hash,
      seed: this.state.seed,
      state: structuredClone(this.state),
      commandLog: structuredClone(this.commandLog),
    }
  }

  /** Emit a sim event (systems use this, never events.emit directly). */
  emit<K extends SimEventName>(name: K, payload: SimEventPayloads[K]): void {
    for (const tap of this.#taps) tap(name, payload, this.state.tick)
    this.#emitDepth += 1
    try {
      const emit = this.events.emit as (n: K, p: SimEventPayloads[K]) => boolean
      emit.call(this.events, name, payload)
    } finally {
      this.#emitDepth -= 1
    }
  }

  /** See every emitted event (CLI recorder, debug log); returns the remover. */
  addTap(tap: SimTap): () => void {
    this.#taps.push(tap)
    return () => {
      this.#taps = this.#taps.filter((t) => t !== tap)
    }
  }

  /** True while event handlers run. */
  get emitting(): boolean {
    return this.#emitDepth > 0
  }

  /**
   * Pay in, rounded to whole $ (§7.3). `earned` adds to lifetime earned and
   * stats.income (deliveries, clearances, bounties, quests — never refunds).
   */
  credit(amount: number, reason: MoneyReason, earned: boolean): void {
    const delta = wholeDollars(amount, reason)
    if (delta === 0) return
    const eco = this.state.economy
    eco.balance += delta
    if (earned) {
      eco.lifetimeEarned += delta
      this.state.stats.income += delta
    }
    this.emit('money:changed', { delta, reason, balance: eco.balance })
  }

  /**
   * Pay out, rounded to whole $. The balance never goes negative (§7.2):
   * callers check `balance >= amount` first (or clamp a fee with Math.min);
   * an overdraft throws.
   */
  debit(amount: number, reason: MoneyReason): void {
    const delta = wholeDollars(amount, reason)
    if (delta === 0) return
    const eco = this.state.economy
    if (eco.balance < delta) {
      throw new RangeError(
        `debit $${delta} (${reason}) exceeds the balance $${eco.balance}`,
      )
    }
    eco.balance -= delta
    this.emit('money:changed', { delta: -delta, reason, balance: eco.balance })
  }
}

function wholeDollars(amount: number, reason: MoneyReason): number {
  const delta = Math.round(amount)
  if (!Number.isFinite(delta) || delta < 0) {
    throw new RangeError(`money ${reason}: bad amount ${amount}`)
  }
  return delta
}

// Start state (spec §7.1) -------------------------------------------------------

/**
 * The §7.1 start: startMoney, 3 lives, the L1 level row, L1 districts live
 * (satisfaction start, first spawn after firstSpawnDelayS), every building,
 * the generic lane with the pre-hired inspector desk, no vehicles.
 */
export function createStartState(data: GameData, seed: number): SimState {
  const L1 = data.levels[0]
  if (!L1) throw new Error('levels.json has no rows')
  const sat = data.economy.satisfaction.start
  const firstSpawn = ticksFromS(data.parcels.spawn.firstSpawnDelayS)

  const districts: Record<string, District> = {}
  for (const d of data.districts) {
    const live = d.unlockLevel <= L1.level
    districts[d.id] = {
      id: d.id,
      live,
      satisfaction: sat,
      nextSpawnTick: live && d.kind === 'district' ? firstSpawn : null,
      dayPositive: 0,
      dayWaitingPenalty: 0,
      satisfactionAtDayStart: sat,
      earned: 0,
    }
  }
  const buildings: Record<string, Building> = {}
  for (const b of data.buildings) {
    buildings[b.id] = { id: b.id, waiting: [], rushUntilTick: null }
  }
  const announced: Partial<Record<Strain, Tick>> = {}
  if (L1.strain) announced[L1.strain] = 0

  const state: SimState = {
    version: 1,
    seed,
    rng: seedWord(seed),
    tick: 0,
    day: 0,
    economy: {
      balance: data.economy.startMoney,
      lifetimeEarned: 0,
      lives: data.economy.lives.start,
      gameOver: false,
      victory: false,
      daysSinceIncident: 0,
      lastPayroll: null,
    },
    level: {
      level: L1.level,
      nextThreshold: data.levels[1]?.threshold ?? null,
      unlocked: data.districts
        .filter((d) => d.unlockLevel <= L1.level)
        .map((d) => d.id),
      announced,
      slots: L1.slots,
      holdBayCap: L1.holdBayCap,
      shelfCap: L1.shelfCap,
      warehouseTier: L1.warehouseTier,
    },
    spawn: {
      spawnedCount: 0,
      malwareCount: 0,
      scriptedDone: false,
      scriptedDeferredUntilTick: null,
      magicAlive: 0,
    },
    districts,
    buildings,
    vehicles: [],
    employees: [],
    parcels: {},
    lane: buildStartLane(data, L1),
    stats: {
      deliveries: 0,
      onTime: 0,
      late: 0,
      malwareSpawned: 0,
      malwareCaught: 0,
      malwareMissed: 0,
      wrongToss: 0,
      firstDeliveryTick: null,
      firstCatchTick: null,
      levelTick: { [String(L1.level)]: 0 },
      truckTick: null,
      income: 0,
      payrollPaid: 0,
      holdBayEvents: 0,
      minutes: [],
    },
    lastLostLife: null,
    nextId: { parcel: 1, vehicle: 1, employee: 1, checker: 1 },
  }

  // The pre-hired inspector desk (spec §6.2: slot startSlot, startCount inspectors).
  const insp = data.employees.inspector
  const deskId = state.lane.slotNodeIds[insp.startSlot - 1]
  const desk = deskId ? laneNode(state.lane, deskId) : null
  if (!desk || desk.locked) {
    throw new Error(
      `employees.inspector.startSlot ${insp.startSlot}: no live slot`,
    )
  }
  const fixture = {
    kind: 'desk' as const,
    checker: deskChecker(state, data, 0),
    inspectorIds: [] as number[],
    walkedOutIds: [] as number[],
  }
  desk.fixture = fixture
  for (let i = 0; i < insp.startCount; i++) {
    const e = hireEmployee(state, data, 'inspector', { nodeId: desk.id })
    fixture.inspectorIds.push(e.id)
    fixture.checker.stations += 1
    desk.stations.push({ parcelId: null, doneTick: null })
  }
  return state
}

/** An empty lane node. */
function laneNodeOf(
  id: string,
  kind: LaneNode['kind'],
  next: string[],
  cap: number | null,
  dockId: string | null = null,
): LaneNode {
  return { id, kind, next, cap, queue: [], fixture: null, stations: [], dockId }
}

/**
 * The generic lane (plan.md §5 node ids): dock1 → conv1 → slot1..slotN →
 * shelf (N = the largest levels.json slot count; slots past L1's count carry
 * `locked: {level}` of the first row that opens them), each slot diverting to
 * hold; hold → shelf (Clear) | bin (Toss). Caps: conveyor and slot buffer
 * from machines.json, Hold Bay and shelf from the level row.
 */
function buildStartLane(data: GameData, L1: LevelDef): Lane {
  const slotCount = Math.max(...data.levels.map((l) => l.slots))
  const slotIds = Array.from({ length: slotCount }, (_, i) => `slot${i + 1}`)
  const slots = slotIds.map((id, i) => {
    const n = laneNodeOf(
      id,
      'slot',
      [slotIds[i + 1] ?? 'shelf'],
      data.machines.slotBufferCap,
    )
    n.divert = 'hold'
    if (i + 1 > L1.slots) {
      const opens = data.levels.find((l) => l.slots >= i + 1)
      n.locked = { level: opens?.level ?? data.levels.length }
    }
    return n
  })
  return {
    nodes: [
      laneNodeOf('dock1', 'dock', ['conv1'], null, 'dock1'),
      laneNodeOf(
        'conv1',
        'conveyor',
        [slotIds[0] ?? 'shelf'],
        data.machines.conveyorCapPerDock,
        'dock1',
      ),
      ...slots,
      laneNodeOf('hold', 'holdBay', ['shelf', 'bin'], L1.holdBayCap),
      laneNodeOf('bin', 'bin', [], null),
      laneNodeOf('shelf', 'shelf', [], L1.shelfCap),
    ],
    docks: [
      {
        id: 'dock1',
        conveyorNodeId: 'conv1',
        vehicleId: null,
        nextTransferTick: null,
        busyTicksThisDay: 0,
        stuckSinceTick: null,
      },
    ],
    slotNodeIds: slotIds,
    holdBayNodeId: 'hold',
    binNodeId: 'bin',
    shelfNodeId: 'shelf',
    stalled: false,
    stallReason: null,
    stallNodeId: null,
    stallSinceTick: null,
    stallSecondsToday: 0,
    quarantine: { count: 0, malware: 0, clean: 0 },
    sorterArm: false,
    dockQueue: [],
  }
}

// Validation and invariants ---------------------------------------------------------

const TERMINAL = ['delivered', 'tossed', 'cleared']
const OFF_MAP = ['handed_off', 'clearing']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Paths of every non-JSON value (undefined, NaN/Infinity, class instances, functions). */
function jsonProblems(v: unknown, path: string, add: (m: string) => void) {
  if (v === null) return
  switch (typeof v) {
    case 'number':
      if (!Number.isFinite(v)) add(`${path}: ${v} is not JSON`)
      return
    case 'string':
    case 'boolean':
      return
    case 'object': {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          jsonProblems(v[i], `${path}[${i}]`, add)
        }
        return
      }
      const proto: unknown = Object.getPrototypeOf(v)
      if (proto !== Object.prototype && proto !== null) {
        add(`${path}: not a plain object`)
        return
      }
      for (const [k, x] of Object.entries(v)) {
        jsonProblems(x, `${path}.${k}`, add)
      }
      return
    }
    default:
      add(`${path}: ${typeof v} is not JSON`)
  }
}

/**
 * Invariants that hold between ticks (the CLI checks them every 600 ticks,
 * Sim.load on every snapshot): JSON-only values; integer balance ≥ 0; ids
 * ascending and every cross-reference resolving; every live parcel in
 * exactly one place (a building's waiting list, a vehicle's cargo, a lane
 * node's queue or station; none while handed off / clearing or terminal);
 * and the conservation identity spawned = live + delivered + tossed
 * (plan.md §12.5; build 2 adds cleared overseas parcels).
 */
export function auditState(state: SimState, data: GameData): string[] {
  const out: string[] = []
  const add = (m: string): void => {
    if (out.length < 50) out.push(m)
  }
  jsonProblems(state, 'state', add)
  if (out.length > 0) return out

  const eco = state.economy
  if (!Number.isSafeInteger(eco.balance) || eco.balance < 0) {
    add(`economy.balance: ${eco.balance} (integer ≥ 0 required)`)
  }
  if (!Number.isSafeInteger(eco.lifetimeEarned) || eco.lifetimeEarned < 0) {
    add(`economy.lifetimeEarned: ${eco.lifetimeEarned}`)
  }
  if (!Number.isInteger(eco.lives) || eco.lives < 0) {
    add(`economy.lives: ${eco.lives}`)
  }
  if (!Number.isSafeInteger(state.tick) || state.tick < 0) {
    add(`tick: ${state.tick}`)
  } else if (state.day !== Math.floor(state.tick / TICKS_PER_DAY)) {
    add(`day: ${state.day} ≠ floor(tick / ${TICKS_PER_DAY})`)
  }
  for (const d of data.districts) {
    if (!state.districts[d.id]) add(`districts.${d.id}: missing`)
  }
  for (const id of Object.keys(state.districts)) {
    if (!data.districts.some((d) => d.id === id)) {
      add(`districts.${id}: not in districts.json`)
    }
  }
  for (const b of data.buildings) {
    if (!state.buildings[b.id]) add(`buildings.${b.id}: missing`)
  }
  for (const id of Object.keys(state.buildings)) {
    if (!data.buildings.some((b) => b.id === id)) {
      add(`buildings.${id}: not in buildings.json`)
    }
  }

  const ascending = (ids: number[], what: string): void => {
    for (let i = 1; i < ids.length; i++) {
      if ((ids[i] as number) <= (ids[i - 1] as number)) {
        add(`${what}: ids not ascending at index ${i}`)
      }
    }
  }
  ascending(
    state.vehicles.map((v) => v.id),
    'vehicles',
  )
  ascending(
    state.employees.map((e) => e.id),
    'employees',
  )

  const lane = state.lane
  const nodeIds = lane.nodes.map((n) => n.id)
  const dockIds = lane.docks.map((d) => d.id)
  const hasNode = (id: string): boolean => nodeIds.includes(id)
  nodeIds.forEach((id, i) => {
    if (nodeIds.indexOf(id) !== i) add(`lane.nodes: duplicate id ${id}`)
  })
  for (const n of lane.nodes) {
    for (const t of n.next) {
      if (!hasNode(t)) add(`lane.${n.id}.next: unknown node ${t}`)
    }
    if (n.divert !== undefined && !hasNode(n.divert)) {
      add(`lane.${n.id}.divert: unknown node ${n.divert}`)
    }
    if (n.dockId !== null && !dockIds.includes(n.dockId)) {
      add(`lane.${n.id}.dockId: unknown dock ${n.dockId}`)
    }
    // A slot's buffer may sit above its cap by the parcels a fixture change
    // sent back from its stations (lane.ts reseat, Q31) — at most a full
    // desk; a conveyor by a sold vehicle's inbound cargo (vehicles.ts
    // sellVehicle) — at most the largest vehicle's capacity in parcels.
    const biggest = Math.max(
      0,
      ...data.vehicles.types.map((t) => t.capacityUnits),
    )
    const slack =
      n.kind === 'slot'
        ? data.employees.inspector.maxPerDesk
        : n.kind === 'conveyor'
          ? biggest
          : 0
    const capped = n.kind === 'conveyor' || n.kind === 'slot'
    if (capped && n.cap !== null && n.queue.length > n.cap + slack) {
      add(`lane.${n.id}: ${n.queue.length} queued > cap ${n.cap}`)
    }
    if (n.kind === 'holdBay' && n.cap !== null && n.queue.length > n.cap) {
      add(`lane.${n.id}: ${n.queue.length} held > cap ${n.cap}`)
    }
    if (n.fixture && n.fixture.checker.stations !== n.stations.length) {
      add(`lane.${n.id}: checker.stations ≠ stations.length`)
    }
    if (n.fixture && n.locked) add(`lane.${n.id}: fixture on a locked node`)
  }
  for (const id of [
    ...lane.slotNodeIds,
    lane.holdBayNodeId,
    lane.binNodeId,
    lane.shelfNodeId,
  ]) {
    if (!hasNode(id)) add(`lane: unknown node ${id}`)
  }
  for (const d of lane.docks) {
    if (!hasNode(d.conveyorNodeId)) {
      add(`lane.docks.${d.id}: unknown conveyor ${d.conveyorNodeId}`)
    }
    const v = state.vehicles.find((x) => x.id === d.vehicleId)
    if (d.vehicleId !== null && (!v || v.dockId !== d.id)) {
      add(`lane.docks.${d.id}: vehicle ${d.vehicleId} not docked here`)
    }
  }
  for (const id of lane.dockQueue) {
    const v = state.vehicles.find((x) => x.id === id)
    if (!v || v.state !== 'queued') {
      add(`lane.dockQueue: vehicle ${id} is not queued`)
    }
  }

  const employeeIds = state.employees.map((e) => e.id)
  const vehicleIds = state.vehicles.map((v) => v.id)
  for (const v of state.vehicles) {
    if (v.driverId !== null && !employeeIds.includes(v.driverId)) {
      add(`vehicles.${v.id}.driverId: unknown employee ${v.driverId}`)
    }
    if (v.dockId !== null && !dockIds.includes(v.dockId)) {
      add(`vehicles.${v.id}.dockId: unknown dock ${v.dockId}`)
    }
  }
  for (const e of state.employees) {
    if (e.vehicleId !== null && !vehicleIds.includes(e.vehicleId)) {
      add(`employees.${e.id}.vehicleId: unknown vehicle ${e.vehicleId}`)
    }
    if (e.nodeId !== null && !hasNode(e.nodeId)) {
      add(`employees.${e.id}.nodeId: unknown node ${e.nodeId}`)
    }
  }

  // Every live parcel in exactly one place; no dangling ids.
  const seen: Record<string, number> = {}
  const locate = (id: number, where: string): void => {
    const k = String(id)
    if (!state.parcels[k]) add(`${where}: parcel ${id} does not exist`)
    seen[k] = (seen[k] ?? 0) + 1
  }
  for (const b of Object.values(state.buildings)) {
    for (const id of b.waiting) locate(id, `buildings.${b.id}.waiting`)
  }
  for (const v of state.vehicles) {
    for (const id of v.cargo) locate(id, `vehicles.${v.id}.cargo`)
    for (const id of v.reserved) {
      if (!state.parcels[String(id)]) {
        add(`vehicles.${v.id}.reserved: parcel ${id} does not exist`)
      }
    }
  }
  for (const n of lane.nodes) {
    for (const id of n.queue) locate(id, `lane.${n.id}.queue`)
    for (const st of n.stations) {
      if (st.parcelId !== null) locate(st.parcelId, `lane.${n.id}.stations`)
    }
  }
  let live = 0
  for (const [k, p] of Object.entries(state.parcels)) {
    if (String(p.id) !== k) add(`parcels.${k}: id ${p.id} ≠ key`)
    const n = seen[k] ?? 0
    const placeless = TERMINAL.includes(p.state) || OFF_MAP.includes(p.state)
    if (!TERMINAL.includes(p.state)) live += 1
    if (placeless ? n !== 0 : n !== 1) {
      add(`parcels.${k} (${p.state}): found in ${n} places`)
    }
  }
  const delivered = state.stats.deliveries
  const tossed = lane.quarantine.count
  if (state.spawn.spawnedCount !== live + delivered + tossed) {
    add(
      `conservation: spawned ${state.spawn.spawnedCount} ≠ live ${live} + delivered ${delivered} + tossed ${tossed}`,
    )
  }
  const c = conservation(state)
  if (!c.ok) add(`conservation: ${formatConservation(c)}`)
  return out
}

/** Where every spawned parcel is (plan.md §6.9.2 conservation identity). */
export interface Conservation {
  spawned: number
  /** In Building.waiting (reserved or not). */
  waiting: number
  /** In vehicle cargo. */
  vehicles: number
  /** Conveyors and slot buffers / stations. */
  lane: number
  held: number
  shelf: number
  /** Handed off / clearing at an overseas hub (build 2). */
  offMap: number
  delivered: number
  tossed: number
  /** spawned = waiting + vehicles + lane + held + shelf + offMap + delivered + tossed */
  ok: boolean
}

export function conservation(state: SimState): Conservation {
  const lane = state.lane
  let waiting = 0
  for (const b of Object.values(state.buildings)) waiting += b.waiting.length
  let vehicles = 0
  for (const v of state.vehicles) vehicles += v.cargo.length
  let inLane = 0
  let held = 0
  let shelf = 0
  for (const n of lane.nodes) {
    const here =
      n.queue.length + n.stations.filter((st) => st.parcelId !== null).length
    if (n.id === lane.holdBayNodeId) held += here
    else if (n.id === lane.shelfNodeId) shelf += here
    else if (n.id !== lane.binNodeId) inLane += here
  }
  let offMap = 0
  for (const p of Object.values(state.parcels)) {
    if (OFF_MAP.includes(p.state)) offMap += 1
  }
  const delivered = state.stats.deliveries
  const tossed = lane.quarantine.count
  const spawned = state.spawn.spawnedCount
  const sum =
    waiting + vehicles + inLane + held + shelf + offMap + delivered + tossed
  return {
    spawned,
    waiting,
    vehicles,
    lane: inLane,
    held,
    shelf,
    offMap,
    delivered,
    tossed,
    ok: sum === spawned,
  }
}

export function formatConservation(c: Conservation): string {
  return `spawned ${c.spawned} ${c.ok ? '=' : '≠'} waiting ${c.waiting} + vehicles ${c.vehicles} + lane ${c.lane} + held ${c.held} + shelf ${c.shelf} + off-map ${c.offMap} + delivered ${c.delivered} + tossed ${c.tossed}`
}

/** Why a snapshot cannot be loaded (empty = loadable). */
export function snapshotProblems(
  data: GameData,
  snap: unknown,
  opts: LoadOptions = {},
): string[] {
  if (!isRecord(snap)) return ['snapshot: not an object']
  const out: string[] = []
  if (snap.version !== 1) out.push(`version: ${String(snap.version)} ≠ 1`)
  if (typeof snap.dataHash !== 'string') out.push('dataHash: missing')
  else if (!opts.ignoreDataHash && snap.dataHash !== data.hash) {
    out.push(`dataHash: ${snap.dataHash} ≠ ${data.hash} (data changed)`)
  }
  if (!Number.isSafeInteger(snap.seed)) out.push('seed: not an integer')
  if (!Array.isArray(snap.commandLog)) out.push('commandLog: not an array')
  else {
    snap.commandLog.forEach((e: unknown, i) => {
      if (!isRecord(e) || !Number.isSafeInteger(e.tick) || !isCommand(e.cmd)) {
        out.push(`commandLog[${i}]: not {tick, cmd}`)
      }
    })
  }
  const st = snap.state
  if (!isRecord(st)) return [...out, 'state: not an object']
  if (st.version !== 1) out.push(`state.version: ${String(st.version)} ≠ 1`)
  if (st.seed !== snap.seed) out.push('state.seed ≠ snapshot seed')
  const shaped =
    isRecord(st.economy) &&
    isRecord(st.lane) &&
    Array.isArray(st.lane.nodes) &&
    Array.isArray(st.lane.docks) &&
    isRecord(st.stats) &&
    isRecord(st.spawn) &&
    isRecord(st.parcels) &&
    isRecord(st.buildings) &&
    isRecord(st.districts) &&
    Array.isArray(st.vehicles) &&
    Array.isArray(st.employees)
  if (!shaped) return [...out, 'state: missing top-level fields']
  try {
    out.push(...auditState(st as unknown as SimState, data))
  } catch (err) {
    out.push(`state: malformed (${err instanceof Error ? err.message : err})`)
  }
  return out
}

/** Order-independent hash of a state (determinism tests, __pm.replay). */
export function stateHash(state: SimState): string {
  return fnv1a32(canonicalJson(state))
}

/**
 * Re-run a game: new Sim(data, seed), re-dispatch every logged command at its
 * tick, tick() up to `untilTick`. Same seed + data + log ⇒ same state hash.
 */
export function replay(
  data: GameData,
  seed: number,
  log: readonly CommandLogEntry[],
  untilTick: Tick,
): Sim {
  const sim = new Sim(data, seed)
  let i = 0
  for (;;) {
    while (
      i < log.length &&
      (log[i] as CommandLogEntry).tick <= sim.state.tick
    ) {
      sim.dispatch((log[i] as CommandLogEntry).cmd)
      i += 1
    }
    if (sim.state.tick >= untilTick) return sim
    sim.tick()
  }
}
