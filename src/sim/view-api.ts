// The ViewSim facade (plan.md §5): the only object scenes touch. Read-only
// fields and queries derive from sim.state; every command builds a Command
// and goes through Sim.dispatch, returning its result. Nothing here mutates
// state directly (the `debug` helpers are commands too, so replays stay
// exact). The pure §6.3 readouts live in detection.ts and are re-exported
// here with their M0 signatures.

import type {
  BuildingDef,
  EventCategoryId,
  EventEffect,
  EventKind,
  GameData,
  MapData,
  ModifierKey,
} from '../data/types.ts'
import type { CommandResult } from './commands.ts'
import {
  announcedStrains,
  laneCatchRate,
  laneRatePerMin,
  machineChecker,
} from './detection.ts'
import type { StallReason } from './events.ts'
import { SIM_FEATURES } from './features.ts'
import { isLive, modMult, priceOf } from './modifiers.ts'
import type { Sim } from './sim.ts'
import {
  cardOptions,
  cardTitle,
  DECK_OFF_TICK,
  eventDef,
  fillCardText,
  optionLines,
} from './systems/deck.ts'
import type { EffectLine } from './systems/effects.ts'
import { effectSummary, modifierLine } from './systems/effects.ts'
import type {
  Affinity,
  Applicant,
  Building,
  BuildingId,
  CardRefs,
  DistrictId,
  Employee,
  EventRecord,
  HireTarget,
  LaneNode,
  LoadingDock,
  Modifier,
  OpenCard,
  Parcel,
  Pips,
  Quest,
  QuestGoalKind,
  QuestRecord,
  Role,
  SimState,
  Size,
  Strain,
  Tick,
  TilePos,
  VehicleState,
  VehicleType,
  Zone,
} from './types.ts'
import {
  laneNode,
  meanSatisfaction,
  TICKS_PER_DAY,
  TICKS_PER_S,
  ticksFromS,
} from './types.ts'
import { clearanceTicks, clearingParcels, hubDef } from './systems/hubs.ts'
import { holdBays } from './systems/lane.ts'
import { liveMagicParcel } from './systems/magic.ts'
import { payrollDuePerDay, ticksToPayday } from './systems/payroll.ts'
import {
  deskNodeOf,
  driverNumbers,
  effectiveP,
  hireFeeOf,
  inspectorNumbers,
  salaryOf,
  sorterNumbers,
  starDaysLeft,
} from './systems/people.ts'
import {
  questFlavour,
  questLimitTicks,
  questName,
  questProgress01,
  questTicksLeft,
  ultimatePending,
} from './systems/quests.ts'
import { valueAt } from './value.ts'

export {
  activeCheckers,
  activeStrains,
  checkerP,
  laneCatchRate,
  laneRatePerMin,
} from './detection.ts'
/** M7: the sim's single quest-text formatters (UI text uses these). */
export {
  questFlavour,
  questName,
  questValue,
  rewardSummary,
} from './systems/quests.ts'

/** What the city view reads per frame (city-view.md §2). */
export interface VehicleSnapshot {
  id: number
  type: VehicleType
  name: string
  /** The active driver's name, else null (walked out, fired, none: `No driver`). */
  driverName: string | null
  /** M6: the driver's Employee id (active or walked out), null with none. */
  driverId: number | null
  driverPips: Pips | null
  driverStar: boolean
  driverAffinity: Affinity | null
  /** M6: the Replace driver taking over after this trip, else null. */
  nextDriverName: string | null
  state: VehicleState
  /** Tile position at the start / end of the last tick; lerp by the stepper alpha. */
  prev: TilePos
  cur: TilePos
  /** Lower-case for frame names (bike_ne_0). */
  heading: 'ne' | 'se' | 'sw' | 'nw'
  wheel: 0 | 1
  /** Building of the stop the vehicle is standing at, else null. */
  stopAt: BuildingId | null
  cargo: { id: number; size: Size; destId: BuildingId }[]
  /** 0-based place in the dock queue while queued, else null. */
  queuePos: number | null
  dockId: string | null
  zone: Zone
  /** Driver marked unpaid at the last payday (§7.4). */
  unpaid: boolean
  rushBuildingId: BuildingId | null
  /** ADDITION (M1): delivery stops left incl. the current one (follow strip "Delivering · N stops"); 0 otherwise. */
  stopsLeft: number
  /** ADDITION (M1): capacity units aboard / of the type (§4.1). */
  unitsUsed: number
  capacityUnits: number
  /** B3 §3.6: the price paid (0 for a gift). */
  purchasePrice: number
}

/** buildingAt() result: the static row + the dynamic part. */
export interface BuildingInfo {
  id: BuildingId
  def: BuildingDef
  state: Building
  /** The building's district is live (tappable, spawns, receives). */
  live: boolean
}

export type Trend = 'up' | 'down' | 'flat'

/** districtStats() (city-view.md §5.1). */
export interface DistrictStats {
  id: DistrictId
  kind: 'district' | 'overseas'
  locked: boolean
  unlockLevel: number
  satisfaction: number
  /** Δ since the last day boundary: ▲ ≥ +3, ▼ ≤ −3 (spec §9.2). */
  trend: Trend
  trendDelta: number
  /** $ paid for parcels delivered to this district. */
  earned: number
  waiting: Record<Size, number>
  waitingCount: number
  waitingBuildings: number
  /** Age of the oldest waiting parcel in sim seconds, or null. */
  oldestWaitingS: number | null
  vehiclesHomed: number
}

/** One strain's lane catch rate (spec §6.3). */
export interface StrainDetection {
  strain: Strain
  /** D(s) = 1 − Π(1 − p_i(s)) over live slots with ≥ 1 station, 0..1. */
  d: number
  /** parcels.json strains[].counter (a machines.json id). */
  counter: string
}

export interface LaneStats {
  ratePerMin: number
  /** round(100 × mean over announced strains of D(s)). */
  detectionPct: number
  byStrain: { strain: Strain; pct: number; counter: string }[]
  stalled: { reason: StallReason; nodeId: string } | null
  /**
   * ADDITION (M2): the counter machine for the weakest announced strain
   * (spec §6.3 "tap → per-strain list with the counter machine suggested for
   * the weakest strain"): its strain and current %, the machine
   * (parcels.json strains[].counter), whether the lane already holds one,
   * and the % with one more of it. Null with no announced strain.
   */
  suggest: {
    strain: Strain
    pct: number
    counter: string
    owned: boolean
    withCounterPct: number
  } | null
}

export interface PayrollView {
  /** Sum of active employees' daily salaries. */
  perDay: number
  /** The last payday left someone unpaid. */
  short: boolean
  inspectors: number
  /** M6: active sorters (0 or 1). */
  sorters: number
  drivers: number
}

/** M6: role-specific numbers of a person (absent keys do not apply). */
export interface StatNumbers {
  /** Inspector: own p, effective p at its desk now (pEff), false-flag rate, process seconds. */
  p?: number
  pEff?: number
  decoyFlag?: number
  processS?: number
  /** Sorter: correct-call chance, seconds per call. */
  correct?: number
  decisionS?: number
  /** Driver (for a vehicle type): × speed, × stop time, + satisfaction per delivery / pickup. */
  speedMult?: number
  stopMult?: number
  deliveryBonus?: number
  pickupBonus?: number
}

/** M6: one HireSheet card. */
export interface ApplicantView {
  id: number
  role: Role
  name: string
  look: number
  star: boolean
  pips: Pips
  affinity: Affinity
  /** A driver's: for the vehicleType passed to applicants() (default 'bike'). */
  salaryPerDay: number
  /** 0 for ★. */
  hireFee: number
  numbers: StatNumbers
  /** ★: days until they leave (≥ 0); regulars null. */
  leavesInDays: number | null
}

/** M6: one employee (SlotCard rows, StationCard, Garage rows). */
export interface PersonView {
  id: number
  role: Role
  name: string
  look: number
  star: boolean
  pips: Pips
  affinity: Affinity
  active: boolean
  unpaid: boolean
  salaryPerDay: number
  hiredTick: Tick
  nodeId: string | null
  vehicleId: number | null
  /** Driver queued to take over vehicleId after its trip (a Replace). */
  pending: boolean
  numbers: StatNumbers
}

/** M6: the Hold Bay station (sorter / Sorter Arm). */
export interface HoldStationView {
  readonly unlockLevel: number
  readonly unlocked: boolean
  readonly kind: 'sorter' | 'sorter_arm' | null
  /** The seated sorter, active or walked out. */
  readonly sorter: PersonView | null
  /** A sorter call is running (nextDecisionTick set): the scan animation. */
  readonly working: boolean
}

/**
 * One Hold Bay item. bay = 0-based rack position, STABLE (M3): a held parcel
 * keeps the bay it arrived in until it leaves; a new arrival takes the lowest
 * free bay (so bays can have gaps and items are not sorted by bay).
 */
export interface HoldBayItem {
  parcelId: number
  bay: number
  /** ADDITION (M2): the trait it was flagged on (parcel.flaggedStrain). */
  strain: Strain | null
  /**
   * ADDITION (M2): the flagging checker's name ("Metal detector",
   * "Inspection desk") and the slot it flagged in, from the parcel's
   * 'flagged' trace entry — still right after the fixture moved or left.
   */
  checkerName: string | null
  nodeId: string | null
  /** M6: the inspector who flagged it (the flag entry's `who`), else null. */
  inspectorName: string | null
  /** M6: the sorter's `looks clean` tag, else null. */
  sorted: { name: string; pct: number } | null
}

export interface HoldBayView {
  /** Held parcels in arrival order; `bay` = the stable 0-based rack position. */
  readonly items: readonly HoldBayItem[]
  readonly cap: number
  readonly count: number
  toss(parcelId: number): CommandResult
  clear(parcelId: number): CommandResult
  /** M6: the player looked at it (the HoldBayCard opened): the sorter waits (design D3). */
  touch(parcelId: number): CommandResult
}

/** M8 (design-m8-m9 §3.3): one parcel clearing at an overseas hub. */
export interface HubClearing {
  parcelId: number
  /** The pier / terminal it was handed off at (p.dest). */
  buildingId: BuildingId
  size: Size
  /** clearTick − ticksFromS(hub.clearanceS). */
  handOffTick: Tick
  clearTick: Tick
  lockedValue: number
}

/** M8: an overseas hub as the city / HUD read it (map.hubs row + districts.json + state). */
export interface HubView {
  id: DistrictId
  live: boolean
  /** map.hubs office: the building the clearance ring sits on. */
  office: BuildingId
  clearanceS: number
  valueMult: number
  sizes: Size[]
  /** Parcels handed off and not yet cleared: clearTick asc, then parcelId. */
  clearing: readonly HubClearing[]
  /** District.earned: $ paid by this hub's clearances. */
  earned: number
}

/** M8: one loading dock slot (dock 1 + the economy.docks rows) for the room and the buy dialog. */
export interface DockSlotView {
  index: 1 | 2 | 3
  dockId: string
  owned: boolean
  /** Dock 1: 1. */
  unlockLevel: number
  /** Dock 1: 0. */
  price: number
  /** owned || level ≥ unlockLevel. */
  available: boolean
}

export interface LaneView {
  /** Every node incl. locked ones, in state order (flow order = next edges). */
  nodes(): readonly LaneNode[]
  /** Parcels per minute (spec §6.3). */
  rate(): number
  detection(): StrainDetection[]
  /**
   * Build 3 (critique 27): the lane's compounded catch rate vs `strain` —
   * announced or not — with the machineP modifier folded in (the number
   * detection(), the laneRateAtLeast condition and the roll agree on).
   */
  catchRate(strain: Strain): number
  readonly stalled: { reason: StallReason; nodeId: string } | null
  /** A checker into a slot, or (M6) 'sorter_arm' into the Hold Bay node ('hold'). */
  buyMachine(defId: string, nodeId: string): CommandResult
  /** M6: index = employees.json desks.rows index (1 = the start desk). */
  placeDesk(nodeId: string, index: number): CommandResult
  moveFixture(from: string, to: string): CommandResult
  removeFixture(nodeId: string): CommandResult
  rehire(employeeId: number): CommandResult
  /** M8: buy loading dock `index` (2 at L3, 3 at L4). */
  buyDock(index: number): CommandResult
  /** M8: dock 1 and every economy.docks row, by index. */
  dockSlots(): readonly DockSlotView[]
}

/**
 * M7 (design-m7 §3.8): a quest slot as the UI reads it — the state object's
 * fields (shared, read-only) plus derived ones.
 */
export interface QuestView extends Quest {
  /** Template name (or puns.ultimateQuestName). */
  name: string
  /** puns.quests line with `{district}` filled. */
  flavour: string
  kind: QuestGoalKind
  /** 0..1 (design-m7 §3.3); 0 for an offer. */
  progress01: number
  /** Offer: until it expires (null: the ultimate); active: until the deadline. */
  ticksLeft: number | null
  /** The time the quest gives (limitDays, the magic countdown, the ultimate's days). */
  limitTicks: number
  /** The target district's flavour name, or null. */
  targetName: string | null
  /** The magic parcel's A → B once accepted, else null. */
  route: { origin: BuildingId; dest: BuildingId } | null
}

export interface QuestsView {
  offer: QuestView | null
  active: QuestView | null
  history: readonly QuestRecord[]
  vouchers: readonly string[]
  /**
   * Build 3 (D-17, critique 19): ticks until the next draw that may bring a
   * job card — max(quests.jobReadyTick, events.nextDrawTick) − tick — while
   * jobs can come (quests on, not game over, both slots empty, the Golden
   * Release not pending) and the deck draws; null otherwise. A draw is a job
   * with probability jobShare, so a job comes at that draw or a later one.
   */
  nextOfferInTicks: number | null
  victory: boolean
  /** stats.victoryTick (the VictoryCard input). */
  victoryTick: Tick | null
  /**
   * The golden parcel still on its way, or null — outlives a failed or
   * abandoned Special delivery (B2 §3.3: the city marks A and B "while it is
   * alive").
   */
  magic: { parcelId: number; origin: BuildingId; dest: BuildingId } | null
}

export interface QuestActions {
  accept(questId: string): CommandResult
  decline(questId: string): CommandResult
  abandon(): CommandResult
}

// Build 3 events (spec-build3 §6; M11 contract §3 stream E) ------------------------

/** One visible option of the open card. */
export interface EventOptionView {
  index: number
  label: string
  lines: readonly EffectLine[]
  cost: number
  default: boolean
  danger: boolean
  affordable: boolean
  /** eventWords.cantAfford when the option is not affordable, else null. */
  reason: string | null
}

/** The open card as the EventCard draws it. */
export interface OpenCardView {
  eventId: string
  kind: EventKind
  category: EventCategoryId
  /** events.json categories: the masthead word (`STAFF`, `JOB BOARD`). */
  word: string
  /** The category picture frame (`ev_pic_staff`). */
  picture: string
  /** Filled; a job card: its quest's name. */
  title: string
  /** Filled; a job card: its quest's flavour (puns.quests, `{district}` filled). */
  body: string
  /** The HUD's `Day N` the card opened on (completed days + 1). */
  day: number
  /**
   * The tick the card opened (OpenCard.openedTick). With eventId it tells two
   * cards apart: back-to-back job cards share `job:<templateId>` (M12
   * critique 18).
   */
  openedTick: Tick
  /** A link: `You chose: {option}` (eventWords.youChose) of its parent; else null. */
  parentChoice: string | null
  /**
   * A link (depth ≥ 2): its chain head's filled title — what the sim's
   * `chainDone` ticker names (`Protection — the story ends`); null for a head,
   * a single and a job card (M12 critique 6).
   */
  chainTitle: string | null
  questId: string | null
  /** The visible options only (an `if` that fails hides one), in data order. */
  options: readonly EventOptionView[]
}

/** A live modifier as the EffectsCard lists it. */
export interface ModifierView {
  id: string
  key: ModifierKey
  /** The sim's words for it, no duration (effects.ts modifierLine: `bikes ×0.85 speed`). */
  line: string
  /** null = permanent. */
  untilTick: Tick | null
  ticksLeft: number | null
  eventId: string
  /** The setting card's title. */
  label: string
}

/** The deck as the HUD reads it (ViewSim.events()). */
export interface EventsView {
  open: OpenCardView | null
  /** Cards waiting behind the open one (events.queue). */
  queue: number
  /** Chain links booked and not yet due. */
  scheduledCount: number
  /** Ticks to the next automatic card: the earliest due link or the next draw (null: none). */
  nextDueTicks: number | null
  /** Newest last. */
  history: readonly EventRecord[]
  /** The live modifiers, newest first. */
  modifiers: readonly ModifierView[]
}

/** B3 §6: the card actions (one command each). */
export interface EventActions {
  /** decideEvent {eventId, option} — `option` is the index in the card's data order (EventOptionView.index). */
  decide(eventId: string, option: number): CommandResult
}

/**
 * Debug-build helpers for shots / tests (each dispatches a debug command):
 * forceFlagNext — the next checker roll flags its parcel on `strain`;
 * fillHoldBay — every free bay gets a freshly flagged parcel (malware and
 * decoys in turn), so the next flag stalls the lane; forceMalwareDelivery —
 * a malware parcel is delivered now (life:lost with a full card payload).
 */
export interface ViewSimDebug {
  forceFlagNext(strain: Strain): CommandResult
  fillHoldBay(): CommandResult
  forceMalwareDelivery(): CommandResult
  /** M6: level up to `level` now (past the playtest cap; shots and tests). */
  forceLevel(level: number): CommandResult
  /** M7: offer this quest template (or the ultimate id) now (`?quest=`). */
  offerQuest(templateId: string): CommandResult
  /** M8: hand a malware parcel off at a live hub now (a life at clearance). */
  forceOverseasMalware(hub: DistrictId): CommandResult
  /** Build 3: open (or queue) this deck card now, ignoring its rules (`?event=`). */
  offerEvent(eventId: string): CommandResult
}

export interface ViewSim {
  /** Static tables (prices, names, thresholds) for labels. */
  readonly data: GameData
  readonly map: MapData
  readonly vehicles: readonly VehicleSnapshot[]
  readonly money: number
  readonly lifetimeEarned: number
  readonly level: number
  /** levels.json threshold the level bar counts toward (keeps the L3 row at the playtest cap). */
  readonly nextThreshold: number | null
  readonly lives: number
  readonly gameOver: boolean
  /**
   * Build 3 (B3 §6): Sim.held — a card is open, no policy is attached and the
   * game is not over, so tick() does nothing (the browser stepper skips the
   * frame: M11 review deck-2). The HUD reads it for the speed button / ticker
   * while a card waits behind a sheet or a paper (M12 critique 4).
   */
  readonly held: boolean
  readonly tick: Tick
  /** Completed in-game days (HUD "Day N" = day + 1). */
  readonly day: number
  /** 0..1 within the current day. */
  readonly dayProgress: number
  readonly ticksToPayday: number
  readonly holdBay: HoldBayView
  readonly lane: LaneView
  readonly shelf: { readonly ids: readonly number[]; readonly cap: number }
  readonly quarantine: { count: number; malware: number; clean: number }
  readonly docks: readonly LoadingDock[]
  readonly daysSinceIncident: number
  /**
   * Build 3 (B3 §6): the open card, the queue, links, history and live
   * modifiers (cached per sim revision).
   */
  events(): EventsView
  /** Build 3: answer the open card. */
  readonly event: EventActions
  /** Build 3: the sim's words for a list of effects (what an option does now). */
  effectSummary(
    effects: readonly EventEffect[],
    card: CardRefs & { eventId: string; title: string },
  ): readonly EffectLine[]
  /** Build 3: a live modifier in the sim's words (`bikes ×0.85 speed`). */
  modifierSummary(m: Modifier): string
  /** Build 3: what a vehicle / machine costs now (list price × vehiclePrice / machinePrice modifiers). */
  priceOf(kind: 'vehicle' | 'machine', listPrice: number): number
  regionState(id: string): 'locked' | 'live'
  buildingAt(tx: number, ty: number): BuildingInfo | null
  waitingAt(buildingId: BuildingId): readonly Parcel[]
  /** Active rush flag; `vehicleId` = the vehicle sent (null while none is eligible, §4.1). */
  rushState(
    buildingId: BuildingId,
  ): { untilTick: Tick; vehicleId: number | null } | null
  /** ADDITION (M1): one parcel by id (hidden flags included — never show them), or null. */
  parcel(id: number): Parcel | null
  /** ADDITION (M1): what the parcel would pay now, round(base × f(t)) (spec §5.3), or null. */
  parcelValue(id: number): number | null
  /** ADDITION (M1): vehicle ids in the lot's dock queue, index 0 docks next. */
  readonly dockQueue: readonly number[]
  districtStats(id: DistrictId): DistrictStats | null
  meanSatisfaction(): number
  laneStats(): LaneStats
  payroll(): PayrollView
  /** M6: today's applicants of a role (a driver's salary / numbers for `vehicleType`, default bike). */
  applicants(role: Role, vehicleType?: VehicleType): readonly ApplicantView[]
  /** M6: every employee, in state order. */
  people(): readonly PersonView[]
  /** M6: malware labels revealed so far (the poster). */
  readonly wanted: readonly string[]
  readonly holdStation: HoldStationView
  hire(role: Role, applicantId: number, target: HireTarget): CommandResult
  fire(employeeId: number): CommandResult
  postAd(role: Role): CommandResult
  rush(buildingId: BuildingId): CommandResult
  /** M6: applicantId = the picked driver, null = "Hire later" (parks `No driver`). */
  buyVehicle(type: VehicleType, applicantId: number | null): CommandResult
  sellVehicle(id: number): CommandResult
  setHomeZone(id: number, zone: Zone): CommandResult
  /** Re-hire the walked-out driver of vehicle `id` ('no-vehicle' if none). */
  rehireDriver(id: number): CommandResult
  /** economy.continueWithOneLife (playtest flag) after game over. */
  grantLife(): CommandResult
  /** M7: the quest slots, history and vouchers (cached per sim revision). */
  quests(): QuestsView
  readonly quest: QuestActions
  /** M7: the Golden Release is done (economy.victory). */
  readonly victory: boolean
  /** M8: every map.hubs row in order, live or not (cached per sim revision). */
  hubs(): readonly HubView[]
  /** M8: one hub by district id, or null (not a map.hubs row). */
  hub(id: DistrictId): HubView | null
  /** Present only with `{debug: true}`. */
  readonly debug: ViewSimDebug | null
}

export interface ViewSimOptions {
  debug?: boolean
}

// The facade ----------------------------------------------------------------------

const TREND_STEP = 3 // spec §9.2 trend arrow (▲ ≥ +3, ▼ ≤ −3), a display rule
const HEADINGS = { NE: 'ne', SE: 'se', SW: 'sw', NW: 'nw' } as const

/** The per-frame vehicle snapshots (city-view.md §2). */
function snapshotVehicles(sim: Sim): VehicleSnapshot[] {
  const s = sim.state
  return s.vehicles.map((v) => {
    const driver = s.employees.find((e) => e.id === v.driverId) ?? null
    const next = s.employees.find((e) => e.id === v.nextDriverId) ?? null
    const stopped =
      v.waitUntilTick !== null &&
      (v.state === 'delivering' || v.state === 'collecting')
    const qi = s.lane.dockQueue.indexOf(v.id)
    return {
      id: v.id,
      type: v.type,
      name: v.name,
      driverName: driver && driver.active ? driver.name : null,
      driverId: driver ? driver.id : null,
      driverPips: driver ? { ...driver.pips } : null,
      driverStar: driver?.star ?? false,
      driverAffinity: driver ? driver.affinity : null,
      nextDriverName: next ? next.name : null,
      state: v.state,
      prev: { ...v.prev },
      cur: { ...v.pos },
      heading: HEADINGS[v.heading],
      wheel: v.wheel,
      stopAt: stopped ? (v.stops[v.stopIndex]?.buildingId ?? null) : null,
      cargo: v.cargo.flatMap((id) => {
        const p = s.parcels[String(id)]
        return p ? [{ id, size: p.size, destId: p.dest }] : []
      }),
      queuePos: v.state === 'queued' && qi >= 0 ? qi : null,
      dockId: v.dockId,
      zone: v.zone,
      unpaid: (driver?.unpaidPaydays ?? 0) > 0,
      rushBuildingId: v.rushBuildingId,
      stopsLeft:
        v.state === 'delivering'
          ? Math.max(0, v.stops.length - v.stopIndex)
          : 0,
      unitsUsed: v.unitsUsed,
      capacityUnits:
        sim.data.vehicles.types.find((t) => t.id === v.type)?.capacityUnits ??
        0,
      purchasePrice: v.purchasePrice,
    }
  })
}

/** Role-specific numbers of a pips set (people.ts tables). */
function numbersOf(
  data: GameData,
  role: Role,
  pips: Pips,
  affinity: Affinity,
  type: VehicleType,
): StatNumbers {
  if (role === 'inspector') {
    const n = inspectorNumbers(data, pips)
    return {
      p: n.p,
      pEff: n.p,
      decoyFlag: n.decoyFlag,
      processS: n.processTicks / TICKS_PER_S,
    }
  }
  if (role === 'sorter') {
    const n = sorterNumbers(data, pips)
    return { correct: n.correct, decisionS: n.decisionTicks / TICKS_PER_S }
  }
  return driverNumbers(data, pips, affinity, type)
}

function applicantView(
  sim: Sim,
  a: Applicant,
  type: VehicleType,
): ApplicantView {
  const data = sim.data
  const t = a.role === 'driver' ? type : undefined
  return {
    id: a.id,
    role: a.role,
    name: a.name,
    look: a.look,
    star: a.star,
    pips: { ...a.pips },
    affinity: a.affinity,
    salaryPerDay: salaryOf(data, a.role, a.pips, t),
    hireFee: hireFeeOf(data, a, t),
    numbers: numbersOf(data, a.role, a.pips, a.affinity, type),
    leavesInDays:
      a.leavesOnDay === null
        ? null
        : starDaysLeft(a.leavesOnDay, sim.state.tick),
  }
}

function questView(sim: Sim, q: Quest): QuestView {
  const data = sim.data
  const pr = q.progress
  return {
    ...q,
    name: questName(data, q.templateId),
    flavour: questFlavour(data, q),
    kind: pr.kind,
    progress01: questProgress01(sim, q),
    ticksLeft: questTicksLeft(sim, q),
    limitTicks: questLimitTicks(data, q),
    targetName:
      q.target === null
        ? null
        : (data.districts.find((d) => d.id === q.target)?.flavour ?? null),
    route:
      pr.kind === 'magicParcel' && pr.origin !== null && pr.dest !== null
        ? { origin: pr.origin, dest: pr.dest }
        : null,
  }
}

function questsView(sim: Sim): QuestsView {
  const s = sim.state
  const qs = s.quests
  return {
    offer: qs.offer === null ? null : questView(sim, qs.offer),
    active: qs.active === null ? null : questView(sim, qs.active),
    history: qs.history,
    vouchers: qs.vouchers,
    nextOfferInTicks: nextOfferIn(sim),
    victory: s.economy.victory,
    victoryTick: s.stats.victoryTick,
    magic: magicOf(s),
  }
}

/**
 * QuestsView.nextOfferInTicks (D-17, critique 19): while a job may come —
 * quests on, not game over, both slots empty, the Golden Release not
 * pending — and the deck draws, the ticks to the first draw at or after
 * quests.jobReadyTick; null otherwise.
 */
function nextOfferIn(sim: Sim): number | null {
  const s = sim.state
  const qs = s.quests
  const ev = s.events
  const open =
    SIM_FEATURES.quests &&
    !s.economy.gameOver &&
    qs.offer === null &&
    qs.active === null &&
    !ultimatePending(sim)
  if (!open || ev.nextDrawTick >= DECK_OFF_TICK) return null
  return Math.max(0, Math.max(qs.jobReadyTick, ev.nextDrawTick) - s.tick)
}

/**
 * A link's chain-head title as decideEvent's `chainDone` ticker fills it
 * (the head's title with the link's refs, else the card's own); null for a
 * head, a single or a job card.
 */
function chainTitleOf(data: GameData, card: OpenCard): string | null {
  if (card.kind === 'job' || card.depth < 2) return null
  const head = eventDef(data, card.chainHeadId ?? card.eventId)
  return head === null
    ? cardTitle(data, card)
    : fillCardText(data, head.title, card)
}

/** The open card as the EventCard reads it (B3 §3.4, §6). */
function openCardView(sim: Sim, card: OpenCard): OpenCardView {
  const data = sim.data
  const words = data.puns.eventWords
  const cat = data.events.categories[card.category]
  const offer = sim.state.quests.offer
  const job =
    card.kind === 'job' && offer !== null && offer.id === card.questId
      ? offer
      : null
  const def = job === null ? eventDef(data, card.eventId) : null
  return {
    eventId: card.eventId,
    kind: card.kind,
    category: card.category,
    word: cat?.word ?? card.category.toUpperCase(),
    picture: cat?.picture ?? '',
    title: cardTitle(data, card),
    body:
      job !== null
        ? questFlavour(data, job)
        : fillCardText(data, def?.body ?? '', card),
    day: Math.floor(Math.max(0, card.openedTick) / TICKS_PER_DAY) + 1,
    openedTick: card.openedTick,
    parentChoice:
      card.parentChoice === null
        ? null
        : words.youChose.replaceAll('{option}', card.parentChoice),
    chainTitle: chainTitleOf(data, card),
    questId: card.questId,
    options: cardOptions(sim, card)
      .filter((o) => o.visible)
      .map((o) => ({
        index: o.index,
        label: o.label,
        lines: optionLines(sim, card, o),
        cost: o.cost,
        default: o.default,
        danger: o.danger,
        affordable: o.affordable,
        reason: o.affordable ? null : words.cantAfford,
      })),
  }
}

/** ViewSim.events(): the open card, the queue, links, history, live modifiers (newest first). */
function eventsView(sim: Sim): EventsView {
  const s = sim.state
  const ev = s.events
  let due = Infinity
  for (const l of ev.scheduled) due = Math.min(due, l.dueTick)
  if (ev.nextDrawTick < DECK_OFF_TICK) due = Math.min(due, ev.nextDrawTick)
  const modifiers: ModifierView[] = []
  for (let i = s.modifiers.length - 1; i >= 0; i--) {
    const m = s.modifiers[i] as Modifier
    if (!isLive(m, s.tick)) continue
    modifiers.push({
      id: m.id,
      key: m.key,
      line: modifierLine(sim, m),
      untilTick: m.untilTick,
      ticksLeft:
        m.untilTick === null ? null : Math.max(0, m.untilTick - s.tick),
      eventId: m.eventId,
      label: m.label,
    })
  }
  return {
    open: ev.open === null ? null : openCardView(sim, ev.open),
    queue: ev.queue.length,
    scheduledCount: ev.scheduled.length,
    nextDueTicks: Number.isFinite(due) ? Math.max(0, due - s.tick) : null,
    history: ev.history,
    modifiers,
  }
}

function magicOf(s: SimState): QuestsView['magic'] {
  const p = liveMagicParcel(s)
  return p ? { parcelId: p.id, origin: p.origin, dest: p.dest } : null
}

/** M8: every map.hubs row (render order) with its districts.json numbers and the parcels clearing. */
function hubViews(sim: Sim): HubView[] {
  const s = sim.state
  const out: HubView[] = []
  for (const h of sim.data.map.hubs) {
    const def = hubDef(sim.data, h.district)
    if (!def) continue
    const ticks = ticksFromS(def.clearanceS)
    out.push({
      id: def.id,
      live: s.districts[def.id]?.live ?? false,
      office: h.office,
      // B3 §3.6: the readout follows a clearanceS modifier (scope: this hub).
      clearanceS: clearanceTicks(sim, def) / TICKS_PER_S,
      valueMult: def.valueMult,
      sizes: [...def.sizes],
      clearing: clearingParcels(s, def.id).map((p) => ({
        parcelId: p.id,
        buildingId: p.dest,
        size: p.size,
        // Stored at the hand-off since build 3 (a clearanceS modifier makes
        // `clearTick − clearanceS` lie); derived for older parcels.
        handOffTick: p.handOffTick ?? (p.clearTick ?? 0) - ticks,
        clearTick: p.clearTick ?? 0,
        lockedValue: p.lockedValue ?? 0,
      })),
      earned: s.districts[def.id]?.earned ?? 0,
    })
  }
  return out
}

/** M8: dock 1 (owned, free) and every economy.docks row, by index. */
function dockSlotViews(sim: Sim): DockSlotView[] {
  const s = sim.state
  const rows = [
    { index: 1, unlockLevel: 1, price: 0 },
    ...sim.data.economy.docks.filter((r) => r.index !== 1),
  ].toSorted((a, b) => a.index - b.index)
  return rows.map((r) => {
    const dockId = `dock${r.index}`
    const owned = s.lane.docks.some((d) => d.id === dockId)
    return {
      index: r.index as DockSlotView['index'],
      dockId,
      owned,
      unlockLevel: r.unlockLevel,
      price: r.price,
      available: owned || s.level.level >= r.unlockLevel,
    }
  })
}

function personView(sim: Sim, e: Employee): PersonView {
  const s = sim.state
  const data = sim.data
  const v =
    e.vehicleId === null
      ? null
      : (s.vehicles.find((x) => x.id === e.vehicleId) ?? null)
  const numbers = numbersOf(data, e.role, e.pips, e.affinity, v?.type ?? 'bike')
  if (e.role === 'inspector') {
    const desk = deskNodeOf(s, e.id)
    const st = desk?.stations.find((x) => x.employeeId === e.id)
    numbers.pEff = st?.p ?? effectiveP(data, e.pips, [])
  }
  return {
    id: e.id,
    role: e.role,
    name: e.name,
    look: e.look,
    star: e.star,
    pips: { ...e.pips },
    affinity: e.affinity,
    active: e.active,
    unpaid: e.unpaidPaydays > 0,
    salaryPerDay: e.salaryPerDay,
    hiredTick: e.hiredTick,
    nodeId: e.nodeId,
    vehicleId: e.vehicleId,
    pending: v !== null && v.nextDriverId === e.id,
    numbers,
  }
}

/**
 * Build the facade over a sim, or over a getter (so scenes keep one facade
 * across Sim.load / New game; event subscriptions are re-bound by
 * simBinding.ts either way).
 */
export function createViewSim(
  source: Sim | (() => Sim),
  opts: ViewSimOptions = {},
): ViewSim {
  const get = typeof source === 'function' ? source : () => source
  const st = () => get().state
  const run = (cmd: Parameters<Sim['dispatch']>[0]) => get().dispatch(cmd)

  let vCache: { sim: Sim; rev: number; list: VehicleSnapshot[] } | null = null
  let pCache: { sim: Sim; rev: number; list: PersonView[] } | null = null
  const aCache: Record<
    string,
    { sim: Sim; rev: number; list: ApplicantView[] }
  > = {}
  const people = (): PersonView[] => {
    const sim = get()
    if (!pCache || pCache.sim !== sim || pCache.rev !== sim.revision) {
      pCache = {
        sim,
        rev: sim.revision,
        list: sim.state.employees.map((e) => personView(sim, e)),
      }
    }
    return pCache.list
  }
  let qCache: { sim: Sim; rev: number; view: QuestsView } | null = null
  let hCache: { sim: Sim; rev: number; list: HubView[] } | null = null
  const hubs = (): HubView[] => {
    const sim = get()
    if (!hCache || hCache.sim !== sim || hCache.rev !== sim.revision) {
      hCache = { sim, rev: sim.revision, list: hubViews(sim) }
    }
    return hCache.list
  }
  let tileIndex: { data: GameData; idx: Int32Array; w: number } | null = null

  const node = (id: string): LaneNode | null => laneNode(st().lane, id)
  const stalled = () => {
    const l = st().lane
    return l.stalled && l.stallReason !== null && l.stallNodeId !== null
      ? { reason: l.stallReason, nodeId: l.stallNodeId }
      : null
  }
  const detection = (): StrainDetection[] => {
    const sim = get()
    return announcedStrains(sim.state, sim.data).map((strain) => ({
      strain,
      d: laneCatchRate(sim.state.lane, strain, [], sim),
      counter:
        sim.data.parcels.malware.strains.find((s) => s.id === strain)
          ?.counter ?? '',
    }))
  }

  const holdBay: HoldBayView = {
    get items() {
      const s = st()
      const hold = node(s.lane.holdBayNodeId)
      const q = hold?.queue ?? []
      const bays = hold ? holdBays(s, hold) : {}
      return q.map((parcelId, i): HoldBayItem => {
        const bay = bays[String(parcelId)] ?? i
        const p = s.parcels[String(parcelId)]
        const flagged = p?.trace.findLast((t) => t.what === 'flagged')
        // "Slot 1 Metal detector: flagged (metal)" → "Metal detector"
        const m = /^Slot \d+ (.+): flagged/.exec(flagged?.text ?? '')
        const who = flagged?.who ?? null
        return {
          parcelId,
          bay,
          strain: p?.flaggedStrain ?? null,
          checkerName: who !== null ? 'Inspection desk' : (m?.[1] ?? null),
          nodeId: flagged?.ref ?? null,
          inspectorName: who,
          sorted:
            p?.sorted && get().data.employees.roles.sorter.tagsClean
              ? { name: p.sorted.name, pct: p.sorted.pct }
              : null,
        }
      })
    },
    get cap() {
      return node(st().lane.holdBayNodeId)?.cap ?? st().level.holdBayCap
    },
    get count() {
      return node(st().lane.holdBayNodeId)?.queue.length ?? 0
    },
    toss: (parcelId) => run({ kind: 'toss', parcelId }),
    clear: (parcelId) => run({ kind: 'clear', parcelId }),
    touch: (parcelId) => run({ kind: 'touchHeld', parcelId }),
  }

  const lane: LaneView = {
    nodes: () => st().lane.nodes,
    rate: () => laneRatePerMin(st().lane, get().data, get()),
    detection,
    catchRate: (strain) => laneCatchRate(st().lane, strain, [], get()),
    get stalled() {
      return stalled()
    },
    buyMachine: (defId, nodeId) => run({ kind: 'buyMachine', defId, nodeId }),
    placeDesk: (nodeId, index) => run({ kind: 'placeDesk', nodeId, index }),
    moveFixture: (from, to) => run({ kind: 'moveFixture', from, to }),
    removeFixture: (nodeId) => run({ kind: 'removeFixture', nodeId }),
    rehire: (employeeId) => run({ kind: 'rehire', employeeId }),
    buyDock: (index) => run({ kind: 'buyDock', index }),
    dockSlots: () => dockSlotViews(get()),
  }

  const debug: ViewSimDebug | null = opts.debug
    ? {
        forceFlagNext: (strain) => run({ kind: 'debugForceFlag', strain }),
        fillHoldBay: () => run({ kind: 'debugFillHoldBay' }),
        forceMalwareDelivery: () => run({ kind: 'debugMalwareDelivery' }),
        forceLevel: (level) => run({ kind: 'debugForceLevel', level }),
        offerQuest: (templateId) =>
          run({ kind: 'debugOfferQuest', templateId }),
        forceOverseasMalware: (hub) =>
          run({ kind: 'debugOverseasMalware', hub }),
        offerEvent: (eventId) => run({ kind: 'debugOfferEvent', eventId }),
      }
    : null

  const event: EventActions = {
    decide: (eventId, option) => run({ kind: 'decideEvent', eventId, option }),
  }
  let eCache: { sim: Sim; rev: number; view: EventsView } | null = null

  const quest: QuestActions = {
    accept: (questId) => run({ kind: 'acceptQuest', questId }),
    decline: (questId) => run({ kind: 'declineQuest', questId }),
    abandon: () => run({ kind: 'abandonQuest' }),
  }

  const buildingIndex = (data: GameData) => {
    if (tileIndex && tileIndex.data === data) return tileIndex
    const [w, h] = data.map.size
    const idx = new Int32Array(w * h).fill(-1)
    data.buildings.forEach((b, i) => {
      const [x0, y0] = b.tile
      const [fw, fh] = b.footprint
      for (let y = y0; y < y0 + fh; y++) {
        for (let x = x0; x < x0 + fw; x++) {
          if (x >= 0 && y >= 0 && x < w && y < h) idx[y * w + x] = i
        }
      }
    })
    tileIndex = { data, idx, w }
    return tileIndex
  }

  return {
    get data() {
      return get().data
    },
    get map() {
      return get().data.map
    },
    get vehicles() {
      const sim = get()
      if (!vCache || vCache.sim !== sim || vCache.rev !== sim.revision) {
        vCache = { sim, rev: sim.revision, list: snapshotVehicles(sim) }
      }
      return vCache.list
    },
    get money() {
      return st().economy.balance
    },
    get lifetimeEarned() {
      return st().economy.lifetimeEarned
    },
    get level() {
      return st().level.level
    },
    get nextThreshold() {
      return st().level.nextThreshold
    },
    get lives() {
      return st().economy.lives
    },
    get gameOver() {
      return st().economy.gameOver
    },
    get held() {
      return get().held
    },
    get tick() {
      return st().tick
    },
    get day() {
      return st().day
    },
    get dayProgress() {
      return (st().tick % TICKS_PER_DAY) / TICKS_PER_DAY
    },
    get ticksToPayday() {
      const sim = get()
      return ticksToPayday(sim.state, sim.data)
    },
    holdBay,
    lane,
    get shelf() {
      const n = node(st().lane.shelfNodeId)
      return { ids: n?.queue ?? [], cap: n?.cap ?? st().level.shelfCap }
    },
    get quarantine() {
      return st().lane.quarantine
    },
    get docks() {
      return st().lane.docks
    },
    get daysSinceIncident() {
      return st().economy.daysSinceIncident
    },
    events(): EventsView {
      const sim = get()
      if (!eCache || eCache.sim !== sim || eCache.rev !== sim.revision) {
        eCache = { sim, rev: sim.revision, view: eventsView(sim) }
      }
      return eCache.view
    },
    event,
    effectSummary: (effects, card) => effectSummary(get(), effects, card),
    modifierSummary: (m) => modifierLine(get(), m),
    priceOf: (kind, listPrice) => priceOf(get(), kind, listPrice),

    regionState(id) {
      if (id === 'warehouse') return 'live'
      return st().districts[id]?.live ? 'live' : 'locked'
    },
    buildingAt(tx, ty) {
      const sim = get()
      const { idx, w } = buildingIndex(sim.data)
      const x = Math.floor(tx)
      const y = Math.floor(ty)
      if (x < 0 || y < 0 || x >= w || y * w + x >= idx.length) return null
      const def = sim.data.buildings[idx[y * w + x] ?? -1]
      const state = def ? sim.state.buildings[def.id] : undefined
      if (!def || !state) return null
      const live = sim.state.districts[def.district]?.live ?? false
      return { id: def.id, def, state, live }
    },
    waitingAt(buildingId) {
      const s = st()
      return (s.buildings[buildingId]?.waiting ?? []).flatMap((id) => {
        const p = s.parcels[String(id)]
        return p ? [p] : []
      })
    },
    rushState(buildingId) {
      const s = st()
      const until = s.buildings[buildingId]?.rushUntilTick ?? null
      if (until === null || until <= s.tick) return null
      const v = s.vehicles.find((x) => x.rushBuildingId === buildingId)
      return { untilTick: until, vehicleId: v ? v.id : null }
    },
    parcel(id) {
      return st().parcels[String(id)] ?? null
    },
    parcelValue(id) {
      const sim = get()
      const p = sim.state.parcels[String(id)]
      if (!p) return null
      // B3 §3.6: what a delivery would pay now (the income fold); an
      // overseas parcel's value is locked at the hand-off (income included).
      return (
        p.lockedValue ??
        Math.round(
          valueAt(sim.data, p, sim.state.tick) * modMult(sim, 'income'),
        )
      )
    },
    get dockQueue() {
      return st().lane.dockQueue
    },
    districtStats(id) {
      const sim = get()
      const s = sim.state
      const def = sim.data.districts.find((d) => d.id === id)
      const d = s.districts[id]
      if (!def || !d) return null
      const waiting: Record<Size, number> = { S: 0, M: 0, L: 0, XL: 0 }
      let count = 0
      let buildings = 0
      let oldest: Tick | null = null
      for (const b of sim.data.buildings) {
        if (b.district !== id) continue
        const ids = s.buildings[b.id]?.waiting ?? []
        if (ids.length > 0) buildings += 1
        for (const pid of ids) {
          const p = s.parcels[String(pid)]
          if (!p) continue
          waiting[p.size] += 1
          count += 1
          if (oldest === null || p.spawnedTick < oldest) oldest = p.spawnedTick
        }
      }
      const delta = d.satisfaction - d.satisfactionAtDayStart
      return {
        id,
        kind: def.kind,
        locked: !d.live,
        unlockLevel: def.unlockLevel,
        satisfaction: d.satisfaction,
        trend:
          delta >= TREND_STEP ? 'up' : delta <= -TREND_STEP ? 'down' : 'flat',
        trendDelta: delta,
        earned: d.earned,
        waiting,
        waitingCount: count,
        waitingBuildings: buildings,
        oldestWaitingS:
          oldest === null ? null : (s.tick - oldest) / TICKS_PER_S,
        vehiclesHomed: s.vehicles.filter((v) => v.zone === id).length,
      }
    },
    meanSatisfaction() {
      return meanSatisfaction(st(), get().data)
    },
    laneStats() {
      const sim = get()
      const byStrain = detection()
      const mean =
        byStrain.length === 0
          ? 0
          : byStrain.reduce((sum, x) => sum + x.d, 0) / byStrain.length
      // The weakest strain (first on ties, parcels.json order) and its counter.
      const weakest = byStrain.reduce<StrainDetection | null>(
        (w, x) => (w === null || x.d < w.d ? x : w),
        null,
      )
      const def = weakest
        ? sim.data.machines.checkers.find((c) => c.id === weakest.counter)
        : undefined
      const suggest =
        weakest && def
          ? {
              strain: weakest.strain,
              pct: Math.round(100 * weakest.d),
              counter: weakest.counter,
              owned: sim.state.lane.nodes.some(
                (n) => !n.locked && n.fixture?.checker.defId === def.id,
              ),
              withCounterPct: Math.round(
                100 *
                  laneCatchRate(
                    sim.state.lane,
                    weakest.strain,
                    [machineChecker(def, `counter:${def.id}`, sim.state.tick)],
                    sim,
                  ),
              ),
            }
          : null
      return {
        ratePerMin: Math.round(lane.rate()),
        detectionPct: Math.round(100 * mean),
        byStrain: byStrain.map((x) => ({
          strain: x.strain,
          pct: Math.round(100 * x.d),
          counter: x.counter,
        })),
        stalled: stalled(),
        suggest,
      }
    },
    payroll() {
      const s = st()
      const active = s.employees.filter((e) => e.active)
      return {
        // B3 §3.6 (D-4): what payday debits — present workers × payrollMult
        // + the subscriptions (payroll.ts, the same numbers).
        perDay: payrollDuePerDay(get()),
        // Short while someone the last payday missed is still owed: a
        // re-hire (unpaidPaydays = 0) or the next paid payday clears it, so
        // the Garage `!` and the red payroll line do not outlive the problem
        // (UX M3 review: they stayed up after every walkout was re-hired).
        short: (s.economy.lastPayroll?.shortEmployeeIds ?? []).some((id) =>
          active.some((e) => e.id === id && e.unpaidPaydays > 0),
        ),
        inspectors: active.filter((e) => e.role === 'inspector').length,
        sorters: active.filter((e) => e.role === 'sorter').length,
        drivers: active.filter((e) => e.role === 'driver').length,
      }
    },
    applicants(role, vehicleType = 'bike') {
      const sim = get()
      const key = `${role}:${vehicleType}`
      const c = aCache[key]
      if (c && c.sim === sim && c.rev === sim.revision) return c.list
      const list = (sim.state.applicants[role] ?? []).map((a) =>
        applicantView(sim, a, vehicleType),
      )
      aCache[key] = { sim, rev: sim.revision, list }
      return list
    },
    people,
    get wanted() {
      return st().wanted
    },
    get holdStation(): HoldStationView {
      const sim = get()
      const s = sim.state
      const hs = s.lane.holdStation
      const unlockLevel = sim.data.employees.holdStation.unlockLevel
      const seated =
        typeof hs.fixture === 'number'
          ? (people().find((x) => x.id === hs.fixture) ?? null)
          : null
      return {
        unlockLevel,
        unlocked: s.level.level >= unlockLevel,
        kind:
          hs.fixture === null
            ? null
            : hs.fixture === 'sorter_arm'
              ? ('sorter_arm' as const)
              : ('sorter' as const),
        sorter: seated,
        working: hs.nextDecisionTick !== null,
      }
    },
    hire: (role, applicantId, target) =>
      run({ kind: 'hire', role, applicantId, target }),
    fire: (employeeId) => run({ kind: 'fire', employeeId }),
    postAd: (role) => run({ kind: 'postAd', role }),

    rush: (buildingId) => run({ kind: 'rush', buildingId }),
    buyVehicle: (type, applicantId) =>
      run({ kind: 'buyVehicle', type, applicantId }),
    sellVehicle: (id) => run({ kind: 'sellVehicle', id }),
    setHomeZone: (id, zone) => run({ kind: 'setZone', id, zone }),
    rehireDriver(id) {
      const s = st()
      const v = s.vehicles.find((x) => x.id === id)
      const e = s.employees.find(
        (x) => x.role === 'driver' && x.id === v?.driverId && !x.active,
      )
      if (!e) return { ok: false, reason: 'no-vehicle' }
      return run({ kind: 'rehire', employeeId: e.id })
    },
    grantLife: () => run({ kind: 'continueWithOneLife' }),
    quests() {
      const sim = get()
      if (!qCache || qCache.sim !== sim || qCache.rev !== sim.revision) {
        qCache = { sim, rev: sim.revision, view: questsView(sim) }
      }
      return qCache.view
    },
    quest,
    get victory() {
      return st().economy.victory
    },
    hubs,
    hub(id) {
      return hubs().find((h) => h.id === id) ?? null
    },
    debug,
  }
}
