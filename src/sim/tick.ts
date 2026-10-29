// The tick loop (plan.md §6.4): one call = 100 ms of sim time, twelve steps
// in a fixed order. Each step is a named function over (sim, ctx); later
// milestones replace the TODO bodies with calls into src/sim/systems/*.ts
// (keep the order — the rng stream depends on it). Commands never run inside
// a tick: they apply immediately in Sim.dispatch.

import type { Sim } from './sim.ts'
import type { MinuteRow } from './types.ts'
import {
  laneNode,
  malwareShare,
  meanSatisfaction,
  TICKS_PER_DAY,
} from './types.ts'

/** Per-tick scratch, discarded after the tick (never serialised). */
export interface TickContext {
  /** Set by clock: this tick closes an in-game day (tick % 600 === 0). */
  dayBoundary: boolean
}

export type TickStep = (sim: Sim, ctx: TickContext) => void

/** 1. tick += 1; day = floor(tick / 600); dayBoundary. */
export function clock(sim: Sim, ctx: TickContext): void {
  const s = sim.state
  s.tick += 1
  s.day = Math.floor(s.tick / TICKS_PER_DAY)
  ctx.dayBoundary = s.tick % TICKS_PER_DAY === 0
}

/** 2. Per-district spawn timers, scripted first malware + deferral, decoys, labels. */
export function spawn(_sim: Sim, _ctx: TickContext): void {
  // TODO(M1): systems/spawn.ts (§5.2, §5.4; malwareShare() in types.ts).
}

/** 3. Every dispatchTickS: the idle_lot pass (§4.5 step 2) + rush re-evaluation (§4.1). */
export function dispatch(_sim: Sim, _ctx: TickContext): void {
  // TODO(M1): systems/dispatch.ts idlePass / applyRush.
}

/** 4. prev ← pos, movement, headings, wheel, 1.5 s stops, pickups, deliveries, hand-offs, lot entrance → queued. */
export function vehicles(_sim: Sim, _ctx: TickContext): void {
  // TODO(M1): systems/vehicles.ts (+ value.ts payouts, satisfaction deltas);
  // TODO(M2): life:lost on malware delivered.
}

/** 5. Dock queue → free dock, unload / outbound set / load, idle wait, depart, busyTicksThisDay. */
export function docks(_sim: Sim, _ctx: TickContext): void {
  // TODO(M1): systems/docks.ts (§4.3, §4.6, §6.5).
}

/** 6. Conveyor → slots → Hold Bay / shelf, process timers, rolls, stalls. */
export function lane(_sim: Sim, _ctx: TickContext): void {
  // TODO(M1): systems/lane.ts pass-through lane; TODO(M2): checkers +
  // detection.ts rolls, Hold Bay divert, lane:stalled/resumed, stallSecondsToday.
}

/** 7. Sorter Arm auto-Toss timer (L4 row; no-op in playtest 1). */
export function holdBay(_sim: Sim, _ctx: TickContext): void {
  // build 2: Sorter Arm (machines.json upgrades).
}

/** 8. Overseas clearance timers → parcel:cleared (§5.6). */
export function clearance(_sim: Sim, _ctx: TickContext): void {
  // build 2: systems/clearance.ts.
}

/** 9. Waiting parcels crossing 180 s unpicked → the capped satisfaction penalty (§9.1). */
export function waiting(_sim: Sim, _ctx: TickContext): void {
  // TODO(M1): systems/satisfaction.ts.
}

/** 10. Lifetime earned vs the next threshold → level:up, unlocks, strain announce (capped at playtestMaxLevel). */
export function levels(_sim: Sim, _ctx: TickContext): void {
  // TODO(M3): systems/levels.ts.
}

/**
 * 11. On the day boundary: payroll and walkouts, drift, escalation,
 * dock:occupancy, daysSinceIncident, day:ended, the MinuteRow, then the
 * per-day counters reset.
 */
export function day(sim: Sim, ctx: TickContext): void {
  if (!ctx.dayBoundary) return
  const s = sim.state
  // TODO(M3): systems/payroll.ts — payday, pay order, unpaid marks, walkouts (§7.3-§7.4).
  // TODO(M3): systems/satisfaction.ts — drift toward 50 (§9.1).
  // Malware escalation needs no state: malwareShare() derives it from the
  // day count and stats.levelTick (§5.4).
  for (const d of s.lane.docks) {
    sim.emit('dock:occupancy', {
      dockId: d.id,
      pct: dockPct(d.busyTicksThisDay),
    })
  }
  const last = s.lastLostLife
  const incidentToday = last !== null && last.tick > s.tick - TICKS_PER_DAY
  // A life:lost resets daysSinceIncident to 0 (M2, lives); a clean day adds 1.
  if (!incidentToday) s.economy.daysSinceIncident += 1
  sim.emit('day:ended', { day: s.day })
  s.stats.minutes.push(buildMinuteRow(sim))
  // Per-day counters (read by the row above and by the day's systems).
  for (const d of s.lane.docks) d.busyTicksThisDay = 0
  s.lane.stallSecondsToday = 0
  for (const d of Object.values(s.districts)) {
    d.dayPositive = 0
    d.dayWaitingPenalty = 0
    d.satisfactionAtDayStart = d.satisfaction
  }
}

/** 12. Delete terminal parcels (delivered / tossed / cleared). */
export function gc(sim: Sim, _ctx: TickContext): void {
  const parcels = sim.state.parcels
  for (const key of Object.keys(parcels)) {
    const st = parcels[key]?.state
    if (st === 'delivered' || st === 'tossed' || st === 'cleared') {
      delete parcels[key]
    }
  }
}

/** The fixed order (plan.md §6.4). */
export const TICK_STEPS: readonly (readonly [string, TickStep])[] = [
  ['clock', clock],
  ['spawn', spawn],
  ['dispatch', dispatch],
  ['vehicles', vehicles],
  ['docks', docks],
  ['lane', lane],
  ['holdBay', holdBay],
  ['clearance', clearance],
  ['waiting', waiting],
  ['levels', levels],
  ['day', day],
  ['gc', gc],
]

/** Run one tick (Sim.tick() is the public entry). */
export function runTick(sim: Sim): void {
  const ctx: TickContext = { dayBoundary: false }
  for (const [, step] of TICK_STEPS) step(sim, ctx)
}

function dockPct(busyTicks: number): number {
  return Math.round((100 * busyTicks) / TICKS_PER_DAY)
}

/** The §6.9.2 timeline row for the minute that just ended. */
export function buildMinuteRow(sim: Sim): MinuteRow {
  const s = sim.state
  const st = s.stats
  const shelf = laneNode(s.lane, s.lane.shelfNodeId)
  const hold = laneNode(s.lane, s.lane.holdBayNodeId)
  const bays = s.lane.docks
  const busy = bays.reduce((sum, d) => sum + d.busyTicksThisDay, 0)
  return {
    min: s.day,
    tick: s.tick,
    money: s.economy.balance,
    earned: s.economy.lifetimeEarned,
    lvl: s.level.level,
    sat: meanSatisfaction(s, sim.data),
    spawn: s.spawn.spawnedCount,
    deliv: st.deliveries,
    late: st.late,
    malShare: malwareShare(s, sim.data),
    malSpawned: st.malwareSpawned,
    malCaught: st.malwareCaught,
    malMissed: st.malwareMissed,
    shelf: shelf?.queue.length ?? 0,
    held: hold?.queue.length ?? 0,
    heldTotal: st.holdBayEvents,
    stallS: Math.round(s.lane.stallSecondsToday * 10) / 10,
    dockPct: bays.length === 0 ? 0 : dockPct(busy / bays.length),
    fleet: s.vehicles.length,
    lives: s.economy.lives,
  }
}
