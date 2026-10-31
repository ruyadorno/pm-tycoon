// Build 3 M11 — the event deck in whole runs (M11 contract §4.4; spec-build3
// §3.6, §6; plan-build3 §8.2 task 4, risk R31):
//
//   - machineP in a policy-played mid-game lane (desks, several machines,
//     several strains): the ViewSim detection, laneStats, lane.catchRate,
//     the laneRateAtLeast condition and the machines' rolls all read one
//     number — the build-2 rate with +add on every machine p, clamped and
//     rounded as data says — recomputed here independently;
//   - a deck-on run played by the competent policy with decision cards on
//     replays from seed + data + command log to the live run's hash;
//   - a deck-on run with no policy holds at its first card (no tick, no
//     draw) until answerCards decides it, and the answered run replays.
//
// Relative by design: no level time, price or threshold is pinned (the
// pacing scans move the balance tables under this test).

import { describe, expect, it } from 'vitest'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import {
  checkerP,
  compound,
  announcedStrains,
} from '../../src/sim/detection.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import type { Sim } from '../../src/sim/sim.ts'
import { replay, stateHash } from '../../src/sim/sim.ts'
import { condHolds } from '../../src/sim/systems/deck.ts'
import { applyEffect } from '../../src/sim/systems/effects.ts'
import type { Checker, Strain } from '../../src/sim/types.ts'
import {
  laneNode,
  liveSlotIds,
  TICKS_PER_DAY,
  ticksFromS,
} from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  answerCards,
  deckOn,
  laneParcel,
  makeSim,
  openingA,
  replayOf,
  runTicks,
} from './helpers.ts'

const ADD = 0.05

/** Run `fn` with SIM_FEATURES.events = `on`, restoring the flag after. */
function withEvents<T>(on: boolean, fn: () => T): T {
  const was = SIM_FEATURES.events
  SIM_FEATURES.events = on
  try {
    return fn()
  } finally {
    SIM_FEATURES.events = was
  }
}

/** `minutes` of the competent policy on a fresh deck-on sim (returns the still-attached policy). */
function played(
  seed: number,
  minutes: number,
): { sim: Sim; policy: ReturnType<typeof createPolicy> } {
  const sim = deckOn(makeSim(seed))
  const policy = createPolicy(sim, 'competent')
  for (let i = 0; i < minutes * TICKS_PER_DAY; i++) {
    policy.step()
    sim.tick()
  }
  return { sim, policy }
}

const round4 = (p: number): number => Math.round(p * 1e4) / 1e4

/**
 * The p a checker rolls with under `add` machineP, recomputed from the
 * stored checker and the data clamp (not through effChecker): machines
 * clamp(p + add) to 4 dp, desks unchanged.
 */
function moddedP(sim: Sim, c: Checker, strain: Strain, add: number): number {
  const raw = checkerP(c, strain)
  if (c.kind !== 'machine') return raw
  const [lo, hi] = sim.data.events.modifiers.machinePClamp
  return round4(Math.min(hi, Math.max(lo, raw + add)))
}

/** The lane's catch rate vs `strain` under `add`: live slots with ≥ 1 station, compounded. */
function expectedRate(sim: Sim, strain: Strain, add: number): number {
  const lane = sim.state.lane
  const ps: number[] = []
  for (const id of liveSlotIds(lane)) {
    const n = laneNode(lane, id)
    if (!n?.fixture || n.stations.length === 0) continue
    ps.push(moddedP(sim, n.fixture.checker, strain, add))
  }
  return compound(ps)
}

describe('machineP in a played lane: one number for the readouts, the condition and the roll (R31)', () => {
  it('a mid-game lane under +0.05 machineP: detection / laneStats / catchRate / laneRateAtLeast equal the recomputed rate, and every machine roll draws the modded p', () => {
    withEvents(false, () => {
      const { sim, policy } = played(2, 20)
      const s = sim.state
      const strains = announcedStrains(s, sim.data)
      const machines = s.lane.nodes.filter(
        (n) => n.fixture?.kind === 'machine' && n.stations.length > 0,
      )
      expect(strains.length).toBeGreaterThanOrEqual(2)
      expect(machines.length).toBeGreaterThanOrEqual(2)
      const before = strains.map((x) => expectedRate(sim, x, 0))
      applyEffect(
        sim,
        {
          eventId: 'ev_integration',
          title: 'Firmware update',
          optionLabel: 'OK',
          optionIndex: 0,
          target: null,
          pick: null,
          chainHeadId: 'ev_integration',
          depth: 1,
        },
        { kind: 'mod', key: 'machineP', add: ADD, days: 1 },
      )
      expect(s.modifiers.map((m) => m.key)).toEqual(['machineP'])
      const applied = s.tick
      const until = s.modifiers[0]!.untilTick!
      const vs = createViewSim(sim)
      const refs = { target: null, pick: null }

      /** Every reader against the recomputed rate under `add`. */
      const agree = (add: number): void => {
        const det = vs.lane.detection()
        const stats = vs.laneStats()
        expect(det.map((d) => d.strain)).toEqual(
          announcedStrains(sim.state, sim.data),
        )
        const rates = det.map((d) => {
          const want = expectedRate(sim, d.strain, add)
          expect(d.d, `${d.strain} @${sim.state.tick}`).toBeCloseTo(want, 12)
          expect(vs.lane.catchRate(d.strain)).toBe(d.d)
          return d.d
        })
        expect(stats.byStrain.map((x) => x.pct)).toEqual(
          rates.map((r) => Math.round(100 * r)),
        )
        const mean = rates.reduce((a, b) => a + b, 0) / rates.length
        expect(stats.detectionPct).toBe(Math.round(100 * mean))
        const min = Math.min(...rates)
        expect(condHolds(sim, { laneRateAtLeast: min }, refs)).toBe(true)
        expect(condHolds(sim, { laneRateAtLeast: min + 1e-9 }, refs)).toBe(
          false,
        )
      }

      agree(ADD)
      // The modifier moved the numbers (some machine p was below the clamp).
      const after = strains.map((x) => vs.lane.catchRate(x))
      expect(after.some((r, i) => r > before[i]! + 1e-9)).toBe(true)
      after.forEach((r, i) => expect(r).toBeGreaterThanOrEqual(before[i]!))

      // The roll: every machine trace entry on a malware parcel made while
      // the row is live carries the modded p (the parcel's §10 lane rate).
      // Besides the run's own malware, a malware parcel of each announced
      // strain in turn is put into every machine's slot buffer with room,
      // every 30 ticks, so each machine rolls under the row.
      const rolled = new Map<string, number>()
      let checks = 0
      let k = 0
      while (sim.state.tick < until) {
        policy.step()
        if (sim.state.tick % 30 === 0) {
          for (const n of machines) {
            if (n.queue.length >= (n.cap ?? 0)) continue
            const strain = strains[k++ % strains.length]!
            laneParcel(sim, n.id, { malware: true, strain })
          }
        }
        sim.tick()
        if (sim.state.tick % 100 === 0 && sim.state.tick < until) agree(ADD)
        for (const p of Object.values(sim.state.parcels)) {
          if (!p.malware || p.strain === null) continue
          for (const t of p.trace) {
            if (t.chk === undefined || t.p === undefined) continue
            if (t.tick <= applied || t.tick >= until) continue
            const key = `${p.id}:${t.chk}`
            if (rolled.has(key)) continue
            rolled.set(key, t.p)
            const node = sim.state.lane.nodes.find(
              (n) => n.fixture?.checker.id === t.chk,
            )
            if (node?.fixture?.kind !== 'machine') continue
            expect(t.p, `${key} (${p.strain})`).toBe(
              moddedP(sim, node.fixture.checker, p.strain, ADD),
            )
            checks += 1
          }
        }
      }
      expect(checks).toBeGreaterThanOrEqual(machines.length)
      for (const n of machines) {
        const id = n.fixture!.checker.id
        expect(
          [...rolled.keys()].some((key) => key.endsWith(`:${id}`)),
          `${n.id} rolled`,
        ).toBe(true)
      }
      // Expired: back to the build-2 numbers everywhere.
      runTicks(sim, 1)
      expect(sim.state.modifiers).toEqual([])
      agree(0)
      policy.dispose?.()
    })
  }, 30_000)
})

describe('a deck-on run replays (B3 §6: decisions are logged commands)', () => {
  it('the competent policy with decision cards on, 3 seeds × 15 min: seed + data + command log replay to the live hash', () => {
    withEvents(true, () => {
      for (const seed of [1, 4, 7]) {
        const { sim, policy } = played(seed, 15)
        policy.dispose?.()
        const ev = sim.state.events
        const decisions = ev.history.filter((h) => h.kind !== 'job')
        expect(decisions.length, `seed ${seed}`).toBeGreaterThan(0)
        expect(
          sim.commandLog.filter((e) => e.cmd.kind === 'decideEvent').length,
          `seed ${seed}`,
        ).toBeGreaterThanOrEqual(decisions.length)
        const again = replayOf(sim)
        expect(again.state.tick, `seed ${seed}`).toBe(sim.state.tick)
        expect(again.state.events.history, `seed ${seed}`).toEqual(ev.history)
        expect(stateHash(again.state), `seed ${seed}`).toBe(
          stateHash(sim.state),
        )
        // A mid-run cut replays to the live run's state at that tick too.
        const cut = 9 * TICKS_PER_DAY
        const mid = replayOf(sim, cut)
        expect(mid.state.tick, `seed ${seed}`).toBe(cut)
        expect(mid.state.stats.minutes.at(-1), `seed ${seed}`).toEqual(
          sim.state.stats.minutes[8],
        )
      }
    })
  }, 30_000)
})

describe('no policy: the hold at the first card (B3 §6, D-8)', () => {
  it('a deck-on run with no policy stops at its first card (firstEventS): tick, revision and every rng word stand still; answerCards releases it, and the answered run replays', () => {
    withEvents(true, () => {
      const sim = deckOn(makeSim(5))
      openingA(sim, 'pool') // a bike: no rescue in play
      const first = ticksFromS(sim.data.events.schedule.firstEventS)
      let guard = 0
      while (sim.state.events.open === null && guard++ < 10 * TICKS_PER_DAY)
        sim.tick()
      const open = sim.state.events.open
      expect(open).not.toBeNull()
      expect(sim.state.tick).toBe(first)
      expect(open!.openedTick).toBe(first)
      expect(sim.held).toBe(true)
      const words = (): number[] => [
        sim.state.rng,
        sim.state.events.rng,
        sim.state.events.picks.rng,
        sim.state.quests.rng,
        sim.state.applicants.rng,
      ]
      const before = {
        tick: sim.state.tick,
        revision: sim.revision,
        words: words(),
        hash: stateHash(sim.state),
      }
      runTicks(sim, 3 * TICKS_PER_DAY)
      expect(sim.state.tick).toBe(before.tick)
      expect(sim.revision).toBe(before.revision)
      expect(words()).toEqual(before.words)
      expect(stateHash(sim.state)).toBe(before.hash)
      // Replay of the unanswered log stops at the same card.
      const stuck = replay(sim.data, 5, sim.commandLog, first + TICKS_PER_DAY)
      expect(stuck.state.tick).toBe(first)
      expect(stuck.state.events.open).toEqual(open)

      expect(answerCards(sim, 'default')).toBe(1)
      expect(sim.state.events.open).toBeNull()
      expect(sim.held).toBe(false)
      sim.tick()
      expect(sim.state.tick).toBe(first + 1)
      // Keep playing for a few days, answering every card as it holds.
      let answered = 1
      const end = first + 5 * TICKS_PER_DAY
      while (sim.state.tick < end) {
        if (sim.held) answered += answerCards(sim, 'default')
        const t = sim.state.tick
        sim.tick()
        expect(sim.state.tick).toBe(t + 1)
      }
      expect(answered).toBeGreaterThan(1)
      expect(sim.state.events.stats.decided).toBe(answered)
      const again = replayOf(sim)
      expect(again.state.tick).toBe(sim.state.tick)
      expect(stateHash(again.state)).toBe(stateHash(sim.state))
    })
  }, 30_000)
})
