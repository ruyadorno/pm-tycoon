// The M6 people shot fixtures (plan-build2 §8.3 task 12; design-m6 §8 B, §7
// shots). Regenerate after any change to src/data/*.json, the sim state
// shape or a sim rule that moves a run (the snapshot carries the data hash):
//
//   node tools/fixtures/people.ts              # both
//   node tools/fixtures/people.ts sorter-duty
//
// Seed 7, the policy (src/sim/policy.ts) stepped before every tick like the
// CLI and ?policy=1, plus logged commands only — no state patching — so both
// are plain runs: __pm.replay() and tests/data/shot-fixtures.test.ts rebuild
// them from the seed and the command log. A top-level `fixture` record
// (Sim.load ignores it) tells the shots spec what to expect.
//
//   people-l3    The competent policy past L2 until the Shaky shaker is in
//                and the balance covers desk 2, MAX_ADS ads and two hire
//                fees; then `debugForceLevel 3` (M6 has no L3 run — the
//                playtest cap is still L2, so Docks go live without the M8
//                clearance: shots only, never the gate or the attract city),
//                `removeFixture` of the COUNTERS Metal detector in DESK2_SLOT,
//                `placeDesk {DESK2_SLOT, index 2}`, `postAd inspector` until
//                the pool holds a charisma-2 applicant, and two hires into
//                desk 2 — that one and then the best (highest-eye) applicant.
//                SETTLE_S more seconds of the policy. Two desks in the lane
//                readout; desk 2 shows the per-desk charisma bonus
//                (`warehouse-two-desks`). Load WITH ?policy=1 or without.
//   sorter-duty  The `delegating` policy (a sorter hired at L2, the Hold Bay
//                left to it) until the sorter has tagged a held parcel
//                `looks clean` — the snapshot is taken on that tick, before
//                the policy's next step would Clear it. Load WITHOUT
//                ?policy=1: the sorter keeps working, the tagged parcel stays
//                held with its hint line (`station-sorter`,
//                `holdcard-sorter-hint`).

import { mkdirSync, writeFileSync } from 'node:fs'
import { loadGameData } from '../sim/load.node.ts'
import { bestApplicant, createPolicy } from '../../src/sim/policy.ts'
import type { PolicyKind } from '../../src/sim/sim.ts'
import { Sim } from '../../src/sim/sim.ts'
import { salaryOf } from '../../src/sim/systems/people.ts'
import type { Command } from '../../src/sim/commands.ts'
import type { LaneNode, Parcel } from '../../src/sim/types.ts'
import { laneNode, TICKS_PER_S } from '../../src/sim/types.ts'

const SEED = 7
/** people-l3: the slot desk 2 takes (the policy's COUNTERS Metal detector sits there at L2). */
const DESK2_SLOT = 'slot3'
/** people-l3: the forced level (desk 2 unlocks there, employees.json desks.rows). */
const FORCED_LEVEL = 3
/** people-l3: at most this many ads for a charisma-2 inspector. */
const MAX_ADS = 10
/** people-l3: the policy runs this long after the hires. */
const SETTLE_S = 5
/** Give up past this (sim seconds). */
const CAP_S = 1800
const OUT_DIR = new URL('../../tests/fixtures/', import.meta.url)
const REGENERATE = 'node tools/fixtures/people.ts'

const data = loadGameData()

type Name = 'people-l3' | 'sorter-duty'
const NAMES: readonly Name[] = ['people-l3', 'sorter-duty']

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
    `${name}: tick ${st.tick} (${st.tick / TICKS_PER_S} s), level ${st.level.level}, ` +
      `$${st.economy.balance}, staff ${st.employees.length}, ` +
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

/** Seed 7 under `kind` until `stop` holds after a tick (checked before each step) or the cap. */
function runPolicy(
  kind: PolicyKind,
  stop: (sim: Sim) => boolean,
): { sim: Sim; step: () => void } {
  const sim = new Sim(data, SEED)
  const policy = createPolicy(sim, kind)
  const cap = CAP_S * TICKS_PER_S
  while (!stop(sim) && sim.state.tick < cap) {
    policy.step()
    sim.tick()
  }
  return {
    sim,
    step: () => {
      policy.step()
      sim.tick()
    },
  }
}

/** Does a lane slot hold a machine with checker `defId`? */
const owns = (sim: Sim, defId: string): boolean =>
  sim.state.lane.nodes.some(
    (n) => n.fixture?.kind === 'machine' && n.fixture.checker.defId === defId,
  )

const deskOf = (node: LaneNode | null) =>
  node?.fixture?.kind === 'desk' ? node.fixture : null

function peopleL3(): void {
  const desk2 = data.employees.desks.rows.find((r) => r.index === 2)
  if (!desk2) throw new Error('people-l3: no desks.rows index 2')
  if (desk2.unlockLevel > FORCED_LEVEL)
    throw new Error(`people-l3: desk 2 unlocks at L${desk2.unlockLevel}`)
  const shaker = data.machines.checkers.find((m) => m.strain === 'rattle')
  if (!shaker) throw new Error('people-l3: no rattle counter in machines.json')
  const maxFee =
    salaryOf(data, 'inspector', { eye: 5, pace: 5, charisma: 2 }) *
    data.employees.roles.inspector.hireFeeDays
  const need =
    desk2.price + MAX_ADS * data.employees.applicants.adPrice + 2 * maxFee
  const { sim, step } = runPolicy(
    'competent',
    (s) =>
      s.state.level.level >= 2 &&
      owns(s, shaker.id) &&
      s.state.economy.balance >= need,
  )
  if (sim.state.level.level < 2 || !owns(sim, shaker.id))
    throw new Error(`people-l3: no L2 lane with the shaker by ${CAP_S} s`)

  must(sim, { kind: 'debugForceLevel', level: FORCED_LEVEL })
  const slot = laneNode(sim.state.lane, DESK2_SLOT)
  if (!slot || slot.locked || slot.fixture?.kind !== 'machine')
    throw new Error(`people-l3: ${DESK2_SLOT} holds no machine to remove`)
  const removed = slot.fixture.checker.defId
  must(sim, { kind: 'removeFixture', nodeId: DESK2_SLOT })
  must(sim, { kind: 'placeDesk', nodeId: DESK2_SLOT, index: 2 })

  const charismatic = () =>
    sim.state.applicants.inspector.find((a) => a.pips.charisma === 2) ?? null
  let ads = 0
  while (charismatic() === null && ads < MAX_ADS) {
    must(sim, { kind: 'postAd', role: 'inspector' })
    ads += 1
  }
  const ch2 = charismatic()
  if (!ch2)
    throw new Error(`people-l3: no charisma-2 inspector in ${MAX_ADS} ads`)
  must(sim, {
    kind: 'hire',
    role: 'inspector',
    applicantId: ch2.id,
    target: { nodeId: DESK2_SLOT },
  })
  const other = bestApplicant(sim, 'inspector')
  if (!other) throw new Error('people-l3: the inspector pool is empty')
  must(sim, {
    kind: 'hire',
    role: 'inspector',
    applicantId: other.id,
    target: { nodeId: DESK2_SLOT },
  })
  for (let i = 0; i < SETTLE_S * TICKS_PER_S; i++) step()

  const st = sim.state
  const desks = st.lane.nodes.flatMap((n) => {
    const f = deskOf(n)
    return f
      ? [
          {
            index: f.index,
            nodeId: n.id,
            inspectorIds: f.inspectorIds.slice(),
            p: n.stations.map((s) => s.p ?? null),
            readoutP: f.checker.pMatch,
          },
        ]
      : []
  })
  const d2 = desks.find((d) => d.index === 2)
  if (!d2 || d2.inspectorIds.length !== 2)
    throw new Error('people-l3: desk 2 lost an inspector while settling')
  if (st.level.level !== FORCED_LEVEL || st.economy.gameOver)
    throw new Error('people-l3: not a live L3 game after settling')
  write('people-l3', sim, {
    level: FORCED_LEVEL,
    removed: { nodeId: DESK2_SLOT, defId: removed },
    ads,
    charismaInspector: {
      id: st.employees.find((e) => e.name === ch2.name)?.id ?? null,
      name: ch2.name,
    },
    desks,
    policy: true,
  })
}

/** The first held parcel the seated sorter has tagged `looks clean`. */
function taggedHeld(sim: Sim): Parcel | null {
  const st = sim.state
  const hold = laneNode(st.lane, st.lane.holdBayNodeId)
  for (const id of hold?.queue ?? []) {
    const p = st.parcels[String(id)]
    if (p && p.state === 'held' && p.sorted !== undefined) return p
  }
  return null
}

function sorterDuty(): void {
  const { sim } = runPolicy('delegating', (s) => taggedHeld(s) !== null)
  const p = taggedHeld(sim)
  if (!p || p.sorted === undefined)
    throw new Error(`sorter-duty: no tagged parcel by ${CAP_S} s`)
  const st = sim.state
  const sorterId = st.lane.holdStation.fixture
  const sorter = st.employees.find((e) => e.id === sorterId)
  if (!sorter || sorter.role !== 'sorter' || !sorter.active)
    throw new Error('sorter-duty: no active sorter on the station')
  write('sorter-duty', sim, {
    level: st.level.level,
    sorter: { id: sorter.id, name: sorter.name, pips: sorter.pips },
    parcelId: p.id,
    label: p.label,
    malware: p.malware,
    pct: p.sorted.pct,
    holdCardLine: p.trace.at(-1)?.text ?? null,
    policy: false,
  })
}

const want = process.argv.slice(2)
for (const n of want) {
  if (!NAMES.includes(n as Name))
    throw new Error(`unknown fixture ${n} (${NAMES.join(', ')})`)
}
for (const n of want.length > 0 ? (want as Name[]) : NAMES) {
  if (n === 'people-l3') peopleL3()
  else sorterDuty()
}
