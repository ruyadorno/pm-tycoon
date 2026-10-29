// spec §6.3 checkers + §5.4 scripted malware + §5.5 magic (plan.md §12.5
// task 2): the series compounding examples (inspector + Metal detector =
// 0.97; metal + shaker + battery machines vs metal = 0.856; + X-ray = 0.957),
// the desk's parallel stations sharing ONE roll (a 3-inspector desk is still
// 0.85), pMatch / pOther, decoy flags only on matching checkers (generalists:
// any trait), clean parcels without a trait never flagged, a flag diverting at
// once and skipping downstream checkers, the scripted forced catch and its
// deferUntilCheckerS rule, magic parcels skipped, debug forceFlagNext.

import { describe, expect, it, vi } from 'vitest'
import { flagChance, laneCatchRate } from '../../src/sim/detection.ts'
import type { Checker } from '../../src/sim/types.ts'
import { laneNode, TICKS_PER_S } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  buy,
  collect,
  dataFixture,
  eventLog,
  feeder,
  laneParcel,
  makeSim,
  noCheckers,
  openingA,
  placeMachine,
  quietSim,
  runTicks,
  runUntil,
  unlockDistrict,
} from './helpers.ts'

const data = dataFixture()
const deskP = data.employees.inspector.pMatch

/** A malware parcel's roll inputs. */
const m = (strain: 'metal' | 'rattle') => ({
  malware: true,
  strain,
  decoy: null,
  magic: false,
})

/** A clean parcel's roll inputs (with an optional decoy trait). */
const clean = (decoy: 'metal' | 'rattle' | null) => ({
  malware: false,
  strain: null,
  decoy,
  magic: false,
})

function checkerOf(sim: ReturnType<typeof quietSim>, nodeId: string): Checker {
  const c = laneNode(sim.state.lane, nodeId)?.fixture?.checker
  if (!c) throw new Error(`no checker in ${nodeId}`)
  return c
}

/** Run `n` parcels through the lane (Hold Bay unbounded); flagged count + chance() draws. */
function runParcels(
  sim: ReturnType<typeof quietSim>,
  n: number,
  opts: Parameters<typeof feeder>[2],
): { flagged: number; draws: number } {
  laneNode(sim.state.lane, 'hold')!.cap = null
  laneNode(sim.state.lane, 'shelf')!.cap = null
  const flagged = collect(sim, 'parcel:flagged')
  const spy = vi.spyOn(sim.rng, 'chance')
  const feed = feeder(sim, n, opts)
  const done = (): number =>
    laneNode(sim.state.lane, 'shelf')!.queue.length +
    laneNode(sim.state.lane, 'hold')!.queue.length
  for (let t = 0; t < 200_000 && done() < n; t++) {
    feed()
    sim.tick()
  }
  expect(done()).toBe(n)
  const draws = spy.mock.calls.length
  spy.mockRestore()
  return { flagged: flagged.length, draws }
}

describe('§6.3 series compounding', () => {
  it('inspector alone vs metal = 0.85; inspector + Metal detector = 0.97 (the HUD reads 97 %)', () => {
    const sim = quietSim(1)
    expect(laneCatchRate(sim.state.lane, 'metal')).toBeCloseTo(0.85, 10)
    openingA(sim)
    expect(laneCatchRate(sim.state.lane, 'metal')).toBeCloseTo(0.97, 10)
    expect(createViewSim(sim).laneStats().detectionPct).toBe(97)
  })

  it('three machines (metal, shaker, battery), no inspector, vs metal = 0.856; + X-ray = 0.957', () => {
    const sim = noCheckers(quietSim(1))
    placeMachine(sim, 'metal_detector', 'slot1')
    placeMachine(sim, 'shaky_shaker', 'slot2')
    placeMachine(sim, 'battery_checker', 'slot3')
    expect(laneCatchRate(sim.state.lane, 'metal')).toBeCloseTo(0.856, 3)
    placeMachine(sim, 'xray', 'slot4')
    expect(laneCatchRate(sim.state.lane, 'metal')).toBeCloseTo(0.957, 3)
  })

  it('a 3-inspector desk is still 0.85: stations buy throughput, never detection', () => {
    const sim = quietSim(1)
    sim.state.economy.balance = 1000
    sim.dispatch({ kind: 'hireInspector' })
    sim.dispatch({ kind: 'hireInspector' })
    expect(laneNode(sim.state.lane, 'slot1')?.stations).toHaveLength(3)
    expect(laneCatchRate(sim.state.lane, 'metal')).toBeCloseTo(deskP, 10)
  })

  it('desk stations share one roll: 400 metal malware through a 3-inspector desk → one draw each, ~85 % flagged (not 1 − 0.15³)', () => {
    const sim = quietSim(5)
    sim.state.economy.balance = 1000
    sim.dispatch({ kind: 'hireInspector' })
    sim.dispatch({ kind: 'hireInspector' })
    const n = 400
    const { flagged, draws } = runParcels(sim, n, {
      malware: true,
      strain: 'metal',
    })
    expect(draws).toBe(n)
    expect(flagged / n).toBeGreaterThan(deskP - 0.06)
    expect(flagged / n).toBeLessThan(deskP + 0.06)
  })
})

describe('§6.3 the roll', () => {
  it('malware: pMatch on the checker’s strain, pOther on any other; generalists one p for all', () => {
    const sim = quietSim(1)
    openingA(sim)
    const md = checkerOf(sim, 'slot2')
    const desk = checkerOf(sim, 'slot1')
    expect(flagChance(md, m('metal'))).toEqual({ p: 0.8, strain: 'metal' })
    expect(flagChance(md, m('rattle'))).toEqual({ p: 0.15, strain: 'rattle' })
    expect(flagChance(desk, m('rattle'))).toEqual({
      p: deskP,
      strain: 'rattle',
    })
  })

  it('clean parcels: decoy flags only on a matching checker (generalists: any trait); no trait → never flagged', () => {
    const sim = quietSim(1)
    openingA(sim)
    const md = checkerOf(sim, 'slot2')
    const desk = checkerOf(sim, 'slot1')
    expect(flagChance(md, clean('metal'))).toEqual({ p: 0.5, strain: 'metal' })
    expect(flagChance(md, clean('rattle'))).toBeNull()
    expect(flagChance(md, clean(null))).toBeNull()
    expect(flagChance(desk, clean('rattle'))).toEqual({
      p: data.employees.inspector.decoyFlag,
      strain: 'rattle',
    })
    expect(flagChance(desk, clean(null))).toBeNull()
  })

  it('in the lane: rattle decoys and trait-less clean parcels pass a Metal detector unflagged with no draw; metal decoys flag ~50 %', () => {
    const a = noCheckers(quietSim(2))
    placeMachine(a, 'metal_detector', 'slot1')
    expect(runParcels(a, 60, { decoy: 'rattle' })).toEqual({
      flagged: 0,
      draws: 0,
    })
    const b = noCheckers(quietSim(2))
    placeMachine(b, 'metal_detector', 'slot1')
    expect(runParcels(b, 60, {})).toEqual({ flagged: 0, draws: 0 })
    const c = noCheckers(quietSim(2))
    placeMachine(c, 'metal_detector', 'slot1')
    const r = runParcels(c, 300, { decoy: 'metal' })
    expect(r.draws).toBe(300)
    expect(r.flagged / 300).toBeGreaterThan(0.42)
    expect(r.flagged / 300).toBeLessThan(0.58)
  })

  it('a flag diverts to the Hold Bay at once and skips every downstream checker (parcel:flagged → parcel:held, never enters slot 2)', () => {
    const sim = quietSim(1)
    openingA(sim) // desk slot 1, Metal detector slot 2
    const p = laneParcel(sim, 'conv1', { malware: true, scripted: true })
    const log = eventLog(sim)
    runTicks(sim, 60)
    const mine = log.filter((e) => (e.p as { id?: number }).id === p.id)
    expect(mine.map((e) => e.name)).toEqual([
      'parcel:enteredSlot',
      'parcel:processing',
      'parcel:flagged',
      'parcel:held',
    ])
    const flagged = mine.find((e) => e.name === 'parcel:flagged')!
    expect(flagged.p).toEqual({
      id: p.id,
      checkerId: checkerOf(sim, 'slot1').id,
      strain: 'metal',
      nodeId: 'slot1',
      scripted: true,
    })
    expect(mine.find((e) => e.name === 'parcel:held')?.tick).toBe(flagged.tick)
    const parcel = sim.state.parcels[String(p.id)]!
    expect(parcel.state).toBe('held')
    expect(parcel.trace.map((t) => t.text ?? t.what)).toEqual([
      'Slot 1 Inspection desk: flagged (metal)',
      'held',
    ])
    expect(sim.state.stats.malwareCaught).toBe(1)
    expect(sim.state.stats.holdBayEvents).toBe(1)
  })

  it('magic parcels are skipped: no processing, no roll, never flagged (spec §5.5)', () => {
    const sim = quietSim(1)
    openingA(sim)
    const p = laneParcel(sim, 'conv1', { malware: true, magic: true })
    const processing = collect(sim, 'parcel:processing')
    const flagged = collect(sim, 'parcel:flagged')
    const spy = vi.spyOn(sim.rng, 'chance')
    runTicks(sim, 30)
    expect(processing).toEqual([])
    expect(flagged).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    const parcel = sim.state.parcels[String(p.id)]!
    expect(parcel.state).toBe('on_shelf')
    expect(parcel.trace.filter((t) => t.what === 'skipped')).toHaveLength(2)
  })

  it('debug forceFlagNext: the next parcel to finish is flagged on that trait (a clean one too), once', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim, { debug: true })
    expect(vs.debug?.forceFlagNext('rattle')).toEqual({ ok: true })
    laneParcel(sim, 'conv1')
    laneParcel(sim, 'conv1')
    const flagged = collect(sim, 'parcel:flagged')
    runTicks(sim, 100)
    expect(flagged).toHaveLength(1)
    expect(flagged[0]).toMatchObject({ strain: 'rattle', scripted: false })
    expect(sim.state.lane.debugForceFlag).toBeUndefined()
  })
})

describe('§5.4 the scripted first malware', () => {
  it('the first checker it reaches catches it with certainty (parcel:flagged {scripted: true}), on seeds 1-5', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const sim = makeSim(seed)
      openingA(sim)
      buy(sim, 'bike')
      buy(sim, 'bike')
      const flagged = collect(sim, 'parcel:flagged')
      const n = runUntil(
        sim,
        () => flagged.some((f) => f.scripted),
        20 * 60 * TICKS_PER_S,
      )
      expect(n, `seed ${seed}`).toBeGreaterThan(0)
      const f = flagged.find((x) => x.scripted)!
      const p = sim.state.parcels[String(f.id)]!
      expect(p.malware && p.scripted).toBe(true)
      expect(p.strain).toBe(data.parcels.malware.firstScripted.strain)
      expect(p.size).toBe(data.parcels.malware.firstScripted.size)
      expect(f.nodeId).toBe('slot1') // the desk is the first checker
      expect(f.checkerId).toBe(checkerOf(sim, 'slot1').id)
    }
  })

  it('the first checker it reaches flags it even when that is a machine of another strain (a Shaky shaker, 15 % vs metal), on seeds 1-5', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const sim = makeSim(seed)
      buy(sim, 'bike')
      buy(sim, 'bike')
      expect(
        sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot3' }),
      ).toEqual({ ok: true })
      placeMachine(sim, 'shaky_shaker', 'slot1')
      const flagged = collect(sim, 'parcel:flagged')
      const n = runUntil(
        sim,
        () => flagged.some((f) => f.scripted),
        20 * 60 * TICKS_PER_S,
      )
      expect(n, `seed ${seed}`).toBeGreaterThan(0)
      const f = flagged.find((x) => x.scripted)!
      expect(f).toMatchObject({
        nodeId: 'slot1',
        checkerId: checkerOf(sim, 'slot1').id,
        strain: data.parcels.malware.firstScripted.strain,
      })
    }
  })

  it('due at ≥ firstScripted.atS, size S, from a district the fleet can serve (a bike-only fleet never gets it in Industrial); only that parcel ever carries scripted: true', () => {
    const fs = data.parcels.malware.firstScripted
    for (let seed = 1; seed <= 10; seed++) {
      // a malware-heavy game so ordinary flags happen around it
      const sim = makeSim(seed, { parcels: { malware: { baseShare: 0.2 } } })
      unlockDistrict(sim, 'industrial', true)
      buy(sim, 'bike')
      buy(sim, 'bike')
      const spawned = collect(sim, 'parcel:spawned')
      const flagged = collect(sim, 'parcel:flagged')
      runUntil(sim, () => sim.state.spawn.scriptedDone, 10 * 60 * TICKS_PER_S)
      const p = Object.values(sim.state.parcels).find((x) => x.scripted)!
      expect(p, `seed ${seed}`).toBeDefined()
      expect(p.spawnedTick).toBeGreaterThanOrEqual(fs.atS * TICKS_PER_S)
      expect(
        spawned
          .filter((e) => e.id < p.id)
          .every((e) => sim.state.parcels[String(e.id)]?.scripted !== true),
      ).toBe(true)
      expect(p.size).toBe(fs.size)
      const origin = data.buildings.find((b) => b.id === p.origin)!
      expect(['highres', 'downtown']).toContain(origin.district)
      runTicks(sim, 5 * 60 * TICKS_PER_S)
      for (const id of laneNode(sim.state.lane, 'hold')!.queue.slice()) {
        sim.dispatch({ kind: 'toss', parcelId: id })
      }
      const scripted = flagged.filter((f) => f.scripted)
      expect(scripted.map((f) => f.id)).toEqual(
        flagged.some((f) => f.id === p.id) ? [p.id] : [],
      )
      expect(flagged.length).toBeGreaterThan(scripted.length) // ordinary flags: scripted false
    }
  }, 30_000) // ~2.6 s alone

  it('no checker when it is due: deferred; a checker placed within deferUntilCheckerS → the forced, scripted spawn', () => {
    const fs = data.parcels.malware.firstScripted
    const sim = noCheckers(makeSim(1))
    buy(sim, 'bike')
    runTicks(sim, (fs.atS + 20) * TICKS_PER_S)
    expect(sim.state.spawn.scriptedDone).toBe(false)
    expect(sim.state.spawn.scriptedDeferredUntilTick).not.toBeNull()
    placeMachine(sim, 'metal_detector', 'slot2')
    const spawned = collect(sim, 'parcel:spawned')
    runUntil(sim, () => spawned.length > 0, 600)
    const p = sim.state.parcels[String(spawned[0]!.id)]!
    expect(p).toMatchObject({
      malware: true,
      scripted: true,
      strain: fs.strain,
    })
    expect(sim.state.spawn.scriptedDone).toBe(true)
  })

  it('no checker for deferUntilCheckerS more: it spawns as ordinary malware (no forced catch, no scripted flag)', () => {
    const fs = data.parcels.malware.firstScripted
    const sim = noCheckers(makeSim(1))
    buy(sim, 'bike')
    runUntil(sim, () => sim.state.spawn.scriptedDeferredUntilTick !== null)
    const until = sim.state.spawn.scriptedDeferredUntilTick!
    expect(until).toBe(sim.state.tick + fs.deferUntilCheckerS * TICKS_PER_S)
    const spawned = collect(sim, 'parcel:spawned')
    runUntil(sim, () => sim.state.spawn.scriptedDone, 4000)
    expect(sim.state.tick).toBeGreaterThanOrEqual(until)
    const p = sim.state.parcels[String(spawned.at(-1)!.id)]!
    expect(p).toMatchObject({
      malware: true,
      scripted: false,
      strain: fs.strain,
      size: fs.size,
    })
  })
})
