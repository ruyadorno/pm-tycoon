// The scripted "competent" player of spec §7 (plan.md §6.9.2), used by
// `vlr sim` / the gate and by ?policy=1 in the browser. The CLI and the
// stepper call step() once before every tick from tick 0; it reads sim.state
// and acts only through sim.dispatch (so the command log replays it). Every
// decision is derived from the state, never from private memory, so a policy
// attached to a loaded game picks up where the state is.
//
//   opening A (§7.1): a bike + a Metal detector at t = 0;
//   another bike whenever balance ≥ price + purchaseBuffer, until maxBikes;
//   at L2 the truck at price + purchaseBuffer, then the Shaky shaker at
//     price + purchaseBuffer;
//   COUNTERS (run decision, policy extension — M3 lives study): once the
//     level's spec purchases are done (L1: maxBikes bikes; L2: the truck and
//     the shaker), a free live slot gets the counter machine
//     (parcels.json strains[].counter) of the weakest announced strain (lowest
//     lane D, parcels.json order on ties) at price + purchaseBuffer — in
//     practice a 2nd Metal detector in slot 3 after the 3rd bike (metal D
//     0.97 → 0.99), so at L2 the shaker takes slot 4;
//   a 2nd (then 3rd) inspector when the dock was BLOCKED > dockBlockedHireS
//     in the current in-game day — summed LoadingDock.blockedTicksThisDay:
//     ticks a docked vehicle's due unload was refused by a full conveyor, i.e.
//     the lane backing up into the dock (run decision: a busy checker is
//     backpressure, not a `lane:stalled`, so the spec's "lane stalls > 10 s in
//     a day" is re-based on the dock); at most one hire per day, only with a
//     free seat at a desk (walked-out inspectors keep theirs; the first desk
//     by employees.json desks.rows index) and balance ≥ the hire fee;
//   REHIRE (run decision, policy extension — M3 review): a walked-out
//     worker is re-hired in pay order (inspectors, sorters, drivers) at
//     fee + purchaseBuffer, before any new purchase (dormant unless two
//     paydays in a row ran short);
//   Toss every flag on the tick it is held: the step before the next tick
//     tosses every parcel in the Hold Bay, so a Hold Bay stall never builds;
//   home zones stay `any`.
//
// Build 2, M6 (spec-build2 §7.2 L1-L2 rows; design-m6 §5.1): every hire
// picks from the three applicants on the tick of the purchase / hire —
// bestApplicant: inspectors highest eye, drivers highest EFFECTIVE speed
// pip for the bought type (affinity counted, design D20), sorters highest
// judgement; ties → lowest salary → lowest applicant id. The purchase
// triggers stay playtest 1's (price + purchaseBuffer): a driver's hire fee
// (≤ $40, a (5,5,2) truck driver) comes out of the buffer, so no trigger
// tick moves; the opening bike needs price + its driver's fee. It never posts
// an ad, fires, Replaces, places desk 2 or hires a sorter (M8 adds the L3
// rules). The `delegating` kind (src/sim/policies/delegating.ts) is this
// class plus a sorter hired at L2 who takes over the Hold Bay: no hand
// Tosses while it is on duty, every `looks clean` parcel Cleared.
//
// Build 2, M7 (spec-build2 §7.2 "quests" row; design-m7 §5.1): questPolicyStep,
// right after REHIRE (and the delegating sorter hire) — accept every offer at
// once (the Golden Release as soon as no quest is active), and rush the
// golden parcel's origin while it waits there unrushed (on its spawn tick:
// the accept spawns it, so accept and rush land in the same step). It never
// declines, abandons or rushes the destination (the sim's magic-first
// outbound rule covers B). Both kinds share it.
//
// Prices come from src/data; the buffer, the counts and dockBlockedHireS are
// the policy's own parameters (spec §7 wording), not balance numbers.

import type { CheckerDef, VehicleTypeDef } from '../data/types.ts'
import { laneCatchRate } from './detection.ts'
import {
  delegatingHireSorter,
  delegatingHoldBay,
} from './policies/delegating.ts'
import { isRushed } from './systems/dispatch.ts'
import { rehireFee } from './systems/payroll.ts'
import { hireFeeOf, salaryOf } from './systems/people.ts'
import { SIM_FEATURES } from './features.ts'
import type { Policy, PolicyKind, Sim } from './sim.ts'
import type { Applicant, Role, VehicleType } from './types.ts'
import { laneNode, liveSlotIds, TICKS_PER_DAY, TICKS_PER_S } from './types.ts'

export const POLICY_PARAMS = {
  /** "another bike whenever balance ≥ price + $50 buffer" (spec §7). */
  purchaseBuffer: 50,
  /** "… until 3 bikes". */
  maxBikes: 3,
  /**
   * "a 2nd (then 3rd) inspector when the lane stalls > 10 s in a day",
   * re-based on the dock being blocked (see the header).
   */
  dockBlockedHireS: 10,
  /** Opening A's machine and the L2 one (machines.json ids). */
  openingMachine: 'metal_detector',
  level2Machine: 'shaky_shaker',
  /** The L2 vehicle (vehicles.json id). */
  level2Vehicle: 'truck',
} as const

function typeDef(sim: Sim, id: string): VehicleTypeDef | null {
  return sim.data.vehicles.types.find((t) => t.id === id) ?? null
}

function machineDef(sim: Sim, id: string): CheckerDef | null {
  return sim.data.machines.checkers.find((c) => c.id === id) ?? null
}

function ownsMachine(sim: Sim, defId: string): boolean {
  return sim.state.lane.nodes.some(
    (n) => n.fixture?.kind === 'machine' && n.fixture.checker.defId === defId,
  )
}

function ownsVehicle(sim: Sim, type: string): boolean {
  return sim.state.vehicles.some((v) => v.type === type)
}

function bikeCount(sim: Sim): number {
  return sim.state.vehicles.filter((v) => v.type === 'bike').length
}

function firstEmptySlot(sim: Sim): string | null {
  const lane = sim.state.lane
  return liveSlotIds(lane).find((id) => !laneNode(lane, id)?.fixture) ?? null
}

/** Seconds the docks were blocked (a due unload refused by a full conveyor) this day. */
export function dockBlockedSecondsToday(sim: Sim): number {
  const ticks = sim.state.lane.docks.reduce(
    (sum, d) => sum + (d.blockedTicksThisDay ?? 0),
    0,
  )
  return ticks / TICKS_PER_S
}

/**
 * The best applicant waiting in a pool (spec-build2 §7.2, design §5.1):
 * inspector → highest eye, driver → highest effective speed pip for `type`
 * (affinity counted, design D20), sorter → highest judgement; ties → lowest
 * salary (a driver's for `type`) → lowest applicant id. Null with an empty pool.
 */
export function bestApplicant(
  sim: Sim,
  role: Role,
  type: VehicleType = 'bike',
): Applicant | null {
  const data = sim.data
  const affinityPips = data.employees.roles.driver.affinityPips
  const score = (a: Applicant): number => {
    if (role === 'inspector') return a.pips.eye ?? 0
    if (role === 'sorter') return a.pips.judgement ?? 0
    const bonus = a.affinity === type ? affinityPips : 0
    return Math.min(5, (a.pips.speed ?? 0) + bonus)
  }
  const salary = (a: Applicant): number =>
    salaryOf(data, role, a.pips, role === 'driver' ? type : undefined)
  let best: Applicant | null = null
  for (const a of sim.state.applicants[role]) {
    if (
      best === null ||
      score(a) > score(best) ||
      (score(a) === score(best) &&
        (salary(a) < salary(best) ||
          (salary(a) === salary(best) && a.id < best.id)))
    ) {
      best = a
    }
  }
  return best
}

/**
 * The counter machine of the weakest announced strain (lowest lane D;
 * parcels.json order on ties), or null with none announced.
 */
export function weakestCounter(sim: Sim): CheckerDef | null {
  let best: { counter: string; d: number } | null = null
  for (const st of sim.data.parcels.malware.strains) {
    if (sim.state.level.announced[st.id] === undefined) continue
    const d = laneCatchRate(sim.state.lane, st.id)
    if (best === null || d < best.d) best = { counter: st.counter, d }
  }
  return best ? machineDef(sim, best.counter) : null
}

/**
 * B2 §7.2 quests: accept every offer at once (the ultimate as soon as no
 * quest is active); while the active magic parcel waits at its origin and
 * the origin is not rushed, rush it (on its spawn tick — accept and rush
 * happen in the same step). Nothing else changes: never declines, abandons
 * or rushes the destination. Shared by the competent and the delegating
 * policy (design-m7 §5.1).
 */
export function questPolicyStep(sim: Sim): void {
  const qs = sim.state.quests
  if (qs.offer !== null && qs.active === null) {
    sim.dispatch({ kind: 'acceptQuest', questId: qs.offer.id })
  }
  const pr = qs.active?.progress
  if (pr?.kind !== 'magicParcel' || pr.parcelId === null) return
  const origin = pr.origin
  const p = sim.state.parcels[String(pr.parcelId)]
  if (origin === null || p?.state !== 'waiting' || isRushed(sim, origin)) {
    return
  }
  // A `no-vehicle` failure is `applied`: the flag stays up and the
  // dispatcher retargets the first vehicle that frees (§4.1).
  sim.dispatch({ kind: 'rush', buildingId: origin })
}

class CompetentPolicy implements Policy {
  readonly name: PolicyKind
  readonly #sim: Sim
  readonly #delegating: boolean

  constructor(sim: Sim, kind: PolicyKind = 'competent') {
    this.#sim = sim
    this.name = kind
    this.#delegating = kind === 'delegating'
  }

  step(): void {
    const sim = this.#sim
    if (sim.state.economy.gameOver) return
    if (SIM_FEATURES.payroll) this.#rehire()
    if (this.#delegating) {
      delegatingHireSorter(
        sim,
        bestApplicant(sim, 'sorter'),
        POLICY_PARAMS.purchaseBuffer,
      )
    }
    if (SIM_FEATURES.quests) questPolicyStep(sim)
    this.#opening()
    this.#bikes()
    if (SIM_FEATURES.levels) this.#level2()
    this.#counters()
    if (SIM_FEATURES.payroll) this.#inspectors()
    if (SIM_FEATURES.lane && !(this.#delegating && delegatingHoldBay(sim))) {
      this.#tossEverything()
    }
  }

  #balance(): number {
    return this.#sim.state.economy.balance
  }

  #affords(price: number): boolean {
    return this.#balance() >= price + POLICY_PARAMS.purchaseBuffer
  }

  /**
   * Buy a `type` with the best driver applicant (B2 §7.2: the picker is
   * answered on the purchase tick); never "Hire later" — with an empty pool
   * nothing is bought. The fee is checked by the command (price + fee).
   */
  #buyVehicle(type: string): boolean {
    const def = typeDef(this.#sim, type)
    if (!def) return false
    const a = bestApplicant(this.#sim, 'driver', def.id)
    if (!a) return false
    return this.#sim.dispatch({
      kind: 'buyVehicle',
      type: def.id,
      applicantId: a.id,
    }).ok
  }

  /** The hire fee of the driver #buyVehicle would pick for `type` (0 with none). */
  #driverFee(type: VehicleType): number {
    const a = bestApplicant(this.#sim, 'driver', type)
    return a ? hireFeeOf(this.#sim.data, a, type) : 0
  }

  #buyMachine(defId: string): boolean {
    const slot = firstEmptySlot(this.#sim)
    if (!slot) return false
    return this.#sim.dispatch({ kind: 'buyMachine', defId, nodeId: slot }).ok
  }

  /**
   * REHIRE (run decision, policy extension — M3 review): every walked-out
   * worker, in pay order (employees.json payOrder: inspectors and sorters by
   * hire, drivers by their vehicle's purchase), is re-hired as soon as
   * balance ≥ the re-hire fee + purchaseBuffer, before any new purchase —
   * otherwise one walkout parks a vehicle, empties a desk seat or the Hold
   * Bay station for the rest of the run. Dormant unless a payday ran short
   * twice in a row (never on the gate seeds).
   */
  #rehire(): void {
    const sim = this.#sim
    const s = sim.state
    const out = s.employees.filter((e) => !e.active)
    if (out.length === 0) return
    const bought = (vehicleId: number | null, id: number): [number, number] => {
      const v = s.vehicles.find((x) => x.id === vehicleId)
      return v ? [v.boughtTick, v.id] : [Number.MAX_SAFE_INTEGER, id]
    }
    const payOrder: readonly string[] = sim.data.employees.payOrder
    const rank = (r: Role): number => payOrder.indexOf(`${r}s`)
    const order = out.toSorted((a, b) => {
      if (a.role !== b.role) return rank(a.role) - rank(b.role)
      if (a.role !== 'driver') return a.hiredTick - b.hiredTick || a.id - b.id
      const [ta, ia] = bought(a.vehicleId, a.id)
      const [tb, ib] = bought(b.vehicleId, b.id)
      return ta - tb || ia - ib
    })
    for (const e of order) {
      if (!this.#affords(rehireFee(sim, e))) return
      sim.dispatch({ kind: 'rehire', employeeId: e.id })
    }
  }

  /** Opening A: the first bike (price + its driver's fee), then the Metal detector (spec §7.1). */
  #opening(): void {
    const sim = this.#sim
    const bike = typeDef(sim, 'bike')
    if (
      bike &&
      sim.state.vehicles.length === 0 &&
      this.#balance() >= bike.price + this.#driverFee(bike.id)
    ) {
      this.#buyVehicle('bike')
    }
    const md = machineDef(sim, POLICY_PARAMS.openingMachine)
    if (
      md &&
      md.unlockLevel <= sim.state.level.level &&
      !ownsMachine(sim, md.id) &&
      this.#balance() >= md.price
    ) {
      this.#buyMachine(md.id)
    }
  }

  /** Another bike at price + buffer until maxBikes (spec §7). */
  #bikes(): void {
    const sim = this.#sim
    const bike = typeDef(sim, 'bike')
    if (!bike) return
    const bikes = bikeCount(sim)
    if (bikes === 0 || bikes >= POLICY_PARAMS.maxBikes) return
    if (this.#affords(bike.price)) this.#buyVehicle('bike')
  }

  /** At L2: the truck at price + buffer, then the Shaky shaker (spec §7). */
  #level2(): void {
    const sim = this.#sim
    const truck = typeDef(sim, POLICY_PARAMS.level2Vehicle)
    if (!truck || sim.state.level.level < truck.unlockLevel) return
    if (!ownsVehicle(sim, truck.id)) {
      if (this.#affords(truck.price)) this.#buyVehicle(truck.id)
      return
    }
    const shaker = machineDef(sim, POLICY_PARAMS.level2Machine)
    if (
      shaker &&
      shaker.unlockLevel <= sim.state.level.level &&
      !ownsMachine(sim, shaker.id) &&
      this.#affords(shaker.price)
    ) {
      this.#buyMachine(shaker.id)
    }
  }

  /** The level's spec purchases are done (L1: the bikes; L2: truck + shaker). */
  #specDone(): boolean {
    const sim = this.#sim
    if (bikeCount(sim) < POLICY_PARAMS.maxBikes) return false
    const truck = typeDef(sim, POLICY_PARAMS.level2Vehicle)
    if (!truck || sim.state.level.level < truck.unlockLevel) return true
    return (
      ownsVehicle(sim, truck.id) &&
      ownsMachine(sim, POLICY_PARAMS.level2Machine)
    )
  }

  /** COUNTERS (policy extension, see the header): a free slot → the weakest strain's counter. */
  #counters(): void {
    const sim = this.#sim
    if (!SIM_FEATURES.lane || !firstEmptySlot(sim) || !this.#specDone()) return
    const def = weakestCounter(sim)
    if (!def || def.unlockLevel > sim.state.level.level) return
    if (this.#affords(def.price)) this.#buyMachine(def.id)
  }

  /** A 2nd / 3rd inspector after > dockBlockedHireS of dock blocking in the day (spec §7, re-based). */
  #inspectors(): void {
    const sim = this.#sim
    const s = sim.state
    if (dockBlockedSecondsToday(sim) <= POLICY_PARAMS.dockBlockedHireS) return
    const dayStart = s.day * TICKS_PER_DAY
    const hiredToday = s.employees.some(
      (e) =>
        e.role === 'inspector' && e.hiredTick >= dayStart && e.hiredTick > 0,
    )
    if (hiredToday) return
    // The first desk (by desks.rows index) with a free seat; the best
    // inspector applicant when balance ≥ its hire fee.
    const max = sim.data.employees.desks.maxPerDesk
    const desk = s.lane.nodes
      .filter((n) => n.fixture?.kind === 'desk')
      .toSorted(
        (a, b) =>
          (a.fixture?.kind === 'desk' ? a.fixture.index : 0) -
          (b.fixture?.kind === 'desk' ? b.fixture.index : 0),
      )
      .find(
        (n) =>
          n.fixture?.kind === 'desk' &&
          n.fixture.inspectorIds.length + n.fixture.walkedOutIds.length < max,
      )
    if (!desk) return
    const best = bestApplicant(sim, 'inspector')
    if (!best || this.#balance() < hireFeeOf(sim.data, best)) return
    sim.dispatch({
      kind: 'hire',
      role: 'inspector',
      applicantId: best.id,
      target: { nodeId: desk.id },
    })
  }

  /** Toss every held parcel (spec §7, M2). */
  #tossEverything(): void {
    const sim = this.#sim
    const hold = laneNode(sim.state.lane, sim.state.lane.holdBayNodeId)
    for (const parcelId of (hold?.queue ?? []).slice()) {
      sim.dispatch({ kind: 'toss', parcelId })
    }
  }
}

/** The PolicyFactory the CLI and BootScene load (sim.ts `PolicyFactory`). */
export function createPolicy(sim: Sim, kind: PolicyKind): Policy {
  if (kind !== 'competent' && kind !== 'delegating') {
    throw new Error(`unknown policy ${String(kind)}`)
  }
  return new CompetentPolicy(sim, kind)
}
