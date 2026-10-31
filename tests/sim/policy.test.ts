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
//
// Build 2, M7 (spec-build2 §7.2 quests row, §7.3; design-m7 §5.1-§5.2): the
// policy accepts every quest offer and rushes the golden parcel's origin
// (tests/sim/quests-policy.long.test.ts has the rule and the quest rows); the
// windows here hold with the quest layer on, and the report gates the two
// quest rows (informational below 30 minutes), prints the Golden Release /
// victory rows as informational (M9), the 7-13 minute plateau, the magic
// on-time count and the per-template counts; --baseline compares only the
// seven playtest-1 rows.
//
// Build 2, M8 (spec-build2 §7.2 L3 row, §7.3; plan-build2 §8.5 task 7;
// design-m8-m9 §5.1-§5.3): at L3 the plan (policies/levelPlan.ts) buys the
// Battery checker — REPLACEing the duplicate Metal detector — then dock 2,
// a van and a 2nd truck, each at price + $50, skipping impossible steps and
// waiting on an unaffordable one; desk 2 only when the dock-blocked rule
// fires with desk 1 full. The report gates level3Min (15-20 min) and
// firstOverseasClearedAfterLevel3MaxMin (≤ 3 min) behind levels3plus
// (informational in --quick and on a shorter run), level4Min / level5Min
// stay informational (M9); a non-30-minute gate writes latest-<N>min.*.
// tests/sim/levels3.long.test.ts has the seeds 1-10 × 25 min L3 window.
//
// Build 2, M9 (spec-build2 §7.2 L4-L5 rows, §7.3; plan-build2 §8.6 tasks 4 +
// 6 and its acceptance; design-m8-m9 §5.1-§5.3, §7 M9 item 8): with
// SIM_FEATURES.levels45 the plan buys at L4 the X-ray → dock 3 → the Sorter
// Arm into the empty station → a 2nd van, and at L5 the 3rd truck (the
// Golden Release is accepted by the quest rule), each at price + $50;
// COUNTERS then takes slot 6. Once the Arm holds the station the policy
// leaves the Hold Bay to it and Tosses by hand only with every bay taken.
// The report gates level4Min (20-25 min) and level5Min (25-30 min); the
// Golden Release / victory rows and armTosses print as informational; the
// gate table gains GR_min. tests/sim/victory.long.test.ts has the seeds 1-3
// victory run.

import { describe, expect, it } from 'vitest'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import {
  delegatingHireSorter,
  delegatingHoldBay,
  sorterOnDuty,
} from '../../src/sim/policies/delegating.ts'
import {
  armHoldsBay,
  LEVEL_PLAN,
  levelPlanDone,
  levelPlanStep,
  placeNextDesk,
  planMaxLevel,
  planSteps,
  replaceSlot,
  slotForPurchase,
  stepStatus,
  strainCounterStep,
} from '../../src/sim/policies/levelPlan.ts'
import {
  POLICY_PARAMS,
  bestApplicant,
  createPolicy,
  dockBlockedSecondsToday,
  weakestCounter,
} from '../../src/sim/policy.ts'
import type { Command } from '../../src/sim/commands.ts'
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
import {
  laneNode,
  liveSlotIds,
  TICKS_PER_DAY,
  TICKS_PER_S,
  ticksFromS,
} from '../../src/sim/types.ts'
import {
  gateFileBase,
  parseCli,
  questsLine,
  runSeed,
  stuckKey,
  UsageError,
} from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import type { GateCheck, RecordedEvent } from '../../tools/sim/report.ts'
import {
  BASELINE_KEYS,
  baselineLine,
  checkMetrics,
  checkOk,
  compareBaseline,
  computeMetrics,
  DELEGATING_NOTE,
  formatGate,
  Highlights,
  gateMarkdown,
  LEVEL_BASELINE_BAND,
  levelWindowMinutes,
  median,
  questMetrics,
  questTallies,
  summarise,
  windowNote,
  withinBand,
  withinShift,
} from '../../tools/sim/report.ts'
import {
  collect,
  dataFixture,
  fund,
  heldParcel,
  makeSim,
  noOffers,
  quiet,
  quietSim,
  runTicks,
  standardApplicant,
  withDecisions,
} from './helpers.ts'

const data = dataFixture()
const targets = data.economy.pacingTargets
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
/** A vehicles.json / machines.json (checkers, upgrades) price by id, or economy.docks' by `dock<index>`. */
const price = (k: string): number =>
  data.vehicles.types.find((t) => t.id === k)?.price ??
  data.economy.docks.find((d) => `dock${d.index}` === k)?.price ??
  data.machines.upgrades.find((u) => u.id === k)?.price ??
  data.machines.checkers.find((c) => c.id === k)!.price

/**
 * Every purchase of the competent policy's plan in order (B2 §7.2): opening
 * A, the bikes, COUNTERS' 2nd Metal detector, the L2 truck + shaker; L3
 * REPLACE → Battery checker → dock 2 → van → 2nd truck; L4 X-ray → dock 3 →
 * the Sorter Arm → 2nd van; L5 the 3rd truck. COUNTERS (slot 6 at L5)
 * follows it. M9 NEW STRAIN FIRST (levelPlan.ts): the X-ray moves ahead of
 * whatever L3 step is still pending when L4 arrives.
 */
const PLAN_BUYS = [
  'bike',
  'metal_detector@slot2',
  'bike',
  'bike',
  'metal_detector@slot3', // COUNTERS: the weakest strain (metal) after the 3rd bike
  'truck',
  'shaky_shaker@slot4',
  'remove@slot3', // L3: REPLACE the duplicate, then the plan
  'battery_checker@slot3',
  'dock2',
  'van',
  'truck',
  'xray@slot5', // L4
  'dock3',
  'sorter_arm@hold',
  'van',
  'truck', // L5
] as const

let gateRuns: RunResult[] | null = null
/**
 * The 10-seed × 30-min policy runs (computed once for this file). Build 3,
 * M12: pass 1 (B3 §2.3, §3.9 — the level rows gated "pass 1 with events off,
 * pass 2 on"): the decision draw stays off here until M14's pass 2 re-gates
 * the windows with the deck; the deck-on event rows are gated in
 * tests/sim/events-policy.long.test.ts and by `vlr sim:gate`.
 */
function runs(): RunResult[] {
  gateRuns ??= withDecisions(false, () =>
    SEEDS.map((seed) => runSeed(data, seed, 30, createPolicy)),
  )
  return gateRuns
}
/** The pass-1 feature set the runs above use (the shipped flags, decisions off). */
const PASS1 = { ...SIM_FEATURES, events: false }

describe('competent policy (spec §7) [gate]', () => {
  it("opening A at t = 0: a bike with the best driver + a Metal detector, $100 − the driver's fee left; then bikes at price + $50 until 3; a 2nd Metal detector (COUNTERS); at L2 the truck, then the Shaky shaker; at L3 (M8) the Battery checker REPLACEs the 2nd Metal detector, then dock 2, a van, a 2nd truck; at L4 (M9) the X-ray, dock 3, the Sorter Arm, a 2nd van; at L5 a 3rd truck — each at price + $50 (a REPLACE counts its refund, a voucher makes a machine free), each vehicle with the best driver for its type (seed 1 × 35 min)", () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'competent')
    const first = bestApplicant(sim, 'driver', 'bike')!
    policy.step()
    expect(sim.commandLog.map((e) => e.cmd)).toEqual([
      { kind: 'buyVehicle', type: 'bike', applicantId: first.id },
      { kind: 'buyMachine', defId: 'metal_detector', nodeId: 'slot2' },
    ])
    expect(sim.state.economy.balance).toBe(100 - hireFeeOf(data, first, 'bike'))
    let l4Tick: number | null = null
    for (let i = 0; i < 35 * TICKS_PER_DAY; i++) {
      if (l4Tick === null && sim.state.level.level >= 4) {
        l4Tick = sim.state.tick
      }
      const before = sim.commandLog.length
      const balance = sim.state.economy.balance
      const vouchers = [...sim.state.quests.vouchers]
      const picks: Partial<Record<VehicleType, number | undefined>> = {
        bike: bestApplicant(sim, 'driver', 'bike')?.id,
        van: bestApplicant(sim, 'driver', 'van')?.id,
        truck: bestApplicant(sim, 'driver', 'truck')?.id,
      }
      const lane = sim.state.lane
      const slotPrice = new Map(
        liveSlotIds(lane).map((id) => {
          const f = laneNode(lane, id)?.fixture
          return [id, f?.kind === 'machine' ? f.checker.price : 0] as const
        }),
      )
      let refund = 0
      policy.step()
      for (const e of sim.commandLog.slice(before)) {
        if (e.cmd.kind === 'buyVehicle') {
          // B2 §7.2: the picker is answered on the purchase tick, never "Hire later".
          expect(e.cmd.applicantId, `${e.cmd.type} at ${e.tick}`).not.toBeNull()
          expect(e.cmd.applicantId).toBe(picks[e.cmd.type])
        }
        if (e.cmd.kind === 'removeFixture') {
          refund += Math.round(
            (slotPrice.get(e.cmd.nodeId) ?? 0) * data.machines.removalRefund,
          )
        }
        const k =
          e.cmd.kind === 'buyVehicle'
            ? e.cmd.type
            : e.cmd.kind === 'buyMachine'
              ? e.cmd.defId
              : e.cmd.kind === 'buyDock'
                ? `dock${e.cmd.index}`
                : null
        if (k !== null) {
          const free = e.cmd.kind === 'buyMachine' && vouchers.includes(k)
          expect(balance + refund, `${k} at ${e.tick}`).toBeGreaterThanOrEqual(
            (free ? 0 : price(k)) + POLICY_PARAMS.purchaseBuffer,
          )
        }
      }
      sim.tick()
    }
    const tagged = sim.commandLog
      .filter(
        (e) =>
          e.cmd.kind === 'buyVehicle' ||
          e.cmd.kind === 'buyMachine' ||
          e.cmd.kind === 'buyDock' ||
          e.cmd.kind === 'removeFixture' ||
          e.cmd.kind === 'placeDesk',
      )
      .map((e) => {
        const c = e.cmd
        const k =
          c.kind === 'buyVehicle'
            ? c.type
            : c.kind === 'buyMachine'
              ? `${c.defId}@${c.nodeId}`
              : c.kind === 'buyDock'
                ? `dock${c.index}`
                : c.kind === 'removeFixture'
                  ? `remove@${c.nodeId}`
                  : c.kind === 'placeDesk'
                    ? `desk${c.index}@${c.nodeId}`
                    : '?'
        return { k, tick: e.tick }
      })
    const buys = tagged.map((b) => b.k)
    // The plan's order, as far as the run got (a retune moves the minutes,
    // never the order): at least through the L3 van (M8: L3 at 17:05 on
    // seed 1); past the plan only COUNTERS' slot 6 at L5. The X-ray is
    // compared on its own (NEW STRAIN FIRST): the first purchase once L4
    // has arrived, ahead of any L3 step still pending.
    const XRAY = 'xray@slot5'
    const noX = (a: readonly string[]) => a.filter((k) => k !== XRAY)
    const planNoX = noX(PLAN_BUYS)
    const buysNoX = noX(buys)
    const n = Math.min(buysNoX.length, planNoX.length)
    expect(buysNoX.slice(0, n)).toEqual(planNoX.slice(0, n))
    expect(n).toBeGreaterThanOrEqual(planNoX.indexOf('dock2') + 2)
    for (const extra of buysNoX.slice(planNoX.length)) {
      expect(extra).toMatch(/@slot6$/)
    }
    const level = sim.state.level.level
    const afterL4 = tagged.filter((b) => l4Tick !== null && b.tick >= l4Tick)
    if (afterL4.length > 0) expect(afterL4[0]!.k).toBe(XRAY)
    expect(buys.filter((k) => k === XRAY)).toHaveLength(
      level >= 4 && afterL4.length > 0 ? 1 : 0,
    )
    // Every plan step of the levels reached is bought or waiting on money:
    // the level-4 rows start only once the run is at L4, and so on.
    if (level < 4) expect(n).toBeLessThanOrEqual(planNoX.indexOf('dock3'))
    if (level < 5) expect(n).toBeLessThan(planNoX.length)
    expect(sim.state.vehicles.every((v) => v.zone === 'any')).toBe(true)
    expect(sim.state.vehicles.every((v) => v.driverId !== null)).toBe(true)
    expect(level).toBeGreaterThanOrEqual(3)
    console.log(
      `[policy] seed 1 × 35 min: L${level}, ${n + (buys.includes(XRAY) ? 1 : 0)}/${PLAN_BUYS.length} plan purchases (${buys.slice(PLAN_BUYS.indexOf('dock2')).join(' → ')})`,
    )
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

  it('the policy Tosses every flag on the tick it is held — until the Sorter Arm (M9) holds the station, which Tosses it autoTossDelayS later; nothing else waits in the Hold Bay', () => {
    const arm = data.machines.upgrades.find((u) => u.id === 'sorter_arm')!
    const delay = Math.round(arm.autoTossDelayS * TICKS_PER_S)
    // The smallest Hold Bay of the levels the Arm exists at.
    const armBayCap = Math.min(
      ...data.levels
        .filter((l) => l.level >= arm.unlockLevel)
        .map((l) => l.holdBayCap),
    )
    for (const r of runs()) {
      const held = r.events.filter((e) => e.name === 'parcel:held')
      expect(held.length, `seed ${r.seed}`).toBeGreaterThan(5)
      const tossOf = new Map(
        r.events
          .filter((e) => e.name === 'parcel:tossed')
          .map((e) => [e.id as number, e]),
      )
      const firstArm = r.events.find(
        (e) => e.name === 'parcel:tossed' && e.source === 'arm',
      )
      for (const h of held) {
        const t = tossOf.get(h.id as number)
        const why = `seed ${r.seed} parcel ${String(h.id)}`
        if (t === undefined) {
          // Still in the bay at the end: held within the Arm's delay.
          expect(r.rows.at(-1)!.tick - h.tick, why).toBeLessThan(delay)
          continue
        }
        if (t.source === 'arm') expect(t.tick - h.tick, why).toBe(delay)
        else {
          expect(t.source, why).toBe('player')
          expect(t.tick, why).toBe(h.tick)
          // With the Arm in the station a hand Toss means every bay was taken.
          if (firstArm !== undefined && h.tick > firstArm.tick) {
            expect(
              held.filter(
                (x) =>
                  x.tick <= h.tick &&
                  (tossOf.get(x.id as number)?.tick ?? Infinity) >= h.tick,
              ).length,
              why,
            ).toBeGreaterThanOrEqual(armBayCap)
          }
        }
      }
      // A minute row is built inside its last tick, before the policy's next
      // step: only parcels held on that very tick may show (M7: seed 3 holds
      // #283 on tick 16800, the minute-28 boundary, and Tosses it at once),
      // plus — with the Arm — those held less than its delay before.
      for (const row of r.rows) {
        const inBay = held.filter((h) => {
          const t = tossOf.get(h.id as number)
          return (
            h.tick <= row.tick &&
            (t === undefined ||
              t.tick > row.tick ||
              (t.tick === row.tick && t.source === 'player'))
          )
        }).length
        expect(
          row.held,
          `seed ${r.seed} minute ${row.min}`,
        ).toBeLessThanOrEqual(inBay)
      }
    }
  }, 60_000)

  it('the gate passes on seeds 1-10 × 30 min with every window gated (M3: levels + payroll on; M7: the two quest rows; M8: the L3 rows; M9: the L4-L5 rows)', () => {
    const g = summarise(
      runs().map((r) => r.result),
      {
        dataHash: data.hash,
        config: null,
        policy: 'competent',
        minutes: 30,
        targets,
        features: PASS1,
      },
    )
    expect(SIM_FEATURES).toEqual({
      lane: true,
      lives: true,
      levels: true,
      payroll: true,
      people: true,
      quests: true,
      levels3plus: true,
      levels45: true,
      events: true,
    })
    expect(g.checks.map((c) => [c.key, c.note])).toEqual([
      ['firstDeliveryS', null],
      ['firstMalwareCaughtMaxS', null],
      ['level2Min', null],
      ['truckAfterLevel2MaxMin', null],
      ['maxLivesLost', null],
      ['maxShelfStallS', null],
      ['holdBayEventsPer10MinMin', null],
      ['questsOfferedBy30MinMin', null],
      ['questsCompletedBy30MinMin', null],
      ['level3Min', null],
      ['firstOverseasClearedAfterLevel3MaxMin', null],
      ['level4Min', null],
      ['level5Min', null],
      // Build 3 (B3 §3.9): gated with the deck on since M12 — these are the
      // pass-1 runs (decisions off), so they stay informational here.
      ['eventsOfferedBy30MinMin', 'informational (M12)'],
      ['eventsOpenMaxTicks', 'informational (M12)'],
      ['eventsL1PlateauMin', 'informational (M12)'],
      ['policyEvPerCard', 'informational (M12)'],
      ['policyNonDefaultShare', 'informational (M12)'],
    ])
    expect(
      g.checks
        .filter((c) => c.note === null && !c.pass)
        .map((c) => [c.key, c.value]),
    ).toEqual([])
    expect(g.checks.every(checkOk)).toBe(true)
    expect(g.pass).toBe(true)
  }, 60_000)

  it('M8 acceptance (plan-build2 §8.5; build 3 windows): L3 median inside level3Min and the first overseas clearance ≤ 3 min after L3 (median); every seed reaches L3 and clears overseas', () => {
    const m = runs().map((r) => r.result.metrics)
    for (const x of m) {
      expect(x.level3Min, `seed ${x.seed}`).not.toBeNull()
      expect(
        x.firstOverseasClearedAfterLevel3Min,
        `seed ${x.seed}`,
      ).not.toBeNull()
      expect(x.overseasCleared, `seed ${x.seed}`).toBeGreaterThan(0)
    }
    const [lo, hi] = targets.level3Min
    const l3 = median(m.map((x) => x.level3Min))!
    expect(l3).toBeGreaterThanOrEqual(lo)
    expect(l3).toBeLessThanOrEqual(hi)
    expect(
      median(m.map((x) => x.firstOverseasClearedAfterLevel3Min))!,
    ).toBeLessThanOrEqual(targets.firstOverseasClearedAfterLevel3MaxMin)
  }, 60_000)

  it('M9 acceptance (plan-build2 §8.6; build 3 windows): L4 median inside level4Min and L5 median inside level5Min; L4 never before L3, L5 never before L4 (per-seed minutes printed)', () => {
    const m = runs().map((r) => r.result.metrics)
    console.log(
      `[policy] L3/L4/L5 min by seed: ${m.map((x) => `${x.seed}:${x.level3Min ?? '—'}/${x.level4Min ?? '—'}/${x.level5Min ?? '—'}`).join(' ')}`,
    )
    for (const x of m) {
      if (x.level4Min !== null) {
        expect(x.level4Min, `seed ${x.seed}`).toBeGreaterThanOrEqual(
          x.level3Min!,
        )
      }
      if (x.level5Min !== null) {
        expect(x.level5Min, `seed ${x.seed}`).toBeGreaterThanOrEqual(
          x.level4Min!,
        )
      }
    }
    for (const key of ['level4Min', 'level5Min'] as const) {
      const [lo, hi] = targets[key]
      const med = median(m.map((x) => x[key]))
      expect(med, key).not.toBeNull()
      expect(med!, key).toBeGreaterThanOrEqual(lo)
      expect(med!, key).toBeLessThanOrEqual(hi)
    }
  }, 60_000)

  it('L2 median inside level2Min (build 3: 7-13.5 min; lifetime earned reaches the levels.json threshold)', () => {
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

  it('level:up 2, 3, 4, 5 in order on every seed, at least L3 (M9: the cap is the top level, B2 §9); no malware escalation before Victory (malwareShareAt30Min = base + perLevel × (level − 1))', () => {
    const top = data.levels.reduce((n, l) => Math.max(n, l.level), 0)
    expect(data.economy.playtestMaxLevel).toBe(top)
    const m = data.parcels.malware
    for (const r of runs()) {
      const ups = r.events
        .filter((e) => e.name === 'level:up')
        .map((e) => e.level as number)
      expect(ups.length, `seed ${r.seed}`).toBeGreaterThanOrEqual(2)
      expect(ups, `seed ${r.seed}`).toEqual(ups.map((_, i) => i + 2))
      const last = r.rows.at(-1)!
      if (r.events.some((e) => e.name === 'game:victory')) continue
      expect(r.result.metrics.malwareShareAtEnd, `seed ${r.seed}`).toBeCloseTo(
        Math.min(m.cap, m.baseShare + m.perLevel * (last.lvl - 1)),
        9,
      )
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

  it('B2 §7.2: the competent policy never hires a sorter, posts an ad, fires or Replaces; its hires are drivers with their vehicles and inspectors at desk 1 (desk 2 never fires on seeds 1-10: desk 1 never fills)', () => {
    for (const r of runs()) {
      const hired = r.events.filter((e) => e.name === 'worker:hired')
      expect(
        r.events.filter((e) => e.name === 'desk:placed'),
        `seed ${r.seed}`,
      ).toEqual([])
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

  it('the stuck rule (stuckKey, M9 review): moving is not progress — a vehicle driving a loop keeps its key; a stop, cargo, timer, reservation or state change resets it', () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'competent')
    for (let i = 0; i < 6000 && sim.state.vehicles.length === 0; i++) {
      policy.step()
      sim.tick()
    }
    const v = sim.state.vehicles[0]!
    const key = stuckKey(v)
    const moved = { ...v, pos: { tx: v.pos.tx + 7, ty: v.pos.ty - 3 } }
    expect(stuckKey(moved)).toBe(key)
    expect(stuckKey({ ...v, stopIndex: v.stopIndex + 1 })).not.toBe(key)
    expect(stuckKey({ ...v, cargo: [...v.cargo, 999] })).not.toBe(key)
    expect(stuckKey({ ...v, waitUntilTick: 12345 })).not.toBe(key)
    expect(stuckKey({ ...v, reserved: [...v.reserved, 999] })).not.toBe(key)
    expect(
      stuckKey({
        ...v,
        state: v.state === 'inactive' ? 'idle_lot' : 'inactive',
      }),
    ).not.toBe(key)
  })

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
    expect(sim.state.level.level).toBe(3) // M8: L3 at 17:05 on seed 1
    expect(sorterOnDuty(sim)).toBe(true)
    expect(clears).toBeGreaterThan(0)
  }, 30_000)
})

/** One policy step's commands. */
function stepCmds(sim: Sim, policy: { step(): void }): Command[] {
  const n = sim.commandLog.length
  policy.step()
  return sim.commandLog.slice(n).map((e) => e.cmd)
}

/**
 * A quiet sim at L3 with the 30-minute runs' lane and fleet at L2's end —
 * desk 1, then `layout` in slots 2-4 (default: Metal detector, COUNTERS'
 * 2nd Metal detector, Shaky shaker), 3 bikes + a truck with the best
 * drivers — and `balance` dollars. No tick runs, so nothing else moves.
 */
function l3Sim(
  balance: number,
  layout: readonly string[] = [
    'metal_detector',
    'metal_detector',
    'shaky_shaker',
  ],
): Sim {
  const sim = fund(quietSim(1))
  expect(sim.dispatch({ kind: 'debugForceLevel', level: 2 }).ok).toBe(true)
  quiet(sim)
  for (const [i, defId] of layout.entries()) {
    const nodeId = `slot${i + 2}`
    expect(sim.dispatch({ kind: 'buyMachine', defId, nodeId }).ok).toBe(true)
  }
  for (const type of ['bike', 'bike', 'bike', 'truck'] as const) {
    const a = bestApplicant(sim, 'driver', type)!
    const res = sim.dispatch({ kind: 'buyVehicle', type, applicantId: a.id })
    expect(res.ok).toBe(true)
  }
  expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 }).ok).toBe(true)
  quiet(sim)
  sim.state.economy.balance = balance
  return sim
}

/** Fill desk 1 (the start inspector + 2 hires from the pool). */
function fillDesk1(sim: Sim): void {
  for (let i = 0; i < 2; i++) {
    const a = bestApplicant(sim, 'inspector')!
    const res = sim.dispatch({
      kind: 'hire',
      role: 'inspector',
      applicantId: a.id,
      target: { nodeId: 'slot1' },
    })
    expect(res.ok).toBe(true)
  }
}

describe('the L3 plan (B2 §7.2 L3 row; design-m8-m9 §5.1, R9)', () => {
  const buffer = POLICY_PARAMS.purchaseBuffer
  const refund = Math.round(
    price('metal_detector') * data.machines.removalRefund,
  )

  it('LEVEL_PLAN is B2 §7.2 verbatim; the M8 build ran L3 only (levels3plus), M9 adds L4-L5 (levels45, on); nothing below L3', () => {
    expect(LEVEL_PLAN[3]).toEqual([
      { kind: 'machine', defId: 'battery_checker' },
      { kind: 'dock', index: 2 },
      { kind: 'vehicle', type: 'van', count: 1 },
      { kind: 'vehicle', type: 'truck', count: 2 },
    ])
    expect(LEVEL_PLAN[4]).toEqual([
      { kind: 'machine', defId: 'xray' },
      { kind: 'dock', index: 3 },
      { kind: 'sorterArm' },
      { kind: 'vehicle', type: 'van', count: 2 },
    ])
    expect(LEVEL_PLAN[5]).toEqual([
      { kind: 'vehicle', type: 'truck', count: 3 },
    ])
    expect(planMaxLevel()).toBe(5)
    expect(planMaxLevel({ levels3plus: true, levels45: false })).toBe(3)
    expect(planMaxLevel({ levels3plus: true, levels45: true })).toBe(5)
    expect(planMaxLevel({ levels3plus: false, levels45: false })).toBe(2)
    const sim = fund(quietSim(1))
    expect(planSteps(sim)).toEqual([])
    expect(levelPlanStep(sim, buffer)).toBe('done')
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 }).ok).toBe(true)
    expect(planSteps(sim)).toEqual(LEVEL_PLAN[3])
    // NEW STRAIN FIRST: each level's strain counter (levels.json strain +
    // machines) ahead of the rest, newest first; B2 §7.2's order within a
    // level. L3's counter (the Battery checker) is already its first step.
    expect(strainCounterStep(sim, 3)).toEqual(LEVEL_PLAN[3]![0])
    expect(strainCounterStep(sim, 4)).toEqual(LEVEL_PLAN[4]![0])
    expect(strainCounterStep(sim, 5)).toBeNull() // L5 announces no strain
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 4 }).ok).toBe(true)
    const [xray, ...l4rest] = LEVEL_PLAN[4]!
    expect(planSteps(sim)).toEqual([xray, ...LEVEL_PLAN[3]!, ...l4rest])
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 5 }).ok).toBe(true)
    expect(planSteps(sim)).toEqual([
      xray,
      ...LEVEL_PLAN[3]!,
      ...l4rest,
      ...LEVEL_PLAN[5]!,
    ])
  })

  it('on a funded forced-L3 sim: the Battery checker REPLACEs the duplicate Metal detector → dock 2 → van → 2nd truck, each at price + $50 (the REPLACE counts its refund), one per step; nothing is bought while the next step is unaffordable', () => {
    const sim = l3Sim(price('battery_checker') + buffer - refund - 1)
    const policy = createPolicy(sim, 'competent')
    expect(replaceSlot(sim)).toEqual({ nodeId: 'slot3', replace: true, refund })
    expect(stepStatus(sim, LEVEL_PLAN[3]![0]!, buffer)).toBe('waiting')
    expect(stepCmds(sim, policy)).toEqual([]) // $1 short: dock 2 waits too
    sim.state.economy.balance += 1
    expect(stepCmds(sim, policy)).toEqual([
      { kind: 'removeFixture', nodeId: 'slot3' },
      { kind: 'buyMachine', defId: 'battery_checker', nodeId: 'slot3' },
    ])
    expect(sim.state.economy.balance).toBe(buffer)
    expect(laneNode(sim.state.lane, 'slot2')?.fixture).toMatchObject({
      checker: { defId: 'metal_detector' },
    })
    const steps: [number, Command][] = [
      [price('dock2'), { kind: 'buyDock', index: 2 }],
      [
        price('van'),
        { kind: 'buyVehicle', type: 'van', applicantId: Number.NaN },
      ],
      [
        price('truck'),
        { kind: 'buyVehicle', type: 'truck', applicantId: Number.NaN },
      ],
    ]
    for (const [cost, cmd] of steps) {
      sim.state.economy.balance = cost + buffer - 1
      expect(stepCmds(sim, policy), `${cmd.kind} $1 short`).toEqual([])
      sim.state.economy.balance += 1
      const want =
        cmd.kind === 'buyVehicle'
          ? {
              ...cmd,
              applicantId: bestApplicant(sim, 'driver', cmd.type)!.id,
            }
          : cmd
      expect(stepCmds(sim, policy)).toEqual([want])
    }
    expect(sim.state.lane.docks.map((d) => d.id)).toEqual(['dock1', 'dock2'])
    expect(sim.state.vehicles.map((v) => v.type)).toEqual([
      'bike',
      'bike',
      'bike',
      'truck',
      'van',
      'truck',
    ])
    expect(levelPlanDone(sim)).toBe(true)
    expect(levelPlanStep(sim, buffer)).toBe('done')
    // Done: a fortune buys nothing more (COUNTERS: no free slot).
    sim.state.economy.balance = 1_000_000
    expect(stepCmds(sim, policy)).toEqual([])
  })

  it('REPLACE takes the LAST duplicate in flow order, never a desk; a free slot comes first; with neither the machine step is impossible and the next step goes ahead', () => {
    const shakers = l3Sim(0, ['metal_detector', 'shaky_shaker', 'shaky_shaker'])
    expect(replaceSlot(shakers)).toEqual({
      nodeId: 'slot4',
      replace: true,
      refund: Math.round(price('shaky_shaker') * data.machines.removalRefund),
    })
    const free = l3Sim(0, ['metal_detector', 'shaky_shaker'])
    expect(replaceSlot(free)).toBeNull()
    expect(slotForPurchase(free)).toEqual({
      nodeId: 'slot4',
      replace: false,
      refund: 0,
    })
    // desk 1, Metal detector, Shaky shaker, desk 2: nowhere to go.
    const full = l3Sim(0, ['metal_detector', 'shaky_shaker'])
    expect(
      full.dispatch({ kind: 'placeDesk', nodeId: 'slot4', index: 2 }),
    ).toEqual({ ok: false, reason: 'insufficient-funds' })
    full.state.economy.balance = 400
    expect(
      full.dispatch({ kind: 'placeDesk', nodeId: 'slot4', index: 2 }).ok,
    ).toBe(true)
    expect(slotForPurchase(full)).toBeNull()
    full.state.economy.balance = price('dock2') + buffer
    expect(stepStatus(full, LEVEL_PLAN[3]![0]!, buffer)).toBe('impossible')
    expect(stepCmds(full, createPolicy(full, 'competent'))).toEqual([
      { kind: 'buyDock', index: 2 },
    ])
  })

  it('a vehicle step waits with an empty driver pool; dock 3 / the Sorter Arm are impossible below their level; the Arm is impossible with a sorter seated, else ready at price + $50', () => {
    const sim = l3Sim(1_000_000)
    sim.state.applicants.driver = []
    expect(
      stepStatus(sim, { kind: 'vehicle', type: 'van', count: 1 }, buffer),
    ).toBe('waiting')
    expect(stepStatus(sim, { kind: 'dock', index: 3 }, buffer)).toBe(
      'impossible',
    )
    expect(stepStatus(sim, { kind: 'sorterArm' }, buffer)).toBe('impossible')
    expect(stepStatus(sim, { kind: 'machine', defId: 'xray' }, buffer)).toBe(
      'impossible',
    )
    const l4 = fund(quietSim(1))
    expect(l4.dispatch({ kind: 'debugForceLevel', level: 4 }).ok).toBe(true)
    const arm = data.machines.upgrades.find((u) => u.id === 'sorter_arm')!
    l4.state.economy.balance = arm.price + buffer - 1
    expect(stepStatus(l4, { kind: 'sorterArm' }, buffer)).toBe('waiting')
    l4.state.economy.balance += 1
    expect(stepStatus(l4, { kind: 'sorterArm' }, buffer)).toBe('ready')
    const a = bestApplicant(l4, 'sorter')!
    expect(
      l4.dispatch({
        kind: 'hire',
        role: 'sorter',
        applicantId: a.id,
        target: { station: 'hold' },
      }).ok,
    ).toBe(true)
    expect(stepStatus(l4, { kind: 'sorterArm' }, buffer)).toBe('impossible')
  })

  it('COUNTERS waits for the plan: at L3 with a free slot the Battery checker takes it, never a counter', () => {
    const sim = l3Sim(1_000_000, ['metal_detector', 'shaky_shaker'])
    const cmds = stepCmds(sim, createPolicy(sim, 'competent'))
    expect(cmds).toEqual([
      { kind: 'buyMachine', defId: 'battery_checker', nodeId: 'slot4' },
    ])
  })

  it('desk 2 only when the dock-blocked rule fires with desk 1 full: REPLACE allowed, the best inspector seated there in the same step (one hire per day); dock 2 is next', () => {
    // desk 1, Shaky shaker, Battery checker, Shaky shaker: no plan machine
    // waits (the Battery checker is owned); desk 2 at $400 + $50 REPLACEs
    // the duplicate shaker (refund $150).
    const sim = l3Sim(1000, ['shaky_shaker', 'metal_detector', 'shaky_shaker'])
    expect(sim.dispatch({ kind: 'removeFixture', nodeId: 'slot3' }).ok).toBe(
      true,
    )
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'battery_checker',
        nodeId: 'slot3',
      }).ok,
    ).toBe(true)
    fillDesk1(sim) // on tick 0: not "hired today" (the start-crew guard)
    runTicks(sim, 1)
    const policy = createPolicy(sim, 'competent')
    sim.state.economy.balance = 400
    sim.state.lane.docks[0]!.blockedTicksThisDay =
      POLICY_PARAMS.dockBlockedHireS * 10
    expect(stepCmds(sim, policy)).toEqual([]) // exactly 10 s: not yet
    sim.state.lane.docks[0]!.blockedTicksThisDay += 1
    const best = bestApplicant(sim, 'inspector')!
    expect(stepCmds(sim, policy)).toEqual([
      { kind: 'removeFixture', nodeId: 'slot4' },
      { kind: 'placeDesk', nodeId: 'slot4', index: 2 },
      {
        kind: 'hire',
        role: 'inspector',
        applicantId: best.id,
        target: { nodeId: 'slot4' },
      },
    ])
    const desk2 = laneNode(sim.state.lane, 'slot4')!.fixture
    expect(desk2).toMatchObject({ kind: 'desk', index: 2 })
    sim.state.economy.balance = 1_000_000
    expect(stepStatus(sim, LEVEL_PLAN[3]![0]!, buffer)).toBe('done')
    expect(stepCmds(sim, policy)).toEqual([{ kind: 'buyDock', index: 2 }])
    // Desk 1 with a free seat: the hire goes there, no desk 2.
    const other = l3Sim(400)
    other.state.lane.docks[0]!.blockedTicksThisDay = 200
    const pick = bestApplicant(other, 'inspector')!
    expect(stepCmds(other, createPolicy(other, 'competent'))).toEqual([
      {
        kind: 'hire',
        role: 'inspector',
        applicantId: pick.id,
        target: { nodeId: 'slot1' },
      },
    ])
  })

  it('desk 2 waits while a plan machine is pending (M8 review): desk 1 full, the dock-blocked rule firing and desk 2 affordable, the Battery checker keeps its REPLACE slot and is bought first; desk 2 then has no slot', () => {
    // desk 1 (full), Metal, Metal, Shaky shaker: desk 2 ($400 + $50 − $75)
    // affordable at $420, the Battery checker ($500 + $50 − $75) not.
    const sim = l3Sim(1000)
    fillDesk1(sim)
    runTicks(sim, 1)
    const policy = createPolicy(sim, 'competent')
    sim.state.economy.balance = 420
    sim.state.lane.docks[0]!.blockedTicksThisDay =
      POLICY_PARAMS.dockBlockedHireS * 10 + 1
    const battery = LEVEL_PLAN[3]![0]!
    expect(stepStatus(sim, battery, buffer)).toBe('waiting')
    expect(placeNextDesk(sim, buffer)).toBe(false)
    expect(stepCmds(sim, policy)).toEqual([])
    expect(laneNode(sim.state.lane, 'slot3')?.fixture).toMatchObject({
      checker: { defId: 'metal_detector' },
    })
    sim.state.economy.balance = price('battery_checker') + buffer - refund
    expect(stepCmds(sim, policy)).toEqual([
      { kind: 'removeFixture', nodeId: 'slot3' },
      { kind: 'buyMachine', defId: 'battery_checker', nodeId: 'slot3' },
    ])
    expect(stepStatus(sim, battery, buffer)).toBe('done')
    // desk 1, Metal, Battery, Shaker: no free slot, no duplicate.
    sim.state.economy.balance = 1_000_000
    expect(placeNextDesk(sim, buffer)).toBe(false)
    expect(stepCmds(sim, policy)).toEqual([{ kind: 'buyDock', index: 2 }])
    expect(
      sim.state.lane.nodes.filter((n) => n.fixture?.kind === 'desk'),
    ).toHaveLength(1)
  })
})

/** Buy a `type` with the best driver (a standard one when the pool is empty). */
function buyWithBest(sim: Sim, type: VehicleType): void {
  const a =
    bestApplicant(sim, 'driver', type) ?? standardApplicant(sim, 'driver')
  expect(sim.dispatch({ kind: 'buyVehicle', type, applicantId: a.id }).ok).toBe(
    true,
  )
}

/**
 * A quiet sim forced to L4 with the L3 plan done (desk 1, Metal detector,
 * Battery checker, Shaky shaker; dock 2; 3 bikes, a truck, a van, a 2nd
 * truck) and `balance` dollars; slot 5 is empty and the station free.
 */
function l4Sim(balance: number): Sim {
  const sim = l3Sim(1_000_000)
  expect(sim.dispatch({ kind: 'removeFixture', nodeId: 'slot3' }).ok).toBe(true)
  expect(
    sim.dispatch({
      kind: 'buyMachine',
      defId: 'battery_checker',
      nodeId: 'slot3',
    }).ok,
  ).toBe(true)
  expect(sim.dispatch({ kind: 'buyDock', index: 2 }).ok).toBe(true)
  buyWithBest(sim, 'van')
  buyWithBest(sim, 'truck')
  expect(levelPlanDone(sim)).toBe(true)
  expect(sim.dispatch({ kind: 'debugForceLevel', level: 4 }).ok).toBe(true)
  quiet(sim)
  sim.state.economy.balance = balance
  return sim
}

describe('the L4-L5 plan (B2 §7.2 L4-L5 rows; design-m8-m9 §5.1, §7 M9 item 8)', () => {
  const buffer = POLICY_PARAMS.purchaseBuffer

  it('NEW STRAIN FIRST (M9 policy extension): L4 arrives with the L3 van and 2nd truck unbought → the X-ray (the dense strain’s counter) is bought first, then the L3 steps resume in order, then dock 3; nothing is bought while the X-ray is $1 short', () => {
    const sim = l3Sim(1_000_000)
    // The L3 plan half done: the Battery checker REPLACE and dock 2 only.
    expect(sim.dispatch({ kind: 'removeFixture', nodeId: 'slot3' }).ok).toBe(
      true,
    )
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'battery_checker',
        nodeId: 'slot3',
      }).ok,
    ).toBe(true)
    expect(sim.dispatch({ kind: 'buyDock', index: 2 }).ok).toBe(true)
    expect(levelPlanDone(sim)).toBe(false)
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 4 }).ok).toBe(true)
    quiet(sim)
    const policy = createPolicy(sim, 'competent')
    // One purchase's worth (the X-ray and the van both cost price + $50):
    // the X-ray, not the L3 van; $1 short, nothing at all.
    expect(price('van')).toBeLessThanOrEqual(price('xray'))
    sim.state.economy.balance = price('xray') + buffer - 1
    expect(stepCmds(sim, policy)).toEqual([])
    sim.state.economy.balance += 1
    expect(stepCmds(sim, policy)).toEqual([
      { kind: 'buyMachine', defId: 'xray', nodeId: 'slot5' },
    ])
    expect(sim.state.economy.balance).toBe(buffer)
    sim.state.economy.balance = 1_000_000
    for (const type of ['van', 'truck'] as const) {
      if (!bestApplicant(sim, 'driver', type)) standardApplicant(sim, 'driver')
      const a = bestApplicant(sim, 'driver', type)!
      expect(stepCmds(sim, policy), type).toEqual([
        { kind: 'buyVehicle', type, applicantId: a.id },
      ])
    }
    expect(stepCmds(sim, policy)).toEqual([{ kind: 'buyDock', index: 3 }])
  })

  it('on a funded forced-L4 sim: the X-ray into slot 5 → dock 3 → the Sorter Arm into the empty station → a 2nd van, each at price + $50, one per step; nothing is bought while the next step is unaffordable; then COUNTERS has no slot', () => {
    const sim = l4Sim(0)
    const policy = createPolicy(sim, 'competent')
    expect(liveSlotIds(sim.state.lane)).toHaveLength(5)
    expect(planSteps(sim).filter((st) => !LEVEL_PLAN[3]!.includes(st))).toEqual(
      LEVEL_PLAN[4],
    )
    const hold = sim.state.lane.holdBayNodeId
    const steps: [number, Command][] = [
      [price('xray'), { kind: 'buyMachine', defId: 'xray', nodeId: 'slot5' }],
      [price('dock3'), { kind: 'buyDock', index: 3 }],
      [
        price('sorter_arm'),
        { kind: 'buyMachine', defId: 'sorter_arm', nodeId: hold },
      ],
      [
        price('van'),
        { kind: 'buyVehicle', type: 'van', applicantId: Number.NaN },
      ],
    ]
    for (const [cost, cmd] of steps) {
      sim.state.economy.balance = cost + buffer - 1
      expect(stepCmds(sim, policy), `${cmd.kind} $1 short`).toEqual([])
      sim.state.economy.balance += 1
      if (cmd.kind === 'buyVehicle' && !bestApplicant(sim, 'driver', 'van')) {
        standardApplicant(sim, 'driver')
      }
      const want =
        cmd.kind === 'buyVehicle'
          ? {
              ...cmd,
              applicantId: bestApplicant(sim, 'driver', cmd.type)!.id,
            }
          : cmd
      expect(stepCmds(sim, policy)).toEqual([want])
    }
    expect(laneNode(sim.state.lane, 'slot5')?.fixture).toMatchObject({
      checker: { defId: 'xray' },
    })
    expect(sim.state.lane.docks.map((d) => d.id)).toEqual([
      'dock1',
      'dock2',
      'dock3',
    ])
    expect(sim.state.lane.holdStation.fixture).toBe('sorter_arm')
    expect(sim.state.vehicles.filter((v) => v.type === 'van')).toHaveLength(2)
    expect(levelPlanDone(sim)).toBe(true)
    expect(levelPlanStep(sim, buffer)).toBe('done')
    // The plan is done and no slot is free: a fortune buys nothing more.
    sim.state.economy.balance = 1_000_000
    expect(stepCmds(sim, policy)).toEqual([])
  })

  it('L5: the Golden Release, offered on the level:up {5} tick, is accepted on the next policy step with the 3rd truck at price + $50 in the same step; COUNTERS then fills slot 6 with the weakest strain’s counter at price + $50', () => {
    const sim = l4Sim(1_000_000)
    const policy = createPolicy(sim, 'competent')
    for (let i = 0; i < 4; i++) policy.step()
    expect(levelPlanDone(sim)).toBe(true)
    noOffers(sim)
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 5 }).ok).toBe(true)
    quiet(sim)
    runTicks(sim, 1)
    const offer = sim.state.quests.offer
    expect(offer).toMatchObject({
      ultimate: true,
      templateId: 'golden_release',
    })
    expect(planSteps(sim).at(-1)).toEqual(LEVEL_PLAN[5]![0])
    if (!bestApplicant(sim, 'driver', 'truck')) {
      standardApplicant(sim, 'driver')
    }
    sim.state.economy.balance = price('truck') + buffer - 1
    // Unaffordable truck: the accept still happens (the quest rule comes first).
    expect(stepCmds(sim, policy)).toEqual([
      { kind: 'acceptQuest', questId: offer!.id },
    ])
    expect(sim.state.quests.active?.ultimate).toBe(true)
    sim.state.economy.balance += 1
    const driver = bestApplicant(sim, 'driver', 'truck')!
    expect(stepCmds(sim, policy)).toEqual([
      { kind: 'buyVehicle', type: 'truck', applicantId: driver.id },
    ])
    expect(sim.state.vehicles.filter((v) => v.type === 'truck')).toHaveLength(3)
    expect(levelPlanDone(sim)).toBe(true)
    // COUNTERS: slot 6 (the L5 slot) gets the weakest announced strain's counter.
    expect(liveSlotIds(sim.state.lane)).toHaveLength(6)
    const counter = weakestCounter(sim)!
    sim.state.economy.balance = counter.price + buffer - 1
    expect(stepCmds(sim, policy)).toEqual([])
    sim.state.economy.balance += 1
    expect(stepCmds(sim, policy)).toEqual([
      { kind: 'buyMachine', defId: counter.id, nodeId: 'slot6' },
    ])
    // Never a decline or an abandon of the ultimate.
    expect(
      sim.commandLog.filter(
        (e) => e.cmd.kind === 'declineQuest' || e.cmd.kind === 'abandonQuest',
      ),
    ).toEqual([])
  })

  it('the same step accepts the Golden Release and buys the 3rd truck when both can happen', () => {
    const sim = l4Sim(1_000_000)
    const policy = createPolicy(sim, 'competent')
    for (let i = 0; i < 4; i++) policy.step()
    noOffers(sim)
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 5 }).ok).toBe(true)
    quiet(sim)
    runTicks(sim, 1)
    if (!bestApplicant(sim, 'driver', 'truck')) {
      standardApplicant(sim, 'driver')
    }
    sim.state.economy.balance = price('truck') + buffer
    const driver = bestApplicant(sim, 'driver', 'truck')!
    const offer = sim.state.quests.offer!
    expect(offer.ultimate).toBe(true)
    expect(stepCmds(sim, policy)).toEqual([
      { kind: 'acceptQuest', questId: offer.id },
      { kind: 'buyVehicle', type: 'truck', applicantId: driver.id },
    ])
  })

  it('with the Sorter Arm in the station the policy leaves the Hold Bay to it (no hand Toss while a bay is free; the Arm Tosses 3 s later, source arm); with every bay taken it Tosses by hand; without the Arm it Tosses at once', () => {
    const sim = l4Sim(1_000_000)
    const policy = createPolicy(sim, 'competent')
    for (let i = 0; i < 4; i++) policy.step()
    expect(sim.state.lane.holdStation.fixture).toBe('sorter_arm')
    expect(armHoldsBay(sim)).toBe(true)
    const tossed = collect(sim, 'parcel:tossed')
    const first = heldParcel(sim, { malware: true, strain: 'metal' })
    expect(stepCmds(sim, policy)).toEqual([])
    const delay = ticksFromS(
      data.machines.upgrades.find((u) => u.id === 'sorter_arm')!.autoTossDelayS,
    )
    for (let t = 0; t < delay; t++) {
      expect(stepCmds(sim, policy)).toEqual([])
      sim.tick()
    }
    expect(tossed).toEqual([
      expect.objectContaining({ id: first.id, source: 'arm' }),
    ])
    // Every bay taken: the policy Tosses them all by hand on its next step.
    const hold = laneNode(sim.state.lane, sim.state.lane.holdBayNodeId)!
    const cap = hold.cap!
    const full = Array.from({ length: cap }, () =>
      heldParcel(sim, { malware: true, strain: 'metal' }),
    )
    expect(armHoldsBay(sim)).toBe(false)
    expect(stepCmds(sim, policy)).toEqual(
      full.map((p) => ({ kind: 'toss', parcelId: p.id })),
    )
    expect(armHoldsBay(sim)).toBe(true)
    // Without the Arm (removed for its refund): Toss on the step it is held.
    expect(
      sim.dispatch({
        kind: 'removeFixture',
        nodeId: sim.state.lane.holdBayNodeId,
      }).ok,
    ).toBe(true)
    sim.state.economy.balance = 0 // the plan would buy it back
    expect(armHoldsBay(sim)).toBe(false)
    const again = heldParcel(sim, { malware: true, strain: 'metal' })
    expect(stepCmds(sim, policy)).toEqual([
      { kind: 'toss', parcelId: again.id },
    ])
  })

  it('the delegating kind never buys the Arm (its sorter holds the station) and runs the rest of the L4-L5 plan', () => {
    const sim = l4Sim(1_000_000)
    const a = bestApplicant(sim, 'sorter')!
    expect(
      sim.dispatch({
        kind: 'hire',
        role: 'sorter',
        applicantId: a.id,
        target: { station: 'hold' },
      }).ok,
    ).toBe(true)
    const policy = createPolicy(sim, 'delegating')
    const cmds: Command[] = []
    for (let i = 0; i < 4; i++) cmds.push(...stepCmds(sim, policy))
    const buys = cmds.filter(
      (c) =>
        c.kind === 'buyMachine' ||
        c.kind === 'buyDock' ||
        c.kind === 'buyVehicle',
    )
    expect(buys.map((c) => c.kind)).toEqual([
      'buyMachine',
      'buyDock',
      'buyVehicle',
    ])
    expect(buys[0]).toMatchObject({ defId: 'xray', nodeId: 'slot5' })
    expect(typeof sim.state.lane.holdStation.fixture).toBe('number')
    expect(armHoldsBay(sim)).toBe(false)
    expect(levelPlanDone(sim)).toBe(true)
  })
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

/** A minute as a tick. */
const at = (min: number): number => Math.round(min * TICKS_PER_DAY)

/** A recorded quest event. */
const q = (
  tick: number,
  name: string,
  questId: string,
  templateId: string,
  extra: Record<string, unknown> = {},
): RecordedEvent =>
  ({ tick, name, questId, templateId, ...extra }) as RecordedEvent

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

  it('the competent gate prints the people rows, the M8 overseas / dock rows, the M9 rows (dock 3, armTosses, Golden Release, victory) and the M7 quest printout as informational; no delegating row', () => {
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
    // Gated since M7 / M8: checks, not informational rows.
    for (const k of [
      'questsOfferedBy30MinMin',
      'questsCompletedBy30MinMin',
      'level3Min',
      'firstOverseasClearedAfterLevel3MaxMin',
      'level4Min',
      'level5Min',
    ]) {
      expect(info[k], k).toBeUndefined()
    }
    // M8: printed only.
    expect(info.overseasCleared).toMatchObject({ note: 'informational' })
    expect(info.overseasCleared!.median!).toBeGreaterThan(0)
    expect(info.overseasLivesLost?.note).toBe('informational')
    expect(info.dock2Min?.note).toBe('informational')
    expect(info.dock2Min!.median!).toBeGreaterThan(
      median(runs().map((r) => r.result.metrics.level3Min))! - 1e-9,
    )
    // M9: printed only, without the "(M9)" tag.
    for (const k of [
      'dock3Min',
      'armTosses',
      'goldenReleaseOfferedMaxMin',
      'victoryMaxMin',
    ]) {
      expect(info[k]?.note, k).toBe('informational')
    }
    const meds = g.medians
    if (meds.dock3Min !== null) {
      expect(meds.dock3Min).toBeGreaterThanOrEqual(meds.level4Min! - 1e-9)
    }
    expect(info.goldenReleaseOfferedMaxMin?.median).toBe(
      meds.goldenReleaseOfferedMin,
    )
    expect(info.goldenReleaseOfferedMaxMin?.target).toContain(
      `≤ ${targets.goldenReleaseOfferedMaxMin} min`,
    )
    expect(info.victoryMaxMin?.target).toContain(
      `≤ ${targets.victoryMaxMin} min`,
    )
    expect(info.armTosses?.median).toBe(meds.armTosses)
    const n = runs().filter(
      (r) => r.result.metrics.questActive7to13 === 1,
    ).length
    expect(info.questActive7to13?.text).toBe(`${n}/10 seeds`)
    expect(info.magicOnTime?.text).toMatch(/^\d+\/\d+$/)
    expect(info['quest:magic_parcel']?.text).toMatch(
      /^offered \d+ · completed \d+ · failed \d+ · declined \d+$/,
    )
    expect(info.delegatingLivesLost).toBeUndefined()
  })

  it('quest rows from the events: offers / completions by 30 min, the 7-13 minute plateau, Golden Release / victory minutes, magic counts, per-template tallies', () => {
    const events = [
      q(at(3), 'quest:offered', 'q1', 'magic_parcel', { ultimate: false }),
      q(at(3), 'quest:accepted', 'q1', 'magic_parcel'),
      q(at(4), 'quest:completed', 'q1', 'magic_parcel'),
      q(at(6), 'quest:offered', 'q2', 'rush_district', { ultimate: false }),
      q(at(6), 'quest:accepted', 'q2', 'rush_district'),
      q(at(6.9), 'quest:failed', 'q2', 'rush_district', { reason: 'timeout' }),
      q(at(9), 'quest:offered', 'q3', 'big_haul', { ultimate: false }),
      q(at(10), 'quest:declined', 'q3', 'big_haul', { reason: 'expired' }),
      q(at(29), 'quest:offered', 'q4', 'golden_release', { ultimate: true }),
      q(at(29), 'quest:accepted', 'q4', 'golden_release'),
      q(at(30), 'quest:completed', 'q4', 'golden_release'),
      { tick: at(30), name: 'game:victory', day: 30 } as RecordedEvent,
      q(at(31), 'quest:offered', 'q5', 'rush_district', { ultimate: false }),
      q(at(31), 'quest:accepted', 'q5', 'rush_district'),
      q(at(31.5), 'quest:completed', 'q5', 'rush_district'),
    ]
    const stats = makeSim(1).state.stats
    const m = computeMetrics(1, 35, events, [], stats)
    expect(m).toMatchObject({
      questsOffered30: 4, // q5 at 31:00 is past the window
      questsCompleted30: 2, // q1, q4 (q5 at 31:30 is not)
      questActive7to13: 0, // q2 ended at 6:54; q3 was never accepted
      goldenReleaseOfferedMin: 29,
      victoryMin: 30,
      magicSpawned: 1,
      magicOnTime: 1,
    })
    expect(m.questsByTemplate).toEqual({
      magic_parcel: { offered: 1, completed: 1, failed: 0, declined: 0 },
      rush_district: { offered: 2, completed: 1, failed: 1, declined: 0 },
      big_haul: { offered: 1, completed: 0, failed: 0, declined: 1 },
      golden_release: { offered: 1, completed: 1, failed: 0, declined: 0 },
    })
    // An interval touching minute 7 counts; one still open at the end runs to it.
    const touching = [
      q(at(6), 'quest:accepted', 'q1', 'rush_district'),
      q(at(7), 'quest:failed', 'q1', 'rush_district', { reason: 'timeout' }),
    ]
    expect(questMetrics(touching, at(30)).questActive7to13).toBe(1)
    const open = [q(at(12.9), 'quest:accepted', 'q1', 'rush_district')]
    expect(questMetrics(open, at(30)).questActive7to13).toBe(1)
    expect(questMetrics(open, at(12)).questActive7to13).toBe(1)
    const late = [q(at(13.1), 'quest:accepted', 'q1', 'rush_district')]
    expect(questMetrics(late, at(30)).questActive7to13).toBe(0)
    expect(
      questTallies([m, m]).find(([id]) => id === 'rush_district')?.[1],
    ).toEqual({ offered: 4, completed: 2, failed: 2, declined: 0 })
  })

  it('the quest rows gate behind SIM_FEATURES.quests and print informational below 30 minutes (the quick gate)', () => {
    const inputs = {
      firstDeliveryS: 40,
      firstMalwareCaughtS: 100,
      level2Min: 12,
      truckAfterLevel2Min: 2,
      livesLost: 0,
      shelfStallS: 0,
      holdBayEventsPer10MinL1: 7,
      questsOffered30: 3,
      questsCompleted30: 2,
    }
    const notes = (minutes: number | undefined, quests = true) =>
      Object.fromEntries(
        checkMetrics({ ...inputs, minutes }, targets, {
          ...SIM_FEATURES,
          quests,
        }).map((c) => [c.key, [c.note, c.pass]]),
      )
    expect(notes(30)).toMatchObject({
      questsOfferedBy30MinMin: [null, false], // 3 < 4
      questsCompletedBy30MinMin: [null, true],
    })
    expect(notes(undefined).questsOfferedBy30MinMin).toEqual([null, false])
    expect(notes(20)).toMatchObject({
      questsOfferedBy30MinMin: ['informational (minutes too short)', false],
      questsCompletedBy30MinMin: ['informational (minutes too short)', true],
      level2Min: [null, true],
    })
    expect(notes(30, false).questsOfferedBy30MinMin?.[0]).toBe(
      'informational (M7)',
    )
    expect(windowNote('questsOfferedBy30MinMin', SIM_FEATURES, 29)).toBe(
      'informational (minutes too short)',
    )
    expect(windowNote('maxLivesLost', SIM_FEATURES, 1)).toBeNull()
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

  it('--baseline: the Δ% of the playtest-1 medians and L3-L5, "within band" — ±5 % for the playtest-1 rows, −12…−8 % for the level rows (B3 §2.1; both never = within, a 0 baseline compares absolutely)', () => {
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
        check('questsOfferedBy30MinMin', 6), // M7: never compared
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
      'baseline rows within band (±5 %; level rows −12…−8 %): no (rows: level2Min -5.9%, maxLivesLost —)',
    )
    // The level rows are meant to move −8…−12 % (B3 §2.1).
    expect(withinShift(13.05, 13.05 * 0.9, [-0.12, -0.08])).toBe(true)
    expect(withinShift(13.05, 13.05 * 0.95, [-0.12, -0.08])).toBe(false)
    expect(withinShift(null, null, [-0.12, -0.08])).toBe(true)
    const g = summarise(
      runs().map((r) => r.result),
      meta('competent'),
    )
    g.baseline = compareBaseline(g, g, 'self.json')
    expect(g.baseline.rows.map((r) => r.key)).toEqual(
      BASELINE_KEYS.filter((k) => g.checks.some((c) => c.key === k)),
    )
    // Against itself the playtest-1 rows hold and the level rows did not move.
    expect(g.baseline.rows.filter((r) => !r.within).map((r) => r.key)).toEqual([
      'level2Min',
      'level3Min',
      'level4Min',
      'level5Min',
    ])
    // A baseline 10 % slower on every level row: every row within band.
    const slower = {
      dataHash: 'b2',
      checks: g.checks.map((c) =>
        LEVEL_BASELINE_BAND[c.key as keyof typeof LEVEL_BASELINE_BAND] &&
        c.value !== null
          ? { ...c, value: c.value / 0.9 }
          : c,
      ),
    }
    g.baseline = compareBaseline(g, slower, 'b2.json')
    expect(g.baseline.within).toBe(true)
    expect(baselineLine(g.baseline)).toBe(
      'baseline rows within band (±5 %; level rows −12…−8 %): yes',
    )
    const md = gateMarkdown(g, 'vlr sim:gate -- --baseline b2.json')
    expect(md).toContain(
      '| window | median | target | result | Δ% vs baseline |',
    )
    expect(md).toContain(
      'baseline rows within band (±5 %; level rows −12…−8 %): yes',
    )
  }, 60_000)

  it('cli: the per-run quests line (offers / completions by 30 min, the plateau, magic, per template)', () => {
    const r = runSeed(data, 1, 30, createPolicy)
    const m = r.result.metrics
    const line = questsLine(r)
    expect(line).toContain(
      `# quests: ${m.questsOffered30} offered · ${m.questsCompleted30} completed by 30 min`,
    )
    expect(line).toContain(`magic ${m.magicOnTime}/${m.magicSpawned} on time`)
    for (const [id, t] of Object.entries(m.questsByTemplate)) {
      expect(line).toContain(`${id} ${t.completed}/${t.offered}`)
    }
  }, 30_000)

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

/** A recorded parcel:cleared at the Docks. */
const clearedAt = (tick: number, id: number, malware: boolean): RecordedEvent =>
  ({
    tick,
    name: 'parcel:cleared',
    id,
    paid: malware ? 0 : 30,
    malware,
    hub: 'docks',
    buildingId: 'dk_pier_1',
    onTime: true,
  }) as RecordedEvent

/** gateFileBase's options. */
const fileOpts = (
  minutes: number,
  policy: 'delegating' | null = null,
  quick = false,
) => ({ minutes, policy, quick })

describe('the gate report, M8 (tools/sim/report.ts + cli.ts; design-m8-m9 §5.3)', () => {
  it('L3 rows from the events: minutes from level:up {3} to the first parcel:cleared, clearances, lives lost at a clearance, dock 2 / dock 3 minutes', () => {
    const stats = makeSim(1).state.stats
    const events = [
      { tick: at(17), name: 'level:up', level: 3 } as RecordedEvent,
      ev('dock:bought', { tick: at(17.5), index: 2, dockId: 'dock2' }),
      clearedAt(at(19.25), 5, false),
      clearedAt(at(20), 6, true),
      ev('life:lost', { tick: at(20), report: { viaClearance: true } }),
      ev('life:lost', { tick: at(21), report: { viaClearance: false } }),
    ]
    const m = computeMetrics(1, 30, events, [], stats)
    expect(m).toMatchObject({
      level3Min: 17,
      firstOverseasClearedAfterLevel3Min: 2.25,
      overseasCleared: 2,
      overseasLivesLost: 1,
      livesLost: 2,
      dock2Min: 17.5,
      dock3Min: null,
    })
    const noL3 = computeMetrics(1, 30, events.slice(1), [], stats)
    expect(noL3.level3Min).toBeNull()
    expect(noL3.firstOverseasClearedAfterLevel3Min).toBeNull()
    const noClear = computeMetrics(1, 30, events.slice(0, 2), [], stats)
    expect(noClear.firstOverseasClearedAfterLevel3Min).toBeNull()
    expect(noClear.overseasCleared).toBe(0)
  })

  it('level3Min / firstOverseasClearedAfterLevel3MaxMin gate behind levels3plus, level4Min / level5Min behind levels45 (on since M9); informational in --quick and on a run shorter than the window end', () => {
    const inputs = {
      firstDeliveryS: 40,
      firstMalwareCaughtS: 100,
      level2Min: 12,
      truckAfterLevel2Min: 2,
      livesLost: 0,
      shelfStallS: 0,
      holdBayEventsPer10MinL1: 7,
      questsOffered30: 5,
      questsCompleted30: 3,
      level3Min: 17.5 as number | null,
      firstOverseasClearedAfterLevel3Min: 2.5 as number | null,
      level4Min: null as number | null,
      level5Min: null as number | null,
    }
    const rows = (
      over: Partial<typeof inputs> & { minutes?: number; quick?: boolean },
      features = SIM_FEATURES,
    ) =>
      Object.fromEntries(
        checkMetrics({ ...inputs, ...over }, targets, features)
          .filter((c) =>
            [
              'level3Min',
              'firstOverseasClearedAfterLevel3MaxMin',
              'level4Min',
              'level5Min',
            ].includes(c.key),
          )
          .map((c) => [c.key, [c.note, c.pass]]),
      )
    expect(rows({ minutes: 30 })).toEqual({
      level3Min: [null, true],
      firstOverseasClearedAfterLevel3MaxMin: [null, true],
      level4Min: [null, false],
      level5Min: [null, false],
    })
    expect(
      rows({ level3Min: 20.5, firstOverseasClearedAfterLevel3Min: 3.1 }),
    ).toMatchObject({
      level3Min: [null, false],
      firstOverseasClearedAfterLevel3MaxMin: [null, false],
    })
    expect(rows({ level3Min: targets.level3Min[0] - 0.1 }).level3Min).toEqual([
      null,
      false,
    ])
    expect(rows({ level3Min: null }).level3Min).toEqual([null, false])
    expect(rows({ minutes: 20, quick: true })).toMatchObject({
      level3Min: ['informational (quick)', true],
      firstOverseasClearedAfterLevel3MaxMin: ['informational (quick)', true],
    })
    expect(levelWindowMinutes('level3Min', targets)).toBe(targets.level3Min[1])
    expect(
      levelWindowMinutes('firstOverseasClearedAfterLevel3MaxMin', targets),
    ).toBe(targets.level3Min[1] + targets.firstOverseasClearedAfterLevel3MaxMin)
    expect(levelWindowMinutes('level2Min', targets)).toBeNull()
    const end = targets.level3Min[1]
    const both = end + targets.firstOverseasClearedAfterLevel3MaxMin
    expect(rows({ minutes: end })).toMatchObject({
      level3Min: [null, true],
      firstOverseasClearedAfterLevel3MaxMin: [
        `informational (run < ${both} min)`,
        true,
      ],
    })
    expect(rows({ minutes: end - 1 }).level3Min).toEqual([
      `informational (run < ${end} min)`,
      true,
    ])
    const m7 = { ...SIM_FEATURES, levels3plus: false }
    expect(rows({ minutes: 30 }, m7).level3Min).toEqual([
      'informational (M8)',
      true,
    ])
    // M9: levels45 on — L4/L5 gate (null = never reached = fail).
    expect(SIM_FEATURES.levels45).toBe(true)
    expect(
      rows({
        minutes: 30,
        level4Min: targets.level4Min[1] - 0.5,
        level5Min: targets.level5Min[1] - 0.5,
      }),
    ).toMatchObject({
      level4Min: [null, true],
      level5Min: [null, true],
    })
    expect(
      rows({
        minutes: 30,
        level4Min: targets.level4Min[1] + 0.5,
        level5Min: targets.level5Min[0] - 0.1,
      }),
    ).toMatchObject({
      level4Min: [null, false],
      level5Min: [null, false],
    })
    expect(rows({ minutes: 20, quick: true }).level5Min).toEqual([
      'informational (quick)',
      false,
    ])
    const l5End = targets.level5Min[1]
    expect(rows({ minutes: Math.ceil(l5End) - 1 }).level5Min).toEqual([
      `informational (run < ${l5End} min)`,
      false,
    ])
    const m8 = { ...SIM_FEATURES, levels45: false }
    expect(rows({ minutes: 30 }, m8).level4Min).toEqual([
      'informational (M9)',
      false,
    ])
    expect(windowNote('level3Min', SIM_FEATURES, 20, { quick: true })).toBe(
      'informational (quick)',
    )
    expect(windowNote('maxLivesLost', SIM_FEATURES, 20, { quick: true })).toBe(
      null,
    )
  })

  it('the quick summary notes the level rows "informational (quick)" (vlr check never fails on L3); per seed too', () => {
    const res = runs()
      .slice(0, 3)
      .map((r) => ({
        ...r.result,
        metrics: { ...r.result.metrics, minutes: 20, level3Min: null },
      }))
    const g = summarise(res, { ...meta('competent'), minutes: 20, quick: true })
    const l3 = g.checks.find((c) => c.key === 'level3Min')!
    expect(l3).toMatchObject({ value: null, pass: false })
    expect(l3.note).toBe('informational (quick)')
    expect(checkOk(l3)).toBe(true)
    const r = runSeed(data, 1, 1, createPolicy, { quick: true })
    expect(r.result.checks.find((c) => c.key === 'level3Min')?.note).toBe(
      'informational (quick)',
    )
  }, 60_000)

  it('the gate table carries L3_min, ovs+min, L4_min, L5_min and (M9) GR_min', () => {
    const g = summarise(
      runs().map((r) => r.result),
      meta('competent'),
    )
    const head = formatGate(g)[1]!
    for (const col of ['L3_min', 'ovs+min', 'L4_min', 'L5_min', 'GR_min']) {
      expect(head).toContain(col)
    }
    const md = gateMarkdown(g, 'vlr sim:gate')
    expect(md).toContain('| L3_min | ovs+min | L4_min | L5_min | GR_min |')
    expect(md).toContain('| `level3Min` |')
  }, 60_000)

  it('cli: only the 30-minute gate writes latest.*; another length writes latest-<N>min.* (delegating-<N>min.*); --quick writes quick.*', () => {
    expect(gateFileBase(fileOpts(30))).toBe('latest')
    expect(gateFileBase(fileOpts(35))).toBe('latest-35min')
    expect(gateFileBase(fileOpts(20, null, true))).toBe('quick')
    expect(gateFileBase(fileOpts(30, 'delegating'))).toBe('delegating')
    expect(gateFileBase(fileOpts(35, 'delegating'))).toBe('delegating-35min')
    expect(gateFileBase(fileOpts(20, 'delegating', true))).toBe('delegating')
    // `vlr sim:gate -- --minutes 35`: the later --minutes wins.
    expect(
      parseCli([
        '--gate',
        '--seeds',
        '1-10',
        '--minutes',
        '30',
        '--minutes',
        '35',
      ]).minutes,
    ).toBe(35)
  })
})

/** A malware clearance at `hub` (the narrative's loss line). */
const lostAt = (hub: string): RecordedEvent =>
  ({
    tick: 1200,
    name: 'parcel:cleared',
    id: 9,
    paid: 0,
    malware: true,
    hub,
    buildingId: 'x',
    onTime: true,
  }) as RecordedEvent

describe('the gate report, M9 (tools/sim/report.ts; design-m8-m9 §5.3, R11)', () => {
  it('armTosses counts parcel:tossed with source arm; the Golden Release offer and the victory minutes come from the quest events', () => {
    const stats = makeSim(1).state.stats
    const events = [
      ev('parcel:tossed', { tick: at(24), id: 1, source: 'player' }),
      ev('parcel:tossed', { tick: at(24.5), id: 2, source: 'arm' }),
      ev('parcel:tossed', { tick: at(25), id: 3, source: 'arm' }),
      ev('parcel:tossed', { tick: at(25), id: 4, source: 'sorter' }),
      q(at(27.5), 'quest:offered', 'q9', 'golden_release', { ultimate: true }),
      { tick: at(31.25), name: 'game:victory', day: 31 } as RecordedEvent,
    ]
    const m = computeMetrics(1, 35, events, [], stats)
    expect(m).toMatchObject({
      armTosses: 2,
      goldenReleaseOfferedMin: 27.5,
      victoryMin: 31.25,
    })
    expect(computeMetrics(1, 35, [], [], stats).armTosses).toBe(0)
  })

  it('the narrative names the Sorter Arm purchase (once), its first Toss, and an Airport loss as "the plane has left" (a Docks one: "the ship has sailed")', () => {
    const sim = fund(quietSim(1))
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 4 }).ok).toBe(true)
    const h = new Highlights()
    const armPrice = price('sorter_arm')
    const buyArm = {
      tick: 5,
      name: 'money:changed',
      delta: -armPrice,
      reason: 'purchase',
      balance: 0,
    } as RecordedEvent
    // Before the Arm is seated a purchase of the same price is not the Arm.
    expect(h.line(buyArm, sim)).toBeNull()
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'sorter_arm',
        nodeId: sim.state.lane.holdBayNodeId,
      }).ok,
    ).toBe(true)
    expect(h.line(buyArm, sim)).toBe(
      `!  0:00 bought the Sorter Arm into the Hold Bay station ($${armPrice})`,
    )
    expect(h.line(buyArm, sim)).toBeNull()
    const armToss = {
      tick: 600,
      name: 'parcel:tossed',
      id: 7,
      wasMalware: true,
      bounty: 15,
      source: 'arm',
    } as RecordedEvent
    // The hand Tosses of L1-L3 came first (the first malware Toss line).
    expect(h.line({ ...armToss, id: 3, source: 'player' }, sim)).toBe(
      '!  1:00 first malware tossed #3 (+$15)',
    )
    expect(h.line(armToss, sim)).toBe('!  1:00 first Sorter Arm toss #7 (+$15)')
    expect(h.line({ ...armToss, id: 8 }, sim)).toBeNull()
    expect(h.line(lostAt('airport'), sim)).toBe(
      '!  2:00 malware cleared at airport #9 (the plane has left)',
    )
    expect(h.line(lostAt('docks'), sim)).toBe(
      '!  2:00 malware cleared at docks #9 (the ship has sailed)',
    )
  })
})
