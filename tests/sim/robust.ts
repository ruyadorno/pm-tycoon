// Invariant monitor + adversarial players for the M4 robustness hunt
// (tests/sim/robustness.test.ts; plan.md §6.9.2 CLI rules, §12.7). A
// Monitor wraps a Sim: dispatch() / tick() go through it, and it checks,
// every tick, the rules the CLI asserts plus the stricter ones a long or
// hostile run could break:
//   - balance a safe integer ≥ 0, lifetime earned never decreasing, lives an
//     integer in [0, economy.lives.cap];
//   - vehicles: finite position, integer edge progress, a valid path index,
//     unitsUsed = the units of the cargo ≤ capacity, cargo + reservations
//     within capacity; no vehicle in one state > 120 s (idle_lot / inactive
//     exempt — the CLI rule — and, with `allowPlayerStall`, a vehicle held
//     by a stall only the player can end: a full Hold Bay);
//   - parcels: the state matches the place (waiting ⇔ a building, picked up /
//     in transit / unloading / loaded ⇔ a vehicle's cargo, in_conveyor ⇔ a
//     conveyor, in_slot ⇔ a slot buffer or station, held ⇔ the Hold Bay,
//     on_shelf ⇔ the shelf); every reservation is mutual (p.reservedBy ⇔ the
//     vehicle's `reserved`), so no parcel is orphaned by a stale reservation;
//   - caps: the Hold Bay never over its cap; a conveyor over its cap only
//     through a sold vehicle's inbound cargo (§4.1); the shelf grows past its
//     cap only while a dock is in Q-RUN1 relief or through a sold vehicle's
//     outbound cargo (the documented overflow);
//   - every 600 ticks and at the end: auditState (JSON-only values, ids,
//     each parcel in one place, the conservation identity).
// The players read the state and act only through dispatch, so a run is
// replayable from seed + data + command log. Their own randomness is a
// private mulberry32 stream (never the sim's).
// Build 3 (B3 §6, D-8): an open event card holds a policy-less sim, so the
// runners (runPlayer, recordRun) answer whatever card is still open after
// the player's step with a random visible, affordable option drawn on a
// stream of their own (answerCard) — a logged decideEvent, so replays and
// continuations stay exact; a policy player decides its cards itself first.

import type {
  Command,
  CommandLogEntry,
  CommandResult,
} from '../../src/sim/commands.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { auditState, Sim, stateHash } from '../../src/sim/sim.ts'
import type { SimSnapshot } from '../../src/sim/sim.ts'
import { unitsOf } from '../../src/sim/map.ts'
import { cardOptions } from '../../src/sim/systems/deck.ts'
import { outboundEligible } from '../../src/sim/systems/dispatch.ts'
import { salaryOf } from '../../src/sim/systems/people.ts'
import { stuckKey } from '../../tools/sim/cli.ts'
import type {
  Applicant,
  LaneNode,
  Parcel,
  ParcelState,
  VehicleState,
  VehicleType,
} from '../../src/sim/types.ts'
import {
  laneNode,
  liveSlotIds,
  TICKS_PER_DAY,
  TICKS_PER_S,
} from '../../src/sim/types.ts'

/** CLI sanity rule (plan.md §6.9.2): no vehicle stays in one state longer. */
export const STUCK_S = 120
const STUCK_EXEMPT: readonly VehicleState[] = ['idle_lot', 'inactive']

/** mulberry32: a scenario's own stream. */
export function scenarioRng(seed: number): () => number {
  let a = (seed * 0x9e3779b1 + 0x85ebca6b) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const INBOUND: readonly ParcelState[] = [
  'picked_up',
  'in_transit_in',
  'unloading',
]
const OUTBOUND: readonly ParcelState[] = ['loaded', 'in_transit_out']

export interface MonitorOptions {
  /** Exempt vehicles held by a full Hold Bay (a never-Toss player's own stall). */
  allowPlayerStall?: boolean
  /** Stop recording after this many problems (default 20). */
  maxProblems?: number
  /**
   * 'state' (default): no vehicle in one state > 120 s.
   * 'progress' (the CLI rule since M9, tools/sim/cli.ts stuckKey): no
   * vehicle without progress (same state, cargo, stop, wait timer and
   * reservations — position is not progress, so a routing loop is caught)
   * for 120 s — for the chaos player, whose rush storms keep a truck in one
   * state on a long collect leg, and for the L4-L5 map, where a truck's
   * 12-stop delivering leg runs longer than 120 s in one state.
   */
  stuck?: 'state' | 'progress'
  /**
   * Run the full cross-reference scan (places, reservations, docks,
   * employees) every N ticks instead of every tick (long runs; default 1).
   * Money, lives, the Hold Bay cap, the event-time cap rules and the stuck
   * rule still run every tick.
   */
  every?: number
}

export class Monitor {
  readonly sim: Sim
  readonly problems: string[] = []
  /** Most parcels the shelf / a conveyor held past its cap. */
  maxShelfOver = 0
  maxConveyorOver = 0
  /** Ticks with a vehicle exempted by `allowPlayerStall`. */
  playerStallTicks = 0
  readonly #opts: MonitorOptions
  readonly #since = new Map<number, { key: string; tick: number }>()
  #selling = false
  #earned: number
  /** Balance implied by the money:changed ledger since construction. */
  #ledger: number

  constructor(sim: Sim, opts: MonitorOptions = {}) {
    this.sim = sim
    this.#opts = opts
    this.#earned = sim.state.economy.lifetimeEarned
    this.#ledger = sim.state.economy.balance
    sim.addTap((name, payload) => {
      const s = sim.state
      if (name === 'money:changed') {
        const m = payload as { delta: number; balance: number }
        this.#ledger += m.delta
        if (this.#ledger !== m.balance) {
          this.fail(
            `money:changed: ledger ${this.#ledger} ≠ balance ${m.balance}`,
          )
          this.#ledger = m.balance
        }
      }
      if (name === 'parcel:shelved' || name === 'parcel:returned') {
        const shelf = laneNode(s.lane, s.lane.shelfNodeId)
        const over =
          shelf && shelf.cap !== null ? shelf.queue.length - shelf.cap : 0
        if (over > 0) {
          this.maxShelfOver = Math.max(this.maxShelfOver, over)
          const relief = s.lane.docks.some((d) => d.relief === true)
          const ok = name === 'parcel:returned' ? this.#selling : relief
          if (!ok) {
            this.fail(
              `${name} ${(payload as { id: number }).id}: shelf ${shelf?.queue.length} > cap ${shelf?.cap} with no relief / sale`,
            )
          }
        }
      }
      if (name === 'parcel:unloaded') {
        const dockId = (payload as { dockId: string }).dockId
        const dock = s.lane.docks.find((d) => d.id === dockId)
        const conv = dock ? laneNode(s.lane, dock.conveyorNodeId) : null
        const over =
          conv && conv.cap !== null ? conv.queue.length - conv.cap : 0
        if (over > 0) {
          this.maxConveyorOver = Math.max(this.maxConveyorOver, over)
          if (!this.#selling) {
            this.fail(
              `parcel:unloaded: ${conv?.id} ${conv?.queue.length} > cap ${conv?.cap} outside a sale`,
            )
          }
        }
      }
    })
  }

  /** Re-base the money ledger after a test patched the balance directly. */
  resyncLedger(): void {
    this.#ledger = this.sim.state.economy.balance
  }

  fail(msg: string): void {
    if (this.problems.length < (this.#opts.maxProblems ?? 20)) {
      this.problems.push(`t${this.sim.state.tick}: ${msg}`)
    }
  }

  dispatch(cmd: Command): CommandResult {
    this.#selling = cmd.kind === 'sellVehicle'
    try {
      return this.sim.dispatch(cmd)
    } finally {
      this.#selling = false
      this.checkCheap()
    }
  }

  tick(): void {
    this.sim.tick()
    const every = this.#opts.every ?? 1
    if (every <= 1 || this.sim.state.tick % every === 0) this.checkCheap()
    else this.checkMoney()
    this.checkStuck()
    if (this.sim.state.tick % TICKS_PER_DAY === 0) this.audit()
  }

  /** auditState now (also call at the end of a run). */
  audit(): void {
    for (const p of auditState(this.sim.state, this.sim.data)) this.fail(p)
  }

  /** Balance, lifetime earned, lives (every tick even when sampling). */
  checkMoney(): void {
    const s = this.sim.state
    const eco = s.economy
    if (!Number.isSafeInteger(eco.balance) || eco.balance < 0) {
      this.fail(`balance ${eco.balance}`)
    }
    if (eco.lifetimeEarned < this.#earned) {
      this.fail(`lifetime earned fell ${this.#earned} → ${eco.lifetimeEarned}`)
    }
    this.#earned = eco.lifetimeEarned
    const cap = this.sim.data.economy.lives.cap
    if (!Number.isInteger(eco.lives) || eco.lives < 0 || eco.lives > cap) {
      this.fail(`lives ${eco.lives} outside [0, ${cap}]`)
    }
  }

  /** The per-tick rules (see the header). */
  checkCheap(): void {
    const sim = this.sim
    const s = sim.state
    const eco = s.economy
    if (!Number.isSafeInteger(eco.balance) || eco.balance < 0) {
      this.fail(`balance ${eco.balance}`)
    }
    if (eco.lifetimeEarned < this.#earned) {
      this.fail(`lifetime earned fell ${this.#earned} → ${eco.lifetimeEarned}`)
    }
    this.#earned = eco.lifetimeEarned
    const cap = sim.data.economy.lives.cap
    if (!Number.isInteger(eco.lives) || eco.lives < 0 || eco.lives > cap) {
      this.fail(`lives ${eco.lives} outside [0, ${cap}]`)
    }
    if (eco.balance !== this.#ledger) {
      this.fail(
        `balance ${eco.balance} moved outside money:changed (${this.#ledger})`,
      )
      this.#ledger = eco.balance
    }
    if (s.stats.income !== eco.lifetimeEarned) {
      this.fail(
        `stats.income ${s.stats.income} ≠ lifetime earned ${eco.lifetimeEarned}`,
      )
    }
    const sat = sim.data.economy.satisfaction
    for (const [id, d] of Object.entries(s.districts)) {
      if (
        !Number.isInteger(d.satisfaction) ||
        d.satisfaction < sat.min ||
        d.satisfaction > sat.max
      ) {
        this.fail(`district ${id}: satisfaction ${d.satisfaction}`)
      }
      if (d.live && d.nextSpawnTick !== null && d.nextSpawnTick <= s.tick - 1) {
        this.fail(`district ${id}: spawn timer ${d.nextSpawnTick} overdue`)
      }
    }
    const hold = laneNode(s.lane, s.lane.holdBayNodeId)
    if (hold && hold.cap !== null && hold.queue.length > hold.cap) {
      this.fail(`Hold Bay ${hold.queue.length} > cap ${hold.cap}`)
    }
    for (const n of s.lane.nodes) {
      if (n.locked && (n.queue.length > 0 || n.stations.length > 0)) {
        this.fail(`${n.id}: locked but holds parcels / stations`)
      }
    }

    // Docks, the dock queue and vehicle states agree.
    const q = s.lane.dockQueue
    if (new Set(q).size !== q.length) this.fail(`dockQueue duplicates ${q}`)
    for (const d of s.lane.docks) {
      if (d.vehicleId !== null && q.includes(d.vehicleId)) {
        this.fail(
          `vehicle ${d.vehicleId} both docked at ${d.id} and in the queue`,
        )
      }
      if (d.relief === true && d.vehicleId === null) {
        this.fail(`${d.id}: relief with no vehicle`)
      }
    }
    for (const v of s.vehicles) {
      const dock = s.lane.docks.find((d) => d.vehicleId === v.id) ?? null
      const docked =
        v.state === 'docked_unloading' || v.state === 'docked_loading'
      if (docked && (dock === null || v.dockId !== dock.id)) {
        this.fail(`${v.name} ${v.state} without its dock`)
      }
      if (v.state === 'queued' && !q.includes(v.id) && dock === null) {
        this.fail(
          `${v.name} queued but neither in the queue nor assigned a dock`,
        )
      }
      if (
        !docked &&
        v.state !== 'queued' &&
        (v.dockId !== null || dock !== null)
      ) {
        this.fail(`${v.name} ${v.state} still holds dock ${v.dockId}`)
      }
      if (v.state !== 'queued' && q.includes(v.id)) {
        this.fail(`${v.name} ${v.state} still in the dock queue`)
      }
      const driver = s.employees.find((e) => e.id === v.driverId)
      if (v.driverId !== null && (!driver || driver.vehicleId !== v.id)) {
        this.fail(`${v.name}: driver ${v.driverId} does not drive it`)
      }
      if (v.state === 'idle_lot' && driver && !driver.active) {
        this.fail(`${v.name} idle_lot with a walked-out driver`)
      }
      if (v.state === 'idle_lot' && v.driverId === null) {
        this.fail(`${v.name} idle_lot with no driver`)
      }
      if (v.state === 'idle_lot' && v.nextDriverId !== null) {
        this.fail(`${v.name} idle_lot with a Replace still pending`)
      }
      if (v.state === 'inactive' && driver && driver.active) {
        this.fail(`${v.name} inactive with an active driver`)
      }
      if (
        v.rushBuildingId !== null &&
        (s.buildings[v.rushBuildingId]?.rushUntilTick ?? null) === null
      ) {
        this.fail(`${v.name} rushing ${v.rushBuildingId} with no flag up`)
      }
      for (const id of v.cargo) {
        const p = s.parcels[String(id)]
        if (p && p.vehicleId !== v.id) {
          this.fail(`parcel ${id} in ${v.name} has vehicleId ${p.vehicleId}`)
        }
      }
    }
    // Employees: drivers drive (or wait to take over, M6) their vehicle;
    // a sorter holds the Hold Bay station; inspectors sit at a desk.
    for (const e of s.employees) {
      if (e.role === 'driver') {
        const v = s.vehicles.find((x) => x.id === e.vehicleId)
        if (!v || (v.driverId !== e.id && v.nextDriverId !== e.id))
          this.fail(`driver ${e.id} has no vehicle`)
        continue
      }
      if (e.role === 'sorter') {
        if (s.lane.holdStation.fixture !== e.id)
          this.fail(`sorter ${e.id} is not on the Hold Bay station`)
        continue
      }
      const seats = s.lane.nodes.filter((n) => {
        const f = n.fixture
        if (f?.kind !== 'desk') return false
        return e.active
          ? f.inspectorIds.includes(e.id)
          : f.walkedOutIds.includes(e.id)
      })
      if (seats.length !== 1 || seats[0]?.id !== e.nodeId) {
        this.fail(
          `inspector ${e.id} (${e.active ? 'active' : 'out'}) seated at ${seats.map((n) => n.id)} vs nodeId ${e.nodeId}`,
        )
      }
    }
    for (const n of s.lane.nodes) {
      const f = n.fixture
      if (f?.kind !== 'desk') continue
      for (const id of [...f.inspectorIds, ...f.walkedOutIds]) {
        if (!s.employees.some((e) => e.id === id && e.role === 'inspector')) {
          this.fail(`${n.id}: desk lists unknown inspector ${id}`)
        }
      }
      if (f.inspectorIds.length !== f.checker.stations) {
        this.fail(
          `${n.id}: ${f.inspectorIds.length} inspectors ≠ ${f.checker.stations} stations`,
        )
      }
    }

    // Where each live parcel is, by place kind.
    const place: Record<string, string> = {}
    for (const b of Object.values(s.buildings)) {
      for (const id of b.waiting) place[id] = 'building'
    }
    for (const v of s.vehicles) {
      for (const id of v.cargo) place[id] = `vehicle${v.id}`
    }
    const nodeOf: Record<string, string> = {}
    for (const n of s.lane.nodes) {
      for (const id of n.queue) {
        place[id] = n.kind
        nodeOf[id] = n.id
      }
      for (const st of n.stations) {
        if (st.parcelId !== null) {
          place[st.parcelId] = n.kind
          nodeOf[st.parcelId] = n.id
        }
      }
    }
    for (const [k, p] of Object.entries(s.parcels)) {
      const where = place[k]
      if (!placeMatches(p, where)) {
        this.fail(`parcel ${k} is ${p.state} but sits in ${where ?? 'nowhere'}`)
      }
      const inLane =
        where !== undefined &&
        !where.startsWith('vehicle') &&
        where !== 'building'
      if (inLane && p.nodeId !== nodeOf[k]) {
        this.fail(`parcel ${k} in ${nodeOf[k]} has nodeId ${p.nodeId}`)
      }
      if (p.reservedBy !== null) {
        const v = s.vehicles.find((x) => x.id === p.reservedBy)
        if (!v || !v.reserved.includes(p.id)) {
          this.fail(
            `parcel ${k} (${p.state}) reservedBy ${p.reservedBy}, not in that vehicle's reservations`,
          )
        }
      }
    }

    for (const v of s.vehicles) {
      const def = sim.data.vehicles.types.find((t) => t.id === v.type)
      const capU = def?.capacityUnits ?? 0
      if (!Number.isFinite(v.pos.tx) || !Number.isFinite(v.pos.ty)) {
        this.fail(`${v.name}: position ${v.pos.tx},${v.pos.ty}`)
      }
      if (!Number.isInteger(v.edgeT) || v.edgeT < 0) {
        this.fail(`${v.name}: edgeT ${v.edgeT}`)
      }
      // A route of ≥ 2 tiles is mid-way (index ≤ length − 2); a one-tile
      // route ("already there") arrives on the next step.
      if (
        v.path.length > 0 &&
        (v.pathIndex < 0 || v.pathIndex > Math.max(0, v.path.length - 2))
      ) {
        this.fail(`${v.name}: pathIndex ${v.pathIndex} of ${v.path.length}`)
      }
      let units = 0
      for (const id of v.cargo) {
        const p = s.parcels[String(id)]
        if (p) units += unitsOf(sim.data, p.size)
      }
      if (units !== v.unitsUsed) {
        this.fail(`${v.name}: unitsUsed ${v.unitsUsed} ≠ cargo units ${units}`)
      }
      let reserved = 0
      for (const id of v.reserved) {
        const p = s.parcels[String(id)]
        if (!p) {
          this.fail(`${v.name}: reserves missing parcel ${id}`)
          continue
        }
        if (p.reservedBy !== v.id) {
          this.fail(`${v.name}: reserves parcel ${id} held by ${p.reservedBy}`)
        }
        reserved += unitsOf(sim.data, p.size)
      }
      if (units > capU || units + reserved > capU) {
        this.fail(`${v.name}: ${units} + ${reserved} reserved units > ${capU}`)
      }
    }
  }

  /** No vehicle stuck > STUCK_S (see MonitorOptions.stuck; idle_lot / inactive exempt). */
  checkStuck(): void {
    const sim = this.sim
    const s = sim.state
    const lane = s.lane
    // A stall only the player can end: a full Hold Bay, or a full shelf no
    // owned vehicle can carry from (§6.4; tests/sim/soak.ts).
    const heldUp =
      this.#opts.allowPlayerStall === true &&
      lane.stalled &&
      (lane.stallReason === 'holdBayFull' ||
        (lane.stallReason === 'shelfFull' && !fleetCanCarryShelf(sim)))
    const progress = this.#opts.stuck === 'progress'
    for (const v of s.vehicles) {
      const key = progress ? stuckKey(v) : v.state
      const prev = this.#since.get(v.id)
      if (!prev || prev.key !== key) {
        this.#since.set(v.id, { key, tick: s.tick })
        continue
      }
      if (STUCK_EXEMPT.includes(v.state)) continue
      const waiting =
        v.state === 'queued' ||
        v.state === 'docked_unloading' ||
        v.state === 'docked_loading'
      if (heldUp && waiting) {
        this.playerStallTicks += 1
        prev.tick = s.tick
        continue
      }
      if (s.tick - prev.tick > STUCK_S * TICKS_PER_S) {
        this.fail(
          `${v.name} stuck in ${v.state} > ${STUCK_S} s${progress ? ' without progress' : ''}`,
        )
        prev.tick = s.tick // report once per 120 s
      }
    }
  }
}

/** Some owned vehicle could carry ≥ 1 shelf parcel (§4.5 step-1 filters). */
export function fleetCanCarryShelf(sim: Sim): boolean {
  const shelf = laneNode(sim.state.lane, sim.state.lane.shelfNodeId)
  if (!shelf) return false
  return sim.state.vehicles.some(
    (v) =>
      v.state !== 'inactive' &&
      shelf.queue.some((id) => {
        const p = sim.state.parcels[String(id)]
        return p !== undefined && outboundEligible(sim, v, p)
      }),
  )
}

function placeMatches(p: Parcel, where: string | undefined): boolean {
  switch (p.state) {
    case 'waiting':
      return where === 'building'
    case 'in_conveyor':
      return where === 'conveyor'
    case 'in_slot':
      return where === 'slot'
    case 'held':
      return where === 'holdBay'
    case 'on_shelf':
      return where === 'shelf'
    case 'delivered':
    case 'tossed':
    case 'cleared':
    case 'lost':
    case 'handed_off':
    case 'clearing':
      return where === undefined
    default:
      if (INBOUND.includes(p.state) || OUTBOUND.includes(p.state)) {
        return where !== undefined && where.startsWith('vehicle')
      }
      return false
  }
}

// Players ------------------------------------------------------------------------------

export interface Player {
  readonly name: string
  /** Called once before every tick (like the policy). */
  step(m: Monitor): void
}

/** A stream for answering cards (a scenario's own, never the sim's). */
export function cardRng(seed: number): () => number {
  return scenarioRng((seed ^ 0xca7d5) >>> 0)
}

/**
 * Answer the open event card, if any, with a random visible, affordable
 * option drawn on `r` (build 3, D-8): a logged decideEvent through the
 * monitor. Returns how many cards it answered (a promoted queue card too).
 */
export function answerCard(m: Monitor, r: () => number): number {
  let n = 0
  for (let guard = 0; guard < 4; guard++) {
    const open = m.sim.state.events.open
    if (open === null) return n
    const opts = cardOptions(m.sim, open).filter(
      (o) => o.visible && o.affordable,
    )
    const o = opts[Math.floor(r() * opts.length)]
    if (o === undefined) return n
    const res = m.dispatch({
      kind: 'decideEvent',
      eventId: open.eventId,
      option: o.index,
    })
    if (!res.ok && res.applied !== true) return n
    n += 1
  }
  return n
}

/** The §7 competent policy as a Player. */
export function policyPlayer(sim: Sim): Player {
  const policy = createPolicy(sim, 'competent')
  return {
    name: 'policy',
    step: () => policy.step(),
  }
}

/** Buys nothing, ever (the no-policy idle run). */
export const idlePlayer: Player = { name: 'idle', step: () => {} }

const held = (sim: Sim): number[] =>
  laneNode(sim.state.lane, sim.state.lane.holdBayNodeId)?.queue.slice() ?? []

const deskNode = (sim: Sim): LaneNode | null =>
  sim.state.lane.nodes.find((n) => n.fixture?.kind === 'desk') ?? null

/**
 * The "bad player" of the M4 hunt: buys bikes until it owns six whatever the
 * payroll (so paydays run short and workers walk out — never re-hired);
 * never Tosses and Clears everything held; part-way through sells down to
 * one vehicle mid-trip; removes the desk while a parcel is mid-process (and
 * later puts one back); moves fixtures around every few seconds; rushes and
 * re-zones at random.
 */
export function badPlayer(seed: number, sellAtS = 480): Player {
  const r = scenarioRng(seed)
  let bikesBought = 0
  let soldDown = false
  let deskRemoved = false
  return {
    name: 'bad',
    step(m) {
      const sim = m.sim
      const s = sim.state
      if (s.economy.gameOver) return
      // Six bikes, payroll be damned.
      if (bikesBought < 6 && s.economy.balance >= 200) {
        // M6: the priciest driver in the pool (payroll be damned; replay-safe).
        const a = s.applicants.driver.reduce<Applicant | null>(
          (best, x) =>
            best === null ||
            salaryOf(sim.data, 'driver', x.pips, 'bike') >
              salaryOf(sim.data, 'driver', best.pips, 'bike')
              ? x
              : best,
          null,
        )
        const cmd: Command = {
          kind: 'buyVehicle',
          type: 'bike',
          applicantId: a ? a.id : null,
        }
        if (m.dispatch(cmd).ok) {
          bikesBought += 1
        }
      }
      // Clear everything (never Toss).
      for (const id of held(sim)) m.dispatch({ kind: 'clear', parcelId: id })
      // Sell down to one vehicle mid-trip.
      if (!soldDown && s.tick >= sellAtS * TICKS_PER_S) {
        const busy = s.vehicles.filter(
          (v) => v.state !== 'idle_lot' && v.state !== 'inactive',
        )
        if (busy.length >= 2 || s.tick >= (sellAtS + 120) * TICKS_PER_S) {
          soldDown = true
          for (const v of s.vehicles.slice(1)) {
            m.dispatch({ kind: 'sellVehicle', id: v.id })
          }
        }
      }
      // Remove the desk mid-process; put one back a minute later.
      const desk = deskNode(sim)
      if (
        !deskRemoved &&
        desk &&
        desk.stations.some((st) => st.parcelId !== null) &&
        s.tick >= 200 * TICKS_PER_S
      ) {
        deskRemoved = true
        m.dispatch({ kind: 'removeFixture', nodeId: desk.id })
      }
      if (deskRemoved && !desk && s.tick % (60 * TICKS_PER_S) === 0) {
        const free = liveSlotIds(s.lane).find(
          (id) => !laneNode(s.lane, id)?.fixture,
        )
        if (free) m.dispatch({ kind: 'placeDesk', nodeId: free, index: 1 })
      }
      const a = s.applicants.inspector[0]
      if (desk && a && r() < 0.002) {
        m.dispatch({
          kind: 'hire',
          role: 'inspector',
          applicantId: a.id,
          target: { nodeId: desk.id },
        })
      }
      // Move fixtures around.
      if (s.tick % 70 === 0) {
        const slots = liveSlotIds(s.lane)
        const from = slots[Math.floor(r() * slots.length)]
        const to = slots[Math.floor(r() * slots.length)]
        if (from && to) m.dispatch({ kind: 'moveFixture', from, to })
      }
      // Rush / re-zone now and then.
      if (r() < 0.004) {
        const b = Object.values(s.buildings).filter((x) => x.waiting.length > 0)
        const pick = b[Math.floor(r() * b.length)]
        if (pick) m.dispatch({ kind: 'rush', buildingId: pick.id })
      }
      if (r() < 0.002 && s.vehicles.length > 0) {
        const v = s.vehicles[Math.floor(r() * s.vehicles.length)]
        const zones = ['any', ...s.level.unlocked]
        const zone = zones[Math.floor(r() * zones.length)] ?? 'any'
        if (v) m.dispatch({ kind: 'setZone', id: v.id, zone })
      }
    },
  }
}

/** Run a player for `minutes`, the monitor checking every tick. */
export function runPlayer(
  m: Monitor,
  player: Player,
  minutes: number,
  each?: (m: Monitor) => void,
): void {
  const end = m.sim.state.tick + minutes * TICKS_PER_DAY
  const r = cardRng(m.sim.state.seed)
  while (m.sim.state.tick < end) {
    player.step(m)
    answerCard(m, r)
    m.tick()
    each?.(m)
  }
  m.audit()
}

export const VEHICLE_TYPES: readonly VehicleType[] = ['bike', 'van', 'truck']

// Save / load continuation -------------------------------------------------------------

/** A JSON snapshot taken during a recorded run, and why. */
export interface TakenSnapshot {
  why: string
  tick: number
  json: string
}

export interface RecordedRun {
  sim: Sim
  monitor: Monitor
  snapshots: TakenSnapshot[]
  /** stateHash at every minute boundary of the live run (tick → hash). */
  minuteHashes: Map<number, string>
}

/**
 * Run `player` for `minutes` under a Monitor, snapshotting (JSON) at the
 * ticks in `at` and at the first tick after each event in `onEvent` (the
 * tick it fired in has finished; the player has not stepped yet).
 */
export function recordRun(
  sim: Sim,
  player: Player,
  minutes: number,
  opts: {
    at?: readonly number[]
    onEvent?: readonly string[]
    /** Also snapshot when this holds (checked after every tick), once. */
    when?: readonly { why: string; test: (sim: Sim) => boolean }[]
    monitor?: MonitorOptions
  } = {},
): RecordedRun {
  const monitor = new Monitor(sim, opts.monitor)
  const snapshots: TakenSnapshot[] = []
  const pending = new Set<string>()
  const seen = new Set<string>()
  sim.addTap((name) => {
    if (opts.onEvent?.includes(name) && !seen.has(name)) pending.add(name)
  })
  const at = new Set(opts.at ?? [])
  const when = (opts.when ?? []).slice()
  const take = (why: string): void => {
    snapshots.push({
      why,
      tick: sim.state.tick,
      json: JSON.stringify(sim.snapshot()),
    })
  }
  const minuteHashes = new Map<number, string>()
  const end = sim.state.tick + minutes * TICKS_PER_DAY
  const r = cardRng(sim.state.seed)
  while (sim.state.tick < end) {
    player.step(monitor)
    answerCard(monitor, r)
    monitor.tick()
    const t = sim.state.tick
    for (const name of pending) {
      seen.add(name)
      take(name)
    }
    pending.clear()
    if (at.has(t)) take(`tick ${t}`)
    for (let i = when.length - 1; i >= 0; i--) {
      const w = when[i] as (typeof when)[number]
      if (w.test(sim)) {
        take(w.why)
        when.splice(i, 1)
      }
    }
    if (t % TICKS_PER_DAY === 0) minuteHashes.set(t, stateHash(sim.state))
  }
  monitor.audit()
  return { sim, monitor, snapshots, minuteHashes }
}

/**
 * Load a snapshot from JSON and run it on, feeding the live log's later
 * commands at their ticks, to the live run's end or `windowTicks` past the
 * snapshot: the hash at every minute boundary on the way (and at the end of
 * a full continuation) must equal the live run's. Returns the mismatches
 * (empty = an identical continuation) and the loaded sim.
 */
export function continueFrom(
  run: RecordedRun,
  snap: TakenSnapshot,
  windowTicks = Number.POSITIVE_INFINITY,
): { problems: string[]; loaded: Sim } {
  const live = run.sim
  const parsed = JSON.parse(snap.json) as SimSnapshot
  const loaded = Sim.load(live.data, parsed)
  const problems: string[] = []
  if (stateHash(loaded.state) !== stateHash(parsed.state)) {
    problems.push(`${snap.why}: the loaded state differs from the snapshot`)
  }
  const rest = live.commandLog.slice(loaded.commandLog.length)
  const end = Math.min(live.state.tick, snap.tick + windowTicks)
  let i = 0
  let compared = 0
  while (loaded.state.tick < end) {
    while (
      i < rest.length &&
      (rest[i] as CommandLogEntry).tick === loaded.state.tick
    ) {
      loaded.dispatch((rest[i] as CommandLogEntry).cmd)
      i += 1
    }
    loaded.tick()
    const t = loaded.state.tick
    const want = run.minuteHashes.get(t)
    if (want !== undefined) {
      compared += 1
      if (stateHash(loaded.state) !== want) {
        problems.push(`${snap.why} (t${snap.tick}): hash differs at t${t}`)
        break
      }
    }
  }
  if (problems.length === 0 && end === live.state.tick) {
    if (stateHash(loaded.state) !== stateHash(live.state)) {
      problems.push(`${snap.why} (t${snap.tick}): final hash differs`)
    }
    if (loaded.commandLog.length !== live.commandLog.length) {
      problems.push(
        `${snap.why}: command log ${loaded.commandLog.length} ≠ live ${live.commandLog.length}`,
      )
    }
  } else if (problems.length === 0 && compared === 0) {
    problems.push(
      `${snap.why} (t${snap.tick}): window ended before a minute boundary`,
    )
  }
  return { problems, loaded }
}

/** A checker has flagged a parcel that still waits in its slot (the Hold Bay full): mid-catch. */
export function midCatch(sim: Sim): boolean {
  const s = sim.state
  return s.lane.nodes.some(
    (n) =>
      n.kind === 'slot' &&
      [...n.queue, ...n.stations.map((st) => st.parcelId)].some(
        (id) =>
          id !== null && (s.parcels[String(id)]?.flaggedBy ?? null) !== null,
      ),
  )
}

/** A station is processing a parcel and the Hold Bay holds one. */
export function midProcessAndHeld(sim: Sim): boolean {
  const s = sim.state
  const busy = s.lane.nodes.some((n) =>
    n.stations.some(
      (st) =>
        st.parcelId !== null && st.doneTick !== null && st.doneTick > s.tick,
    ),
  )
  const hold = laneNode(s.lane, s.lane.holdBayNodeId)
  return busy && (hold?.queue.length ?? 0) > 0
}

/**
 * A chaos player: every tick, with probability `rate`, one random command
 * from the whole command set (any target, valid or not) — buying any
 * vehicle type, selling any vehicle in any state, Toss / Clear of random
 * held parcels, buying / placing / moving / removing fixtures, hiring,
 * firing and re-hiring, home zones incl. Industrial, rushes.
 */
export function chaosPlayer(seed: number, rate = 0.08): Player {
  const r = scenarioRng(seed ^ 0x5bd1e995)
  const pick = <T>(xs: readonly T[]): T | undefined =>
    xs[Math.floor(r() * xs.length)]
  return {
    name: 'chaos',
    step(m) {
      if (r() >= rate) return
      const s = m.sim.state
      const slots = s.lane.slotNodeIds
      const k = r()
      let cmd: Command | null = null
      if (k < 0.12) {
        const id = pick(held(m.sim))
        if (id !== undefined) {
          cmd = { kind: r() < 0.5 ? 'toss' : 'clear', parcelId: id }
        }
      } else if (k < 0.22) {
        cmd = {
          kind: 'buyVehicle',
          type: pick(VEHICLE_TYPES) ?? 'bike',
          applicantId:
            pick([...s.applicants.driver.map((a) => a.id), null, 999]) ?? null,
        }
      } else if (k < 0.3) {
        const v = pick(s.vehicles)
        if (v) cmd = { kind: 'sellVehicle', id: v.id }
      } else if (k < 0.38) {
        const v = pick(s.vehicles)
        const zone = pick(['any', 'industrial', ...s.level.unlocked]) ?? 'any'
        if (v) cmd = { kind: 'setZone', id: v.id, zone }
      } else if (k < 0.46) {
        const b = pick(
          Object.values(s.buildings).filter((x) => x.waiting.length > 0),
        )
        if (b) cmd = { kind: 'rush', buildingId: b.id }
      } else if (k < 0.54) {
        cmd = {
          kind: 'buyMachine',
          defId:
            pick(m.sim.data.machines.checkers.map((c) => c.id)) ??
            'metal_detector',
          nodeId: pick(slots) ?? 'slot1',
        }
      } else if (k < 0.6) {
        cmd = {
          kind: 'placeDesk',
          nodeId: pick(slots) ?? 'slot1',
          index: pick([1, 2, 3]) ?? 1,
        }
      } else if (k < 0.7) {
        cmd = {
          kind: 'moveFixture',
          from: pick(slots) ?? 'slot1',
          to: pick(slots) ?? 'slot2',
        }
      } else if (k < 0.74) {
        cmd = { kind: 'removeFixture', nodeId: pick(slots) ?? 'slot1' }
      } else if (k < 0.82) {
        // M6: hire any role from its pool into a random target (valid or not).
        const role = pick([
          'inspector',
          'inspector',
          'sorter',
          'driver',
        ] as const)!
        const a = pick(s.applicants[role])
        const target =
          role === 'inspector'
            ? { nodeId: pick(slots) ?? 'slot1' }
            : role === 'sorter'
              ? { station: 'hold' as const }
              : { vehicleId: pick(s.vehicles)?.id ?? 1 }
        if (a) cmd = { kind: 'hire', role, applicantId: a.id, target }
        else if (r() < 0.5) cmd = { kind: 'postAd', role }
      } else if (k < 0.86) {
        const e = pick(s.employees)
        if (e) cmd = { kind: 'fire', employeeId: e.id }
        else {
          const id = pick(held(m.sim))
          if (id !== undefined) cmd = { kind: 'touchHeld', parcelId: id }
        }
      } else if (k < 0.92) {
        const e = pick(s.employees.filter((x) => !x.active))
        if (e) cmd = { kind: 'rehire', employeeId: e.id }
      } else {
        // Shelf-full pressure: Clear every held parcel.
        for (const id of held(m.sim))
          m.dispatch({ kind: 'clear', parcelId: id })
      }
      if (cmd) m.dispatch(cmd)
    },
  }
}

// Scenario helpers shared by the robustness tests -----------------------------------------

/** Two in-game minutes: how far a continuation is compared after a load. */
export const WINDOW = 2 * TICKS_PER_DAY

/** `n` snapshot ticks in [1, minutes − 2) from a stream of its own. */
export function randomTicks(
  seed: number,
  minutes: number,
  n: number,
): number[] {
  const r = scenarioRng(seed * 131)
  return Array.from({ length: n }, () =>
    Math.max(1, Math.floor(r() * (minutes - 2) * TICKS_PER_DAY)),
  )
}

/** Every snapshot of a run, loaded from JSON, continues identically (empty = all did). */
export function continuationProblems(
  run: RecordedRun,
  window = WINDOW,
): string[] {
  if (run.snapshots.length === 0) return ['no snapshot taken']
  return run.snapshots.flatMap(
    (snap) => continueFrom(run, snap, window).problems,
  )
}

/** Events a save may land right after (plan.md §6.4; the M4 hunt list). */
export const MOMENTS: readonly string[] = [
  'level:up',
  'region:unlocked',
  'worker:walkedOut',
  'life:lost',
  'game:over',
  'vehicle:sold',
  'lane:fixtureRemoved',
  'lane:fixtureMoved',
  'parcel:cleared_by_player',
  'payroll:short',
]

/** States a save may land in (the first tick each holds). */
export const STATES: readonly { why: string; test: (sim: Sim) => boolean }[] = [
  {
    why: 'Hold Bay full',
    test: (s) => s.state.lane.stallReason === 'holdBayFull',
  },
  { why: 'mid-catch', test: midCatch },
  { why: 'mid-process + held', test: midProcessAndHeld },
  {
    why: 'relief',
    test: (s) => s.state.lane.docks.some((d) => d.relief === true),
  },
  {
    why: 'driverless trip',
    test: (s) =>
      s.state.vehicles.some(
        (v) =>
          v.state !== 'inactive' &&
          s.state.employees.some((e) => e.id === v.driverId && !e.active),
      ),
  },
]

/**
 * A recorded run of one player with snapshots at random ticks, after every
 * MOMENTS event (first of each) and at the first tick of every STATES state.
 */
export function hostileRun(
  sim: Sim,
  player: Player,
  minutes: number,
  seed: number,
  monitor: MonitorOptions = {},
): RecordedRun {
  return recordRun(sim, player, minutes, {
    at: randomTicks(seed, minutes, 3),
    onEvent: MOMENTS,
    when: STATES,
    monitor,
  })
}
