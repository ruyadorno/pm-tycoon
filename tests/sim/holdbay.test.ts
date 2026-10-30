// spec §6.6 (plan.md §12.5 task 3): Toss of malware pays tossBounty into the
// balance AND lifetime earned ("DEFUSED"); a wrong Toss loses the parcel's
// value, charges wrongTossFee (never below $0) and costs −3 satisfaction to
// the origin and destination districts; quarantine counters; Clear sends the
// parcel straight to the shelf skipping the remaining slots
// (parcel:cleared_by_player) and is refused with 'shelf-full' at cap while
// Toss always works; only held parcels can be tossed / cleared; a freed bay
// takes the waiting flagged parcel on the next tick; debug fillHoldBay.

import { describe, expect, it } from 'vitest'
import { auditState, conservation } from '../../src/sim/sim.ts'
import { laneNode } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  collect,
  dataFixture,
  heldParcel,
  laneParcel,
  openingA,
  quietSim,
  runTicks,
  runUntil,
  shelveParcel,
} from './helpers.ts'

const data = dataFixture()
const eco = data.economy

describe('Toss (spec §6.6)', () => {
  it('malware: the bounty goes to the balance and lifetime earned; parcel:tossed {wasMalware: true, bounty}; quarantine counts it', () => {
    const sim = quietSim(1)
    const p = heldParcel(sim, { malware: true })
    const balance = sim.state.economy.balance
    const tossed = collect(sim, 'parcel:tossed')
    const money = collect(sim, 'money:changed')
    expect(sim.dispatch({ kind: 'toss', parcelId: p.id })).toEqual({ ok: true })
    expect(tossed).toEqual([
      {
        id: p.id,
        wasMalware: true,
        bounty: eco.tossBounty,
        source: 'player',
        employeeId: null,
      },
    ])
    expect(money).toEqual([
      {
        delta: eco.tossBounty,
        reason: 'bounty',
        balance: balance + eco.tossBounty,
      },
    ])
    expect(sim.state.economy.lifetimeEarned).toBe(eco.tossBounty)
    expect(sim.state.lane.quarantine).toEqual({
      count: 1,
      malware: 1,
      clean: 0,
    })
    expect(laneNode(sim.state.lane, 'hold')?.queue).toEqual([])
    runTicks(sim, 1) // gc removes the terminal parcel
    expect(sim.state.parcels[String(p.id)]).toBeUndefined()
    expect(conservation(sim.state).ok).toBe(true)
  })

  it('clean: value lost, wrongTossFee charged, −3 to the origin and destination districts, no lifetime earned', () => {
    const sim = quietSim(1)
    sim.state.tick = 100
    const p = heldParcel(
      sim,
      { decoy: 'metal' },
      'hr_towers_a',
      'dt_cache_cafe',
    )
    const balance = sim.state.economy.balance
    const tossed = collect(sim, 'parcel:tossed')
    const sat = collect(sim, 'satisfaction:changed')
    sim.dispatch({ kind: 'toss', parcelId: p.id })
    expect(tossed).toEqual([
      {
        id: p.id,
        wasMalware: false,
        bounty: 0,
        source: 'player',
        employeeId: null,
      },
    ])
    expect(sim.state.economy.balance).toBe(balance - eco.wrongTossFee)
    expect(sim.state.economy.lifetimeEarned).toBe(0)
    expect(sim.state.stats.wrongToss).toBe(1)
    const s = eco.satisfaction
    expect(sat).toEqual([
      { district: 'highres', value: s.start + s.wrongToss, delta: s.wrongToss },
      {
        district: 'downtown',
        value: s.start + s.wrongToss,
        delta: s.wrongToss,
      },
    ])
    expect(sim.state.lane.quarantine).toEqual({
      count: 1,
      malware: 0,
      clean: 1,
    })
  })

  it('a same-district clean parcel costs that district −3 once; the fee is clamped so the balance never goes negative', () => {
    const sim = quietSim(1)
    const p = heldParcel(sim, {}, 'hr_towers_a', 'hr_towers_b')
    sim.state.economy.balance = 10
    const sat = collect(sim, 'satisfaction:changed')
    const money = collect(sim, 'money:changed')
    sim.dispatch({ kind: 'toss', parcelId: p.id })
    expect(sat).toHaveLength(1)
    expect(sim.state.economy.balance).toBe(0)
    expect(money).toEqual([{ delta: -10, reason: 'wrongToss', balance: 0 }])
  })

  it('only a held parcel can be tossed or cleared', () => {
    const sim = quietSim(1)
    const p = laneParcel(sim, 'conv1')
    expect(sim.dispatch({ kind: 'toss', parcelId: p.id })).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(sim.dispatch({ kind: 'clear', parcelId: 999 })).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })
})

describe('Clear (spec §6.6, Q35)', () => {
  it('goes straight to the shelf, skipping the remaining slots: parcel:cleared_by_player, the trace says "Cleared by you"', () => {
    const sim = quietSim(1)
    openingA(sim)
    const p = laneParcel(sim, 'conv1', { malware: true, scripted: true })
    const entered = collect(sim, 'parcel:enteredSlot')
    runTicks(sim, 60) // flagged at the desk in slot 1 → held
    expect(sim.state.parcels[String(p.id)]?.state).toBe('held')
    sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot3' })
    expect(createViewSim(sim).holdBay.items).toEqual([
      {
        parcelId: p.id,
        bay: 0,
        strain: 'metal',
        checkerName: 'Inspection desk',
        nodeId: 'slot1',
        inspectorName: 'Audrey',
        sorted: null,
      },
    ])
    const cleared = collect(sim, 'parcel:cleared_by_player')
    const shelved = collect(sim, 'parcel:shelved')
    expect(sim.dispatch({ kind: 'clear', parcelId: p.id })).toEqual({
      ok: true,
    })
    runTicks(sim, 10)
    expect(cleared).toEqual([{ id: p.id }])
    expect(shelved).toEqual([]) // cleared_by_player is its shelf event
    expect(entered.filter((e) => e.id === p.id).map((e) => e.nodeId)).toEqual([
      'slot1',
    ])
    const parcel = sim.state.parcels[String(p.id)]!
    expect(parcel.state).toBe('on_shelf')
    expect(laneNode(sim.state.lane, 'shelf')?.queue).toContain(p.id)
    expect(parcel.trace.at(-1)).toMatchObject({
      what: 'cleared',
      text: 'Cleared by you',
    })
    expect(sim.state.lane.quarantine.count).toBe(0)
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('refused with shelf-full while the shelf is at cap; Toss still works', () => {
    const sim = quietSim(1)
    const shelf = laneNode(sim.state.lane, 'shelf')!
    shelf.cap = 2
    shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const p = heldParcel(sim, { malware: true })
    expect(sim.dispatch({ kind: 'clear', parcelId: p.id })).toEqual({
      ok: false,
      reason: 'shelf-full',
    })
    expect(sim.state.parcels[String(p.id)]?.state).toBe('held')
    expect(sim.dispatch({ kind: 'toss', parcelId: p.id })).toEqual({ ok: true })
  })
})

describe('the Hold Bay as a queue (spec §6.4, §6.6)', () => {
  it('a full Hold Bay holds the flagged parcel in its slot (holdBayFull); a Toss frees a bay and it diverts on the next tick', () => {
    const sim = quietSim(1)
    const hold = laneNode(sim.state.lane, 'hold')!
    for (let i = 0; i < (hold.cap ?? 0); i++) heldParcel(sim)
    const p = laneParcel(sim, 'conv1', { malware: true, scripted: true })
    const stalled = collect(sim, 'lane:stalled')
    const held = collect(sim, 'parcel:held')
    runTicks(sim, 60)
    expect(stalled).toEqual([{ reason: 'holdBayFull', nodeId: 'slot1' }])
    expect(sim.state.parcels[String(p.id)]).toMatchObject({
      state: 'in_slot',
      nodeId: 'slot1',
    })
    sim.dispatch({ kind: 'toss', parcelId: hold.queue[0]! })
    runTicks(sim, 1)
    expect(held).toEqual([{ id: p.id }])
    expect(sim.state.lane.stalled).toBe(false)
    expect(hold.queue.at(-1)).toBe(p.id) // bays fill lowest-first
  })

  it('ViewSim holdBay {items, cap, count} and quarantine; holdBay.toss / clear dispatch', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    const a = heldParcel(sim, { malware: true })
    const b = heldParcel(sim)
    expect(vs.holdBay.items).toMatchObject([
      { parcelId: a.id, bay: 0 },
      { parcelId: b.id, bay: 1 },
    ])
    expect(vs.holdBay.cap).toBe(data.levels[0]!.holdBayCap)
    expect(vs.holdBay.count).toBe(2)
    expect(vs.holdBay.toss(a.id)).toEqual({ ok: true })
    // stable bays (M3): b keeps its bay when a leaves
    expect(vs.holdBay.items).toMatchObject([{ parcelId: b.id, bay: 1 }])
    expect(vs.holdBay.clear(b.id)).toEqual({ ok: true })
    expect(vs.quarantine).toEqual({ count: 1, malware: 1, clean: 0 })
    expect(vs.holdBay.count).toBe(0)
  })

  it('stable bays (M3): a held parcel keeps its bay until it leaves; a new arrival takes the lowest free bay; the rack never compacts', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    const bays = () =>
      Object.fromEntries(vs.holdBay.items.map((i) => [i.parcelId, i.bay]))
    // three flags through the desk, each to the next free bay
    const flagged = [0, 1, 2].map(() => {
      const p = laneParcel(sim, 'conv1', { malware: true, scripted: true })
      runUntil(sim, () => sim.state.parcels[String(p.id)]?.state === 'held')
      return p
    })
    const [a, b, c] = flagged.map((p) => p.id) as [number, number, number]
    expect(bays()).toEqual({ [a]: 0, [b]: 1, [c]: 2 })
    expect(sim.state.parcels[String(b)]?.bay).toBe(1)
    expect(sim.dispatch({ kind: 'toss', parcelId: b })).toEqual({ ok: true })
    expect(bays()).toEqual({ [a]: 0, [c]: 2 }) // a and c stay put
    expect(sim.dispatch({ kind: 'clear', parcelId: a })).toEqual({ ok: true })
    expect(bays()).toEqual({ [c]: 2 })
    const cleared = sim.state.parcels[String(a)]!
    expect(cleared.bay).toBeUndefined() // left the bay: the field goes
    // the next arrival takes the lowest free bay (0), then 1
    const d = laneParcel(sim, 'conv1', { malware: true, scripted: true })
    runUntil(sim, () => sim.state.parcels[String(d.id)]?.state === 'held')
    const e = laneParcel(sim, 'conv1', { malware: true, scripted: true })
    runUntil(sim, () => sim.state.parcels[String(e.id)]?.state === 'held')
    expect(bays()).toEqual({ [c]: 2, [d.id]: 0, [e.id]: 1 })
    // items stay in arrival order (c, d, e); `bay` is the rack position
    expect(vs.holdBay.items.map((i) => i.parcelId)).toEqual([c, d.id, e.id])
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('stable bays: held parcels without a bay (pre-M3 saves) take the lowest bays the others leave free, in arrival order', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    const a = heldParcel(sim)
    const b = heldParcel(sim)
    const c = heldParcel(sim)
    delete sim.state.parcels[String(a.id)]!.bay
    sim.state.parcels[String(b.id)]!.bay = 0
    delete sim.state.parcels[String(c.id)]!.bay
    expect(vs.holdBay.items.map((i) => [i.parcelId, i.bay])).toEqual([
      [a.id, 1],
      [b.id, 0],
      [c.id, 2],
    ])
  })

  it('debug fillHoldBay fills every free bay with flagged parcels (malware and decoys in turn); conservation holds', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim, { debug: true })
    const held = collect(sim, 'parcel:held')
    expect(vs.debug?.fillHoldBay()).toEqual({ ok: true })
    expect(vs.holdBay.count).toBe(vs.holdBay.cap)
    expect(held).toHaveLength(vs.holdBay.cap)
    const ps = vs.holdBay.items.map(
      (i) => sim.state.parcels[String(i.parcelId)]!,
    )
    expect(ps.map((p) => p.malware)).toEqual([true, false, true])
    expect(ps.every((p) => p.flaggedBy !== null)).toBe(true)
    expect(vs.debug?.fillHoldBay()).toEqual({ ok: false, reason: 'invalid' })
    expect(conservation(sim.state).ok).toBe(true)
    expect(auditState(sim.state, data)).toEqual([])
  })
})
