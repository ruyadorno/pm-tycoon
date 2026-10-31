// Build 3 M11 — stream isolation (M11 contract §4.4, D-1, D-2; spec-build3
// §2.3, §3.2; plan-build3 §8.2 acceptance): the decision draw is free for
// the main stream. Seeds 1–10 × 30 min under the competent policy, twice:
//
//   run a — SIM_FEATURES.events = false (pass 1: job cards only, blanks);
//   run b — SIM_FEATURES.events = true on a NO-OP deck (a structuredClone
//           of the shipped data with every option's effects = [] and its
//           cost / if deleted), so a decision card is drawn, offered and
//           decided, and changes nothing outside state.events.
//
// Every minute row: the same state.rng word (= the same number of main-
// stream draws), the same cadence word and next draw tick (D-1: a blank and
// a drawn card consume the same job roll and gap). At the end: the same
// quests.history template sequence and stats.levelTick, and run b offered
// decision cards. Run b twice on one seed gives one stateHash.
//
// Relative by design (run a vs run b, never a pinned level time): the
// thresholds and balance rows move under the pacing scans without touching
// this test. Tagged [long]: excluded from `vlr check:quick`, run by the full
// `vlr check`.

import { describe, expect, it } from 'vitest'
import type { GameData } from '../../src/data/types.ts'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { seedWord } from '../../src/sim/rng.ts'
import { Sim, stateHash } from '../../src/sim/sim.ts'
import { TICKS_PER_DAY } from '../../src/sim/types.ts'
import { dataFixture } from './helpers.ts'

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const MINUTES = 30
/** mulberry32 adds 0x6d2b79f5 per draw; this is its inverse mod 2^32. */
const STEP_INVERSE = 0xdc58aa5d

/** Main-stream draws since tick 0, read off the state word. */
function mainDraws(seed: number, word: number): number {
  return Math.imul((word - seedWord(seed)) >>> 0, STEP_INVERSE) >>> 0
}

/** The shipped tables with every option a no-op: no effects, no cost, no `if`. */
function noopDeck(data: GameData): GameData {
  const d = structuredClone(data)
  for (const def of d.events.deck) {
    for (const o of def.options ?? []) {
      o.effects = []
      delete o.cost
      delete o.if
    }
  }
  return d
}

interface MinuteSample {
  min: number
  tick: number
  rng: number
  draws: number
  cadence: number
  nextDrawTick: number
}

interface IsolationRun {
  rows: MinuteSample[]
  templates: string[]
  levelTick: Record<string, number>
  offered: number
  decisions: number
  blanks: number
  hash: string
  /** The final state minus state.events (the deck's own bookkeeping). */
  world: unknown
}

/** One competent run with the decision draw `events` on or off (the flag restored after). */
function isolationRun(
  data: GameData,
  seed: number,
  events: boolean,
): IsolationRun {
  const was = SIM_FEATURES.events
  SIM_FEATURES.events = events
  try {
    const sim = new Sim(data, seed)
    const policy = createPolicy(sim, 'competent')
    const rows: MinuteSample[] = []
    const total = MINUTES * TICKS_PER_DAY
    for (let i = 0; i < total; i++) {
      policy.step()
      sim.tick()
      const s = sim.state
      if (s.tick !== i + 1) throw new Error(`seed ${seed}: held at ${s.tick}`)
      if (s.tick % TICKS_PER_DAY === 0) {
        const row = s.stats.minutes.at(-1)
        rows.push({
          min: row?.min ?? -1,
          tick: s.tick,
          rng: s.rng,
          draws: mainDraws(seed, s.rng),
          cadence: s.events.rng,
          nextDrawTick: s.events.nextDrawTick,
        })
      }
    }
    policy.dispose?.()
    const s = sim.state
    const decisions = s.events.history.filter((h) => h.kind !== 'job').length
    const world: Record<string, unknown> = structuredClone(s) as never
    delete world.events
    return {
      rows,
      templates: s.quests.history.map((h) => h.templateId),
      levelTick: { ...s.stats.levelTick },
      offered: s.events.stats.offered,
      decisions,
      blanks: s.events.stats.blanks,
      hash: stateHash(s),
      world,
    }
  } finally {
    SIM_FEATURES.events = was
  }
}

describe('stream isolation', () => {
  it('[long] seeds 1–10 × 30 min, competent policy: events off vs events on with a no-op deck draw the main stream identically (every minute row), with the same job cadence, quests and level ticks', () => {
    const shipped = dataFixture()
    const noop = noopDeck(shipped)
    const flag = SIM_FEATURES.events
    const summary: string[] = []
    for (const seed of SEEDS) {
      const a = isolationRun(shipped, seed, false)
      const b = isolationRun(noop, seed, true)
      expect(SIM_FEATURES.events, 'flag restored').toBe(flag)
      expect(a.rows).toHaveLength(MINUTES)
      expect(b.rows).toHaveLength(MINUTES)
      for (let i = 0; i < MINUTES; i++) {
        const ra = a.rows[i]!
        const rb = b.rows[i]!
        const at = `seed ${seed} minute ${ra.min}`
        expect(rb.min, at).toBe(ra.min)
        expect(rb.draws, `${at}: main-stream draws`).toBe(ra.draws)
        expect(rb.rng, `${at}: state.rng`).toBe(ra.rng)
        expect(rb.cadence, `${at}: events.rng (cadence)`).toBe(ra.cadence)
        expect(rb.nextDrawTick, `${at}: nextDrawTick`).toBe(ra.nextDrawTick)
      }
      expect(b.templates, `seed ${seed}: quest templates`).toEqual(a.templates)
      expect(b.levelTick, `seed ${seed}: stats.levelTick`).toEqual(a.levelTick)
      // Run a draws no decision card; run b offers some, and every one of
      // them took the place of one of run a's blanks.
      expect(a.decisions, `seed ${seed}`).toBe(0)
      expect(b.offered, `seed ${seed}: decision cards offered`).toBeGreaterThan(
        a.offered,
      )
      expect(b.decisions, `seed ${seed}`).toBeGreaterThan(0)
      expect(b.offered - a.offered, `seed ${seed}`).toBe(a.blanks - b.blanks)
      // Nothing outside the deck's own state moved: the world is the same.
      expect(b.world, `seed ${seed}: the state outside state.events`).toEqual(
        a.world,
      )
      summary.push(
        `${seed}: ${a.rows.at(-1)!.draws} draws, ${a.templates.length} quests, decisions ${b.decisions}`,
      )
    }
    console.log(`[stream-isolation] ${summary.join(' · ')}`)
  }, 120_000)

  it('[long] run b is deterministic: two events-on runs on the no-op deck end on one stateHash', () => {
    const noop = noopDeck(dataFixture())
    const flag = SIM_FEATURES.events
    const first = isolationRun(noop, 3, true)
    const second = isolationRun(noop, 3, true)
    expect(SIM_FEATURES.events).toBe(flag)
    expect(first.decisions).toBeGreaterThan(0)
    expect(second.hash).toBe(first.hash)
    expect(second.rows).toEqual(first.rows)
  }, 60_000)
})
