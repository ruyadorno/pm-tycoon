// The M9 (L4 National + L5 Tycoon) shot fixtures (plan-build2 §8.6 task 7;
// design-m8-m9 §8 lane G). Regenerate after any change to src/data/*.json,
// the sim state shape or a sim rule / policy change that moves a run (the
// snapshot carries the data hash):
//
//   node tools/fixtures/m9.ts                   # all five
//   node tools/fixtures/m9.ts victory
//
// Seed 7 under the competent policy (src/sim/policy.ts with its L3-L5 plan,
// src/sim/policies/levelPlan.ts) stepped before every tick like the CLI and
// ?policy=1, plus logged commands only — no state patching — so every one is
// a plain run: __pm.replay() and tests/data/shot-fixtures.test.ts rebuild it
// from the seed and the command log. A top-level `fixture` record (Sim.load
// ignores it) tells the shots spec what to expect; every "…InS" number in it
// is measured by loading the written snapshot into a fresh Sim with a fresh
// policy — exactly what __pm.load + ?policy=1 do in the page.
//
//   level-up-4   The run stopped LEVEL_LEAD_S before its real L4 (or right
//                after the last payout before the crossing one, as
//                level-up-3.json): L3, lifetime earned just under the L4
//                threshold. Load WITH ?policy=1: `level:up {4}` lands
//                `fixture.levelUpInS` later, then `region:unlocked` for
//                Low-density and Rural on that tick — the `lowres-live` and
//                `rural-live` shots.
//   l4-room      The run L4_SETTLE_S past its real L4: tier 4 (16 rows),
//                slots 1-5 live (slot 5 as the policy left it), shelf 80,
//                slot 6 still locked — the `warehouse-tier4` shots (393×659
//                and 360×604, scrolled 0).
//   level-up-5   As level-up-4 for L5: L4, lifetime just under the L5
//                threshold. With ?policy=1 `level:up {5}` lands
//                `fixture.levelUpInS` later, then `region:unlocked` Airport
//                and Park & civic, tier 5, and the Golden Release offered on
//                the same tick — `level-up-5`, `airport-live`, `civic-live`
//                and `warehouse-tier5` (the R21 re-layout while inside).
//   l5-tycoon    The run stopped ON its `level:up {5}` tick (before the
//                policy's next step): L5, tier 5, the Golden Release offered
//                (`fixture.questId`; the policy's regular quest, if any,
//                still active: `fixture.activeQuestId`). Load WITHOUT the
//                policy for `golden-release-offer` (the active quest
//                abandoned, the gold chip tapped → its card); WITH it, the
//                first Airport clearance flies the plane
//                `fixture.airportDepartureInS` later — `plane-departure`.
//   victory      The run stopped VICTORY_LEAD_S before its `game:victory`
//                tick (the Golden Release's last delivery): L5, the ultimate
//                quest active, its counters one delivery short. With
//                ?policy=1 `quest:completed` and `game:victory` land
//                `fixture.victoryInS` later — the `victory` card and, after
//                its autosave, the Title's `… · Tycoon ✓` (`title-tycoon`).

import { mkdirSync, writeFileSync } from 'node:fs'
import { loadGameData } from '../sim/load.node.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { assertNoCard, settleCards } from './cards.ts'
import { Sim } from '../../src/sim/sim.ts'
import { TICKS_PER_S } from '../../src/sim/types.ts'

const SEED = 7
/** level-up-4 / level-up-5: snapshot at most this long before the level-up tick. */
const LEVEL_LEAD_S = 3
/** l4-room: the policy runs this long past the real L4. */
const L4_SETTLE_S = 60
/** victory: snapshot this long before the game:victory tick. */
const VICTORY_LEAD_S = 3
/** Give up past this (sim seconds) — seed 7 wins at ≈ 46 min. */
const CAP_S = 3600
/** Measuring a fixture's "…InS" under a fresh policy gives up after this. */
const MEASURE_CAP_S = 600
const OUT_DIR = new URL('../../tests/fixtures/', import.meta.url)
const REGENERATE = 'node tools/fixtures/m9.ts'

const data = loadGameData()

type Name = 'level-up-4' | 'l4-room' | 'level-up-5' | 'l5-tycoon' | 'victory'
const NAMES: readonly Name[] = [
  'level-up-4',
  'l4-room',
  'level-up-5',
  'l5-tycoon',
  'victory',
]

function write(name: Name, sim: Sim, fixture: Record<string, unknown>): void {
  assertNoCard(sim, name)
  const snap = {
    ...sim.snapshot(),
    fixture: {
      name,
      regenerate: `${REGENERATE} ${name}`,
      seed: SEED,
      tick: sim.state.tick,
      ...fixture,
    },
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const out = new URL(`${name}.json`, OUT_DIR)
  writeFileSync(out, `${JSON.stringify(snap)}\n`)
  const st = sim.state
  const slots = st.lane.nodes.filter((n) => n.kind === 'slot' && !n.locked)
  console.log(
    `${name}: tick ${st.tick} (${(st.tick / TICKS_PER_S / 60).toFixed(2)} min), level ${st.level.level}, ` +
      `tier ${st.level.warehouseTier}, ${slots.length} live slots, $${st.economy.balance}, ` +
      `lifetime $${st.economy.lifetimeEarned}, lives ${st.economy.lives}, ` +
      `${JSON.stringify(fixture)} → ${out.pathname}`,
  )
}

/** Seed 7 under the competent policy until `stop` holds (checked before each step) or the cap. */
function runPolicy(stop: (sim: Sim) => boolean): Sim {
  const sim = new Sim(data, SEED)
  const policy = createPolicy(sim, 'competent')
  const cap = CAP_S * TICKS_PER_S
  while (!stop(sim) && sim.state.tick < cap) {
    policy.step()
    sim.tick()
  }
  settleCards(sim, policy)
  policy.dispose?.()
  return sim
}

/** The tick the run reached `level` (stats.levelTick), or null. */
const levelTick = (sim: Sim, level: number): number | null =>
  sim.state.stats.levelTick[String(level)] ?? null

/**
 * Load `sim`'s snapshot into a fresh Sim, attach a fresh competent policy
 * (what __pm.load + ?policy=1 do) and step until `done` holds after a tick;
 * the sim seconds that took, or null by MEASURE_CAP_S.
 */
function measure(sim: Sim, done: (s: Sim) => boolean): number | null {
  const s = Sim.load(data, JSON.parse(JSON.stringify(sim.snapshot())))
  const policy = createPolicy(s, 'competent')
  const t0 = s.state.tick
  try {
    while (s.state.tick - t0 < MEASURE_CAP_S * TICKS_PER_S) {
      policy.step()
      s.tick()
      if (done(s)) return (s.state.tick - t0) / TICKS_PER_S
    }
    return null
  } finally {
    policy.dispose?.()
  }
}

/** The run LEVEL_LEAD_S before its real `level` (m8.ts level-up-3's rule). */
function levelUp(name: 'level-up-4' | 'level-up-5', level: number): void {
  const row = data.levels.find((l) => l.level === level)
  if (!row) throw new Error(`${name}: no levels.json row ${level}`)
  let lastEarnTick = 0
  let earned = 0
  const probe = runPolicy((s) => {
    if (s.state.economy.lifetimeEarned !== earned) {
      earned = s.state.economy.lifetimeEarned
      // Build 3: a quest reward is paid after `levels` in the tick, so the
      // crossing payout's own tick can still read the old level — only a
      // payout that leaves the lifetime under the threshold counts.
      if (s.state.level.level < level && earned < row.threshold)
        lastEarnTick = s.state.tick
    }
    return s.state.level.level >= level
  })
  const upTick = levelTick(probe, level)
  if (upTick === null)
    throw new Error(`${name}: no level-up to ${level} by ${CAP_S} s`)
  const snapTick = Math.max(
    upTick - LEVEL_LEAD_S * TICKS_PER_S,
    Math.min(lastEarnTick, upTick - 1),
  )
  const sim = runPolicy((s) => s.state.tick >= snapTick)
  const st = sim.state
  if (st.level.level !== level - 1)
    throw new Error(`${name}: not at L${level - 1} at the snapshot`)
  for (const d of row.unlockRegions)
    if (st.districts[d]?.live)
      throw new Error(`${name}: ${d} is live before L${level}`)
  const inS = measure(sim, (s) => s.state.level.level >= level)
  if (inS !== (upTick - snapTick) / TICKS_PER_S)
    throw new Error(
      `${name}: a fresh policy levels up after ${String(inS)} s, the run after ${(upTick - snapTick) / TICKS_PER_S} s`,
    )
  write(name, sim, {
    level,
    lifetime: st.economy.lifetimeEarned,
    threshold: row.threshold,
    levelUpInS: inS,
    regions: [...row.unlockRegions],
    tier: row.warehouseTier,
    slots: row.slots,
    ultimate: row.ultimateQuest?.id ?? null,
    policy: true,
  })
}

function l4Room(): void {
  let l4: number | null = null
  const sim = runPolicy((s) => {
    l4 ??= levelTick(s, 4)
    return l4 !== null && s.state.tick >= l4 + L4_SETTLE_S * TICKS_PER_S
  })
  const st = sim.state
  if (l4 === null || st.level.level !== 4 || st.economy.gameOver)
    throw new Error(`l4-room: level ${st.level.level}, want a live L4`)
  const live = st.lane.nodes
    .filter((n) => n.kind === 'slot' && !n.locked)
    .map((n) => n.id)
  const fixtureOf = (id: string): string | null => {
    const f = st.lane.nodes.find((n) => n.id === id)?.fixture
    if (!f) return null
    return f.kind === 'machine' ? f.checker.defId : f.kind
  }
  write('l4-room', sim, {
    level: 4,
    levelTick: l4,
    tier: st.level.warehouseTier,
    slots: live,
    fixtures: Object.fromEntries(live.map((id) => [id, fixtureOf(id)])),
    shelfCap: st.lane.nodes.find((n) => n.id === 'shelf')?.cap ?? null,
    docks: st.lane.docks.map((d) => d.id),
    station: st.lane.holdStation.fixture,
    policy: true,
  })
}

function l5Tycoon(): void {
  const sim = runPolicy((s) => s.state.level.level >= 5)
  const st = sim.state
  const offer = st.quests.offer
  if (st.level.level !== 5 || levelTick(sim, 5) !== st.tick)
    throw new Error('l5-tycoon: not on the level:up {5} tick')
  if (!offer || !offer.ultimate)
    throw new Error('l5-tycoon: the Golden Release is not offered')
  // The first hub:departure {airport} under a fresh policy (hubs.ts
  // clearanceStep: one per hub per tick with clearances).
  const seen: { tick: number | null } = { tick: null }
  const s = Sim.load(data, JSON.parse(JSON.stringify(sim.snapshot())))
  const policy = createPolicy(s, 'competent')
  s.events.on('hub:departure', (p) => {
    if (p.hub === 'airport') seen.tick ??= s.state.tick
  })
  while (
    seen.tick === null &&
    s.state.tick - st.tick < MEASURE_CAP_S * TICKS_PER_S
  ) {
    policy.step()
    s.tick()
  }
  policy.dispose?.()
  const departTick = seen.tick
  if (departTick === null)
    throw new Error(`l5-tycoon: no Airport departure in ${MEASURE_CAP_S} s`)
  write('l5-tycoon', sim, {
    level: 5,
    tier: st.level.warehouseTier,
    questId: offer.id,
    templateId: offer.templateId,
    goal: offer.goal,
    activeQuestId: st.quests.active?.id ?? null,
    activeTemplateId: st.quests.active?.templateId ?? null,
    regions: ['airport', 'civic'],
    airportDepartureInS: (departTick - st.tick) / TICKS_PER_S,
    officeId:
      data.map.hubs.find((h) => h.district === 'airport')?.office ?? null,
    policy: false,
  })
}

function victory(): void {
  const probe = runPolicy((s) => s.state.economy.victory)
  const vTick = probe.state.stats.victoryTick
  if (vTick === null || !probe.state.economy.victory)
    throw new Error(`victory: no game:victory by ${CAP_S} s`)
  const snapTick = vTick - VICTORY_LEAD_S * TICKS_PER_S
  const sim = runPolicy((s) => s.state.tick >= snapTick)
  const st = sim.state
  const q = st.quests.active
  if (!q || !q.ultimate || q.progress.kind !== 'ultimate')
    throw new Error('victory: the Golden Release is not active')
  if (st.economy.victory || st.economy.gameOver)
    throw new Error('victory: already won or over at the snapshot')
  const inS = measure(sim, (s) => s.state.economy.victory)
  if (inS !== VICTORY_LEAD_S)
    throw new Error(
      `victory: a fresh policy wins after ${String(inS)} s, want ${VICTORY_LEAD_S}`,
    )
  write('victory', sim, {
    level: st.level.level,
    questId: q.id,
    goal: q.goal,
    delivered: q.progress.delivered,
    onTime: q.progress.onTime,
    malware: q.progress.malware,
    victoryInS: inS,
    victoryDay: probe.state.day,
    policy: true,
  })
}

const want = process.argv.slice(2)
for (const n of want) {
  if (!NAMES.includes(n as Name))
    throw new Error(`unknown fixture ${n} (${NAMES.join(', ')})`)
}
for (const n of want.length > 0 ? (want as Name[]) : NAMES) {
  if (n === 'level-up-4') levelUp(n, 4)
  else if (n === 'l4-room') l4Room()
  else if (n === 'level-up-5') levelUp(n, 5)
  else if (n === 'l5-tycoon') l5Tycoon()
  else victory()
}
