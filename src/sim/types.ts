// Sim state (plan.md §6.4, spec-core.md §2-§11). Every field is
// JSON-serialisable: no Map/Set/class/Infinity/NaN and never an `undefined`
// value (`null` instead; optional keys are absent, never set to undefined).
// Static definitions stay in GameData (src/data); the state only holds ids.
// Iteration order rules: arrays sorted by id, string-keyed records in
// data-file order, numeric keys ascending; never iterate a Set/Map.

import type {
  AffinityId,
  BuildingId,
  DistrictId,
  GameData,
  PipsDef,
  QuestGoalDef,
  RoleId,
  StarApplicantDef,
} from '../data/types.ts'

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

/** In-game days (from the data tables) → whole ticks. */
export function daysToTicks(d: number): number {
  return Math.round(d * TICKS_PER_DAY)
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

/**
 * The state / snapshot / save version (plan.md R9, spec-build2 §8): a
 * state-shape change bumps it; Sim.load and the Title refuse any other value
 * (no migrations). 2 = build 2 (`pm.save.v2`); 3 = M6 people (applicants,
 * roles with pips, the Hold Bay station, the wanted list; same save key);
 * 4 = M7 quests (state.quests, nextId.quest, stats.victoryTick, the
 * MinuteRow quest columns; same save key); 5 = M8 L3 (lane.feedIndex,
 * stats.cleared; same save key).
 */
export const STATE_VERSION = 5

export interface SimState {
  version: typeof STATE_VERSION
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
  /** M6 (spec-build2 §2.7): today's applicants per role, on their own rng stream. */
  applicants: ApplicantPools
  /**
   * M6 (spec-build2 §2.8): malware labels revealed so far (a malware Toss by
   * anyone, a lost life), in reveal order, deduped. The poster and the
   * sorter's certainty list.
   */
  wanted: string[]
  /** M7 (spec-build2 §3): the quest slots, scheduler, history, vouchers, the quest rng stream. */
  quests: QuestsState
  /** Key String(id); terminal parcels are removed at the end of the tick (gc). */
  parcels: Record<string, Parcel>
  lane: Lane
  stats: RunStats
  lastLostLife: LostLifeReport | null
  nextId: {
    parcel: number
    vehicle: number
    employee: number
    checker: number
    /** M6: applicant ids (own id space; never an Employee id). */
    applicant: number
    /** M7: quest ids 'q<n>' (offer order). */
    quest: number
  }
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
  /**
   * The driver's Employee id (that employee's `active` is false after a
   * walkout, §7.4); null = no driver (bought with "Hire later" or fired —
   * the vehicle parks `inactive`, spec-build2 §2.5).
   */
  driverId: number | null
  /**
   * M6 Replace (spec-build2 §2.5): the hired driver who takes over after the
   * current trip's unload (people.ts swapPendingDriver); null otherwise.
   */
  nextDriverId: number | null
  /**
   * M6: a driver fired mid-trip with no successor leaves their speedMult /
   * stopMult here so the vehicle finishes the trip at their pace (as after a
   * walkout); removed when it parks `inactive` or a driver is hired into it.
   */
  tripMults?: { speedMult: number; stopMult: number }
  state: VehicleState
  zone: Zone
  pos: TilePos
  /** pos at the start of the current tick (render interpolation). */
  prev: TilePos
  heading: Heading
  wheel: 0 | 1
  /** Inclusive drive-graph tiles of the current route (empty when stationary). */
  path: TileXY[]
  /** The vehicle is on the edge path[pathIndex] → path[pathIndex + 1]. */
  pathIndex: number
  /** Progress along that edge in 1/1000 tile (integer; systems/vehicles.ts MILLI). */
  edgeT: number
  /** Collecting: [the current target]; delivering: every stop, nearest-neighbour order. */
  stops: Stop[]
  /** Index in `stops` of the stop being driven to / served. */
  stopIndex: number
  /** Parcel ids aboard (picked up or loaded), in load order. */
  cargo: number[]
  /** Capacity units of `cargo`. */
  unitsUsed: number
  /**
   * Parcel ids reserved for this vehicle: for collection (still in
   * Building.waiting) or, while docked_loading, the outbound set still on
   * the shelf (loaded 1/s in this order).
   */
  reserved: number[]
  /** The loading dock assigned (driving onto the bay while still `queued`) or occupied. */
  dockId: string | null
  /** End of the current 1.5 s stop or dock idle wait; null when not waiting. */
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

/**
 * One hop of a parcel's history, for the lost-life card path (§10). `what`:
 * 'spawned' (ref building), 'pickedUp' (vehicle id), 'unloaded' (dock id),
 * one slot result per slot passed — 'empty' | 'passed' | 'missed' |
 * 'flagged' | 'skipped' (ref node id; M2) — 'held' / 'cleared' / 'tossed'
 * (Hold Bay; 'cleared' = the player's Clear), 'shelved' / 'returned'
 * (shelf), 'loaded' (vehicle id), 'delivered' (building); M8 overseas:
 * 'handedOff' (ref = the pier / terminal building, text "Handed off at
 * Prefetch Pier 2") and 'customsCleared' (ref = the hub district id, text
 * "Cleared") — never 'cleared'. M1 saves may still hold 'slot'.
 */
export interface TraceEntry {
  tick: Tick
  what: string
  /** A building / vehicle / node / checker id as a string, or null. */
  ref: string | null
  /**
   * ADDITION (M2): the card line without its time, e.g. "Picked up by Bike 1",
   * "Slot 1 Metal detector: missed (15% vs rattle)", "Slot 2: empty". Stored
   * when the hop happens if it depends on something that may change later
   * (vehicle names, the fixture in a slot); always present on the life:lost
   * path (detection.ts fills the rest from the static tables).
   */
  text?: string
  /**
   * ADDITION (M2 review): on a slot result that rolled ('passed' / 'missed'
   * / 'flagged'), the Checker.id — so a checker never rolls the same parcel
   * twice (e.g. a desk moved downstream of a parcel it already checked) —
   * and, for a malware parcel, that checker's p vs its strain: the
   * lost-life card's lane rate is the D this parcel actually faced (§10).
   */
  chk?: string
  p?: number
  /** M6: on a desk slot result, the inspector's Employee id and name. */
  by?: number
  who?: string
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
  /**
   * ADDITION to §6.4: the first scripted malware (§5.4) with
   * firstScripted.forcedCatch — the first checker it reaches flags it with
   * certainty (M2) and parcel:flagged carries `scripted: true`.
   */
  scripted: boolean
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
  /**
   * ADDITION (M3): while `held`, the 0-based Hold Bay rack position it took
   * on arrival (the lowest free one) and keeps until it leaves (Toss /
   * Clear), so the rack never compacts under the player's finger. Absent
   * otherwise (and on parcels held in pre-M3 saves: holdBayItems then gives
   * them the lowest bays left free).
   */
  bay?: number
  /**
   * M6 (spec-build2 §2.6): the sorter judged it clean and left it — its
   * Employee id, name at call time and round(100 × correct). Absent otherwise.
   */
  sorted?: { by: number; name: string; pct: number }
  /** M6: the last player touch while held (the sorter's player grace). */
  touchedTick?: Tick
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
   * input buffer, the Hold Bay (arrival order; the rack position is the
   * parcel's stable `bay`, M3), the shelf.
   * The bin keeps no ids (tossed parcels are terminal; see Lane.quarantine).
   */
  queue: number[]
  /** Slot only. */
  fixture: Fixture | null
  /** Slot processing stations: 1 per machine, 1 per active inspector. */
  stations: Station[]
  /** The LoadingDock id this dock / conveyor node belongs to. */
  dockId: string | null
}

/** A slot processing station (one per machine, one per seated inspector). */
export interface Station {
  parcelId: number | null
  doneTick: Tick | null
  /**
   * M6, desk stations only (absent on machines): the seated inspector and
   * its effective numbers, recomputed by people.ts syncDesk on every crew
   * change — p = own p + same-desk colleagues' charisma, ≤ pCap, 4 dp.
   */
  employeeId?: number
  p?: number
  decoyFlag?: number
  processTicks?: number
}

export type Fixture =
  | { kind: 'machine'; checker: Checker }
  | {
      kind: 'desk'
      /** employees.json desks.rows index (1 = the start desk). */
      index: number
      checker: Checker
      inspectorIds: number[]
      walkedOutIds: number[]
    }

/** M6 (spec-build2 §2.6): the Hold Bay station — a sorter, the Sorter Arm, or empty. */
export interface HoldStation {
  /** The seated sorter's Employee id (active, or walked out and holding the seat), the Sorter Arm, or empty. */
  fixture: number | 'sorter_arm' | null
  /** Sorter: the tick its current call lands; null while idle (no unjudged parcel waiting). */
  nextDecisionTick: Tick | null
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
  /**
   * ADDITION (M3): ticks this day a docked vehicle's due unload was refused
   * by a full conveyor (the lane backing up into the dock — a saturated
   * checker included, which is backpressure and never a `lane:stalled`).
   * The §7 policy's "2nd / 3rd inspector" signal (policy.ts). Reset on the
   * day boundary; absent in pre-M3 saves (read as 0).
   */
  blockedTicksThisDay?: number
  /**
   * ADDITION (M2, run decision Q-RUN1): first tick of the current run of
   * due-but-blocked unloads (the conveyor full); null while unloading flows
   * or nobody is docked. A docked_unloading vehicle blocked for
   * ≥ vehicles.dockIdleWaitS while another vehicle is queued yields the dock.
   */
  stuckSinceTick: Tick | null
  /**
   * ADDITION (M2 review, run decision Q-RUN1 (c), RELIEF): set while the
   * docked_unloading vehicle — blocked ≥ dockIdleWaitS by a full shelf and
   * able to carry ≥ 1 shelf parcel — unloads with the shelf accepting the
   * lane's parcels past its cap (as it accepts a sold vehicle's cargo,
   * §6.8); deleted when that vehicle finishes unloading or leaves the dock.
   * Absent otherwise (and in older saves).
   */
  relief?: true
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
  /** M6: the station next to the Hold Bay rack (replaces `sorterArm`). */
  holdStation: HoldStation
  /**
   * M8 (design-m8-m9 §2.1, §4.3): index into the conveyors (lane.docks
   * order) the feed into the first slot tries first; after a successful
   * feed it points past the conveyor that fed. 0 at start (and always with
   * one dock).
   */
  feedIndex: number
  /** ADDITION to §6.4: the FIFO dock queue on the lot (vehicle ids, index 0 docks next, §4.3). */
  dockQueue: number[]
  /**
   * ADDITION (M2, debug builds): the next checker roll flags its parcel on
   * this trait whatever it carries (ViewSim debug.forceFlagNext). Absent
   * normally; deleted once used.
   */
  debugForceFlag?: Strain
}

export type Role = RoleId
export type Pips = PipsDef
export type Affinity = AffinityId
/** Where a hire seats: a desk's slot node, the Hold Bay station, or a vehicle. */
export type HireTarget =
  | { nodeId: string }
  | { station: 'hold' }
  | { vehicleId: number }

export interface Employee {
  id: number
  role: Role
  name: string
  hiredTick: Tick
  /** Fixed at hire (a driver: for its vehicle's class). */
  salaryPerDay: number
  unpaidPaydays: number
  /** false = walked out (keeps its seat until re-hired / fired). */
  active: boolean
  /** Driver: the vehicle driven, or the one it takes over (Vehicle.nextDriverId). */
  vehicleId: number | null
  /** Inspector: its desk's slot node id; sorter: lane.holdBayNodeId. */
  nodeId: string | null
  /** Exactly the role's stats (employees.json roles[role].stats). */
  pips: Pips
  /** 'none' for inspectors / sorters. */
  affinity: Affinity
  /** Face index 0..FACE_LOOKS-1 (face_00..face_11). */
  look: number
  star: boolean
}

export interface Applicant {
  /** nextId.applicant (own id space; never an Employee id). */
  id: number
  role: Role
  name: string
  pips: Pips
  affinity: Affinity
  look: number
  star: boolean
  /**
   * ★ only: the `state.day` value whose day boundary removes them (people.ts
   * starLeavesOnDay: ≥ starExpiryDays after arrival); null for regulars.
   */
  leavesOnDay: number | null
  /**
   * ★ only: the StarApplicantDef name it was added under — the same ★ again
   * refreshes its expiry even after a rename ("Vera 2", a clash with staff).
   */
  starKey?: string
}

export interface ApplicantPools {
  /** mulberry32 word of the APPLICANT stream (rng.ts RngCell) — never state.rng. */
  rng: number
  /** Stars first, then regulars; length ≤ applicants.poolSize. */
  inspector: Applicant[]
  sorter: Applicant[]
  driver: Applicant[]
}

// Quests (M7, spec-build2 §3; design-m7 §2.1) ------------------------------------

export type QuestGoalKind = QuestGoalDef['kind'] | 'ultimate'
export type QuestFailReason =
  | 'timeout'
  | 'abandoned'
  | 'malware'
  | 'unavailable'
export type QuestOutcome =
  | 'completed'
  | 'failed'
  | 'declined'
  | 'expired'
  | 'abandoned'
  | 'withdrawn'

/** Per-kind counters (the quest observer and the quest step write them; nothing else does). */
export type QuestProgress =
  | { kind: 'deliveriesFrom'; count: number }
  | { kind: 'satisfactionAtLeast'; start: number; satisfaction: number }
  | {
      kind: 'magicParcel'
      parcelId: number | null
      origin: BuildingId | null
      dest: BuildingId | null
      deliveredTick: Tick | null
      onTime: boolean
    }
  | { kind: 'tossStreak'; streak: number; best: number }
  | {
      kind: 'onTimeRateDay'
      dayStartTick: Tick
      deliveries: number
      onTime: number
      bestPct: number
    }
  | { kind: 'deliveriesOfSize'; count: number }
  | { kind: 'holdDecisions'; count: number; resets: number }
  | { kind: 'overseasCleared'; count: number }
  | { kind: 'detectionAllStrains'; sinceTick: Tick | null; minPct: number }
  | { kind: 'ultimate'; delivered: number; onTime: number; malware: number }

/** A resolved reward (level arrays read at offer time). */
export interface QuestReward {
  /** 0 = none; counts toward lifetime earned (spec-build2 §7.3, Q-B2-12). */
  cash: number
  /** 0 = none; capped at economy.lives.cap. */
  lives: number
  /** 0 = none; to the quest's target district, outside the daily cap. */
  satisfaction: number
  star: StarApplicantDef | null
  /** A machines.json checker id (a free machine), or null. */
  voucher: string | null
  /** The ultimate quest only. */
  victory: boolean
}

export interface Quest {
  /** 'q<n>' from nextId.quest (offer order). */
  id: string
  /** quests.json id, or the levels.json ultimateQuest.id. */
  templateId: string
  ultimate: boolean
  status: 'offered' | 'active'
  /** District quests only. */
  target: DistrictId | null
  /** The goal number of design-m7 §3.3 (count, satisfaction, %, 1 for magic). */
  goal: number
  reward: QuestReward
  offeredTick: Tick
  /** null for the ultimate quest (no expiry). */
  expiresTick: Tick | null
  acceptedTick: Tick | null
  /** null while offered. */
  deadlineTick: Tick | null
  /** The value last sent in quest:progress. */
  emittedValue: number
  progress: QuestProgress
}

export interface QuestRecord {
  id: string
  templateId: string
  outcome: QuestOutcome
  tick: Tick
  reason: QuestFailReason | null
}

export interface QuestsState {
  /**
   * mulberry32 word of the QUEST stream (rng.ts RngCell, Sim.questRng) —
   * never state.rng: offers and magic routes leave the main stream alone.
   */
  rng: number
  /** The one open offer. */
  offer: Quest | null
  /** The active quest (quests.offer.maxActive = 1). */
  active: Quest | null
  /** Earliest regular offer (start: firstOfferDay days). */
  nextOfferTick: Tick
  /** Earliest (re-)offer of the ultimate quest (start 0). */
  ultimateNextTick: Tick
  /** state.day at the last offer (spec-build2 §8). */
  lastOfferDay: number | null
  /** Newest last, at most QUEST_HISTORY_MAX (the oldest dropped). */
  history: QuestRecord[]
  /** Free machines (machines.json checker ids) held for the BuySheet, oldest first. */
  vouchers: string[]
}

/** state.quests.history bound (a state bound, not balance). */
export const QUEST_HISTORY_MAX = 50

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
  /** Malware delivered (or cleared overseas, M8). */
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
  /** M7: tick the Golden Release completed (game:victory); null before. */
  victoryTick: Tick | null
  /**
   * M8: overseas clearances (every parcel:cleared, malware included) — the
   * conservation term of parcels that left the map at a hub.
   */
  cleared: number
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
  /** M7: the active quest's template id at the minute's end, or null. */
  quest: string | null
  /** M7: cumulative quest completions. */
  questsDone: number
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
  /** M6: the inspector whose desk roll missed it last (the card names the person). */
  missedBy: {
    employeeId: number
    name: string
    nodeId: string
    p: number
  } | null
  /** M6: the faced rate with that inspector at 5 eye (null when not applicable). */
  inspectorRate: number | null
  /** M6: the sorter's `looks clean` call on it, if any. */
  sorterCall: { name: string; pct: number } | null
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

/**
 * M8: a loading dock's number ('dock3' → 3; economy.docks `index`, the
 * map.lot.docks bay `n − 1`); NaN for any other id.
 */
export function dockNumber(id: string): number {
  const m = /^dock([1-9]\d*)$/.exec(id)
  return m ? Number(m[1]) : Number.NaN
}

/** Unlocked slot node ids in flow order. */
export function liveSlotIds(lane: Lane): string[] {
  return lane.slotNodeIds.filter((id) => !laneNode(lane, id)?.locked)
}

/**
 * §5.4 malware share for a new parcel now: baseShare + perLevel × (level − 1),
 * + postVictoryPerDay for every day boundary after the escalation start,
 * capped at malware.cap; overseas-bound parcels × overseasMult. The start
 * (spec-build2 §3.4, design-m7 §2.2 — the only definition): the Victory tick
 * (stats.victoryTick), else — only while economy.playtestMaxLevel is below
 * the last levels.json row — the tick the level counter capped there
 * (stats.levelTick). Derived from the state (no extra field). (Ignores the
 * first-90 s / first-8-parcels grace: that is spawn.ts's rule.)
 */
export function malwareShare(
  state: SimState,
  data: GameData,
  overseas = false,
): number {
  const m = data.parcels.malware
  let share = m.baseShare + m.perLevel * (state.level.level - 1)
  const cap = data.economy.playtestMaxLevel
  const lastRow = data.levels.reduce((n, l) => Math.max(n, l.level), 0)
  const from =
    state.stats.victoryTick ??
    (cap < lastRow ? state.stats.levelTick[String(cap)] : undefined)
  if (from !== undefined) {
    const firstDay = Math.floor(from / TICKS_PER_DAY) + 1
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
