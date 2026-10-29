// Sim state (plan.md §6.4, spec-core.md §2-§11). Every field is
// JSON-serialisable: no Map/Set/class/Infinity/NaN and never an `undefined`
// value (`null` instead; optional keys are absent, never set to undefined).
// Static definitions stay in GameData (src/data); the state only holds ids.
// Iteration order rules: arrays sorted by id, string-keyed records in
// data-file order, numeric keys ascending; never iterate a Set/Map.

import type { BuildingId, DistrictId, GameData } from '../data/types.ts'

export type { BuildingId, DistrictId } from '../data/types.ts'

// Time (spec §2) -------------------------------------------------------------

/** Sim ticks per sim second (one tick = 100 ms of sim time). */
export const TICKS_PER_S = 10
/** One in-game day = 60 s of sim time = 600 ticks (spec §2). */
export const TICKS_PER_DAY = 600

/** Seconds (from the data tables) → whole ticks. */
export function ticksFromS(s: number): number {
  return Math.round(s * TICKS_PER_S)
}

// §6.4 verbatim ----------------------------------------------------------------

export type Tick = number
export type Size = 'S' | 'M' | 'L' | 'XL'
export type Strain = 'metal' | 'rattle' | 'battery' | 'dense'
export type VehicleType = 'bike' | 'van' | 'truck'
export type Heading = 'NE' | 'SE' | 'SW' | 'NW'
export type Zone = DistrictId | 'any'

/** Integer road tile. */
export interface TileXY {
  x: number
  y: number
}

/** Fractional tile position (vehicles). */
export interface TilePos {
  tx: number
  ty: number
}

export interface SimState {
  version: 1
  seed: number
  /** mulberry32 state word (uint32), advanced only through Rng (rng.ts). */
  rng: number
  tick: Tick
  /** floor(tick / TICKS_PER_DAY): completed in-game days. */
  day: number
  economy: Economy
  level: LevelState
  spawn: SpawnState
  /** Insertion order = districts.json order (every district, live or not). */
  districts: Record<DistrictId, District>
  /** Insertion order = buildings.json order (all 69 rows). */
  buildings: Record<BuildingId, Building>
  /** Ascending id, never reordered (payroll order = purchase order, §7.4). */
  vehicles: Vehicle[]
  /** Ascending id, never reordered (payroll order = hire order, §7.4). */
  employees: Employee[]
  /** Key String(id); terminal parcels are removed at the end of the tick (gc). */
  parcels: Record<string, Parcel>
  lane: Lane
  stats: RunStats
  lastLostLife: LostLifeReport | null
  nextId: { parcel: number; vehicle: number; employee: number; checker: number }
}

export interface District {
  id: DistrictId
  live: boolean
  /** 0-100 integer (§9.1); meaningless for overseas hubs. */
  satisfaction: number
  /** Next spawn timer; null while locked (and always for overseas hubs). */
  nextSpawnTick: Tick | null
  /** Positive satisfaction gained today (capped by positiveCapPerDay, §9.1). */
  dayPositive: number
  /** Waiting-pickup penalty taken today (capped by waitingPenaltyCapPerDay). */
  dayWaitingPenalty: number
  /** Satisfaction at the last day boundary (trend arrow, §9.2). */
  satisfactionAtDayStart: number
  /** $ paid for parcels delivered TO this district (city-view.md §5.1). */
  earned: number
}

/** Dynamic part only; the static row (name, tile, anchor, send, recv) lives in GameData. */
export interface Building {
  id: BuildingId
  /** Parcel ids waiting here (spawn order); counts toward the 3-cap (§4.4). */
  waiting: number[]
  rushUntilTick: Tick | null
}

/** §4.6 */
export type VehicleState =
  | 'idle_lot'
  | 'queued'
  | 'docked_unloading'
  | 'docked_loading'
  | 'delivering'
  | 'collecting'
  | 'returning'
  | 'inactive'

export interface Stop {
  kind: 'deliver' | 'collect' | 'handoff'
  buildingId: BuildingId
  tile: TileXY
  parcelIds: number[]
}

export interface Vehicle {
  id: number
  type: VehicleType
  /** "Bike 1" (type name + the smallest number unused by the current fleet). */
  name: string
  /** The implicit driver's Employee id (that employee's `active` is false after a walkout, §7.4). */
  driverId: number | null
  state: VehicleState
  zone: Zone
  pos: TilePos
  /** pos at the start of the current tick (render interpolation). */
  prev: TilePos
  heading: Heading
  wheel: 0 | 1
  path: TileXY[]
  pathIndex: number
  edgeT: number
  stops: Stop[]
  stopIndex: number
  /** Parcel ids aboard (picked up or loaded), in load order. */
  cargo: number[]
  unitsUsed: number
  /** Parcel ids reserved for collection (still in Building.waiting). */
  reserved: number[]
  dockId: string | null
  /** End of the current stop / dock wait; null when not waiting. */
  waitUntilTick: Tick | null
  rushBuildingId: BuildingId | null
  collectedThisLeg: boolean
  purchasePrice: number
  boughtTick: Tick
}

/** §11 */
export type ParcelState =
  | 'waiting'
  | 'picked_up'
  | 'in_transit_in'
  | 'unloading'
  | 'in_conveyor'
  | 'in_slot'
  | 'held'
  | 'tossed'
  | 'on_shelf'
  | 'loaded'
  | 'in_transit_out'
  | 'delivered'
  | 'handed_off'
  | 'clearing'
  | 'cleared'

/** One hop of a parcel's history, for the lost-life card path (§10). */
export interface TraceEntry {
  tick: Tick
  /** e.g. 'spawned', 'pickedUp', 'unloaded', 'slot', 'missed', 'shelved', 'delivered'. */
  what: string
  /** A building / vehicle / node / checker id as a string, or null. */
  ref: string | null
}

export interface Parcel {
  id: number
  size: Size
  baseValue: number
  /** Overseas / magic multiplier (1 for local parcels). */
  mult: number
  origin: BuildingId
  dest: BuildingId
  destRegion: DistrictId
  spawnedTick: Tick
  label: string
  malware: boolean
  strain: Strain | null
  decoy: Strain | null
  magic: boolean
  state: ParcelState
  reservedBy: number | null
  vehicleId: number | null
  nodeId: string | null
  nodeEnterTick: Tick | null
  nodeDoneTick: Tick | null
  /** Checker.id of the flagging checker. */
  flaggedBy: string | null
  flaggedStrain: Strain | null
  /** Value locked at an overseas hand-off (§5.6). */
  lockedValue: number | null
  /** Overseas clearance pay tick (§5.6). */
  clearTick: Tick | null
  trace: TraceEntry[]
}

export type LaneNodeKind =
  | 'dock'
  | 'conveyor'
  | 'slot'
  | 'holdBay'
  | 'bin'
  | 'shelf'

/**
 * Generic lane element (spec §6.9: never assume slot indices are the only
 * topology). Flow follows `next` edges: dock1 → conv1 → slot1 → … → slotN →
 * shelf; every slot `divert`s flagged parcels to 'hold'; hold.next =
 * ['shelf', 'bin'] (Clear, Toss). A node with `locked` is not live yet: it
 * holds no fixture and the flow passes straight through it (use
 * nextLiveNodeId() below). Unlocking = `delete node.locked` (never set
 * it to undefined).
 */
export interface LaneNode {
  id: string
  kind: LaneNodeKind
  next: string[]
  divert?: string
  locked?: { level: number }
  /** conveyor 6, slot buffer 2, holdBay / shelf from the level row, dock and bin null. */
  cap: number | null
  /**
   * Parcel ids at this node in arrival order: the conveyor belt, a slot's
   * input buffer, the Hold Bay (index = bay, lowest first), the shelf.
   * The bin keeps no ids (tossed parcels are terminal; see Lane.quarantine).
   */
  queue: number[]
  /** Slot only. */
  fixture: Fixture | null
  /** Slot processing stations: 1 per machine, 1 per active inspector. */
  stations: { parcelId: number | null; doneTick: Tick | null }[]
  /** The LoadingDock id this dock / conveyor node belongs to. */
  dockId: string | null
}

export type Fixture =
  | { kind: 'machine'; checker: Checker }
  | {
      kind: 'desk'
      checker: Checker
      inspectorIds: number[]
      walkedOutIds: number[]
    }

export interface Checker {
  /** 'chk<n>' from nextId.checker. */
  id: string
  kind: 'machine' | 'desk'
  /** machines.json checker id, or 'inspector' for the desk (employees.json). */
  defId: string
  strain: Strain | 'any'
  pMatch: number
  pOther: number
  decoyFlag: number
  processTicks: number
  /** Station count (= node.stations.length; inspectors at the desk). */
  stations: number
  price: number
  boughtTick: Tick
}

export interface LoadingDock {
  id: string
  conveyorNodeId: string
  vehicleId: number | null
  nextTransferTick: Tick | null
  /** Ticks with a vehicle in the dock this day → dock:occupancy (§6.5). */
  busyTicksThisDay: number
}

export interface Lane {
  nodes: LaneNode[]
  docks: LoadingDock[]
  slotNodeIds: string[]
  holdBayNodeId: string
  binNodeId: string
  shelfNodeId: string
  stalled: boolean
  stallReason: 'holdBayFull' | 'shelfFull' | 'bufferFull' | null
  stallNodeId: string | null
  stallSinceTick: Tick | null
  /** Stalled sim seconds this day (+0.1 per stalled tick); reset on the day boundary. */
  stallSecondsToday: number
  quarantine: { count: number; malware: number; clean: number }
  sorterArm: boolean
  /** ADDITION to §6.4: the FIFO dock queue on the lot (vehicle ids, index 0 docks next, §4.3). */
  dockQueue: number[]
}

export interface Employee {
  id: number
  kind: 'inspector' | 'driver'
  name: string
  hiredTick: Tick
  salaryPerDay: number
  unpaidPaydays: number
  active: boolean
  /** Driver only: the vehicle driven. */
  vehicleId: number | null
  /** Inspector only: the desk's slot node id. */
  nodeId: string | null
}

export interface Economy {
  /** Integer $; never negative (§7.2). */
  balance: number
  /** Deliveries + clearances + bounties + quest rewards; never decreases. */
  lifetimeEarned: number
  lives: number
  gameOver: boolean
  victory: boolean
  daysSinceIncident: number
  lastPayroll: { tick: Tick; paid: number; shortEmployeeIds: number[] } | null
}

export interface LevelState {
  level: number
  /** Next levels.json threshold; at playtestMaxLevel it keeps pointing at the next row. */
  nextThreshold: number | null
  /** Live district ids in districts.json order (mirrors District.live). */
  unlocked: DistrictId[]
  /** Tick each strain's announcement ticker fired (spawns 60 s later, §5.4). */
  announced: Partial<Record<Strain, Tick>>
  slots: number
  holdBayCap: number
  shelfCap: number
  warehouseTier: number
}

export interface SpawnState {
  spawnedCount: number
  malwareCount: number
  scriptedDone: boolean
  scriptedDeferredUntilTick: Tick | null
  magicAlive: number
}

export interface RunStats {
  /** Every parcel:delivered (malware included). */
  deliveries: number
  onTime: number
  late: number
  malwareSpawned: number
  /** Malware flagged by a checker. */
  malwareCaught: number
  /** Malware delivered (or cleared overseas). */
  malwareMissed: number
  wrongToss: number
  firstDeliveryTick: Tick | null
  /** Tick the first malware parcel was flagged. */
  firstCatchTick: Tick | null
  /** Level (as a string key) → tick reached; '1' → 0. */
  levelTick: Record<string, Tick>
  /** Tick the first truck was bought. */
  truckTick: Tick | null
  /** Lifetime $ paid in (deliveries, clearances, bounties). */
  income: number
  payrollPaid: number
  /** ADDITION to §6.4: every parcel:held (Hold Bay arrivals, the §7 density gate). */
  holdBayEvents: number
  /** One row per in-game minute, appended on the day boundary (tick.ts). */
  minutes: MinuteRow[]
}

// Defined here (named in §6.4) --------------------------------------------------

/** One in-game minute of the `vlr sim` timeline (plan.md §6.9.2 columns). */
export interface MinuteRow {
  /** Minutes completed (the 1-based minute that just ended). */
  min: number
  tick: Tick
  /** Balance $. */
  money: number
  /** Lifetime earned $. */
  earned: number
  lvl: number
  /** Mean satisfaction of live districts, rounded (§9.4). */
  sat: number
  /** Cumulative parcels spawned. */
  spawn: number
  /** Cumulative deliveries. */
  deliv: number
  /** Cumulative late deliveries. */
  late: number
  /** Malware share now (0..1) for a local parcel (§5.4). */
  malShare: number
  /** Cumulative malware spawned / caught (flagged) / missed (delivered): column s/c/m. */
  malSpawned: number
  malCaught: number
  malMissed: number
  /** Parcels on the shelf now. */
  shelf: number
  /** Parcels in the Hold Bay now / cumulative Hold Bay arrivals: column held. */
  held: number
  heldTotal: number
  /** Lane stall seconds during this minute. */
  stallS: number
  /** Mean dock occupancy % during this minute (§6.5). */
  dockPct: number
  /** Vehicles owned. */
  fleet: number
  lives: number
}

/** Everything the lost-life card shows (§10); also the life:lost `report`. */
export interface LostLifeReport {
  tick: Tick
  parcelId: number
  label: string
  strain: Strain | null
  size: Size
  originBuildingId: BuildingId
  destBuildingId: BuildingId
  /** The parcel's trace (every hop with its tick). */
  path: TraceEntry[]
  /** The lane's catch rate D(strain) when it passed, 0..1 (§6.3). */
  laneRate: number
  /** The strain's counter machine (parcels.json strains[].counter). */
  counterMachineId: string | null
  /** The lane already holds that machine (the "got through on the N%" branch). */
  counterOwned: boolean
  /** D(strain) with the counter added (or one more unit when owned), 0..1. */
  counterRate: number | null
  /** Tick the player cleared it from the Hold Bay, or null. */
  clearedByPlayerAt: Tick | null
  /** Lives left after this loss. */
  livesLeft: number
  /** Lost at an overseas clearance rather than a local delivery. */
  viaClearance: boolean
}

// Pure state accessors (no runtime imports, so every sim module can use them) -----

/** The lane node with this id, or null. */
export function laneNode(lane: Lane, id: string): LaneNode | null {
  return lane.nodes.find((n) => n.id === id) ?? null
}

/**
 * Where a parcel leaving `id` goes next along the flow: `next[0]`, passing
 * straight through locked nodes (slots past the level's slot count). Null
 * for a terminal node.
 */
export function nextLiveNodeId(lane: Lane, id: string): string | null {
  let cur = laneNode(lane, id)
  for (let guard = 0; cur && guard <= lane.nodes.length; guard++) {
    const nextId = cur.next[0]
    if (nextId === undefined) return null
    const next = laneNode(lane, nextId)
    if (!next) return null
    if (!next.locked) return next.id
    cur = next
  }
  return null
}

/** Unlocked slot node ids in flow order. */
export function liveSlotIds(lane: Lane): string[] {
  return lane.slotNodeIds.filter((id) => !laneNode(lane, id)?.locked)
}

/**
 * §5.4 malware share for a new parcel now: baseShare + perLevel × (level − 1),
 * + postVictoryPerDay for every day boundary after the level counter capped
 * at economy.playtestMaxLevel (counted from stats.levelTick, so no extra
 * state), capped at malware.cap; overseas-bound parcels × overseasMult.
 * TODO(build 2): the same escalation after Victory (needs the victory tick).
 * (Ignores the first-90 s / first-8-parcels grace: that is spawn.ts's rule.)
 */
export function malwareShare(
  state: SimState,
  data: GameData,
  overseas = false,
): number {
  const m = data.parcels.malware
  let share = m.baseShare + m.perLevel * (state.level.level - 1)
  const capTick = state.stats.levelTick[String(data.economy.playtestMaxLevel)]
  if (capTick !== undefined) {
    const firstDay = Math.floor(capTick / TICKS_PER_DAY) + 1
    share += m.postVictoryPerDay * Math.max(0, state.day - firstDay + 1)
  }
  share = Math.min(m.cap, share)
  return overseas ? Math.min(m.cap, share * m.overseasMult) : share
}

/** §9.4 global mood: mean satisfaction of live (non-hub) districts, rounded. */
export function meanSatisfaction(state: SimState, data: GameData): number {
  let sum = 0
  let n = 0
  for (const d of data.districts) {
    const st = state.districts[d.id]
    if (d.kind !== 'district' || !st?.live) continue
    sum += st.satisfaction
    n += 1
  }
  return n === 0 ? 0 : Math.round(sum / n)
}
