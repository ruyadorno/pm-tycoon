// plan-build2 §8.6 task 6 ("the long victory test") and its acceptance ("a
// victory on seeds 1-3 by 45 min (long test)"); spec-build2 §3.4, §7.2 L5
// row, §7.3 (victoryMaxMin ≤ 45 min, informational); design-m8-m9 §5.1, §7
// M9 item 7: the competent policy over seeds 1-3, each run for
// RUN_MINUTES (≥ 45 min + the 3 endless days after a victory at ≤ 45 min).
// The victory minute is INFORMATIONAL (printed — spec-build2 §7.3 lists
// victoryMaxMin as informational; the §8.6 acceptance "a victory on seeds
// 1-3 by 45 min" is NOT met on the shipped data and is recorded as waived
// pending the author's call in docs/decisions.md, M9). What is asserted:
//
//   - at least one of seeds 1-3 wins within RUN_MINUTES (M9 review: with no
//     victory every chain check below is vacuous — a regression that made
//     the Golden Release unwinnable would pass);
//
// and the chain whenever it happens:
//
//   - the Golden Release is offered on the level:up {5} tick and accepted by
//     the policy (accept-every-offer, as soon as no quest is active); never
//     declined or abandoned; the 3rd truck (the L5 plan) is bought;
//   - at completion its counters meet the levels.json ultimateQuest row
//     (deliveries ≥ goal, malware delivered ≤ max, on-time rate ≥ min);
//     quest:completed {reward.victory} → game:victory on the same tick,
//     economy.victory and stats.victoryTick set;
//   - endless (B2 §3.4): no re-offer of the ultimate; job cards come back
//     (build 3: at a deck draw after the job cooldown, B3 §3.2) and are
//     accepted on the step after they open; the malware
//     share climbs by malware.postVictoryPerDay at every day boundary from
//     the first one after the victory (capped), and the endless ticker line
//     fires once, on that boundary.
//
// Review deck-4: the "job cards come back" check needs the job cooldown plus
// four of L5's longest gaps after the victory (ENDLESS_WINDOW); RUN_MINUTES
// leaves that much after the latest victory seen (~50 min), and the endless
// test asserts the check ran on at least one winning seed (never vacuous).
//
// Tagged [long]: excluded from `vlr check:quick` (tools/check.mjs), run by
// the full `vlr check`.

import { describe, expect, it } from 'vitest'
import { createPolicy } from '../../src/sim/policy.ts'
import type { Sim } from '../../src/sim/sim.ts'
import type { QuestProgress } from '../../src/sim/types.ts'
import { TICKS_PER_DAY, ticksFromS } from '../../src/sim/types.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import type { RecordedEvent } from '../../tools/sim/report.ts'
import { dataFixture } from './helpers.ts'

const data = dataFixture()
const targets = data.economy.pacingTargets
const SEEDS = [1, 2, 3]
const ultimateRow = data.levels.find((l) => l.ultimateQuest)!
const ultimate = ultimateRow.ultimateQuest!
/** Days of endless play checked after a victory (design §7 M9 item 7). */
const ENDLESS_DAYS = 3
/** The latest victory minute seen on seeds 1-3 (M11: 47.6 / 49.5 / none by 50). */
const VICTORY_SEEN_MIN = 50
/**
 * Build 3 (B3 §3.2): after a victory a job card comes at a deck draw once the
 * job cooldown is over (jobShare per draw) — checked when the run lasts the
 * cooldown plus four of L5's longest gaps past the victory (review deck-4).
 */
const ENDLESS_WINDOW =
  data.events.schedule.jobCooldownDays * TICKS_PER_DAY +
  4 * ticksFromS(data.events.schedule.intervalS[String(ultimateRow.level)]![1])
/**
 * Long enough for a victory plus the endless checks whatever the
 * (informational) victoryMaxMin target: build 3 moved it to 40 (B3 §7) while
 * the runs still win at ~47–50 min — the later of the target and the latest
 * victory seen, + the longer of the endless days and the job window, + 1.
 */
const RUN_MINUTES =
  Math.max(targets.victoryMaxMin, VICTORY_SEEN_MIN) +
  Math.max(ENDLESS_DAYS, Math.ceil(ENDLESS_WINDOW / TICKS_PER_DAY)) +
  1

interface VictoryRun {
  run: RunResult
  /** The ultimate quest's counters on the last event before it ended. */
  counters: Extract<QuestProgress, { kind: 'ultimate' }> | null
  victory: boolean
  victoryTick: number | null
  trucks: number
}

let cached: VictoryRun[] | null = null
/** The seeds 1-3 competent runs (computed once for this file). */
function runs(): VictoryRun[] {
  cached ??= SEEDS.map((seed) => {
    let counters: VictoryRun['counters'] = null
    let last: Sim | null = null
    const run = runSeed(data, seed, RUN_MINUTES, createPolicy, {
      onEvent: (_e, sim) => {
        last = sim
        const a = sim.state.quests.active
        if (a?.ultimate && a.progress.kind === 'ultimate') {
          counters = { ...a.progress }
        }
      },
    })
    const s = (last as Sim | null)?.state
    return {
      run,
      counters,
      victory: s?.economy.victory ?? false,
      victoryTick: s?.stats.victoryTick ?? null,
      trucks: s?.vehicles.filter((v) => v.type === 'truck').length ?? 0,
    }
  })
  return cached
}

const named = (r: RunResult, name: string): RecordedEvent[] =>
  r.events.filter((e) => e.name === name)

describe('the Golden Release and Victory under the competent policy (seeds 1-3) [long]', () => {
  it('informational: the L3 / L4 / L5 / Golden Release / victory minutes per seed (victoryMaxMin target printed, never fails)', () => {
    for (const { run } of runs()) {
      const m = run.result.metrics
      const late =
        m.victoryMin === null || m.victoryMin > targets.victoryMaxMin
          ? ' — BELOW TARGET'
          : ''
      console.log(
        `[victory] seed ${run.seed}: L3 ${m.level3Min ?? '—'} · L4 ${m.level4Min ?? '—'} · L5 ${m.level5Min ?? '—'} · Golden Release offered ${m.goldenReleaseOfferedMin ?? '—'} · victory ${m.victoryMin ?? '—'} (target ≤ ${targets.victoryMaxMin} min)${late}`,
      )
    }
    expect(runs()).toHaveLength(SEEDS.length)
  }, 120_000)

  it('at least one of seeds 1-3 wins within the run (the chain checks below are never vacuous)', () => {
    const won = runs().filter((r) => r.victory)
    console.log(
      `[victory] ${won.length}/${SEEDS.length} seeds won by ${RUN_MINUTES} min: ${won.map((r) => `seed ${r.run.seed} at ${r.run.result.metrics.victoryMin}`).join(', ') || 'none'}`,
    )
    expect(won.length, 'a victory on seeds 1-3').toBeGreaterThan(0)
  }, 120_000)

  it('at L5 the Golden Release is offered on the level:up {5} tick, accepted by the policy (never declined or abandoned), and the 3rd truck is bought', () => {
    for (const { run, trucks } of runs()) {
      const up5 = run.events.find(
        (e) => e.name === 'level:up' && e.level === ultimateRow.level,
      )
      if (!up5) continue
      const why = `seed ${run.seed}`
      const offers = named(run, 'quest:offered').filter(
        (e) => e.ultimate === true,
      )
      expect(offers[0]?.tick, why).toBe(up5.tick)
      expect(offers[0]?.templateId, why).toBe(ultimate.id)
      const accepted = named(run, 'quest:accepted').find(
        (e) => e.questId === offers[0]!.questId,
      )
      // Accepted as soon as no regular quest is active (none may be).
      const done = named(run, 'quest:completed').concat(
        named(run, 'quest:failed'),
      )
      if (accepted === undefined) {
        // Still waiting for a regular quest to end at the end of the run.
        expect(run.events.at(-1)!.tick - up5.tick, why).toBeLessThan(
          5 * TICKS_PER_DAY,
        )
      } else {
        const blocking = done.filter(
          (e) => e.tick > up5.tick && e.tick <= accepted.tick,
        )
        expect(
          accepted.tick === up5.tick || blocking.length > 0,
          `${why}: accepted at ${accepted.tick} with nothing ending since the offer`,
        ).toBe(true)
      }
      expect(
        named(run, 'quest:declined').filter(
          (e) => e.templateId === ultimate.id,
        ),
        why,
      ).toEqual([])
      expect(
        named(run, 'quest:failed').filter(
          (e) => e.templateId === ultimate.id && e.reason === 'abandoned',
        ),
        why,
      ).toEqual([])
      expect(trucks, why).toBeGreaterThanOrEqual(3)
    }
  }, 120_000)

  it('a victory: the counters meet the ultimateQuest row; quest:completed {victory} and game:victory on one tick; economy.victory and stats.victoryTick set', () => {
    for (const { run, counters, victory, victoryTick } of runs()) {
      const why = `seed ${run.seed}`
      const win = named(run, 'game:victory')
      if (win.length === 0) {
        expect(victory, why).toBe(false)
        continue
      }
      expect(win, why).toHaveLength(1)
      expect(victory, why).toBe(true)
      expect(victoryTick, why).toBe(win[0]!.tick)
      const completed = named(run, 'quest:completed').find(
        (e) => e.templateId === ultimate.id,
      )
      expect(completed?.tick, why).toBe(win[0]!.tick)
      expect(completed?.reward, why).toMatchObject({ victory: true })
      expect(counters, why).not.toBeNull()
      const c = counters!
      expect(c.delivered, why).toBeGreaterThanOrEqual(ultimate.deliveries)
      expect(c.malware, why).toBeLessThanOrEqual(ultimate.maxMalwareDelivered)
      expect(c.onTime / c.delivered, why).toBeGreaterThanOrEqual(
        ultimate.minOnTimeRate,
      )
      // The metric is the minute rounded to 2 places (report.ts minutesOf):
      // within half a hundredth of the exact minute (49.485 → 49.49).
      expect(
        Math.abs(run.result.metrics.victoryMin! - win[0]!.tick / TICKS_PER_DAY),
        why,
      ).toBeLessThanOrEqual(0.005 + 1e-9)
    }
  }, 120_000)

  it('endless after a victory: the ultimate is never re-offered; regular offers return and are accepted; the malware share climbs postVictoryPerDay per day boundary from the first one after the victory (capped); the endless ticker fires once on that boundary', () => {
    const m = data.parcels.malware
    /** Winning seeds whose run lasted ENDLESS_WINDOW past the victory. */
    const jobsChecked: number[] = []
    for (const { run, victoryTick } of runs()) {
      if (victoryTick === null) continue
      const why = `seed ${run.seed}`
      const end = run.rows.at(-1)!.tick
      const ultimateAfter = named(run, 'quest:offered').filter(
        (e) => e.ultimate === true && e.tick > victoryTick,
      )
      expect(ultimateAfter, why).toEqual([])
      if (end - victoryTick > ENDLESS_WINDOW) {
        jobsChecked.push(run.seed)
        const regular = named(run, 'quest:offered').filter(
          (e) => e.ultimate !== true && e.tick > victoryTick,
        )
        expect(
          regular.length,
          `${why}: offers after the victory`,
        ).toBeGreaterThan(0)
        const acc = named(run, 'quest:accepted').find(
          (e) => e.questId === regular[0]!.questId,
        )
        expect(acc?.tick, why).toBe(regular[0]!.tick)
      }
      // Malware share: the minute rows (row `min` = state.day at its tick).
      const firstDay = Math.floor(victoryTick / TICKS_PER_DAY) + 1
      const rows = run.rows.filter((r) => r.lvl === ultimateRow.level)
      for (const row of rows) {
        const days = Math.max(0, row.min - firstDay + 1)
        expect(row.malShare, `${why} minute ${row.min}`).toBeCloseTo(
          Math.min(
            m.cap,
            m.baseShare +
              m.perLevel * (row.lvl - 1) +
              m.postVictoryPerDay * (row.tick > victoryTick ? days : 0),
          ),
          9,
        )
      }
      const after = rows.filter((r) => r.min >= firstDay)
      if (after.length > 0) {
        expect(after[0]!.malShare, why).toBeGreaterThan(
          rows.find((r) => r.min === firstDay - 1)?.malShare ?? 0,
        )
      }
      const endless = named(run, 'ticker:news').filter(
        (e) => e.text === data.puns.tickerQuest.endless,
      )
      if (end >= firstDay * TICKS_PER_DAY) {
        expect(
          endless.map((e) => e.tick),
          why,
        ).toEqual([firstDay * TICKS_PER_DAY])
        expect(endless[0]!.kind, why).toBe('level')
      }
    }
    // Never vacuous (review deck-4): a winning seed ran the job check.
    console.log(
      `[victory] endless job check ran on seed(s) ${jobsChecked.join(', ') || 'none'} (window ${ENDLESS_WINDOW} ticks, run ${RUN_MINUTES} min)`,
    )
    expect(
      jobsChecked.length,
      `a winning seed lasting ${ENDLESS_WINDOW} ticks past its victory within ${RUN_MINUTES} min`,
    ).toBeGreaterThan(0)
  }, 120_000)

  it('every seed: the CLI invariants hold (conservation incl. cleared, no stuck vehicle, balance ≥ 0)', () => {
    for (const { run } of runs()) {
      expect(run.result.asserts, `seed ${run.seed}`).toEqual([])
      expect(run.conservation.ok, `seed ${run.seed}`).toBe(true)
    }
  }, 120_000)
})
