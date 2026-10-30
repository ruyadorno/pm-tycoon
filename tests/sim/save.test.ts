// plan.md §6.4 "Save and load" + §6.9.1 save.test: snapshot → JSON → load →
// deep-equal; 600 ticks after a load = the uninterrupted run; no non-JSON
// values; version + dataHash gate (no migrations, R9; build 2 = version 2,
// `pm.save.v2`, spec-build2 §8). Also pins the M0 sim
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
  SAVE_KEY,
  SAVE_VERSION,
  SaveError,
  serialise,
} from '../../src/sim/save.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import type { Command } from '../../src/sim/commands.ts'
import { laneNode, STATE_VERSION, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  collect,
  dataFixture,
  makeSim,
  openingA,
  runSeconds,
  runTicks,
  runUntil,
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

  it('pm.save.v2 payload: serialise → deserialise → isCompatible → restore', () => {
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
    expect(SAVE_KEY).toBe('pm.save.v2')
    expect(SAVE_VERSION).toBe(2)
    expect(STATE_VERSION).toBe(2)
    expect(payload.version).toBe(2)
    expect(payload.state.version).toBe(2)
    expect(sim.snapshot().version).toBe(2)
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
    expect(isCompatible({ ...payload, version: 1 }, dataFixture())).toBe(false)
    expect(isCompatible({ ...payload, version: 3 }, dataFixture())).toBe(false)
    expect(() => Sim.load(retuned, payload)).toThrow(SimLoadError)
    expect(
      Sim.load(retuned, payload, { ignoreDataHash: true }).state.tick,
    ).toBe(payload.state.tick)
    expect(() => deserialise('{nope')).toThrow(SaveError)
    expect(() => deserialise('{"version":2}')).toThrow(SaveError)
  })

  it('save v2 rejects a v1 snapshot (plan.md R9: no migrations)', () => {
    const sim = playedSim()
    // A build-1 save: the same shape, version 1 on the payload and the state.
    const v1 = structuredClone(sim.snapshot()) as unknown as {
      version: number
      state: { version: number }
    }
    v1.version = 1
    v1.state.version = 1
    let err: unknown = null
    try {
      Sim.load(dataFixture(), v1)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SimLoadError)
    const problems = (err as SimLoadError).problems
    expect(problems).toContain('version: 1 ≠ 2')
    expect(problems).toContain('state.version: 1 ≠ 2')
    // validate.ts accepts version 2 only: a v1 state inside a v2 envelope
    // is still refused, and so is a v2 state inside a v1 envelope.
    const innerV1 = structuredClone(sim.snapshot()) as unknown as {
      state: { version: number }
    }
    innerV1.state.version = 1
    expect(() => Sim.load(dataFixture(), innerV1)).toThrow(/state.version/)
    const outerV1 = { ...sim.snapshot(), version: 1 }
    expect(() => Sim.load(dataFixture(), outerV1)).toThrow(/version: 1 ≠ 2/)
    // The payload layer refuses it before Sim.load: deserialise throws.
    const text = serialise(sim, { savedAt: 0, build: 'build-1' })
    const p = JSON.parse(text) as {
      version: number
      state: { version: number }
    }
    p.version = 1
    p.state.version = 1
    expect(() => deserialise(JSON.stringify(p))).toThrow(/version/)
    expect(isCompatible(p, dataFixture())).toBe(false)
    // A v2 snapshot of the same run loads.
    expect(Sim.load(dataFixture(), sim.snapshot()).state.tick).toBe(
      sim.state.tick,
    )
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

  it('mid-run M1 save (vehicles mid-edge, parcels in the lane, a rush in flight, policy driving) → JSON → load → 600 ticks = the uninterrupted run', () => {
    const live = makeSim(5)
    const policy = createPolicy(live, 'competent')
    for (let i = 0; i < 1800; i++) {
      policy.step()
      live.tick()
    }
    const target = Object.values(live.state.buildings).find(
      (b) => b.waiting.length > 0 && b.rushUntilTick === null,
    )
    expect(target).toBeDefined()
    live.dispatch({ kind: 'rush', buildingId: target!.id })
    for (let i = 0; i < 7; i++) {
      policy.step()
      live.tick()
    }
    const s = live.state
    expect(s.vehicles.some((v) => v.path.length > 0 && v.edgeT > 0)).toBe(true)
    expect(Object.values(s.parcels).length).toBeGreaterThan(5)
    expect(s.buildings[target!.id]?.rushUntilTick ?? null).not.toBeNull()
    const loaded = Sim.load(
      dataFixture(),
      JSON.parse(JSON.stringify(live.snapshot())),
    )
    expect(loaded.state).toEqual(live.state)
    const policy2 = createPolicy(loaded, 'competent')
    for (let i = 0; i < 600; i++) {
      policy.step()
      live.tick()
      policy2.step()
      loaded.tick()
    }
    expect(stateHash(loaded.state)).toBe(stateHash(live.state))
    expect(loaded.commandLog).toEqual(live.commandLog)
    expect(auditState(loaded.state, loaded.data)).toEqual([])
  })

  it('mid-lane M2 save (stations mid-process, a full Hold Bay and a stalled flag, a lost-life report, a pending debug flag) → JSON → load → 600 ticks = the uninterrupted run', () => {
    const live = makeSim(6)
    openingA(live)
    live.dispatch({ kind: 'buyVehicle', type: 'bike' })
    const vs = createViewSim(live, { debug: true })
    expect(vs.debug?.forceMalwareDelivery()).toEqual({ ok: true })
    runSeconds(live, 150)
    expect(vs.debug?.fillHoldBay()).toEqual({ ok: true })
    expect(vs.debug?.forceFlagNext('rattle')).toEqual({ ok: true })
    // nobody tosses: the next flag waits in its slot
    runUntil(live, () => live.state.lane.stallReason === 'holdBayFull', 6000)
    expect(vs.debug?.forceFlagNext('battery')).toEqual({ ok: true })
    const s = live.state
    expect(vs.holdBay.count).toBe(vs.holdBay.cap)
    expect(s.lane.stallReason).toBe('holdBayFull')
    expect(s.lastLostLife?.path.length).toBeGreaterThan(3)
    expect(s.lane.debugForceFlag).toBe('battery')
    const loaded = Sim.load(
      dataFixture(),
      JSON.parse(JSON.stringify(live.snapshot())),
    )
    expect(loaded.state).toEqual(live.state)
    for (const sim of [live, loaded]) {
      runTicks(sim, 300)
      const hold = sim.state.lane.nodes.find((n) => n.kind === 'holdBay')!
      for (const id of hold.queue.slice()) {
        sim.dispatch({ kind: 'toss', parcelId: id })
      }
      runTicks(sim, 300)
    }
    expect(stateHash(loaded.state)).toBe(stateHash(live.state))
    expect(auditState(loaded.state, loaded.data)).toEqual([])
  })

  it('randomized player (Toss / Clear / move / remove / buy / hire / fire / sell / zones / rush) on 12 seeds: a JSON round trip mid-run (parcels mid-process, items in the Hold Bay) = the uninterrupted run, and seed + log replay to the same hash', () => {
    let midProcess = 0
    let heldAtSave = 0
    for (let seed = 1; seed <= 12; seed++) {
      let a = (seed * 2654435761) >>> 0
      const r = (): number => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      const pick = <T>(xs: readonly T[]): T | undefined =>
        xs[Math.floor(r() * xs.length)]
      const live = makeSim(seed, { economy: { startMoney: 4000 } })
      const slots = ['slot1', 'slot2', 'slot3']
      const randomCommand = (): Command | null => {
        const s = live.state
        const held = laneNode(s.lane, 'hold')!.queue
        const k = r()
        if (k < 0.3 && held.length > 0) {
          return { kind: r() < 0.7 ? 'toss' : 'clear', parcelId: pick(held)! }
        }
        if (k < 0.38)
          return { kind: 'moveFixture', from: pick(slots)!, to: pick(slots)! }
        if (k < 0.42) return { kind: 'removeFixture', nodeId: pick(slots)! }
        if (k < 0.5)
          return {
            kind: 'buyMachine',
            defId: 'metal_detector',
            nodeId: pick(slots)!,
          }
        if (k < 0.54) return { kind: 'placeDesk', nodeId: pick(slots)! }
        if (k < 0.62) return { kind: 'hireInspector' }
        if (k < 0.66) {
          const e = pick(s.employees.filter((x) => x.kind === 'inspector'))
          return e ? { kind: 'fireInspector', employeeId: e.id } : null
        }
        if (k < 0.74)
          return {
            kind: 'buyVehicle',
            type: pick(['bike', 'bike', 'van'] as const)!,
          }
        if (k < 0.78) {
          const v = pick(s.vehicles)
          return v ? { kind: 'sellVehicle', id: v.id } : null
        }
        if (k < 0.86) {
          const v = pick(s.vehicles)
          return v
            ? {
                kind: 'setZone',
                id: v.id,
                zone: pick(['any', 'highres', 'downtown'])!,
              }
            : null
        }
        const b = pick(
          Object.values(s.buildings).filter((x) => x.waiting.length > 0),
        )
        return b ? { kind: 'rush', buildingId: b.id } : null
      }
      const end = 8 * TICKS_PER_DAY
      let snap: string | null = null
      for (let t = 0; t < end; t++) {
        const s = live.state
        if (snap === null && t >= 3 * TICKS_PER_DAY) {
          const busy = s.lane.nodes.some((n) =>
            n.stations.some(
              (st) =>
                st.parcelId !== null &&
                st.doneTick !== null &&
                st.doneTick > s.tick,
            ),
          )
          const held = laneNode(s.lane, 'hold')!.queue.length > 0
          if ((busy && held) || t >= 6 * TICKS_PER_DAY) {
            snap = JSON.stringify(live.snapshot())
            if (busy) midProcess += 1
            if (held) heldAtSave += 1
          }
        }
        if (r() < 0.05) {
          const cmd = randomCommand()
          if (cmd) live.dispatch(cmd)
        }
        live.tick()
      }
      expect(auditState(live.state, live.data), `seed ${seed}`).toEqual([])
      // the reloaded game, fed the same commands at the same ticks
      const loaded = Sim.load(
        dataFixture({ economy: { startMoney: 4000 } }),
        JSON.parse(snap!),
      )
      const from = loaded.state.tick
      const rest = live.commandLog.filter((e) => e.tick >= from)
      let i = 0
      while (loaded.state.tick < end) {
        while (i < rest.length && rest[i]!.tick === loaded.state.tick) {
          loaded.dispatch(rest[i]!.cmd)
          i += 1
        }
        loaded.tick()
      }
      expect(stateHash(loaded.state), `seed ${seed} reload`).toBe(
        stateHash(live.state),
      )
      const again = replay(live.data, seed, live.commandLog, end)
      expect(stateHash(again.state), `seed ${seed} replay`).toBe(
        stateHash(live.state),
      )
    }
    expect(midProcess).toBeGreaterThan(0)
    expect(heldAtSave).toBeGreaterThan(0)
  }, 30_000) // ~3 s alone; over vitest's 5 s default under a loaded `vlr check`

  it('seed + data + commandLog replay to the same state', () => {
    const sim = playedSim(3)
    const again = replay(sim.data, 3, sim.commandLog, sim.state.tick)
    expect(stateHash(again.state)).toBe(stateHash(sim.state))
  }, 30_000)
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

  it('§2 clock: 600 ticks = one day; day:ended {day: 1} and one MinuteRow (after payday 1: the pre-hired inspector, §7.3)', () => {
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
      money:
        sim.data.economy.startMoney - sim.data.employees.inspector.salaryPerDay,
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
