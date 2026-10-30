// People (spec-build2 §2; plan-build2 §8.3 tasks 1-3, 6): hireable
// inspectors, sorters and drivers whose stats are pips mapped to numbers by
// employees.json `roles`, the per-role applicant pools, salaries and hire
// fees, star applicants with their expiry, hire / fire, the desk crews
// (per-inspector p with the same-desk charisma bonus), the driver Replace
// that lands after the trip, and the wanted list.
//
// Determinism: applicants roll on their OWN mulberry32 stream
// (`state.applicants.rng`, seeded from the run seed ^ PEOPLE_RNG_SALT, saved
// with the state) — never on `state.rng` — so opening a HireSheet, posting an
// ad or picking an applicant never moves a spawn or a checker roll (design
// D1). Draw order for one applicant: name (rng.pick over the free names;
// none free → freshName, no draw), look (rng.int), then one weighted draw per
// stat in the role's `stats` order, then (drivers) the affinity.
//
// Numbers (index = pip − 1; charisma index = pip):
//   inspector p = p[eye], decoyFlag[eye], processS[pace]; its effective p at
//     a desk adds charismaBonus[c] of every OTHER active inspector seated at
//     the same desk, capped at pCap, rounded to 4 dp (Q-B2-5: per desk);
//   sorter correct[judgement], decisionS[pace];
//   driver speedMult[min(5, speed + affinity bonus)], stopMult[energy],
//     charismaDelivery[c] / charismaPickup[c].
// Salaries: inspector / sorter round(base + perPip × Σ pips + perCharisma ×
// charisma); driver round(classBase × (base + perPip × (speed + energy) +
// perCharisma × charisma)) with classBase = vehicles.json driverSalaryPerDay.
// Hire fee = salary × hireFeeDays (0 for a ★ applicant).

import type {
  AffinityId,
  GameData,
  StarApplicantDef,
  StatId,
} from '../../data/types.ts'
import { Rng } from '../rng.ts'
import type { Sim } from '../sim.ts'
import type {
  Applicant,
  Employee,
  HireTarget,
  LaneNode,
  Pips,
  Role,
  SimState,
  Station,
  Vehicle,
  VehicleType,
} from '../types.ts'
import { TICKS_PER_DAY, ticksFromS } from '../types.ts'
import { goIdle, goInactive } from './dispatch.ts'
import { hasDriver } from './vehicles.ts'

/** XOR'd into the seed word for the applicant stream (golden-ratio constant). */
export const PEOPLE_RNG_SALT = 0x9e3779b9
/** face_00..face_11 (3 skins × 4 hair/hat; an art constant, not balance). */
export const FACE_LOOKS = 12
/** Role order: pools, day refresh, start rolls. */
export const ROLES: readonly Role[] = ['inspector', 'sorter', 'driver']
/** Affinity draw order (fixed, not JSON key order). */
export const AFFINITIES: readonly AffinityId[] = [
  'none',
  'bike',
  'van',
  'truck',
]

/** Anything with the state and the tables (a Sim, or the start-state builder). */
export type SimLike = Pick<Sim, 'state' | 'data'>

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6

/** A pip value clamped to its table (stats 1-5, charisma 0-2). */
function pip(pips: Pips, stat: StatId): number {
  const v = pips[stat]
  if (stat === 'charisma') {
    return v === undefined ? 0 : Math.min(2, Math.max(0, Math.round(v)))
  }
  return v === undefined ? 3 : Math.min(5, Math.max(1, Math.round(v)))
}

const at = (xs: readonly number[], i: number): number => xs[i] ?? 0
const mean = (xs: readonly number[]): number =>
  xs.reduce((sum, x) => sum + x, 0) / xs.length

// Numbers ------------------------------------------------------------------------

/** The applicant stream (cached on the Sim; never state.rng). */
export function peopleRng(sim: Sim): Rng {
  return sim.peopleRng
}

/** An inspector's own numbers (no colleagues): p, decoyFlag, process ticks. */
export function inspectorNumbers(
  data: GameData,
  pips: Pips,
): { p: number; decoyFlag: number; processTicks: number } {
  const r = data.employees.roles.inspector
  const eye = pip(pips, 'eye')
  return {
    p: at(r.p, eye - 1),
    decoyFlag: at(r.decoyFlag, eye - 1),
    processTicks: ticksFromS(at(r.processS, pip(pips, 'pace') - 1)),
  }
}

/** A sorter's numbers: correct-call chance and ticks per decision. */
export function sorterNumbers(
  data: GameData,
  pips: Pips,
): { correct: number; decisionTicks: number } {
  const r = data.employees.roles.sorter
  return {
    correct: at(r.correct, pip(pips, 'judgement') - 1),
    decisionTicks: ticksFromS(at(r.decisionS, pip(pips, 'pace') - 1)),
  }
}

/** A driver's numbers in a vehicle of `type` (affinity counted). */
export function driverNumbers(
  data: GameData,
  pips: Pips,
  affinity: AffinityId,
  type: VehicleType,
): {
  speedMult: number
  stopMult: number
  deliveryBonus: number
  pickupBonus: number
} {
  const r = data.employees.roles.driver
  const bonus = affinity === type ? r.affinityPips : 0
  const eff = Math.min(5, pip(pips, 'speed') + bonus)
  const c = pip(pips, 'charisma')
  return {
    speedMult: at(r.speedMult, eff - 1),
    stopMult: at(r.stopMult, pip(pips, 'energy') - 1),
    deliveryBonus: at(r.charismaDelivery, c),
    pickupBonus: at(r.charismaPickup, c),
  }
}

/**
 * An inspector's p at a desk: own p + charismaBonus of every OTHER active
 * inspector at the same desk (`colleagues`), ≤ pCap, rounded to 4 dp.
 */
export function effectiveP(
  data: GameData,
  pips: Pips,
  colleagues: readonly Pips[],
): number {
  const r = data.employees.roles.inspector
  let p = at(r.p, pip(pips, 'eye') - 1)
  for (const c of colleagues) p += at(r.charismaBonus, pip(c, 'charisma'))
  return round4(Math.min(r.pCap, p))
}

/** $/day (spec-build2 §2.2); a driver's for vehicle class `type` (default bike). */
export function salaryOf(
  data: GameData,
  role: Role,
  pips: Pips,
  type: VehicleType = 'bike',
): number {
  const r = data.employees.roles[role]
  const sal = r.salary
  if (role === 'driver') {
    const base =
      data.vehicles.types.find((t) => t.id === type)?.driverSalaryPerDay ?? 0
    const k =
      sal.base +
      sal.perPip * (pip(pips, 'speed') + pip(pips, 'energy')) +
      sal.perCharisma * pip(pips, 'charisma')
    return Math.round(round6(base * k))
  }
  let sum = 0
  for (const stat of r.stats) if (stat !== 'charisma') sum += pip(pips, stat)
  const charisma = r.stats.includes('charisma') ? pip(pips, 'charisma') : 0
  return Math.round(sal.base + sal.perPip * sum + sal.perCharisma * charisma)
}

/** One day's salary × hireFeeDays; 0 for a ★ applicant. */
export function hireFeeOf(
  data: GameData,
  a: Pick<Applicant, 'role' | 'pips' | 'star'>,
  type?: VehicleType,
): number {
  if (a.star) return 0
  const days = data.employees.roles[a.role].hireFeeDays
  return Math.round(salaryOf(data, a.role, a.pips, type) * days)
}

// Lookups -------------------------------------------------------------------------

export function employeeById(state: SimState, id: number): Employee | null {
  return state.employees.find((e) => e.id === id) ?? null
}

/** The desk node an inspector sits at (or walked out of), or null. */
export function deskNodeOf(
  state: SimState,
  employeeId: number,
): LaneNode | null {
  return (
    state.lane.nodes.find(
      (n) =>
        n.fixture?.kind === 'desk' &&
        (n.fixture.inspectorIds.includes(employeeId) ||
          n.fixture.walkedOutIds.includes(employeeId)),
    ) ?? null
  )
}

/** The vehicle's current driver (active or walked out), or null with none. */
export function driverOf(sim: SimLike, v: Vehicle): Employee | null {
  return v.driverId === null ? null : employeeById(sim.state, v.driverId)
}

// Names -----------------------------------------------------------------------------

/** First pool name unused by `used`; then "Name 2", "Name 3"… (deterministic, no rng). */
export function freshName(
  pool: readonly string[],
  used: readonly string[],
): string {
  for (let round = 1; ; round++) {
    for (const name of pool) {
      const candidate = round === 1 ? name : `${name} ${round}`
      if (!used.includes(candidate)) return candidate
    }
    if (pool.length === 0) return `Worker ${used.length + 1}`
  }
}

/** Every employee's and every waiting applicant's name. */
function takenNames(state: SimState): string[] {
  const out = state.employees.map((e) => e.name)
  for (const r of ROLES) for (const a of state.applicants[r]) out.push(a.name)
  return out
}

// Applicant pools ---------------------------------------------------------------------

/** pipWeights band: the largest key ≤ the company level ("1" always exists). */
function pipRow(state: SimState, data: GameData): number[] {
  const w = data.employees.applicants.pipWeights
  let best = 1
  for (const k of Object.keys(w)) {
    const n = Number(k)
    if (Number.isInteger(n) && n <= state.level.level && n > best) best = n
  }
  return w[String(best)] ?? w['1'] ?? [1, 1, 1, 1, 1]
}

/** Roll one regular applicant (draw order in the header); not placed in a pool. */
function rollApplicant(
  state: SimState,
  data: GameData,
  rng: Rng,
  role: Role,
  exclude: readonly string[] = [],
): Applicant {
  const ap = data.employees.applicants
  const taken = [...takenNames(state), ...exclude]
  const pool = data.puns.peopleNames
  const free = pool.filter((n) => !taken.includes(n))
  const name = free.length > 0 ? rng.pick(free) : freshName(pool, taken)
  const look = rng.int(FACE_LOOKS)
  const row = pipRow(state, data)
  const pips: Pips = {}
  for (const stat of data.employees.roles[role].stats) {
    pips[stat] =
      stat === 'charisma'
        ? (rng.weighted([0, 1, 2], (c) => at(ap.charismaWeights, c)) ?? 0)
        : (rng.weighted([1, 2, 3, 4, 5], (k) => at(row, k - 1)) ?? 1)
  }
  const affinity =
    role === 'driver'
      ? (rng.weighted(AFFINITIES, (a) => ap.affinityWeights[a] ?? 0) ?? 'none')
      : 'none'
  const id = state.nextId.applicant
  state.nextId.applicant += 1
  return {
    id,
    role,
    name,
    pips,
    affinity,
    look,
    star: false,
    leavesOnDay: null,
  }
}

/** Regulars rolled onto the end of a pool until it holds poolSize. */
function topUp(state: SimState, data: GameData, rng: Rng, role: Role): void {
  const size = data.employees.applicants.poolSize
  const pool = state.applicants[role]
  while (pool.length < size) pool.push(rollApplicant(state, data, rng, role))
}

/** The tick-0 pools: inspector, sorter, driver (poolSize each). No events. */
export function startApplicants(state: SimState, data: GameData): void {
  const rng = new Rng(() => state.applicants)
  for (const r of ROLES) topUp(state, data, rng, r)
}

/**
 * Today's applicants (a day boundary, or a posted ad, Q-B2-6): ★ applicants
 * stay at the front, the regulars are replaced by fresh rolls.
 */
export function refreshPool(sim: Sim, role: Role, reason: 'day' | 'ad'): void {
  const s = sim.state
  s.applicants[role] = s.applicants[role].filter((a) => a.star)
  topUp(s, sim.data, sim.peopleRng, role)
  sim.emit('applicants:refreshed', { role, reason })
}

/**
 * Day step (after payday): ★ applicants past their day leave with a ticker
 * line (design D6) and the pool tops up; then every refreshEveryDays the
 * three pools refresh (role order).
 */
export function peopleDayStep(sim: Sim): void {
  const s = sim.state
  for (const role of ROLES) {
    const pool = s.applicants[role]
    const leaving = pool.filter(
      (a) => a.star && a.leavesOnDay !== null && a.leavesOnDay <= s.day,
    )
    if (leaving.length === 0) continue
    s.applicants[role] = pool.filter((a) => !leaving.includes(a))
    for (const a of leaving) {
      sim.emit('ticker:news', {
        text: `${a.name} took another job`,
        kind: 'worker',
      })
    }
    topUp(s, sim.data, sim.peopleRng, role)
    sim.emit('applicants:refreshed', { role, reason: 'starLeft' })
  }
  const every = Math.max(1, sim.data.employees.applicants.refreshEveryDays)
  if (s.day % every === 0) {
    for (const role of ROLES) refreshPool(sim, role, 'day')
  }
}

/**
 * The day whose boundary removes a ★ added at `tick`: the first boundary at
 * least starExpiryDays × TICKS_PER_DAY ticks later (spec-build2 §2.7 "stays
 * for starExpiryDays"), so a ★ arriving on a day's last tick still gets two
 * full days (it stays [2, 3) days, never less).
 */
export function starLeavesOnDay(data: GameData, tick: number): number {
  const stay = data.employees.applicants.starExpiryDays * TICKS_PER_DAY
  return Math.ceil((tick + stay) / TICKS_PER_DAY)
}

/**
 * Whole days a ★ still waits at `tick` (the HireSheet's `leaves in 2d`; 0 =
 * `leaves today`): floor of the ticks left to its leaving boundary, so a
 * fresh ★ always reads starExpiryDays.
 */
export function starDaysLeft(leavesOnDay: number, tick: number): number {
  return Math.max(
    0,
    Math.floor((leavesOnDay * TICKS_PER_DAY - tick) / TICKS_PER_DAY),
  )
}

/**
 * A ★ applicant joins its role's pool (M7 quest rewards): free to hire,
 * leaves at the day boundary starLeavesOnDay (≥ starExpiryDays after it
 * arrives); inserted after the stars already waiting; the last regular
 * leaves so the pool keeps poolSize (design D5). The same ★ already waiting
 * — matched by `starKey`, the def's name, so a ★ renamed "Vera 2" (a name
 * clash with an employee → freshName) still matches — only has its expiry
 * refreshed. A regular applicant holding the star's name anywhere is
 * re-rolled in place first.
 */
export function addStarApplicant(sim: Sim, def: StarApplicantDef): Applicant {
  const s = sim.state
  const data = sim.data
  const role = def.role
  const pool = s.applicants[role]
  const leavesOnDay = starLeavesOnDay(data, s.tick)
  const waiting = pool.find((a) => a.star && (a.starKey ?? a.name) === def.name)
  if (waiting) {
    waiting.leavesOnDay = leavesOnDay
    sim.emit('applicants:refreshed', { role, reason: 'star' })
    return waiting
  }
  const staff = s.employees.map((e) => e.name)
  const name = staff.includes(def.name)
    ? freshName([def.name], [...staff, ...takenNames(s)])
    : def.name
  // A regular holding that name anywhere is re-rolled in place (new id).
  for (const r of ROLES) {
    const list = s.applicants[r]
    for (let i = 0; i < list.length; i++) {
      if (list[i]?.star || list[i]?.name !== name) continue
      list.splice(i, 1)
      list.splice(i, 0, rollApplicant(s, data, sim.peopleRng, r, [name]))
    }
  }
  const pips: Pips = {}
  for (const stat of data.employees.roles[role].stats) {
    pips[stat] = pip(def.pips, stat)
  }
  const star: Applicant = {
    id: s.nextId.applicant,
    role,
    name,
    pips,
    affinity: role === 'driver' ? (def.affinity ?? 'none') : 'none',
    look: sim.peopleRng.int(FACE_LOOKS),
    star: true,
    leavesOnDay,
    starKey: def.name,
  }
  s.nextId.applicant += 1
  const list = s.applicants[role]
  const stars = list.filter((a) => a.star).length
  list.splice(stars, 0, star)
  const size = data.employees.applicants.poolSize
  while (list.length > size) {
    // The last regular leaves; a pool of stars only drops its oldest star.
    const last = list.findLastIndex((a) => !a.star)
    list.splice(last >= 0 ? last : 0, 1)
  }
  sim.emit('applicants:refreshed', { role, reason: 'star' })
  return star
}

// Hire / fire ------------------------------------------------------------------------

/** The emitted role-specific location fields of an employee. */
function where(e: Employee): {
  nodeId: string | null
  vehicleId: number | null
} {
  return { nodeId: e.nodeId, vehicleId: e.vehicleId }
}

/** Remove an employee row and emit `worker:fired` (no seat logic). */
function dropEmployee(
  sim: Sim,
  e: Employee,
  reason: 'fired' | 'replaced' | 'deskRemoved',
): void {
  sim.state.employees = sim.state.employees.filter((x) => x.id !== e.id)
  sim.emit('worker:fired', {
    employeeId: e.id,
    role: e.role,
    ...where(e),
    reason,
  })
}

/**
 * A vehicle is "on the lot" for a Replace (design §4.5): parked, inactive,
 * or queued / in the dock with nothing aboard.
 */
function onLot(v: Vehicle): boolean {
  if (v.state === 'idle_lot' || v.state === 'inactive') return true
  const dockish =
    v.state === 'queued' ||
    v.state === 'docked_unloading' ||
    v.state === 'docked_loading'
  return dockish && v.cargo.length === 0
}

/**
 * Hire an applicant (the command handlers checked everything): the Employee
 * (hiredTick now, salary fixed — a driver's for `vehicle`'s class), the fee
 * ('hire'), the seat — inspector: the desk's crew + syncDesk; sorter: the
 * Hold Bay station (a seated sorter is replaced); driver: §4.5 (a driverless
 * vehicle drives at once; a Replace swaps now on the lot, else after the
 * trip) — then `worker:hired`, the pool topped up, `applicants:refreshed`.
 * Event order: worker:fired (replaced) → money:changed → worker:hired →
 * applicants:refreshed.
 */
export function hireApplicant(
  sim: Sim,
  a: Applicant,
  target: HireTarget,
  vehicle?: Vehicle,
): Employee {
  const s = sim.state
  const data = sim.data
  const fee = hireFeeOf(data, a, vehicle?.type)
  s.applicants[a.role] = s.applicants[a.role].filter((x) => x.id !== a.id)
  const e: Employee = {
    id: s.nextId.employee,
    role: a.role,
    name: a.name,
    hiredTick: s.tick,
    salaryPerDay: salaryOf(data, a.role, a.pips, vehicle?.type),
    unpaidPaydays: 0,
    active: true,
    vehicleId: null,
    nodeId: null,
    pips: { ...a.pips },
    affinity: a.affinity,
    look: a.look,
    star: a.star,
  }
  s.nextId.employee += 1
  s.employees.push(e)
  seat(sim, e, target, vehicle)
  if (fee > 0) sim.debit(fee, 'hire')
  sim.emit('worker:hired', {
    employeeId: e.id,
    role: e.role,
    ...where(e),
    pips: { ...e.pips },
    star: e.star,
    rehire: false,
  })
  topUp(s, data, sim.peopleRng, a.role)
  sim.emit('applicants:refreshed', { role: a.role, reason: 'hire' })
  return e
}

/** Seat a new employee at its target (see hireApplicant). */
function seat(
  sim: Sim,
  e: Employee,
  target: HireTarget,
  vehicle: Vehicle | undefined,
): void {
  const s = sim.state
  if ('nodeId' in target) {
    const node = s.lane.nodes.find((n) => n.id === target.nodeId)
    if (node?.fixture?.kind !== 'desk') return
    node.fixture.inspectorIds.push(e.id)
    e.nodeId = node.id
    syncDesk(sim, node)
    return
  }
  if ('station' in target) {
    const hs = s.lane.holdStation
    if (typeof hs.fixture === 'number') {
      const old = employeeById(s, hs.fixture)
      if (old) fireEmployee(sim, old, 'replaced')
    }
    hs.fixture = e.id
    hs.nextDecisionTick = null
    e.nodeId = s.lane.holdBayNodeId
    return
  }
  const v = vehicle ?? s.vehicles.find((x) => x.id === target.vehicleId)
  if (!v) return
  e.vehicleId = v.id
  if (v.driverId === null) {
    v.driverId = e.id
    delete v.tripMults
    if (v.state === 'inactive' && hasDriver(sim, v)) goIdle(sim, v)
    return
  }
  // Replace (design D2): a previous pending driver is replaced too.
  if (v.nextDriverId !== null) {
    const pending = employeeById(s, v.nextDriverId)
    v.nextDriverId = null
    if (pending) dropEmployee(sim, pending, 'replaced')
  }
  v.nextDriverId = e.id
  if (onLot(v)) swapPendingDriver(sim, v)
}

/**
 * The pending driver takes the wheel (a Replace on the lot, or once the trip
 * is over and the vehicle is back on the lot — dispatch.ts goInactive): the
 * old driver leaves (`worker:fired {reason: 'replaced'}`), an `inactive`
 * vehicle goes idle. A pending driver who is no longer active (payroll.ts
 * walkOut cancels the Replace at once; this guards an older state) never
 * takes the wheel: the Replace lapses and the current driver stays.
 */
export function swapPendingDriver(sim: Sim, v: Vehicle): void {
  if (v.nextDriverId === null) return
  if (!employeeById(sim.state, v.nextDriverId)?.active) {
    dropPendingDriver(sim, v)
    if (v.state === 'inactive' && hasDriver(sim, v)) goIdle(sim, v)
    return
  }
  const old = driverOf(sim, v)
  v.driverId = v.nextDriverId
  v.nextDriverId = null
  if (old && old.id !== v.driverId) dropEmployee(sim, old, 'replaced')
  if (v.state === 'inactive' && hasDriver(sim, v)) goIdle(sim, v)
}

/**
 * Cancel a pending Replace (the newcomer walked out before taking the wheel,
 * payroll.ts walkOut): they leave (`worker:fired {reason: 'replaced'}`, no
 * HUD toast — the walkout already made one), the current driver stays and
 * the vehicle carries on (hasDriver is the current driver's again).
 */
export function dropPendingDriver(sim: Sim, v: Vehicle): void {
  if (v.nextDriverId === null) return
  const pending = employeeById(sim.state, v.nextDriverId)
  v.nextDriverId = null
  if (pending) dropEmployee(sim, pending, 'replaced')
}

/**
 * An employee leaves for good (Fire, a replacement, a removed desk; active
 * or walked out — design D10): inspector → off its desk (syncDesk: its
 * station's parcel back to the buffer front); sorter → the station empties;
 * driver → a pending one is dropped, the current one's pending successor
 * takes over at once, else the vehicle has no driver (on the lot it parks
 * `inactive`; mid-trip it finishes the trip, then parks). No refund.
 */
export function fireEmployee(
  sim: Sim,
  e: Employee,
  reason: 'fired' | 'replaced' | 'deskRemoved',
): void {
  const s = sim.state
  if (e.role === 'inspector') {
    const node = deskNodeOf(s, e.id)
    s.employees = s.employees.filter((x) => x.id !== e.id)
    if (node?.fixture?.kind === 'desk') {
      const f = node.fixture
      f.inspectorIds = f.inspectorIds.filter((id) => id !== e.id)
      f.walkedOutIds = f.walkedOutIds.filter((id) => id !== e.id)
      syncDesk(sim, node)
    }
  } else if (e.role === 'sorter') {
    s.employees = s.employees.filter((x) => x.id !== e.id)
    const hs = s.lane.holdStation
    if (hs.fixture === e.id) {
      hs.fixture = null
      hs.nextDecisionTick = null
    }
  } else {
    s.employees = s.employees.filter((x) => x.id !== e.id)
    const v = s.vehicles.find((x) => x.id === e.vehicleId)
    if (v && v.nextDriverId === e.id) {
      v.nextDriverId = null
    } else if (v && v.driverId === e.id) {
      const kept = driverNumbers(sim.data, e.pips, e.affinity, v.type)
      v.driverId = v.nextDriverId
      v.nextDriverId = null
      if (v.driverId === null) {
        const empty = v.cargo.length === 0
        if (
          v.state === 'idle_lot' ||
          (empty && (v.state === 'queued' || v.state === 'docked_loading'))
        ) {
          goInactive(sim, v)
        } else if (v.state !== 'inactive') {
          // It finishes the trip at the fired driver's pace, as after a
          // walkout (vehicles.ts driverMults; cleared by goInactive).
          v.tripMults = { speedMult: kept.speedMult, stopMult: kept.stopMult }
        }
      } else if (v.state === 'inactive' && hasDriver(sim, v)) {
        goIdle(sim, v)
      }
    }
  }
  sim.emit('worker:fired', {
    employeeId: e.id,
    role: e.role,
    ...where(e),
    reason,
  })
}

// Desks -------------------------------------------------------------------------------

/**
 * Rebuild a desk's stations from its crew (after every crew change): one
 * station per `inspectorIds[i]`, in order — a seated inspector keeps its
 * Station (parcel and doneTick untouched), a leaver's parcel goes back to
 * the buffer front, a newcomer gets a free one — then every station's p
 * (effectiveP with the same-desk colleagues), decoyFlag and process ticks,
 * and the desk checker's readout: stations = n, pMatch = pOther = mean p,
 * decoyFlag = mean, processTicks = round(mean) (display; B2 §2.3 "readout p
 * = mean"). With nobody seated the readout keeps the start-pip numbers.
 */
export function syncDesk(sim: SimLike, node: LaneNode): void {
  const f = node.fixture
  if (f?.kind !== 'desk') return
  const s = sim.state
  const data = sim.data
  const kept: Station[] = []
  const back: number[] = []
  const byId: Record<string, Station> = {}
  for (const st of node.stations) {
    if (st.employeeId !== undefined && f.inspectorIds.includes(st.employeeId)) {
      byId[String(st.employeeId)] ??= st
      if (byId[String(st.employeeId)] === st) continue
    }
    if (st.parcelId !== null) back.push(st.parcelId)
  }
  const crew = f.inspectorIds.map((id) => employeeById(s, id))
  f.inspectorIds.forEach((id, i) => {
    const st = byId[String(id)] ?? { parcelId: null, doneTick: null }
    const me = crew[i]
    const pips = me?.pips ?? data.employees.start.inspector.pips
    const colleagues = crew.flatMap((c, j) =>
      j !== i && c !== null && c.active ? [c.pips] : [],
    )
    const own = inspectorNumbers(data, pips)
    st.employeeId = id
    st.p = effectiveP(data, pips, colleagues)
    st.decoyFlag = own.decoyFlag
    st.processTicks = own.processTicks
    kept.push(st)
  })
  node.stations = kept
  if (back.length > 0) node.queue.unshift(...back)
  const c = f.checker
  c.stations = kept.length
  if (kept.length === 0) {
    const start = inspectorNumbers(data, data.employees.start.inspector.pips)
    c.pMatch = start.p
    c.pOther = start.p
    c.decoyFlag = start.decoyFlag
    c.processTicks = start.processTicks
    return
  }
  const p = round4(mean(kept.map((st) => st.p ?? 0)))
  c.pMatch = p
  c.pOther = p
  c.decoyFlag = round4(mean(kept.map((st) => st.decoyFlag ?? 0)))
  c.processTicks = Math.round(mean(kept.map((st) => st.processTicks ?? 0)))
}

// The Hold Bay sorter and the wanted list -------------------------------------------------

/** Append a malware label to `state.wanted` (deduped, reveal order). */
export function addWanted(state: SimState, label: string): void {
  if (!state.wanted.includes(label)) state.wanted.push(label)
}

/**
 * The player acted in the Hold Bay (Toss, Clear, a card opened — design D3):
 * a running sorter clock starts over, so the player's tap always wins.
 */
export function restartSorterClock(sim: Sim): void {
  const hs = sim.state.lane.holdStation
  if (typeof hs.fixture !== 'number' || hs.nextDecisionTick === null) return
  const e = employeeById(sim.state, hs.fixture)
  if (!e) return
  hs.nextDecisionTick =
    sim.state.tick + sorterNumbers(sim.data, e.pips).decisionTicks
}
