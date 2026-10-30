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
//
// Build 2, M6 (spec-build2 §7.2 L1-L2 rows; design-m6 §5.1-§5.2): the
// applicant picks ("highest eye, ties lowest salary", drivers by effective
// speed for the bought type, sorters by judgement), every buyVehicle
// carrying the picked driver, the competent policy never hiring a sorter,
// posting an ad or firing; the `delegating` kind hires the best sorter at
// L2, never Tosses by hand while it is on duty and Clears only what it
// tagged `looks clean`.

import { describe, expect, it } from 'vitest'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import {
  delegatingHireSorter,
  delegatingHoldBay,
  sorterOnDuty,
} from '../../src/sim/policies/delegating.ts'
import {
  POLICY_PARAMS,
  bestApplicant,
  createPolicy,
  dockBlockedSecondsToday,
  weakestCounter,
} from '../../src/sim/policy.ts'
import type { Sim } from '../../src/sim/sim.ts'
import { conservation, formatConservation } from '../../src/sim/sim.ts'
import { hireFeeOf, salaryOf } from '../../src/sim/systems/people.ts'
import type {
  Affinity,
  Applicant,
  Pips,
  Role,
  VehicleType,
} from '../../src/sim/types.ts'
import { laneNode, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { parseCli, runSeed, UsageError } from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import type { GateCheck, RecordedEvent } from '../../tools/sim/report.ts'
import {
  baselineLine,
  compareBaseline,
  computeMetrics,
  DELEGATING_NOTE,
  gateMarkdown,
  median,
  summarise,
  withinBand,
} from '../../tools/sim/report.ts'
import {
  dataFixture,
  fund,
  heldParcel,
  makeSim,
  quiet,
  quietSim,
  runTicks,
  standardApplicant,
} from './helpers.ts'

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
  it("opening A at t = 0: a bike with the best driver + a Metal detector, $100 − the driver's fee left; then bikes at price + $50 until 3; a 2nd Metal detector (COUNTERS); at L2 the truck, then the Shaky shaker — each at price + $50, each vehicle with the best driver for its type", () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'competent')
    const first = bestApplicant(sim, 'driver', 'bike')!
    policy.step()
    expect(sim.commandLog.map((e) => e.cmd)).toEqual([
      { kind: 'buyVehicle', type: 'bike', applicantId: first.id },
      { kind: 'buyMachine', defId: 'metal_detector', nodeId: 'slot2' },
    ])
    expect(sim.state.economy.balance).toBe(100 - hireFeeOf(data, first, 'bike'))
    for (let i = 0; i < 18000; i++) {
      const before = sim.commandLog.length
      const balance = sim.state.economy.balance
      const picks: Partial<Record<VehicleType, number | undefined>> = {
        bike: bestApplicant(sim, 'driver', 'bike')?.id,
        truck: bestApplicant(sim, 'driver', 'truck')?.id,
      }
      policy.step()
      for (const e of sim.commandLog.slice(before)) {
        if (e.cmd.kind === 'buyVehicle') {
          // B2 §7.2: the picker is answered on the purchase tick, never "Hire later".
          expect(e.cmd.applicantId, `${e.cmd.type} at ${e.tick}`).not.toBeNull()
          expect(e.cmd.applicantId).toBe(picks[e.cmd.type])
        }
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
    expect(sim.state.vehicles.every((v) => v.driverId !== null)).toBe(true)
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
      sim.commandLog.filter(
        (e) => e.cmd.kind === 'hire' && e.cmd.role === 'inspector',
      ).length
    const dock = sim.state.lane.docks[0]!
    dock.blockedTicksThisDay = POLICY_PARAMS.dockBlockedHireS * 10
    policy.step()
    expect(hires()).toBe(0) // exactly 10 s: not yet
    dock.blockedTicksThisDay += 1
    expect(dockBlockedSecondsToday(sim)).toBeGreaterThan(
      POLICY_PARAMS.dockBlockedHireS,
    )
    const best = bestApplicant(sim, 'inspector')!
    policy.step()
    expect(hires()).toBe(1)
    // B2 §7.2: the best inspector applicant, into the desk's free seat.
    expect(sim.commandLog.at(-1)?.cmd).toEqual({
      kind: 'hire',
      role: 'inspector',
      applicantId: best.id,
      target: { nodeId: 'slot1' },
    })
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
    expect(other.commandLog.filter((e) => e.cmd.kind === 'hire')).toEqual([])
  })

  it('a walked-out worker is re-hired at fee + $50 (spec §7.4 re-hire; a competent player never leaves a vehicle parked "No driver" or a desk seat empty) — in pay order, before any new purchase', () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'competent')
    policy.step() // opening A: bike + Metal detector
    quiet(sim) // no spawns: no income, so both paydays below are short
    const driver = sim.state.employees.find((e) => e.role === 'driver')!
    const insp = sim.state.employees.find((e) => e.role === 'inspector')!
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
      people: true,
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

  it('B2 §7.2: the competent policy never hires a sorter, posts an ad, fires or Replaces; its hires are drivers with their vehicles and inspectors at desk 1', () => {
    for (const r of runs()) {
      const hired = r.events.filter((e) => e.name === 'worker:hired')
      expect(
        hired.filter((e) => e.role === 'sorter'),
        `seed ${r.seed}`,
      ).toEqual([])
      for (const e of hired) {
        if (e.role === 'driver') expect(e.vehicleId).not.toBeNull()
        else expect(e.nodeId, `seed ${r.seed}`).toBe('slot1')
      }
      expect(
        r.events.filter(
          (e) => e.name === 'applicants:refreshed' && e.reason === 'ad',
        ),
        `seed ${r.seed}`,
      ).toEqual([])
      expect(
        r.events.filter((e) => e.name === 'worker:fired'),
        `seed ${r.seed}`,
      ).toEqual([])
      expect(
        r.events.filter((e) => e.name === 'sorter:decided'),
        `seed ${r.seed}`,
      ).toEqual([])
      expect(r.result.metrics.sorterDecisions).toBe(0)
      expect(r.result.metrics.hires).toBe(hired.length)
    }
  }, 60_000)

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

/** An applicant with known pips put into `role`'s pool (ids from nextId, like a roll). */
function applicant(
  sim: Sim,
  role: Role,
  pips: Pips,
  affinity: Affinity = 'none',
): Applicant {
  const a = standardApplicant(sim, role, pips, affinity)
  return a
}

/** Replace `role`'s pool by exactly these applicants. */
function pool(sim: Sim, role: Role, ...xs: [Pips, Affinity?][]): Applicant[] {
  sim.state.applicants[role] = []
  return xs.map(([pips, aff]) => applicant(sim, role, pips, aff))
}

describe('B2 §7.2 applicant picks (bestApplicant, design §5.1, D20)', () => {
  it('inspectors: highest eye, ties lowest salary, then lowest applicant id', () => {
    const sim = makeSim(1)
    const [a, b, c] = pool(
      sim,
      'inspector',
      [{ eye: 4, pace: 4, charisma: 1 }],
      [{ eye: 4, pace: 2, charisma: 0 }],
      [{ eye: 3, pace: 1, charisma: 0 }],
    )
    // eye 4 twice: $28 vs $20 → the cheaper one; the eye-3 one never.
    expect(salaryOf(data, 'inspector', a!.pips)).toBe(28)
    expect(salaryOf(data, 'inspector', b!.pips)).toBe(20)
    expect(bestApplicant(sim, 'inspector')?.id).toBe(b!.id)
    expect(c!.pips.eye).toBe(3)
    // Same eye, same salary → the lower id.
    const [d, e] = pool(
      sim,
      'inspector',
      [{ eye: 5, pace: 3, charisma: 0 }],
      [{ eye: 5, pace: 3, charisma: 0 }],
    )
    expect(bestApplicant(sim, 'inspector')?.id).toBe(Math.min(d!.id, e!.id))
    sim.state.applicants.inspector = []
    expect(bestApplicant(sim, 'inspector')).toBeNull()
  })

  it('drivers: highest effective speed pip for the bought type (affinity counted), ties lowest salary for that type', () => {
    const sim = makeSim(1)
    const [fan, fast, slow] = pool(
      sim,
      'driver',
      [{ speed: 4, energy: 3, charisma: 0 }, 'van'],
      [{ speed: 5, energy: 3, charisma: 0 }, 'none'],
      [{ speed: 2, energy: 1, charisma: 0 }, 'bike'],
    )
    // Bike: 4 / 5 / 3 → the 5-speed driver.
    expect(bestApplicant(sim, 'driver', 'bike')?.id).toBe(fast!.id)
    // Van: the van fan is effectively 5 too and costs less (4 + 3 pips).
    expect(salaryOf(data, 'driver', fan!.pips, 'van')).toBeLessThan(
      salaryOf(data, 'driver', fast!.pips, 'van'),
    )
    expect(bestApplicant(sim, 'driver', 'van')?.id).toBe(fan!.id)
    expect(slow!.affinity).toBe('bike')
  })

  it('sorters: highest judgement (pace only breaks ties through the salary)', () => {
    const sim = makeSim(1)
    const [, sharp, cheap] = pool(
      sim,
      'sorter',
      [{ judgement: 3, pace: 5 }],
      [{ judgement: 5, pace: 4 }],
      [{ judgement: 5, pace: 1 }],
    )
    expect(salaryOf(data, 'sorter', cheap!.pips)).toBeLessThan(
      salaryOf(data, 'sorter', sharp!.pips),
    )
    expect(bestApplicant(sim, 'sorter')?.id).toBe(cheap!.id)
  })

  it('the vehicle triggers stay price + purchaseBuffer: the driver fee is paid out of the buffer (a (5,5,2) truck driver costs ≤ the buffer)', () => {
    const top = { speed: 5, energy: 5, charisma: 2 }
    for (const t of data.vehicles.types) {
      expect(
        hireFeeOf(data, { role: 'driver', pips: top, star: false }, t.id),
        t.id,
      ).toBeLessThanOrEqual(POLICY_PARAMS.purchaseBuffer)
    }
  })
})

describe('the delegating policy (B2 §7.2 L2 row, design §5.2, D8)', () => {
  it('createPolicy builds both kinds; an unknown kind throws', () => {
    const sim = makeSim(1)
    expect(createPolicy(sim, 'competent').name).toBe('competent')
    expect(createPolicy(sim, 'delegating').name).toBe('delegating')
    expect(() => createPolicy(sim, 'lazy' as never)).toThrow(/unknown policy/)
  })

  it('hires the best sorter once the station opens (L2) at fee + $50; never at L1, never into a taken station', () => {
    const sim = fund(quietSim(1), 1000)
    const best = (): Applicant => bestApplicant(sim, 'sorter')!
    delegatingHireSorter(sim, best(), POLICY_PARAMS.purchaseBuffer)
    expect(sim.commandLog).toEqual([]) // L1: the station is locked
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 2 }).ok).toBe(true)
    quiet(sim)
    const pick = best()
    sim.state.economy.balance =
      hireFeeOf(data, pick) + POLICY_PARAMS.purchaseBuffer - 1
    delegatingHireSorter(sim, pick, POLICY_PARAMS.purchaseBuffer)
    expect(sim.state.lane.holdStation.fixture).toBeNull() // $1 short
    sim.state.economy.balance += 1
    delegatingHireSorter(sim, pick, POLICY_PARAMS.purchaseBuffer)
    expect(sim.commandLog.at(-1)?.cmd).toEqual({
      kind: 'hire',
      role: 'sorter',
      applicantId: pick.id,
      target: { station: 'hold' },
    })
    expect(sorterOnDuty(sim)).toBe(true)
    sim.state.economy.balance = 1000
    const n = sim.commandLog.length
    delegatingHireSorter(sim, best(), POLICY_PARAMS.purchaseBuffer)
    expect(sim.commandLog.length).toBe(n) // seated: no second hire
  })

  it('with a sorter on duty: Clears only the parcels it tagged looks clean, never Tosses; stops at a full shelf; without one (L1, walkout) it hands back to Toss-everything', () => {
    const sim = fund(quietSim(1))
    expect(delegatingHoldBay(sim)).toBe(false) // nobody on the station
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 2 }).ok).toBe(true)
    quiet(sim)
    const a = standardApplicant(sim, 'sorter')
    sim.dispatch({
      kind: 'hire',
      role: 'sorter',
      applicantId: a.id,
      target: { station: 'hold' },
    })
    const sorter = sim.state.employees.find((e) => e.role === 'sorter')!
    const tagged = heldParcel(sim)
    const untagged = heldParcel(sim)
    tagged.sorted = { by: sorter.id, name: sorter.name, pct: 85 }
    const n = sim.commandLog.length
    expect(delegatingHoldBay(sim)).toBe(true)
    expect(sim.commandLog.slice(n).map((e) => e.cmd)).toEqual([
      { kind: 'clear', parcelId: tagged.id },
    ])
    expect(tagged.state).toBe('on_shelf')
    expect(untagged.state).toBe('held')
    // A full shelf: the Clear is refused and retried on a later step.
    const again = heldParcel(sim)
    again.sorted = { by: sorter.id, name: sorter.name, pct: 85 }
    const shelf = laneNode(sim.state.lane, 'shelf')!
    const cap = shelf.cap
    shelf.cap = shelf.queue.length
    const m = sim.commandLog.length
    expect(delegatingHoldBay(sim)).toBe(true)
    expect(sim.commandLog.length).toBe(m)
    expect(again.state).toBe('held')
    shelf.cap = cap
    // A walked-out sorter: the policy Tosses by hand again (D8).
    sorter.active = false
    expect(sorterOnDuty(sim)).toBe(false)
    expect(delegatingHoldBay(sim)).toBe(false)
  })

  it('seed 1 × 20 min: Toss-everything until the sorter is seated at L2, then no hand Toss while it is on duty and every Clear is a tagged parcel', () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'delegating')
    let clears = 0
    let sorterHires = 0
    for (let i = 0; i < 20 * TICKS_PER_DAY; i++) {
      const onDuty = sorterOnDuty(sim)
      const n = sim.commandLog.length
      const pick = bestApplicant(sim, 'sorter')
      policy.step()
      for (const e of sim.commandLog.slice(n)) {
        const c = e.cmd
        if (c.kind === 'hire' && c.role === 'sorter') {
          sorterHires += 1
          expect(sim.state.level.level).toBeGreaterThanOrEqual(
            data.employees.holdStation.unlockLevel,
          )
          expect(c.applicantId).toBe(pick?.id)
        }
        if (c.kind === 'toss') expect(onDuty, `toss at ${e.tick}`).toBe(false)
        if (c.kind === 'clear') {
          clears += 1
          expect(onDuty, `clear at ${e.tick}`).toBe(true)
          expect(
            sim.state.parcels[String(c.parcelId)]?.sorted,
            `clear #${c.parcelId}`,
          ).toBeDefined()
        }
      }
      sim.tick()
    }
    expect(sorterHires).toBe(1)
    expect(sim.state.level.level).toBe(2)
    expect(sorterOnDuty(sim)).toBe(true)
    expect(clears).toBeGreaterThan(0)
  }, 30_000)
})

const meta = (policy: string) => ({
  dataHash: data.hash,
  config: null,
  policy,
  minutes: 30,
  targets,
})

const ev = (name: string, extra: Record<string, unknown>): RecordedEvent =>
  ({ tick: 1, name, ...extra }) as RecordedEvent

const check = (key: GateCheck['key'], value: number | null): GateCheck => ({
  key,
  metric: 'firstDeliveryS',
  target: '',
  value,
  pass: true,
  note: null,
})

describe('the gate report, build 2 (tools/sim/report.ts + cli.ts; design §5.3)', () => {
  it('people rows from the events: sorter calls / wrong Tosses / misses, hires (not re-hires), payroll ÷ gross income', () => {
    const events = [
      ev('sorter:decided', { call: 'toss', correct: true }),
      ev('sorter:decided', { call: 'toss', correct: false }),
      ev('sorter:decided', { call: 'leave', correct: false }),
      ev('sorter:decided', { call: 'leave', correct: true }),
      ev('worker:hired', { rehire: false }),
      ev('worker:hired', { rehire: true }),
    ]
    const stats = { ...makeSim(1).state.stats, income: 1000, payrollPaid: 230 }
    const m = computeMetrics(1, 30, events, [], stats)
    expect(m).toMatchObject({
      sorterDecisions: 4,
      sorterWrongToss: 1,
      sorterMissed: 1,
      hires: 1,
      payrollShareOfGross: 0.23,
    })
    expect(
      computeMetrics(1, 30, [], [], { ...stats, income: 0 })
        .payrollShareOfGross,
    ).toBeNull()
  })

  it('the competent gate prints the people rows and the five unbuilt build-2 keys as informational; no delegating row', () => {
    const g = summarise(
      runs().map((r) => r.result),
      meta('competent'),
    )
    const info = Object.fromEntries(g.informational.map((i) => [i.key, i]))
    expect(info.payrollShareOfGross?.note).toBe('informational')
    expect(info.payrollShareOfGross?.target).toContain(
      `≤ ${targets.payrollShareOfGrossMax}`,
    )
    expect(info.sorterDecisions?.median).toBe(0)
    for (const k of [
      'firstOverseasClearedAfterLevel3MaxMin',
      'questsOfferedBy30MinMin',
      'questsCompletedBy30MinMin',
      'goldenReleaseOfferedMaxMin',
      'victoryMaxMin',
    ]) {
      expect(info[k]?.note, k).toBe('build 2 — informational')
    }
    expect(info.delegatingLivesLost).toBeUndefined()
  })

  it("the delegating summary notes every window 'informational (delegating)', passes on invariants alone and prints delegatingLivesLost", () => {
    const res = runs().map((r) => ({
      ...r.result,
      metrics: { ...r.result.metrics, livesLost: 2 },
    }))
    const g = summarise(res, meta('delegating'))
    expect(g.checks.every((c) => c.note === DELEGATING_NOTE)).toBe(true)
    expect(g.checks.find((c) => c.key === 'maxLivesLost')?.pass).toBe(false)
    expect(g.pass).toBe(true)
    expect(
      g.informational.find((i) => i.key === 'delegatingLivesLost'),
    ).toMatchObject({ median: 2, note: DELEGATING_NOTE })
    const broken = res.map((r, i) => (i === 0 ? { ...r, asserts: ['x'] } : r))
    expect(summarise(broken, meta('delegating')).pass).toBe(false)
  })

  it('--baseline: the Δ% of the seven medians and "playtest-1 rows within ±5 %" (both never = within, a 0 baseline compares absolutely)', () => {
    expect(withinBand(13.05, 12.28)).toBe(false) // −5.9 %
    expect(withinBand(2.1, 2.0)).toBe(true) // −4.8 %
    expect(withinBand(0, 0)).toBe(true)
    expect(withinBand(0, 0.5)).toBe(false)
    expect(withinBand(null, null)).toBe(true)
    expect(withinBand(null, 3)).toBe(false)
    const base = {
      dataHash: 'old',
      checks: [check('firstDeliveryS', 44.05), check('level2Min', 13.05)],
    }
    const now = {
      checks: [
        check('firstDeliveryS', 43.3),
        check('level2Min', 12.28),
        check('maxLivesLost', 0),
      ],
    }
    const b = compareBaseline(now, base, 'docs/gate/latest.json')
    expect(b.rows.map((r) => [r.key, r.deltaPct, r.within])).toEqual([
      ['firstDeliveryS', -1.7, true],
      ['level2Min', -5.9, false],
      ['maxLivesLost', null, false], // not in the baseline
    ])
    expect(b.within).toBe(false)
    expect(baselineLine(b)).toBe(
      'playtest-1 rows within ±5 %: no (rows: level2Min -5.9%, maxLivesLost —)',
    )
    const g = summarise(
      runs().map((r) => r.result),
      meta('competent'),
    )
    g.baseline = compareBaseline(g, g, 'self.json')
    expect(g.baseline.within).toBe(true)
    expect(baselineLine(g.baseline)).toBe('playtest-1 rows within ±5 %: yes')
    const md = gateMarkdown(g, 'vlr sim:gate -- --baseline self.json')
    expect(md).toContain(
      '| window | median | target | result | Δ% vs baseline |',
    )
    expect(md).toContain('playtest-1 rows within ±5 %: yes')
  }, 60_000)

  it('cli: --policy competent|delegating|none, --baseline only with --gate', () => {
    expect(parseCli(['--policy', 'delegating']).policy).toBe('delegating')
    expect(parseCli(['--policy', 'none']).policy).toBe('none')
    expect(() => parseCli(['--policy', 'lazy'])).toThrow(UsageError)
    expect(() => parseCli(['--baseline', 'x.json'])).toThrow(/--gate/)
    expect(
      parseCli(['--gate', '--baseline', 'docs/gate/latest.json']).baseline,
    ).toBe('docs/gate/latest.json')
  })

  it('runSeed builds the policy kind it is given (delegating rows are informational per seed)', () => {
    const r = runSeed(data, 1, 1, createPolicy, { kind: 'delegating' })
    expect(r.result.checks.every((c) => c.note === DELEGATING_NOTE)).toBe(true)
    expect(r.result.pass).toBe(true)
  })
})
