// spec §6.4-§6.5, §6.8 at M1 (plan.md §12.4 task 5): the generic LaneNode
// chain dock1 → conv1 → slot1..3 → shelf with PASS-THROUGH slots (the desk
// does not process until M2), conveyor cap 6 with the dock unload paused
// while it is full, the conveyor feeding slot 1 ≤ 1 parcel per tick, the
// shelf cap from the level row, stalls propagating upstream to the vehicle
// with lane:stalled / lane:resumed, and nothing ever lost.

import { describe, expect, it } from 'vitest'
import { auditState, conservation } from '../../src/sim/sim.ts'
import { laneNode } from '../../src/sim/types.ts'
import {
  buy,
  collect,
  dataFixture,
  eventLog,
  injectParcel,
  quietSim,
  runTicks,
  runUntil,
  vehicleById,
} from './helpers.ts'

const data = dataFixture()

describe('M1 pass-through lane (spec §6.4)', () => {
  it('the start lane: conveyor cap 6, slot buffers 2, shelf cap from the L1 row', () => {
    const sim = quietSim(1)
    const lane = sim.state.lane
    expect(laneNode(lane, 'conv1')?.cap).toBe(data.machines.conveyorCapPerDock)
    expect(laneNode(lane, 'slot1')?.cap).toBe(data.machines.slotBufferCap)
    expect(laneNode(lane, 'shelf')?.cap).toBe(data.levels[0]?.shelfCap)
  })

  it('a parcel passes conv1 → slot1 → slot2 → slot3 → shelf one node per tick; the desk in slot 1 does not hold it', () => {
    const sim = quietSim(1)
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
  })

  it('shelf at cap stalls the lane: slots fill (2 each), the conveyor fills to 6, the dock unload pauses; resumes when the shelf frees; nothing lost', () => {
    const sim = quietSim(1)
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

  it('the conveyor feeds slot 1 at most one parcel per tick', () => {
    const sim = quietSim(1)
    const conv = laneNode(sim.state.lane, 'conv1')!
    for (let i = 0; i < 4; i++) {
      const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
      sim.state.buildings.hr_towers_a!.waiting = []
      conv.queue.push(p.id)
      p.state = 'in_conveyor'
    }
    const entered = collect(sim, 'parcel:enteredSlot')
    for (let t = 1; t <= 4; t++) {
      runTicks(sim, 1)
      expect(entered.filter((e) => e.nodeId === 'slot1')).toHaveLength(t)
    }
    runTicks(sim, 4)
    expect(laneNode(sim.state.lane, 'shelf')?.queue).toHaveLength(4)
  })
})
