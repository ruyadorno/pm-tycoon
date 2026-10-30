// Commands (plan.md §5): the only mutating entry besides tick(). Sim.dispatch
// validates the shape (isCommand), runs the handler — which validates the
// rules and applies the change immediately, or returns a stable failure
// reason without touching state or the rng — and logs successful commands.
// A handler that changes state while reporting a failure marks it `applied`
// (logged for replay). The `debug*` kinds back ViewSim.debug (debug builds
// only; logged like any command, so __pm.replay stays exact).
// M6 people (spec-build2 §2, §8; design-m6 §3.1): hire / fire / postAd,
// buyVehicle with the picked driver (or null = "Hire later"), placeDesk with
// a desks.rows index, touchHeld (the sorter's player grace), the Sorter Arm
// in the Hold Bay station (buyMachine / removeFixture on the Hold Bay node)
// and debugForceLevel. Commands draw only on the applicant stream.
// M7 quests (spec-build2 §3, §8; design-m7 §3.2): acceptQuest /
// declineQuest / abandonQuest / debugOfferQuest delegate to
// systems/quests.ts (an Accept of the magic parcel draws only on the quest
// stream); buyMachine spends a quest voucher before money.
// M8 L3 (design-m8-m9 §3.1): buyDock {index} (systems/docks.ts — dock<index>
// + conv<index> feeding the first slot) and debugOverseasMalware {hub}
// (systems/hubs.ts — a malware parcel handed off now, so it costs a life at
// clearance).

import type { GameData, VehicleTypeDef } from '../data/types.ts'
import { machineChecker } from './detection.ts'
import type { Sim } from './sim.ts'
import type {
  Applicant,
  BuildingId,
  Checker,
  Fixture,
  HireTarget,
  LaneNode,
  Role,
  SimState,
  Strain,
  Tick,
  Vehicle,
  VehicleType,
  Zone,
} from './types.ts'
import { laneNode } from './types.ts'
import { applyRush } from './systems/dispatch.ts'
import { buyDock } from './systems/docks.ts'
import { debugMalwareDelivery } from './systems/economy.ts'
import {
  clearParcel,
  debugFillHoldBay,
  isHeld,
  tossParcel,
} from './systems/holdbay.ts'
import { debugOverseasMalware } from './systems/hubs.ts'
import { moveFixture, placeFixture, removeFixture } from './systems/lane.ts'
import { forceLevel } from './systems/levels.ts'
import { rehire, rehireFee } from './systems/payroll.ts'
import {
  fireEmployee,
  hireApplicant,
  hireFeeOf,
  inspectorNumbers,
  refreshPool,
  restartSorterClock,
  ROLES,
} from './systems/people.ts'
import {
  abandonQuest,
  acceptQuest,
  debugOfferQuest,
  declineQuest,
} from './systems/quests.ts'
import { playerGraceTicks, SORTER_ARM_ID } from './systems/sorter.ts'
import { parkingTile, sellVehicle } from './systems/vehicles.ts'

export type Command =
  /** M6: applicantId = the picked driver applicant, null = "Hire later" (no driver, `inactive`). */
  | { kind: 'buyVehicle'; type: VehicleType; applicantId: number | null }
  | { kind: 'sellVehicle'; id: number }
  | { kind: 'setZone'; id: number; zone: Zone }
  | { kind: 'rush'; buildingId: BuildingId }
  /** A machines.json checker into a slot, or (M6) the Sorter Arm upgrade into the Hold Bay node. */
  | { kind: 'buyMachine'; defId: string; nodeId: string }
  /** M6: index = employees.json desks.rows index. */
  | { kind: 'placeDesk'; nodeId: string; index: number }
  | { kind: 'moveFixture'; from: string; to: string }
  | { kind: 'removeFixture'; nodeId: string }
  /** M6: hire an applicant of `role` into a desk / the Hold Bay station / a vehicle. */
  | { kind: 'hire'; role: Role; applicantId: number; target: HireTarget }
  /** M6: any role, active or walked out (frees the seat at once, no refund). */
  | { kind: 'fire'; employeeId: number }
  /** M6: reroll one pool now (applicants.adPrice). */
  | { kind: 'postAd'; role: Role }
  | { kind: 'rehire'; employeeId: number }
  | { kind: 'toss'; parcelId: number }
  | { kind: 'clear'; parcelId: number }
  /** M6: the player looked at a held parcel (the sorter's player grace, design D3). */
  | { kind: 'touchHeld'; parcelId: number }
  /** M8: loading dock `index` (an economy.docks row: 2 at L3, 3 at L4). */
  | { kind: 'buyDock'; index: number }
  | { kind: 'continueWithOneLife' }
  /** M7: accept the open offer. */
  | { kind: 'acceptQuest'; questId: string }
  /** M7: decline the open offer (not the ultimate: Later only). */
  | { kind: 'declineQuest'; questId: string }
  /** M7: give up the active quest (no penalty). */
  | { kind: 'abandonQuest' }
  /** Debug builds (ViewSim.debug.forceFlagNext): the next checker roll flags on `strain`. */
  | { kind: 'debugForceFlag'; strain: Strain }
  /** Debug builds (ViewSim.debug.fillHoldBay): fill every free bay with flagged parcels. */
  | { kind: 'debugFillHoldBay' }
  /** Debug builds (ViewSim.debug.forceMalwareDelivery): deliver a malware parcel now (a life). */
  | { kind: 'debugMalwareDelivery' }
  /** Debug builds (ViewSim.debug.forceLevel): level up to `level` now, past the playtest cap. */
  | { kind: 'debugForceLevel'; level: number }
  /** Debug builds (ViewSim.debug.offerQuest, ?quest=): offer this template (or the ultimate) now. */
  | { kind: 'debugOfferQuest'; templateId: string }
  /** Debug builds (ViewSim.debug.forceOverseasMalware): hand a malware parcel off at a live hub now. */
  | { kind: 'debugOverseasMalware'; hub: string }

export type CommandKind = Command['kind']
export type CommandOf<K extends CommandKind> = Extract<Command, { kind: K }>

/**
 * Stable failure strings (→ tooltips). The plan.md §5 list plus 'invalid'
 * (malformed command, unknown id, or an action that does not apply to the
 * target — a UI bug, never shown to the player).
 */
export const FAIL_REASONS = [
  'trucks-only',
  'needs-van',
  'no-vehicle',
  'already-rushed',
  'insufficient-funds',
  'last-vehicle',
  'slot-occupied',
  'slot-locked',
  'desk-full',
  'desk-exists',
  'shelf-full',
  'locked',
  'no-applicant',
  'station-locked',
  'station-occupied',
  'desk-locked',
  'quest-active',
  'quest-expired',
  'invalid',
] as const
export type FailReason = (typeof FAIL_REASONS)[number]

/**
 * A command's result. Additive fields: `vehicleId` on a successful rush (the
 * retargeted vehicle), buyVehicle (the new vehicle) and a driver hire;
 * `employeeId` on a hire and on buyVehicle with a driver (M6); `applied` on
 * a failure that still changed the state and is logged for replay — a rush
 * with no eligible vehicle keeps its flag (spec §4.1) and reports why
 * ('trucks-only' / 'needs-van' / 'no-vehicle').
 */
export type CommandResult =
  | { ok: true; vehicleId?: number; employeeId?: number }
  | { ok: false; reason: FailReason; applied?: true }

/** One replayable entry: `cmd` was dispatched while state.tick === tick. */
export interface CommandLogEntry {
  tick: Tick
  cmd: Command
}

const OK: CommandResult = { ok: true }
const fail = (reason: FailReason): CommandResult => ({ ok: false, reason })

// Shape validation ---------------------------------------------------------------

type FieldType = 'string' | 'int' | 'intOrNull' | 'hireTarget'
const FIELDS: { [K in CommandKind]: Record<string, FieldType> } = {
  buyVehicle: { type: 'string', applicantId: 'intOrNull' },
  sellVehicle: { id: 'int' },
  setZone: { id: 'int', zone: 'string' },
  rush: { buildingId: 'string' },
  buyMachine: { defId: 'string', nodeId: 'string' },
  placeDesk: { nodeId: 'string', index: 'int' },
  moveFixture: { from: 'string', to: 'string' },
  removeFixture: { nodeId: 'string' },
  hire: { role: 'string', applicantId: 'int', target: 'hireTarget' },
  fire: { employeeId: 'int' },
  postAd: { role: 'string' },
  rehire: { employeeId: 'int' },
  toss: { parcelId: 'int' },
  clear: { parcelId: 'int' },
  touchHeld: { parcelId: 'int' },
  buyDock: { index: 'int' },
  continueWithOneLife: {},
  acceptQuest: { questId: 'string' },
  declineQuest: { questId: 'string' },
  abandonQuest: {},
  debugForceFlag: { strain: 'string' },
  debugFillHoldBay: {},
  debugMalwareDelivery: {},
  debugForceLevel: { level: 'int' },
  debugOfferQuest: { templateId: 'string' },
  debugOverseasMalware: { hub: 'string' },
}

/** Exactly one of {nodeId: string}, {station: 'hold'}, {vehicleId: safe int}. */
function isHireTarget(v: unknown): v is HireTarget {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const keys = Object.keys(v)
  if (keys.length !== 1) return false
  const t = v as Record<string, unknown>
  if (keys[0] === 'nodeId') return typeof t.nodeId === 'string'
  if (keys[0] === 'station') return t.station === 'hold'
  if (keys[0] === 'vehicleId') return Number.isSafeInteger(t.vehicleId)
  return false
}

/** Structural check for commands arriving from outside TS (__pm.dispatch, replays). */
export function isCommand(x: unknown): x is Command {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false
  const rec = x as Record<string, unknown>
  const kind = rec.kind
  if (typeof kind !== 'string' || !Object.hasOwn(FIELDS, kind)) return false
  const fields = FIELDS[kind as CommandKind]
  for (const [key, type] of Object.entries(fields)) {
    const v = rec[key]
    if (type === 'string' && typeof v !== 'string') return false
    if (type === 'int' && !Number.isSafeInteger(v)) return false
    if (type === 'intOrNull' && v !== null && !Number.isSafeInteger(v))
      return false
    if (type === 'hireTarget' && !isHireTarget(v)) return false
  }
  return true
}

// Handlers -------------------------------------------------------------------------

type Handler<K extends CommandKind> = (
  sim: Sim,
  cmd: CommandOf<K>,
) => CommandResult

/** Validate + apply. Never throws for a well-formed command. */
export function applyCommand(sim: Sim, cmd: Command): CommandResult {
  if (!isCommand(cmd)) return fail('invalid')
  const handler = COMMAND_HANDLERS[cmd.kind] as Handler<CommandKind>
  return handler(sim, cmd)
}

export const COMMAND_HANDLERS: { [K in CommandKind]: Handler<K> } = {
  buyVehicle(sim, cmd) {
    const def = sim.data.vehicles.types.find((t) => t.id === cmd.type)
    if (!def) return fail('invalid')
    if (def.unlockLevel > sim.state.level.level) return fail('locked')
    let a: Applicant | null = null
    if (cmd.applicantId !== null) {
      a = applicantOf(sim, 'driver', cmd.applicantId)
      if (!a) return fail('no-applicant')
    }
    const fee = a ? hireFeeOf(sim.data, a, def.id) : 0
    if (sim.state.economy.balance < def.price + fee) {
      return fail('insufficient-funds')
    }
    // Spec-build2 §2.5: the picked driver drives it; "Hire later" parks it
    // `inactive` (No driver) until one is hired from the Garage row.
    const v = createVehicle(sim, def, a !== null)
    sim.debit(def.price, 'purchase')
    if (def.id === 'truck' && sim.state.stats.truckTick === null) {
      sim.state.stats.truckTick = sim.state.tick
    }
    sim.emit('vehicle:bought', { id: v.id })
    if (a) {
      const e = hireApplicant(sim, a, { vehicleId: v.id }, v)
      return { ok: true, vehicleId: v.id, employeeId: e.id }
    }
    sim.emit('vehicle:inactive', { id: v.id })
    return { ok: true, vehicleId: v.id }
  },

  sellVehicle(sim, cmd) {
    const v = sim.state.vehicles.find((x) => x.id === cmd.id)
    if (!v) return fail('no-vehicle')
    if (
      sim.data.vehicles.lastVehicleUnsellable &&
      sim.state.vehicles.length <= 1
    ) {
      return fail('last-vehicle')
    }
    sellVehicle(sim, v)
    return OK
  },

  setZone(sim, cmd) {
    const v = sim.state.vehicles.find((x) => x.id === cmd.id)
    if (!v) return fail('no-vehicle')
    if (cmd.zone !== 'any') {
      const d = sim.data.districts.find((x) => x.id === cmd.zone)
      if (!d || d.kind !== 'district') return fail('invalid')
      if (!sim.state.districts[d.id]?.live) return fail('locked')
      if (typeDef(sim.data, v.type).disallowedRegions.includes(d.id)) {
        return fail('trucks-only')
      }
    }
    v.zone = cmd.zone
    return OK
  },

  rush(sim, cmd) {
    return applyRush(sim, cmd.buildingId)
  },

  buyMachine(sim, cmd) {
    const up = sim.data.machines.upgrades.find((u) => u.id === cmd.defId)
    if (up) {
      // The Sorter Arm (design §4.3): into the Hold Bay station only.
      const s = sim.state
      if (up.id !== SORTER_ARM_ID || cmd.nodeId !== s.lane.holdBayNodeId) {
        return fail('invalid')
      }
      if (up.unlockLevel > s.level.level) return fail('locked')
      if (s.lane.holdStation.fixture !== null) return fail('station-occupied')
      if (s.economy.balance < up.price) return fail('insufficient-funds')
      s.lane.holdStation = { fixture: SORTER_ARM_ID, nextDecisionTick: null }
      sim.debit(up.price, 'purchase')
      return OK
    }
    const def = sim.data.machines.checkers.find((c) => c.id === cmd.defId)
    if (!def) return fail('invalid')
    if (def.unlockLevel > sim.state.level.level) return fail('locked')
    const node = slotTarget(sim, cmd.nodeId)
    if (typeof node === 'string') return fail(node)
    // M7: a quest voucher pays for it (price 0, the first matching one).
    const vouchers = sim.state.quests.vouchers
    const voucher = vouchers.indexOf(def.id)
    if (voucher < 0 && sim.state.economy.balance < def.price) {
      return fail('insufficient-funds')
    }
    const checker: Checker = machineChecker(
      def,
      nextCheckerId(sim.state),
      sim.state.tick,
    )
    if (voucher >= 0) {
      vouchers.splice(voucher, 1)
      checker.price = 0 // a gift: removing it refunds nothing
    }
    placeFixture(sim, node, { kind: 'machine', checker })
    if (voucher < 0) sim.debit(def.price, 'purchase')
    sim.emit('lane:fixturePlaced', {
      nodeId: node.id,
      fixture: structuredClone(node.fixture as Fixture),
    })
    return OK
  },

  placeDesk(sim, cmd) {
    // employees.json desks.rows (spec-build2 §2.4; desk 2 at L3 for $400,
    // Q-B2-4): placed empty — it passes parcels through until someone is hired.
    const row = sim.data.employees.desks.rows.find((r) => r.index === cmd.index)
    if (!row) return fail('invalid')
    if (sim.state.level.level < row.unlockLevel) return fail('desk-locked')
    const placed = sim.state.lane.nodes.some(
      (n) => n.fixture?.kind === 'desk' && n.fixture.index === row.index,
    )
    if (placed) return fail('desk-exists')
    const node = slotTarget(sim, cmd.nodeId)
    if (typeof node === 'string') return fail(node)
    if (sim.state.economy.balance < row.price) return fail('insufficient-funds')
    placeFixture(sim, node, {
      kind: 'desk',
      index: row.index,
      checker: deskChecker(sim.state, sim.data, row.index),
      inspectorIds: [],
      walkedOutIds: [],
    })
    if (row.price > 0) sim.debit(row.price, 'purchase')
    sim.emit('lane:fixturePlaced', {
      nodeId: node.id,
      fixture: structuredClone(node.fixture as Fixture),
    })
    sim.emit('desk:placed', { index: row.index, nodeId: node.id })
    return OK
  },

  moveFixture(sim, cmd) {
    const from = laneNode(sim.state.lane, cmd.from)
    const to = laneNode(sim.state.lane, cmd.to)
    if (!from || !to || from.kind !== 'slot' || to.kind !== 'slot') {
      return fail('invalid')
    }
    if (from.locked || to.locked) return fail('slot-locked')
    if (!from.fixture || from.id === to.id) return fail('invalid')
    // Free (§6.2); an occupied target swaps (Q30); parcels stay and re-seat (Q31).
    const swapped = moveFixture(sim, from, to)
    sim.emit('lane:fixtureMoved', { from: from.id, to: to.id, swapped })
    return OK
  },

  removeFixture(sim, cmd) {
    const s = sim.state
    if (cmd.nodeId === s.lane.holdBayNodeId) {
      // The Sorter Arm leaves the station: removalRefund × its price.
      if (s.lane.holdStation.fixture !== SORTER_ARM_ID) return fail('invalid')
      const up = sim.data.machines.upgrades.find((u) => u.id === SORTER_ARM_ID)
      s.lane.holdStation = { fixture: null, nextDecisionTick: null }
      const refund = Math.round(
        (up?.price ?? 0) * sim.data.machines.removalRefund,
      )
      if (refund > 0) sim.credit(refund, 'refund', false)
      sim.emit('lane:fixtureRemoved', { nodeId: cmd.nodeId, refund })
      return OK
    }
    const node = laneNode(sim.state.lane, cmd.nodeId)
    if (!node || node.kind !== 'slot' || !node.fixture) return fail('invalid')
    // A machine refunds removalRefund × its price (§7.2, Q11); a desk is
    // free and its inspectors leave without refund (§6.2).
    const f = removeFixture(sim, node)
    const refund =
      f?.kind === 'machine'
        ? Math.round(f.checker.price * sim.data.machines.removalRefund)
        : 0
    if (refund > 0) sim.credit(refund, 'refund', false)
    sim.emit('lane:fixtureRemoved', { nodeId: node.id, refund })
    return OK
  },

  hire(sim, cmd) {
    const s = sim.state
    const data = sim.data
    if (!ROLES.includes(cmd.role)) return fail('invalid')
    const a = applicantOf(sim, cmd.role, cmd.applicantId)
    if (!a) return fail('no-applicant')
    const t = cmd.target
    let v: Vehicle | undefined
    if (cmd.role === 'inspector') {
      if (!('nodeId' in t)) return fail('invalid')
      const node = laneNode(s.lane, t.nodeId)
      if (!node || node.kind !== 'slot') return fail('invalid')
      if (node.locked) return fail('slot-locked')
      if (node.fixture?.kind !== 'desk') return fail('invalid')
      // Walked-out inspectors keep their seat for a re-hire (§7.4).
      const f = node.fixture
      const seats = f.inspectorIds.length + f.walkedOutIds.length
      if (seats >= data.employees.desks.maxPerDesk) return fail('desk-full')
    } else if (cmd.role === 'sorter') {
      if (!('station' in t)) return fail('invalid')
      if (s.level.level < data.employees.holdStation.unlockLevel) {
        return fail('station-locked')
      }
      // A seated sorter (active or not) is replaced (design D11); the Arm
      // and a sorter never share the station.
      if (s.lane.holdStation.fixture === SORTER_ARM_ID) {
        return fail('station-occupied')
      }
    } else {
      if (!('vehicleId' in t)) return fail('invalid')
      v = s.vehicles.find((x) => x.id === t.vehicleId)
      if (!v) return fail('no-vehicle')
    }
    if (s.economy.balance < hireFeeOf(data, a, v?.type)) {
      return fail('insufficient-funds')
    }
    const e = hireApplicant(sim, a, t, v)
    return v
      ? { ok: true, employeeId: e.id, vehicleId: v.id }
      : { ok: true, employeeId: e.id }
  },

  fire(sim, cmd) {
    const e = sim.state.employees.find((x) => x.id === cmd.employeeId)
    if (!e) return fail('invalid')
    // §6.7 / spec-build2 §2.2: instant, no refund, the seat frees at once.
    fireEmployee(sim, e, 'fired')
    return OK
  },

  postAd(sim, cmd) {
    if (!ROLES.includes(cmd.role)) return fail('invalid')
    const price = sim.data.employees.applicants.adPrice
    if (sim.state.economy.balance < price) return fail('insufficient-funds')
    if (price > 0) sim.debit(price, 'hire')
    refreshPool(sim, cmd.role, 'ad')
    return OK
  },

  rehire(sim, cmd) {
    const e = sim.state.employees.find((x) => x.id === cmd.employeeId)
    if (!e || e.active) return fail('invalid')
    // §7.4: one day's salary × rehireFeeDays, immediate; clears the unpaid
    // mark; back at the desk / the vehicle inactive → idle_lot (payroll.ts).
    if (sim.state.economy.balance < rehireFee(sim, e)) {
      return fail('insufficient-funds')
    }
    return rehire(sim, e) ? OK : fail('invalid')
  },

  toss(sim, cmd) {
    const p = sim.state.parcels[String(cmd.parcelId)]
    if (!p || !isHeld(sim, cmd.parcelId)) return fail('invalid')
    // §6.6: bounty, or the fee + satisfaction.
    tossParcel(sim, p, { source: 'player', employeeId: null })
    restartSorterClock(sim)
    return OK
  },

  clear(sim, cmd) {
    const p = sim.state.parcels[String(cmd.parcelId)]
    if (!p || !isHeld(sim, cmd.parcelId)) return fail('invalid')
    const refused = clearParcel(sim, p) // §6.6: → shelf; Q35 'shelf-full'
    if (refused !== null) return fail(refused)
    restartSorterClock(sim)
    return OK
  },

  touchHeld(sim, cmd) {
    const p = sim.state.parcels[String(cmd.parcelId)]
    if (!p || !isHeld(sim, cmd.parcelId)) return fail('invalid')
    // Design D3: the player's tap wins — the sorter (and the Sorter Arm)
    // skip it for playerGraceS and a running sorter clock starts over. A
    // touch inside the grace (the open HoldBayCard renews it while the
    // player reads, B2 §2.6) only extends the grace: the sorter keeps
    // working the other parcels.
    const grace = playerGraceTicks(sim.data)
    const fresh =
      p.touchedTick === undefined || sim.state.tick - p.touchedTick >= grace
    p.touchedTick = sim.state.tick
    if (fresh) restartSorterClock(sim)
    return OK
  },

  buyDock(sim, cmd) {
    return buyDock(sim, cmd.index)
  },

  continueWithOneLife(sim) {
    if (!sim.data.economy.continueWithOneLife) return fail('locked')
    const eco = sim.state.economy
    if (!eco.gameOver) return fail('invalid')
    eco.lives = 1
    eco.gameOver = false
    return OK
  },

  acceptQuest(sim, cmd) {
    return acceptQuest(sim, cmd.questId)
  },

  declineQuest(sim, cmd) {
    return declineQuest(sim, cmd.questId)
  },

  abandonQuest(sim) {
    return abandonQuest(sim)
  },

  debugForceFlag(sim, cmd) {
    const known = sim.data.parcels.malware.strains.some(
      (x) => x.id === cmd.strain,
    )
    if (!known) return fail('invalid')
    sim.state.lane.debugForceFlag = cmd.strain
    return OK
  },

  debugFillHoldBay(sim) {
    return debugFillHoldBay(sim) > 0 ? OK : fail('invalid')
  },

  debugMalwareDelivery(sim) {
    debugMalwareDelivery(sim)
    return OK
  },

  debugForceLevel(sim, cmd) {
    const last = sim.data.levels.reduce((m, l) => Math.max(m, l.level), 0)
    if (cmd.level <= sim.state.level.level || cmd.level > last) {
      return fail('invalid')
    }
    forceLevel(sim, cmd.level)
    return OK
  },

  debugOfferQuest(sim, cmd) {
    return debugOfferQuest(sim, cmd.templateId)
  },

  debugOverseasMalware(sim, cmd) {
    return debugOverseasMalware(sim, cmd.hub)
  },
}

// Helpers --------------------------------------------------------------------------

function typeDef(data: GameData, type: VehicleType): VehicleTypeDef {
  const def = data.vehicles.types.find((t) => t.id === type)
  if (!def) throw new Error(`unknown vehicle type ${type}`)
  return def
}

/** An unlocked, empty slot node, or the failure reason. */
function slotTarget(
  sim: Sim,
  nodeId: string,
): LaneNode | 'invalid' | 'slot-locked' | 'slot-occupied' {
  const node = laneNode(sim.state.lane, nodeId)
  if (!node || node.kind !== 'slot') return 'invalid'
  if (node.locked) return 'slot-locked'
  if (node.fixture) return 'slot-occupied'
  return node
}

/** 'chk<n>' from nextId.checker. */
export function nextCheckerId(state: SimState): string {
  const id = `chk${state.nextId.checker}`
  state.nextId.checker += 1
  return id
}

/** An applicant waiting in `role`'s pool, or null. */
function applicantOf(sim: Sim, role: Role, id: number): Applicant | null {
  return sim.state.applicants[role].find((a) => a.id === id) ?? null
}

/**
 * An inspection desk's checker (employees.json desks.rows[index]): a
 * generalist whose numbers are the crew's readout (people.ts syncDesk), the
 * start inspector's pips until someone sits there.
 */
export function deskChecker(
  state: SimState,
  data: GameData,
  index: number,
): Checker {
  const start = inspectorNumbers(data, data.employees.start.inspector.pips)
  const row = data.employees.desks.rows.find((r) => r.index === index)
  return {
    id: nextCheckerId(state),
    kind: 'desk',
    defId: 'inspector',
    strain: data.employees.roles.inspector.strain,
    pMatch: start.p,
    pOther: start.p,
    decoyFlag: start.decoyFlag,
    processTicks: start.processTicks,
    stations: 0,
    price: row?.price ?? 0,
    boughtTick: state.tick,
  }
}

/**
 * §4.1 Buy: pops in on the lot, home zone 'any' — `idle_lot` when a driver
 * is about to be seated (people.ts hireApplicant), else `inactive` with no
 * driver ("Hire later", spec-build2 §2.5).
 */
function createVehicle(
  sim: Sim,
  def: VehicleTypeDef,
  withDriver: boolean,
): Vehicle {
  const s = sim.state
  const usedNames = s.vehicles.map((v) => v.name)
  let n = 1
  while (usedNames.includes(`${def.name} ${n}`)) n += 1
  const id = s.nextId.vehicle
  s.nextId.vehicle += 1
  const tile = parkingTile(sim, id)
  const pos = { tx: tile.x, ty: tile.y }
  const v: Vehicle = {
    id,
    type: def.id,
    name: `${def.name} ${n}`,
    driverId: null,
    nextDriverId: null,
    state: withDriver ? 'idle_lot' : 'inactive',
    zone: 'any',
    pos,
    prev: { ...pos },
    heading: 'SE',
    wheel: 0,
    path: [],
    pathIndex: 0,
    edgeT: 0,
    stops: [],
    stopIndex: 0,
    cargo: [],
    unitsUsed: 0,
    reserved: [],
    dockId: null,
    waitUntilTick: null,
    rushBuildingId: null,
    collectedThisLeg: false,
    purchasePrice: def.price,
    boughtTick: s.tick,
  }
  s.vehicles.push(v)
  return v
}
