// M8 loading docks 2-3 (spec-core §6.5, spec-build2 §4.1; design-m8-m9
// §3.1, §4.2-§4.3, §4.9, §7 M8 3): buyDock's failures and success (node
// pairs in number order, conv<n>.next = conv1.next, dock:bought), dock 3
// before dock 2, the ViewSim dock slots, the round-robin feed of slot 1 from
// two conveyors (lane.feedIndex), stall propagation through two conveyors
// into two docks, and three vehicles sharing two docks (the third takes the
// first freed one).

import { describe, expect, it } from 'vitest'
import { auditState, Sim, stateHash } from '../../src/sim/sim.ts'
import { dockTile } from '../../src/sim/systems/vehicles.ts'
import type { Vehicle } from '../../src/sim/types.ts'
import { laneNode } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  buy,
  collect,
  dataFixture,
  fund,
  injectParcel,
  laneParcel,
  noCheckers,
  placeMachine,
  quietSim,
  runTicks,
  runUntil,
  vehicleById,
} from './helpers.ts'

const data = dataFixture()
const dock2 = data.economy.docks.find((r) => r.index === 2)!
const dock3 = data.economy.docks.find((r) => r.index === 3)!

/** A quiet sim forced to `level` (its row's unlocks), funded. */
function atLevel(level: number, seed = 1): Sim {
  const sim = quietSim(seed)
  const res = sim.dispatch({ kind: 'debugForceLevel', level })
  if (!res.ok) throw new Error(`forceLevel ${level}: ${res.reason}`)
  for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
  return fund(sim)
}

const nodeIds = (sim: Sim): string[] => sim.state.lane.nodes.map((n) => n.id)

describe('buyDock (design-m8-m9 §3.1, §4.2)', () => {
  it('failures change nothing: index 1 / 4 invalid, below the unlock level locked, short of $800 insufficient-funds, twice invalid', () => {
    expect(dock2).toEqual({ index: 2, unlockLevel: 3, price: 800 })
    expect(dock3).toEqual({ index: 3, unlockLevel: 4, price: 1000 })
    const sim = quietSim(1)
    fund(sim)
    const try1 = (index: number) => {
      const hash = stateHash(sim.state)
      const log = sim.commandLog.length
      const res = sim.dispatch({ kind: 'buyDock', index })
      if (!res.ok) {
        expect(stateHash(sim.state)).toBe(hash)
        expect(sim.commandLog).toHaveLength(log)
      }
      return res
    }
    expect(try1(1)).toEqual({ ok: false, reason: 'invalid' })
    expect(try1(4)).toEqual({ ok: false, reason: 'invalid' })
    expect(try1(0)).toEqual({ ok: false, reason: 'invalid' })
    expect(try1(2)).toEqual({ ok: false, reason: 'locked' }) // L1
    sim.dispatch({ kind: 'debugForceLevel', level: 2 })
    expect(try1(2)).toEqual({ ok: false, reason: 'locked' }) // L2
    sim.dispatch({ kind: 'debugForceLevel', level: 3 })
    sim.state.economy.balance = dock2.price - 1
    expect(try1(2)).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(try1(3)).toEqual({ ok: false, reason: 'locked' }) // L3
    sim.state.economy.balance = dock2.price
    expect(try1(2)).toEqual({ ok: true })
    expect(sim.state.economy.balance).toBe(0)
    fund(sim)
    expect(try1(2)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('success: −$800, node order dock1, conv1, dock2, conv2, slot1 …; conv2.next = conv1.next, cap 6; dock:bought {2, dock2}; the state loads', () => {
    const sim = atLevel(3)
    const bought = collect(sim, 'dock:bought')
    const money = collect(sim, 'money:changed')
    const balance = sim.state.economy.balance
    expect(sim.dispatch({ kind: 'buyDock', index: 2 })).toEqual({ ok: true })
    expect(sim.state.economy.balance).toBe(balance - 800)
    expect(money).toEqual([
      { delta: -800, reason: 'purchase', balance: balance - 800 },
    ])
    expect(bought).toEqual([{ index: 2, dockId: 'dock2' }])
    expect(nodeIds(sim).slice(0, 5)).toEqual([
      'dock1',
      'conv1',
      'dock2',
      'conv2',
      'slot1',
    ])
    const lane = sim.state.lane
    const conv1 = laneNode(lane, 'conv1')!
    const conv2 = laneNode(lane, 'conv2')!
    expect(laneNode(lane, 'dock2')).toMatchObject({
      kind: 'dock',
      next: ['conv2'],
      cap: null,
      dockId: 'dock2',
    })
    expect(conv2).toMatchObject({
      kind: 'conveyor',
      cap: data.machines.conveyorCapPerDock,
      dockId: 'dock2',
      queue: [],
    })
    expect(conv2.next).toEqual(conv1.next)
    expect(conv2.next).not.toBe(conv1.next)
    expect(lane.docks).toEqual([
      expect.objectContaining({ id: 'dock1', conveyorNodeId: 'conv1' }),
      {
        id: 'dock2',
        conveyorNodeId: 'conv2',
        vehicleId: null,
        nextTransferTick: null,
        busyTicksThisDay: 0,
        blockedTicksThisDay: 0,
        stuckSinceTick: null,
      },
    ])
    expect(lane.feedIndex).toBe(0)
    expect(auditState(sim.state, data)).toEqual([])
    const loaded = Sim.load(data, JSON.parse(JSON.stringify(sim.snapshot())))
    expect(loaded.state.lane).toEqual(sim.state.lane)
    // The laneRate cap counts both docks (§6.3).
    expect(createViewSim(sim).lane.rate()).toBeGreaterThan(0)
  })

  it('dock 3 before dock 2 (forceLevel 4): lane.docks [dock1, dock3], dockTile(dock3) = lot.docks[2]; dock 2 then slots in between', () => {
    const sim = atLevel(4)
    expect(sim.dispatch({ kind: 'buyDock', index: 3 })).toEqual({ ok: true })
    expect(sim.state.lane.docks.map((d) => d.id)).toEqual(['dock1', 'dock3'])
    expect(nodeIds(sim).slice(0, 5)).toEqual([
      'dock1',
      'conv1',
      'dock3',
      'conv3',
      'slot1',
    ])
    const bays = data.map.lot.docks
    expect(dockTile(sim, 'dock3')).toEqual({ x: bays[2]![0], y: bays[2]![1] })
    expect(dockTile(sim, 'dock1')).toEqual({ x: bays[0]![0], y: bays[0]![1] })
    expect(auditState(sim.state, data)).toEqual([])
    sim.state.lane.feedIndex = 1 // pointing at conv3
    expect(sim.dispatch({ kind: 'buyDock', index: 2 })).toEqual({ ok: true })
    expect(sim.state.lane.docks.map((d) => d.id)).toEqual([
      'dock1',
      'dock2',
      'dock3',
    ])
    expect(sim.state.lane.feedIndex).toBe(2) // still conv3
    expect(nodeIds(sim).slice(0, 7)).toEqual([
      'dock1',
      'conv1',
      'dock2',
      'conv2',
      'dock3',
      'conv3',
      'slot1',
    ])
    expect(dockTile(sim, 'dock2')).toEqual({ x: bays[1]![0], y: bays[1]![1] })
    expect(auditState(sim.state, data)).toEqual([])
    expect(() =>
      Sim.load(data, JSON.parse(JSON.stringify(sim.snapshot()))),
    ).not.toThrow()
  })

  it('ViewSim lane.dockSlots(): dock 1 owned, dock 2 available at L3 ($800), dock 3 not before L4 ($1,000); lane.buyDock dispatches', () => {
    const sim = atLevel(3)
    const vs = createViewSim(sim)
    expect(vs.lane.dockSlots()).toEqual([
      {
        index: 1,
        dockId: 'dock1',
        owned: true,
        unlockLevel: 1,
        price: 0,
        available: true,
      },
      {
        index: 2,
        dockId: 'dock2',
        owned: false,
        unlockLevel: 3,
        price: 800,
        available: true,
      },
      {
        index: 3,
        dockId: 'dock3',
        owned: false,
        unlockLevel: 4,
        price: 1000,
        available: false,
      },
    ])
    expect(vs.lane.buyDock(3)).toEqual({ ok: false, reason: 'locked' })
    expect(vs.lane.buyDock(2)).toEqual({ ok: true })
    expect(vs.lane.dockSlots()[1]).toMatchObject({ owned: true })
    expect(vs.docks.map((d) => d.id)).toEqual(['dock1', 'dock2'])
    expect(sim.commandLog.at(-1)?.cmd).toEqual({ kind: 'buyDock', index: 2 })
  })
})

/** Which conveyor each slot-1 arrival came from, in order. */
function slotOneSources(
  sim: Sim,
  sourceOf: (id: number) => string | undefined,
): string[] {
  const out: string[] = []
  sim.events.on('parcel:enteredSlot', (e) => {
    if (e.nodeId === 'slot1') out.push(sourceOf(e.id) ?? '?')
  })
  return out
}

describe('two conveyors into slot 1 (design-m8-m9 §4.3)', () => {
  it('both conveyors full + a one-inspector desk in slot 1 for 2 min: the feeds alternate conv1/conv2, counts within 1', () => {
    const sim = atLevel(3)
    expect(sim.dispatch({ kind: 'buyDock', index: 2 })).toEqual({ ok: true })
    const from: Record<number, string> = {}
    const topUp = (): void => {
      for (const id of ['conv1', 'conv2']) {
        const conv = laneNode(sim.state.lane, id)!
        while (conv.queue.length < (conv.cap ?? 0)) {
          from[laneParcel(sim, id).id] = id
        }
      }
    }
    const order = slotOneSources(sim, (id) => from[id])
    for (let t = 0; t < 1200; t++) {
      topUp()
      sim.tick()
    }
    const n1 = order.filter((x) => x === 'conv1').length
    const n2 = order.filter((x) => x === 'conv2').length
    expect(n1 + n2).toBeGreaterThan(25)
    expect(Math.abs(n1 - n2)).toBeLessThanOrEqual(1)
    order.forEach((x, i) => {
      if (i > 0) expect(x, `arrival ${i}`).not.toBe(order[i - 1])
    })
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('Q-RUN1 relief with two docks (M8 review): the relieving dock takes every feed while its conveyor holds a parcel, the other conveyor feeds only once it is empty, and alternation returns with the relief', () => {
    const sim = atLevel(3)
    expect(sim.dispatch({ kind: 'buyDock', index: 2 })).toEqual({ ok: true })
    const from: Record<number, string> = {}
    const topUp = (ids: string[]): void => {
      for (const id of ids) {
        const conv = laneNode(sim.state.lane, id)!
        while (conv.queue.length < (conv.cap ?? 0)) {
          from[laneParcel(sim, id).id] = id
        }
      }
    }
    const order = slotOneSources(sim, (id) => from[id])
    const dock = sim.state.lane.docks[1]!
    expect(dock.id).toBe('dock2')
    dock.relief = true
    for (let t = 0; t < 600; t++) {
      topUp(['conv1', 'conv2'])
      sim.tick()
    }
    expect(order.length).toBeGreaterThan(10)
    expect(new Set(order)).toEqual(new Set(['conv2']))
    // conv2 runs dry (its vehicle is between unloads): conv1 fills the gaps.
    order.length = 0
    for (let t = 0; t < 600; t++) {
      topUp(['conv1'])
      sim.tick()
    }
    const firstConv1 = order.indexOf('conv1')
    expect(firstConv1).toBeGreaterThan(0)
    expect(order.slice(0, firstConv1).every((x) => x === 'conv2')).toBe(true)
    expect(order.slice(firstConv1).every((x) => x === 'conv1')).toBe(true)
    // Relief over: round-robin again.
    delete dock.relief
    order.length = 0
    for (let t = 0; t < 600; t++) {
      topUp(['conv1', 'conv2'])
      sim.tick()
    }
    expect(order.length).toBeGreaterThan(10)
    order.forEach((x, i) => {
      if (i > 0) expect(x, `arrival ${i}`).not.toBe(order[i - 1])
    })
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('stall propagation: a full Hold Bay + a flagged parcel in slot 1 → lane:stalled {holdBayFull, slot1}, both conveyors back up to 6, both docks accrue blocked ticks; one Toss → lane:resumed, both drain alternately', () => {
    const sim = stalledTwoDocks()
    const { lane, vans } = sim
    expect(sim.stalled).toContainEqual({
      reason: 'holdBayFull',
      nodeId: 'slot1',
    })
    expect(lane.stalled).toBe(true)
    expect(laneNode(lane, 'conv1')!.queue).toHaveLength(6)
    expect(laneNode(lane, 'conv2')!.queue).toHaveLength(6)
    for (const d of lane.docks) {
      const v = vans.find((x) => x.id === d.vehicleId)
      expect(v, d.id).toBeDefined()
      expect(v!.state).toBe('docked_unloading')
      expect(v!.cargo.length).toBeGreaterThan(0)
      expect(d.blockedTicksThisDay).toBeGreaterThan(0)
      expect(d.stuckSinceTick).not.toBeNull()
    }
    const resumed = collect(sim.sim, 'lane:resumed')
    const order = slotOneSources(sim.sim, (id) => sim.from[id])
    const hold = laneNode(lane, 'hold')!
    expect(
      sim.sim.dispatch({ kind: 'toss', parcelId: hold.queue[0]! }),
    ).toEqual({ ok: true })
    runTicks(sim.sim, 1)
    expect(resumed).toHaveLength(1)
    runTicks(sim.sim, 150)
    expect(order.length).toBeGreaterThan(8)
    order.slice(0, 8).forEach((x, i) => {
      if (i > 0) expect(x, `arrival ${i}`).not.toBe(order[i - 1])
    })
    expect(auditState(sim.sim.state, data)).toEqual([])
  })

  it('three vehicles, two docks: the third queues while both docks are blocked and takes the first freed one (the Q-RUN1 yield frees one dock per waiting vehicle)', () => {
    const t = stalledTwoDocks({ third: true })
    const { sim, lane } = t
    const truck = t.third!
    let atQueue: (number | null)[] | null = null
    sim.addTap((name, p) => {
      if (name === 'vehicle:queued' && (p as { id: number }).id === truck.id) {
        atQueue = lane.docks.map((d) => d.vehicleId)
      }
    })
    const yields = collect(sim, 'vehicle:queued')
    expect(runUntil(sim, () => truck.dockId !== null, 6000)).toBeGreaterThan(0)
    // It queued with both docks held by the blocked vans …
    expect(atQueue).not.toBeNull()
    const before = atQueue as unknown as number[]
    expect(before.toSorted()).toEqual(t.vans.map((v) => v.id).toSorted())
    // … and took the dock its van yielded (that van, cargo aboard, now at
    // the back of the queue); the other van kept its dock — one yield only.
    const i = lane.docks.findIndex((d) => d.id === truck.dockId)
    const yielded = vehicleById(sim, before[i]!)
    expect(yielded.dockId).toBeNull()
    expect(yielded.state).toBe('queued')
    expect(yielded.cargo.length).toBeGreaterThan(0)
    expect(lane.docks[1 - i]!.vehicleId).toBe(before[1 - i])
    expect(lane.dockQueue).toEqual([yielded.id])
    expect(yields.map((y) => y.id)).toEqual([truck.id, yielded.id])
    expect(auditState(sim.state, data)).toEqual([])
  })
})

interface Stalled {
  sim: Sim
  lane: Sim['state']['lane']
  vans: Vehicle[]
  third: Vehicle | null
  stalled: { reason: string; nodeId: string }[]
  /** Parcel id → the conveyor its dock unloaded it onto. */
  from: Record<number, string>
}

/**
 * L3 with dock 2, a Metal detector in slot 1, the Hold Bay full and the next
 * roll forced to flag (so slot 1's parcel cannot divert); two vans (homed in
 * Node Heights / Registry Row) bring 12 parcels each from one building —
 * more than slot 1, its buffer and both conveyors hold — and dock at dock1 /
 * dock2. With `third`,
 * a truck homed in Hoist Hill brings 3 more and arrives last.
 */
function stalledTwoDocks(opts: { third?: boolean } = {}): Stalled {
  const sim = noCheckers(atLevel(3))
  placeMachine(sim, 'metal_detector', 'slot1')
  fund(sim)
  expect(sim.dispatch({ kind: 'buyDock', index: 2 })).toEqual({ ok: true })
  const stalled = collect(sim, 'lane:stalled')
  const from: Record<number, string> = {}
  sim.events.on('parcel:unloaded', (e) => {
    from[e.id] = e.dockId === 'dock1' ? 'conv1' : 'conv2'
  })
  const vanA = buy(sim, 'van')
  const vanB = buy(sim, 'van')
  sim.dispatch({ kind: 'setZone', id: vanA.id, zone: 'highres' })
  sim.dispatch({ kind: 'setZone', id: vanB.id, zone: 'downtown' })
  // One stop each: a van takes every parcel waiting at its building.
  for (let i = 0; i < 12; i++) {
    injectParcel(sim, 'hr_towers_a', 'dt_tarball_hotel')
    injectParcel(sim, 'dt_registry_tower', 'hr_async_arms')
  }
  let third: Vehicle | null = null
  if (opts.third) {
    third = buy(sim, 'truck')
    sim.dispatch({ kind: 'setZone', id: third.id, zone: 'industrial' })
  }
  fund(sim)
  expect(sim.dispatch({ kind: 'debugFillHoldBay' })).toEqual({ ok: true })
  expect(laneNode(sim.state.lane, 'hold')!.queue).toHaveLength(5)
  expect(sim.dispatch({ kind: 'debugForceFlag', strain: 'metal' })).toEqual({
    ok: true,
  })
  const lane = sim.state.lane
  const vans = [vanA, vanB]
  const blocked = (): boolean =>
    lane.docks.every((d) => {
      const v = vans.find((x) => x.id === d.vehicleId)
      return (
        v !== undefined &&
        v.state === 'docked_unloading' &&
        v.cargo.length > 0 &&
        (d.blockedTicksThisDay ?? 0) > 0
      )
    })
  expect(runUntil(sim, blocked, 6000)).toBeGreaterThan(0)
  runTicks(sim, 20)
  // The third vehicle's parcels appear only now: it arrives last.
  if (third) {
    for (let i = 0; i < 3; i++) {
      injectParcel(sim, 'in_glob_silos', 'hr_daycare')
    }
  }
  return { sim, lane, vans, third, stalled, from }
}
