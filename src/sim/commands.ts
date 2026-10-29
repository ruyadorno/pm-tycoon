// Commands (plan.md §5): the only mutating entry besides tick(). Sim.dispatch
// validates the shape (isCommand), runs the handler — which validates the
// rules and applies the change immediately, or returns a stable failure
// reason without touching state or the rng — and logs successful commands.
// Handlers marked TODO(Mn) validate what they can and return 'locked' until
// that milestone wires them to src/sim/systems/*.ts.

import type { GameData, VehicleTypeDef } from '../data/types.ts'
import type { Sim } from './sim.ts'
import type {
  BuildingId,
  Checker,
  Employee,
  Fixture,
  LaneNode,
  SimState,
  Tick,
  TilePos,
  Vehicle,
  VehicleType,
  Zone,
} from './types.ts'
import { laneNode, ticksFromS } from './types.ts'

export type Command =
  | { kind: 'buyVehicle'; type: VehicleType }
  | { kind: 'sellVehicle'; id: number }
  | { kind: 'setZone'; id: number; zone: Zone }
  | { kind: 'rush'; buildingId: BuildingId }
  | { kind: 'buyMachine'; defId: string; nodeId: string }
  | { kind: 'placeDesk'; nodeId: string }
  | { kind: 'moveFixture'; from: string; to: string }
  | { kind: 'removeFixture'; nodeId: string }
  | { kind: 'hireInspector' }
  | { kind: 'fireInspector'; employeeId: number }
  | { kind: 'rehire'; employeeId: number }
  | { kind: 'toss'; parcelId: number }
  | { kind: 'clear'; parcelId: number }
  /** build 2 */
  | { kind: 'buyDock'; index: number }
  | { kind: 'continueWithOneLife' }
  /** build 2 */
  | { kind: 'acceptQuest'; questId: string }

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
  'invalid',
] as const
export type FailReason = (typeof FAIL_REASONS)[number]

export type CommandResult = { ok: true } | { ok: false; reason: FailReason }

/** One replayable entry: `cmd` was dispatched while state.tick === tick. */
export interface CommandLogEntry {
  tick: Tick
  cmd: Command
}

const OK: CommandResult = { ok: true }
const fail = (reason: FailReason): CommandResult => ({ ok: false, reason })

// Shape validation ---------------------------------------------------------------

type FieldType = 'string' | 'int'
const FIELDS: { [K in CommandKind]: Record<string, FieldType> } = {
  buyVehicle: { type: 'string' },
  sellVehicle: { id: 'int' },
  setZone: { id: 'int', zone: 'string' },
  rush: { buildingId: 'string' },
  buyMachine: { defId: 'string', nodeId: 'string' },
  placeDesk: { nodeId: 'string' },
  moveFixture: { from: 'string', to: 'string' },
  removeFixture: { nodeId: 'string' },
  hireInspector: {},
  fireInspector: { employeeId: 'int' },
  rehire: { employeeId: 'int' },
  toss: { parcelId: 'int' },
  clear: { parcelId: 'int' },
  buyDock: { index: 'int' },
  continueWithOneLife: {},
  acceptQuest: { questId: 'string' },
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
    if (sim.state.economy.balance < def.price) {
      return fail('insufficient-funds')
    }
    const v = createVehicle(sim, def)
    sim.debit(def.price, 'purchase')
    if (def.id === 'truck' && sim.state.stats.truckTick === null) {
      sim.state.stats.truckTick = sim.state.tick
    }
    sim.emit('vehicle:bought', { id: v.id })
    return OK
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
    // TODO(M1): systems/vehicles.ts sell (§4.1): refund sellRefund × price,
    // cargo → shelf (parcel:returned, past cap), reservations + rush released,
    // dock / dock queue freed, driver removed, vehicle:sold.
    return fail('locked')
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
    const b = sim.state.buildings[cmd.buildingId]
    if (!b) return fail('invalid')
    if (b.rushUntilTick !== null && b.rushUntilTick > sim.state.tick) {
      return fail('already-rushed')
    }
    // TODO(M1): systems/dispatch.ts applyRush (§4.1): needs waiting parcels,
    // the nearest eligible vehicle ('no-vehicle' / 'trucks-only' /
    // 'needs-van' when none), rushUntilTick = tick + rushExpireS, building:rushed.
    return fail('locked')
  },

  buyMachine(sim, cmd) {
    const def = sim.data.machines.checkers.find((c) => c.id === cmd.defId)
    if (!def) return fail('invalid')
    if (def.unlockLevel > sim.state.level.level) return fail('locked')
    const node = slotTarget(sim, cmd.nodeId)
    if (typeof node === 'string') return fail(node)
    if (sim.state.economy.balance < def.price) {
      return fail('insufficient-funds')
    }
    const checker: Checker = {
      id: nextCheckerId(sim.state),
      kind: 'machine',
      defId: def.id,
      strain: def.strain,
      pMatch: def.pMatch,
      pOther: def.pOther,
      decoyFlag: def.decoyFlag,
      processTicks: ticksFromS(def.processS),
      stations: 1,
      price: def.price,
      boughtTick: sim.state.tick,
    }
    placeFixture(node, { kind: 'machine', checker })
    sim.debit(def.price, 'purchase')
    sim.emit('lane:fixturePlaced', {
      nodeId: node.id,
      fixture: structuredClone(node.fixture as Fixture),
    })
    return OK
  },

  placeDesk(sim, cmd) {
    const desks = sim.state.lane.nodes.filter((n) => n.fixture?.kind === 'desk')
    if (desks.length >= sim.data.employees.maxDesks) return fail('desk-exists')
    const node = slotTarget(sim, cmd.nodeId)
    if (typeof node === 'string') return fail(node)
    const price = sim.data.employees.deskPrice
    if (sim.state.economy.balance < price) return fail('insufficient-funds')
    placeFixture(node, {
      kind: 'desk',
      checker: deskChecker(sim.state, sim.data, 0),
      inspectorIds: [],
      walkedOutIds: [],
    })
    if (price > 0) sim.debit(price, 'purchase')
    sim.emit('lane:fixturePlaced', {
      nodeId: node.id,
      fixture: structuredClone(node.fixture as Fixture),
    })
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
    // TODO(M2): systems/lane.ts move/swap (warehouse-view.md Q-W2/Q-W3:
    // a mid-process parcel restarts under the new fixture), lane:fixtureMoved.
    return fail('locked')
  },

  removeFixture(sim, cmd) {
    const node = laneNode(sim.state.lane, cmd.nodeId)
    if (!node || node.kind !== 'slot' || !node.fixture) return fail('invalid')
    // TODO(M2): systems/lane.ts remove (refund removalRefund × price for a
    // machine; a desk's inspectors walk out), lane:fixtureRemoved.
    return fail('locked')
  },

  hireInspector(sim) {
    const node = sim.state.lane.nodes.find((n) => n.fixture?.kind === 'desk')
    if (!node || node.fixture?.kind !== 'desk') return fail('invalid')
    const def = sim.data.employees.inspector
    if (node.fixture.inspectorIds.length >= def.maxPerDesk) {
      return fail('desk-full')
    }
    if (sim.state.economy.balance < def.hireFee) {
      return fail('insufficient-funds')
    }
    const e = hireEmployee(sim.state, sim.data, 'inspector', {
      nodeId: node.id,
    })
    node.fixture.inspectorIds.push(e.id)
    node.fixture.checker.stations += 1
    node.stations.push({ parcelId: null, doneTick: null })
    sim.debit(def.hireFee, 'hire')
    sim.emit('worker:hired', {
      employeeId: e.id,
      kind: 'inspector',
      nodeId: node.id,
    })
    return OK
  },

  fireInspector(sim, cmd) {
    const e = sim.state.employees.find((x) => x.id === cmd.employeeId)
    if (!e || e.kind !== 'inspector' || !e.active) return fail('invalid')
    // TODO(M2): systems/lane.ts fire (station −1; a parcel in that station
    // goes back to the buffer head), worker:fired.
    return fail('locked')
  },

  rehire(sim, cmd) {
    const e = sim.state.employees.find((x) => x.id === cmd.employeeId)
    if (!e || e.active) return fail('invalid')
    // TODO(M3): systems/payroll.ts re-hire (§7.4: one day's salary × rehireFeeDays,
    // clears the unpaid mark; driver vehicle inactive → idle_lot).
    return fail('locked')
  },

  toss(sim, cmd) {
    if (!isHeld(sim, cmd.parcelId)) return fail('invalid')
    // TODO(M2): Hold Bay Toss (§6.6): bin, bounty or wrongTossFee + −3 ×2
    // districts, quarantine counters, parcel:tossed.
    return fail('locked')
  },

  clear(sim, cmd) {
    if (!isHeld(sim, cmd.parcelId)) return fail('invalid')
    // TODO(M2): Hold Bay Clear (§6.6): → shelf skipping slots, 'shelf-full'
    // at cap (Q-W15), parcel:cleared_by_player.
    return fail('locked')
  },

  buyDock() {
    // build 2: docks 2-3 (economy.docks) are not implemented in playtest 1.
    return fail('locked')
  },

  continueWithOneLife(sim) {
    if (!sim.data.economy.continueWithOneLife) return fail('locked')
    const eco = sim.state.economy
    if (!eco.gameOver) return fail('invalid')
    eco.lives = 1
    eco.gameOver = false
    return OK
  },

  acceptQuest() {
    // build 2: quests (spec §5.5, §8 ultimate quest).
    return fail('locked')
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

function placeFixture(node: LaneNode, fixture: Fixture): void {
  node.fixture = fixture
  node.stations = Array.from({ length: fixture.checker.stations }, () => ({
    parcelId: null,
    doneTick: null,
  }))
}

function isHeld(sim: Sim, parcelId: number): boolean {
  const p = sim.state.parcels[String(parcelId)]
  return p !== undefined && p.state === 'held'
}

/** 'chk<n>' from nextId.checker. */
export function nextCheckerId(state: SimState): string {
  const id = `chk${state.nextId.checker}`
  state.nextId.checker += 1
  return id
}

/** The inspection desk's checker (employees.json inspector row). */
export function deskChecker(
  state: SimState,
  data: GameData,
  stations: number,
): Checker {
  const def = data.employees.inspector
  return {
    id: nextCheckerId(state),
    kind: 'desk',
    defId: 'inspector',
    strain: def.strain,
    pMatch: def.pMatch,
    pOther: def.pOther,
    decoyFlag: def.decoyFlag,
    processTicks: ticksFromS(def.processS),
    stations,
    price: data.employees.deskPrice,
    boughtTick: state.tick,
  }
}

/** First pool name unused by `used`; then "Name 2", "Name 3"… (deterministic, no rng). */
export function freshName(pool: readonly string[], used: readonly string[]) {
  for (let round = 1; ; round++) {
    for (const name of pool) {
      const candidate = round === 1 ? name : `${name} ${round}`
      if (!used.includes(candidate)) return candidate
    }
    if (pool.length === 0) return `Worker ${used.length + 1}`
  }
}

/**
 * Append an employee (ids ascending; payroll order = hire order, §7.4).
 * Inspectors earn employees.json salaryPerDay; a driver earns its vehicle
 * type's driverSalaryPerDay (pass `salaryPerDay`).
 */
export function hireEmployee(
  s: SimState,
  data: GameData,
  kind: Employee['kind'],
  at: { nodeId?: string; vehicleId?: number; salaryPerDay?: number },
): Employee {
  const pool =
    kind === 'inspector' ? data.puns.inspectorNames : data.puns.driverNames
  const used = s.employees.filter((e) => e.kind === kind).map((e) => e.name)
  const e: Employee = {
    id: s.nextId.employee,
    kind,
    name: freshName(pool, used),
    hiredTick: s.tick,
    salaryPerDay:
      at.salaryPerDay ??
      (kind === 'inspector' ? data.employees.inspector.salaryPerDay : 0),
    unpaidPaydays: 0,
    active: true,
    vehicleId: at.vehicleId ?? null,
    nodeId: at.nodeId ?? null,
  }
  s.nextId.employee += 1
  s.employees.push(e)
  return e
}

/** A lot parking tile no vehicle stands on (map.json lot.parking), else the entrance. */
function freeParking(sim: Sim): TilePos {
  const lot = sim.data.map.lot
  for (const [x, y] of lot.parking) {
    const taken = sim.state.vehicles.some(
      (v) => Math.round(v.pos.tx) === x && Math.round(v.pos.ty) === y,
    )
    if (!taken) return { tx: x, ty: y }
  }
  return { tx: lot.entrance[0], ty: lot.entrance[1] }
}

/** §4.1 Buy: pops in on the lot, idle, home zone 'any', driver hired. */
function createVehicle(sim: Sim, def: VehicleTypeDef): Vehicle {
  const s = sim.state
  const usedNames = s.vehicles.map((v) => v.name)
  let n = 1
  while (usedNames.includes(`${def.name} ${n}`)) n += 1
  const id = s.nextId.vehicle
  s.nextId.vehicle += 1
  const driver = hireEmployee(s, sim.data, 'driver', {
    vehicleId: id,
    salaryPerDay: def.driverSalaryPerDay,
  })
  const pos = freeParking(sim)
  const v: Vehicle = {
    id,
    type: def.id,
    name: `${def.name} ${n}`,
    driverId: driver.id,
    state: 'idle_lot',
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
