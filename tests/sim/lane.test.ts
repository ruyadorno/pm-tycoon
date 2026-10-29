// spec §6.1-§6.4, §6.8 (plan.md §12.5 task 1): the fixed intake lane
// conv1 (cap 6) → slot1..3 (empty | machine | desk, buffer cap 2) → Hold Bay
// (flagged) / shelf; one parcel per tick hand-off per node; the conveyor feeds
// slot 1 at most one parcel per tick; an inspector desk processes 15/min per
// inspector, a machine 60/min; a full Hold Bay stalls the flagging slot and the
// stall propagates upstream to the conveyor and the docked vehicle; a full
// shelf stalls the last slot; a busy desk is backpressure, not a stall;
// lane:stalled / lane:resumed; nothing is ever lost (conservation identity).

import { describe, expect, it } from 'vitest'
import { auditState, conservation } from '../../src/sim/sim.ts'
import { laneNode, TICKS_PER_S } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  buy,
  collect,
  dataFixture,
  eventLog,
  feeder,
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
const PER_MIN = 60 * TICKS_PER_S

/** Parcels shelved per in-game minute in steady state (after a warm-up). */
function steadyRate(sim: ReturnType<typeof quietSim>, fed: number): number {
  laneNode(sim.state.lane, 'shelf')!.cap = null // measure the lane, not the shelf
  const feed = feeder(sim, fed)
  const shelved = collect(sim, 'parcel:shelved')
  for (let t = 0; t < 30 * TICKS_PER_S; t++) {
    feed()
    sim.tick()
  }
  const before = shelved.length
  for (let t = 0; t < PER_MIN; t++) {
    feed()
    sim.tick()
  }
  return shelved.length - before
}

describe('lane topology and caps (spec §6.1, §6.2, §6.4)', () => {
  it('the start lane: conveyor cap 6, slot buffers 2, Hold Bay and shelf caps from the L1 row, the desk + 1 inspector in slot 1', () => {
    const sim = quietSim(1)
    const lane = sim.state.lane
    expect(laneNode(lane, 'conv1')?.cap).toBe(data.machines.conveyorCapPerDock)
    expect(laneNode(lane, 'slot1')?.cap).toBe(data.machines.slotBufferCap)
    expect(laneNode(lane, 'hold')?.cap).toBe(data.levels[0]?.holdBayCap)
    expect(laneNode(lane, 'shelf')?.cap).toBe(data.levels[0]?.shelfCap)
    const desk = laneNode(lane, 'slot1')!
    expect(desk.fixture?.kind).toBe('desk')
    expect(desk.stations).toHaveLength(1)
    expect(laneNode(lane, 'slot2')?.fixture).toBeNull()
  })

  it('empty slots pass a parcel through one node per tick (0 s); the trace notes each empty slot', () => {
    const sim = noCheckers(quietSim(1))
    buy(sim, 'bike')
    const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const log = eventLog(sim)
    const unloaded = collect(sim, 'parcel:unloaded')
    runUntil(sim, () => unloaded.length > 0)
    runTicks(sim, 5)
    const lane = log.filter((e) =>
      ['parcel:unloaded', 'parcel:enteredSlot', 'parcel:shelved'].includes(
        e.name,
      ),
    )
    const t0 = lane[0]!.tick
    expect(
      lane.map((e) => [
        e.name,
        e.tick - t0,
        (e.p as { nodeId?: string }).nodeId ?? null,
      ]),
    ).toEqual([
      ['parcel:unloaded', 0, null],
      ['parcel:enteredSlot', 0, 'slot1'],
      ['parcel:enteredSlot', 1, 'slot2'],
      ['parcel:enteredSlot', 2, 'slot3'],
      ['parcel:shelved', 3, null],
    ])
    expect(laneNode(sim.state.lane, 'shelf')?.queue).toContain(p.id)
    const texts = sim.state.parcels[String(p.id)]!.trace.map((t) => t.text)
    expect(texts).toEqual(
      expect.arrayContaining([
        'Slot 1: empty',
        'Slot 2: empty',
        'Slot 3: empty',
      ]),
    )
  })

  it('the conveyor feeds slot 1 at most one parcel per tick', () => {
    const sim = noCheckers(quietSim(1))
    for (let i = 0; i < 4; i++) laneParcel(sim, 'conv1')
    const entered = collect(sim, 'parcel:enteredSlot')
    for (let t = 1; t <= 4; t++) {
      runTicks(sim, 1)
      expect(entered.filter((e) => e.nodeId === 'slot1')).toHaveLength(t)
    }
    runTicks(sim, 4)
    expect(laneNode(sim.state.lane, 'shelf')?.queue).toHaveLength(4)
  })

  it('a slot buffer holds at most slotBufferCap parcels; the conveyor at most conveyorCapPerDock', () => {
    const sim = quietSim(1) // desk in slot 1, 15/min
    const van = buy(sim, 'van')
    for (let i = 0; i < 14; i++) {
      injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    }
    runUntil(sim, () => vehicleById(sim, van.id).state === 'docked_unloading')
    const lane = sim.state.lane
    let maxBuffer = 0
    let maxConv = 0
    for (let t = 0; t < 300; t++) {
      sim.tick()
      maxBuffer = Math.max(maxBuffer, laneNode(lane, 'slot1')!.queue.length)
      maxConv = Math.max(maxConv, laneNode(lane, 'conv1')!.queue.length)
    }
    expect(maxBuffer).toBe(data.machines.slotBufferCap)
    expect(maxConv).toBe(data.machines.conveyorCapPerDock)
  })
})

describe('throughput (spec §6.3)', () => {
  it('one inspector = 15/min; three = 45/min; a machine = 60/min; ViewSim lane.rate() agrees', () => {
    const one = quietSim(1)
    expect(steadyRate(one, 200)).toBe(15)
    expect(createViewSim(one).lane.rate()).toBe(15)

    const three = quietSim(1)
    three.state.economy.balance = 1000
    three.dispatch({ kind: 'hireInspector' })
    three.dispatch({ kind: 'hireInspector' })
    expect(laneNode(three.state.lane, 'slot1')?.stations).toHaveLength(3)
    expect(steadyRate(three, 200)).toBe(45)
    expect(createViewSim(three).lane.rate()).toBe(45)

    const machine = noCheckers(quietSim(1))
    placeMachine(machine, 'metal_detector', 'slot1')
    expect(steadyRate(machine, 200)).toBe(60)
    expect(createViewSim(machine).lane.rate()).toBe(60)
  })

  it('a parcel waits in the buffer until a station frees, is processed for processTime (parcel:processing), then moves on', () => {
    const sim = quietSim(1)
    const a = laneParcel(sim, 'slot1')
    const b = laneParcel(sim, 'slot1')
    const processing = collect(sim, 'parcel:processing')
    const log = eventLog(sim)
    runTicks(sim, 1)
    expect(processing).toEqual([{ id: a.id, nodeId: 'slot1' }])
    const t0 = sim.state.tick
    runTicks(sim, 40)
    const firstOut = log.find(
      (e) =>
        e.name === 'parcel:enteredSlot' && (e.p as { id: number }).id === a.id,
    )
    expect(firstOut?.tick).toBe(t0 + data.employees.inspector.processS * 10)
    expect(processing.at(-1)).toEqual({ id: b.id, nodeId: 'slot1' })
  })
})

describe('stalls (spec §6.4, warehouse-view.md §3.2)', () => {
  it('a full Hold Bay stalls the flagging slot; the stall propagates to slot 2, slot 1, the conveyor and the docked vehicle; a Toss resumes it next tick', () => {
    const sim = noCheckers(quietSim(1))
    placeMachine(sim, 'metal_detector', 'slot3')
    const hold = laneNode(sim.state.lane, 'hold')!
    hold.cap = 1
    const van = buy(sim, 'van')
    // scripted malware: every one is flagged at the first checker (slot 3)
    const ps = Array.from({ length: 16 }, () =>
      injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { malware: true }),
    )
    for (const p of ps) p.scripted = true
    const stalled = collect(sim, 'lane:stalled')
    const resumed = collect(sim, 'lane:resumed')
    runUntil(sim, () => vehicleById(sim, van.id).state === 'docked_unloading')
    runTicks(sim, 400)
    const lane = sim.state.lane
    expect(stalled).toEqual([{ reason: 'holdBayFull', nodeId: 'slot3' }])
    expect(lane.stalled).toBe(true)
    expect(hold.queue).toHaveLength(1)
    expect(laneNode(lane, 'slot3')?.stations[0]?.parcelId).not.toBeNull()
    for (const id of ['slot1', 'slot2', 'slot3']) {
      expect(laneNode(lane, id)?.queue).toHaveLength(2)
    }
    expect(laneNode(lane, 'conv1')?.queue).toHaveLength(6)
    const v = vehicleById(sim, van.id)
    expect(v.state).toBe('docked_unloading')
    expect(v.cargo).toHaveLength(16 - 1 - 1 - 6 - 6)
    expect(lane.stallSecondsToday).toBeGreaterThan(30)
    expect(conservation(sim.state).ok).toBe(true)
    // the dark parcel in slot 3 diverts on the tick after a Toss
    const held = hold.queue[0]!
    expect(sim.dispatch({ kind: 'toss', parcelId: held })).toEqual({ ok: true })
    runTicks(sim, 1)
    expect(resumed).toHaveLength(1)
    expect(hold.queue).toHaveLength(1)
    expect(hold.queue[0]).not.toBe(held)
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('shelf at cap stalls the lane: slots fill (2 each), the conveyor fills to 6, the dock unload pauses; resumes when the shelf frees; nothing lost', () => {
    const sim = noCheckers(quietSim(1))
    const van = buy(sim, 'van') // 16 units
    const shelf = laneNode(sim.state.lane, 'shelf')!
    shelf.cap = 0
    for (let i = 0; i < 14; i++)
      injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const stalled = collect(sim, 'lane:stalled')
    const resumed = collect(sim, 'lane:resumed')
    runUntil(sim, () => vehicleById(sim, van.id).state === 'docked_unloading')
    runTicks(sim, 400)
    const v = vehicleById(sim, van.id)
    const lane = sim.state.lane
    expect(v.state).toBe('docked_unloading')
    expect(v.cargo).toHaveLength(2) // 14 − 6 in the slots − 6 on the conveyor
    expect(laneNode(lane, 'conv1')?.queue).toHaveLength(6)
    for (const id of ['slot1', 'slot2', 'slot3']) {
      expect(laneNode(lane, id)?.queue).toHaveLength(2)
    }
    expect(stalled).toEqual([{ reason: 'shelfFull', nodeId: 'slot3' }])
    expect(lane.stalled).toBe(true)
    expect(lane.stallSecondsToday).toBeGreaterThan(30)
    expect(conservation(sim.state).ok).toBe(true)
    shelf.cap = data.levels[0]!.shelfCap
    runTicks(sim, 2)
    expect(resumed).toHaveLength(1)
    expect(lane.stalled).toBe(false)
    runUntil(sim, () => vehicleById(sim, van.id).cargo.length === 0, 100)
    expect(auditState(sim.state, data)).toEqual([])
    expect(conservation(sim.state).ok).toBe(true)
  })

  it('a busy desk is backpressure, not a stall: the conveyor fills and the vehicle unloads at the desk’s pace, no lane:stalled', () => {
    const sim = quietSim(1)
    const van = buy(sim, 'van')
    for (let i = 0; i < 16; i++)
      injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const stalled = collect(sim, 'lane:stalled')
    const unloaded = collect(sim, 'vehicle:unloaded')
    runUntil(sim, () => vehicleById(sim, van.id).state === 'docked_unloading')
    let convFull = 0
    for (let t = 0; t < 600; t++) {
      sim.tick()
      if (laneNode(sim.state.lane, 'conv1')!.queue.length === 6) convFull += 1
    }
    expect(convFull).toBeGreaterThan(100)
    expect(stalled).toEqual([])
    expect(sim.state.lane.stallSecondsToday).toBe(0)
    expect(unloaded[0]).toEqual({ id: van.id }) // all 16 unloaded within the minute
  })
})

describe('stalls vs backpressure wherever the desk sits (spec §6.4, M2 review)', () => {
  for (const layout of [
    'desk in slot 2 behind a Metal detector',
    'desk in slot 3',
  ] as const) {
    it(`a busy desk is backpressure, not a stall, with the ${layout}: the full buffers upstream of it never raise lane:stalled; 15/min`, () => {
      const sim = quietSim(1)
      if (layout === 'desk in slot 3') {
        expect(
          sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot3' }),
        ).toEqual({ ok: true })
      } else {
        expect(
          sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot2' }),
        ).toEqual({ ok: true })
        placeMachine(sim, 'metal_detector', 'slot1')
      }
      const stalled = collect(sim, 'lane:stalled')
      expect(steadyRate(sim, 200)).toBe(15)
      // the upstream buffers really were full the whole time (a queue)
      expect(laneNode(sim.state.lane, 'conv1')!.queue.length).toBe(6)
      expect(stalled).toEqual([])
      expect(sim.state.lane.stallSecondsToday).toBe(0)
    })
  }

  it('the stall root is still found behind a busy desk: a full shelf downstream of the desk stalls (shelfFull, slot 3)', () => {
    const sim = quietSim(1)
    sim.dispatch({ kind: 'moveFixture', from: 'slot1', to: 'slot2' })
    placeMachine(sim, 'metal_detector', 'slot1')
    laneNode(sim.state.lane, 'shelf')!.cap = 2
    const feed = feeder(sim, 40)
    const stalled = collect(sim, 'lane:stalled')
    for (let t = 0; t < 1200; t++) {
      feed()
      sim.tick()
    }
    expect(stalled[0]).toEqual({ reason: 'shelfFull', nodeId: 'slot3' })
    expect(sim.state.lane.stallReason).toBe('shelfFull')
  })
})

describe('conservation (plan.md §12.5 acceptance)', () => {
  it('nothing is ever lost: spawned = waiting + vehicles + lane + held + shelf + delivered + tossed every 600 ticks of a busy lane', () => {
    const sim = quietSim(4)
    buy(sim, 'bike')
    buy(sim, 'van')
    for (const d of Object.values(sim.state.districts)) {
      if (d.live) d.nextSpawnTick = 1
    }
    for (let minute = 0; minute < 8; minute++) {
      runTicks(sim, 600)
      // Toss everything held (the policy's rule) so the lane keeps moving.
      const hold = laneNode(sim.state.lane, 'hold')!
      for (const id of hold.queue.slice()) {
        sim.dispatch({ kind: 'toss', parcelId: id })
      }
      const c = conservation(sim.state)
      expect(c.ok, JSON.stringify(c)).toBe(true)
      expect(auditState(sim.state, data)).toEqual([])
    }
    expect(sim.state.stats.deliveries).toBeGreaterThan(10)
  })
})
