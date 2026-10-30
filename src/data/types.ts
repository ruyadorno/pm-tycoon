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
  puns: PunsData
  map: MapData
  /** dataHash of the (config-merged) raw tables; saves store it (plan.md §6.4). */
  hash: string
}

export type DataFileName = Exclude<keyof GameData, 'hash'>

/** The parsed JSON files keyed by file stem, before validation. */
export type RawGameData = Record<DataFileName, unknown>
