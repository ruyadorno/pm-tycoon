// M8 overseas hubs (spec-core §5.6, spec-build2 §4.1; design-m8-m9 §4.1,
// §4.9, §7 M8 2): destination selection (never before a hub is live; the
// Docks take overseasShare of the spawns, piers only; Airport S/M only,
// Docks:Airport 2:1), the overseas malware share ×overseasMult, the hand-off
// (value locked at f(t) then, a 1.5 s stop at the pier anchor), the 45 s
// clearance that pays the locked value — or, for malware, costs a life at
// clearance and never before ("the ship has sailed") — `hub:departure`, save
// / load mid-clearance, a sold vehicle, game over at a clearance,
// conservation with `cleared`, and debug.forceOverseasMalware.

import { describe, expect, it } from 'vitest'
import type { BuildingDef } from '../../src/data/types.ts'
import { auditState, conservation, Sim, stateHash } from '../../src/sim/sim.ts'
import { handOff } from '../../src/sim/systems/hubs.ts'
import { pickDestination, spawnStep } from '../../src/sim/systems/spawn.ts'
import type { Parcel, Size } from '../../src/sim/types.ts'
import { laneNode, malwareShare, TICKS_PER_S } from '../../src/sim/types.ts'
import { decayFactor } from '../../src/sim/value.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  buy,
  collect,
  dataFixture,
  eventLog,
  fund,
  injectParcel,
  makeSim,
  noCheckers,
  placeMachine,
  quietSim,
  runTicks,
  runUntil,
  unlockDistrict,
} from './helpers.ts'

const data = dataFixture()
const docksDef = data.districts.find((d) => d.id === 'docks')!
const airportDef = data.districts.find((d) => d.id === 'airport')!
if (docksDef.kind !== 'overseas' || airportDef.kind !== 'overseas') {
  throw new Error('districts.json: docks / airport are not overseas hubs')
}
const DOCKS_TICKS = docksDef.clearanceS * TICKS_PER_S
const SIZES: Size[] = ['S', 'M', 'L', 'XL']
const building = (id: string): BuildingDef =>
  data.buildings.find((b) => b.id === id)!

/** A quiet sim at `level` (debugForceLevel: the row's unlocks, past any cap). */
function atLevel(level: number, seed = 1): Sim {
  const sim = quietSim(seed)
  const res = sim.dispatch({ kind: 'debugForceLevel', level })
  if (!res.ok) throw new Error(`forceLevel ${level}: ${res.reason}`)
  for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
  return fund(sim)
}

/** A parcel bound for `dest` handed off now by hand (no vehicle), aged `ageS`. */
function handedOff(
  sim: Sim,
  dest: string,
  opts: { ageS?: number; malware?: boolean; size?: Size } = {},
): Parcel {
  const ageTicks = (opts.ageS ?? 0) * TICKS_PER_S
  if (sim.state.tick < ageTicks) runTicks(sim, ageTicks - sim.state.tick)
  const p = injectParcel(sim, 'hr_towers_a', dest, {
    size: opts.size ?? 'S',
    malware: opts.malware ?? false,
    spawnedTick: sim.state.tick - ageTicks,
  })
  const hub = data.districts.find((d) => d.id === p.destRegion)
  p.mult = hub?.kind === 'overseas' ? hub.valueMult : 1
  const b = sim.state.buildings[p.origin]!
  b.waiting.splice(b.waiting.indexOf(p.id), 1)
  p.trace.push({ tick: p.spawnedTick, what: 'spawned', ref: p.origin })
  handOff(sim, null, p)
  return p
}

describe('overseas destinations (spec §5.2, B2 §4.1)', () => {
  it('no overseas destination before a hub is live (2,000 draws at L2)', () => {
    const sim = atLevel(2)
    const origins = ['hr_towers_a', 'dt_cache_cafe', 'in_forge_works']
      .map(building)
      .filter((b) => b !== undefined)
    let n = 0
    for (let i = 0; i < 2000; i++) {
      const o = origins[i % origins.length]!
      const d = pickDestination(sim, o, SIZES[i % 4]!)
      if (!d) continue
      n += 1
      expect(['docks', 'airport']).not.toContain(d.district)
    }
    expect(n).toBeGreaterThan(1900)
  })

  it('Docks live: overseasShare of the spawns go to the piers (0.15 ± 0.03 over 3,000 draws), never the port office', () => {
    const sim = atLevel(3)
    expect(sim.state.districts.docks!.live).toBe(true)
    const origin = building('hr_towers_a')
    let overseas = 0
    const piers: Record<string, number> = {}
    for (let i = 0; i < 3000; i++) {
      const d = pickDestination(sim, origin, SIZES[i % 4]!)!
      if (d.district !== 'docks') continue
      overseas += 1
      piers[d.id] = (piers[d.id] ?? 0) + 1
    }
    const share = overseas / 3000
    expect(Math.abs(share - data.parcels.spawn.overseasShare)).toBeLessThan(
      0.03,
    )
    expect(Object.keys(piers).toSorted()).toEqual(['dk_pier_1', 'dk_pier_2'])
    expect(piers.dk_customs).toBeUndefined()
    expect(building('dk_customs').recv).toBe(0)
  })

  it('both hubs live: L/XL never airport-bound; S/M split Docks:Airport ≈ 2:1 (hubWeight)', () => {
    const sim = atLevel(3)
    unlockDistrict(sim, 'airport')
    const origin = building('dt_cache_cafe')
    let docks = 0
    let airport = 0
    for (let i = 0; i < 9000; i++) {
      const size = SIZES[i % 4]!
      const d = pickDestination(sim, origin, size)!
      if (d.district === 'airport') {
        expect(['S', 'M']).toContain(size)
        airport += 1
      } else if (d.district === 'docks' && (size === 'S' || size === 'M')) {
        docks += 1
      }
    }
    expect(airport).toBeGreaterThan(100)
    expect(airportDef.sizes).toEqual(['S', 'M'])
    const want = docksDef.hubWeight / airportDef.hubWeight
    expect(want).toBe(2)
    expect(Math.abs(docks / airport - want)).toBeLessThan(0.3)
  })

  it('overseas-bound malware share = min(cap, overseasMult × share) — and the spawns follow it', () => {
    const sim = atLevel(3)
    const s = sim.state
    const m = data.parcels.malware
    const local = malwareShare(s, data)
    expect(malwareShare(s, data, true)).toBeCloseTo(
      Math.min(m.cap, m.overseasMult * local),
      10,
    )
    // Many spawns on one tick past the grace (and before the scripted one),
    // removed again so no building fills up.
    s.tick = 1000
    s.day = 1
    s.spawn.spawnedCount = m.graceCount
    const share = malwareShare(s, data)
    const overseasShare = malwareShare(s, data, true)
    expect(overseasShare).toBeCloseTo(Math.min(m.cap, 2 * share), 10)
    const tally = { local: 0, localMal: 0, overseas: 0, overseasMal: 0 }
    for (let i = 0; i < 4000; i++) {
      for (const d of Object.values(s.districts)) {
        if (
          d.live &&
          data.districts.find((x) => x.id === d.id)?.kind === 'district'
        ) {
          d.nextSpawnTick = s.tick
        }
      }
      const before = s.nextId.parcel
      spawnStep(sim)
      for (let id = before; id < s.nextId.parcel; id++) {
        const p = s.parcels[String(id)]!
        if (p.destRegion === 'docks') {
          tally.overseas += 1
          if (p.malware) tally.overseasMal += 1
        } else {
          tally.local += 1
          if (p.malware) tally.localMal += 1
        }
        const b = s.buildings[p.origin]!
        b.waiting.splice(b.waiting.indexOf(p.id), 1)
        delete s.parcels[String(id)]
      }
    }
    expect(tally.overseas).toBeGreaterThan(1000)
    expect(Math.abs(tally.localMal / tally.local - share)).toBeLessThan(0.015)
    expect(
      Math.abs(tally.overseasMal / tally.overseas - overseasShare),
    ).toBeLessThan(0.04)
  })
})

describe('hand-off and clearance (spec §5.6)', () => {
  it('the hand-off locks f(t) then: an S parcel aged 200 s locks round(20 × 1.5 × f(200)) = 18 and pays 18 at +450 ticks (not f(245) = 13)', () => {
    const sim = atLevel(3)
    const handed = collect(sim, 'parcel:handedOff')
    const p = handedOff(sim, 'dk_pier_1', { ageS: 200 })
    expect(Math.round(20 * 1.5 * decayFactor(data, 200))).toBe(18)
    expect(Math.round(20 * 1.5 * decayFactor(data, 245))).toBe(13)
    expect(p).toMatchObject({
      state: 'handed_off',
      lockedValue: 18,
      clearTick: sim.state.tick + DOCKS_TICKS,
      vehicleId: null,
    })
    expect(handed).toEqual([
      { id: p.id, hub: 'docks', lockedValue: 18, buildingId: 'dk_pier_1' },
    ])
    expect(p.trace.at(-1)).toEqual({
      tick: sim.state.tick,
      what: 'handedOff',
      ref: 'dk_pier_1',
      text: 'Handed off at Prefetch Pier 1',
    })
    expect(createViewSim(sim).parcelValue(p.id)).toBe(18)
    expect(auditState(sim.state, data)).toEqual([])
    const cleared = collect(sim, 'parcel:cleared')
    const money = collect(sim, 'money:changed')
    const lifetime = sim.state.economy.lifetimeEarned
    runTicks(sim, DOCKS_TICKS - 1)
    expect(cleared).toEqual([])
    runTicks(sim, 1)
    expect(cleared).toEqual([
      {
        id: p.id,
        paid: 18,
        malware: false,
        hub: 'docks',
        buildingId: 'dk_pier_1',
        onTime: false,
      },
    ])
    expect(sim.state.economy.lifetimeEarned).toBe(lifetime + 18)
    expect(
      money.filter((x) => x.reason === 'clearance').map((x) => x.delta),
    ).toEqual([18])
  })

  it('clearance credits balance + lifetime + districts.docks.earned, emits parcel:cleared (clearTick, id order) then one hub:departure per hub per tick, in districts.json order', () => {
    const sim = atLevel(3)
    unlockDistrict(sim, 'airport')
    const s = sim.state
    runTicks(sim, 10)
    const a = handedOff(sim, 'dk_pier_2', { ageS: 0 })
    const b = handedOff(sim, 'dk_pier_1', { ageS: 0, size: 'M' })
    const airTicks = airportDef.clearanceS * TICKS_PER_S
    runTicks(sim, DOCKS_TICKS - airTicks)
    const c = handedOff(sim, 'ap_terminal', { ageS: 0 })
    expect(c.clearTick).toBe(a.clearTick)
    const vs = createViewSim(sim)
    expect(vs.hubs().map((h) => h.id)).toEqual(['docks'])
    expect(vs.hub('docks')!.clearing).toEqual([
      {
        parcelId: a.id,
        buildingId: 'dk_pier_2',
        size: 'S',
        handOffTick: a.clearTick! - DOCKS_TICKS,
        clearTick: a.clearTick,
        lockedValue: 30,
      },
      {
        parcelId: b.id,
        buildingId: 'dk_pier_1',
        size: 'M',
        handOffTick: b.clearTick! - DOCKS_TICKS,
        clearTick: b.clearTick,
        lockedValue: Math.round(45 * 1.5),
      },
    ])
    const balance = s.economy.balance
    const lifetime = s.economy.lifetimeEarned
    const log = eventLog(sim)
    runUntil(sim, () => s.tick === a.clearTick)
    const names = log
      .filter((e) => e.name === 'parcel:cleared' || e.name === 'hub:departure')
      .map((e) => [e.name, e.p])
    expect(names).toEqual([
      [
        'parcel:cleared',
        {
          id: a.id,
          paid: 30,
          malware: false,
          hub: 'docks',
          buildingId: 'dk_pier_2',
          onTime: true,
        },
      ],
      [
        'parcel:cleared',
        {
          id: b.id,
          paid: 68,
          malware: false,
          hub: 'docks',
          buildingId: 'dk_pier_1',
          onTime: true,
        },
      ],
      [
        'parcel:cleared',
        {
          id: c.id,
          paid: 40,
          malware: false,
          hub: 'airport',
          buildingId: 'ap_terminal',
          onTime: true,
        },
      ],
      ['hub:departure', { hub: 'docks', count: 2 }],
      ['hub:departure', { hub: 'airport', count: 1 }],
    ])
    const money = log
      .filter(
        (e) =>
          e.name === 'money:changed' &&
          (e.p as { reason: string }).reason === 'clearance',
      )
      .map((e) => e.p)
    expect(money).toEqual([
      { delta: 30, reason: 'clearance', balance: balance + 30 },
      { delta: 68, reason: 'clearance', balance: balance + 98 },
      { delta: 40, reason: 'clearance', balance: balance + 138 },
    ])
    expect(s.economy.lifetimeEarned).toBe(lifetime + 138)
    expect(s.districts.docks!.earned).toBe(98)
    expect(s.districts.airport!.earned).toBe(40)
    expect(s.stats.cleared).toBe(3)
    expect(s.stats.deliveries).toBe(0)
    // gc: the cleared parcels are gone; the trace's last hop was customsCleared.
    expect(s.parcels[String(a.id)]).toBeUndefined()
    expect(vs.hub('docks')!.clearing).toEqual([])
    expect(vs.hub('docks')!.earned).toBe(98)
    expect(auditState(s, data)).toEqual([])
  })

  it('a vehicle hands off at the pier anchor (a 1.5 s handoff stop): the parcel leaves the cargo, no satisfaction, no delivery stats', () => {
    const sim = atLevel(3)
    const bike = buy(sim, 'bike')
    fund(sim)
    noCheckers(sim)
    const p = injectParcel(sim, 'hr_towers_a', 'dk_pier_2')
    p.mult = docksDef.valueMult
    const sat = collect(sim, 'satisfaction:changed')
    const handed = collect(sim, 'parcel:handedOff')
    expect(runUntil(sim, () => handed.length > 0, 6000)).toBeGreaterThan(0)
    const at = sim.state.tick
    expect(bike.stops[bike.stopIndex]).toMatchObject({
      kind: 'handoff',
      buildingId: 'dk_pier_2',
    })
    expect(bike.pos).toEqual({
      tx: building('dk_pier_2').anchor[0],
      ty: building('dk_pier_2').anchor[1],
    })
    expect(bike.cargo).toEqual([])
    expect(bike.waitUntilTick).toBe(at + data.vehicles.stopS * TICKS_PER_S)
    expect(p.state).toBe('handed_off')
    expect(handed[0]).toMatchObject({ id: p.id, buildingId: 'dk_pier_2' })
    expect(sim.state.stats.deliveries).toBe(0)
    expect(sat.filter((x) => x.district === 'docks')).toEqual([])
    expect(p.trace.map((t) => t.what)).toEqual([
      'pickedUp',
      'unloaded',
      'empty',
      'empty',
      'empty',
      'empty',
      'shelved',
      'loaded',
      'handedOff',
    ])
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('ship has sailed: a handed-off malware parcel costs no life at hand-off or at +449 ticks, then −1 at +450 (life:lost viaClearance with handedOff + customsCleared on the path), paid $0, nothing earned', () => {
    const sim = atLevel(3)
    buy(sim, 'bike')
    fund(sim)
    noCheckers(sim)
    const p = injectParcel(sim, 'hr_towers_a', 'dk_pier_2', { malware: true })
    p.mult = docksDef.valueMult
    p.trace.push({ tick: p.spawnedTick, what: 'spawned', ref: p.origin })
    const handed = collect(sim, 'parcel:handedOff')
    const lost = collect(sim, 'life:lost')
    const cleared = collect(sim, 'parcel:cleared')
    runUntil(sim, () => handed.length > 0, 6000)
    const at = sim.state.tick
    expect(p.state).toBe('handed_off')
    expect(sim.state.economy.lives).toBe(3)
    expect(lost).toEqual([])
    runTicks(sim, DOCKS_TICKS - 1)
    expect(sim.state.economy.lives).toBe(3)
    expect(lost).toEqual([])
    const lifetime = sim.state.economy.lifetimeEarned
    runTicks(sim, 1)
    expect(sim.state.tick).toBe(at + DOCKS_TICKS)
    expect(sim.state.economy.lives).toBe(2)
    expect(sim.state.economy.lifetimeEarned).toBe(lifetime)
    expect(sim.state.stats.malwareMissed).toBe(1)
    expect(cleared).toEqual([
      {
        id: p.id,
        paid: 0,
        malware: true,
        hub: 'docks',
        buildingId: 'dk_pier_2',
        onTime: true,
      },
    ])
    expect(lost).toHaveLength(1)
    const r = lost[0]!.report
    expect(r.viaClearance).toBe(true)
    expect(r.destBuildingId).toBe('dk_pier_2')
    expect(r.livesLeft).toBe(2)
    expect(r.strain).toBe('metal')
    expect(r.path.map((t) => t.what)).toEqual([
      'spawned',
      'pickedUp',
      'unloaded',
      'empty',
      'empty',
      'empty',
      'empty',
      'shelved',
      'loaded',
      'handedOff',
      'customsCleared',
    ])
    expect(r.path.at(-2)).toEqual({
      tick: at,
      what: 'handedOff',
      ref: 'dk_pier_2',
      text: 'Handed off at Prefetch Pier 2',
    })
    expect(r.path.at(-1)).toEqual({
      tick: at + DOCKS_TICKS,
      what: 'customsCleared',
      ref: 'docks',
      text: 'Cleared',
    })
    expect(lost[0]!.path).toEqual(r.path)
    expect(sim.state.lastLostLife).toEqual(r)
    expect(sim.state.economy.daysSinceIncident).toBe(0)
    expect(sim.state.wanted).toContain(p.label)
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('save / load mid-clearance: the clearance lands on the same tick and the state hash equals the uninterrupted run', () => {
    const sim = atLevel(3)
    buy(sim, 'bike')
    fund(sim)
    const p = injectParcel(sim, 'hr_towers_a', 'dk_pier_1')
    p.mult = docksDef.valueMult
    runUntil(sim, () => p.state === 'handed_off', 6000)
    runTicks(sim, 100)
    const loaded = Sim.load(data, JSON.parse(JSON.stringify(sim.snapshot())))
    const logA = eventLog(sim)
    const logB = eventLog(loaded)
    runTicks(sim, 400)
    runTicks(loaded, 400)
    const a = logA.filter((e) => e.name === 'parcel:cleared')
    const b = logB.filter((e) => e.name === 'parcel:cleared')
    expect(a).toHaveLength(1)
    expect(a[0]!.tick).toBe(p.clearTick)
    expect(b).toEqual(a)
    expect(logB).toEqual(logA)
    expect(stateHash(loaded.state)).toBe(stateHash(sim.state))
  })

  it('selling the vehicle after its hand-off changes nothing: the parcel still clears and pays', () => {
    const sim = atLevel(3)
    buy(sim, 'bike')
    buy(sim, 'bike') // the last vehicle is unsellable
    fund(sim)
    const p = injectParcel(sim, 'hr_towers_a', 'dk_pier_1')
    p.mult = docksDef.valueMult
    runUntil(sim, () => p.state === 'handed_off', 6000)
    const by = Number(p.trace.findLast((t) => t.what === 'loaded')?.ref)
    expect(sim.state.vehicles.map((v) => v.id)).toContain(by)
    expect(sim.dispatch({ kind: 'sellVehicle', id: by })).toEqual({
      ok: true,
    })
    expect(p.state).toBe('handed_off')
    const cleared = collect(sim, 'parcel:cleared')
    runUntil(sim, () => cleared.length > 0, DOCKS_TICKS + 1)
    expect(cleared[0]).toMatchObject({ id: p.id, paid: p.lockedValue })
    expect(p.lockedValue).toBeGreaterThan(0)
    expect(sim.state.districts.docks!.earned).toBe(p.lockedValue)
  })

  it('the last life lost at a clearance → gameOver and one game:over (two malware clearing on one tick: two life:lost)', () => {
    const sim = atLevel(3)
    sim.state.economy.lives = 1
    const a = handedOff(sim, 'dk_pier_1', { malware: true })
    const b = handedOff(sim, 'dk_pier_2', { malware: true })
    const c = handedOff(sim, 'dk_pier_2')
    expect(a.clearTick).toBe(b.clearTick)
    const lost = collect(sim, 'life:lost')
    const over = collect(sim, 'game:over')
    const cleared = collect(sim, 'parcel:cleared')
    runTicks(sim, DOCKS_TICKS)
    expect(lost.map((x) => x.parcelId)).toEqual([a.id, b.id])
    expect(lost.every((x) => x.report.viaClearance)).toBe(true)
    expect(over).toEqual([{}])
    expect(sim.state.economy).toMatchObject({ lives: 0, gameOver: true })
    // The clean one due the same tick still clears and pays.
    expect(cleared.map((x) => [x.id, x.paid])).toEqual([
      [a.id, 0],
      [b.id, 0],
      [c.id, 30],
    ])
  })

  it('conservation incl. `cleared` holds every 600 ticks over a 30-minute forced-L3 run (spawned = … + delivered + tossed + cleared)', () => {
    const sim = makeSim(4)
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 })).toEqual({
      ok: true,
    })
    buy(sim, 'bike')
    buy(sim, 'van')
    buy(sim, 'truck')
    buy(sim, 'van')
    placeMachine(sim, 'metal_detector', 'slot2')
    placeMachine(sim, 'battery_checker', 'slot3')
    fund(sim)
    expect(sim.dispatch({ kind: 'buyDock', index: 2 })).toEqual({ ok: true })
    const handed = collect(sim, 'parcel:handedOff')
    for (let t = 1; t <= 18000; t++) {
      const hold = laneNode(sim.state.lane, 'hold')!
      for (const id of hold.queue.slice()) {
        sim.dispatch({ kind: 'toss', parcelId: id })
      }
      sim.tick()
      if (t % 600 === 0) {
        expect(auditState(sim.state, data), `tick ${t}`).toEqual([])
        expect(conservation(sim.state).ok, `tick ${t}`).toBe(true)
      }
    }
    const c = conservation(sim.state)
    expect(handed.length).toBeGreaterThan(20)
    expect(c.cleared).toBe(sim.state.stats.cleared)
    expect(c.cleared).toBeGreaterThan(15)
    expect(sim.state.districts.docks!.earned).toBeGreaterThan(0)
  }, 60_000)

  it('debug.forceOverseasMalware(hub): locked before the hub is live, invalid for a local district; at L3 it hands a malware parcel off now and costs a life clearanceS later', () => {
    const early = quietSim(1)
    const dbg0 = createViewSim(early, { debug: true }).debug!
    expect(dbg0.forceOverseasMalware('docks')).toEqual({
      ok: false,
      reason: 'locked',
    })
    const sim = atLevel(3)
    buy(sim, 'van')
    const dbg = createViewSim(sim, { debug: true }).debug!
    expect(dbg.forceOverseasMalware('highres')).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(dbg.forceOverseasMalware('airport')).toEqual({
      ok: false,
      reason: 'locked',
    })
    const handed = collect(sim, 'parcel:handedOff')
    runTicks(sim, 700) // battery announced + spawnable: the latest strain
    expect(dbg.forceOverseasMalware('docks')).toEqual({ ok: true })
    const p = sim.state.parcels[String(handed[0]!.id)]!
    expect(p).toMatchObject({
      state: 'handed_off',
      malware: true,
      strain: 'battery',
      dest: 'dk_pier_1',
      destRegion: 'docks',
      mult: docksDef.valueMult,
      clearTick: sim.state.tick + DOCKS_TICKS,
    })
    expect(p.trace.map((t) => t.what)).toEqual([
      'spawned',
      'pickedUp',
      'unloaded',
      'missed', // slot 1: the start desk, a missed roll (debug route)
      'empty',
      'empty',
      'empty',
      'shelved',
      'loaded',
      'handedOff',
    ])
    expect(sim.commandLog.at(-1)?.cmd).toEqual({
      kind: 'debugOverseasMalware',
      hub: 'docks',
    })
    expect(auditState(sim.state, data)).toEqual([])
    const lost = collect(sim, 'life:lost')
    runTicks(sim, DOCKS_TICKS - 1)
    expect(lost).toEqual([])
    runTicks(sim, 1)
    expect(lost).toHaveLength(1)
    expect(lost[0]!.report.viaClearance).toBe(true)
    expect(lost[0]!.report.path.at(-1)?.what).toBe('customsCleared')
  })
})
