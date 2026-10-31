// spec-build3 §3.8-§3.9; plan-build3 §8.2 task 8; M11 contract §3 stream D
// task 8: the event policy on the seed deck with SIM_FEATURES.events on,
// seeds 1-10 × 30 min through the CLI's runSeed (the gate's own runs) —
// no card stays open past the step after the tick that offered it
// (eventsOpenMaxTicks ≤ 1 on every seed), the policy decides every card it
// is offered (every event:offered has its event:decided, none withdrawn
// but a job card the Golden Release displaced), every job card is
// accepted, and the run keeps its invariants. The EV band and the
// non-default share are printed (informational until M12 flips the flag
// and the full deck lands); so are the cards per category and the event
// rows. Tagged [long]: excluded from `vlr check:quick` (tools/check.mjs),
// run by the full `vlr check`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { TICKS_PER_DAY } from '../../src/sim/types.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import { categoryTallies, median } from '../../tools/sim/report.ts'
import { dataFixture } from './helpers.ts'

const data = dataFixture()
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
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

describe('[long] the event policy on the seed deck, seeds 1-10 × 30 min (events on)', () => {
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

  it('informational: the policy EV per card and the non-default share against events.json policy, the cards by category and the event rows — printed, never fails', () => {
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
  }, 180_000)

  it('the policy never ends its own run: no event game over on any seed', () => {
    for (const r of runs()) {
      expect(r.result.metrics.eventGameOvers, `seed ${r.seed}`).toBe(0)
    }
  }, 180_000)
})
