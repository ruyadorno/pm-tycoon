// spec §6.2 / §6.7 fixtures (plan.md §12.5 tasks 4-5; warehouse-view.md §2,
// Q30/Q31): buyMachine needs balance ≥ price, the level and an empty unlocked
// slot; removing a machine refunds removalRefund × price, removing the desk
// is free and its inspectors leave without refund; moves are free and an
// occupied target swaps; a parcel mid-process under a moved fixture restarts
// its process time (passes through when the slot is now empty); one desk
// per desks.rows index (M6: desk 2 at L3 — people.test.ts); hire up to
// maxPerDesk for one day's salary; fire is instant, no refund, one station
// fewer; the lane:fixture* / worker:* events.

import { describe, expect, it } from 'vitest'
import { auditState, conservation } from '../../src/sim/sim.ts'
import { laneNode } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  collect,
  dataFixture,
  eventLog,
  hireInspector,
  laneParcel,
  noCheckers,
  quietSim,
  runTicks,
} from './helpers.ts'

const data = dataFixture()
const md = data.machines.checkers.find((c) => c.id === 'metal_detector')!
const maxPerDesk = data.employees.desks.maxPerDesk

describe('buy / remove (spec §6.2, §7.2)', () => {
  it('buyMachine: refused below the price, above the level, on a locked or occupied slot; places + charges + lane:fixturePlaced', () => {
    const sim = quietSim(1)
    sim.state.economy.balance = md.price - 1
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: md.id, nodeId: 'slot2' }),
    ).toEqual({ ok: false, reason: 'insufficient-funds' })
    sim.state.economy.balance = 1000
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'shaky_shaker',
        nodeId: 'slot2',
      }),
    ).toEqual({ ok: false, reason: 'locked' })
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: md.id, nodeId: 'slot4' }),
    ).toEqual({ ok: false, reason: 'slot-locked' })
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: md.id, nodeId: 'slot1' }),
    ).toEqual({ ok: false, reason: 'slot-occupied' })
    const placed = collect(sim, 'lane:fixturePlaced')
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: md.id, nodeId: 'slot2' }),
    ).toEqual({ ok: true })
    expect(sim.state.economy.balance).toBe(1000 - md.price)
    expect(placed).toHaveLength(1)
    expect(placed[0]).toMatchObject({
      nodeId: 'slot2',
      fixture: { kind: 'machine', checker: { defId: md.id, stations: 1 } },
    })
    expect(laneNode(sim.state.lane, 'slot2')?.stations).toHaveLength(1)
  })

  it('removing a machine refunds removalRefund × price (not lifetime earned): lane:fixtureRemoved {nodeId, refund}', () => {
    const sim = quietSim(1)
    sim.dispatch({ kind: 'buyMachine', defId: md.id, nodeId: 'slot2' })
    const balance = sim.state.economy.balance
    const removed = collect(sim, 'lane:fixtureRemoved')
    const money = collect(sim, 'money:changed')
    expect(sim.dispatch({ kind: 'removeFixture', nodeId: 'slot2' })).toEqual({
      ok: true,
    })
    const refund = Math.round(md.price * data.machines.removalRefund)
    expect(refund).toBe(75)
    expect(removed).toEqual([{ nodeId: 'slot2', refund }])
    expect(money).toEqual([
      { delta: refund, reason: 'refund', balance: balance + refund },
    ])
    expect(sim.state.economy.lifetimeEarned).toBe(0)
    expect(laneNode(sim.state.lane, 'slot2')).toMatchObject({
      fixture: null,
      stations: [],
    })
    expect(sim.dispatch({ kind: 'removeFixture', nodeId: 'slot2' })).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('removing the desk is free; its inspectors leave (worker:fired, no refund); desk 1 cannot be placed twice', () => {
    const sim = quietSim(1)
    sim.state.economy.balance = 500
    hireInspector(sim)
    const ids = sim.state.employees
      .filter((e) => e.role === 'inspector')
      .map((e) => e.id)
    expect(ids).toHaveLength(2)
    expect(
      sim.dispatch({ kind: 'placeDesk', nodeId: 'slot2', index: 1 }),
    ).toEqual({
      ok: false,
      reason: 'desk-exists',
    })
    const fired = collect(sim, 'worker:fired')
    const removed = collect(sim, 'lane:fixtureRemoved')
    const balance = sim.state.economy.balance
    sim.dispatch({ kind: 'removeFixture', nodeId: 'slot1' })
    expect(fired).toEqual(
      ids.map((employeeId) => ({
        employeeId,
        role: 'inspector',
        nodeId: 'slot1',
        vehicleId: null,
        reason: 'deskRemoved',
      })),
    )
    expect(removed).toEqual([{ nodeId: 'slot1', refund: 0 }])
    expect(sim.state.economy.balance).toBe(balance)
    expect(sim.state.employees.some((e) => e.role === 'inspector')).toBe(false)
    expect(
      sim.dispatch({ kind: 'placeDesk', nodeId: 'slot3', index: 1 }),
    ).toEqual({
      ok: true,
    })
    expect(laneNode(sim.state.lane, 'slot3')?.fixture?.kind).toBe('desk')
    expect(laneNode(sim.state.lane, 'slot3')?.stations).toEqual([]) // no inspector yet
  })
})

/** A malware parcel rolled by the slot-1 desk and held in its station (slot 2 closed). */
function rolledAtDesk(seed: number) {
  const sim = quietSim(seed)
  const p = laneParcel(sim, 'slot1', { malware: true })
  const slot2 = laneNode(sim.state.lane, 'slot2')!
  slot2.cap = 0
  runTicks(sim, 41)
  return { sim, p, slot2 }
}

describe('move / swap (spec §6.2, Q30, Q31)', () => {
  it('moving to an empty slot is free and relinks the desk’s inspectors; an occupied target swaps', () => {
    const sim = quietSim(1)
    sim.dispatch({ kind: 'buyMachine', defId: md.id, nodeId: 'slot3' })
    const balance = sim.state.economy.balance
    const moved = collect(sim, 'lane:fixtureMoved')
    expect(
      sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot2' }),
    ).toEqual({
      ok: true,
    })
    expect(laneNode(sim.state.lane, 'slot2')?.fixture?.kind).toBe('desk')
    expect(laneNode(sim.state.lane, 'slot1')?.fixture).toBeNull()
    expect(
      sim.state.employees.filter((e) => e.role === 'inspector')[0]?.nodeId,
    ).toBe('slot2')
    sim.dispatch({ kind: 'moveFixture', from: 'slot2', to: 'slot3' })
    expect(moved).toEqual([
      { from: 'slot1', to: 'slot2', swapped: false },
      { from: 'slot2', to: 'slot3', swapped: true },
    ])
    expect(laneNode(sim.state.lane, 'slot3')?.fixture?.kind).toBe('desk')
    expect(laneNode(sim.state.lane, 'slot2')?.fixture?.checker.defId).toBe(
      md.id,
    )
    expect(sim.state.economy.balance).toBe(balance)
    expect(
      sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot2' }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(
      sim.dispatch({ kind: 'moveFixture', from: 'slot2', to: 'slot4' }),
    ).toEqual({
      ok: false,
      reason: 'slot-locked',
    })
  })

  it('a parcel mid-process under a moved fixture restarts its process time under the new one (swap desk ↔ Metal detector)', () => {
    const sim = quietSim(1)
    sim.dispatch({ kind: 'buyMachine', defId: md.id, nodeId: 'slot2' })
    const p = laneParcel(sim, 'slot1')
    runTicks(sim, 20) // halfway through the desk's 4 s
    const processing = collect(sim, 'parcel:processing')
    sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot2' })
    expect(processing).toEqual([{ id: p.id, nodeId: 'slot1' }])
    const station = laneNode(sim.state.lane, 'slot1')!.stations[0]!
    expect(station).toEqual({
      parcelId: p.id,
      doneTick: sim.state.tick + Math.round(md.processS * 10),
    })
    runTicks(sim, Math.round(md.processS * 10))
    const parcel = sim.state.parcels[String(p.id)]!
    expect(parcel.nodeId).toBe('slot2') // done under the machine, moved on
    expect(parcel.trace[0]?.text).toMatch(/^Slot 1 Metal detector: passed/)
  })

  it('a parcel mid-process under a fixture moved away passes through the now-empty slot', () => {
    const sim = quietSim(1)
    const p = laneParcel(sim, 'slot1')
    runTicks(sim, 20)
    sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot3' })
    const entered = eventLog(sim)
    runTicks(sim, 2)
    // 0 s through the empty slot 1 and slot 2, then the desk again in slot 3
    expect(
      entered
        .filter((e) => e.name === 'parcel:enteredSlot')
        .map((e) => (e.p as { nodeId: string }).nodeId),
    ).toEqual(['slot2', 'slot3'])
    expect(sim.state.parcels[String(p.id)]?.trace[0]?.text).toBe(
      'Slot 1: empty',
    )
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('one roll per parcel per checker (§6.3): a desk moved downstream of a parcel it already rolled lets it pass ("already checked") without a second roll or a second process time', () => {
    // The first seed whose desk misses (15 %) the malware parcel.
    let seed = 1
    while (rolledAtDesk(seed).p.state === 'held') seed += 1
    const { sim, p, slot2 } = rolledAtDesk(seed)
    const parcel = sim.state.parcels[String(p.id)]!
    const deskId = laneNode(sim.state.lane, 'slot1')!.fixture!.checker.id
    expect(parcel.state).toBe('in_slot')
    expect(parcel.nodeDoneTick).not.toBeNull()
    expect(parcel.trace.filter((t) => t.chk === deskId)).toHaveLength(1)
    const processing = collect(sim, 'parcel:processing')
    const flagged = collect(sim, 'parcel:flagged')
    sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot3' })
    slot2.cap = data.machines.slotBufferCap
    const rng = sim.state.rng
    runTicks(sim, 10)
    expect(sim.state.rng).toBe(rng) // no draw
    expect(processing).toEqual([])
    expect(flagged).toEqual([])
    const after = sim.state.parcels[String(p.id)]!
    expect(after.state).toBe('on_shelf')
    expect(after.trace.filter((t) => t.chk === deskId)).toHaveLength(1)
    expect(after.trace.map((t) => t.text)).toEqual([
      'Slot 1 desk — Audrey: missed (85% vs metal)',
      'Slot 2: empty',
      'Slot 3 Inspection desk: already checked',
      undefined, // shelved
    ])
  })

  it('more busy stations than the new fixture has: the extra parcels go back to the front of the buffer (above its cap until it drains); nothing lost', () => {
    const sim = quietSim(1)
    sim.state.economy.balance = 1000
    hireInspector(sim)
    hireInspector(sim)
    sim.dispatch({ kind: 'buyMachine', defId: md.id, nodeId: 'slot2' })
    for (let i = 0; i < 5; i++) laneParcel(sim, 'slot1')
    const slot1 = laneNode(sim.state.lane, 'slot1')!
    slot1.cap = 10 // admit the five for the setup
    runTicks(sim, 1)
    slot1.cap = data.machines.slotBufferCap
    expect(slot1.stations.every((st) => st.parcelId !== null)).toBe(true)
    sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot2' }) // 3 stations → 1
    expect(slot1.stations).toHaveLength(1)
    expect(slot1.queue).toHaveLength(4)
    expect(auditState(sim.state, data)).toEqual([])
    runTicks(sim, 200)
    expect(laneNode(sim.state.lane, 'shelf')?.queue).toHaveLength(5)
    expect(conservation(sim.state).ok).toBe(true)
  })
})

describe('inspectors (spec §6.7)', () => {
  it('hire: one day’s salary as the fee ($20 for a 3/3/0), up to maxPerDesk seats, names from puns.peopleNames; worker:hired', () => {
    const sim = quietSim(1)
    sim.state.economy.balance = 1000
    const hired = collect(sim, 'worker:hired')
    for (let i = 1; i < maxPerDesk; i++) {
      expect(hireInspector(sim)).toMatchObject({ ok: true })
    }
    expect(hireInspector(sim)).toEqual({ ok: false, reason: 'desk-full' })
    expect(sim.state.economy.balance).toBe(1000 - (maxPerDesk - 1) * 20)
    const names = sim.state.employees
      .filter((e) => e.role === 'inspector')
      .map((e) => e.name)
    expect(names[0]).toBe('Audrey')
    for (const n of names) expect(data.puns.peopleNames).toContain(n)
    expect(new Set(names).size).toBe(names.length)
    expect(hired).toHaveLength(maxPerDesk - 1)
    expect(hired[0]).toMatchObject({
      role: 'inspector',
      nodeId: 'slot1',
      vehicleId: null,
      pips: { eye: 3, pace: 3, charisma: 0 },
      star: false,
      rehire: false,
    })
    expect(laneNode(sim.state.lane, 'slot1')?.stations).toHaveLength(maxPerDesk)
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('fire: instant, no refund, one station fewer (worker:fired); the last one leaves an empty desk that passes parcels through', () => {
    const sim = quietSim(1)
    const e = sim.state.employees.find((x) => x.role === 'inspector')!
    const p = laneParcel(sim, 'slot1')
    runTicks(sim, 10) // mid-process
    const balance = sim.state.economy.balance
    const fired = collect(sim, 'worker:fired')
    expect(sim.dispatch({ kind: 'fire', employeeId: e.id })).toEqual({
      ok: true,
    })
    expect(fired).toEqual([
      {
        employeeId: e.id,
        role: 'inspector',
        nodeId: 'slot1',
        vehicleId: null,
        reason: 'fired',
      },
    ])
    expect(sim.state.economy.balance).toBe(balance)
    const desk = laneNode(sim.state.lane, 'slot1')!
    expect(desk.stations).toEqual([])
    expect(desk.fixture?.checker.stations).toBe(0)
    expect(desk.queue[0]).toBe(p.id)
    runTicks(sim, 5)
    expect(sim.state.parcels[String(p.id)]?.state).toBe('on_shelf')
    expect(sim.dispatch({ kind: 'fire', employeeId: e.id })).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('no checker at all (desk and machines removed): lane rate 60/min (the dock), detection 0 %; laneStats suggests the counter', () => {
    const sim = noCheckers(quietSim(1))
    const stats = createViewSim(sim).laneStats()
    expect(stats).toMatchObject({
      ratePerMin: 60,
      detectionPct: 0,
      byStrain: [{ strain: 'metal', pct: 0, counter: 'metal_detector' }],
      stalled: null,
      suggest: {
        strain: 'metal',
        pct: 0,
        counter: 'metal_detector',
        owned: false,
        withCounterPct: Math.round(100 * md.pMatch),
      },
    })
    expect(auditState(sim.state, data)).toEqual([])
  })
})
