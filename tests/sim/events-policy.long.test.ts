// spec-build3 §3.8-§3.9; plan-build3 §8.2 task 8, §8.3 task 5; M11 contract
// §3 stream D task 8: the event policy on the shipped deck with
// SIM_FEATURES.events on, seeds 1-10 × 30 min through the CLI's runSeed
// (the gate's own runs) — no card stays open past the step after the tick
// that offered it (eventsOpenMaxTicks ≤ 1 on every seed), the policy
// decides every card it is offered (every event:offered has its
// event:decided, none withdrawn but a job card the Golden Release
// displaced), every job card is accepted, and the run keeps its invariants.
// M12 (the flag on, the ~60-card deck): the event rows are gated here as in
// `vlr sim:gate` — ≥ eventsOfferedBy30MinMin cards by 30 min, ≥
// eventsL1PlateauMin decision cards on the L1 plateau, the policy's EV per
// card inside events.json policy.evBand and its non-default share ≥
// nonDefaultShareMin (medians); the cards per category, the chains and the
// lives / vehicles / workers events took are printed. Tagged [long]:
// excluded from `vlr check:quick` (tools/check.mjs), run by the full
// `vlr check`.
// M13 (the full deck, plan-build3 §8.4 tasks 1 + 4 and the acceptance):
// the L1 plateau shows ≥ eventsL1PlateauMin decision cards on EVERY seed
// (10/10, not just the median); a run sees ≥ 9 deck categories (median,
// jobs left out) and never offers a `once` card twice; the quest rows hold
// with the deck on (questsOfferedBy30MinMin / questsCompletedBy30MinMin by
// median, B3 §3.9 "kept"); and the `delegating` policy's rows over the same
// seeds with the deck on are printed (informational, as `vlr
// sim:delegating`; its runs keep the invariants and the slot never sticks).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import { deckEvMean } from '../../src/sim/policies/eventPolicy.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { TICKS_PER_DAY } from '../../src/sim/types.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import {
  categoryTallies,
  formatGate,
  median,
  summarise,
} from '../../tools/sim/report.ts'
import { dataFixture } from './helpers.ts'

const data = dataFixture()
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
/** plan-build3 §8.4 task 1 / acceptance: deck categories a 30-min policy run sees (median). */
const CATEGORIES_PER_RUN_MIN = 9
const featureEvents = SIM_FEATURES.events

beforeAll(() => {
  SIM_FEATURES.events = true
})
afterAll(() => {
  SIM_FEATURES.events = featureEvents
})

let cached: RunResult[] | null = null
/** The 10-seed × 30-min competent runs with the decision draw on (computed once). */
function runs(): RunResult[] {
  cached ??= SEEDS.map((seed) => runSeed(data, seed, 30, createPolicy))
  return cached
}

/** The deck categories a run's cards came from (job cards left out). */
function deckCategories(r: RunResult): string[] {
  return Object.keys(r.result.metrics.eventsByCategory).filter(
    (k) => k !== 'job',
  )
}

describe('[long] the event policy on the shipped deck, seeds 1-10 × 30 min (events on)', () => {
  it('no card stays open past one tick; every offered card is decided (a job card only ever withdrawn by the sim); every job card accepted; the invariants hold', () => {
    for (const r of runs()) {
      const m = r.result.metrics
      expect(r.result.asserts, `seed ${r.seed}`).toEqual([])
      expect(r.conservation.ok, `seed ${r.seed}`).toBe(true)
      expect(m.eventsOpenMaxTicks, `seed ${r.seed}`).toBeLessThanOrEqual(
        data.economy.pacingTargets.eventsOpenMaxTicks,
      )
      const offered = r.events.filter((e) => e.name === 'event:offered')
      const decided = r.events.filter((e) => e.name === 'event:decided')
      const withdrawn = r.events.filter((e) => e.name === 'event:withdrawn')
      expect(offered.length, `seed ${r.seed}`).toBeGreaterThan(0)
      expect(m.eventsOffered30, `seed ${r.seed}`).toBe(offered.length)
      for (const w of withdrawn) {
        expect(String(w.eventId), `seed ${r.seed}`).toMatch(/^job:/)
      }
      // A card offered on the last tick is answered by no further step.
      const last = offered.filter((e) => e.tick === 30 * TICKS_PER_DAY).length
      expect(decided.length + withdrawn.length + last, `seed ${r.seed}`).toBe(
        offered.length,
      )
      for (const d of decided) {
        if (d.kind === 'job') expect(d.label, `seed ${r.seed}`).toBe('Accept')
      }
      expect(
        r.events.filter((e) => e.name === 'quest:declined'),
        `seed ${r.seed}`,
      ).toEqual([])
    }
  }, 180_000)

  it('the event rows (B3 §3.9, gated since M12): cards by 30 min, the L1 plateau, the EV band and the non-default share by median; the categories, chains and harsh outcomes printed', () => {
    const m = runs().map((r) => r.result.metrics)
    const band = data.events.policy
    const ev = median(m.map((x) => x.policyEvPerCard))
    const nd = median(m.map((x) => x.policyNonDefaultShare))
    const inBand = ev !== null && ev >= band.evBand[0] && ev <= band.evBand[1]
    console.log(
      `[events-policy] EV/card by seed ${m.map((x) => x.policyEvPerCard ?? '—').join(',')} (median ${ev ?? '—'}, band ${band.evBand[0]}…${band.evBand[1]}${inBand ? '' : ' — OUTSIDE'}); non-default share ${m.map((x) => x.policyNonDefaultShare ?? '—').join(',')} (median ${nd ?? '—'}, min ${band.nonDefaultShareMin}${nd !== null && nd >= band.nonDefaultShareMin ? '' : ' — BELOW'})`,
    )
    console.log(
      `[events-policy] cards by 30 min ${m.map((x) => x.eventsOffered30).join(',')} (median ${median(m.map((x) => x.eventsOffered30))}, target ≥ ${data.economy.pacingTargets.eventsOfferedBy30MinMin}); L1 decisions ${m.map((x) => x.eventsL1Decisions).join(',')} (median ${median(m.map((x) => x.eventsL1Decisions))}, target ≥ ${data.economy.pacingTargets.eventsL1PlateauMin})`,
    )
    console.log(
      `[events-policy] by category ${categoryTallies(m)
        .map(([k, n]) => `${k} ${n}`)
        .join(' · ')}`,
    )
    const sum = (f: (x: (typeof m)[number]) => number | null): number =>
      m.reduce((n, x) => n + (f(x) ?? 0), 0)
    console.log(
      `[events-policy] all seeds: chains ${sum((x) => x.chainsStarted)} started / ${sum((x) => x.chainsFinished)} finished · modifiers peak ${Math.max(...m.map((x) => x.modifiersActiveMax))} · lives lost to events ${sum((x) => x.eventLivesLost)} · gained ${sum((x) => x.eventLivesGained)} · vehicles lost ${sum((x) => x.eventVehiclesLost)} · workers lost ${sum((x) => x.eventWorkersLost)} · event game overs ${sum((x) => x.eventGameOvers)} · malware lives lost ${sum((x) => x.livesLost)}`,
    )
    expect(
      m.every(
        (x) => x.policyEvPerCard === null || Number.isFinite(x.policyEvPerCard),
      ),
    ).toBe(true)
    const t = data.economy.pacingTargets
    expect(median(m.map((x) => x.eventsOffered30))!).toBeGreaterThanOrEqual(
      t.eventsOfferedBy30MinMin,
    )
    expect(median(m.map((x) => x.eventsL1Decisions))!).toBeGreaterThanOrEqual(
      t.eventsL1PlateauMin,
    )
    expect(ev, 'policyEvPerCard').not.toBeNull()
    expect(ev!).toBeGreaterThanOrEqual(band.evBand[0])
    expect(ev!).toBeLessThanOrEqual(band.evBand[1])
    expect(nd!).toBeGreaterThanOrEqual(band.nonDefaultShareMin)
  }, 180_000)

  it('the policy never ends its own run: no event game over on any seed', () => {
    for (const r of runs()) {
      expect(r.result.metrics.eventGameOvers, `seed ${r.seed}`).toBe(0)
    }
  }, 180_000)

  it('M13: the L1 plateau shows ≥ eventsL1PlateauMin decision cards on every seed (10/10)', () => {
    const min = data.economy.pacingTargets.eventsL1PlateauMin
    const short = runs()
      .filter((r) => r.result.metrics.eventsL1Decisions < min)
      .map((r) => `seed ${r.seed}: ${r.result.metrics.eventsL1Decisions}`)
    expect(short).toEqual([])
  }, 180_000)

  it(`M13: a run sees ≥ ${CATEGORIES_PER_RUN_MIN} deck categories (median, jobs left out) and never offers a once card twice`, () => {
    const per = runs().map((r) => deckCategories(r).length)
    console.log(
      `[events-policy] deck categories per run ${per.join(',')} (median ${median(per)}, target ≥ ${CATEGORIES_PER_RUN_MIN}); never seen: ${
        Object.keys(data.events.categories)
          .filter(
            (k) =>
              k !== 'job' &&
              runs().every((r) => !deckCategories(r).includes(k)),
          )
          .join(', ') || 'none'
      }`,
    )
    expect(median(per)!).toBeGreaterThanOrEqual(CATEGORIES_PER_RUN_MIN)
    const once = new Set(
      data.events.deck.filter((d) => d.once).map((d) => d.id),
    )
    for (const r of runs()) {
      const seen = new Map<string, number>()
      for (const e of r.events) {
        if (e.name !== 'event:offered' || !once.has(String(e.eventId))) continue
        seen.set(String(e.eventId), (seen.get(String(e.eventId)) ?? 0) + 1)
      }
      expect(
        [...seen].filter(([, n]) => n > 1),
        `seed ${r.seed}: once cards offered twice`,
      ).toEqual([])
    }
  }, 180_000)

  it('M13: the quest rows hold with the deck on (B3 §3.9 "kept"): questsOffered30 ≥ questsOfferedBy30MinMin, questsCompleted30 ≥ questsCompletedBy30MinMin by median', () => {
    const t = data.economy.pacingTargets
    const offered = runs().map((r) => r.result.metrics.questsOffered30)
    const completed = runs().map((r) => r.result.metrics.questsCompleted30)
    console.log(
      `[events-policy] quests offered by 30 min ${offered.join(',')} (median ${median(offered)}, target ≥ ${t.questsOfferedBy30MinMin}); completed ${completed.join(',')} (median ${median(completed)}, target ≥ ${t.questsCompletedBy30MinMin})`,
    )
    expect(median(offered)!).toBeGreaterThanOrEqual(t.questsOfferedBy30MinMin)
    expect(median(completed)!).toBeGreaterThanOrEqual(
      t.questsCompletedBy30MinMin,
    )
  }, 180_000)
})

describe('[long] the delegating rows with the deck on, seeds 1-10 × 30 min (informational; plan-build3 §8.4 task 4)', () => {
  let delegating: RunResult[] | null = null
  const dRuns = (): RunResult[] => {
    delegating ??= SEEDS.map((seed) =>
      runSeed(data, seed, 30, createPolicy, { kind: 'delegating' }),
    )
    return delegating
  }

  it('printed as `vlr sim:delegating` prints them; the runs keep the invariants, the slot never sticks, no event game over', () => {
    const summary = summarise(
      dRuns().map((r) => r.result),
      {
        dataHash: data.hash,
        config: null,
        policy: 'delegating',
        minutes: 30,
        targets: data.economy.pacingTargets,
        features: { ...SIM_FEATURES, events: true },
        eventPolicy: data.events.policy,
        deckEvMean: deckEvMean(data),
      },
    )
    for (const line of formatGate(summary)) console.log(`[delegating] ${line}`)
    for (const r of dRuns()) {
      const m = r.result.metrics
      expect(r.result.asserts, `seed ${r.seed}`).toEqual([])
      expect(r.conservation.ok, `seed ${r.seed}`).toBe(true)
      expect(m.eventsOpenMaxTicks, `seed ${r.seed}`).toBeLessThanOrEqual(
        data.economy.pacingTargets.eventsOpenMaxTicks,
      )
      expect(m.eventGameOvers, `seed ${r.seed}`).toBe(0)
      expect(
        m.sorterDecisions,
        `seed ${r.seed}: the sorter at work`,
      ).toBeGreaterThan(0)
    }
  }, 180_000)
})
