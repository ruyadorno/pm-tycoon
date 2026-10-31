// plan.md §6.4 "Save and load" + §6.9.1 save.test: snapshot → JSON → load →
// deep-equal; 600 ticks after a load = the uninterrupted run; no non-JSON
// values; version + dataHash gate (no migrations, R9; build 2 = version 2,
// M6 = version 3, M7 = version 4, M8 = version 5, build 3 M11 = version 6
// under the same `pm.save.v2` key, spec-build2 §8; design-m7 §2.5,
// design-m8-m9 §2.4: lane.feedIndex + stats.cleared; M11 contract §2.2:
// state.events, state.modifiers …). Also pins the M0 sim
// skeleton the save format rests on: the spec §7.1 start state, the tick
// clock + day boundary, and the "handlers never dispatch" rule.

import { describe, expect, it } from 'vitest'
import type { EventDef, GameData } from '../../src/data/types.ts'
import { checkSave } from '../../src/boot/autosave.ts'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import {
  auditState,
  Sim,
  SimLoadError,
  snapshotProblems,
  stateHash,
} from '../../src/sim/sim.ts'
import type { SimSnapshot } from '../../src/sim/sim.ts'
import { pickCandidates } from '../../src/sim/systems/deck.ts'
import { applyEffect } from '../../src/sim/systems/effects.ts'
import type { EffectCtx } from '../../src/sim/systems/effects.ts'
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
  decideOpen,
  deckOn,
  fund,
  makeSim,
  openingA,
  replayOf,
  runSeconds,
  runTicks,
  runUntil,
} from './helpers.ts'

/** A game a little past its first day boundary, with commands in the log. */
function playedSim(seed = 7): Sim {
  const sim = makeSim(seed)
  openingA(sim, 'pool') // replay-safe: the driver comes from the rolled pool
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
    }
    const text = serialise(sim, { savedAt: 1234, build: 'test', onboarding })
    const payload = deserialise(text)
    expect(SAVE_KEY).toBe('pm.save.v2')
    expect(SAVE_VERSION).toBe(6)
    expect(STATE_VERSION).toBe(6)
    expect(payload.version).toBe(6)
    expect(payload.state.version).toBe(6)
    expect(sim.snapshot().version).toBe(6)
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
    expect(isCompatible({ ...payload, version: 2 }, dataFixture())).toBe(false)
    expect(isCompatible({ ...payload, version: 3 }, dataFixture())).toBe(false)
    expect(isCompatible({ ...payload, version: 4 }, dataFixture())).toBe(false)
    expect(isCompatible({ ...payload, version: 5 }, dataFixture())).toBe(false)
    expect(isCompatible({ ...payload, version: 7 }, dataFixture())).toBe(false)
    expect(() => Sim.load(retuned, payload)).toThrow(SimLoadError)
    expect(
      Sim.load(retuned, payload, { ignoreDataHash: true }).state.tick,
    ).toBe(payload.state.tick)
    expect(() => deserialise('{nope')).toThrow(SaveError)
    expect(() => deserialise('{"version":2}')).toThrow(SaveError)
  })

  it('save v6 rejects a v1 snapshot (plan.md R9: no migrations) — and an M5 v2 one', () => {
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
    expect(problems).toContain('version: 1 ≠ 6')
    expect(problems).toContain('state.version: 1 ≠ 6')
    // validate.ts accepts version 6 only: a v1 state inside a v6 envelope
    // is still refused, and so is a v6 state inside a v1 envelope.
    const innerV1 = structuredClone(sim.snapshot()) as unknown as {
      state: { version: number }
    }
    innerV1.state.version = 1
    expect(() => Sim.load(dataFixture(), innerV1)).toThrow(/state.version/)
    const outerV1 = { ...sim.snapshot(), version: 1 }
    expect(() => Sim.load(dataFixture(), outerV1)).toThrow(/version: 1 ≠ 6/)
    const m5 = { ...sim.snapshot(), version: 2 }
    expect(() => Sim.load(dataFixture(), m5)).toThrow(/version: 2 ≠ 6/)
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
    // A v6 snapshot of the same run loads.
    expect(Sim.load(dataFixture(), sim.snapshot()).state.tick).toBe(
      sim.state.tick,
    )
  })

  it('an M6 version-3 save is refused (design-m7 §2.5: state.quests, nextId.quest, stats.victoryTick)', () => {
    const sim = playedSim()
    // An M6 save as it was written: version 3 throughout, no quest state.
    const v3 = structuredClone(sim.snapshot()) as unknown as {
      version: number
      state: Record<string, unknown> & {
        version: number
        nextId: Record<string, number>
        stats: Record<string, unknown>
      }
    }
    v3.version = 3
    v3.state.version = 3
    delete v3.state.quests
    delete v3.state.nextId.quest
    delete v3.state.stats.victoryTick
    let err: unknown = null
    try {
      Sim.load(dataFixture(), v3)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SimLoadError)
    expect((err as SimLoadError).problems).toContain('version: 3 ≠ 6')
    // Even relabelled version 6, the M6 shape fails validation (no crash).
    const relabelled = structuredClone(v3)
    relabelled.version = 6
    relabelled.state.version = 6
    expect(() => Sim.load(dataFixture(), relabelled)).toThrow(
      /state\.quests: missing/,
    )
    const text = serialise(sim, { savedAt: 0, build: 'm6' })
    const p = JSON.parse(text) as {
      version: number
      state: { version: number }
    }
    p.version = 3
    p.state.version = 3
    expect(() => deserialise(JSON.stringify(p))).toThrow(/version/)
    expect(isCompatible(p, dataFixture())).toBe(false)
  })

  it('an M7 version-4 save is refused (design-m8-m9 §2.4: lane.feedIndex, stats.cleared)', () => {
    const sim = playedSim()
    // An M7 save as it was written: version 4 throughout, no M8 fields.
    const v4 = structuredClone(sim.snapshot()) as unknown as {
      version: number
      state: Record<string, unknown> & {
        version: number
        lane: Record<string, unknown>
        stats: Record<string, unknown>
      }
    }
    v4.version = 4
    v4.state.version = 4
    delete v4.state.lane.feedIndex
    delete v4.state.stats.cleared
    let err: unknown = null
    try {
      Sim.load(dataFixture(), v4)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SimLoadError)
    expect((err as SimLoadError).problems).toContain('version: 4 ≠ 6')
    // Relabelled version 6, the M7 shape fails validation (no crash).
    const relabelled = structuredClone(v4)
    relabelled.version = 6
    relabelled.state.version = 6
    expect(() => Sim.load(dataFixture(), relabelled)).toThrow(
      /state\.lane\.feedIndex: missing/,
    )
    expect(() => Sim.load(dataFixture(), relabelled)).toThrow(
      /state\.stats\.cleared: missing/,
    )
    const text = serialise(sim, { savedAt: 0, build: 'm7' })
    const p = JSON.parse(text) as {
      version: number
      state: { version: number }
    }
    p.version = 4
    p.state.version = 4
    expect(() => deserialise(JSON.stringify(p))).toThrow(/version/)
    expect(isCompatible(p, dataFixture())).toBe(false)
  })

  it('M8 relations: a feedIndex past the conveyors, a handed-off parcel without its clearance, an unknown or unsorted dock are refused', () => {
    const snap = playedSim().snapshot()
    const feed = structuredClone(snap)
    feed.state.lane.feedIndex = 1 // one dock: only 0
    expect(() => Sim.load(dataFixture(), feed)).toThrow(/feedIndex: 1 ≥ 1/)
    const handed = structuredClone(snap)
    const p = Object.values(handed.state.parcels).find(
      (x) => x.state === 'waiting',
    )
    expect(p).toBeDefined()
    // Placeless and bound for a pier, but no clearance tick / locked value.
    const b = handed.state.buildings[p!.origin]!
    b.waiting.splice(b.waiting.indexOf(p!.id), 1)
    p!.state = 'handed_off'
    p!.dest = 'dk_pier_1'
    p!.destRegion = 'docks'
    expect(() => Sim.load(dataFixture(), handed)).toThrow(
      /clearTick: null \(handed off/,
    )
    p!.clearTick = handed.state.tick + 10
    expect(() => Sim.load(dataFixture(), handed)).toThrow(
      /lockedValue: null \(handed off/,
    )
    p!.lockedValue = 18
    expect(Sim.load(dataFixture(), handed).state.tick).toBe(handed.state.tick)
    p!.destRegion = 'highres'
    p!.dest = 'hr_towers_b'
    expect(() => Sim.load(dataFixture(), handed)).toThrow(
      /destRegion: highres is not an overseas hub/,
    )
    const dock = structuredClone(snap)
    dock.state.lane.docks[0]!.id = 'dock7'
    expect(() => Sim.load(dataFixture(), dock)).toThrow(SimLoadError)
  })

  it('M8 stop kinds (M8 review): a handoff stop off a hub, a deliver stop at a pier, a destRegion that is not the dest district are refused; a live mismatch still delivers by the parcel, never throws', () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'competent')
    const delivering = (): boolean =>
      sim.state.vehicles.some(
        (v) =>
          v.state === 'delivering' &&
          v.stops[v.stopIndex]?.kind === 'deliver' &&
          v.path.length > 3,
      )
    for (let t = 0; t < 20_000 && !delivering(); t++) {
      policy.step()
      sim.tick()
    }
    expect(delivering()).toBe(true)
    const snap = sim.snapshot()
    const vehicleOf = (s: typeof snap) =>
      s.state.vehicles.find(
        (v) =>
          v.state === 'delivering' && v.stops[v.stopIndex]?.kind === 'deliver',
      )!
    const handoff = structuredClone(snap)
    vehicleOf(handoff).stops[vehicleOf(handoff).stopIndex]!.kind = 'handoff'
    expect(() => Sim.load(dataFixture(), handoff)).toThrow(
      /stops\[\d+\]\.kind: handoff at .* \(not a hub: deliver \/ collect\)/,
    )
    const pier = structuredClone(snap)
    const stop = vehicleOf(pier).stops[vehicleOf(pier).stopIndex]!
    stop.buildingId = 'dk_pier_1'
    expect(() => Sim.load(dataFixture(), pier)).toThrow(
      /stops\[\d+\]\.kind: deliver at dk_pier_1 \(an overseas hub: handoff\)/,
    )
    const region = structuredClone(snap)
    const pid =
      vehicleOf(region).stops[vehicleOf(region).stopIndex]!.parcelIds[0]!
    region.state.parcels[String(pid)]!.destRegion = 'docks'
    expect(() => Sim.load(dataFixture(), region)).toThrow(
      /destRegion: docks ≠ .*'s district/,
    )
    // The tick itself decides by the parcel: a live 'handoff' stop for a
    // local parcel delivers it (no throw, no hand-off).
    const v = sim.state.vehicles.find((x) => x.id === vehicleOf(snap).id)!
    const live = v.stops[v.stopIndex]!
    live.kind = 'handoff'
    const ids = [...live.parcelIds]
    const handed = collect(sim, 'parcel:handedOff')
    const delivered = collect(sim, 'parcel:delivered')
    expect(runUntil(sim, () => v.state !== 'delivering', 3000)).toBeGreaterThan(
      0,
    )
    expect(handed).toEqual([])
    expect(delivered.map((e) => e.id)).toEqual(expect.arrayContaining(ids))
    expect(auditState(sim.state, sim.data)).toEqual([])
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
    live.dispatch({
      kind: 'buyVehicle',
      type: 'bike',
      applicantId: live.state.applicants.driver[0]!.id,
    })
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
    const last = s.lastLostLife
    expect(last?.kind).not.toBe('event')
    expect(last?.kind !== 'event' && last?.path.length).toBeGreaterThan(3)
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
        if (k < 0.54)
          return {
            kind: 'placeDesk',
            nodeId: pick(slots)!,
            index: pick([1, 1, 2])!,
          }
        if (k < 0.62) {
          // M6: the pool's first inspector applicant (replay-safe).
          const hiree = s.applicants.inspector[0]
          return hiree
            ? {
                kind: 'hire',
                role: 'inspector',
                applicantId: hiree.id,
                target: { nodeId: pick(slots)! },
              }
            : null
        }
        if (k < 0.66) {
          const e = pick(s.employees.filter((x) => x.role === 'inspector'))
          return e ? { kind: 'fire', employeeId: e.id } : null
        }
        if (k < 0.74)
          return {
            kind: 'buyVehicle',
            type: pick(['bike', 'bike', 'van'] as const)!,
            applicantId: pick([...s.applicants.driver.map((x) => x.id), null])!,
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
      const again = replayOf(live, end)
      expect(stateHash(again.state), `seed ${seed} replay`).toBe(
        stateHash(live.state),
      )
    }
    expect(midProcess).toBeGreaterThan(0)
    expect(heldAtSave).toBeGreaterThan(0)
  }, 30_000) // ~3 s alone; over vitest's 5 s default under a loaded `vlr check`

  it('seed + data + commandLog replay to the same state', () => {
    const sim = playedSim(3)
    const again = replayOf(sim)
    expect(stateHash(again.state)).toBe(stateHash(sim.state))
  }, 30_000)
})

// Build 3 (M11 contract §4.4; B3 §6, §3.6): the v6 state carries the deck —
// an open card, scheduled chain links, modifiers, absences — and resumes them.

/** A deck option with a plain `next` booked days ahead (a chain head's way into its link). */
function linkOption(data: GameData): { def: EventDef; option: number } {
  for (const def of data.events.deck) {
    if (def.router || def.rescue || !def.options) continue
    const option = def.options.findIndex(
      (o) =>
        o.if === undefined &&
        o.effects.some(
          (e) => e.kind === 'next' && 'eventId' in e && e.days > 0,
        ),
    )
    if (option >= 0) return { def, option }
  }
  throw new Error('no deck option books a plain next')
}

/** A decision card (2–3 options) with no pick or target, other than `not`. */
function plainDecision(data: GameData, not: string): EventDef {
  const def = data.events.deck.find(
    (d) =>
      d.id !== not &&
      !d.router &&
      !d.rescue &&
      d.pick === undefined &&
      d.target === undefined &&
      (d.options?.length ?? 0) >= 2,
  )
  if (!def) throw new Error('no plain decision card')
  return def
}

const effectCtx = (
  title: string,
  pick: EffectCtx['pick'] = null,
): EffectCtx => ({
  eventId: 'ev_save_test',
  title,
  optionLabel: 'OK',
  optionIndex: 0,
  target: null,
  pick,
  chainHeadId: 'ev_save_test',
  depth: 1,
})

describe('build 3 v6 saves (M11 contract §4.4)', () => {
  it('a v6 round trip at minute 12 of a deck-on policy run — an open card, a scheduled link, a modifier and an absent employee — then 3 days under the same policy = the uninterrupted run', () => {
    const flag = SIM_FEATURES.events
    SIM_FEATURES.events = true
    try {
      const live = deckOn(makeSim(4))
      const policy = createPolicy(live, 'competent')
      for (let i = 0; i < 12 * TICKS_PER_DAY; i++) {
        policy.step()
        live.tick()
      }
      expect(live.state.tick).toBe(12 * TICKS_PER_DAY)
      expect(live.state.events.stats.offered).toBeGreaterThan(0)
      policy.step() // the card the last tick opened, if any
      expect(live.state.events.open).toBeNull()
      // A chain link: a head's plain next, decided (logged).
      const link = linkOption(live.data)
      fund(live, 10_000)
      expect(
        live.dispatch({ kind: 'debugOfferEvent', eventId: link.def.id }),
      ).toEqual({ ok: true })
      decideOpen(live, link.option)
      const s = live.state
      expect(s.events.scheduled.length).toBeGreaterThanOrEqual(1)
      const due = Math.min(...s.events.scheduled.map((l) => l.dueTick))
      // A timed modifier (direct applyEffect: the machines roll with it).
      applyEffect(live, effectCtx('Save-test tune-up'), {
        kind: 'mod',
        key: 'machineP',
        add: 0.05,
        days: 2,
      })
      const mod = s.modifiers.at(-1)!
      expect(mod).toMatchObject({ key: 'machineP', add: 0.05 })
      // An absent inspector (direct applyEffect: off the desk, unpaid).
      const inspector = pickCandidates(live, 'inspector')[0]
      expect(inspector).toBeDefined()
      applyEffect(live, effectCtx('Save-test day off', inspector), {
        kind: 'staff',
        absent: 'inspector',
        pick: 'one',
        days: 1,
      })
      const away = s.employees.find((e) => e.id === inspector!.id)!
      expect(away.absentUntilTick).toBe(s.tick + TICKS_PER_DAY)
      // The open card, left for the policy's next step.
      const open = plainDecision(live.data, link.def.id)
      expect(
        live.dispatch({ kind: 'debugOfferEvent', eventId: open.id }),
      ).toEqual({ ok: true })
      expect(s.events.open?.eventId).toBe(open.id)
      expect(auditState(s, live.data)).toEqual([])

      const snap = JSON.parse(JSON.stringify(live.snapshot())) as SimSnapshot
      expect(snap.version).toBe(6)
      expect(snapshotProblems(dataFixture(), snap)).toEqual([])
      const loaded = Sim.load(dataFixture(), snap)
      expect(loaded.state).toEqual(live.state)
      expect(loaded.state.events.open).toEqual(live.state.events.open)
      expect(loaded.state.events.scheduled).toEqual(s.events.scheduled)
      expect(loaded.state.modifiers).toEqual(s.modifiers)
      expect(loaded.state.events.picks.rng).toBe(s.events.picks.rng)
      expect(loaded.state.events.rng).toBe(s.events.rng)

      const policy2 = createPolicy(loaded, 'competent')
      for (let i = 0; i < 3 * TICKS_PER_DAY; i++) {
        policy.step()
        live.tick()
        policy2.step()
        loaded.tick()
      }
      policy.dispose?.()
      policy2.dispose?.()
      expect(loaded.state.tick).toBe(live.state.tick)
      expect(stateHash(loaded.state)).toBe(stateHash(live.state))
      expect(loaded.commandLog).toEqual(live.commandLog)
      expect(auditState(loaded.state, loaded.data)).toEqual([])
      // What the save carried played out after the load: the card was
      // decided, the link opened when due, the absence and the modifier ran
      // out.
      const ls = loaded.state
      expect(
        ls.events.history.some(
          (h) => h.eventId === open.id && h.openedTick === snap.state.tick,
        ),
      ).toBe(true)
      expect(
        ls.events.history.some(
          (h) =>
            h.chainHeadId === link.def.id &&
            h.depth >= 2 &&
            h.openedTick >= due,
        ),
      ).toBe(true)
      expect(
        ls.employees.find((e) => e.id === inspector!.id)?.absentUntilTick,
      ).toBeUndefined()
      expect(ls.modifiers.some((m) => m.id === mod.id)).toBe(false)
    } finally {
      SIM_FEATURES.events = flag
    }
  }, 30_000)

  it('v5 rejection: a build-2 snapshot (version 5, state.version 5, no deck state) is refused by Sim.load and the save check reads it stale', () => {
    const sim = playedSim()
    const v5 = structuredClone(sim.snapshot()) as unknown as {
      version: number
      state: Record<string, unknown> & {
        version: number
        nextId: Record<string, number>
        stats: Record<string, unknown>
      }
    }
    v5.version = 5
    v5.state.version = 5
    // The M8 (v5) shape: no events, modifiers, modifier ids or lost parcels.
    delete v5.state.events
    delete v5.state.modifiers
    delete v5.state.nextId.modifier
    delete v5.state.stats.lost
    const problems = snapshotProblems(dataFixture(), v5)
    expect(problems).toContain('version: 5 ≠ 6')
    expect(problems).toContain('state.version: 5 ≠ 6')
    expect(() => Sim.load(dataFixture(), v5)).toThrow(SimLoadError)
    // Only the version differs (the v6 state inside a v5 envelope): refused too.
    const relabelled = { ...sim.snapshot(), version: 5 }
    expect(snapshotProblems(dataFixture(), relabelled)).toContain(
      'version: 5 ≠ 6',
    )
    // The stored payload: Title's save check classifies it stale (discarded
    // with the "older build" toast, never loaded — R9).
    const payload = JSON.parse(
      serialise(sim, { savedAt: 0, build: 'build-2' }),
    ) as {
      version: number
      state: Record<string, unknown> & { version: number }
    }
    payload.version = 5
    payload.state.version = 5
    delete payload.state.events
    delete payload.state.modifiers
    expect(checkSave(JSON.stringify(payload), dataFixture()).kind).toBe('stale')
    expect(isCompatible(payload, dataFixture())).toBe(false)
    // The same run's v6 payload is fine.
    expect(
      checkSave(serialise(sim, { savedAt: 0, build: 'build-3' }), dataFixture())
        .kind,
    ).toBe('ok')
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
    expect(desk?.checker.processTicks).toBe(
      d.employees.roles.inspector.processS[2]! * 10,
    )
    expect(node('slot1')?.stations).toHaveLength(1)
    expect(s.employees).toMatchObject([
      {
        id: 1,
        role: 'inspector',
        name: d.employees.start.inspector.name,
        nodeId: 'slot1',
        pips: { eye: 3, pace: 3, charisma: 0 },
        salaryPerDay: 20,
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
      money: sim.data.economy.startMoney - sim.state.employees[0]!.salaryPerDay,
      lvl: 1,
      lives: 3,
    })
  })

  it('opening A: bike + its driver’s fee + Metal detector → $92 left, Bike 1, D(metal) = 97% (§6.3)', () => {
    const sim = makeSim(1)
    const money = collect(sim, 'money:changed')
    openingA(sim)
    // M6 (design D9): the standard bike driver's hire fee is one day's $8.
    expect(sim.state.economy.balance).toBe(92)
    expect(money.map((m) => m.reason)).toEqual(['purchase', 'hire', 'purchase'])
    expect(sim.state.vehicles[0]).toMatchObject({
      name: 'Bike 1',
      state: 'idle_lot',
      zone: 'any',
    })
    const view = createViewSim(sim)
    expect(view.vehicles[0]?.driverName).toBe(sim.state.employees[1]!.name)
    expect(view.laneStats().detectionPct).toBe(97)
    expect(view.laneStats().ratePerMin).toBe(15)
    expect(view.buyVehicle('truck', null)).toEqual({
      ok: false,
      reason: 'locked',
    })
    expect(view.lane.buyMachine('metal_detector', 'slot4')).toEqual({
      ok: false,
      reason: 'slot-locked',
    })
    expect(sim.commandLog).toHaveLength(2)
  })

  it('handlers never call dispatch (asserted in dev)', () => {
    const sim = makeSim(1)
    sim.events.on('vehicle:bought', () => {
      sim.dispatch({ kind: 'buyVehicle', type: 'bike', applicantId: null })
    })
    expect(() =>
      sim.dispatch({ kind: 'buyVehicle', type: 'bike', applicantId: null }),
    ).toThrow(/handler/)
  })
})
