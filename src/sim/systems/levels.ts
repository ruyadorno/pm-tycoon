// Company levels (spec §8, §3.5, §5.4, §6.2; plan.md §12.6 task 1; tick step
// 10). Metric = lifetime earned (§7.3). The tick lifetime earned reaches the
// next levels.json threshold the company levels up — unless that row is past
// economy.playtestMaxLevel: then nothing fires and LevelState.nextThreshold
// keeps pointing at that row's threshold, so the HUD bar keeps counting
// ("$6,410 / $9,000 · Lv 4 coming soon" under a cap-3 config, design-m8-m9
// R1; spec preamble). Since M9 the shipped cap is the last row (B2 §9:
// playtestMaxLevel 5): the L5 level-up sets nextThreshold null and nothing
// is "coming" (the quests step offers the Golden Release on that tick).
// Several thresholds crossed in one tick level up one row at a time, in
// order.
//
// A level-up applies the row first, then emits (handlers see the new state):
//   - LevelState: level, nextThreshold, slots, holdBayCap, shelfCap,
//     warehouseTier, stats.levelTick[level];
//   - the lane: slot nodes up to `slots` lose `locked` (§6.2 slots 3 → 4),
//     the Hold Bay and shelf caps follow the row (shelf 30 → 45);
//   - regions (§3.5): `live`, satisfaction economy.satisfaction.start (60),
//     the day counters reset, the spawn timer due firstSpawnDelayS later
//     (§5.2 "first spawn 5 s after the district goes live"), LevelState.unlocked
//     (districts.json order); overseas hubs go live without a timer;
//   - the row's strain is announced now (LevelState.announced, §5.4): the
//     Detection % starts counting it at once (detection.ts announcedStrains)
//     but spawn.ts draws it only newStrainDelayS later, the tick this system
//     also emits the ticker line "New strain spotted: <strain>" (kind
//     'strain', city-view.md §8.1). The start strain (announced at tick 0)
//     gets no line.
//   - vehicles / machines: nothing to store — buyVehicle / buyMachine compare
//     the row's unlockLevel with LevelState.level.
// Events, in order: `level:up {level}`, `ticker:news {text: row.ticker, kind:
// 'level'}`, then `region:unlocked {district}` per region (city-view.md §9.6:
// the region fade follows the level-up moment).

import type { LevelDef } from '../../data/types.ts'
import { SIM_FEATURES } from '../features.ts'
import { modAdd } from '../modifiers.ts'
import type { Sim } from '../sim.ts'
import type { Strain } from '../types.ts'
import { laneNode, ticksFromS } from '../types.ts'

/** levels.json rows in level order. */
function rows(sim: Sim): LevelDef[] {
  return sim.data.levels.toSorted((a, b) => a.level - b.level)
}

/** The levels.json row after `level`, or null past the last one. */
export function nextLevelRow(sim: Sim, level: number): LevelDef | null {
  return rows(sim).find((r) => r.level > level) ?? null
}

/** The level counter's ceiling (economy.playtestMaxLevel, else the last row). */
export function maxLevel(sim: Sim): number {
  const last = rows(sim).at(-1)?.level ?? 1
  return Math.min(last, sim.data.economy.playtestMaxLevel)
}

/** Ticker text when a strain enters the spawn pool (city-view.md §8.1). */
export function strainSpottedText(strain: Strain): string {
  return `New strain spotted: ${strain}`
}

/** Tick step 10 (SIM_FEATURES.levels). */
export function levelsStep(sim: Sim): void {
  if (!SIM_FEATURES.levels) return
  const s = sim.state
  for (let guard = 0; guard < sim.data.levels.length; guard++) {
    const next = nextLevelRow(sim, s.level.level)
    if (!next || next.level > maxLevel(sim)) break
    if (s.economy.lifetimeEarned < next.threshold) break
    levelUp(sim, next)
  }
  announceStrains(sim)
}

/**
 * Debug (ViewSim debug.forceLevel, the `debugForceLevel` command — design
 * §4.6): level up row by row to `level`, ignoring the thresholds and
 * economy.playtestMaxLevel. Lifetime earned is left alone: it is money the
 * game paid (stats.income, the minute rows, the playtest profile and the
 * cards' "Lifetime earned" / "Best day" all read it), and the level bar
 * already clamps a total below the forced row's threshold to an empty bar
 * (hudKit levelProgress). The caller checked current < level ≤ the last row.
 */
export function forceLevel(sim: Sim, level: number): void {
  const s = sim.state
  for (const row of rows(sim)) {
    if (row.level <= s.level.level || row.level > level) continue
    levelUp(sim, row)
  }
}

/** Apply a levels.json row now (the threshold was crossed this tick). */
export function levelUp(sim: Sim, row: LevelDef): void {
  const s = sim.state
  const data = sim.data
  const lvl = s.level
  lvl.level = row.level
  // At the playtest cap this is the next row's threshold all the same (the
  // bar keeps counting toward it); null only past the last row.
  lvl.nextThreshold = nextLevelRow(sim, row.level)?.threshold ?? null
  lvl.slots = row.slots
  lvl.holdBayCap = row.holdBayCap
  lvl.warehouseTier = row.warehouseTier
  s.stats.levelTick[String(row.level)] = s.tick

  // The lane (§6.2): slots up to the row's count open; caps follow the row.
  const lane = s.lane
  lane.slotNodeIds.forEach((id, i) => {
    const n = laneNode(lane, id)
    if (n?.locked && i < row.slots) delete n.locked
  })
  const hold = laneNode(lane, lane.holdBayNodeId)
  if (hold) hold.cap = row.holdBayCap
  syncShelfCap(sim)

  // Regions (§3.5): live, satisfaction start, spawn timer firstSpawnDelayS out.
  const opened: string[] = []
  const sat = data.economy.satisfaction.start
  const firstSpawn = ticksFromS(data.parcels.spawn.firstSpawnDelayS)
  for (const id of row.unlockRegions) {
    const def = data.districts.find((d) => d.id === id)
    const d = s.districts[id]
    if (!def || !d || d.live) continue
    d.live = true
    d.satisfaction = sat
    d.satisfactionAtDayStart = sat
    d.dayPositive = 0
    d.dayWaitingPenalty = 0
    d.nextSpawnTick = def.kind === 'district' ? s.tick + firstSpawn : null
    opened.push(id)
  }
  lvl.unlocked = data.districts
    .filter((d) => s.districts[d.id]?.live === true)
    .map((d) => d.id)

  // The row's strain: announced now, drawn newStrainDelayS later (§5.4).
  if (row.strain && lvl.announced[row.strain] === undefined) {
    lvl.announced[row.strain] = s.tick
  }

  sim.emit('level:up', { level: row.level })
  sim.emit('ticker:news', { text: row.ticker, kind: 'level' })
  for (const district of opened) sim.emit('region:unlocked', { district })
}

/**
 * Build 3 (B3 §3.6, D-24): the shelf cap = the current level row's shelfCap
 * + the shelfCap modifier fold (rounded), at most modifiers.shelfCapMax —
 * into LevelState.shelfCap and the shelf node's cap. levelUp calls it (so a
 * `cap` bonus survives a level-up); modifierOps calls it after a shelfCap
 * row is applied or ends.
 */
export function syncShelfCap(sim: Sim): void {
  const s = sim.state
  const row = sim.data.levels.find((l) => l.level === s.level.level)
  if (!row) return
  const cap = Math.min(
    sim.data.events.modifiers.shelfCapMax,
    row.shelfCap + Math.round(modAdd(sim, 'shelfCap')),
  )
  s.level.shelfCap = cap
  const shelf = laneNode(s.lane, s.lane.shelfNodeId)
  if (shelf) shelf.cap = cap
}

/**
 * The tick an announced strain enters the spawn pool (announced +
 * newStrainDelayS, spawn.ts availableStrains): `ticker:news {kind: 'strain'}`.
 * Derived from the state (no flag), so a loaded game announces exactly once.
 * Only the starting strain (the first levels.json row's, announced at tick 0
 * by the new game) has no line; a level forced at tick 0 (debugForceLevel —
 * the ?level=N boot) still gets one for each strain it announces (M9 review).
 */
function announceStrains(sim: Sim): void {
  const s = sim.state
  const delay = ticksFromS(sim.data.parcels.malware.newStrainDelayS)
  const start = sim.data.levels[0]?.strain ?? null
  for (const st of sim.data.parcels.malware.strains) {
    const at = s.level.announced[st.id]
    if (at === undefined || (at <= 0 && st.id === start)) continue
    if (s.tick === at + delay) {
      sim.emit('ticker:news', {
        text: strainSpottedText(st.id),
        kind: 'strain',
      })
    }
  }
}
