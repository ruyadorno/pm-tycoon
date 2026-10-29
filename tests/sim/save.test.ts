// plan.md §6.4 "Save and load" + §6.9.1 save.test: snapshot → JSON → load →
// deep-equal; 600 ticks after a load = the uninterrupted run; no non-JSON
// values; version + dataHash gate (no migrations, R9). Also pins the M0 sim
// skeleton the save format rests on: the spec §7.1 start state, the tick
// clock + day boundary, and the "handlers never dispatch" rule.

import { describe, expect, it } from 'vitest'
import {
  auditState,
  replay,
  Sim,
  SimLoadError,
  stateHash,
} from '../../src/sim/sim.ts'
import {
  deserialise,
  isCompatible,
  restore,
  SaveError,
  serialise,
} from '../../src/sim/save.ts'
import { TICKS_PER_DAY } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  collect,
  dataFixture,
  makeSim,
  openingA,
  runSeconds,
  runTicks,
} from './helpers.ts'

/** A game a little past its first day boundary, with commands in the log. */
function playedSim(seed = 7): Sim {
  const sim = makeSim(seed)
  openingA(sim)
  runSeconds(sim, 75)
  return sim
}

describe('save round trip (plan.md §6.4)', () => {
  it('snapshot → JSON → load deep-equals the live state and command log', () => {
    const sim = playedSim()
    const json = JSON.stringify(sim.snapshot())
    const loaded = Sim.load(dataFixture(), JSON.parse(json))
    expect(loaded.state).toEqual(sim.state)
    expect(loaded.commandLog).toEqual(sim.commandLog)
    expect(stateHash(loaded.state)).toBe(stateHash(sim.state))
  })

  it('600 ticks after a load = the uninterrupted run (incl. the rng stream)', () => {
    const live = playedSim()
    const loaded = Sim.load(
      dataFixture(),
      JSON.parse(JSON.stringify(live.snapshot())),
    )
    runTicks(live, 600)
    runTicks(loaded, 600)
    expect(loaded.state).toEqual(live.state)
    expect(stateHash(loaded.state)).toBe(stateHash(live.state))
    expect(loaded.rng.next()).toBe(live.rng.next())
  })

  it('the state holds JSON values only (no undefined / NaN / Map / class)', () => {
    const sim = playedSim()
    expect(auditState(sim.state, sim.data)).toEqual([])
    expect(JSON.parse(JSON.stringify(sim.state))).toEqual(sim.state)
  })

  it('pm.save.v1 payload: serialise → deserialise → isCompatible → restore', () => {
    const sim = playedSim()
    const onboarding = {
      step: 2,
      skipped: false,
      sawFirstFlag: true,
      sawTossHint: false,
      wanted: ['evil-lodash'],
    }
    const text = serialise(sim, { savedAt: 1234, build: 'test', onboarding })
    const payload = deserialise(text)
    expect(payload.version).toBe(1)
    expect(payload.dataHash).toBe(sim.data.hash)
    expect(payload.onboarding).toEqual(onboarding)
    expect(isCompatible(payload, dataFixture())).toBe(true)
    expect(restore(dataFixture(), payload).state).toEqual(sim.state)
  })

  it('a save from other data tables or another version is not compatible', () => {
    const payload = deserialise(
      serialise(playedSim(), { savedAt: 0, build: 'test' }),
    )
    const retuned = dataFixture({ economy: { startMoney: 600 } })
    expect(retuned.hash).not.toBe(payload.dataHash)
    expect(isCompatible(payload, retuned)).toBe(false)
    expect(isCompatible({ ...payload, version: 2 }, dataFixture())).toBe(false)
    expect(() => Sim.load(retuned, payload)).toThrow(SimLoadError)
    expect(
      Sim.load(retuned, payload, { ignoreDataHash: true }).state.tick,
    ).toBe(payload.state.tick)
    expect(() => deserialise('{nope')).toThrow(SaveError)
    expect(() => deserialise('{"version":1}')).toThrow(SaveError)
  })

  it('Sim.load rejects dangling ids and non-JSON numbers', () => {
    const snap = playedSim().snapshot()
    const dangling = structuredClone(snap)
    const first = Object.values(dangling.state.buildings)[0]
    first?.waiting.push(999)
    expect(() => Sim.load(dataFixture(), dangling)).toThrow(/parcel 999/)
    const nan = structuredClone(snap)
    nan.state.economy.balance = Number.NaN
    expect(() => Sim.load(dataFixture(), nan)).toThrow(SimLoadError)
    const docked = structuredClone(snap)
    if (docked.state.vehicles[0]) docked.state.vehicles[0].dockId = 'dock9'
    expect(() => Sim.load(dataFixture(), docked)).toThrow(/dock9/)
  })

  it('seed + data + commandLog replay to the same state', () => {
    const sim = playedSim(3)
    const again = replay(sim.data, 3, sim.commandLog, sim.state.tick)
    expect(stateHash(again.state)).toBe(stateHash(sim.state))
  })
})

describe('sim skeleton the save rests on (spec §7.1, plan.md §6.4)', () => {
  it('§7.1 start: $450, 3 lives, L1 row, L1 districts live, desk + 1 inspector in slot 1, no vehicles', () => {
    const sim = makeSim(1)
    const s = sim.state
    const d = sim.data
    expect(s.economy.balance).toBe(d.economy.startMoney)
    expect(s.economy.lives).toBe(d.economy.lives.start)
    expect(s.level).toMatchObject({
      level: 1,
      nextThreshold: d.levels[1]?.threshold,
      slots: d.levels[0]?.slots,
      holdBayCap: d.levels[0]?.holdBayCap,
      shelfCap: d.levels[0]?.shelfCap,
      warehouseTier: 1,
    })
    const live = d.districts.filter((x) => x.unlockLevel <= 1).map((x) => x.id)
    expect(s.level.unlocked).toEqual(live)
    expect(Object.keys(s.districts)).toEqual(d.districts.map((x) => x.id))
    for (const id of live) {
      expect(s.districts[id]).toMatchObject({
        live: true,
        satisfaction: d.economy.satisfaction.start,
        nextSpawnTick: d.parcels.spawn.firstSpawnDelayS * 10,
      })
    }
    expect(Object.keys(s.buildings)).toHaveLength(d.buildings.length)
    expect(s.vehicles).toEqual([])
    expect(s.lane.nodes.map((n) => n.id)).toEqual([
      'dock1',
      'conv1',
      'slot1',
      'slot2',
      'slot3',
      'slot4',
      'slot5',
      'slot6',
      'hold',
      'bin',
      'shelf',
    ])
    const node = (id: string) => s.lane.nodes.find((n) => n.id === id)
    expect(node('conv1')?.cap).toBe(d.machines.conveyorCapPerDock)
    expect(node('slot2')?.cap).toBe(d.machines.slotBufferCap)
    expect(node('slot3')?.locked).toBeUndefined()
    expect(node('slot4')?.locked).toEqual({ level: 2 })
    expect(node('slot5')?.locked).toEqual({ level: 4 })
    expect(node('slot6')?.locked).toEqual({ level: 5 })
    expect(node('hold')?.next).toEqual(['shelf', 'bin'])
    const desk = node('slot1')?.fixture
    expect(desk?.kind).toBe('desk')
    expect(desk?.checker.processTicks).toBe(d.employees.inspector.processS * 10)
    expect(node('slot1')?.stations).toHaveLength(1)
    expect(s.employees).toMatchObject([
      {
        id: 1,
        kind: 'inspector',
        name: d.puns.inspectorNames[0],
        nodeId: 'slot1',
      },
    ])
    expect(s.lane.docks).toMatchObject([
      { id: 'dock1', conveyorNodeId: 'conv1' },
    ])
    expect(auditState(s, d)).toEqual([])
  })

  it('§2 clock: 600 ticks = one day; day:ended {day: 1} and one MinuteRow', () => {
    const sim = makeSim(1)
    const ended = collect(sim, 'day:ended')
    runTicks(sim, TICKS_PER_DAY - 1)
    expect(ended).toEqual([])
    expect(sim.state.day).toBe(0)
    runTicks(sim, 1)
    expect(sim.state.tick).toBe(600)
    expect(sim.state.day).toBe(1)
    expect(ended).toEqual([{ day: 1 }])
    expect(sim.state.stats.minutes).toHaveLength(1)
    expect(sim.state.stats.minutes[0]).toMatchObject({
      min: 1,
      tick: 600,
      money: sim.data.economy.startMoney,
      lvl: 1,
      lives: 3,
    })
  })

  it('opening A: bike + Metal detector → $100 left, Bike 1, D(metal) = 97% (§6.3)', () => {
    const sim = makeSim(1)
    const money = collect(sim, 'money:changed')
    openingA(sim)
    expect(sim.state.economy.balance).toBe(100)
    expect(money.map((m) => m.reason)).toEqual(['purchase', 'purchase'])
    expect(sim.state.vehicles[0]).toMatchObject({
      name: 'Bike 1',
      state: 'idle_lot',
      zone: 'any',
    })
    const view = createViewSim(sim)
    expect(view.vehicles[0]?.driverName).toBe(sim.data.puns.driverNames[0])
    expect(view.laneStats().detectionPct).toBe(97)
    expect(view.laneStats().ratePerMin).toBe(15)
    expect(view.buyVehicle('truck')).toEqual({ ok: false, reason: 'locked' })
    expect(view.lane.buyMachine('metal_detector', 'slot4')).toEqual({
      ok: false,
      reason: 'slot-locked',
    })
    expect(sim.commandLog).toHaveLength(2)
  })

  it('handlers never call dispatch (asserted in dev)', () => {
    const sim = makeSim(1)
    sim.events.on('vehicle:bought', () => {
      sim.dispatch({ kind: 'buyVehicle', type: 'bike' })
    })
    expect(() => sim.dispatch({ kind: 'buyVehicle', type: 'bike' })).toThrow(
      /handler/,
    )
  })
})
