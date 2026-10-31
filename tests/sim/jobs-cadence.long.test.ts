// Build 3 M11 — the job cadence on the new scheduler (spec-build3 §2.3, §3.2;
// plan-build3 §8.2 task 8 "questsOfferedBy30MinMin ≥ 4 on seeds 1–10 under
// the new scheduler with decisions off"; critique 28: the gate's median).
// Pass 1 runs with the decision deck off (SIM_FEATURES.events false): job
// cards keep coming at the deck's draws (first at 200 s, jobShare per draw
// while a job is eligible, the job cooldown after each quest), and the
// competent policy accepts them on the step after they open.
//
// Tagged [long]: excluded from `vlr check:quick`, run by the full `vlr check`.

import { describe, expect, it } from 'vitest'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import { dataFixture } from './helpers.ts'

const data = dataFixture()
const targets = data.economy.pacingTargets
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const median = (xs: readonly number[]): number => {
  const s = xs.toSorted((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

describe('job cards with decisions off (B3 §2.3 pass 1) [long]', () => {
  it('questsOfferedBy30MinMin: the median of seeds 1–10 × 30 min reaches the window; every job card is decided on the step after it opens', () => {
    const was = SIM_FEATURES.events
    SIM_FEATURES.events = false
    try {
      const offered: number[] = []
      const completed: number[] = []
      for (const seed of SEEDS) {
        const run = runSeed(data, seed, 30, createPolicy)
        const m = run.result.metrics
        offered.push(m.questsOffered30)
        completed.push(m.questsCompleted30)
        const cards = run.events.filter((e) => e.name === 'event:offered')
        const closed = run.events.filter(
          (e) => e.name === 'event:decided' || e.name === 'event:withdrawn',
        )
        // Decisions off: only job cards (and the rescue, never under the policy).
        for (const c of cards) expect(c.kind, `seed ${seed}`).toBe('job')
        expect(closed.length, `seed ${seed}`).toBeGreaterThanOrEqual(
          cards.length - 1,
        )
        for (const [i, c] of closed.entries()) {
          expect(c.tick, `seed ${seed} card ${i}`).toBe(cards[i]!.tick)
        }
      }
      console.log(
        `[jobs] offered by 30 min: ${offered.join(' ')} (median ${median(offered)}); completed: ${completed.join(' ')} (median ${median(completed)})`,
      )
      expect(median(offered)).toBeGreaterThanOrEqual(
        targets.questsOfferedBy30MinMin,
      )
    } finally {
      SIM_FEATURES.events = was
    }
  }, 180_000)
})
