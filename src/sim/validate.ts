// The shape of a loaded state (plan.md §6.4 "Save and load", M4 hunt):
// Sim.load validates a snapshot in two passes — this one, then auditState's
// cross-references and conservation identity (sim.ts). A save with the
// running data hash can still be damaged (a flipped digit that stays valid
// JSON, a hand-edited payload, a build that changed the state shape without
// bumping `version` — types.ts STATE_VERSION, 2 since build 2, the only
// value accepted); every field the tick and the command handlers read must
// then have its type, its enum value or a data id, or tick() throws on the
// first frame after Continue. Problems here make the Title discard the
// save with "Save from an older build was reset" (autosave.ts checkSave)
// instead of crashing. Lenient where a legitimate save varies: extra keys
// are ignored, the ADDITION fields of types.ts are optional (older saves
// lack them), trace `what` is free text.

import type { GameData } from '../data/types.ts'
import { roadGraph } from './roads.ts'
import { STATE_VERSION, type SimState } from './types.ts'

type Add = (m: string) => void
/** Checks `v` at `path`; returns false when it is not even the right kind. */
type Check = (v: unknown, path: string, add: Add) => boolean

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function num(min = -Infinity, max = Infinity): Check {
  return (v, path, add) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      add(`${path}: ${JSON.stringify(v)} is not a number in [${min}, ${max}]`)
      return false
    }
    return true
  }
}

function int(min = -Infinity, max = Infinity): Check {
  return (v, path, add) => {
    if (
      !Number.isSafeInteger(v) ||
      (v as number) < min ||
      (v as number) > max
    ) {
      add(`${path}: ${JSON.stringify(v)} is not an integer in [${min}, ${max}]`)
      return false
    }
    return true
  }
}

const bool: Check = (v, path, add) => {
  if (typeof v !== 'boolean') {
    add(`${path}: ${JSON.stringify(v)} is not a boolean`)
    return false
  }
  return true
}

const str: Check = (v, path, add) => {
  if (typeof v !== 'string') {
    add(`${path}: ${JSON.stringify(v)} is not a string`)
    return false
  }
  return true
}

function oneOf(values: readonly unknown[]): Check {
  return (v, path, add) => {
    if (!values.includes(v)) {
      add(`${path}: ${JSON.stringify(v)} is not one of ${values.join('|')}`)
      return false
    }
    return true
  }
}

function nullable(c: Check): Check {
  return (v, path, add) => v === null || c(v, path, add)
}

function arr(item: Check): Check {
  return (v, path, add) => {
    if (!Array.isArray(v)) {
      add(`${path}: not an array`)
      return false
    }
    v.forEach((x, i) => item(x, `${path}[${i}]`, add))
    return true
  }
}

/** A plain object with these fields (keys ending in '?' may be absent). */
function obj(fields: Record<string, Check>): Check {
  return (v, path, add) => {
    if (!isObj(v)) {
      add(`${path}: not an object`)
      return false
    }
    for (const [k, c] of Object.entries(fields)) {
      const optional = k.endsWith('?')
      const key = optional ? k.slice(0, -1) : k
      if (!(key in v)) {
        if (!optional) add(`${path}.${key}: missing`)
        continue
      }
      c(v[key], `${path}.${key}`, add)
    }
    return true
  }
}

/** A string-keyed record of `item`. */
function rec(item: Check): Check {
  return (v, path, add) => {
    if (!isObj(v)) {
      add(`${path}: not an object`)
      return false
    }
    for (const [k, x] of Object.entries(v)) item(x, `${path}.${k}`, add)
    return true
  }
}

const VEHICLE_STATES = [
  'idle_lot',
  'queued',
  'docked_unloading',
  'docked_loading',
  'delivering',
  'collecting',
  'returning',
  'inactive',
]
const PARCEL_STATES = [
  'waiting',
  'picked_up',
  'in_transit_in',
  'unloading',
  'in_conveyor',
  'in_slot',
  'held',
  'tossed',
  'on_shelf',
  'loaded',
  'in_transit_out',
  'delivered',
  'handed_off',
  'clearing',
  'cleared',
]
const NODE_KINDS = ['dock', 'conveyor', 'slot', 'holdBay', 'bin', 'shelf']
const SIZES = ['S', 'M', 'L', 'XL']
const HEADINGS = ['NE', 'SE', 'SW', 'NW']
const STALL_REASONS = ['holdBayFull', 'shelfFull', 'bufferFull']
const STOP_KINDS = ['deliver', 'collect', 'handoff']

/**
 * Sanity bounds, far past anything a run reaches (a 90-minute game: tick
 * 54,000, ~$25,000 earned), that keep every later sum inside the safe
 * integers: a tick, an id or a count ≤ 1e12; money totals ≤ 1e12; one
 * parcel's value or one price ≤ 1e9; a value multiplier ≤ 1000.
 */
const MAX_COUNT = 1e12
const MAX_MONEY = 1e12
const MAX_PRICE = 1e9

const tick = int(0, MAX_COUNT)
const count = int(0, MAX_COUNT)
const id = int(1, MAX_COUNT)
const ids = arr(id)
const money = int(0, MAX_MONEY)
const price = num(0, MAX_PRICE)

const maxId = (xs: number[]): number => xs.reduce((m, x) => Math.max(m, x), 0)

/**
 * Why `state` cannot be run by this build's systems (empty = runnable):
 * field types, enum values and data ids, plus the few relations the
 * movement and id counters depend on (a vehicle's path on the drive graph
 * with its index and edge progress in range, its stop index; nextId past
 * every id in use).
 */
export function stateShapeProblems(state: unknown, data: GameData): string[] {
  const out: string[] = []
  const add: Add = (m) => {
    if (out.length < 50) out.push(m)
  }
  const buildingIds = data.buildings.map((b) => b.id)
  const districtIds = data.districts.map((d) => d.id)
  const strainIds = data.parcels.malware.strains.map((s) => s.id)
  const building = oneOf(buildingIds)
  const district = oneOf(districtIds)
  const strain = oneOf(strainIds)
  const graph = roadGraph(data)
  const [mapW, mapH] = data.map.size
  const tilePos = obj({ tx: num(0, mapW - 1), ty: num(0, mapH - 1) })
  const tile: Check = (v, path, a) => {
    if (!obj({ x: int(), y: int() })(v, path, a)) return false
    const t = v as { x: number; y: number }
    if (Number.isSafeInteger(t.x) && Number.isSafeInteger(t.y)) {
      if (!graph.isNode(t.x, t.y))
        a(`${path}: (${t.x},${t.y}) is off the drive graph`)
    }
    return true
  }

  const checker = obj({
    id: str,
    kind: oneOf(['machine', 'desk']),
    defId: str,
    strain: oneOf([...strainIds, 'any']),
    pMatch: num(0, 1),
    pOther: num(0, 1),
    decoyFlag: num(0, 1),
    processTicks: count,
    stations: count,
    price,
    boughtTick: tick,
  })
  const fixture: Check = (v, path, a) => {
    if (!isObj(v)) {
      a(`${path}: not an object`)
      return false
    }
    if (v.kind === 'machine') return obj({ checker })(v, path, a)
    if (v.kind === 'desk') {
      return obj({ checker, inspectorIds: ids, walkedOutIds: ids })(v, path, a)
    }
    a(`${path}.kind: ${JSON.stringify(v.kind)} is not machine|desk`)
    return false
  }

  const shape = obj({
    // Build 2 only (plan.md R9): a version-1 state never loads.
    version: oneOf([STATE_VERSION]),
    seed: int(),
    rng: int(0, 0xffffffff),
    tick,
    day: count,
    economy: obj({
      balance: money,
      lifetimeEarned: money,
      lives: int(0, data.economy.lives.cap),
      gameOver: bool,
      victory: bool,
      daysSinceIncident: count,
      lastPayroll: nullable(obj({ tick, paid: money, shortEmployeeIds: ids })),
    }),
    level: obj({
      level: oneOf(data.levels.map((l) => l.level)),
      nextThreshold: nullable(num(0, MAX_MONEY)),
      unlocked: arr(district),
      announced: rec(tick),
      slots: count,
      holdBayCap: count,
      shelfCap: count,
      warehouseTier: count,
    }),
    spawn: obj({
      spawnedCount: count,
      malwareCount: count,
      scriptedDone: bool,
      scriptedDeferredUntilTick: nullable(tick),
      magicAlive: count,
    }),
    districts: rec(
      obj({
        id: district,
        live: bool,
        satisfaction: num(-MAX_PRICE, MAX_PRICE),
        nextSpawnTick: nullable(tick),
        dayPositive: num(-MAX_PRICE, MAX_PRICE),
        dayWaitingPenalty: num(-MAX_PRICE, MAX_PRICE),
        satisfactionAtDayStart: num(-MAX_PRICE, MAX_PRICE),
        earned: num(0, MAX_MONEY),
      }),
    ),
    buildings: rec(
      obj({ id: building, waiting: ids, rushUntilTick: nullable(tick) }),
    ),
    vehicles: arr(
      obj({
        id,
        type: oneOf(data.vehicles.types.map((t) => t.id)),
        name: str,
        driverId: nullable(id),
        state: oneOf(VEHICLE_STATES),
        zone: oneOf(['any', ...districtIds]),
        pos: tilePos,
        prev: tilePos,
        heading: oneOf(HEADINGS),
        wheel: oneOf([0, 1]),
        path: arr(tile),
        pathIndex: count,
        edgeT: count,
        stops: arr(
          obj({
            kind: oneOf(STOP_KINDS),
            buildingId: building,
            tile,
            parcelIds: ids,
          }),
        ),
        stopIndex: count,
        cargo: ids,
        unitsUsed: count,
        reserved: ids,
        dockId: nullable(str),
        waitUntilTick: nullable(tick),
        rushBuildingId: nullable(building),
        collectedThisLeg: bool,
        purchasePrice: price,
        boughtTick: tick,
      }),
    ),
    employees: arr(
      obj({
        id,
        kind: oneOf(['inspector', 'driver']),
        name: str,
        hiredTick: tick,
        salaryPerDay: price,
        unpaidPaydays: count,
        active: bool,
        vehicleId: nullable(id),
        nodeId: nullable(str),
      }),
    ),
    parcels: rec(
      obj({
        id,
        size: oneOf(SIZES),
        baseValue: price,
        mult: num(0, 1000),
        origin: building,
        dest: building,
        destRegion: district,
        spawnedTick: tick,
        label: str,
        malware: bool,
        strain: nullable(strain),
        decoy: nullable(strain),
        magic: bool,
        scripted: bool,
        state: oneOf(PARCEL_STATES),
        reservedBy: nullable(id),
        vehicleId: nullable(id),
        nodeId: nullable(str),
        nodeEnterTick: nullable(tick),
        nodeDoneTick: nullable(tick),
        flaggedBy: nullable(str),
        flaggedStrain: nullable(strain),
        lockedValue: nullable(price),
        clearTick: nullable(tick),
        trace: arr(
          obj({
            tick,
            what: str,
            ref: nullable(str),
            'text?': str,
            'chk?': str,
            'p?': num(0, 1),
          }),
        ),
        'bay?': int(0, 1000),
      }),
    ),
    lane: obj({
      nodes: arr(
        obj({
          id: str,
          kind: oneOf(NODE_KINDS),
          next: arr(str),
          'divert?': str,
          'locked?': obj({ level: int(1) }),
          cap: nullable(count),
          queue: ids,
          fixture: nullable(fixture),
          stations: arr(
            obj({ parcelId: nullable(id), doneTick: nullable(tick) }),
          ),
          dockId: nullable(str),
        }),
      ),
      docks: arr(
        obj({
          id: str,
          conveyorNodeId: str,
          vehicleId: nullable(id),
          nextTransferTick: nullable(tick),
          busyTicksThisDay: count,
          'blockedTicksThisDay?': count,
          stuckSinceTick: nullable(tick),
          'relief?': oneOf([true]),
        }),
      ),
      slotNodeIds: arr(str),
      holdBayNodeId: str,
      binNodeId: str,
      shelfNodeId: str,
      stalled: bool,
      stallReason: nullable(oneOf(STALL_REASONS)),
      stallNodeId: nullable(str),
      stallSinceTick: nullable(tick),
      stallSecondsToday: num(0, MAX_COUNT),
      quarantine: obj({ count, malware: count, clean: count }),
      sorterArm: bool,
      dockQueue: ids,
      'debugForceFlag?': strain,
    }),
    stats: obj({
      deliveries: count,
      onTime: count,
      late: count,
      malwareSpawned: count,
      malwareCaught: count,
      malwareMissed: count,
      wrongToss: count,
      firstDeliveryTick: nullable(tick),
      firstCatchTick: nullable(tick),
      levelTick: rec(tick),
      truckTick: nullable(tick),
      income: money,
      payrollPaid: money,
      holdBayEvents: count,
      minutes: arr(obj({ min: count, tick })),
    }),
    lastLostLife: nullable(
      obj({ tick, parcelId: id, label: str, path: arr(obj({ tick })) }),
    ),
    nextId: obj({ parcel: id, vehicle: id, employee: id, checker: id }),
  })
  if (!shape(state, 'state', add) || out.length > 0) return out

  // Relations the movement and the id counters rely on.
  const s = state as SimState
  for (const [k, d] of Object.entries(s.districts)) {
    if (d.id !== k) add(`state.districts.${k}.id: ${d.id} ≠ its key`)
  }
  for (const [k, b] of Object.entries(s.buildings)) {
    if (b.id !== k) add(`state.buildings.${k}.id: ${b.id} ≠ its key`)
  }
  for (const v of s.vehicles) {
    const at = `state.vehicles(${v.id})`
    if (v.path.length > 0) {
      if (v.pathIndex > Math.max(0, v.path.length - 2)) {
        add(
          `${at}.pathIndex: ${v.pathIndex} past its ${v.path.length}-tile path`,
        )
      }
      const a = v.path[v.pathIndex]
      const b = v.path[v.pathIndex + 1]
      const len = a && b ? Math.abs(b.x - a.x) + Math.abs(b.y - a.y) : 0
      if (v.edgeT > 0 && v.edgeT >= 1000 * len) {
        add(`${at}.edgeT: ${v.edgeT} past its edge`)
      }
    }
    if (v.path.length === 0) {
      // At rest a vehicle stands on a drive-graph tile (a new route starts there).
      const x = Math.round(v.pos.tx)
      const y = Math.round(v.pos.ty)
      if (!graph.isNode(x, y))
        add(`${at}.pos: (${x},${y}) is off the drive graph`)
    }
    if (v.stopIndex > v.stops.length) {
      add(`${at}.stopIndex: ${v.stopIndex} > ${v.stops.length} stops`)
    }
  }
  const n = s.nextId
  const parcelMax = maxId(Object.values(s.parcels).map((p) => p.id))
  if (n.parcel <= parcelMax)
    add(`state.nextId.parcel: ${n.parcel} ≤ parcel ${parcelMax}`)
  const vehicleMax = maxId(s.vehicles.map((v) => v.id))
  if (n.vehicle <= vehicleMax)
    add(`state.nextId.vehicle: ${n.vehicle} ≤ vehicle ${vehicleMax}`)
  const employeeMax = maxId(s.employees.map((e) => e.id))
  if (n.employee <= employeeMax)
    add(`state.nextId.employee: ${n.employee} ≤ employee ${employeeMax}`)
  const checkerMax = maxId(
    s.lane.nodes.flatMap((x) => {
      const m = /^chk(\d+)$/.exec(x.fixture?.checker.id ?? '')
      return m ? [Number(m[1])] : []
    }),
  )
  if (n.checker <= checkerMax)
    add(`state.nextId.checker: ${n.checker} ≤ chk${checkerMax}`)
  return out
}
