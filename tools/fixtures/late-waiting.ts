// tests/fixtures/late-waiting.json — the `city-late-badge` shot fixture
// (plan.md §6.9.3; city-view.md §1.3 / §7: the waiting badge tinted by the
// oldest parcel's decay phase, spec §5.3). Regenerate after any change to
// src/data/*.json or the sim state shape (the snapshot carries the data hash,
// and __pm.load refuses a stale one):
//
//   node tools/fixtures/late-waiting.ts
//
// Deterministic: seed 7 under the competent policy (src/sim/policy.ts) for
// RUN_S sim seconds (bikes out on the roads, money earned), then the pair of
// nearby live buildings with waiting parcels (the closest pair on screen, so
// one camera frame shows both) gets its parcels' spawn ticks moved back:
// building `amber` to AMBER_AGE_S (graceS < age ≤ onTimeMaxS), building `red`
// to RED_AGE_S (> onTimeMaxS). Every other waiting parcel is clamped to at
// most PLAIN_MAX_AGE_S (< graceS) old so those badges stay plain. The
// snapshot is written with an extra top-level `fixture` record ({amber, red,
// focus}) that the shots spec reads to aim the camera; Sim.load ignores it.

import { mkdirSync, writeFileSync } from 'node:fs'
import { loadGameData } from '../sim/load.node.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { assertNoCard, settleCards } from './cards.ts'
import { Sim } from '../../src/sim/sim.ts'
import { TICKS_PER_S } from '../../src/sim/types.ts'
import type { BuildingDef } from '../../src/data/types.ts'

const SEED = 7
const RUN_S = 210
const AMBER_AGE_S = 125
const RED_AGE_S = 200
/** Other waiting parcels' max age: plain through the shot's settle. */
const PLAIN_MAX_AGE_S = 80
/** Both badges must fit one 360-px-wide phone frame around their midpoint. */
const MAX_DX_PX = 200
const MAX_DY_PX = 220
const OUT = new URL('../../tests/fixtures/late-waiting.json', import.meta.url)

/** Footprint centre in iso screen px (64×32 tiles; the map origin cancels out). */
function screenOf(b: BuildingDef): { x: number; y: number } {
  const cx = b.tile[0] + (b.footprint[0] - 1) / 2
  const cy = b.tile[1] + (b.footprint[1] - 1) / 2
  return { x: (cx - cy) * 32, y: (cx + cy) * 16 }
}

const data = loadGameData()
const { graceS } = data.parcels.decay
const onTimeMaxS = data.parcels.onTimeMaxS
if (!(graceS < AMBER_AGE_S && AMBER_AGE_S <= onTimeMaxS))
  throw new Error(
    `AMBER_AGE_S ${AMBER_AGE_S} is not in (${graceS}, ${onTimeMaxS}]`,
  )
if (!(PLAIN_MAX_AGE_S < graceS))
  throw new Error(`PLAIN_MAX_AGE_S ${PLAIN_MAX_AGE_S} is not < ${graceS}`)
if (!(RED_AGE_S > onTimeMaxS))
  throw new Error(`RED_AGE_S ${RED_AGE_S} is not > ${onTimeMaxS}`)

const sim = new Sim(data, SEED)
const policy = createPolicy(sim, 'competent')
const runTicks = RUN_S * TICKS_PER_S
while (sim.state.tick < runTicks) {
  policy.step()
  sim.tick()
}
settleCards(sim, policy)
policy.dispose?.()
assertNoCard(sim, 'late-waiting')

const st = sim.state
const live = data.buildings.filter(
  (b) =>
    st.districts[b.district]?.live === true &&
    (st.buildings[b.id]?.waiting.length ?? 0) > 0,
)
let best: { a: BuildingDef; b: BuildingDef; d: number } | null = null
for (let i = 0; i < live.length; i++) {
  for (let j = i + 1; j < live.length; j++) {
    const a = live[i]!
    const b = live[j]!
    const pa = screenOf(a)
    const pb = screenOf(b)
    const dx = Math.abs(pa.x - pb.x)
    const dy = Math.abs(pa.y - pb.y)
    if (dx > MAX_DX_PX || dy > MAX_DY_PX) continue
    const d = Math.hypot(dx, dy)
    // Not on top of each other either: two separate, readable badges.
    if (d < 64) continue
    if (!best || d < best.d) best = { a, b, d }
  }
}
if (!best)
  throw new Error(
    `no pair of live buildings with waiting parcels within ${MAX_DX_PX}×${MAX_DY_PX} px at ${RUN_S} s (seed ${SEED})`,
  )

const now = st.tick
const ageTick = (s: number): number => now - Math.round(s * TICKS_PER_S)
const setAge = (buildingId: string, oldestS: number): void => {
  const ids = st.buildings[buildingId]!.waiting
  ids.forEach((id, i) => {
    // Spawn order kept: the first waiting parcel is the oldest (1 s apart).
    st.parcels[String(id)]!.spawnedTick = ageTick(oldestS - i)
  })
}
for (const b of Object.values(st.buildings)) {
  if (b.id === best.a.id || b.id === best.b.id) continue
  for (const id of b.waiting) {
    const p = st.parcels[String(id)]!
    p.spawnedTick = Math.max(p.spawnedTick, ageTick(PLAIN_MAX_AGE_S))
  }
}
setAge(best.a.id, AMBER_AGE_S)
setAge(best.b.id, RED_AGE_S)

const snap = {
  ...sim.snapshot(),
  fixture: {
    name: 'late-waiting',
    regenerate: 'node tools/fixtures/late-waiting.ts',
    seed: SEED,
    tick: now,
    amber: best.a.id,
    red: best.b.id,
    /** Building ids whose midpoint the camera centres (shots spec). */
    focus: [best.a.id, best.b.id],
    screenDistancePx: Math.round(best.d),
  },
}
mkdirSync(new URL('.', OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(snap)}\n`)
console.log(
  `late-waiting: tick ${now}, amber ${best.a.id} (${AMBER_AGE_S} s), red ${best.b.id} (${RED_AGE_S} s), ${Math.round(best.d)} px apart, ${st.vehicles.length} vehicles, $${st.economy.balance} → ${OUT.pathname}`,
)
