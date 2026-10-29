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
//                  stopped LEVEL_LEAD_S before its level-up tick (lifetime
//                  earned just under the L2 threshold, "lifetime $1,990";
//                  one payout crosses it). Load WITH ?policy=1 and advance:
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
//                  with 4 slots"), snapshot L2_SETTLE_S later: tier 2, the
//                  truck on the road, rattle parcels on the lane. Load WITH
//                  ?policy=1 (the `warehouse-l2` shot); no level:up or
//                  region:unlocked event fires after the load, so no paper.

import { mkdirSync, writeFileSync } from 'node:fs'
import { loadGameData } from '../sim/load.node.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { Sim } from '../../src/sim/sim.ts'
import { TICKS_PER_DAY, TICKS_PER_S } from '../../src/sim/types.ts'

const SEED = 7
/** level-up: snapshot this long before the run's level-up tick. */
const LEVEL_LEAD_S = 3
/** payroll-short: the first payday tried (then the next ones). */
const PAYDAY_DAY = 4
/** payroll-short: snapshot this many ticks before the payday. */
const LEAD_TICKS = 20
/** l2-lane: the shaker has worked this long when the snapshot is taken. */
const L2_SETTLE_S = 40
/** Give up past this (sim seconds). */
const CAP_S = 1800
const OUT_DIR = new URL('../../tests/fixtures/', import.meta.url)
const REGENERATE = 'node tools/fixtures/m3.ts'

const data = loadGameData()

type Name = 'level-up' | 'payroll-short' | 'l2-lane'
const NAMES: readonly Name[] = ['level-up', 'payroll-short', 'l2-lane']

function write(name: Name, sim: Sim, fixture: Record<string, unknown>): void {
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
    `${name}: tick ${st.tick} (${st.tick / TICKS_PER_S} s), $${st.economy.balance}, ` +
      `lifetime $${st.economy.lifetimeEarned}, level ${st.level.level}, ` +
      `${JSON.stringify(fixture)} → ${out.pathname}`,
  )
}

/** Run the policy until `stop` holds (checked before each step) or the cap. */
function runPolicy(stop: (sim: Sim) => boolean): Sim {
  const sim = new Sim(data, SEED)
  const policy = createPolicy(sim, 'competent')
  const cap = CAP_S * TICKS_PER_S
  while (!stop(sim) && sim.state.tick < cap) {
    policy.step()
    sim.tick()
  }
  policy.dispose?.()
  return sim
}

function levelUp(): void {
  const row = data.levels.find((l) => l.level === 2)
  if (!row) throw new Error('level-up: no levels.json row 2')
  // The run to its level-up tick, then the same run (deterministic) stopped
  // LEVEL_LEAD_S before it: lifetime just under the threshold.
  const probe = runPolicy((s) => s.state.level.level >= 2)
  const upTick = probe.state.stats.levelTick['2']
  if (upTick === undefined) throw new Error('level-up: no level-up')
  const snapTick = upTick - LEVEL_LEAD_S * TICKS_PER_S
  const sim = runPolicy((s) => s.state.tick >= snapTick)
  if (sim.state.level.level !== 1)
    throw new Error('level-up: already levelled up at the snapshot')
  write('level-up', sim, {
    lifetime: sim.state.economy.lifetimeEarned,
    threshold: row.threshold,
    levelUpInS: LEVEL_LEAD_S,
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
    for (let i = 0; i < LEAD_TICKS; i++) probe.tick()
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
  const placed = runPolicy((s) => slotWith(s, shaker.id) !== null)
  const at = placed.state.tick + L2_SETTLE_S * TICKS_PER_S
  const sim = runPolicy((s) => s.state.tick >= at)
  const slot = slotWith(sim, shaker.id)
  if (sim.state.level.level !== 2 || slot === null)
    throw new Error('l2-lane: no L2 lane with the shaker')
  write('l2-lane', sim, {
    level: 2,
    shakerSlot: slot,
    shakerPlacedTick: placed.state.tick,
    slots: sim.state.lane.nodes
      .filter((n) => n.kind === 'slot' && !n.locked)
      .map((n) => n.id),
    policy: true,
  })
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
