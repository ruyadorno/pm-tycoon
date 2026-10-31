// Payroll, unpaid marks, walkouts and re-hire (spec §7.3-§7.4, §6.7, §4.6;
// plan.md §12.6 task 2). Runs in the day step (tick step 11) on every day
// boundary that is also a payrollIntervalS boundary (one in-game day = 60 s,
// so: every day), before `day:ended`, so the HUD's daily line counts the day's
// payroll. SIM_FEATURES.payroll.
//
// Build 3 (B3 §3.6): each salary × the payrollMult modifier (rounded), then
// the payrollAdd modifier as one 'subscriptions' debit after every employee
// (skipped with a ticker line when short; D-34); a worker away on an event's
// absence is unpaid and unmarked.
//
// Payday: active workers in employees.json payOrder — inspectors by hire time
// (hiredTick, then id), then sorters by hire time (M6), then drivers by their
// vehicle's purchase (boughtTick, then vehicle id; a pending Replace driver
// sorts with the vehicle it will take over — pending drivers are hired, so
// they are paid). For each, against the balance left after the ones before:
// balance ≥ salary → paid, the unpaid mark cleared (one paid payday clears
// it); else the mark counts up (Employee.unpaidPaydays) and, at
// walkoutAfterUnpaidPaydays consecutive unpaid paydays, the worker walks out.
// One debit for the total ('payroll', one ledger line), then
// `payroll:paid {amount}` (only when > 0), `payroll:short {employeeIds}` (when
// anyone went unpaid, walkouts included), then one `worker:walkedOut` per
// walkout. The balance never goes negative (Sim.debit) and there is no
// bankruptcy: money only blocks purchases and thins the workforce.
//
// Walkout (Employee.active = false, the mark kept for the "!" badge):
//   - inspector: leaves the desk (moved to the desk's walkedOutIds — the
//     seat stays held; people.ts syncDesk drops its station, whose parcel
//     goes back to the front of the buffer; the desk stays);
//   - sorter (M6): stays on the Hold Bay station (the seat held) and does
//     nothing until re-hired or fired;
//   - driver: the vehicle finishes its trip (dispatch.ts: a driverless
//     vehicle starts no new collect leg or target) and parks `inactive`
//     right after its next unload (docks.ts) — at once when it is idle on the
//     lot, queued with nothing aboard, or in the dock with nothing aboard (it
//     would load a new trip; M4). An inactive vehicle is never
//     dispatched, never in a dock, and has no payroll line. A PENDING
//     Replace driver (M6, Vehicle.nextDriverId) who walks out cancels the
//     Replace: they leave (people.ts dropPendingDriver) and the current
//     driver stays.
// Re-hire (the `rehire` command): employees.rehireFeeDays × the worker's
// daily salary ('hire'), immediate; the mark is cleared, the inspector takes
// a desk station again / the sorter its station (only while it still holds
// it) / the driver drives again (an `inactive` vehicle → `idle_lot`; refused
// while a Replace waits for that vehicle — the swap lets them go anyway);
// `worker:hired {rehire: true}`.

import { modAdd, modMult, type ModCtx } from '../modifiers.ts'
import type { Sim } from '../sim.ts'
import type { Employee, LaneNode, SimState, Vehicle } from '../types.ts'
import { isAbsent, ticksFromS } from '../types.ts'
import type { GameData } from '../../data/types.ts'
import { goIdle, goInactive } from './dispatch.ts'
import { dropPendingDriver, syncDesk } from './people.ts'
import { hasDriver } from './vehicles.ts'

/** Ticks between paydays (employees.payrollIntervalS; one day = 600). */
export function payrollTicks(data: GameData): number {
  return Math.max(1, ticksFromS(data.employees.payrollIntervalS))
}

/** Ticks until the next payday (the Garage "Payday in 0:23"); a full interval right after one. */
export function ticksToPayday(state: SimState, data: GameData): number {
  const every = payrollTicks(data)
  return every - (state.tick % every)
}

/** The desk node an inspector sits at (or walked out of), or null. */
export function deskOf(sim: Sim, employeeId: number): LaneNode | null {
  return (
    sim.state.lane.nodes.find(
      (n) =>
        n.fixture?.kind === 'desk' &&
        (n.fixture.inspectorIds.includes(employeeId) ||
          n.fixture.walkedOutIds.includes(employeeId)),
    ) ?? null
  )
}

/** The vehicle a driver drives (or takes over after a Replace), or null. */
export function vehicleOf(sim: Sim, e: Employee): Vehicle | null {
  if (e.role !== 'driver' || e.vehicleId === null) return null
  return sim.state.vehicles.find((v) => v.id === e.vehicleId) ?? null
}

const byHire = (a: Employee, b: Employee): number =>
  a.hiredTick - b.hiredTick || a.id - b.id

/**
 * Active workers in payOrder (§7.4: inspectors by hire time, then sorters,
 * then drivers by vehicle purchase). Build 3 (B3 §3.5): a worker away on an
 * event's absence is unpaid for the days away — left out, their unpaid mark
 * untouched.
 */
export function payOrder(sim: Sim): Employee[] {
  const s = sim.state
  const active = s.employees.filter((e) => e.active && !isAbsent(e, s.tick))
  const inspectors = active
    .filter((e) => e.role === 'inspector')
    .toSorted(byHire)
  const sorters = active.filter((e) => e.role === 'sorter').toSorted(byHire)
  const bought = (e: Employee): [number, number] => {
    const v = vehicleOf(sim, e)
    return v ? [v.boughtTick, v.id] : [Number.MAX_SAFE_INTEGER, e.id]
  }
  const drivers = active
    .filter((e) => e.role === 'driver')
    .toSorted((a, b) => {
      const [ta, ia] = bought(a)
      const [tb, ib] = bought(b)
      return ta - tb || ia - ib
    })
  const out: Employee[] = []
  for (const group of sim.data.employees.payOrder) {
    if (group === 'inspectors') out.push(...inspectors)
    else if (group === 'sorters') out.push(...sorters)
    else if (group === 'drivers') out.push(...drivers)
  }
  return out
}

/**
 * What the next payday debits per day (the Garage "Payroll $28/day"; build 3
 * B3 §3.6, D-4): Σ over the active, present workers of round(salary ×
 * payrollMult) + round(payrollAdd) — the subscriptions, debited apart
 * (D-34) — the same numbers paydayStep debits when the balance covers them.
 */
export function payrollDuePerDay(ctx: ModCtx): number {
  const tick = ctx.state.tick
  const mult = modMult(ctx, 'payrollMult')
  let sum = 0
  for (const e of ctx.state.employees) {
    if (e.active && !isAbsent(e, tick)) sum += Math.round(e.salaryPerDay * mult)
  }
  return sum + Math.round(modAdd(ctx, 'payrollAdd'))
}

/** Day step (tick step 11): payday on a payrollIntervalS boundary. */
export function paydayStep(sim: Sim): void {
  const s = sim.state
  if (s.tick === 0 || s.tick % payrollTicks(sim.data) !== 0) return
  const walkoutAt = sim.data.employees.walkoutAfterUnpaidPaydays
  let left = s.economy.balance
  let paid = 0
  const short: number[] = []
  const walkouts: Employee[] = []
  // Build 3 (B3 §3.6): the payrollMult modifier per salary, rounded (×0:
  // everyone is paid $0, so every unpaid mark clears).
  const mult = modMult(sim, 'payrollMult')
  for (const e of payOrder(sim)) {
    const due = mult === 1 ? e.salaryPerDay : Math.round(e.salaryPerDay * mult)
    if (left >= due) {
      left -= due
      paid += due
      e.unpaidPaydays = 0
      continue
    }
    e.unpaidPaydays += 1
    short.push(e.id)
    if (e.unpaidPaydays >= walkoutAt) walkouts.push(e)
  }
  if (paid > 0) sim.debit(paid, 'payroll')
  s.stats.payrollPaid += paid
  s.economy.lastPayroll = { tick: s.tick, paid, shortEmployeeIds: [...short] }
  if (paid > 0) sim.emit('payroll:paid', { amount: paid })
  // Build 3 (B3 §3.6, D-34): the payrollAdd modifier — one 'subscriptions'
  // line after every employee, skipped when short (a ticker line, never an
  // unpaid mark or a walkout); not payroll (payrollPaid, lastPayroll and
  // payroll:paid leave it out).
  const add = Math.round(modAdd(sim, 'payrollAdd'))
  if (add > 0 && s.economy.balance >= add) {
    sim.debit(add, 'subscriptions')
  } else if (add > 0) {
    sim.emit('ticker:news', {
      text: sim.data.puns.tickerEvent.subscriptionsUnpaid,
      kind: 'payroll',
    })
  }
  if (short.length > 0) sim.emit('payroll:short', { employeeIds: [...short] })
  for (const e of walkouts) walkOut(sim, e)
}

/** §7.4 walkout (see the header). */
export function walkOut(sim: Sim, e: Employee): void {
  if (!e.active) return
  e.active = false
  if (e.role === 'inspector') {
    const node = deskOf(sim, e.id)
    if (node?.fixture?.kind === 'desk') {
      const f = node.fixture
      f.inspectorIds = f.inspectorIds.filter((id) => id !== e.id)
      if (!f.walkedOutIds.includes(e.id)) f.walkedOutIds.push(e.id)
      syncDesk(sim, node)
    }
    sim.emit('worker:walkedOut', {
      employeeId: e.id,
      role: 'inspector',
      nodeId: node?.id ?? e.nodeId,
      vehicleId: null,
    })
    return
  }
  if (e.role === 'sorter') {
    const hs = sim.state.lane.holdStation
    if (hs.fixture === e.id) hs.nextDecisionTick = null
    sim.emit('worker:walkedOut', {
      employeeId: e.id,
      role: 'sorter',
      nodeId: e.nodeId,
      vehicleId: null,
    })
    return
  }
  sim.emit('worker:walkedOut', {
    employeeId: e.id,
    role: 'driver',
    nodeId: null,
    vehicleId: e.vehicleId,
  })
  const found = vehicleOf(sim, e)
  // A pending Replace driver walking out never takes the wheel: the Replace
  // is cancelled at once (they leave, `worker:fired {replaced}`), the
  // current driver stays and the trip carries on.
  if (found && found.nextDriverId === e.id) {
    dropPendingDriver(sim, found)
    return
  }
  const v = found && found.driverId === e.id ? found : null
  // Nothing left of the trip: parked on the lot, queued with nothing to
  // unload, or in the dock with nothing aboard (unloaded, waiting for or
  // starting to load an outbound set — a new trip; M4 hunt).
  const empty = v !== null && v.cargo.length === 0
  if (
    v &&
    (v.state === 'idle_lot' ||
      (empty && (v.state === 'queued' || v.state === 'docked_loading')))
  ) {
    goInactive(sim, v)
  }
}

/** The re-hire fee: employees.rehireFeeDays × the worker's daily salary (§7.2). */
export function rehireFee(sim: Sim, e: Employee): number {
  return e.salaryPerDay * sim.data.employees.rehireFeeDays
}

/**
 * §7.4 re-hire (the caller checked `!e.active` and the balance ≥ the fee):
 * the fee ('hire'), the mark cleared, back at the desk / behind the wheel.
 * Returns false (nothing changed) when the worker has nowhere to go back to.
 */
export function rehire(sim: Sim, e: Employee): boolean {
  let desk: LaneNode | null = null
  if (e.role === 'inspector') {
    desk = deskOf(sim, e.id)
    if (desk?.fixture?.kind !== 'desk') return false
  } else if (e.role === 'sorter') {
    if (sim.state.lane.holdStation.fixture !== e.id) return false
  } else {
    // A driver being replaced (a Replace waits for the trip) would be let go
    // at the swap anyway: no re-hire, so no fee is wasted.
    const v = vehicleOf(sim, e)
    if (!v || v.nextDriverId !== null) return false
  }
  if (desk?.fixture?.kind === 'desk') {
    const f = desk.fixture
    f.walkedOutIds = f.walkedOutIds.filter((id) => id !== e.id)
    f.inspectorIds.push(e.id)
    e.nodeId = desk.id
  }
  e.active = true
  e.unpaidPaydays = 0
  if (desk) syncDesk(sim, desk)
  sim.debit(rehireFee(sim, e), 'hire')
  sim.emit('worker:hired', {
    employeeId: e.id,
    role: e.role,
    nodeId: e.role === 'driver' ? null : e.nodeId,
    vehicleId: e.role === 'driver' ? e.vehicleId : null,
    pips: { ...e.pips },
    star: e.star,
    rehire: true,
  })
  const v = vehicleOf(sim, e)
  if (v && v.driverId === e.id && v.state === 'inactive' && hasDriver(sim, v))
    goIdle(sim, v)
  return true
}
