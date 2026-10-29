// spec §7 / plan.md §6.9.1-§6.9.2, §12.5 task 7: the scripted competent
// policy (opening A, bikes at price + $50 until 3, Toss every flag on the tick
// it is held; the truck / shaker / inspector rules wait for M3) drives the
// playtest-1 gate: the scripted malware flagged by the first checker and
// tossed on every seed, no life lost and no shelf stall (medians), the Hold
// Bay a loop and not a rarity (≥ holdBayEventsPer10MinMin at L1), first
// delivery < 60 s, the conservation identity every 600 ticks. Tagged `gate`:
// excluded from `vlr check:quick`, run by the full `vlr check`.

import { describe, expect, it } from 'vitest'
import { FEATURE_MILESTONE, SIM_FEATURES } from '../../src/sim/features.ts'
import { POLICY_PARAMS, createPolicy } from '../../src/sim/policy.ts'
import { conservation, formatConservation } from '../../src/sim/sim.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import { median, summarise } from '../../tools/sim/report.ts'
import { dataFixture, makeSim, runTicks } from './helpers.ts'

const data = dataFixture()
const targets = data.economy.pacingTargets
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

let gateRuns: RunResult[] | null = null
/** The 10-seed × 30-min policy runs (computed once for this file). */
function runs(): RunResult[] {
  gateRuns ??= SEEDS.map((seed) => runSeed(data, seed, 30, createPolicy))
  return gateRuns
}

describe('competent policy (spec §7) [gate]', () => {
  it('opening A at t = 0: a bike + a Metal detector, $100 left; then bikes at price + $50 until 3', () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'competent')
    policy.step()
    expect(sim.commandLog.map((e) => e.cmd)).toEqual([
      { kind: 'buyVehicle', type: 'bike' },
      { kind: 'buyMachine', defId: 'metal_detector', nodeId: 'slot2' },
    ])
    expect(sim.state.economy.balance).toBe(100)
    for (let i = 0; i < 18000; i++) {
      const before = sim.state.vehicles.length
      const balance = sim.state.economy.balance
      policy.step()
      if (sim.state.vehicles.length > before) {
        expect(balance).toBeGreaterThanOrEqual(
          200 + POLICY_PARAMS.purchaseBuffer,
        )
      }
      sim.tick()
    }
    expect(sim.state.vehicles.map((v) => v.type)).toEqual([
      'bike',
      'bike',
      'bike',
    ])
    expect(sim.state.vehicles.every((v) => v.zone === 'any')).toBe(true)
  }, 30_000)

  it('first delivery < 60 s by median on seeds 1-10 (every seed delivers in the first minute and a half)', () => {
    const firsts = runs().map((r) => r.result.metrics.firstDeliveryS)
    for (const [i, s] of firsts.entries()) {
      expect(s, `seed ${SEEDS[i]}`).not.toBeNull()
      expect(s!, `seed ${SEEDS[i]}`).toBeLessThan(90)
    }
    expect(median(firsts)!).toBeLessThan(targets.firstDeliveryS)
  }, 60_000)

  it('the scripted malware is flagged by the first checker and tossed by the policy on every seed 1-10; flag time median ≤ firstMalwareCaughtMaxS', () => {
    const flagTimes: number[] = []
    for (const r of runs()) {
      const flag = r.events.find(
        (e) => e.name === 'parcel:flagged' && e.scripted === true,
      )
      expect(flag, `seed ${r.seed}`).toBeDefined()
      expect(flag!.nodeId, `seed ${r.seed}`).toBe('slot1') // opening A: the desk
      const toss = r.events.find(
        (e) => e.name === 'parcel:tossed' && e.id === flag!.id,
      )
      expect(toss, `seed ${r.seed}`).toMatchObject({
        wasMalware: true,
        tick: flag!.tick,
      })
      flagTimes.push(flag!.tick / 10)
      expect(
        r.result.metrics.firstMalwareCaughtS,
        `seed ${r.seed}`,
      ).toBeLessThanOrEqual(flag!.tick / 10)
    }
    expect(median(flagTimes)!).toBeLessThanOrEqual(
      targets.firstMalwareCaughtMaxS,
    )
  }, 60_000)

  it('no life lost and no shelf stall in 30 min under Toss-everything (medians; no seed ever stalls on the shelf)', () => {
    const r = runs().map((x) => x.result.metrics)
    expect(median(r.map((m) => m.livesLost))!).toBeLessThanOrEqual(
      targets.maxLivesLost,
    )
    for (const m of r) {
      expect(m.shelfStallS, `seed ${m.seed}`).toBeLessThanOrEqual(
        targets.maxShelfStallS,
      )
    }
  }, 60_000)

  it('the Hold Bay is a loop, not a rarity: holdBayEventsPer10Min at L1 ≥ holdBayEventsPer10MinMin by median', () => {
    const d = runs().map((x) => x.result.metrics.holdBayEventsPer10MinL1)
    expect(median(d)!).toBeGreaterThanOrEqual(targets.holdBayEventsPer10MinMin)
  }, 60_000)

  it('the policy Tosses every flag on the tick it is held; nothing waits in the Hold Bay', () => {
    const r = runs()[2]!
    const held = r.events.filter((e) => e.name === 'parcel:held')
    expect(held.length).toBeGreaterThan(5)
    for (const h of held) {
      const t = r.events.find(
        (e) => e.name === 'parcel:tossed' && e.id === h.id,
      )
      expect(t?.tick, `parcel ${String(h.id)}`).toBe(h.tick)
    }
    expect(r.rows.every((row) => row.held === 0)).toBe(true)
  }, 60_000)

  it('the M2 gate passes on seeds 1-10 × 30 min: the lane and lives windows gated, the level windows informational until M3', () => {
    const g = summarise(
      runs().map((r) => r.result),
      {
        dataHash: data.hash,
        config: null,
        policy: 'competent',
        minutes: 30,
        targets,
      },
    )
    expect(g.pass).toBe(true)
    const gated = g.checks.filter((c) => c.note === null).map((c) => c.key)
    expect(gated).toEqual(
      expect.arrayContaining([
        'firstDeliveryS',
        'firstMalwareCaughtMaxS',
        'maxLivesLost',
        'maxShelfStallS',
        'holdBayEventsPer10MinMin',
      ]),
    )
    expect(SIM_FEATURES.lane && SIM_FEATURES.lives).toBe(true)
    if (!SIM_FEATURES.levels) {
      expect(g.checks.find((c) => c.key === 'level2Min')?.note).toBe(
        `informational (${FEATURE_MILESTONE.levels})`,
      )
    }
  }, 60_000)

  it('30-minute seed-1 run: no NaN, no negative balance, no deadlocked vehicle; conservation holds every 600 ticks', () => {
    let checked = 0
    const run = runSeed(data, 1, 30, createPolicy, {
      onRow: (_row, sim) => {
        const c = conservation(sim.state)
        expect(c.ok, formatConservation(c)).toBe(true)
        checked += 1
      },
    })
    expect(checked).toBe(30)
    expect(run.result.asserts).toEqual([])
    expect(run.conservation.ok).toBe(true)
    expect(run.rows).toHaveLength(30)
    for (const r of run.rows) {
      expect(Number.isFinite(r.money) && r.money >= 0).toBe(true)
      expect(Number.isFinite(r.sat)).toBe(true)
    }
    expect(run.rows.at(-1)!.deliv).toBeGreaterThan(150)
  }, 30_000)

  it('every seed: the CLI invariants (conservation every 600 ticks, no stuck vehicle) hold', () => {
    for (const r of runs()) {
      expect(r.result.asserts, `seed ${r.seed}`).toEqual([])
      expect(r.conservation.ok, `seed ${r.seed}`).toBe(true)
    }
  }, 60_000)

  it('the policy acts only through dispatch and never mid-tick (it steps before each tick)', () => {
    const sim = makeSim(3)
    const policy = createPolicy(sim, 'competent')
    for (let i = 0; i < 600; i++) {
      policy.step()
      sim.tick()
    }
    expect(sim.commandLog.length).toBeGreaterThan(0)
    expect(() => {
      policy.step()
      runTicks(sim, 1)
    }).not.toThrow()
  })
})
