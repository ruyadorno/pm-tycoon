// src/assets/attract.json — the Title's attract city (B2 §5, plan-build2 §8.2
// task 2, §8.5 task 10): a plain Sim.snapshot() of seed 7 under the competent
// policy (src/sim/policy.ts, stepped before every tick like the CLI and
// ?policy=1) at the first whole sim minute in [ATTRACT_MIN_MINUTES,
// ATTRACT_MAX_MINUTES] whose city passes attractProblems(). The Title loads it
// with ignoreDataHash and ticks it at 1× with the competent policy attached,
// so the fleet keeps collecting, unloading and delivering behind the logo;
// it is never saved and never the player's. Regenerate (`vlr
// fixtures:attract`) after any change to src/data/*.json, a sim rule or a
// policy change that moves the run, or a save/state version bump
// (plan-build2 §8.8 R19) — tests/data/shot-fixtures.test.ts fails until the
// committed file equals a fresh run.
//
// M8 (design-m8-m9 §8 lane G, R15): the sim caps at L3, so the city must
// show L3 — level ≥ 3 (at M9 the city may already be L4), ≥ 6 vehicles incl.
// a van and two trucks, Industrial and Docks live, the lane not stalled, the
// game not over. The run is scanned minute by minute from 24 to 30 min for
// the first minute that holds (seed 7's 2nd truck comes at ~30:00 at M8);
// if none does, the script exits 1 and writes nothing — tune the policy, not
// the fixture. (M5 asserted the L2 city at exactly 24 min.)
// M9 (design-m8-m9 §8 lane G): the cap is L5, so the same assertions hold
// a later city — seed 7 reaches L4 at ≈ 22.7 min and L5 at ≈ 27.6 min, and
// its van (≈ 25 min) and 2nd truck (≈ 28 min) come later than at M8, so the
// scan stops at the first minute past the 2nd truck: an L5 city with every
// region live. Regenerated with every milestone (the data always changes).
// M9 integration (NEW STRAIN FIRST, src/sim/policies/levelPlan.ts): at L4
// the X-ray goes ahead of the L3 van and 2nd truck, so seed 7's van comes
// at ≈ 29 min and its 2nd truck at ≈ 32 min — the scan runs to 34 min.
// Build 3 M12 (the decision deck on, pass 1 pacing): seed 7 reaches L5 at
// ≈ 29.9 min and buys its van at ≈ 34.7 min and its 2nd truck at ≈ 39.3 min,
// and a minute is taken only if a 2-min policy watch of it loses no life
// (attractWatchProblems; 40 and 41 do) — the city is minute 42 and the scan
// runs to 45 min (M14's pacing pass 2 re-checks it). M12 review fixes (the
// per-vehicle prices, the policy's CREW step, the $180 poach): seed 7
// reaches L5 at ≈ 32.7 min, buys its van at ≈ 35.5 and its 2nd truck at
// ≈ 39.8 min — the city is minute 40.
//
// The JSON is JSON.stringify(sim.snapshot()) + "\n": the run is deterministic
// (seeded PRNG, no clock), so the same tables give the same bytes.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GameData } from '../../src/data/types.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { assertNoCard, settleCards } from './cards.ts'
import { Sim } from '../../src/sim/sim.ts'
import { TICKS_PER_S } from '../../src/sim/types.ts'
import { loadGameData } from '../sim/load.node.ts'

export const ATTRACT_SEED = 7
/** The scan's first and last whole sim minute (design R15). */
export const ATTRACT_MIN_MINUTES = 24
export const ATTRACT_MAX_MINUTES = 45
/** M8 expectations: at least this level (L4/L5 are fine at M9). */
export const ATTRACT_MIN_LEVEL = 3
export const ATTRACT_MIN_VEHICLES = 6
/** At least this many of each vehicle type. */
export const ATTRACT_FLEET = { van: 1, truck: 2 } as const
export const ATTRACT_LIVE = ['industrial', 'docks'] as const
export const ATTRACT_OUT = new URL(
  '../../src/assets/attract.json',
  import.meta.url,
)
export const REGENERATE = 'vlr fixtures:attract'

/** The run's sim minute (whole minutes only are snapshot). */
export const attractMinute = (sim: Sim): number =>
  sim.state.tick / (60 * TICKS_PER_S)

/**
 * The attract run: seed 7, the competent policy, stopped at the first whole
 * minute in [ATTRACT_MIN_MINUTES, ATTRACT_MAX_MINUTES] where
 * attractProblems() is empty — or at ATTRACT_MAX_MINUTES with its problems
 * (the caller refuses to write it).
 */
export function runAttract(data: GameData): Sim {
  const sim = new Sim(data, ATTRACT_SEED)
  const policy = createPolicy(sim, 'competent')
  const perMin = 60 * TICKS_PER_S
  for (let m = ATTRACT_MIN_MINUTES; m <= ATTRACT_MAX_MINUTES; m++) {
    while (sim.state.tick < m * perMin) {
      policy.step()
      sim.tick()
    }
    if (attractProblems(sim).length === 0) break
  }
  settleCards(sim, policy)
  policy.dispose?.()
  return sim
}

/** What the attract city must show at M8; empty = good. */
export function attractProblems(sim: Sim): string[] {
  const st = sim.state
  const out: string[] = []
  if (st.level.level < ATTRACT_MIN_LEVEL)
    out.push(`level ${st.level.level}, want ≥ ${ATTRACT_MIN_LEVEL}`)
  const n = st.vehicles.length
  if (n < ATTRACT_MIN_VEHICLES)
    out.push(`${n} vehicles, want ≥ ${ATTRACT_MIN_VEHICLES}`)
  for (const [type, want] of Object.entries(ATTRACT_FLEET)) {
    const have = st.vehicles.filter((v) => v.type === type).length
    if (have < want) out.push(`${have} ${type}s, want ≥ ${want}`)
  }
  for (const id of ATTRACT_LIVE)
    if (!st.districts[id]?.live) out.push(`${id} is not live`)
  if (st.lane.stalled)
    out.push(`the lane is stalled (${String(st.lane.stallReason)})`)
  if (st.economy.gameOver) out.push('the game is over')
  // Build 3 M12: the demo's first minutes under the policy must be clean —
  // tests/data/shot-fixtures.test.ts watches ATTRACT_WATCH_S: deliveries, no
  // life lost, no stall (seed 7's 40-min city had an unchecked strain on its
  // way to a pier). Only run when the city itself passes.
  if (out.length === 0) out.push(...attractWatchProblems(sim))
  return out
}

/** The shot-fixtures test's watch of the loaded demo under the policy (s). */
export const ATTRACT_WATCH_S = 120

/** A copy of `sim` under the competent policy for ATTRACT_WATCH_S. */
function attractWatchProblems(sim: Sim): string[] {
  const copy = Sim.load(sim.data, JSON.parse(JSON.stringify(sim.snapshot())), {
    ignoreDataHash: true,
  })
  let delivered = 0
  let stalls = 0
  copy.events.on('parcel:delivered', () => {
    delivered += 1
  })
  copy.events.on('lane:stalled', () => {
    stalls += 1
  })
  const lost0 = copy.state.stats.livesLost
  const policy = createPolicy(copy, 'competent')
  for (let i = 0; i < ATTRACT_WATCH_S * TICKS_PER_S; i++) {
    policy.step()
    copy.tick()
  }
  policy.dispose?.()
  const out: string[] = []
  if (delivered === 0) out.push(`no delivery in the ${ATTRACT_WATCH_S}-s watch`)
  const lost = copy.state.stats.livesLost - lost0
  if (lost > 0) out.push(`${lost} lives lost in the ${ATTRACT_WATCH_S}-s watch`)
  if (stalls > 0) out.push(`${stalls} stalls in the ${ATTRACT_WATCH_S}-s watch`)
  if (copy.state.economy.gameOver) out.push('game over in the watch')
  return out
}

/** The committed bytes for `sim`. */
export function attractJson(sim: Sim): string {
  assertNoCard(sim, 'attract')
  return `${JSON.stringify(sim.snapshot())}\n`
}

/** One line about the run (CLI output, test messages). */
export function attractSummary(sim: Sim): string {
  const st = sim.state
  const fleet = st.vehicles.map((v) => v.type).join(', ')
  const live = Object.entries(st.districts)
    .filter(([, d]) => d.live)
    .map(([id]) => id)
    .join(', ')
  return (
    `tick ${st.tick} (${attractMinute(sim)} min), level ` +
    `${st.level.level}, $${st.economy.balance}, fleet [${fleet}], ` +
    `live [${live}], lane ${st.lane.stalled ? 'stalled' : 'flowing'}`
  )
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const sim = runAttract(loadGameData())
  const problems = attractProblems(sim)
  console.log(`attract: ${attractSummary(sim)}`)
  if (problems.length > 0) {
    for (const p of problems) console.error(`attract: ${p}`)
    console.error(
      `attract: not written (no minute in ${ATTRACT_MIN_MINUTES}-${ATTRACT_MAX_MINUTES} shows the M8 attract city; tune the policy, not the fixture)`,
    )
    process.exitCode = 1
  } else {
    const out = fileURLToPath(ATTRACT_OUT)
    mkdirSync(dirname(out), { recursive: true })
    const json = attractJson(sim)
    writeFileSync(out, json)
    console.log(`attract: ${(json.length / 1024).toFixed(1)} KB → ${out}`)
  }
}
