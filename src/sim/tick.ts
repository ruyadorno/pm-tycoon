// The tick loop (plan.md §6.4): one call = 100 ms of sim time, fourteen
// steps in a fixed order (M7 adds `quests` between `levels` and `day`;
// build 3 M11 adds `deck` between `levels` and `quests`). Each step is a named function over (sim, ctx); later
// milestones replace the TODO bodies with calls into src/sim/systems/*.ts
// (keep the order — the rng stream depends on it). Commands never run inside
// a tick: they apply immediately in Sim.dispatch.

import { SIM_FEATURES } from './features.ts'
import { modAdd } from './modifiers.ts'
import type { Sim } from './sim.ts'
import { deckStep } from './systems/deck.ts'
import { dispatchStep, LEG_HOOKS } from './systems/dispatch.ts'
import { docksStep } from './systems/docks.ts'
import { clearanceStep } from './systems/hubs.ts'
import { laneStep } from './systems/lane.ts'
import { levelsStep } from './systems/levels.ts'
import { paydayStep } from './systems/payroll.ts'
import { peopleDayStep } from './systems/people.ts'
import { questsStep } from './systems/quests.ts'
import { driftStep, waitingStep } from './systems/satisfaction.ts'
import { holdStationStep } from './systems/sorter.ts'
import { spawnStep } from './systems/spawn.ts'
import { vehiclesStep } from './systems/vehicles.ts'
import type { MinuteRow } from './types.ts'
import {
  endlessFirstDay,
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
export function spawn(sim: Sim, _ctx: TickContext): void {
  spawnStep(sim)
}

/** 3. Every dispatchTickS: the idle_lot pass (§4.5 step 2) + rush re-evaluation (§4.1); rush expiry every tick. */
export function dispatch(sim: Sim, _ctx: TickContext): void {
  dispatchStep(sim)
}

/** 4. prev ← pos, movement, headings, wheel, 1.5 s stops, pickups, deliveries, hand-offs, lot entrance → queued. */
export function vehicles(sim: Sim, _ctx: TickContext): void {
  // Arrivals and stop ends run the §4.6 leg logic (dispatch.ts LEG_HOOKS);
  // deliveries pay through economy.ts (malware: $0 + life:lost, §10).
  vehiclesStep(sim, LEG_HOOKS)
}

/** 5. Dock queue → free dock, unload / outbound set / load, idle wait, the Q-RUN1 yield, depart, busyTicksThisDay. */
export function docks(sim: Sim, _ctx: TickContext): void {
  docksStep(sim)
}

/** 6. Conveyor → slots → Hold Bay / shelf, process timers, rolls, stalls. */
export function lane(sim: Sim, _ctx: TickContext): void {
  // Stations + process timers, one detection.ts roll per parcel on exit,
  // flagged → Hold Bay, stall root (systems/lane.ts).
  laneStep(sim)
}

/**
 * 7. The Hold Bay station (M6, systems/sorter.ts): the seated sorter's call
 * (≤ 1 main-stream draw per decision, none via the wanted list) or the
 * Sorter Arm's auto-Toss.
 */
export function holdBay(sim: Sim, _ctx: TickContext): void {
  holdStationStep(sim)
}

/**
 * 8. Overseas clearance timers (§5.6, M8 systems/hubs.ts): due clearances
 * pay the locked value (malware: $0 and a life — the ship has sailed), then
 * one hub:departure per hub that cleared this tick. No rng.
 */
export function clearance(sim: Sim, _ctx: TickContext): void {
  clearanceStep(sim)
}

/** 9. Waiting parcels crossing 180 s unpicked → the capped satisfaction penalty (§9.1). */
export function waiting(sim: Sim, _ctx: TickContext): void {
  waitingStep(sim)
}

/** 10. Lifetime earned vs the next threshold → level:up, unlocks, strain announce (capped at playtestMaxLevel). */
export function levels(sim: Sim, _ctx: TickContext): void {
  // systems/levels.ts (SIM_FEATURES.levels): the threshold crossed this tick
  // levels up (never past economy.playtestMaxLevel); a strain entering the
  // spawn pool gets its ticker line.
  levelsStep(sim)
}

/**
 * 10b. B3 §3.2 / plan §4: the event deck (systems/deck.ts) — modifier
 * expiry, absences, the wrong-toss day, then the queue, due links, the
 * rescue and the random draw (job cards folded in). After `levels` (a
 * level-up's quiet window), before `quests`.
 */
export function deck(sim: Sim, _ctx: TickContext): void {
  deckStep(sim)
}

/**
 * 11. Quests (M7, systems/quests.ts): the active quest's derived values, day
 * close, completion / fail and progress; the ultimate quest from its level
 * on. Build 3: regular offers are job cards drawn by the deck (10b — one
 * quest-stream draw per job, never state.rng; no offer expiry). After
 * `levels` (a level:up offers the ultimate the same tick), before `day` (a
 * boundary closes onTimeRateDay with all of its deliveries).
 */
export function quests(sim: Sim, ctx: TickContext): void {
  questsStep(sim, ctx)
}

/**
 * 12. On the day boundary: payroll and walkouts, the applicant pools (M6,
 * applicant stream only), drift, escalation (+ the endless ticker line, M9),
 * dock:occupancy, daysSinceIncident, day:ended, the MinuteRow, then the
 * per-day counters reset.
 */
export function day(sim: Sim, ctx: TickContext): void {
  if (!ctx.dayBoundary) return
  const s = sim.state
  // Payday, pay order, unpaid marks, walkouts (§7.3-§7.4, systems/payroll.ts).
  if (SIM_FEATURES.payroll) paydayStep(sim)
  // ★ applicants leave, today's applicants arrive (systems/people.ts).
  peopleDayStep(sim)
  driftStep(sim)
  // Malware escalation needs no state: malwareShare() derives it from the
  // day count and stats.victoryTick / stats.levelTick (§5.4, spec-build2
  // §3.4): + postVictoryPerDay at every day boundary after Victory (or after
  // the counter capped below the last level), up to malware.cap.
  // Endless mode (M9, design-m8-m9 §4.7): the first boundary after Victory
  // gets the sim-owned ticker line once — derived from the state like the
  // strain lines, so a loaded game emits it exactly once too.
  if (s.day === endlessFirstDay(s)) {
    sim.emit('ticker:news', {
      text: sim.data.puns.tickerQuest.endless,
      kind: 'level',
    })
  }
  for (const d of s.lane.docks) {
    sim.emit('dock:occupancy', {
      dockId: d.id,
      pct: dockPct(d.busyTicksThisDay),
    })
  }
  const last = s.lastLostLife
  const incidentToday = last !== null && last.tick > s.tick - TICKS_PER_DAY
  // A life:lost resets daysSinceIncident to 0 (economy.ts loseLife); a clean
  // day adds 1.
  if (!incidentToday) s.economy.daysSinceIncident += 1
  sim.emit('day:ended', { day: s.day })
  s.stats.minutes.push(buildMinuteRow(sim))
  // Per-day counters (read by the row above and by the day's systems).
  for (const d of s.lane.docks) {
    d.busyTicksThisDay = 0
    d.blockedTicksThisDay = 0
  }
  s.lane.stallSecondsToday = 0
  for (const d of Object.values(s.districts)) {
    d.dayPositive = 0
    d.dayWaitingPenalty = 0
    d.satisfactionAtDayStart = d.satisfaction
  }
}

/** 13. Delete terminal parcels (delivered / tossed / cleared / lost). */
export function gc(sim: Sim, _ctx: TickContext): void {
  const parcels = sim.state.parcels
  for (const key of Object.keys(parcels)) {
    const st = parcels[key]?.state
    if (
      st === 'delivered' ||
      st === 'tossed' ||
      st === 'cleared' ||
      st === 'lost'
    ) {
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
  ['deck', deck],
  ['quests', quests],
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
  // Cumulative completions: the previous row + this minute's (the history
  // keeps the last QUEST_HISTORY_MAX records, far more than a minute holds).
  const prev = st.minutes.at(-1)?.questsDone ?? 0
  const done = s.quests.history.filter(
    (r) => r.outcome === 'completed' && r.tick > s.tick - TICKS_PER_DAY,
  ).length
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
    malShare: malwareShare(s, sim.data, false, modAdd(sim, 'malwareShare')),
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
    quest: s.quests.active?.templateId ?? null,
    questsDone: prev + done,
  }
}
