// src/assets/attract.json — the Title's attract city (B2 §5, plan-build2 §8.2
// task 2): a plain Sim.snapshot() of seed 7 under the competent policy
// (src/sim/policy.ts, stepped before every tick like the CLI and ?policy=1)
// ATTRACT_MINUTES sim minutes in. The Title loads it with ignoreDataHash and
// ticks it at 1× with the competent policy attached, so the fleet keeps
// collecting, unloading and delivering behind the logo; it is never saved and
// never the player's. Regenerate (`vlr fixtures:attract`) after any change to
// src/data/*.json, a sim rule that moves the run, or a save/state version bump
// (plan-build2 §8.8 R19) — tests/data/shot-fixtures.test.ts fails until the
// committed file equals a fresh run.
//
// At M5 the sim caps at L2 (economy.playtestMaxLevel), so the run must show
// the L2 city: level 2, ≥ 4 vehicles incl. a truck, Industrial live, the lane
// not stalled; otherwise the script exits 1 and writes nothing. M8 task 10
// upgrades these checks to L3 (≥ 6 vehicles incl. a van and two trucks, Docks
// live) and regenerates the file with the same script.
//
// The JSON is JSON.stringify(sim.snapshot()) + "\n": the run is deterministic
// (seeded PRNG, no clock), so the same tables give the same bytes.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GameData } from '../../src/data/types.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { Sim } from '../../src/sim/sim.ts'
import { TICKS_PER_S } from '../../src/sim/types.ts'
import { loadGameData } from '../sim/load.node.ts'

export const ATTRACT_SEED = 7
export const ATTRACT_MINUTES = 24
/** M5 expectations (the sim still caps at L2). */
export const ATTRACT_LEVEL = 2
export const ATTRACT_MIN_VEHICLES = 4
export const ATTRACT_LIVE = ['industrial'] as const
export const ATTRACT_OUT = new URL(
  '../../src/assets/attract.json',
  import.meta.url,
)
export const REGENERATE = 'vlr fixtures:attract'

/** The attract run: seed 7, the competent policy, ATTRACT_MINUTES in. */
export function runAttract(data: GameData): Sim {
  const sim = new Sim(data, ATTRACT_SEED)
  const policy = createPolicy(sim, 'competent')
  const ticks = ATTRACT_MINUTES * 60 * TICKS_PER_S
  while (sim.state.tick < ticks) {
    policy.step()
    sim.tick()
  }
  policy.dispose?.()
  return sim
}

/** What the attract city must show at M5; empty = good. */
export function attractProblems(sim: Sim): string[] {
  const st = sim.state
  const out: string[] = []
  if (st.level.level !== ATTRACT_LEVEL)
    out.push(`level ${st.level.level}, want ${ATTRACT_LEVEL}`)
  const n = st.vehicles.length
  if (n < ATTRACT_MIN_VEHICLES)
    out.push(`${n} vehicles, want ≥ ${ATTRACT_MIN_VEHICLES}`)
  if (!st.vehicles.some((v) => v.type === 'truck')) out.push('no truck')
  for (const id of ATTRACT_LIVE)
    if (!st.districts[id]?.live) out.push(`${id} is not live`)
  if (st.lane.stalled)
    out.push(`the lane is stalled (${String(st.lane.stallReason)})`)
  if (st.economy.gameOver) out.push('the game is over')
  return out
}

/** The committed bytes for `sim`. */
export function attractJson(sim: Sim): string {
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
    `tick ${st.tick} (${st.tick / TICKS_PER_S / 60} min), level ` +
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
    console.error('attract: not written (the M5 attract city needs the above)')
    process.exitCode = 1
  } else {
    const out = fileURLToPath(ATTRACT_OUT)
    mkdirSync(dirname(out), { recursive: true })
    const json = attractJson(sim)
    writeFileSync(out, json)
    console.log(`attract: ${(json.length / 1024).toFixed(1)} KB → ${out}`)
  }
}
