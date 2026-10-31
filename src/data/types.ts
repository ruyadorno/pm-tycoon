// GameData: the validated static tables of spec-core.md §12 (one interface per
// src/data/<file>.json) plus MapData (map.json, spec §3.1-§3.2, plan.md §5).
// Headless: no Phaser, no DOM. Built only through buildGameData (index.ts).

export type DistrictId = string
export type BuildingId = string
export type SizeId = 'S' | 'M' | 'L' | 'XL'
export type StrainId = 'metal' | 'rattle' | 'battery' | 'dense'
export type VehicleTypeId = 'bike' | 'van' | 'truck'

/** Integer tile coordinate pair. */
export type XY = [x: number, y: number]
/** Footprint in tiles. */
export type WH = [w: number, h: number]
/** Inclusive rectangle in tiles. */
export type Rect = [x0: number, y0: number, x1: number, y1: number]

// districts.json ------------------------------------------------------------

export type SizeMix = Record<SizeId, number>

interface DistrictBase {
  id: DistrictId
  name: string
  flavour: string
  unlockLevel: number
  /** Block coordinates [b, r] (spec §3.1: block (b, r) spans x 4+8b..10+8b). */
  blocks: XY[]
  favoured: VehicleTypeId[]
  allowed: VehicleTypeId[]
  hardRule: boolean
}

export interface LiveDistrictDef extends DistrictBase {
  kind: 'district'
  sizeMix: SizeMix
  spawnIntervalS: number
}

export interface OverseasDistrictDef extends DistrictBase {
  kind: 'overseas'
  zoneDistricts: DistrictId[]
  clearanceS: number
  valueMult: number
  malwareMult: number
  hubWeight: number
  sizes: SizeId[]
}

export type DistrictDef = LiveDistrictDef | OverseasDistrictDef

// buildings.json ------------------------------------------------------------

export interface BuildingDef {
  id: BuildingId
  district: DistrictId
  name: string
  footprint: WH
  /** Top-left footprint tile. */
  tile: XY
  /** Road tile on the avenue adjacent to the building's block. */
  anchor: XY
  send: number
  recv: number
}

// vehicles.json -------------------------------------------------------------

export interface VehicleTypeDef {
  id: VehicleTypeId
  name: string
  unlockLevel: number
  price: number
  capacityUnits: number
  sizes: SizeId[]
  speedTilesPerS: number
  driverSalaryPerDay: number
  disallowedRegions: DistrictId[]
}

export interface VehiclesData {
  unitsBySize: Record<SizeId, number>
  stopS: number
  dockUnloadPerS: number
  dockLoadPerS: number
  dockIdleWaitS: number
  dockIdleWaitOnlyIfQueueEmpty: boolean
  collectRadiusTiles: number
  rushExpireS: number
  dispatchTickS: number
  lastVehicleUnsellable: boolean
  types: VehicleTypeDef[]
}

// machines.json -------------------------------------------------------------

export interface CheckerDef {
  id: string
  name: string
  unlockLevel: number
  price: number
  strain: StrainId | 'any'
  pMatch: number
  pOther: number
  decoyFlag: number
  processS: number
}

export interface UpgradeDef {
  id: string
  name: string
  unlockLevel: number
  price: number
  target: 'holdBay'
  autoTossDelayS: number
}

export interface MachinesData {
  slotBufferCap: number
  conveyorCapPerDock: number
  checkers: CheckerDef[]
  upgrades: UpgradeDef[]
  removalRefund: number
}

// employees.json ------------------------------------------------------------
// Build 2 (spec-build2 §2, §9): three hireable roles whose stats are pips
// (1-5; charisma 0-2) mapped to numbers through the per-role tables.

export type RoleId = 'inspector' | 'sorter' | 'driver'
export type StatId =
  | 'eye'
  | 'pace'
  | 'charisma'
  | 'judgement'
  | 'speed'
  | 'energy'
export type AffinityId = 'none' | VehicleTypeId
/** Pip counts keyed by the role's `stats` (1-5; charisma 0-2). Exactly the role's keys. */
export type PipsDef = Partial<Record<StatId, number>>

export interface SalaryDef {
  base: number
  perPip: number
  perCharisma: number
}

export interface InspectorRoleDef {
  stats: StatId[]
  /** Own detection p by eye pip (index = pip − 1). */
  p: number[]
  decoyFlag: number[]
  /** Process time by pace pip. */
  processS: number[]
  /** + p to every OTHER active inspector at the same desk, by charisma (index = pip). */
  charismaBonus: number[]
  pCap: number
  strain: 'any'
  salary: SalaryDef
  hireFeeDays: number
}

export interface SorterRoleDef {
  stats: StatId[]
  /** Correct-call chance by judgement pip. */
  correct: number[]
  /** Seconds per decision by pace pip. */
  decisionS: number[]
  playerGraceS: number
  usesWantedList: boolean
  canClear: false
  tagsClean: boolean
  salary: SalaryDef
  hireFeeDays: number
}

export interface DriverRoleDef {
  stats: StatId[]
  /** × the class speed by (speed + affinity) pip. */
  speedMult: number[]
  /** × vehicles.stopS by energy pip. */
  stopMult: number[]
  /** + satisfaction per on-time delivery / per pickup, by charisma (index = pip). */
  charismaDelivery: number[]
  charismaPickup: number[]
  affinityPips: number
  salary: SalaryDef
  hireFeeDays: number
}

export interface ApplicantsDef {
  poolSize: number
  refreshEveryDays: number
  adPrice: number
  starExpiryDays: number
  /** Level band ("1".."5") → weights of pips 1..5. Band = min(level, largest key). */
  pipWeights: Record<string, number[]>
  /** Weights of charisma 0, 1, 2. */
  charismaWeights: number[]
  affinityWeights: Record<AffinityId, number>
}

export interface DeskRowDef {
  index: number
  unlockLevel: number
  price: number
}

export interface EmployeesData {
  roles: {
    inspector: InspectorRoleDef
    sorter: SorterRoleDef
    driver: DriverRoleDef
  }
  applicants: ApplicantsDef
  start: { inspector: { name: string; pips: PipsDef; slot: number } }
  desks: { maxPerDesk: number; rows: DeskRowDef[] }
  holdStation: { unlockLevel: number }
  payrollIntervalS: number
  payOrder: ('inspectors' | 'sorters' | 'drivers')[]
  walkoutAfterUnpaidPaydays: number
  rehireFeeDays: number
}

/** A ★ applicant (quests.json rewards, M7 — the type lands now so people.ts can take it). */
export interface StarApplicantDef {
  role: RoleId
  name: string
  pips: PipsDef
  affinity?: AffinityId
}

// parcels.json --------------------------------------------------------------

export interface SizeDef {
  units: number
  value: number
}

export interface StrainDef {
  id: StrainId
  level: number
  /** A machines.json checker id. */
  counter: string
  flavour?: string
}

export interface FirstScriptedDef {
  atS: number
  strain: StrainId
  size: SizeId
  servableOrigin: boolean
  forcedCatch: boolean
  deferUntilCheckerS: number
}

export interface MalwareDef {
  graceS: number
  graceCount: number
  baseShare: number
  perLevel: number
  cap: number
  postVictoryPerDay: number
  overseasMult: number
  newStrainDelayS: number
  strains: StrainDef[]
  firstScripted: FirstScriptedDef
}

export interface ParcelsData {
  sizes: Record<SizeId, SizeDef>
  decay: { graceS: number; floorAtS: number; floor: number }
  onTimeMaxS: number
  spawn: {
    firstSpawnDelayS: number
    maxWaitingPerBuilding: number
    sameDistrictShare: number
    overseasShare: number
  }
  malware: MalwareDef
  decoyShare: number
  magic: {
    countdownS: number
    reward: number
    lives: number
    maxAlive: number
    skipsCheckers: boolean
  }
}

// economy.json --------------------------------------------------------------

export interface DockDef {
  index: number
  unlockLevel: number
  price: number
}

export interface SatisfactionDef {
  start: number
  min: number
  max: number
  driftPerDayToward: number
  driftStep: number
  onTime: number
  favouredBonus: number
  favouredPickup: number
  positiveCapPerDay: number
  late: number
  waitingOver180s: number
  /** Seconds a parcel waits unpicked before the waitingOver180s penalty (spec §9.1 "crosses 180 s"). */
  waitingPenaltyAfterS: number
  waitingPenaltyCapPerDay: number
  malwareDelivered: number
  wrongToss: number
  intervalMultAt0: number
  intervalMultAt50: number
  intervalMultAt100: number
  loudBelow: number
  happyAbove: number
}

export interface PacingTargets {
  firstDeliveryS: number
  firstMalwareCaughtMaxS: number
  level2Min: [min: number, max: number]
  truckAfterLevel2MaxMin: number
  maxLivesLost: number
  maxShelfStallS: number
  holdBayEventsPer10MinMin: number
  level3Min: [min: number, max: number]
  level4Min: [min: number, max: number]
  level5Min: [min: number, max: number]
  /** Build 2 (spec-build2 §7.3, §9): informational until their milestone. */
  firstOverseasClearedAfterLevel3MaxMin: number
  questsOfferedBy30MinMin: number
  questsCompletedBy30MinMin: number
  payrollShareOfGrossMax: number
  goldenReleaseOfferedMaxMin: number
  victoryMaxMin: number
  /** Build 3 (spec-build3 §7): informational until SIM_FEATURES.events. */
  eventsOfferedBy30MinMin: number
  eventsOpenMaxTicks: number
  eventsL1PlateauMin: number
}

export interface EconomyData {
  startMoney: number
  sellRefund: number
  tossBounty: number
  wrongTossFee: number
  docks: DockDef[]
  satisfaction: SatisfactionDef
  lives: { start: number; cap: number }
  continueWithOneLife: boolean
  playtestMaxLevel: number
  pacingTargets: PacingTargets
}

// levels.json ---------------------------------------------------------------

// quests.json (spec-build2 §3.2, §9) -----------------------------------------------

/** A number, or one per level (index min(level, len) − 1, read at offer time). */
export type LevelScaled = number | number[]
export type QuestTargetRule =
  | 'district:mostWaiting'
  | 'district:satisfactionBelow'
export type QuestCondition = 'livesBelowCap' | `hubLive:${string}`
export type QuestRequirement = 'firstToss'

export type QuestGoalDef =
  | { kind: 'deliveriesFrom'; count: LevelScaled }
  | { kind: 'satisfactionAtLeast'; value: number }
  | { kind: 'magicParcel'; maxRoadTiles: number }
  | { kind: 'tossStreak'; count: LevelScaled }
  | { kind: 'onTimeRateDay'; rate: number; minDeliveries: number }
  | { kind: 'deliveriesOfSize'; size: SizeId; count: LevelScaled }
  | { kind: 'holdDecisions'; count: LevelScaled; noStall: boolean }
  | { kind: 'overseasCleared'; hub: DistrictId; count: LevelScaled }
  | { kind: 'detectionAllStrains'; rate: number; holdDays: number }

export interface QuestRewardDef {
  cash?: LevelScaled
  satisfaction?: number
  lives?: number
  starApplicant?: StarApplicantDef
  /** A machines.json checkers[].id: a free machine. */
  voucher?: string
}

export interface QuestTemplateDef {
  id: string
  name: string
  unlockLevel: number
  target?: QuestTargetRule
  targetArg?: number
  condition?: QuestCondition
  requires?: QuestRequirement
  goal: QuestGoalDef
  /** Absent only for magicParcel (its clock is parcels.json magic.countdownS). */
  limitDays?: number
  /** Absent only for magicParcel (its payout is parcels.json magic). */
  reward?: QuestRewardDef
  weight: number
}

export interface QuestOfferDef {
  declineCooldownDays: number
  maxActive: number
}

export interface QuestsData {
  offer: QuestOfferDef
  templates: QuestTemplateDef[]
}

export interface UltimateQuestDef {
  id: string
  days: number
  deliveries: number
  maxMalwareDelivered: number
  minOnTimeRate: number
}

export interface LevelDef {
  level: number
  title: string
  threshold: number
  unlockRegions: DistrictId[]
  vehicles: VehicleTypeId[]
  /** machines.json checker or upgrade ids. */
  machines: string[]
  slots: number
  holdBayCap: number
  shelfCap: number
  warehouseTier: number
  strain: StrainId | null
  ticker: string
  ultimateQuest?: UltimateQuestDef
}

// puns.json -----------------------------------------------------------------

export interface PunsData {
  cleanLabels: string[]
  malwareLabels: Record<StrainId, string[]>
  decoyLabels: Record<StrainId, string[]>
  streets: string[]
  tracks: string[]
  /** Build 2: every hireable person's name (spec-build2 §9); the start inspector first. */
  peopleNames: string[]
  companyName: string
  tossHint: string
  wantedTitle: string
  tickerFiller: string[]
  /** M7: template id (and the ultimate id) → flavour line; `{district}` = the target's flavour. */
  quests: Record<string, string>
  /** M7 ticker lines: `{name}`, `{reward}`, `{role}`, `{company}`. */
  tickerQuest: {
    offered: string
    completed: string
    failed: string
    star: string
    victory: string
    /**
     * M9 (design-m8-m9 §4.7): the endless line, once, at the first day
     * boundary after Victory (tick.ts day step; no placeholder).
     */
    endless: string
  }
  /** M7: the ultimate quest's display name (levels.json has no name field). */
  ultimateQuestName: string
  /** Build 3: event ticker lines (`{category}`, `{title}`, `{label}`). */
  tickerEvent: {
    offered: string
    modifierEnded: string
    chainDone: string
    subscriptionsUnpaid: string
  }
  /** Build 3: card words (`{title}`, `{days}`, `{hint}`, `{option}`). */
  eventWords: {
    then: string
    thenNow: string
    cantAfford: string
    outcome: string
    youChose: string
  }
}

// events.json (build 3, spec-build3 §3, §7) -----------------------------------

export type EventCategory =
  | 'staff'
  | 'fleet'
  | 'customers'
  | 'security'
  | 'money'
  | 'cityhall'
  | 'weather'
  | 'press'
  | 'underworld'
  | 'tech'
  | 'port'
  | 'luck'
export type EventCategoryId = EventCategory | 'job'
/** Derived: a job offer, a one-option card (news) or a 2+-option card (decision). */
export type EventKind = 'decision' | 'news' | 'job'
export type ModifierKey =
  | 'speed'
  | 'stop'
  | 'inspectorP'
  | 'machineP'
  | 'processS'
  | 'payrollMult'
  | 'payrollAdd'
  | 'income'
  | 'malwareShare'
  | 'decoyShare'
  | 'spawn'
  | 'tossBounty'
  | 'wrongTossFee'
  | 'vehiclePrice'
  | 'machinePrice'
  | 'onTimeMaxS'
  | 'clearanceS'
  | 'shelfCap'
/** Who a card names (`{inspector}` …) and who a `one` effect acts on (drawn when the card opens). */
export type CardPickRole = 'inspector' | 'sorter' | 'driver' | 'vehicle'
/** 'busiest' | 'lowest' | 'random' | a spawning district id. */
export type EventTargetRule = string
/** 'all' | 'target' | 'busiest' | 'lowest' | a spawning district id. */
export type SatScope = string

/** Every key present must hold (B3 §4.1, §7). */
export interface EventCond {
  /** state.vehicles.length (owned, including inactive and absent) >= n. */
  fleetAtLeast?: number
  /** D-27: the rescue's `fleet = 0` (state.vehicles.length <= n). */
  fleetAtMost?: number
  /** Owned vehicles of that type (any state) >= n. */
  vehiclesAtLeast?: { type: VehicleTypeId; n: number }
  livesAtLeast?: number
  livesBelowCap?: true
  /** Active, seated, not absent. */
  inspectorsAtLeast?: number
  /** Active, driving a vehicle, not absent. */
  driversAtLeast?: number
  /** holdStation.fixture is an employee who is active and not absent. */
  hasSorter?: true
  /** holdStation.fixture === 'sorter_arm'. */
  hasArm?: true
  /** A desk fixture with index 2 exists. */
  hasDesk2?: true
  /** An overseas district that is live. */
  hubLive?: DistrictId
  satBelow?: { scope: SatScope; value: number }
  satAtLeast?: { scope: SatScope; value: number }
  balanceAtLeast?: number
  balanceBelow?: number
  /** D-27: balance < priceOf(that vehicle type) — the rescue. */
  balanceBelowVehiclePrice?: VehicleTypeId
  /** min over announced strains of the lane's compounded catch rate (modifier-aware). */
  laneRateAtLeast?: number
  flag?: string
  notFlag?: string
  /** stats.livesLost (every cause) >= n. */
  livesLostAtLeast?: number
  wrongTossTodayAtLeast?: number
  /** A quest failed or was abandoned within schedule.recentDays. */
  questFailedRecently?: true
  anyOf?: EventCond[]
}

export interface NextBranchDef {
  /** Absent on the last branch (the else). */
  if?: EventCond
  id: string
}

export type EventEffect =
  | { kind: 'money'; delta: number }
  | { kind: 'moneyPerVehicle'; delta: number; type?: VehicleTypeId }
  | { kind: 'moneyPct'; pct: number }
  | { kind: 'lives'; delta: number }
  | { kind: 'satisfaction'; scope: SatScope; delta: number }
  /** mult XOR add; scope: a vehicle type (speed), a spawning district id or 'target' (spawn), 'desk' | 'machine' (processS), a hub id (clearanceS); days absent = permanent. */
  | {
      kind: 'mod'
      key: ModifierKey
      mult?: number
      add?: number
      scope?: string
      days?: number
    }
  | {
      kind: 'pips'
      role: RoleId
      stat: StatId
      delta: number
      scope: 'all' | 'one'
    }
  | { kind: 'vehicle'; lose: VehicleTypeId | 'any'; fallback: number }
  | { kind: 'vehicle'; gain: VehicleTypeId; withDriver?: StarApplicantDef }
  | { kind: 'staff'; quit: RoleId; pick: 'one' | 'best' | 'worst' }
  | { kind: 'staff'; star: StarApplicantDef }
  | {
      kind: 'staff'
      absent: RoleId | 'vehicles'
      pick: 'one' | 'all'
      days: number
    }
  | { kind: 'wanted'; reveal: number }
  | { kind: 'parcels'; spawn: { size: SizeId; count: number; at: string } }
  | { kind: 'parcels'; lose: { where: 'shelf'; count: number } }
  /** D-25: `cap {shelf, add}`. */
  | { kind: 'cap'; cap: 'shelf'; add: number }
  | { kind: 'end'; eventId: string }
  | { kind: 'flag'; set: string }
  | { kind: 'flag'; clear: string }
  | { kind: 'next'; eventId: string; days: number }
  | { kind: 'next'; days: number; hint: string; branches: NextBranchDef[] }
  /** Synthesized job cards only — never in events.json (schema). */
  | { kind: 'job'; templateId: string }
  | { kind: 'jobDecline' }

export interface EventOptionDef {
  /** At most 28 glyphs after placeholder fill. */
  label: string
  effects: EventEffect[]
  /** The money effect itself: debits it, greys the option while balance < cost (B3 §3.3). */
  cost?: number
  default?: true
  danger?: true
  if?: EventCond
}

export interface EventDef {
  /** `ev_…` */
  id: string
  category: EventCategory
  title: string
  /** Absent only on routers. */
  body?: string
  /** Default 1. */
  minLevel?: number
  /** Default schedule.weightDefault[decision|news]. */
  weight?: number
  cond?: EventCond
  target?: EventTargetRule
  pick?: CardPickRole
  once?: true
  cooldownDays?: number
  /** Default true; false on every chain link, router and rescue card. */
  drawable?: boolean
  router?: true
  rescue?: true
  /** 1–3; absent only on routers. */
  options?: EventOptionDef[]
  /** Routers only (days 0). */
  next?: { days: number; branches: NextBranchDef[] }
}

export interface EventScheduleDef {
  firstEventS: number
  /** Level (string key "1".."5") → [lo, hi] seconds; a level above the last key uses the last key. */
  intervalS: Record<string, [number, number]>
  /** Always false (schema): links never touch the draw timer (D-39). */
  linkRestartsTimer: boolean
  /** Always 1 (schema). */
  maxOpen: number
  maxQueued: number
  afterLevelUpS: number
  rescueDelayS: number
  jobShare: number
  jobCooldownDays: number
  /** D-27: questFailedRecently window. */
  recentDays: number
  linkMaxDays: number
  chainMaxLinks: number
  historyMax: number
  weightDefault: { decision: number; news: number }
}

export interface EventCategoryDef {
  word: string
  picture: string
}

export interface EventModifiersDef {
  bounds: Record<ModifierKey, [number, number]>
  goodDirection: Record<ModifierKey, 'up' | 'down'>
  permanentDaysForScore: number
  /** D-24: result clamps (the fold clamp is `bounds`). */
  deskPFloor: number
  machinePClamp: [number, number]
  shelfCapMax: number
}

export interface EventPolicyWeightsDef {
  money: number
  life: number
  satisfactionPerPoint: number
  vehicleGainShare: number
  staffQuit: number
  absentPerDay: number
  wantedPerLabel: number
  capPerUnit: number
  chain: number
  /** D-38: per injected parcel × its size value / per parcel lost off the shelf. */
  parcelSpawnShare: number
  parcelLostEach: number
  pips: Partial<Record<StatId, number>>
  mod: Record<ModifierKey, number>
}

export interface EventPolicyDef {
  weights: EventPolicyWeightsDef
  evBand: [number, number]
  evMax: number
  nonDefaultShareMin: number
}

export interface EventsData {
  schedule: EventScheduleDef
  categories: Record<EventCategoryId, EventCategoryDef>
  modifiers: EventModifiersDef
  policy: EventPolicyDef
  deck: EventDef[]
}

// map.json ------------------------------------------------------------------

/** A run of tiles on one avenue line: axis 'x' = the column x = at, rows from..to; axis 'y' = the row y = at, columns from..to (inclusive). */
export interface MapSegment {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

/** One-sided avenue drawn with a themed edge overlay (spec §3.1); stays routable. */
export interface ThemedRoadDef extends MapSegment {
  id: 'quay' | 'beach_road' | 'promenade' | 'seafront'
  /** Overlay frame stem (style-guide.md §2.2), stamped over the road autotile. */
  frame: string
}

/** One of the 5x5 blocks. kind 'region': region = a districts.json id; 'lot': region = 'warehouse'; 'scenery': region = 'lake' | 'beach'. */
export interface MapBlockDef {
  block: XY
  kind: 'region' | 'lot' | 'scenery'
  region: string
  /** Base ground frame stem (style-guide.md §2.2). */
  ground: string
  /** Scattered accent frame stem, or null (see MapGroundDef.accentEvery). */
  accent: string | null
}

export interface SceneryRuleDef {
  name: string
  rect: Rect
  frame: string
  /** M9: the district whose lock state fogs these tiles (drawn _locked while it is locked); absent = never fogged. */
  region?: DistrictId
}

export interface MapGroundDef {
  /** Base stamped under road tiles (the road autotile covers it). */
  road: string
  /** Frame for a non-block, non-road tile no scenery rule matches. */
  default: string
  /** A block tile uses its accent when (x + 2y) % accentEvery === 0. */
  accentEvery: number
  lot: { parking: string; queue: string }
  /** Non-block, non-road tiles (map edges, trimmed avenue tiles): first matching rect wins. */
  scenery: SceneryRuleDef[]
}

export interface LotDef {
  /** Road tile where vehicles leave the graph for the lot (spec §3.1). */
  entrance: XY
  /** Dock bay tiles, dock1..dock3 in order. */
  docks: XY[]
  /** Queue positions, position 0 nearest the docks. */
  queue: XY[]
  parking: XY[]
  /** The "days since last incident" sign tile. */
  sign: XY
  warehouse: { tile: XY; footprint: WH }
}

export interface RegionDef {
  /** 'warehouse' or a districts.json id; order = chip order. */
  id: string
  /** Palette colour id from art/palette.json (style-guide.md §1.8), e.g. 'orange2'. */
  colour: string
  chipLabel: string
  /** Label / locked-sign tile: the blocks' centroid moved off roads and footprints. */
  labelTile: XY
}

export interface PropDef {
  /** Frame stem (style-guide.md §2.4/§2.5). */
  frame: string
  tile: XY
  /** District id (drawn _locked while locked), 'warehouse', or a scenery name. */
  region: string
}

export interface MapBuildingDef {
  /** Door tile offset from BuildingDef.tile: the footprint tile nearest the anchor. */
  doorOffset: XY
}

/**
 * M8 (design-m8-m9 §1.2): the render facts of one overseas hub — the
 * clearance ring's building and the vessel that departs on `hub:departure`.
 * districts.json keeps the sim numbers (clearanceS, valueMult, sizes).
 */
export interface MapHubDef {
  /** An OverseasDistrictDef id. */
  district: DistrictId
  /** A building of that district: the clearance ring anchor (the port office / terminal). */
  office: BuildingId
  vessel: {
    /** Frame stem of the vessel prop (equals one map.props row of the hub). */
    frame: string
    /** The prop's tile (its map.props row). */
    tile: XY
    /** Tile delta the vessel travels to leave the map (not both 0). */
    exit: XY
    /** Screen px the vessel climbs while leaving (0 for a ship). */
    liftPx: number
  }
}

export interface MapData {
  size: WH
  /** Avenue line coordinates (both axes); lines span avenues[0]..avenues[last]. */
  avenues: number[]
  /** Avenue tiles omitted from the road graph and never drawn (spec §3.1). */
  trimmed: MapSegment[]
  themedRoads: ThemedRoadDef[]
  blocks: MapBlockDef[]
  ground: MapGroundDef
  lot: LotDef
  regions: RegionDef[]
  props: PropDef[]
  /** M8: one row per overseas hub (districts.json order not required; render order). */
  hubs: MapHubDef[]
  buildings: Record<BuildingId, MapBuildingDef>
  lockedStyle: 'frames' | 'fill'
}

// GameData ------------------------------------------------------------------

export interface GameData {
  districts: DistrictDef[]
  buildings: BuildingDef[]
  vehicles: VehiclesData
  machines: MachinesData
  employees: EmployeesData
  parcels: ParcelsData
  economy: EconomyData
  levels: LevelDef[]
  /** M7 (spec-build2 §3, §9). */
  quests: QuestsData
  /** Build 3 (spec-build3 §3, §7): the event deck, its schedule and the policy weights. */
  events: EventsData
  puns: PunsData
  map: MapData
  /** dataHash of the (config-merged) raw tables; saves store it (plan.md §6.4). */
  hash: string
}

export type DataFileName = Exclude<keyof GameData, 'hash'>

/** The parsed JSON files keyed by file stem, before validation. */
export type RawGameData = Record<DataFileName, unknown>
