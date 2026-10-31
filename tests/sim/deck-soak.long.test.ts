// Build 3 M13 — a 60-minute soak with the shipped deck (plan-build3 §8.4
// task 4; spec-build3 §3.2, §3.6, §3.7, §3.9): seeds 1–3 × 60 min under
// the competent policy with SIM_FEATURES.events on, through the CLI's
// runSeed (its per-tick asserts: no hold, a finite balance ≥ 0, no vehicle
// stuck > 120 s, auditState every day — ids, NaN, the conservation
// identity). On top, sampled at every recorded event and every minute row:
//
//   - no stuck slot: the open card is never older than eventsOpenMaxTicks,
//     the queue stays within maxQueued, a due link waits only for the quiet
//     rules and the slot (never more than twice afterLevelUpS), no link
//     runs deeper than chainMaxLinks; every offered card is decided (a job
//     card may be withdrawn by the sim), and no `once` card is offered
//     twice in the hour;
//   - no modifier past its bounds: every row finite (mult ≥ 0, an expiry
//     after its apply), and at every `modifier:applied` the RAW stack of
//     each key (Π mult / Σ add of the live rows, per scope — the clamp left
//     out) inside events.json modifiers.bounds, so the fold clamp never
//     hides a stacking card; the folds the read sites see are finite and in
//     bounds too; modifiersActiveMax ≤ 12;
//   - no NaN anywhere it is read: balance, lives (0…cap), every district's
//     happiness (min…max), every modifier row; conservation holds at the
//     end; no event game over.
//
// Per seed the cards, the categories, the chains, the peak modifiers and
// the L5 / victory minutes are printed. Tagged [long]: excluded from
// `vlr check:quick` (tools/check.mjs), run by the full `vlr check`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ModifierKey } from '../../src/data/types.ts'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import { isLive, modAdd, modMult } from '../../src/sim/modifiers.ts'
import { MULT_KEYS } from '../../src/sim/modifiers.ts'
import type { AddKey, MultKey } from '../../src/sim/modifiers.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import type { Sim } from '../../src/sim/sim.ts'
import { TICKS_PER_DAY, ticksFromS } from '../../src/sim/types.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import { dataFixture } from './helpers.ts'

const data = dataFixture()
const SEEDS = [1, 2, 3]
const MINUTES = 60
/** plan-build3 §8.4 task 4: the soak's ceiling on live modifier rows. */
const MODIFIERS_ACTIVE_MAX = 12
const sch = data.events.schedule
const bounds = data.events.modifiers.bounds
const SAT = data.economy.satisfaction
const OPEN_MAX = data.economy.pacingTargets.eventsOpenMaxTicks
/** A due link waits for the quiet rules (afterLevelUpS, twice when the Golden Release's quiet follows a level-up) and the slot. */
const OVERDUE_MAX = 2 * ticksFromS(sch.afterLevelUpS) + sch.chainMaxLinks
const MULT = new Set<ModifierKey>(MULT_KEYS)
const featureEvents = SIM_FEATURES.events

beforeAll(() => {
  SIM_FEATURES.events = true
})
afterAll(() => {
  SIM_FEATURES.events = featureEvents
})

interface Soak {
  run: RunResult
  problems: string[]
  overdueMax: number
  rowsMax: number
  samples: number
  stackChecks: number
}

/** Push a problem once per kind (the first few), so a broken run reports, not floods. */
function report(out: string[], line: string): void {
  if (out.length < 25) out.push(line)
}

/** The raw stack of `key` for `scope` (Π mult / Σ add of the live rows, no clamp), or null with no row. */
function rawStack(
  sim: Sim,
  key: ModifierKey,
  scope: string | null,
): number | null {
  const s = sim.state
  let v = MULT.has(key) ? 1 : 0
  let hit = false
  for (const m of s.modifiers) {
    if (m.key !== key || !isLive(m, s.tick)) continue
    if (m.scope !== null && m.scope !== scope) continue
    hit = true
    v = MULT.has(key) ? v * m.mult : v + m.add
  }
  return hit ? v : null
}

/** Every key × scope with a live row: the raw stack and the fold inside bounds. */
function checkStacks(sim: Sim, out: string[]): void {
  const s = sim.state
  const scopes = new Set<string | null>([
    null,
    ...s.modifiers.map((m) => m.scope),
  ])
  for (const key of new Set(s.modifiers.map((m) => m.key))) {
    const [lo, hi] = bounds[key]
    for (const scope of scopes) {
      const raw = rawStack(sim, key, scope)
      if (raw !== null && !(raw >= lo - 1e-9 && raw <= hi + 1e-9))
        report(
          out,
          `${s.tick}: ${key}/${scope ?? '-'} stacks to ${raw} outside [${lo}, ${hi}]`,
        )
      const fold = MULT.has(key)
        ? modMult(sim, key as MultKey, scope)
        : modAdd(sim, key as AddKey, scope)
      // (The identity is inside bounds: tests/data/events.test.ts.)
      if (!Number.isFinite(fold) || fold < lo || fold > hi)
        report(out, `${s.tick}: ${key}/${scope ?? '-'} folds to ${fold}`)
    }
  }
}

/** The slot, the links, the rows and the numbers read everywhere. */
function checkState(
  sim: Sim,
  out: string[],
  soak: { overdueMax: number; rowsMax: number },
): void {
  const s = sim.state
  const ev = s.events
  if (ev.open !== null && s.tick - ev.open.openedTick > OPEN_MAX)
    report(
      out,
      `${s.tick}: ${ev.open.eventId} open since ${ev.open.openedTick}`,
    )
  if (ev.queue.length > sch.maxQueued)
    report(out, `${s.tick}: queue ${ev.queue.length}`)
  for (const l of ev.scheduled) {
    soak.overdueMax = Math.max(soak.overdueMax, s.tick - l.dueTick)
    if (l.dueTick < l.bookedTick)
      report(out, `${s.tick}: a link due before it was booked`)
    if (l.depth > sch.chainMaxLinks)
      report(out, `${s.tick}: a link at depth ${l.depth}`)
  }
  if (ev.open !== null && ev.open.depth > sch.chainMaxLinks)
    report(out, `${s.tick}: ${ev.open.eventId} at depth ${ev.open.depth}`)
  soak.rowsMax = Math.max(soak.rowsMax, s.modifiers.length)
  for (const m of s.modifiers) {
    if (!(m.key in bounds))
      report(out, `${s.tick}: unknown modifier key ${m.key}`)
    if (!Number.isFinite(m.mult) || m.mult < 0 || !Number.isFinite(m.add))
      report(out, `${s.tick}: ${m.id} ${m.key} mult ${m.mult} add ${m.add}`)
    if (
      m.untilTick !== null &&
      !(Number.isInteger(m.untilTick) && m.untilTick > m.appliedTick)
    )
      report(
        out,
        `${s.tick}: ${m.id} ${m.key} until ${m.untilTick} (applied ${m.appliedTick})`,
      )
  }
  const eco = s.economy
  if (!Number.isFinite(eco.balance) || eco.balance < 0)
    report(out, `${s.tick}: balance ${eco.balance}`)
  if (
    !Number.isInteger(eco.lives) ||
    eco.lives < 0 ||
    eco.lives > data.economy.lives.cap
  )
    report(out, `${s.tick}: lives ${eco.lives}`)
  for (const [id, d] of Object.entries(s.districts)) {
    if (
      !Number.isFinite(d.satisfaction) ||
      d.satisfaction < SAT.min ||
      d.satisfaction > SAT.max
    )
      report(out, `${s.tick}: ${id} happiness ${d.satisfaction}`)
  }
}

let cached: Soak[] | null = null
/** The three 60-minute runs (computed once for this file). */
function soaks(): Soak[] {
  cached ??= SEEDS.map((seed) => {
    const problems: string[] = []
    const acc = { overdueMax: 0, rowsMax: 0 }
    let samples = 0
    let stackChecks = 0
    const run = runSeed(data, seed, MINUTES, createPolicy, {
      onEvent: (e, sim) => {
        samples += 1
        checkState(sim, problems, acc)
        if (e.name === 'modifier:applied') {
          stackChecks += 1
          checkStacks(sim, problems)
        }
      },
      onRow: (_row, sim) => {
        samples += 1
        checkState(sim, problems, acc)
        checkStacks(sim, problems)
      },
    })
    return { run, problems, ...acc, samples, stackChecks }
  })
  return cached
}

describe(`[long] the deck soak: seeds ${SEEDS.join(', ')} × ${MINUTES} min, events on (plan-build3 §8.4 task 4)`, () => {
  it('the runs keep the CLI invariants: no hold, no stuck vehicle, auditState (ids, NaN, the identity) every day, conservation at the end; the whole hour played', () => {
    for (const { run } of soaks()) {
      expect(run.result.asserts, `seed ${run.seed}`).toEqual([])
      expect(run.conservation.ok, `seed ${run.seed}`).toBe(true)
      expect(run.perf.ticks, `seed ${run.seed}`).toBe(MINUTES * TICKS_PER_DAY)
      expect(run.result.metrics.eventGameOvers, `seed ${run.seed}`).toBe(0)
    }
  }, 120_000)

  it('no stuck slot: the open card ≤ eventsOpenMaxTicks old, the queue in bounds, due links never waiting past the quiet rules, chains ≤ chainMaxLinks deep; every card decided; no once card twice', () => {
    const onceIds = new Set(
      data.events.deck.filter((d) => d.once).map((d) => d.id),
    )
    for (const soak of soaks()) {
      const { run } = soak
      const m = run.result.metrics
      const tag = `seed ${run.seed}`
      expect(soak.problems, tag).toEqual([])
      expect(soak.samples, tag).toBeGreaterThan(MINUTES)
      expect(m.eventsOpenMaxTicks, tag).toBeLessThanOrEqual(OPEN_MAX)
      expect(
        soak.overdueMax,
        `${tag}: a due link's longest wait`,
      ).toBeLessThanOrEqual(OVERDUE_MAX)
      const offered = run.events.filter((e) => e.name === 'event:offered')
      const closed = run.events.filter(
        (e) => e.name === 'event:decided' || e.name === 'event:withdrawn',
      )
      for (const w of run.events.filter((e) => e.name === 'event:withdrawn'))
        expect(String(w.eventId), tag).toMatch(/^job:/)
      const last = offered.filter(
        (e) => e.tick === MINUTES * TICKS_PER_DAY,
      ).length
      expect(closed.length + last, tag).toBe(offered.length)
      const seen = new Map<string, number>()
      for (const e of offered) {
        const id = String(e.eventId)
        if (onceIds.has(id)) seen.set(id, (seen.get(id) ?? 0) + 1)
      }
      expect(
        [...seen].filter(([, n]) => n > 1),
        `${tag}: once cards repeated`,
      ).toEqual([])
      expect(offered.length, tag).toBeGreaterThanOrEqual(
        data.economy.pacingTargets.eventsOfferedBy30MinMin,
      )
    }
  }, 120_000)

  it(`no modifier past its bounds: every row finite, every raw stack inside modifiers.bounds at each apply and each minute; modifiersActiveMax ≤ ${MODIFIERS_ACTIVE_MAX}`, () => {
    for (const soak of soaks()) {
      const { run } = soak
      const m = run.result.metrics
      const tag = `seed ${run.seed}`
      expect(soak.problems, tag).toEqual([])
      expect(soak.stackChecks, `${tag}: modifiers applied`).toBeGreaterThan(0)
      expect(m.modifiersActiveMax, tag).toBeLessThanOrEqual(
        MODIFIERS_ACTIVE_MAX,
      )
      expect(soak.rowsMax, tag).toBeLessThanOrEqual(MODIFIERS_ACTIVE_MAX)
    }
  }, 120_000)

  it('informational: per seed the cards, categories, chains, the modifier peak and the L5 / victory minutes', () => {
    for (const { run, overdueMax, rowsMax } of soaks()) {
      const m = run.result.metrics
      const cats = Object.entries(m.eventsByCategory)
        .toSorted((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}`)
        .join(' · ')
      const deckCats = Object.keys(m.eventsByCategory).filter(
        (k) => k !== 'job',
      ).length
      console.log(
        `[deck-soak] seed ${run.seed}: ${run.events.filter((e) => e.name === 'event:offered').length} cards (${deckCats} deck categories: ${cats}) · chains ${m.chainsStarted}/${m.chainsFinished} · modifiers peak ${m.modifiersActiveMax} (rows ${rowsMax}) · longest link wait ${overdueMax} ticks · lives lost to events ${m.eventLivesLost} · gained ${m.eventLivesGained} · vehicles lost ${m.eventVehiclesLost} · L5 ${m.level5Min ?? '—'} · victory ${m.victoryMin ?? '—'} · EV/card ${m.policyEvPerCard ?? '—'} · p99 ${run.perf.p99Ms.toFixed(3)} ms`,
      )
    }
    expect(soaks()).toHaveLength(SEEDS.length)
  }, 120_000)
})
