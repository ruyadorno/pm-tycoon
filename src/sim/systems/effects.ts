// Event effects (spec-build3 §3.5; M11 contract §3 stream C): every world
// effect kind an event option can carry (money, lives, satisfaction,
// modifiers, pips, vehicles, staff, the wanted list, parcels, the shelf cap,
// `end`), their generated summary lines, the modifier words, and the
// absence step. The deck-internal kinds (`next`, `flag`, `job`,
// `jobDecline`) are deck.ts's to apply; `job` still has its summary lines
// here (the Accept of a job card). Every draw an effect makes is on the
// content stream (Sim.eventPicksRng — the injected parcels' destinations),
// except the ★ and gift-driver looks, which stay on the people stream like
// every applicant (M11 critique 10, D-44).
//
// One target rule per kind, shared by the applier and the summary (so the
// card never promises what the sim does not do):
//   - money: a negative delta is clamped to the balance (Sim.debit throws on
//     an overdraft); moneyPct rounds |balance × pct| to whole dollars; event
//     cash is never lifetime earned (Q-B3-3).
//   - satisfaction / parcels `at`: 'all' = the live spawning districts,
//     'target' = the card's district, 'busiest' / 'lowest' resolved now, else
//     a live spawning district id.
//   - `one` picks: the card's pick of that role, still employed (pips) or
//     still active (quit, absent); otherwise a no-op, "(Audrey has left)".
//   - best / worst: the role's first stat (eye, judgement, speed) among the
//     active, on-duty staff (inspectors seated, the seated sorter, drivers at
//     the wheel), ties to the lowest id.
//   - vehicle lose: the oldest (min boughtTick, then id) of the type; its
//     drivers leave with `worker:fired {event}`; no refund.
//   - absence: Employee / Vehicle.absentUntilTick (the later of two
//     absences); absent inspectors have no station (people.ts syncDesk),
//     absent sorters call nothing, absent vehicles have no driver
//     (vehicles.ts hasDriver) and park when nothing is aboard; payday skips
//     the absent (payroll.ts payOrder). absenceStep ends them.
// Words: U+2212 for minus, never `≥` (D-20); durations "2 days" / "12h" /
// "for good".

import type {
  BuildingDef,
  EventEffect,
  ModifierKey,
  RoleId,
  SizeId,
  StarApplicantDef,
  StatId,
  VehicleTypeId,
} from '../../data/types.ts'
import { buildingOrder, mapIndex } from '../map.ts'
import { isLive, MULT_KEYS, modAdd, type ModCtx } from '../modifiers.ts'
import type { Sim } from '../sim.ts'
import type {
  CardPick,
  CardRefs,
  DistrictId,
  Employee,
  Modifier,
  Parcel,
  QuestReward,
  SimState,
  Vehicle,
} from '../types.ts'
import { daysToTicks, isAbsent, laneNode, TICKS_PER_DAY } from '../types.ts'
import { goIdle, goInactive } from './dispatch.ts'
import { loseLifeEvent } from './economy.ts'
import { takeFrom } from './lane.ts'
import { applyModifier, endModifiers } from './modifierOps.ts'
import {
  addStarApplicant,
  addWanted,
  deskNodeOf,
  fireEmployee,
  giftStarName,
  hireStar,
  resyncDesks,
  setPip,
  starApplicantName,
  syncDesk,
} from './people.ts'
import { gainLives, questLimitTicks, rewardSummary } from './quests.ts'
import {
  busiestDistrict,
  changeSatisfaction,
  liveSpawningDistricts,
  lowestDistrict,
} from './satisfaction.ts'
import { pickDestination, underCap } from './spawn.ts'
import { createVehicle, hasDriver, removeVehicle } from './vehicles.ts'

/** Who and what an applied effect acts for (the decided card). */
export interface EffectCtx {
  eventId: string
  title: string
  /** The chosen option's label (filled). */
  optionLabel: string
  optionIndex: number
  target: DistrictId | null
  pick: CardPick | null
  chainHeadId: string
  depth: number
}

/** One generated effect line and its tone (gain = good direction, cost = bad). */
export interface EffectLine {
  text: string
  tone: 'cost' | 'gain' | 'neutral'
}

type Tone = EffectLine['tone']
type Effect<K extends EventEffect['kind']> = Extract<EventEffect, { kind: K }>
type PipsEffect = Effect<'pips'>
type AbsentEffect = Extract<Effect<'staff'>, { absent: unknown }>
type QuitEffect = Extract<Effect<'staff'>, { quit: unknown }>

// Words ------------------------------------------------------------------------------

/** U+2212, the minus of every generated line. */
export const MINUS = '−'

const line = (text: string, good: boolean | null): EffectLine => ({
  text,
  tone: toneOf(good),
})

function toneOf(good: boolean | null): Tone {
  if (good === null) return 'neutral'
  return good ? 'gain' : 'cost'
}

/** Up to `dp` decimals, trailing zeros dropped ("0.92", "1.5", "3"). */
function num(x: number, dp = 2): string {
  return String(Number(x.toFixed(dp)))
}

/** "+3" / "−2" / "0" (U+2212). */
function signed(n: number, dp = 2): string {
  if (n > 0) return `+${num(n, dp)}`
  if (n < 0) return `${MINUS}${num(-n, dp)}`
  return '0'
}

/** "+$60" / "−$40" / "$0". */
function money(n: number): string {
  if (n > 0) return `+$${n}`
  if (n < 0) return `${MINUS}$${-n}`
  return '$0'
}

/** A fraction as a signed percentage: 0.03 → "+3 %", −0.025 → "−2.5 %". */
function pct(frac: number, dp = 1): string {
  return `${signed(frac * 100, dp)} %`
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  n === 1 ? one : many

/**
 * A duration in game days: whole days → "1 day" / "2 days", otherwise
 * hours ("12h"; 1 day = 24 h). Deck.ts fills `{days}` of the `then:` lines
 * with it.
 */
export function dayText(days: number): string {
  const whole = Math.round(days)
  if (whole >= 1 && Math.abs(days - whole) < 1e-9) {
    return `${whole} ${plural(whole, 'day')}`
  }
  return `${Math.max(1, Math.round(days * 24))}h`
}

/** " for 2 days" / " for 12h" / " for good" (a permanent modifier). */
function forDays(days: number | undefined): string {
  return days === undefined ? ' for good' : ` for ${dayText(days)}`
}

/** A district's display name (its flavour: "Registry Row"). */
function districtName(view: ModCtx, id: DistrictId): string {
  return mapIndex(view.data).districtById[id]?.flavour ?? id
}

/** "bike" / "vans" (the type's name, lower case). */
function vehicleWord(view: ModCtx, type: string, n: number): string {
  const name = (mapIndex(view.data).typeById[type]?.name ?? type).toLowerCase()
  return plural(n, name)
}

// Modifier words -------------------------------------------------------------------------

const isMultKey = (key: ModifierKey): boolean =>
  (MULT_KEYS as readonly string[]).includes(key)

/**
 * A modifier's words without its duration and whether it helps
 * (`goodDirection`; null when it changes nothing): "bikes ×0.92 speed",
 * "desk catch rate +3 %", "orders +25 %" (spawn as the arrival rate 1/mult),
 * "subscriptions +$15/day", "shelf +15".
 */
function modWords(
  view: ModCtx,
  key: ModifierKey,
  mult: number,
  add: number,
  scope: string | null,
): { text: string; good: boolean | null } {
  const up = view.data.events.modifiers.goodDirection[key] === 'up'
  const delta = isMultKey(key) ? mult - 1 : add
  const good = delta === 0 ? null : delta > 0 === up
  const x = `×${num(mult)}`
  const where = (): string =>
    scope === null ? '' : `${districtName(view, scope)} `
  let text: string
  switch (key) {
    case 'speed':
      text = `${scope === null ? 'all vehicles' : vehicleWord(view, scope, 2)} ${x} speed`
      break
    case 'stop':
      text = `stop time ${x}`
      break
    case 'processS':
      text = `${scope === null ? '' : `${scope} `}check time ${x}`
      break
    case 'payrollMult':
      text = mult === 0 ? 'no payroll' : `payroll ${pct(mult - 1)}`
      break
    case 'income':
      text = `delivery pay ${pct(mult - 1)}`
      break
    case 'spawn':
      text = `${where()}orders ${mult > 0 ? pct(1 / mult - 1, 0) : 'stop'}`
      break
    case 'tossBounty':
      text = mult === 0 ? 'no toss bounty' : `toss bounty ${x}`
      break
    case 'wrongTossFee':
      text = mult === 0 ? 'no wrong-toss fee' : `wrong-toss fee ${x}`
      break
    case 'vehiclePrice':
      text = `vehicle prices ${pct(mult - 1)}`
      break
    case 'machinePrice':
      text = `machine prices ${pct(mult - 1)}`
      break
    case 'clearanceS':
      text = `${where()}customs time ${x}`
      break
    case 'inspectorP':
      text = `desk catch rate ${pct(add)}`
      break
    case 'machineP':
      text = `machine catch rate ${pct(add)}`
      break
    case 'malwareShare':
      text = `malware ${pct(add)} of parcels`
      break
    case 'decoyShare':
      text = `decoys ${pct(add)} of parcels`
      break
    case 'onTimeMaxS':
      text = `on-time window ${signed(add, 0)} s`
      break
    case 'shelfCap':
      text = `shelf ${signed(add, 0)}`
      break
    case 'payrollAdd':
      text = `subscriptions ${money(Math.round(add))}/day`
      break
  }
  return { text, good }
}

/** A live modifier as the EffectsCard / ticker words ("bikes ×0.85 speed"), no duration. */
export function modifierLine(view: ModCtx, m: Modifier): string {
  return modWords(view, m.key, m.mult, m.add, m.scope).text
}

// Targets (pure; shared by the appliers and the summary) ------------------------------------

/** A satisfaction scope resolved now: the live spawning districts it names. */
function scopeDistricts(
  view: ModCtx,
  scope: string,
  target: DistrictId | null,
): DistrictId[] {
  const live = liveSpawningDistricts(view)
  if (scope === 'all') return live
  let one: DistrictId | null
  if (scope === 'target') one = target
  else if (scope === 'busiest') one = busiestDistrict(view)
  else if (scope === 'lowest') one = lowestDistrict(view)
  else one = scope
  return one !== null && live.includes(one) ? [one] : []
}

/** Owned vehicles of `type` (all with none). */
export function vehicleCount(
  s: SimState,
  type: VehicleTypeId | undefined,
): number {
  if (type === undefined) return s.vehicles.length
  return s.vehicles.filter((v) => v.type === type).length
}

/** round(|balance × pct|) with pct's sign — whole dollars, symmetric. */
function pctAmount(balance: number, frac: number): number {
  const amount = Math.round(Math.abs(balance * frac))
  return frac < 0 ? -amount : amount
}

type Picked<T> = { x: T } | { left: string } | null

/**
 * The card's `one` pick as an employee of `role`: the employee (still
 * employed; with `active`, also not walked out), `{left}` when they are
 * gone, null when the card picked nobody of that role.
 */
function pickedEmployee(
  s: SimState,
  pick: CardPick | null,
  role: RoleId,
  active: boolean,
): Picked<Employee> {
  if (pick === null || pick.role !== role) return null
  const e = s.employees.find((x) => x.id === pick.id && x.role === role)
  if (!e || (active && !e.active)) return { left: pick.name }
  return { x: e }
}

/** The card's vehicle pick, still owned (`{left}` when gone). */
function pickedVehicle(s: SimState, pick: CardPick | null): Picked<Vehicle> {
  if (pick === null || pick.role !== 'vehicle') return null
  const v = s.vehicles.find((x) => x.id === pick.id)
  return v ? { x: v } : { left: pick.name }
}

/**
 * The staff of `role` on duty now — active, not absent, and at their post
 * (an inspector seated at a desk, the seated sorter, a driver at the wheel
 * — not a pending Replace) — by id.
 */
function onDutyStaff(s: SimState, role: RoleId): Employee[] {
  return s.employees
    .filter((e) => {
      if (e.role !== role || !e.active || isAbsent(e, s.tick)) return false
      if (role === 'sorter') return s.lane.holdStation.fixture === e.id
      if (role === 'driver') return s.vehicles.some((v) => v.driverId === e.id)
      return deskNodeOf(s, e.id) !== null
    })
    .toSorted((a, b) => a.id - b.id)
}

/** Who a `staff {quit}` effect takes now. */
function quitTarget(
  view: ModCtx,
  e: QuitEffect,
  pick: CardPick | null,
): Picked<Employee> {
  const s = view.state
  if (e.pick === 'one') return pickedEmployee(s, pick, e.quit, true)
  const stat: StatId | undefined = view.data.employees.roles[e.quit].stats[0]
  const value = (x: Employee): number =>
    stat === undefined ? 0 : (x.pips[stat] ?? 0)
  let best: Employee | null = null
  for (const x of onDutyStaff(s, e.quit)) {
    // Ascending ids: a strict comparison keeps the lowest id on a tie.
    if (
      best === null ||
      (e.pick === 'best' ? value(x) > value(best) : value(x) < value(best))
    ) {
      best = x
    }
  }
  return best === null ? null : { x: best }
}

/** The oldest owned vehicle of the type ('any': overall): min boughtTick, then id. */
function oldestVehicle(
  s: SimState,
  type: VehicleTypeId | 'any',
): Vehicle | null {
  let out: Vehicle | null = null
  for (const v of s.vehicles) {
    if (type !== 'any' && v.type !== type) continue
    if (
      out === null ||
      v.boughtTick < out.boughtTick ||
      (v.boughtTick === out.boughtTick && v.id < out.id)
    ) {
      out = v
    }
  }
  return out
}

/** Who and what a `staff {absent}` effect sends away now. */
function absentTargets(
  s: SimState,
  e: AbsentEffect,
  pick: CardPick | null,
): { employees: Employee[]; vehicles: Vehicle[]; left: string | null } {
  const none = { employees: [], vehicles: [], left: null }
  if (e.absent === 'vehicles' || e.absent === 'driver') {
    if (e.pick === 'all') {
      const vehicles = s.vehicles.filter((v) => v.driverId !== null)
      return { employees: [], vehicles, left: null }
    }
    if (e.absent === 'driver') {
      // A driver off = their vehicle parked (B3 §3.5: drivers are absent
      // through their vehicle, so nobody is unpaid behind the wheel).
      const d = pickedEmployee(s, pick, 'driver', true)
      if (d === null) return none
      if ('left' in d) return { ...none, left: d.left }
      const v = s.vehicles.find((x) => x.driverId === d.x.id)
      return v ? { employees: [], vehicles: [v], left: null } : none
    }
    const v = pickedVehicle(s, pick)
    if (v === null) return none
    if ('left' in v) return { ...none, left: v.left }
    // Only a vehicle with a driver parks (as `all`; review effects-3): one
    // whose driver left since the pick is already off the road.
    if (v.x.driverId === null) return none
    return { employees: [], vehicles: [v.x], left: null }
  }
  if (e.pick === 'all') {
    // Every active member of the role (the already absent ones get the
    // later return).
    const employees = s.employees.filter((x) => {
      if (x.role !== e.absent || !x.active) return false
      if (x.role === 'sorter') return s.lane.holdStation.fixture === x.id
      return x.role !== 'inspector' || deskNodeOf(s, x.id) !== null
    })
    return { employees, vehicles: [], left: null }
  }
  const p = pickedEmployee(s, pick, e.absent, true)
  if (p === null) return none
  if ('left' in p) return { ...none, left: p.left }
  return { employees: [p.x], vehicles: [], left: null }
}

/** Malware labels of the announced strains not yet wanted, oldest strain first. */
function revealable(view: ModCtx): string[] {
  const s = view.state
  const order = view.data.parcels.malware.strains.map((x) => x.id)
  const announced = s.level.announced
  const strains = order
    .filter((id) => announced[id] !== undefined)
    .toSorted(
      (a, b) =>
        (announced[a] ?? 0) - (announced[b] ?? 0) ||
        order.indexOf(a) - order.indexOf(b),
    )
  const out: string[] = []
  for (const st of strains) {
    for (const label of view.data.puns.malwareLabels[st] ?? []) {
      if (!s.wanted.includes(label) && !out.includes(label)) out.push(label)
    }
  }
  return out
}

/**
 * Where `parcels {spawn}` lands: the district (`at` = 'target', 'busiest'
 * or a live spawning district id; never a hub) and its senders (send > 0)
 * by send, highest first, ties in file order — each parcel goes to the
 * first one with room (maxWaitingPerBuilding), spilling down the list.
 */
function spawnSenders(
  view: ModCtx,
  at: string,
  target: DistrictId | null,
): { district: DistrictId | null; senders: BuildingDef[]; room: number } {
  const live = liveSpawningDistricts(view)
  let d: DistrictId | null
  if (at === 'target') d = target
  else if (at === 'busiest') d = busiestDistrict(view)
  else d = at
  if (d === null || !live.includes(d)) {
    return { district: null, senders: [], room: 0 }
  }
  const max = view.data.parcels.spawn.maxWaitingPerBuilding
  const senders = (mapIndex(view.data).buildingsByDistrict[d] ?? [])
    .filter((b) => b.send > 0)
    .toSorted(
      (a, b) =>
        b.send - a.send ||
        buildingOrder(view.data, a.id) - buildingOrder(view.data, b.id),
    )
  let room = 0
  for (const b of senders) {
    room += Math.max(0, max - (view.state.buildings[b.id]?.waiting.length ?? 0))
  }
  return { district: d, senders, room }
}

/** The shelf parcels `parcels {lose}` may take: unreserved, not magic, in shelf order (the oldest first). */
function losableShelf(s: SimState): Parcel[] {
  const shelf = laneNode(s.lane, s.lane.shelfNodeId)
  if (!shelf) return []
  return shelf.queue.flatMap((id) => {
    const p = s.parcels[String(id)]
    return p && p.state === 'on_shelf' && p.reservedBy === null && !p.magic
      ? [p]
      : []
  })
}

/** "Bike 1 lost" / "Bike 1 lost — your last vehicle". */
function lostText(v: Vehicle, last: boolean): string {
  return `${v.name} lost${last ? ' — your last vehicle' : ''}`
}

// Appliers ---------------------------------------------------------------------------------

/** Balance ± delta: a gain is never earned (Q-B3-3); a loss is clamped to the balance. */
function applyMoney(sim: Sim, delta: number): void {
  if (delta > 0) sim.credit(delta, 'event', false)
  else if (delta < 0) {
    sim.debit(Math.min(-delta, sim.state.economy.balance), 'event')
  }
}

/** Every world kind (all but next / flag / job / jobDecline, which deck.ts applies). */
export function applyEffect(sim: Sim, ctx: EffectCtx, e: EventEffect): void {
  const s = sim.state
  const ev = s.events
  switch (e.kind) {
    case 'money':
      applyMoney(sim, e.delta)
      return
    case 'moneyPerVehicle':
      applyMoney(sim, e.delta * vehicleCount(s, e.type))
      return
    case 'moneyPct':
      applyMoney(sim, pctAmount(s.economy.balance, e.pct))
      return
    case 'lives':
      if (e.delta > 0) {
        ev.stats.livesGained += gainLives(sim, e.delta, 'event')
        return
      }
      for (let i = 0; i < -e.delta && !s.economy.gameOver; i++) {
        loseLifeEvent(sim, ctx.eventId, ctx.title, ctx.optionLabel)
      }
      return
    case 'satisfaction':
      for (const d of scopeDistricts(sim, e.scope, ctx.target)) {
        changeSatisfaction(sim, d, e.delta, 'other')
      }
      return
    case 'mod':
      applyModifier(sim, {
        key: e.key,
        mult: e.mult ?? 1,
        add: e.add ?? 0,
        scope: e.scope === 'target' ? ctx.target : (e.scope ?? null),
        untilTick: e.days === undefined ? null : s.tick + daysToTicks(e.days),
        eventId: ctx.eventId,
        label: ctx.title,
      })
      return
    case 'pips':
      applyPips(sim, ctx, e)
      return
    case 'vehicle':
      if ('lose' in e) loseVehicle(sim, ctx, e.lose, e.fallback)
      else gainVehicle(sim, e.gain, e.withDriver)
      return
    case 'staff':
      if ('quit' in e) {
        const t = quitTarget(sim, e, ctx.pick)
        if (t !== null && 'x' in t) {
          fireEmployee(sim, t.x, 'event')
          ev.stats.workersLost += 1
        }
      } else if ('star' in e) {
        const a = addStarApplicant(sim, e.star)
        sim.emit('ticker:news', {
          text: sim.data.puns.tickerQuest.star
            .replaceAll('{name}', a.name)
            .replaceAll('{role}', a.role),
          kind: 'event',
        })
      } else {
        applyAbsence(sim, ctx, e)
      }
      return
    case 'wanted':
      for (const label of revealable(sim).slice(0, Math.max(0, e.reveal))) {
        addWanted(s, label)
      }
      return
    case 'parcels':
      if ('spawn' in e) {
        spawnParcels(sim, ctx, e.spawn.size, e.spawn.count, e.spawn.at)
      } else {
        loseParcels(sim, e.lose.count)
      }
      return
    case 'cap':
      applyModifier(sim, {
        key: 'shelfCap',
        mult: 1,
        add: e.add,
        scope: null,
        untilTick: null,
        eventId: ctx.eventId,
        label: ctx.title,
      })
      return
    case 'end':
      endModifiers(sim, (m) => m.eventId === e.eventId)
      return
    case 'next':
    case 'flag':
    case 'job':
    case 'jobDecline':
      throw new Error(`effects: ${e.kind} is applied by deck.ts`)
  }
}

/** `pips`: every employee of the role, or the card's pick (still employed); desks re-sync. */
function applyPips(sim: Sim, ctx: EffectCtx, e: PipsEffect): void {
  const s = sim.state
  let targets: Employee[] = []
  if (e.scope === 'all') targets = s.employees.filter((x) => x.role === e.role)
  else {
    const p = pickedEmployee(s, ctx.pick, e.role, false)
    if (p !== null && 'x' in p) targets = [p.x]
  }
  for (const x of targets) setPip(x, e.stat, e.delta)
  if (e.role === 'inspector' && targets.length > 0) resyncDesks(sim)
}

/**
 * `vehicle {lose}`: the oldest of the type leaves (removeVehicle: cargo
 * back, its drivers `worker:fired {event}`, no refund), `vehicle:lost` and
 * a ticker line; with none of the type, the fallback money delta.
 */
function loseVehicle(
  sim: Sim,
  ctx: EffectCtx,
  type: VehicleTypeId | 'any',
  fallback: number,
): void {
  const s = sim.state
  const v = oldestVehicle(s, type)
  if (!v) {
    applyMoney(sim, fallback)
    return
  }
  const last = s.vehicles.length === 1
  const gone = removeVehicle(sim, v, { refund: false, why: 'lost' })
  const st = s.events.stats
  st.workersLost += gone.length
  st.vehiclesLost += 1
  sim.emit('vehicle:lost', {
    id: v.id,
    type: v.type,
    eventId: ctx.eventId,
    last,
  })
  sim.emit('ticker:news', { text: lostText(v, last), kind: 'event' })
}

/**
 * `vehicle {gain}`: a free vehicle on the lot (paid price 0, so its sell
 * refund is 0; stats.truckTick untouched — D-22) — parked `No driver`, or
 * driven at once by the named volunteer (people.ts hireStar: fee 0, outside
 * the pools).
 */
function gainVehicle(
  sim: Sim,
  type: VehicleTypeId,
  withDriver: StarApplicantDef | undefined,
): void {
  const def = mapIndex(sim.data).typeById[type]
  if (!def) return
  const driver = withDriver?.role === 'driver' ? withDriver : undefined
  const v = createVehicle(sim, def, driver !== undefined, 0)
  sim.emit('vehicle:bought', { id: v.id, free: true })
  if (driver) hireStar(sim, driver, { vehicleId: v.id }, v)
  else sim.emit('vehicle:inactive', { id: v.id })
}

/**
 * `staff {absent}`: away until now + days (the later of two absences) —
 * inspectors lose their station (desks re-sync), the sorter stops calling,
 * a vehicle and its drivers are parked: at once when nothing is aboard
 * (payroll.ts walkOut's rule: idle, or queued / loading empty), otherwise
 * after the trip (hasDriver is false while away).
 */
function applyAbsence(sim: Sim, ctx: EffectCtx, e: AbsentEffect): void {
  const s = sim.state
  const until = s.tick + daysToTicks(e.days)
  const later = (x: { absentUntilTick?: number }): void => {
    x.absentUntilTick = Math.max(x.absentUntilTick ?? 0, until)
  }
  const t = absentTargets(s, e, ctx.pick)
  for (const x of t.employees) later(x)
  for (const v of t.vehicles) {
    later(v)
    for (const id of [v.driverId, v.nextDriverId]) {
      const d = id === null ? undefined : s.employees.find((x) => x.id === id)
      if (d) later(d)
    }
    const empty = v.cargo.length === 0
    if (
      v.state === 'idle_lot' ||
      (empty && (v.state === 'queued' || v.state === 'docked_loading'))
    ) {
      goInactive(sim, v)
    }
  }
  if (e.absent === 'inspector' && t.employees.length > 0) resyncDesks(sim)
  if (e.absent === 'sorter' && t.employees.length > 0) {
    s.lane.holdStation.nextDecisionTick = null
  }
}

/**
 * `parcels {spawn}`: clean `source: 'event'` parcels waiting at the
 * district's busiest senders (spawnSenders), destinations drawn on the
 * content stream; the label without a draw (cleanLabels[spawnedCount % n],
 * as the golden parcel); a parcel beyond any free room is dropped.
 */
function spawnParcels(
  sim: Sim,
  ctx: EffectCtx,
  size: SizeId,
  count: number,
  at: string,
): void {
  const s = sim.state
  const data = sim.data
  const { senders } = spawnSenders(sim, at, ctx.target)
  const labels = data.puns.cleanLabels
  for (let i = 0; i < count; i++) {
    const origin = senders.find((b) => underCap(sim, b))
    if (!origin) return
    const dest = pickDestination(sim, origin, size, sim.eventPicksRng)
    if (!dest) return
    const destDistrict = mapIndex(data).districtById[dest.district]
    const label = labels[s.spawn.spawnedCount % labels.length] ?? 'parcel'
    const id = s.nextId.parcel
    s.nextId.parcel += 1
    const p: Parcel = {
      id,
      size,
      baseValue: data.parcels.sizes[size].value,
      mult: destDistrict?.kind === 'overseas' ? destDistrict.valueMult : 1,
      origin: origin.id,
      dest: dest.id,
      destRegion: dest.district,
      spawnedTick: s.tick,
      label,
      malware: false,
      strain: null,
      decoy: null,
      magic: false,
      scripted: false,
      state: 'waiting',
      reservedBy: null,
      vehicleId: null,
      nodeId: null,
      nodeEnterTick: null,
      nodeDoneTick: null,
      flaggedBy: null,
      flaggedStrain: null,
      lockedValue: null,
      clearTick: null,
      trace: [{ tick: s.tick, what: 'spawned', ref: origin.id }],
      source: 'event',
    }
    s.parcels[String(id)] = p
    s.buildings[origin.id]?.waiting.push(id)
    s.spawn.spawnedCount += 1
    sim.emit('parcel:spawned', {
      id,
      origin: origin.id,
      dest: dest.id,
      size,
      label,
    })
  }
}

/** `parcels {lose}`: the n oldest losable shelf parcels → `lost` (stats.lost, `parcel:lost`; no satisfaction hit). */
function loseParcels(sim: Sim, count: number): void {
  const s = sim.state
  const shelf = laneNode(s.lane, s.lane.shelfNodeId)
  if (!shelf) return
  for (const p of losableShelf(s).slice(0, Math.max(0, count))) {
    takeFrom(shelf, p.id)
    p.state = 'lost'
    p.nodeId = null
    p.nodeEnterTick = s.tick
    p.nodeDoneTick = null
    p.trace.push({ tick: s.tick, what: 'lost', ref: shelf.id })
    s.stats.lost += 1
    sim.emit('parcel:lost', { id: p.id })
  }
}

/**
 * Tick (the deck step's second sub-step): absences that end now — the
 * employee is back (an inspector's desk re-syncs: its station returns), a
 * parked vehicle with a working driver goes back to the lot (`idle_lot`).
 */
export function absenceStep(sim: Sim): void {
  const s = sim.state
  const tick = s.tick
  for (const e of s.employees) {
    if (e.absentUntilTick === undefined || e.absentUntilTick > tick) continue
    delete e.absentUntilTick
    if (e.role !== 'inspector') continue
    const desk = deskNodeOf(s, e.id)
    if (desk) syncDesk(sim, desk)
  }
  for (const v of s.vehicles) {
    if (v.absentUntilTick === undefined || v.absentUntilTick > tick) continue
    delete v.absentUntilTick
    if (v.state === 'inactive' && hasDriver(sim, v)) goIdle(sim, v)
  }
}

// Summary ----------------------------------------------------------------------------------

/**
 * One line per world effect, in data order (consecutive `pips` of the same
 * role and scope merge into one line); the deck kinds have none except
 * `job` (its reward and limit). State-aware: what the effect would do now
 * ("+1 life (already 5)", "Bike 1 lost — your last vehicle", "−$250 (no
 * bike to lose)", "(Audrey has left)", "wanted list +1 (none left)",
 * "— this can end the run").
 */
export function effectSummary(
  view: ModCtx,
  effects: readonly EventEffect[],
  card: CardRefs & { eventId: string; title: string },
): EffectLine[] {
  const out: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i] as EventEffect
    if (e.kind === 'pips') {
      const run: PipsEffect[] = [e]
      for (let j = i + 1; j < effects.length; j++) {
        const n = effects[j] as EventEffect
        if (n.kind !== 'pips' || n.role !== e.role || n.scope !== e.scope) break
        run.push(n)
      }
      i += run.length - 1
      out.push(pipsLine(view, run, card))
      continue
    }
    out.push(...linesOf(view, e, card))
  }
  return out
}

/**
 * `delta` per owned vehicle (of `type`): `−$120 ($40 × 3 vehicles)`, or
 * `$0 (no vans)` — a moneyPerVehicle effect's line and a costPerVehicle
 * price's (deck.ts optionLines, review deck-1).
 */
export function perVehicleLine(
  view: ModCtx,
  delta: number,
  type?: VehicleTypeId,
): EffectLine {
  const n = vehicleCount(view.state, type)
  const noun =
    type === undefined ? plural(n, 'vehicle') : vehicleWord(view, type, n)
  if (n === 0) return line(`$0 (no ${noun})`, null)
  const total = delta * n
  return line(
    `${money(total)} ($${Math.abs(delta)} × ${n} ${noun})`,
    total === 0 ? null : total > 0,
  )
}

function linesOf(
  view: ModCtx,
  e: EventEffect,
  card: CardRefs & { eventId: string; title: string },
): EffectLine[] {
  const s = view.state
  const data = view.data
  switch (e.kind) {
    case 'money':
      return [line(money(e.delta), e.delta === 0 ? null : e.delta > 0)]
    case 'moneyPerVehicle':
      return [perVehicleLine(view, e.delta, e.type)]
    case 'moneyPct': {
      const amount = pctAmount(s.economy.balance, e.pct)
      return [
        line(
          `${money(amount)} (${num(Math.abs(e.pct) * 100, 1)} % of the balance)`,
          amount === 0 ? null : amount > 0,
        ),
      ]
    }
    case 'lives':
      return [livesLine(view, e.delta)]
    case 'satisfaction': {
      const ds = scopeDistricts(view, e.scope, card.target)
      const what = `${signed(e.delta, 0)} happiness`
      if (e.scope === 'all') {
        return [
          line(`every district ${what}`, ds.length === 0 ? null : e.delta > 0),
        ]
      }
      const d = ds[0]
      if (d === undefined) return [line(`${what} (no district)`, null)]
      return [line(`${districtName(view, d)} ${what}`, e.delta > 0)]
    }
    case 'mod': {
      const scope = e.scope === 'target' ? card.target : (e.scope ?? null)
      const w = modWords(view, e.key, e.mult ?? 1, e.add ?? 0, scope)
      return [line(`${w.text}${forDays(e.days)}`, w.good)]
    }
    case 'pips':
      return [pipsLine(view, [e], card)]
    case 'vehicle': {
      if ('gain' in e) {
        const driver = e.withDriver?.role === 'driver' ? e.withDriver : null
        const what = `+1 ${vehicleWord(view, e.gain, 1)}`
        return [
          line(
            driver
              ? `${what}, ${giftStarName(s, driver)} driving`
              : `${what} (no driver)`,
            true,
          ),
        ]
      }
      const v = oldestVehicle(s, e.lose)
      if (v) return [line(lostText(v, s.vehicles.length === 1), false)]
      const noun = e.lose === 'any' ? 'vehicle' : vehicleWord(view, e.lose, 1)
      if (e.fallback === 0) return [line(`no ${noun} to lose`, null)]
      return [line(`${money(e.fallback)} (no ${noun} to lose)`, e.fallback > 0)]
    }
    case 'staff':
      if ('quit' in e) return [quitLine(view, e, card.pick)]
      if ('star' in e) {
        return [
          line(
            `★ ${e.star.role} ${starApplicantName(s, e.star)} applies`,
            true,
          ),
        ]
      }
      return [absentLine(view, e, card.pick)]
    case 'wanted': {
      const left = revealable(view).length
      const n = Math.max(0, e.reveal)
      const got = Math.min(n, left)
      let text = `wanted list +${n}`
      if (left === 0) text += ' (none left)'
      else if (got < n) text += ` (${got} left)`
      return [line(text, got > 0 ? true : null)]
    }
    case 'parcels': {
      if ('spawn' in e) {
        const { size, count, at } = e.spawn
        const what = `+${count} ${size} ${plural(count, 'parcel')}`
        const t = spawnSenders(view, at, card.target)
        if (t.district === null) return [line(`${what} (no district)`, null)]
        const where = `${what} at ${districtName(view, t.district)}`
        if (t.room === 0) return [line(`${where} (no room)`, null)]
        if (t.room < count) {
          return [line(`${where} (room for ${t.room})`, true)]
        }
        return [line(where, true)]
      }
      const n = Math.max(0, e.lose.count)
      const there = losableShelf(s).length
      const what = `${MINUS}${n} ${plural(n, 'parcel')} off the shelf`
      if (there === 0) return [line(`${what} (shelf empty)`, null)]
      if (there < n) return [line(`${what} (${there} there)`, false)]
      return [line(what, false)]
    }
    case 'cap': {
      const row = data.levels.find((l) => l.level === s.level.level)
      const [lo, hi] = data.events.modifiers.bounds.shelfCap
      const add = Math.min(hi, Math.max(lo, modAdd(view, 'shelfCap') + e.add))
      const to = Math.min(
        data.events.modifiers.shelfCapMax,
        (row?.shelfCap ?? s.level.shelfCap) + Math.round(add),
      )
      const what = `shelf ${signed(e.add, 0)}`
      if (to <= s.level.shelfCap) {
        return [line(`${what} (already /${s.level.shelfCap})`, null)]
      }
      return [line(`${what} (to /${to})`, true)]
    }
    case 'end': {
      const title =
        data.events.deck.find((d) => d.id === e.eventId)?.title ?? e.eventId
      const rows = s.modifiers.filter(
        (m) => m.eventId === e.eventId && isLive(m, s.tick),
      )
      if (rows.length === 0) return [line(`ends: ${title} (not running)`, null)]
      // Ending helpful rows costs; ending harmful ones helps.
      const goods = rows.map(
        (m) => modWords(view, m.key, m.mult, m.add, m.scope).good,
      )
      const allGood = goods.every((g) => g === true)
      const allBad = goods.every((g) => g === false)
      return [line(`ends: ${title}`, allGood ? false : allBad ? true : null)]
    }
    case 'job':
      return jobLines(view, e.templateId)
    case 'next':
    case 'flag':
    case 'jobDecline':
      return []
  }
}

/** "+1 life", "+1 life (already 5)", "−1 life — this can end the run". */
function livesLine(view: ModCtx, delta: number): EffectLine {
  const lives = view.state.economy.lives
  const cap = view.data.economy.lives.cap
  const n = Math.abs(delta)
  const word = plural(n, 'life', 'lives')
  if (delta > 0) {
    if (lives >= cap) return line(`+${n} ${word} (already ${cap})`, null)
    if (lives + n > cap) return line(`+${n} ${word} (max ${cap})`, true)
    return line(`+${n} ${word}`, true)
  }
  if (delta === 0) return line(`0 lives`, null)
  const end = lives <= n ? ' — this can end the run' : ''
  return line(`${MINUS}${n} ${word}${end}`, false)
}

/** "all drivers: speed +1, charisma −1", "Audrey: eye +1", "(Audrey has left)". */
function pipsLine(
  view: ModCtx,
  run: readonly PipsEffect[],
  card: CardRefs,
): EffectLine {
  const s = view.state
  const first = run[0] as PipsEffect
  const role = first.role
  const parts = run.map((p) => `${p.stat} ${signed(p.delta, 0)}`).join(', ')
  const ups = run.every((p) => p.delta > 0)
  const downs = run.every((p) => p.delta < 0)
  const good = ups ? true : downs ? false : null
  if (first.scope === 'all') {
    const any = s.employees.some((x) => x.role === role)
    return line(
      `all ${role}s: ${parts}${any ? '' : ' (none hired)'}`,
      any ? good : null,
    )
  }
  const p = pickedEmployee(s, card.pick, role, false)
  if (p === null) return line(`(no ${role} picked)`, null)
  if ('left' in p) return line(`(${p.left} has left)`, null)
  const e = p.x
  if (run.length === 1) {
    const max = first.stat === 'charisma' ? 2 : 5
    const min = first.stat === 'charisma' ? 0 : 1
    const now = e.pips[first.stat]
    if (now !== undefined) {
      if (first.delta > 0 && now >= max) {
        return line(`${e.name}: ${parts} (already ${max})`, null)
      }
      if (first.delta < 0 && now <= min) {
        return line(`${e.name}: ${parts} (already ${min})`, null)
      }
    }
  }
  return line(`${e.name}: ${parts}`, good)
}

/** "Audrey quits", "Audrey quits — the desk is empty", "(Audrey has left)". */
function quitLine(
  view: ModCtx,
  e: QuitEffect,
  pick: CardPick | null,
): EffectLine {
  const s = view.state
  const t = quitTarget(view, e, pick)
  if (t === null) return line(`(no ${e.quit} to lose)`, null)
  if ('left' in t) return line(`(${t.left} has left)`, null)
  const x = t.x
  let tail = ''
  if (x.role === 'inspector') {
    const desk = deskNodeOf(s, x.id)
    const f = desk?.fixture
    if (f?.kind === 'desk' && f.inspectorIds.every((id) => id === x.id)) {
      tail = ' — the desk is empty'
    }
  } else if (x.role === 'sorter') {
    tail = ' — no one sorts the Hold Bay'
  } else {
    const v = s.vehicles.find((y) => y.driverId === x.id)
    if (v && v.nextDriverId === null) tail = ` — ${v.name} has no driver`
  }
  return line(`${x.name} quits${tail}`, false)
}

/** "Audrey off for 1 day (unpaid)", "the whole desk off for 1 day", "every vehicle parked for 1 day". */
function absentLine(
  view: ModCtx,
  e: AbsentEffect,
  pick: CardPick | null,
): EffectLine {
  const s = view.state
  const t = absentTargets(s, e, pick)
  const days = dayText(e.days)
  if (t.left !== null) {
    return line(
      e.absent === 'vehicles' ? `(${t.left} is gone)` : `(${t.left} has left)`,
      null,
    )
  }
  if (e.absent === 'vehicles' || e.absent === 'driver') {
    if (t.vehicles.length === 0) return line('(no vehicle to park)', null)
    if (e.pick === 'all') return line(`every vehicle parked for ${days}`, false)
    const v = t.vehicles[0] as Vehicle
    const d = s.employees.find((x) => x.id === v.driverId)
    if (e.absent === 'driver' && d) {
      return line(`${d.name} off for ${days} (unpaid), ${v.name} parked`, false)
    }
    return line(`${v.name} parked for ${days}`, false)
  }
  if (t.employees.length === 0) {
    return line(`(no ${e.absent} to send home)`, null)
  }
  if (e.pick === 'one' || t.employees.length === 1) {
    const x = t.employees[0] as Employee
    return line(`${x.name} off for ${days} (unpaid)`, false)
  }
  if (e.absent === 'inspector') {
    const desks = new Set(t.employees.map((x) => deskNodeOf(s, x.id)?.id))
    if (desks.size === 1) return line(`the whole desk off for ${days}`, false)
    return line(`every inspector off for ${days}`, false)
  }
  return line(`every ${e.absent} off for ${days}`, false)
}

/** A job card's Accept: "Reward: $150 + 5 satisfaction in Registry Row", "Limit: 3 days". */
function jobLines(view: ModCtx, templateId: string): EffectLine[] {
  const s = view.state
  const data = view.data
  const out: EffectLine[] = []
  const q = s.quests.offer
  const offered = q !== null && q.templateId === templateId ? q : null
  if (offered) {
    const shown: QuestReward = structuredClone(offered.reward)
    if (shown.star) shown.star.name = starApplicantName(s, shown.star)
    out.push(
      line(`Reward: ${rewardSummary(data, shown, offered.target)}`, true),
    )
  }
  const limit = questLimitTicks(data, { templateId, ultimate: false })
  if (limit > 0) {
    out.push(line(`Limit: ${dayText(limit / TICKS_PER_DAY)}`, null))
  }
  return out
}
