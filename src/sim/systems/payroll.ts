// Payroll, unpaid marks, walkouts and re-hire (spec §7.3-§7.4, §6.7, §4.6;
// plan.md §12.6 task 2). Runs in the day step (tick step 11) on every day
// boundary that is also a payrollIntervalS boundary (one in-game day = 60 s,
// so: every day), before `day:ended`, so the HUD's daily line counts the day's
// payroll. SIM_FEATURES.payroll.
//
// Payday: active workers in employees.json payOrder — inspectors by hire time
// (hiredTick, then id), then drivers by their vehicle's purchase (boughtTick,
// then vehicle id). For each, against the balance left after the ones before:
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
//   - inspector: leaves the desk (moved to the desk's walkedOutIds, one
//     station fewer — a free one when there is one, else the last, whose
//     parcel goes back to the front of the buffer; the desk stays);
//   - driver: the vehicle finishes its trip (dispatch.ts: a driverless
//     vehicle starts no new collect leg or target) and parks `inactive`
//     right after its next unload (docks.ts) — at once when it is idle on the
//     lot or queued with nothing aboard. An inactive vehicle is never
//     dispatched, never in a dock, and has no payroll line.
// Re-hire (the `rehire` command): employees.rehireFeeDays × the worker's
// daily salary ('hire'), immediate; the mark is cleared, the inspector takes
// a desk station again / the driver drives again (an `inactive` vehicle →
// `idle_lot`); `worker:hired`.

import type { Sim } from '../sim.ts'
import type { Employee, LaneNode, SimState, Vehicle } from '../types.ts'
import { ticksFromS } from '../types.ts'
import type { GameData } from '../../data/types.ts'
import { goIdle, goInactive } from './dispatch.ts'
import { removeDeskStation } from './lane.ts'

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

/** The vehicle a driver drives, or null. */
export function vehicleOf(sim: Sim, e: Employee): Vehicle | null {
  return sim.state.vehicles.find((v) => v.driverId === e.id) ?? null
}

/** Active workers in payOrder (§7.4: inspectors by hire time, then drivers by vehicle purchase). */
export function payOrder(sim: Sim): Employee[] {
  const s = sim.state
  const active = s.employees.filter((e) => e.active)
  const inspectors = active
    .filter((e) => e.kind === 'inspector')
    .toSorted((a, b) => a.hiredTick - b.hiredTick || a.id - b.id)
  const bought = (e: Employee): [number, number] => {
    const v = vehicleOf(sim, e)
    return v ? [v.boughtTick, v.id] : [Number.MAX_SAFE_INTEGER, e.id]
  }
  const drivers = active
    .filter((e) => e.kind === 'driver')
    .toSorted((a, b) => {
      const [ta, ia] = bought(a)
      const [tb, ib] = bought(b)
      return ta - tb || ia - ib
    })
  const out: Employee[] = []
  for (const group of sim.data.employees.payOrder) {
    if (group === 'inspectors') out.push(...inspectors)
    else if (group === 'drivers') out.push(...drivers)
  }
  return out
}

/** Sum of the active workers' daily salaries (the Garage "Payroll $28/day"). */
export function payrollPerDay(state: SimState): number {
  return state.employees
    .filter((e) => e.active)
    .reduce((sum, e) => sum + e.salaryPerDay, 0)
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
  for (const e of payOrder(sim)) {
    if (left >= e.salaryPerDay) {
      left -= e.salaryPerDay
      paid += e.salaryPerDay
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
  if (short.length > 0) sim.emit('payroll:short', { employeeIds: [...short] })
  for (const e of walkouts) walkOut(sim, e)
}

/** §7.4 walkout (see the header). */
export function walkOut(sim: Sim, e: Employee): void {
  if (!e.active) return
  e.active = false
  if (e.kind === 'inspector') {
    const node = deskOf(sim, e.id)
    if (node?.fixture?.kind === 'desk') {
      const f = node.fixture
      f.inspectorIds = f.inspectorIds.filter((id) => id !== e.id)
      if (!f.walkedOutIds.includes(e.id)) f.walkedOutIds.push(e.id)
      removeDeskStation(node)
    }
    sim.emit('worker:walkedOut', {
      employeeId: e.id,
      kind: 'inspector',
      nodeId: node?.id ?? e.nodeId,
    })
    return
  }
  sim.emit('worker:walkedOut', {
    employeeId: e.id,
    kind: 'driver',
    nodeId: null,
  })
  const v = vehicleOf(sim, e)
  // Nothing left of the trip: parked on the lot, or queued with nothing to unload.
  if (
    v &&
    (v.state === 'idle_lot' || (v.state === 'queued' && v.cargo.length === 0))
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
  if (e.kind === 'inspector') {
    const node = deskOf(sim, e.id)
    if (node?.fixture?.kind !== 'desk') return false
    const f = node.fixture
    f.walkedOutIds = f.walkedOutIds.filter((id) => id !== e.id)
    f.inspectorIds.push(e.id)
    f.checker.stations += 1
    node.stations.push({ parcelId: null, doneTick: null })
    e.nodeId = node.id
  } else if (!vehicleOf(sim, e)) {
    return false
  }
  e.active = true
  e.unpaidPaydays = 0
  sim.debit(rehireFee(sim, e), 'hire')
  sim.emit('worker:hired', {
    employeeId: e.id,
    kind: e.kind,
    nodeId: e.kind === 'inspector' ? e.nodeId : null,
  })
  const v = e.kind === 'driver' ? vehicleOf(sim, e) : null
  if (v && v.state === 'inactive') goIdle(sim, v)
  return true
}
