// spec §7 / plan.md §6.9.1-§6.9.2, §12.5 task 7, §12.6 tasks 4 + 11: the
// scripted competent policy (opening A, bikes at price + $50 until 3, at L2
// the truck at price + $50 then the Shaky shaker, the COUNTERS extension — a
// free slot gets the weakest strain's counter once the level's purchases are
// done — the 2nd / 3rd inspector on > 10 s of dock blocking in a day, Toss
// every flag on the tick it is held) drives the full playtest-1 gate: first
// delivery < 60 s, the scripted malware flagged and tossed (≤ 300 s), L2 at
// 8-15 min, the truck ≤ 4 min after L2, no life lost and no shelf stall
// (medians), the Hold Bay a loop and not a rarity at L1, no level:up {3},
// the conservation identity every 600 ticks. Tagged `gate`: excluded from
// `vlr check:quick`, run by the full `vlr check`.

import { describe, expect, it } from 'vitest'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import {
  POLICY_PARAMS,
  createPolicy,
  dockBlockedSecondsToday,
  weakestCounter,
} from '../../src/sim/policy.ts'
import { conservation, formatConservation } from '../../src/sim/sim.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import { median, summarise } from '../../tools/sim/report.ts'
import { laneNode, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { dataFixture, makeSim, quiet, runTicks } from './helpers.ts'

const data = dataFixture()
const targets = data.economy.pacingTargets
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
/** A vehicles.json / machines.json price by id. */
const price = (k: string): number =>
  data.vehicles.types.find((t) => t.id === k)?.price ??
  data.machines.checkers.find((c) => c.id === k)!.price

let gateRuns: RunResult[] | null = null
/** The 10-seed × 30-min policy runs (computed once for this file). */
function runs(): RunResult[] {
  gateRuns ??= SEEDS.map((seed) => runSeed(data, seed, 30, createPolicy))
  return gateRuns
}

describe('competent policy (spec §7) [gate]', () => {
  it('opening A at t = 0: a bike + a Metal detector, $100 left; then bikes at price + $50 until 3; a 2nd Metal detector (COUNTERS); at L2 the truck, then the Shaky shaker — each at price + $50', () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'competent')
    policy.step()
    expect(sim.commandLog.map((e) => e.cmd)).toEqual([
      { kind: 'buyVehicle', type: 'bike' },
      { kind: 'buyMachine', defId: 'metal_detector', nodeId: 'slot2' },
    ])
    expect(sim.state.economy.balance).toBe(100)
    for (let i = 0; i < 18000; i++) {
      const before = sim.commandLog.length
      const balance = sim.state.economy.balance
      policy.step()
      for (const e of sim.commandLog.slice(before)) {
        const k =
          e.cmd.kind === 'buyVehicle'
            ? e.cmd.type
            : e.cmd.kind === 'buyMachine'
              ? e.cmd.defId
              : null
        if (k !== null) {
          expect(balance, `${k} at ${e.tick}`).toBeGreaterThanOrEqual(
            price(k) + POLICY_PARAMS.purchaseBuffer,
          )
        }
      }
      sim.tick()
    }
    const buys = sim.commandLog
      .map((e) => e.cmd)
      .filter((c) => c.kind === 'buyVehicle' || c.kind === 'buyMachine')
      .map((c) => (c.kind === 'buyVehicle' ? c.type : `${c.defId}@${c.nodeId}`))
    expect(buys).toEqual([
      'bike',
      'metal_detector@slot2',
      'bike',
      'bike',
      'metal_detector@slot3', // COUNTERS: the weakest strain (metal) after the 3rd bike
      'truck',
      'shaky_shaker@slot4',
    ])
    expect(sim.state.vehicles.every((v) => v.zone === 'any')).toBe(true)
    expect(sim.state.level.level).toBe(2)
  }, 30_000)

  it("COUNTERS picks the weakest announced strain's counter (rattle → the Shaky shaker when it is the weakest)", () => {
    const sim = makeSim(1)
    expect(weakestCounter(sim)?.id).toBe('metal_detector') // metal only (L1)
    createPolicy(sim, 'competent').step() // opening A: desk + Metal detector
    sim.state.level.announced.rattle = 0
    sim.state.level.level = 2
    delete laneNode(sim.state.lane, 'slot4')!.locked
    // metal 97 %, rattle 87 % → the shaker
    expect(weakestCounter(sim)?.id).toBe('shaky_shaker')
    sim.state.economy.balance = 1000
    for (const nodeId of ['slot3', 'slot4']) {
      sim.dispatch({ kind: 'buyMachine', defId: 'shaky_shaker', nodeId })
    }
    // two shakers: rattle 99.5 %, metal 97.8 % → a Metal detector
    expect(weakestCounter(sim)?.id).toBe('metal_detector')
  })

  it('a 2nd / 3rd inspector when the dock was blocked > 10 s in the day (one hire per day; walked-out inspectors keep their seat); never on a merely busy desk', () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'competent')
    policy.step() // opening A
    runTicks(sim, 10)
    sim.state.economy.balance = 1000
    const hires = (): number =>
      sim.commandLog.filter((e) => e.cmd.kind === 'hireInspector').length
    const dock = sim.state.lane.docks[0]!
    dock.blockedTicksThisDay = POLICY_PARAMS.dockBlockedHireS * 10
    policy.step()
    expect(hires()).toBe(0) // exactly 10 s: not yet
    dock.blockedTicksThisDay += 1
    expect(dockBlockedSecondsToday(sim)).toBeGreaterThan(
      POLICY_PARAMS.dockBlockedHireS,
    )
    policy.step()
    expect(hires()).toBe(1)
    policy.step()
    expect(hires()).toBe(1) // one per day
    runTicks(sim, 600) // next day: the counter resets on the boundary
    expect(dock.blockedTicksThisDay).toBe(0)
    dock.blockedTicksThisDay = 200
    sim.state.economy.balance = 1000
    policy.step()
    expect(hires()).toBe(2)
    runTicks(sim, 600)
    dock.blockedTicksThisDay = 200
    sim.state.economy.balance = 1000
    policy.step()
    expect(hires()).toBe(2) // desk full (3 seats)
    // lane stall seconds alone (the M2 signal) never hire
    const other = makeSim(2)
    const p2 = createPolicy(other, 'competent')
    other.state.economy.balance = 1000
    other.state.lane.stallSecondsToday = 60
    p2.step()
    expect(
      other.commandLog.filter((e) => e.cmd.kind === 'hireInspector'),
    ).toEqual([])
  })

  it('a walked-out worker is re-hired at fee + $50 (spec §7.4 re-hire; a competent player never leaves a vehicle parked "No driver" or a desk seat empty) — in pay order, before any new purchase', () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'competent')
    policy.step() // opening A: bike + Metal detector
    quiet(sim) // no spawns: no income, so both paydays below are short
    const driver = sim.state.employees.find((e) => e.kind === 'driver')!
    const insp = sim.state.employees.find((e) => e.kind === 'inspector')!
    sim.state.economy.balance = 0
    runTicks(sim, 2 * TICKS_PER_DAY) // two $0 paydays: both walk out
    expect(driver.active).toBe(false)
    expect(insp.active).toBe(false)
    expect(sim.state.vehicles[0]!.state).toBe('inactive')
    const rehires = (): number[] =>
      sim.commandLog
        .filter((e) => e.cmd.kind === 'rehire')
        .map((e) => (e.cmd as { employeeId: number }).employeeId)
    // inspector fee $20 + $50 buffer: one dollar short → nothing
    sim.state.economy.balance =
      insp.salaryPerDay * sim.data.employees.rehireFeeDays +
      POLICY_PARAMS.purchaseBuffer -
      1
    policy.step()
    expect(rehires()).toEqual([])
    // enough for the inspector (first in pay order), not for both
    sim.state.economy.balance += 1
    policy.step()
    expect(rehires()).toEqual([insp.id])
    expect(insp.active).toBe(true)
    sim.state.economy.balance = 1000
    const buysBefore = sim.commandLog.length
    policy.step()
    expect(rehires()).toEqual([insp.id, driver.id])
    expect(sim.commandLog[buysBefore]?.cmd.kind).toBe('rehire') // before the 2nd bike
    expect(driver.active).toBe(true)
    expect(sim.state.vehicles[0]!.state).toBe('idle_lot')
  })

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

  it('no life lost / no shelf stall on 10 seeds under Toss-everything (lives by median; no seed ever stalls on the shelf)', () => {
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

  it('the playtest-1 gate passes on seeds 1-10 × 30 min with every window gated (M3: levels + payroll on)', () => {
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
    expect(SIM_FEATURES).toEqual({
      lane: true,
      lives: true,
      levels: true,
      payroll: true,
    })
    expect(g.checks.map((c) => [c.key, c.note])).toEqual([
      ['firstDeliveryS', null],
      ['firstMalwareCaughtMaxS', null],
      ['level2Min', null],
      ['truckAfterLevel2MaxMin', null],
      ['maxLivesLost', null],
      ['maxShelfStallS', null],
      ['holdBayEventsPer10MinMin', null],
    ])
    expect(g.checks.filter((c) => !c.pass)).toEqual([])
    expect(g.pass).toBe(true)
  }, 60_000)

  it('L2 median in [8, 15] min (lifetime earned reaches the levels.json threshold)', () => {
    const l2 = runs().map((r) => r.result.metrics.level2Min)
    for (const [i, m] of l2.entries()) {
      expect(m, `seed ${SEEDS[i]}`).not.toBeNull()
    }
    const [lo, hi] = targets.level2Min
    expect(median(l2)!).toBeGreaterThanOrEqual(lo)
    expect(median(l2)!).toBeLessThanOrEqual(hi)
  }, 60_000)

  it('truck ≤ 4 min after L2 median (bought at its vehicles.json price + $50); every seed buys one', () => {
    const t = runs().map((r) => r.result.metrics.truckAfterLevel2Min)
    for (const [i, m] of t.entries()) {
      expect(m, `seed ${SEEDS[i]}`).not.toBeNull()
    }
    expect(median(t)!).toBeLessThanOrEqual(targets.truckAfterLevel2MaxMin)
  }, 60_000)

  it('no level:up {3} on any seed; the post-cap escalation is printed (malwareShareAt30Min)', () => {
    for (const r of runs()) {
      const ups = r.events.filter((e) => e.name === 'level:up')
      expect(
        ups.map((e) => e.level),
        `seed ${r.seed}`,
      ).toEqual([2])
      const m = data.parcels.malware
      expect(r.result.metrics.malwareShareAtEnd).toBeGreaterThan(
        m.baseShare + m.perLevel,
      )
      expect(r.result.metrics.malwareShareAtEnd).toBeLessThanOrEqual(m.cap)
    }
  }, 60_000)

  it('Q-RUN3: the scripted malware is flagged ≤ firstMalwareCaughtMaxS on at least 9 of seeds 1-10', () => {
    const t = runs().map((r) => r.result.metrics.scriptedCaughtS)
    expect(
      t.filter((x) => x !== null && x <= targets.firstMalwareCaughtMaxS).length,
    ).toBeGreaterThanOrEqual(9)
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
