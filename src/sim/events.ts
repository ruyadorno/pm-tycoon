// Typed sim events (plan.md §5 "Sim events" = spec §11 + §4.6, plus the
// additions of §14 Q16). One payload object per event; every parcel event
// carries `id`. Systems emit through Sim.emit() (never sim.events.emit), so
// the "handlers never call dispatch" assertion and the CLI tap see every
// event. Payload fields are JSON values (no undefined).

import { EventEmitter } from 'eventemitter3'
import type {
  BuildingId,
  DistrictId,
  Fixture,
  LostLifeReport,
  Pips,
  Role,
  Size,
  Strain,
  Tick,
  TraceEntry,
} from './types.ts'

/** An event without fields. */
export type NoPayload = Record<string, never>

export type StallReason = 'holdBayFull' | 'shelfFull' | 'bufferFull'

export type MoneyReason =
  | 'delivery'
  | 'clearance'
  | 'bounty'
  | 'quest'
  | 'payroll'
  | 'wrongToss'
  | 'purchase'
  | 'hire'
  | 'refund'

export type TickerKind =
  | 'level'
  | 'region'
  | 'strain'
  | 'incident'
  | 'defused'
  | 'stall'
  | 'payroll'
  | 'worker'
  | 'mood'
  | 'daily'
  | 'filler'

export interface VehicleRef {
  id: number
}

/** life:lost: the card fields flat (plan.md §5) plus the full report. */
export interface LifeLostPayload {
  parcelId: number
  label: string
  strain: Strain | null
  destBuildingId: BuildingId
  path: TraceEntry[]
  laneRate: number
  counterMachineId: string | null
  counterOwned: boolean
  counterRate: number | null
  clearedByPlayerAt: Tick | null
  /** M6 (flat copies of the report's). */
  missedBy: LostLifeReport['missedBy']
  inspectorRate: number | null
  sorterCall: LostLifeReport['sorterCall']
  report: LostLifeReport
}

/** Who tossed a parcel (M6): the player, the seated sorter, or the Sorter Arm. */
export type TossSource = 'player' | 'sorter' | 'arm'

/** Why an employee left for good (M6). */
export type FireReason = 'fired' | 'replaced' | 'deskRemoved'

/** Why an applicant pool changed (M6). */
export type ApplicantsReason = 'day' | 'ad' | 'hire' | 'star' | 'starLeft'

/** Event name → payload. */
export interface SimEventPayloads {
  // parcel (§11)
  'parcel:spawned': {
    id: number
    origin: BuildingId
    dest: BuildingId
    size: Size
    label: string
  }
  'parcel:pickedUp': { id: number; vehicleId: number }
  'parcel:unloaded': { id: number; dockId: string }
  /** `slot` = nodeId, kept as an alias for one release. */
  'parcel:enteredSlot': { id: number; nodeId: string; slot: string }
  /** strain = the trait the checker flagged on (malware strain or decoy trait). */
  'parcel:flagged': {
    id: number
    checkerId: string
    strain: Strain
    nodeId: string
    scripted: boolean
  }
  'parcel:held': { id: number }
  /**
   * bounty = $ paid (0 on a wrong Toss); source = who tossed (M6), with the
   * sorter's Employee id (null for the player and the Arm).
   */
  'parcel:tossed': {
    id: number
    wasMalware: boolean
    bounty: number
    source: TossSource
    employeeId: number | null
  }
  'parcel:shelved': { id: number }
  'parcel:cleared_by_player': { id: number }
  'parcel:returned': { id: number }
  'parcel:loaded': { id: number; vehicleId: number }
  'parcel:delivered': {
    id: number
    paid: number
    onTime: boolean
    malware: boolean
  }
  'parcel:handedOff': { id: number; hub: DistrictId; lockedValue: number }
  'parcel:cleared': { id: number; paid: number; malware: boolean }
  // vehicles / docks (§4.6, §6.5)
  'vehicle:bought': VehicleRef
  'vehicle:parked': VehicleRef
  /** position = 0-based place in the dock queue. */
  'vehicle:queued': { id: number; position: number }
  'vehicle:docked': { id: number; dockId: string }
  'vehicle:unloaded': VehicleRef
  /** stops = number of stops on the leg just started. */
  'vehicle:departed': { id: number; stops: number }
  'vehicle:collecting': VehicleRef
  'vehicle:returning': VehicleRef
  'vehicle:inactive': VehicleRef
  'vehicle:sold': VehicleRef
  'dock:queueLength': { dockId: string; n: number }
  /** Once per in-game minute (day boundary). */
  'dock:occupancy': { dockId: string; pct: number }
  // lane / money / workers
  'lane:stalled': { reason: StallReason; nodeId: string }
  'lane:resumed': NoPayload
  'money:changed': { delta: number; reason: MoneyReason; balance: number }
  'payroll:paid': { amount: number }
  'payroll:short': { employeeIds: number[] }
  'worker:hired': {
    employeeId: number
    role: Role
    nodeId: string | null
    vehicleId: number | null
    pips: Pips
    star: boolean
    /** A walked-out worker back (payroll.ts rehire). */
    rehire: boolean
  }
  'worker:walkedOut': {
    employeeId: number
    role: Role
    nodeId: string | null
    vehicleId: number | null
  }
  'worker:fired': {
    employeeId: number
    role: Role
    nodeId: string | null
    vehicleId: number | null
    reason: FireReason
  }
  /** M6: an applicant pool changed (re-render the HireSheet). */
  'applicants:refreshed': { role: Role; reason: ApplicantsReason }
  /**
   * M6: the seated sorter made a call. `correct` is for the report / tests
   * only — the UI never shows it.
   */
  'sorter:decided': {
    parcelId: number
    employeeId: number
    call: 'toss' | 'leave'
    correct: boolean
    viaWanted: boolean
  }
  /** M6: a desk (employees.json desks.rows index) was placed. */
  'desk:placed': { index: number; nodeId: string }
  // progress
  'level:up': { level: number }
  'region:unlocked': { district: DistrictId }
  'life:lost': LifeLostPayload
  'game:over': NoPayload
  'satisfaction:changed': { district: DistrictId; value: number; delta: number }
  'ticker:news': { text: string; kind: TickerKind }
  /** build 2 */
  'quest:offered': { questId: string }
  'quest:accepted': { questId: string }
  'quest:completed': { questId: string }
  'quest:failed': { questId: string }
  /** day = completed in-game days (= state.day after the clock step). */
  'day:ended': { day: number }
  // additions beyond §11 (default — confirm, plan.md §14 Q16)
  'building:rushed': {
    buildingId: BuildingId
    vehicleId: number | null
    untilTick: Tick
  }
  'building:rushCleared': { buildingId: BuildingId }
  'parcel:processing': { id: number; nodeId: string }
  'lane:fixturePlaced': { nodeId: string; fixture: Fixture }
  'lane:fixtureMoved': { from: string; to: string; swapped: boolean }
  'lane:fixtureRemoved': { nodeId: string; refund: number }
}

export type SimEventName = keyof SimEventPayloads

/** eventemitter3 event map: one payload argument per event. */
export type SimEvents = {
  [K in SimEventName]: (payload: SimEventPayloads[K]) => void
}

export type SimEmitter = EventEmitter<SimEvents>

export function createSimEmitter(): SimEmitter {
  return new EventEmitter<SimEvents>()
}

/** A handler for event K (generic-friendly; no casts needed at call sites). */
export type SimHandler<K extends SimEventName> = (
  payload: SimEventPayloads[K],
) => void

type LooseEmitter = {
  on(name: string, fn: (p: never) => void, ctx?: unknown): unknown
  off(name: string, fn: (p: never) => void, ctx?: unknown): unknown
}

/**
 * Subscribe with a generic event name (eventemitter3's typings cannot match
 * `(p: SimEventPayloads[K]) => void` for an unresolved K). Returns the
 * unsubscribe function. `context` is passed through (simBinding uses the scene).
 */
export function onSimEvent<K extends SimEventName>(
  events: SimEmitter,
  name: K,
  fn: SimHandler<K>,
  context?: unknown,
): () => void {
  const loose = events as unknown as LooseEmitter
  loose.on(name, fn, context)
  return () => {
    loose.off(name, fn, context)
  }
}

/** Remove a handler added with onSimEvent / events.on. */
export function offSimEvent<K extends SimEventName>(
  events: SimEmitter,
  name: K,
  fn: SimHandler<K>,
  context?: unknown,
): void {
  ;(events as unknown as LooseEmitter).off(name, fn, context)
}

/** Every event name, in the order above (tools, tests, the debug overlay). */
export const SIM_EVENT_NAMES = [
  'parcel:spawned',
  'parcel:pickedUp',
  'parcel:unloaded',
  'parcel:enteredSlot',
  'parcel:flagged',
  'parcel:held',
  'parcel:tossed',
  'parcel:shelved',
  'parcel:cleared_by_player',
  'parcel:returned',
  'parcel:loaded',
  'parcel:delivered',
  'parcel:handedOff',
  'parcel:cleared',
  'vehicle:bought',
  'vehicle:parked',
  'vehicle:queued',
  'vehicle:docked',
  'vehicle:unloaded',
  'vehicle:departed',
  'vehicle:collecting',
  'vehicle:returning',
  'vehicle:inactive',
  'vehicle:sold',
  'dock:queueLength',
  'dock:occupancy',
  'lane:stalled',
  'lane:resumed',
  'money:changed',
  'payroll:paid',
  'payroll:short',
  'worker:hired',
  'worker:walkedOut',
  'worker:fired',
  'applicants:refreshed',
  'sorter:decided',
  'desk:placed',
  'level:up',
  'region:unlocked',
  'life:lost',
  'game:over',
  'satisfaction:changed',
  'ticker:news',
  'quest:offered',
  'quest:accepted',
  'quest:completed',
  'quest:failed',
  'day:ended',
  'building:rushed',
  'building:rushCleared',
  'parcel:processing',
  'lane:fixturePlaced',
  'lane:fixtureMoved',
  'lane:fixtureRemoved',
] as const satisfies readonly SimEventName[]

type Unlisted = Exclude<SimEventName, (typeof SIM_EVENT_NAMES)[number]>
/** Compile-time proof that SIM_EVENT_NAMES lists every event (else a type error names the missing one). */
export const SIM_EVENT_NAMES_COMPLETE: [Unlisted] extends [never]
  ? true
  : Unlisted = true

/** A tap sees every emitted event (CLI recorder, debug log). */
export type SimTap = <K extends SimEventName>(
  name: K,
  payload: SimEventPayloads[K],
  tick: Tick,
) => void
