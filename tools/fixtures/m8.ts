// The M8 (L3 Regional) shot fixtures (plan-build2 §8.5 tasks 9-10;
// design-m8-m9 §8 lane G). Regenerate after any change to src/data/*.json,
// the sim state shape or a sim rule / policy change that moves a run (the
// snapshot carries the data hash):
//
//   node tools/fixtures/m8.ts                   # all three
//   node tools/fixtures/m8.ts l3-docks
//
// Seed 7 under the competent policy (src/sim/policy.ts, its L3 plan:
// Battery checker → dock 2 → van → 2nd truck) stepped before every tick like
// the CLI and ?policy=1, plus logged commands only — no state patching — so
// all three are plain runs: __pm.replay() and tests/data/shot-fixtures.test.ts
// rebuild them from the seed and the command log. A top-level `fixture`
// record (Sim.load ignores it) tells the shots spec what to expect.
//
//   level-up-3        The run stopped LEVEL_LEAD_S before its L3 level-up
//                     tick (or right after the last payout before the
//                     crossing one when two land in that window, like
//                     level-up.json): L2, lifetime earned just under the L3
//                     threshold. Load WITH ?policy=1 and advance: `level:up
//                     {3}` lands `fixture.levelUpInS` later, then
//                     `region:unlocked docks` — the `level-up-3`, `docks-live`
//                     and `warehouse-tier3` shots.
//   l3-docks          The run DOCK_SETTLE_S after the policy bought dock 2,
//                     then on to the first tick where the Docks' soonest
//                     clearance is ≥ CLEAR_LEAD_S ahead
//                     (`fixture.clearingParcelId`, `fixture.clearInS`, its
//                     pier `fixture.pierId`): two docks, tier 3, the ring over
//                     the port office. Load WITH or without ?policy=1: that
//                     parcel clears `clearInS` later (`parcel:cleared`, then
//                     `hub:departure {docks}`) — the `clearance-ring`,
//                     `ship-departure` and `warehouse-two-docks` shots.
//                     M9: seed 7's first Docks hand-off after dock 2 (≈ 21.0
//                     min) comes after its L4 (≈ 22.7 min; the next
//                     clearance starts ≈ 24.3 min), so the fixture is at a
//                     real L4 (tier 4, dock 3 for sale) since M9 — level ≥
//                     3, as the attract rule; `fixture.level` /
//                     `fixture.tier` hold what it is.
//   overseas-malware  The run OVS_SETTLE_S past its real L3, then
//                     `debugOverseasMalware {hub: 'docks'}` (a malware parcel
//                     handed off at the first pier, design §4.1) and
//                     LOST_SETTLE_S more of the policy. Load WITH ?policy=1:
//                     `life:lost {report.viaClearance}` for that parcel lands
//                     `fixture.lifeLostInS` later, never before — the card
//                     ends `Handed off at …` / `Cleared … — the ship has
//                     sailed` (`lost-life-overseas`).

import { mkdirSync, writeFileSync } from 'node:fs'
import { loadGameData } from '../sim/load.node.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { assertNoCard, settleCards } from './cards.ts'
import { Sim } from '../../src/sim/sim.ts'
import type { Command } from '../../src/sim/commands.ts'
import { clearingParcels } from '../../src/sim/systems/hubs.ts'
import { TICKS_PER_S } from '../../src/sim/types.ts'

const SEED = 7
/** level-up-3: the level the fixture crosses into. */
const LEVEL = 3
/** level-up-3: snapshot at most this long before the run's level-up tick. */
const LEVEL_LEAD_S = 3
/** l3-docks: the policy runs at least this long after dock 2 is bought. */
const DOCK_SETTLE_S = 30
/** l3-docks: the soonest Docks clearance is at least this far ahead. */
const CLEAR_LEAD_S = 20
/** overseas-malware: the policy runs this long past L3 before the debug hand-off. */
const OVS_SETTLE_S = 30
/** overseas-malware: and this long after it (the command lands in the replayed log). */
const LOST_SETTLE_S = 5
/** The overseas hub of M8. */
const HUB = 'docks'
/** Give up past this (sim seconds). */
const CAP_S = 2400
const OUT_DIR = new URL('../../tests/fixtures/', import.meta.url)
const REGENERATE = 'node tools/fixtures/m8.ts'

const data = loadGameData()

type Name = 'level-up-3' | 'l3-docks' | 'overseas-malware'
const NAMES: readonly Name[] = ['level-up-3', 'l3-docks', 'overseas-malware']

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
  console.log(
    `${name}: tick ${st.tick} (${(st.tick / TICKS_PER_S / 60).toFixed(2)} min), level ${st.level.level}, ` +
      `$${st.economy.balance}, lifetime $${st.economy.lifetimeEarned}, lives ${st.economy.lives}, ` +
      `docks [${st.lane.docks.map((d) => d.id).join(', ')}], ` +
      `${JSON.stringify(fixture)} → ${out.pathname}`,
  )
}

/** Dispatch a setup command; the fixture is wrong if it is refused. */
function must(sim: Sim, cmd: Command): void {
  const res = sim.dispatch(cmd)
  if (!res.ok) {
    throw new Error(
      `${cmd.kind} refused: ${res.reason} (${JSON.stringify(cmd)})`,
    )
  }
}

/** Seed 7 under the competent policy until `stop` holds (checked before each step) or the cap. */
function runPolicy(stop: (sim: Sim) => boolean): {
  sim: Sim
  step: () => void
} {
  const sim = new Sim(data, SEED)
  const policy = createPolicy(sim, 'competent')
  const cap = CAP_S * TICKS_PER_S
  while (!stop(sim) && sim.state.tick < cap) {
    policy.step()
    sim.tick()
  }
  settleCards(sim, policy)
  return {
    sim,
    step: () => {
      policy.step()
      sim.tick()
      settleCards(sim, policy)
    },
  }
}

/** The tick the run reached `level` (stats.levelTick), or null. */
const levelTick = (sim: Sim, level: number): number | null =>
  sim.state.stats.levelTick[String(level)] ?? null

function levelUp3(): void {
  const row = data.levels.find((l) => l.level === LEVEL)
  if (!row) throw new Error(`level-up-3: no levels.json row ${LEVEL}`)
  // The run to its level-up tick, then the same run (deterministic) stopped
  // LEVEL_LEAD_S before it — or right after the last payout before the
  // crossing one, if later (m3.ts level-up's rule).
  let lastEarnTick = 0
  let earned = 0
  const { sim: probe } = runPolicy((s) => {
    if (s.state.economy.lifetimeEarned !== earned) {
      earned = s.state.economy.lifetimeEarned
      // Build 3: a quest reward is paid after `levels` in the tick, so the
      // crossing payout's own tick can still read the old level — only a
      // payout that leaves the lifetime under the threshold counts.
      if (s.state.level.level < LEVEL && earned < row.threshold)
        lastEarnTick = s.state.tick
    }
    return s.state.level.level >= LEVEL
  })
  const upTick = levelTick(probe, LEVEL)
  if (upTick === null)
    throw new Error(`level-up-3: no level-up to ${LEVEL} by ${CAP_S} s`)
  const snapTick = Math.max(
    upTick - LEVEL_LEAD_S * TICKS_PER_S,
    Math.min(lastEarnTick, upTick - 1),
  )
  const { sim } = runPolicy((s) => s.state.tick >= snapTick)
  if (sim.state.level.level !== LEVEL - 1)
    throw new Error('level-up-3: not at L2 at the snapshot')
  if (sim.state.districts[HUB]?.live)
    throw new Error(`level-up-3: ${HUB} is live before L3`)
  write('level-up-3', sim, {
    level: LEVEL,
    lifetime: sim.state.economy.lifetimeEarned,
    threshold: row.threshold,
    levelUpInS: (upTick - snapTick) / TICKS_PER_S,
    region: HUB,
    policy: true,
  })
}

/** The Docks' soonest clearance (clearTick, then id), or null. */
function soonest(sim: Sim) {
  return clearingParcels(sim.state, HUB)[0] ?? null
}

function l3Docks(): void {
  let dockTick: number | null = null
  const { sim } = runPolicy((s) => {
    if (dockTick === null) {
      if (s.state.lane.docks.some((d) => d.id === 'dock2'))
        dockTick = s.state.tick
      return false
    }
    if (s.state.tick < dockTick + DOCK_SETTLE_S * TICKS_PER_S) return false
    const p = soonest(s)
    if (p === null || p.clearTick === null) return false
    // Build 3 (M12 review fixes): no card opens before the clearance + 1 s —
    // shot-fixtures also runs it WITHOUT the policy, where a card holds.
    const ev = s.state.events
    const quietUntil = p.clearTick + TICKS_PER_S
    return (
      p.clearTick - s.state.tick >= CLEAR_LEAD_S * TICKS_PER_S &&
      ev.open === null &&
      ev.queue.length === 0 &&
      ev.nextDrawTick > quietUntil &&
      ev.scheduled.every((l) => l.dueTick > quietUntil)
    )
  })
  const st = sim.state
  const p = soonest(sim)
  if (dockTick === null || p === null || p.clearTick === null)
    throw new Error(`l3-docks: no dock 2 and Docks clearance by ${CAP_S} s`)
  if (st.level.level < LEVEL || st.economy.gameOver)
    throw new Error(`l3-docks: level ${st.level.level}, want a live L${LEVEL}+`)
  write('l3-docks', sim, {
    level: st.level.level,
    tier: st.level.warehouseTier,
    docks: st.lane.docks.map((d) => d.id),
    dockBoughtTick: dockTick,
    clearingParcelId: p.id,
    clearInS: (p.clearTick - st.tick) / TICKS_PER_S,
    pierId: p.dest,
    lockedValue: p.lockedValue,
    malware: p.malware,
    clearing: clearingParcels(st, HUB).length,
    officeId: data.map.hubs.find((h) => h.district === HUB)?.office ?? null,
    policy: true,
  })
}

function overseasMalware(): void {
  let l3: number | null = null
  const { sim, step } = runPolicy((s) => {
    l3 ??= levelTick(s, LEVEL)
    return l3 !== null && s.state.tick >= l3 + OVS_SETTLE_S * TICKS_PER_S
  })
  if (l3 === null)
    throw new Error(`overseas-malware: no L${LEVEL} by ${CAP_S} s`)
  const id = sim.state.nextId.parcel
  must(sim, { kind: 'debugOverseasMalware', hub: HUB })
  const lives = sim.state.economy.lives
  for (let i = 0; i < LOST_SETTLE_S * TICKS_PER_S; i++) step()
  const st = sim.state
  const p = st.parcels[String(id)]
  if (!p || !p.malware || p.state !== 'handed_off' || p.clearTick === null)
    throw new Error('overseas-malware: the debug parcel is not clearing')
  if (st.economy.lives !== lives || st.economy.gameOver)
    throw new Error('overseas-malware: a life was lost while settling')
  write('overseas-malware', sim, {
    level: st.level.level,
    parcelId: id,
    label: p.label,
    strain: p.strain,
    destBuildingId: p.dest,
    hub: HUB,
    officeId: data.map.hubs.find((h) => h.district === HUB)?.office ?? null,
    lives,
    lifeLostInS: (p.clearTick - st.tick) / TICKS_PER_S,
    policy: true,
  })
}

const want = process.argv.slice(2)
for (const n of want) {
  if (!NAMES.includes(n as Name))
    throw new Error(`unknown fixture ${n} (${NAMES.join(', ')})`)
}
for (const n of want.length > 0 ? (want as Name[]) : NAMES) {
  if (n === 'level-up-3') levelUp3()
  else if (n === 'l3-docks') l3Docks()
  else overseasMalware()
}
