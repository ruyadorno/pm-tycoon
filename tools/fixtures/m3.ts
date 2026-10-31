// The M3 sim shot fixtures (plan.md §12.6 task 12, §6.9.3; city-view.md
// §9.6-§9.7). Regenerate after any change to src/data/*.json, the sim state
// shape or a sim rule that moves a run (the snapshot carries the data hash):
//
//   node tools/fixtures/m3.ts              # all three
//   node tools/fixtures/m3.ts level-up
//
// Seed 7 under the competent policy (src/sim/policy.ts) stepped before every
// tick, like the CLI and ?policy=1. A top-level `fixture` record (Sim.load
// ignores it) tells the shots spec what to expect.
//
//   level-up       A PLAIN run (seed + command log, no state patching)
//                  stopped LEVEL_LEAD_S before its level-up tick, or later:
//                  right after the last payout before the crossing one when
//                  two land in that window (M7: seed 7 earns a $50 bounty and
//                  a $45 delivery in its last 3 s), so lifetime earned sits
//                  just under the L2 threshold ("lifetime $1,990") and one
//                  payout crosses it. Load WITH ?policy=1 and advance:
//                  `level:up {2}` lands `fixture.levelUpInS` later (then the
//                  region fade, the ticker line, tier 2).
//   payroll-short  The policy until the day boundary before PAYDAY_DAY, then
//                  the balance is set to $0 (the one state patch, logged in
//                  `fixture.patched`) LEAD_TICKS before that boundary, at a
//                  boundary where no money comes in meanwhile. Load WITHOUT
//                  ?policy=1 and advance `fixture.paydayInS`: `payroll:short`
//                  with every worker unpaid (`fixture.unpaid`), the red toast,
//                  the "!" badges; a second $0 payday would walk them out.
//   l2-lane        A PLAIN run past L2 until the policy has placed the
//                  Shaky shaker (slot 4, warehouse-view §7.5 "after level:up 2
//                  with 4 slots"), snapshot L2_SETTLE_S later (or
//                  L2_QUIET_S before L3, if sooner): tier 2, the
//                  truck on the road, rattle parcels on the lane. Load WITH
//                  ?policy=1 (the `warehouse-l2` shot); no level:up or
//                  region:unlocked event fires after the load, so no paper.

import { mkdirSync, writeFileSync } from 'node:fs'
import { loadGameData } from '../sim/load.node.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { assertNoCard, plainTick, settleCards } from './cards.ts'
import { Sim } from '../../src/sim/sim.ts'
import { TICKS_PER_DAY, TICKS_PER_S } from '../../src/sim/types.ts'

const SEED = 7
/**
 * l2-lane: the seeds tried in order (build 3, M12: with the decision deck on,
 * seed 7's policy places the shaker only after L3, so the first seed from 7
 * with a real L2 lane holding it is used; `fixture.seed` records it).
 */
const L2_SEEDS: readonly number[] = Array.from(
  { length: 24 },
  (_, i) => SEED + i,
)
/** level-up: snapshot at most this long before the run's level-up tick. */
const LEVEL_LEAD_S = 3
/** payroll-short: the first payday tried (then the next ones). */
const PAYDAY_DAY = 4
/** payroll-short: snapshot this many ticks before the payday. */
const LEAD_TICKS = 20
/** l2-lane: the shaker has worked this long when the snapshot is taken. */
const L2_SETTLE_S = 40
/**
 * l2-lane: no level:up for at least this long after the snapshot
 * (tests/data/shot-fixtures.test.ts watches 30 s under ?policy=1).
 */
const L2_QUIET_S = 45
/** l2-lane: the shot-fixtures test's watch under ?policy=1 (s). */
const L2_WATCH_S = 30
/** Give up past this (sim seconds). */
const CAP_S = 1800
const OUT_DIR = new URL('../../tests/fixtures/', import.meta.url)
const REGENERATE = 'node tools/fixtures/m3.ts'

const data = loadGameData()

type Name = 'level-up' | 'payroll-short' | 'l2-lane'
const NAMES: readonly Name[] = ['level-up', 'payroll-short', 'l2-lane']

function write(name: Name, sim: Sim, fixture: Record<string, unknown>): void {
  assertNoCard(sim, name)
  const snap = {
    ...sim.snapshot(),
    fixture: {
      name,
      regenerate: `${REGENERATE} ${name}`,
      seed: sim.state.seed,
      tick: sim.state.tick,
      ...fixture,
    },
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const out = new URL(`${name}.json`, OUT_DIR)
  writeFileSync(out, `${JSON.stringify(snap)}\n`)
  const st = sim.state
  console.log(
    `${name}: tick ${st.tick} (${st.tick / TICKS_PER_S} s), $${st.economy.balance}, ` +
      `lifetime $${st.economy.lifetimeEarned}, level ${st.level.level}, ` +
      `${JSON.stringify(fixture)} → ${out.pathname}`,
  )
}

/** Run the policy until `stop` holds (checked before each step) or the cap. */
function runPolicy(stop: (sim: Sim) => boolean, seed = SEED): Sim {
  const sim = new Sim(data, seed)
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

function levelUp(): void {
  const row = data.levels.find((l) => l.level === 2)
  if (!row) throw new Error('level-up: no levels.json row 2')
  // The run to its level-up tick, then the same run (deterministic) stopped
  // LEVEL_LEAD_S before it — or right after the last payout before the
  // crossing one, if later: lifetime just under the threshold, one payout to
  // go.
  let lastEarnTick = 0
  let earned = 0
  const probe = runPolicy((s) => {
    if (s.state.economy.lifetimeEarned !== earned) {
      earned = s.state.economy.lifetimeEarned
      // Build 3: a quest reward is paid after `levels` in the tick, so the
      // crossing payout's own tick can still read the old level — only a
      // payout that leaves the lifetime under the threshold counts.
      if (s.state.level.level < 2 && earned < row.threshold)
        lastEarnTick = s.state.tick
    }
    return s.state.level.level >= 2
  })
  const upTick = probe.state.stats.levelTick['2']
  if (upTick === undefined) throw new Error('level-up: no level-up')
  const snapTick = Math.max(
    upTick - LEVEL_LEAD_S * TICKS_PER_S,
    Math.min(lastEarnTick, upTick - 1),
  )
  const sim = runPolicy((s) => s.state.tick >= snapTick)
  if (sim.state.level.level !== 1)
    throw new Error('level-up: already levelled up at the snapshot')
  write('level-up', sim, {
    lifetime: sim.state.economy.lifetimeEarned,
    threshold: row.threshold,
    levelUpInS: (upTick - snapTick) / TICKS_PER_S,
    policy: true,
  })
}

/** The snapshot sim LEAD_TICKS before `day`'s payday, balance patched to $0. */
function beforePayday(day: number): Sim {
  const at = day * TICKS_PER_DAY - LEAD_TICKS
  const sim = runPolicy((s) => s.state.tick >= at)
  sim.state.economy.balance = 0
  return sim
}

function payrollShort(): void {
  for (let day = PAYDAY_DAY; day * TICKS_PER_DAY < CAP_S * TICKS_PER_S; day++) {
    const sim = beforePayday(day)
    const workers = sim.state.employees.filter((e) => e.active).map((e) => e.id)
    // Probe the same state without the policy: nobody may be paid.
    const probe = Sim.load(data, JSON.parse(JSON.stringify(sim.snapshot())))
    let short: number[] | null = null
    let paid = 0
    probe.events.on('payroll:short', (p) => {
      short = p.employeeIds
    })
    probe.events.on('payroll:paid', (p) => {
      paid += p.amount
    })
    for (let i = 0; i < LEAD_TICKS; i++) plainTick(probe)
    const unpaid = short as number[] | null
    if (paid > 0 || unpaid === null || unpaid.length !== workers.length)
      continue
    write('payroll-short', sim, {
      paydayInS: LEAD_TICKS / TICKS_PER_S,
      unpaid,
      patched: 'economy.balance = 0',
      policy: false,
    })
    return
  }
  throw new Error('payroll-short: no payday with no income in the lead')
}

/** The lane node holding a machine with checker `defId`, if any. */
function slotWith(sim: Sim, defId: string): string | null {
  for (const n of sim.state.lane.nodes) {
    const f = n.fixture
    if (f && f.kind === 'machine' && f.checker.defId === defId) return n.id
  }
  return null
}

function l2Lane(): void {
  const shaker = data.machines.checkers.find((m) => m.strain === 'rattle')
  if (!shaker) throw new Error('l2-lane: no rattle counter in machines.json')
  const misses: string[] = []
  for (const seed of L2_SEEDS) {
    const why = l2LaneSeed(seed, shaker.id)
    if (why === null) return
    misses.push(`seed ${seed}: ${why}`)
    console.log(`l2-lane: ${misses.at(-1)}`)
  }
  throw new Error(`l2-lane: no seed works (${misses.join('; ')})`)
}

/** Write l2-lane from `seed`, or say why that seed has no L2 shaker lane. */
function l2LaneSeed(seed: number, shakerId: string): string | null {
  // One probe run to L3 (deterministic) for the shaker's tick and L3's.
  const seen: { placed: number | null } = { placed: null }
  const probe = runPolicy((s) => {
    if (seen.placed === null && slotWith(s, shakerId) !== null)
      seen.placed = s.state.tick
    return s.state.level.level >= 3
  }, seed)
  const placedTick = seen.placed
  if (placedTick === null) return 'the shaker never placed before L3'
  const l3Tick = probe.state.stats.levelTick['3'] ?? Infinity
  // L2_SETTLE_S after the shaker — earlier when L3 would land inside the
  // shot's quiet window (build 3: seed 7 placed it ≈ 60 s before L3).
  const at = Math.min(
    placedTick + L2_SETTLE_S * TICKS_PER_S,
    l3Tick - L2_QUIET_S * TICKS_PER_S,
  )
  if (at <= placedTick)
    return `L3 lands ${(l3Tick - placedTick) / TICKS_PER_S} s after the shaker`
  const sim = runPolicy((s) => s.state.tick >= at, seed)
  const slot = slotWith(sim, shakerId)
  if (sim.state.level.level !== 2 || slot === null)
    return 'no L2 lane with the shaker at the snapshot'
  if (
    sim.state.lane.nodes.filter((n) => n.kind === 'slot' && !n.locked)
      .length !== 4
  )
    return 'not four live slots'
  if (!sim.state.vehicles.some((v) => v.type === 'truck'))
    return 'no truck at the snapshot'
  // tests/data/shot-fixtures.test.ts: 30 s under ?policy=1 from the
  // snapshot with no level:up and no life lost.
  const after = Sim.load(data, JSON.parse(JSON.stringify(sim.snapshot())))
  const watch = createPolicy(after, 'competent')
  for (let i = 0; i < L2_WATCH_S * TICKS_PER_S; i++) {
    watch.step()
    after.tick()
  }
  watch.dispose?.()
  if (after.state.level.level !== 2) return 'a level:up in the watch window'
  if (after.state.stats.livesLost > sim.state.stats.livesLost)
    return 'a life lost in the watch window'
  write('l2-lane', sim, {
    level: 2,
    shakerSlot: slot,
    shakerPlacedTick: placedTick,
    slots: sim.state.lane.nodes
      .filter((n) => n.kind === 'slot' && !n.locked)
      .map((n) => n.id),
    policy: true,
  })
  return null
}

const want = process.argv.slice(2)
for (const n of want) {
  if (!NAMES.includes(n as Name))
    throw new Error(`unknown fixture ${n} (${NAMES.join(', ')})`)
}
for (const n of want.length > 0 ? (want as Name[]) : NAMES) {
  if (n === 'level-up') levelUp()
  else if (n === 'payroll-short') payrollShort()
  else l2Lane()
}
