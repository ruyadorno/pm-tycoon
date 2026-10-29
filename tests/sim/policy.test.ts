// spec §7 / plan.md §6.9.1-§6.9.2: the scripted competent policy (opening A,
// bikes at price + $50 until 3; the truck / shaker / inspector / Toss rules
// wait for their milestones) drives the playtest-1 gate. Tagged `gate`:
// excluded from `vlr check:quick`, run by the full `vlr check`.

import { describe, expect, it } from 'vitest'
import { POLICY_PARAMS, createPolicy } from '../../src/sim/policy.ts'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import { median, summarise } from '../../tools/sim/report.ts'
import { dataFixture, makeSim, runTicks } from './helpers.ts'

const data = dataFixture()

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

  it('first delivery < 60 s on seeds 1-10 (every seed, and the median)', () => {
    const firsts: number[] = []
    for (let seed = 1; seed <= 10; seed++) {
      const run = runSeed(data, seed, 2, createPolicy)
      const s = run.result.metrics.firstDeliveryS
      expect(s, `seed ${seed}`).not.toBeNull()
      expect(s!, `seed ${seed}`).toBeLessThan(
        data.economy.pacingTargets.firstDeliveryS,
      )
      firsts.push(s!)
    }
    expect(median(firsts)!).toBeLessThan(
      data.economy.pacingTargets.firstDeliveryS,
    )
  }, 30_000)

  it('30-minute seed-1 run: no NaN, no negative balance, no deadlocked vehicle, conservation holds', () => {
    const run = runSeed(data, 1, 30, createPolicy)
    expect(run.result.asserts).toEqual([])
    expect(run.conservation.ok).toBe(true)
    expect(run.rows).toHaveLength(30)
    for (const r of run.rows) {
      expect(Number.isFinite(r.money) && r.money >= 0).toBe(true)
      expect(Number.isFinite(r.sat)).toBe(true)
    }
    expect(run.rows.at(-1)!.deliv).toBeGreaterThan(150)
  }, 30_000)

  it('the M1 gate passes on seeds 1-3: first delivery and shelf stall gated, unbuilt systems informational', () => {
    const runs = [1, 2, 3].map(
      (seed) => runSeed(data, seed, 20, createPolicy).result,
    )
    const g = summarise(runs, {
      dataHash: data.hash,
      config: null,
      policy: 'competent',
      minutes: 20,
      targets: data.economy.pacingTargets,
    })
    expect(g.pass).toBe(true)
    const gated = g.checks.filter((c) => c.note === null).map((c) => c.key)
    expect(gated).toContain('firstDeliveryS')
    expect(gated).toContain('maxShelfStallS')
    if (!SIM_FEATURES.lane) {
      expect(
        g.checks.find((c) => c.key === 'firstMalwareCaughtMaxS')?.note,
      ).toBe('informational (M2)')
    }
    if (!SIM_FEATURES.levels) {
      expect(g.checks.find((c) => c.key === 'level2Min')?.note).toBe(
        'informational (M3)',
      )
    }
  }, 30_000)

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
