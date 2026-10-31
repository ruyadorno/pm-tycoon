// spec §10 lives + §7.3 malware delivered (plan.md §12.5 task 6): malware
// reaching a consumer pays $0, costs the destination −20 and one life;
// life:lost carries the full card payload — the path (every hop with its
// tick: spawned at, picked up by <vehicle>, unloaded, each slot "<checker>:
// missed (p% vs strain)" or "empty", shelved, loaded, delivered to), the
// lane's D(strain), the counter machine and D with it added (or, when the
// lane already holds it, one more unit), clearedByPlayerAt for a parcel the
// player cleared; daysSinceIncident resets; the third loss → game:over;
// economy.continueWithOneLife → grantLife; debug forceMalwareDelivery.

import { describe, expect, it, vi } from 'vitest'
import { counterChoice, traceText } from '../../src/sim/detection.ts'
import type { Sim } from '../../src/sim/sim.ts'
import { deliverParcel } from '../../src/sim/systems/economy.ts'
import { takeFrom } from '../../src/sim/systems/lane.ts'
import type { Parcel, Strain } from '../../src/sim/types.ts'
import { laneNode, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  buy,
  collect,
  collectLost,
  dataFixture,
  feeder,
  heldParcel,
  hireInspector,
  injectParcel,
  laneParcel,
  noCheckers,
  openingA,
  placeMachine,
  quietSim,
  runTicks,
  runUntil,
  standardApplicant,
} from './helpers.ts'

const data = dataFixture()
const s = data.economy.satisfaction
const md = data.machines.checkers.find((c) => c.id === 'metal_detector')!

/** A bike delivers one malware parcel through the current lane. */
function deliverMalware(sim: ReturnType<typeof quietSim>) {
  sim.state.tick = 100
  const bike = buy(sim, 'bike')
  const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { malware: true })
  const lost = collectLost(sim)
  const delivered = collect(sim, 'parcel:delivered')
  expect(runUntil(sim, () => lost.length > 0, 3000)).toBeGreaterThan(0)
  return { bike, p, lost, delivered }
}

/** Malware parcels of `strain` fed through the lane that ended on the shelf (missed by every checker). */
function missed(sim: Sim, n: number, strain: Strain): Parcel[] {
  const shelf = laneNode(sim.state.lane, 'shelf')!
  shelf.cap = null
  const feed = feeder(sim, n, { malware: true, strain })
  for (let t = 0; t < n * 50; t++) {
    feed()
    const hold = laneNode(sim.state.lane, 'hold')!
    for (const id of hold.queue.slice()) {
      sim.dispatch({ kind: 'toss', parcelId: id })
    }
    sim.tick()
  }
  return shelf.queue.map((id) => sim.state.parcels[String(id)]!)
}
/** Deliver one shelf parcel now and return its life:lost payload. */
function card(sim: Sim, p: Parcel) {
  const lost = collectLost(sim)
  takeFrom(laneNode(sim.state.lane, 'shelf')!, p.id)
  deliverParcel(sim, null, p)
  return lost[0]!
}

describe('a malware delivery costs a life (spec §10, §7.3)', () => {
  it('paid $0, −20 to the destination, one life, life:lost with the full path; the counter machine and its rate (not owned)', () => {
    const sim = noCheckers(quietSim(1))
    const balance = sim.state.economy.balance
    const sat = collect(sim, 'satisfaction:changed')
    const { bike, p, lost, delivered } = deliverMalware(sim)
    expect(delivered).toEqual([
      { id: p.id, paid: 0, onTime: true, malware: true },
    ])
    // The bike and its standard driver's hire fee (one day's salary, M6).
    expect(sim.state.economy.balance).toBe(balance - 200 - 8)
    expect(sim.state.economy.lifetimeEarned).toBe(0)
    expect(sat.find((e) => e.district === 'downtown')?.delta).toBe(
      s.malwareDelivered,
    )
    expect(sim.state.economy.lives).toBe(data.economy.lives.start - 1)
    expect(sim.state.economy.daysSinceIncident).toBe(0)
    const l = lost[0]!
    expect(l).toMatchObject({
      parcelId: p.id,
      label: p.label,
      strain: 'metal',
      destBuildingId: 'dt_cache_cafe',
      laneRate: 0,
      counterMachineId: 'metal_detector',
      counterOwned: false,
      clearedByPlayerAt: null,
    })
    expect(l.counterRate).toBeCloseTo(md.pMatch, 10)
    expect(l.path.map((t) => t.text)).toEqual([
      'Picked up by Bike 1',
      'Unloaded',
      'Slot 1: empty',
      'Slot 2: empty',
      'Slot 3: empty',
      'Shelved',
      'Loaded onto Bike 1',
      'Delivered to Cache Cafe',
    ])
    expect(l.path.every((t, i, a) => i === 0 || t.tick >= a[i - 1]!.tick)).toBe(
      true,
    )
    expect(l.path.find((t) => t.what === 'pickedUp')?.ref).toBe(String(bike.id))
    expect(l.report).toMatchObject({
      parcelId: p.id,
      size: 'S',
      originBuildingId: 'hr_towers_a',
      livesLeft: data.economy.lives.start - 1,
      viaClearance: false,
    })
    expect(sim.state.lastLostLife).toEqual(l.report)
    expect(sim.state.stats.malwareMissed).toBe(1)
  })

  it('a spawned parcel’s path starts "Spawned at <building>"; each checker it passed reads "missed (p% vs strain)"', () => {
    const sim = noCheckers(quietSim(1))
    placeMachine(sim, 'shaky_shaker', 'slot2') // rattle: 15 % vs metal
    const p = laneParcel(sim, 'conv1', { malware: true })
    p.trace.unshift({ tick: 0, what: 'spawned', ref: 'hr_towers_a' })
    runTicks(sim, 40)
    const texts = sim.state.parcels[String(p.id)]!.trace.map((t) =>
      traceText(data, t),
    )
    expect(sim.state.parcels[String(p.id)]!.state).toBe('on_shelf') // seed 1: the 85 % miss
    expect(texts).toEqual([
      'Spawned at Node Heights Towers A',
      'Slot 1: empty',
      'Slot 2 Shaky shaker: missed (15% vs metal)',
      'Slot 3: empty',
      'Shelved',
    ])
  })

  it('the counter already in the lane: counterOwned, laneRate = the D it faced, counterRate = D with a second unit', () => {
    const sim = noCheckers(quietSim(1))
    placeMachine(sim, 'metal_detector', 'slot2')
    const vs = createViewSim(sim, { debug: true })
    const lost = collectLost(sim)
    expect(vs.debug?.forceMalwareDelivery()).toEqual({ ok: true })
    const l = lost[0]!
    expect(l.counterMachineId).toBe('metal_detector')
    expect(l.counterOwned).toBe(true)
    expect(l.laneRate).toBeCloseTo(md.pMatch, 10)
    expect(l.counterRate).toBeCloseTo(1 - (1 - md.pMatch) ** 2, 10)
    expect(l.path.map((t) => t.text)).toContain(
      'Slot 2 Metal detector: missed (80% vs metal)',
    )
  })

  it('the card is about the lane THIS parcel went through (§10 "was N %", "got through on the N %"): D recomputed by hand for four lanes, unchanged when the lane changes after it passed', () => {
    const sp = data.machines.checkers.find((c) => c.id === 'shaky_shaker')!
    const insP = data.employees.roles.inspector.p[2]!
    // A. The desk alone vs metal: 0.85; a Metal detector would make it
    //    1 − 0.15 × 0.20 = 0.97. A detector bought after it passed changes nothing.
    {
      const sim = quietSim(11)
      const p = missed(sim, 40, 'metal')[0]!
      placeMachine(sim, 'metal_detector', 'slot2')
      const l = card(sim, p)
      expect(l.laneRate).toBeCloseTo(insP, 10)
      expect(l.laneRate).toBeCloseTo(0.85, 10)
      expect(l.counterOwned).toBe(false)
      expect(l.counterRate).toBeCloseTo(0.97, 10)
    }
    // B. Desk + Metal detector vs metal: 1 − 0.15 × 0.20 = 0.97, the counter
    //    owned; a second detector: 1 − 0.15 × 0.20 × 0.20 = 0.994. Removing the
    //    detector after it passed changes nothing.
    {
      const sim = quietSim(12)
      placeMachine(sim, 'metal_detector', 'slot2')
      const p = missed(sim, 300, 'metal')[0]!
      expect(p.trace.map((t) => t.text)).toEqual(
        expect.arrayContaining([
          'Slot 1 desk — Audrey: missed (85% vs metal)',
          'Slot 2 Metal detector: missed (80% vs metal)',
        ]),
      )
      sim.dispatch({ kind: 'removeFixture', nodeId: 'slot2' })
      const l = card(sim, p)
      expect(l.laneRate).toBeCloseTo(0.97, 10)
      expect(l.counterOwned).toBe(true)
      expect(l.counterRate).toBeCloseTo(0.994, 10)
    }
    // C. The spec's own card (§10): a Metal detector alone vs rattle = 15 %;
    //    "a Shaky shaker would make it 83 %" = 1 − 0.85 × 0.20.
    {
      const sim = noCheckers(quietSim(13))
      placeMachine(sim, 'metal_detector', 'slot1')
      const p = missed(sim, 10, 'rattle')[0]!
      const l = card(sim, p)
      expect(l.counterMachineId).toBe('shaky_shaker')
      expect(l.laneRate).toBeCloseTo(md.pOther, 10)
      expect(Math.round(100 * l.laneRate)).toBe(15)
      expect(l.counterOwned).toBe(false)
      expect(l.counterRate).toBeCloseTo(
        1 - (1 - md.pOther) * (1 - sp.pMatch),
        10,
      )
      expect(Math.round(100 * l.counterRate!)).toBe(83)
    }
    // D. An empty lane: 0 %; the detector would make it 80 %, even though
    //    the desk was put back before the delivery.
    {
      const sim = noCheckers(quietSim(14))
      const p = missed(sim, 2, 'metal')[0]!
      sim.dispatch({ kind: 'placeDesk', nodeId: 'slot1', index: 1 })
      hireInspector(sim)
      const l = card(sim, p)
      expect(l.laneRate).toBe(0)
      expect(l.counterRate).toBeCloseTo(md.pMatch, 10)
    }
  })

  it('cleared by you: a flagged malware parcel the player Clears costs a life when delivered, clearedByPlayerAt = the Clear tick', () => {
    const sim = quietSim(1)
    sim.state.tick = 100
    openingA(sim)
    const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      malware: true,
    })
    p.scripted = true // certain flag at the desk
    const held = collect(sim, 'parcel:held')
    runUntil(sim, () => held.length > 0, 3000)
    const clearTick = sim.state.tick
    expect(sim.dispatch({ kind: 'clear', parcelId: p.id })).toEqual({
      ok: true,
    })
    const lost = collectLost(sim)
    runUntil(sim, () => lost.length > 0, 3000)
    const l = lost[0]!
    expect(l.clearedByPlayerAt).toBe(clearTick)
    expect(l.path.map((t) => t.text)).toEqual(
      expect.arrayContaining([
        'Slot 1 desk — Audrey: flagged (metal)',
        'Held in the Hold Bay',
        'Cleared by you',
      ]),
    )
    expect(l.laneRate).toBeCloseTo(0.97, 10)
  })

  it('the third loss → game:over once, lives never below 0; continueWithOneLife (grantLife) only with the playtest flag', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim, { debug: true })
    const over = collect(sim, 'game:over')
    const lost = collectLost(sim)
    for (let i = 0; i < data.economy.lives.start; i++) {
      vs.debug?.forceMalwareDelivery()
    }
    expect(lost.map((l) => l.report.livesLeft)).toEqual([2, 1, 0])
    expect(over).toEqual([{ cause: 'malware' }])
    expect(vs.gameOver).toBe(true)
    vs.debug?.forceMalwareDelivery()
    expect(vs.lives).toBe(0)
    expect(over).toHaveLength(1)
    expect(vs.grantLife()).toEqual({ ok: false, reason: 'locked' })

    const flagged = quietSim(1, { economy: { continueWithOneLife: true } })
    const fvs = createViewSim(flagged, { debug: true })
    for (let i = 0; i < data.economy.lives.start; i++) {
      fvs.debug?.forceMalwareDelivery()
    }
    expect(fvs.gameOver).toBe(true)
    expect(fvs.grantLife()).toEqual({ ok: true })
    expect(fvs.lives).toBe(1)
    expect(fvs.gameOver).toBe(false)
  })

  it('daysSinceIncident: 0 on the loss, the day of the loss does not count, +1 per clean day after', () => {
    const sim = quietSim(1)
    runTicks(sim, 2 * TICKS_PER_DAY)
    expect(sim.state.economy.daysSinceIncident).toBe(2)
    runTicks(sim, 100)
    createViewSim(sim, { debug: true }).debug?.forceMalwareDelivery()
    expect(sim.state.economy.daysSinceIncident).toBe(0)
    runTicks(sim, TICKS_PER_DAY - 100)
    expect(sim.state.economy.daysSinceIncident).toBe(0)
    runTicks(sim, TICKS_PER_DAY)
    expect(sim.state.economy.daysSinceIncident).toBe(1)
  })

  it('the lane catches what it can: with the desk + Metal detector the scripted parcel never reaches a consumer', () => {
    const sim = quietSim(1)
    openingA(sim)
    const p = laneParcel(sim, 'conv1', { malware: true, scripted: true })
    runTicks(sim, 60)
    expect(sim.state.parcels[String(p.id)]?.state).toBe('held')
    expect(laneNode(sim.state.lane, 'hold')?.queue).toEqual([p.id])
    expect(sim.state.economy.lives).toBe(data.economy.lives.start)
  })
})

describe('M6: the lost-life card names the person (spec-build2 §2.3, design D14)', () => {
  it('a desk miss: "Slot 1 desk — Audrey: missed (85% vs metal)", missedBy, and the 5-eye what-if (the machine line wins here)', () => {
    const sim = quietSim(11)
    const p = missed(sim, 40, 'metal')[0]!
    const l = card(sim, p)
    expect(l.path.map((t) => t.text)).toContain(
      'Slot 1 desk — Audrey: missed (85% vs metal)',
    )
    const audrey = sim.state.employees[0]!
    expect(l.missedBy).toEqual({
      employeeId: audrey.id,
      name: 'Audrey',
      nodeId: 'slot1',
      p: 0.85,
    })
    expect(l.report.missedBy).toEqual(l.missedBy)
    expect(l.inspectorRate).toBeCloseTo(0.94, 10)
    expect(l.counterRate).toBeCloseTo(0.97, 10)
    expect(counterChoice(l)).toBe('machine')
    expect(l.sorterCall).toBeNull()
  })

  it('a 5-eye inspector who missed gets no 5-eye line; a machine miss names nobody', () => {
    const sim = quietSim(12)
    sim.state.economy.balance = 1000
    sim.dispatch({ kind: 'fire', employeeId: sim.state.employees[0]!.id })
    hireInspector(sim, { eye: 5, pace: 3, charisma: 0 })
    const p = missed(sim, 80, 'metal')[0]!
    const l = card(sim, p)
    expect(l.missedBy?.p).toBe(0.94)
    expect(l.inspectorRate).toBeNull()
    expect(counterChoice(l)).toBe('machine')
    const m = noCheckers(quietSim(13))
    placeMachine(m, 'metal_detector', 'slot1')
    const mp = missed(m, 20, 'metal')[0]!
    const ml = card(m, mp)
    expect(ml.missedBy).toBeNull()
    expect(ml.inspectorRate).toBeNull()
  })

  it('counterChoice: the machine on ties (by the shown %), the inspector only when strictly better, null with neither', () => {
    // Desk + detector both missed: machine 1 − .15 × .2 × .2 = 99.4 %, 5-eye
    // 1 − .06 × .2 = 98.8 % → both show 99 % → the machine.
    expect(counterChoice({ inspectorRate: 0.988, counterRate: 0.994 })).toBe(
      'machine',
    )
    // A 1-eye inspector vs dense with the X-ray as the counter: 1 − .25 × .3
    // = 92.5 % vs a 5-eye 94 % → the inspector.
    expect(counterChoice({ inspectorRate: 0.94, counterRate: 0.925 })).toBe(
      'inspector',
    )
    expect(counterChoice({ inspectorRate: null, counterRate: 0.97 })).toBe(
      'machine',
    )
    expect(counterChoice({ inspectorRate: 0.9, counterRate: null })).toBe(
      'inspector',
    )
    expect(counterChoice({ inspectorRate: null, counterRate: null })).toBeNull()
  })

  it('sorterCall: a malware parcel the sorter tagged "looks clean" and the player then Cleared', () => {
    const sim = quietSim(1)
    sim.state.economy.balance = 1000
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 2 }).ok).toBe(true)
    const a = standardApplicant(sim, 'sorter')
    expect(
      sim.dispatch({
        kind: 'hire',
        role: 'sorter',
        applicantId: a.id,
        target: { station: 'hold' },
      }).ok,
    ).toBe(true)
    const p = heldParcel(sim, { malware: true, strain: 'metal' })
    const spy = vi.spyOn(sim.rng, 'chance').mockReturnValue(false) // the wrong call
    const decided = collect(sim, 'sorter:decided')
    runUntil(sim, () => decided.length > 0, 200)
    spy.mockRestore()
    expect(decided[0]).toMatchObject({ call: 'leave', correct: false })
    const sorter = sim.state.employees.find((e) => e.role === 'sorter')!
    expect(p.sorted).toEqual({ by: sorter.id, name: a.name, pct: 85 })
    expect(sim.dispatch({ kind: 'clear', parcelId: p.id }).ok).toBe(true)
    const l = card(sim, p)
    expect(l.sorterCall).toEqual({ name: a.name, pct: 85 })
    expect(l.path.map((t) => t.text)).toEqual(
      expect.arrayContaining([
        `${a.name}: looks clean (85%)`,
        'Cleared by you',
      ]),
    )
    expect(sim.state.wanted).toContain(p.label)
  })
})
