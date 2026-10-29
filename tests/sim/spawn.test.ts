// spec §5.2 spawning, §5.4 malware, §9.3 m(s): per-district timers at
// spawnIntervalS × m(s), first spawn 5 s after live, origin by `send` under
// the 3-per-building cap, size mix, the destination rule (20 % same
// district, overseas only with a live hub, origin ≠ dest), malware grace
// (90 s AND 8 spawns), share by level + escalation + cap, decoys, labels, and
// the scripted first malware (≥ 120 s, size S, a servable origin, deferral;
// M3 run decision Q-RUN3: the origin is where a vehicle collects next).

import { describe, expect, it } from 'vitest'
import type { Sim } from '../../src/sim/sim.ts'
import {
  pickDestination,
  spawnIntervalTicks,
} from '../../src/sim/systems/spawn.ts'
import type { LiveDistrictDef } from '../../src/data/types.ts'
import type { Parcel } from '../../src/sim/types.ts'
import { laneNode, malwareShare } from '../../src/sim/types.ts'
import {
  buy,
  dataFixture,
  eventLog,
  makeSim,
  openingA,
  quiet,
  runSeconds,
  runTicks,
  unlockDistrict,
} from './helpers.ts'

const data = dataFixture()
const live = (id: string) =>
  data.districts.find((d) => d.id === id) as LiveDistrictDef

/** Every spawned parcel as it was at spawn time. */
function spawnLog(sim: Sim): Parcel[] {
  const out: Parcel[] = []
  sim.addTap((name, p) => {
    if (name !== 'parcel:spawned') return
    const parcel = sim.state.parcels[String((p as { id: number }).id)]
    if (parcel) out.push(structuredClone(parcel))
  })
  return out
}

const districtOf = (id: string) =>
  data.buildings.find((b) => b.id === id)?.district

/** Q-RUN3: the buildings each vehicle collects at next (collecting target / last delivery stop). */
function nextPickups(sim: Sim): string[] {
  const out: string[] = []
  for (const v of sim.state.vehicles) {
    if (v.state === 'collecting') {
      const stop = v.stops[v.stopIndex]
      if (stop) out.push(stop.buildingId)
    } else if (v.state === 'delivering') {
      const last = v.stops.at(-1)
      if (last) out.push(last.buildingId)
    }
  }
  return out
}

describe('spawn timers (spec §5.2, §9.3)', () => {
  it('interval × m(s): 225 ticks at s = 0, 150 at 50, 90 at 100, 138 at the start value 60', () => {
    const sim = makeSim(1)
    const hr = live('highres')
    expect(spawnIntervalTicks(sim, hr, 0)).toBe(225)
    expect(spawnIntervalTicks(sim, hr, 50)).toBe(150)
    expect(spawnIntervalTicks(sim, hr, 100)).toBe(90)
    expect(spawnIntervalTicks(sim, hr, 60)).toBe(138)
    for (let s = 0; s <= 100; s += 5) {
      const t = spawnIntervalTicks(sim, hr, s)
      expect(t).toBeGreaterThanOrEqual(90)
      expect(t).toBeLessThanOrEqual(225)
    }
  })

  it('first spawn 5 s after live: nothing before tick 50, one per L1 district at tick 50, then the next after interval × m(s)', () => {
    const sim = makeSim(1)
    const log = spawnLog(sim)
    runTicks(sim, 49)
    expect(log).toHaveLength(0)
    runTicks(sim, 1)
    expect(log.map((p) => districtOf(p.origin)).toSorted()).toEqual([
      'downtown',
      'highres',
    ])
    expect(sim.state.districts.highres?.nextSpawnTick).toBe(
      50 + spawnIntervalTicks(sim, live('highres'), 60),
    )
  })

  it('locked districts never spawn and are never destinations', () => {
    const sim = makeSim(4)
    const log = spawnLog(sim)
    runSeconds(sim, 600)
    expect(log.length).toBeGreaterThan(40)
    for (const p of log) {
      expect(['highres', 'downtown']).toContain(districtOf(p.origin))
      expect(['highres', 'downtown']).toContain(p.destRegion)
    }
  })
})

describe('origin and destination (spec §5.2, §4.4)', () => {
  it('3-per-building cap: with nobody collecting every L1 building ends at 3 and spawns skip silently', () => {
    const sim = makeSim(2)
    const cap = data.parcels.spawn.maxWaitingPerBuilding
    for (let i = 0; i < 18000; i += 100) {
      runTicks(sim, 100)
      for (const b of Object.values(sim.state.buildings)) {
        expect(b.waiting.length).toBeLessThanOrEqual(cap)
      }
    }
    const l1 = data.buildings.filter((b) =>
      ['highres', 'downtown'].includes(b.district),
    )
    for (const b of l1)
      expect(sim.state.buildings[b.id]?.waiting).toHaveLength(cap)
    expect(sim.state.spawn.spawnedCount).toBe(l1.length * cap)
  })

  it('origin ≠ destination, always', () => {
    for (const seed of [1, 2, 3]) {
      const sim = makeSim(seed)
      openingA(sim)
      const log = spawnLog(sim)
      runSeconds(sim, 900)
      for (const p of log) expect(p.dest).not.toBe(p.origin)
    }
  })

  it('20 % same-district share over 10k draws ± 2 pts', () => {
    const sim = makeSim(9)
    const origin = data.buildings.find((b) => b.id === 'hr_towers_a')!
    let same = 0
    for (let i = 0; i < 10000; i++) {
      const d = pickDestination(sim, origin, 'S')
      expect(d?.id).not.toBe(origin.id)
      if (d?.district === origin.district) same += 1
    }
    expect(
      Math.abs(same / 10000 - data.parcels.spawn.sameDistrictShare),
    ).toBeLessThan(0.02)
  })

  it('otherwise a building in another live district, weighted by recv (50k draws, each building within 1 pt of its share)', () => {
    const sim = makeSim(4)
    const origin = data.buildings.find((b) => b.id === 'hr_pizza')!
    const n = 50000
    const counts: Record<string, number> = {}
    for (let i = 0; i < n; i++) {
      const d = pickDestination(sim, origin, 'S')!
      counts[d.id] = (counts[d.id] ?? 0) + 1
    }
    // L1: the other live district is Downtown, which gets 1 − sameDistrictShare
    const other = data.buildings.filter((b) => b.district === 'downtown')
    const recv = other.reduce((sum, b) => sum + b.recv, 0)
    const share = 1 - data.parcels.spawn.sameDistrictShare
    for (const b of other) {
      const got = (counts[b.id] ?? 0) / n
      expect(Math.abs(got - (share * b.recv) / recv), b.id).toBeLessThan(0.01)
    }
    // never a locked district's building
    for (const id of Object.keys(counts)) {
      expect(['highres', 'downtown']).toContain(districtOf(id))
    }
  })

  it('overseas only with a live hub: none while Docks is locked; ~15 % to a pier once it is live', () => {
    const sim = makeSim(5)
    const origin = data.buildings.find((b) => b.id === 'dt_cache_cafe')!
    let hub = 0
    for (let i = 0; i < 5000; i++) {
      if (pickDestination(sim, origin, 'S')?.district === 'docks') hub += 1
    }
    expect(hub).toBe(0)
    unlockDistrict(sim, 'docks')
    const piers: string[] = []
    for (let i = 0; i < 10000; i++) {
      const d = pickDestination(sim, origin, 'L')
      if (d?.district === 'docks') piers.push(d.id)
      expect(d?.district).not.toBe('airport') // locked; and L never goes to the Airport
    }
    expect(
      Math.abs(piers.length / 10000 - data.parcels.spawn.overseasShare),
    ).toBeLessThan(0.02)
    expect(piers).not.toContain('dk_customs') // recv 0: scenery
  })

  it('sizes follow the district mix: High-density residential never spawns L / XL, Downtown never XL', () => {
    const sim = makeSim(6)
    openingA(sim)
    const log = spawnLog(sim)
    runSeconds(sim, 1200)
    const hr = log.filter((p) => districtOf(p.origin) === 'highres')
    const dt = log.filter((p) => districtOf(p.origin) === 'downtown')
    expect(hr.length).toBeGreaterThan(30)
    expect(hr.some((p) => p.size === 'L' || p.size === 'XL')).toBe(false)
    expect(dt.some((p) => p.size === 'XL')).toBe(false)
    expect(dt.some((p) => p.size === 'M')).toBe(true)
    for (const p of log) {
      expect(p.baseValue).toBe(data.parcels.sizes[p.size].value)
      expect(p.mult).toBe(1)
    }
  })
})

describe('malware at spawn (spec §5.4)', () => {
  it('grace by time: no malware in the first 90 s even when the count grace is 0', () => {
    const sim = makeSim(1, {
      parcels: { malware: { baseShare: 1, cap: 1, graceCount: 0 } },
    })
    const log = spawnLog(sim)
    runSeconds(sim, 110)
    const early = log.filter((p) => p.spawnedTick < 900)
    const late = log.filter((p) => p.spawnedTick >= 900)
    expect(early.length).toBeGreaterThan(8)
    expect(early.some((p) => p.malware)).toBe(false)
    expect(late.length).toBeGreaterThan(0)
    expect(late.every((p) => p.malware)).toBe(true)
  })

  it('grace by count: no malware among the first 8 spawns even with no time grace', () => {
    const sim = makeSim(1, {
      parcels: {
        malware: { baseShare: 1, cap: 1, graceS: 0, newStrainDelayS: 0 },
      },
    })
    const log = spawnLog(sim)
    runSeconds(sim, 80)
    expect(log.length).toBeGreaterThan(9)
    expect(
      log.slice(0, data.parcels.malware.graceCount).some((p) => p.malware),
    ).toBe(false)
    expect(
      log.slice(data.parcels.malware.graceCount).every((p) => p.malware),
    ).toBe(true)
  })

  it('share per level: baseShare at L1, + perLevel at L2, + postVictoryPerDay per day after the playtest cap, capped, × overseasMult', () => {
    const sim = makeSim(1)
    const s = sim.state
    const m = data.parcels.malware
    expect(malwareShare(s, data)).toBeCloseTo(m.baseShare, 10)
    expect(malwareShare(s, data, true)).toBeCloseTo(
      m.baseShare * m.overseasMult,
      10,
    )
    s.level.level = 2
    const l2 = m.baseShare + m.perLevel
    expect(malwareShare(s, data)).toBeCloseTo(l2, 10)
    s.stats.levelTick['2'] = 600 * 3 + 120 // reached L2 (the cap) during day 3
    s.tick = 600 * 4
    s.day = 4
    expect(malwareShare(s, data)).toBeCloseTo(l2 + m.postVictoryPerDay, 10)
    s.tick = 600 * 9
    s.day = 9
    expect(malwareShare(s, data)).toBeCloseTo(l2 + 6 * m.postVictoryPerDay, 10)
    s.tick = 600 * 40
    s.day = 40
    expect(malwareShare(s, data)).toBe(data.parcels.malware.cap)
    expect(malwareShare(s, data, true)).toBe(data.parcels.malware.cap)
  })

  it('decoy traits only on clean parcels (~10 %); labels come from the matching puns.json list', () => {
    const sim = makeSim(3, {
      parcels: { malware: { baseShare: 0.2, cap: 0.2 } },
    })
    openingA(sim)
    buy(sim, 'bike')
    buy(sim, 'bike')
    const log = spawnLog(sim)
    runSeconds(sim, 1800)
    const clean = log.filter((p) => !p.malware)
    const decoys = clean.filter((p) => p.decoy !== null)
    expect(
      Math.abs(decoys.length / clean.length - data.parcels.decoyShare),
    ).toBeLessThan(0.05)
    for (const p of log) {
      if (p.malware) {
        expect(p.decoy).toBeNull()
        expect(data.puns.malwareLabels[p.strain!]).toContain(p.label)
      } else if (p.decoy) {
        expect(data.puns.decoyLabels[p.decoy]).toContain(p.label)
      } else {
        expect(data.puns.cleanLabels).toContain(p.label)
      }
    }
  })

  it("scripted first malware (run decision Q-RUN3): the first spawn at or after 120 s while a vehicle is about to collect, its origin that vehicle's next pickup (a collecting target or a delivering vehicle's last stop), strain metal, size S, a servable district (seeds 1-10)", () => {
    const fs = data.parcels.malware.firstScripted
    for (let seed = 1; seed <= 10; seed++) {
      const sim = makeSim(seed)
      openingA(sim)
      const log = spawnLog(sim)
      let next: string[] | null = null
      sim.addTap((name, p) => {
        if (name !== 'parcel:spawned') return
        if (!sim.state.parcels[String((p as { id: number }).id)]?.scripted) {
          return
        }
        next = nextPickups(sim)
      })
      runSeconds(sim, fs.atS + fs.deferUntilCheckerS + 30)
      const first = log.find((p) => p.scripted)
      expect(first, `seed ${seed}`).toBeDefined()
      expect(first).toMatchObject({
        malware: true,
        strain: fs.strain,
        size: fs.size,
        scripted: true,
      })
      expect(first!.spawnedTick).toBeGreaterThanOrEqual(fs.atS * 10)
      expect(first!.spawnedTick).toBeLessThan(
        (fs.atS + fs.deferUntilCheckerS) * 10,
      )
      expect(next, `seed ${seed}`).toContain(first!.origin)
      expect(['highres', 'downtown']).toContain(districtOf(first!.origin))
      expect(log.filter((p) => p.scripted)).toHaveLength(1)
      expect(sim.state.spawn.scriptedDone).toBe(true)
    }
  })

  it('Q-RUN3: opening A picks the scripted malware up within 60 s of its spawn (seeds 1-10; the M2 nearest-first tail waited up to 8 min)', () => {
    const fs = data.parcels.malware.firstScripted
    const waits: number[] = []
    for (let seed = 1; seed <= 10; seed++) {
      const sim = makeSim(seed)
      openingA(sim)
      const log = spawnLog(sim)
      const events = eventLog(sim)
      runSeconds(sim, fs.atS + fs.deferUntilCheckerS + 120)
      const p = log.find((x) => x.scripted)!
      const picked = events.find(
        (e) =>
          e.name === 'parcel:pickedUp' && (e.p as { id: number }).id === p.id,
      )
      expect(picked, `seed ${seed}`).toBeDefined()
      waits.push((picked!.tick - p.spawnedTick) / 10)
    }
    expect(waits.filter((w) => w <= 60).length).toBeGreaterThanOrEqual(9)
  })

  it('Q-RUN3: while no vehicle is about to collect, the forced spawn stays due (later spawns retry); deferUntilCheckerS past atS any servable building with room takes it', () => {
    const fs = data.parcels.malware.firstScripted
    const sim = makeSim(4)
    // A bike homed on highres while highres never spawns: it stays idle on
    // the lot, so no next pickup exists; downtown keeps spawning.
    sim.state.districts.highres!.nextSpawnTick = null
    const bike = buy(sim, 'bike')
    sim.dispatch({ kind: 'setZone', id: bike.id, zone: 'highres' })
    const log = spawnLog(sim)
    runSeconds(sim, fs.atS + fs.deferUntilCheckerS - 1)
    expect(log.some((p) => p.spawnedTick >= fs.atS * 10)).toBe(true)
    expect(log.some((p) => p.scripted)).toBe(false)
    expect(sim.state.spawn.scriptedDone).toBe(false)
    expect(sim.state.vehicles[0]!.state).toBe('idle_lot')
    runSeconds(sim, 30)
    const p = log.find((x) => x.scripted)
    expect(p).toMatchObject({ malware: true, size: fs.size, scripted: true })
    // the servable pool: the bike's zone (highres), any building with room
    expect(districtOf(p!.origin)).toBe('highres')
  })

  it('a bike-only fleet never gets the scripted malware from Industrial (seeds 1-20, Industrial live)', () => {
    const fs = data.parcels.malware.firstScripted
    for (let seed = 1; seed <= 20; seed++) {
      const sim = makeSim(seed)
      openingA(sim)
      unlockDistrict(sim, 'industrial', true)
      const log = spawnLog(sim)
      runSeconds(sim, fs.atS + fs.deferUntilCheckerS + 30)
      const scripted = log.find((p) => p.scripted)
      expect(scripted, `seed ${seed}`).toBeDefined()
      expect(districtOf(scripted!.origin)).not.toBe('industrial')
      expect(scripted!.size).toBe('S')
    }
  })

  it('malware share climbs by postVictoryPerDay per day after the cap and stops at malware.cap (a real level-up; the MinuteRow malShare column)', () => {
    const m = data.parcels.malware
    const sim = quiet(makeSim(1))
    const capLevel = data.economy.playtestMaxLevel
    const row = data.levels.find((l) => l.level === capLevel)!
    runTicks(sim, 100)
    sim.state.economy.lifetimeEarned = row.threshold
    runTicks(sim, 1)
    expect(sim.state.level.level).toBe(capLevel)
    const atCap = m.baseShare + m.perLevel * (capLevel - 1)
    expect(malwareShare(sim.state, data)).toBeCloseTo(atCap, 10)
    const days = Math.ceil((m.cap - atCap) / m.postVictoryPerDay) + 5
    runTicks(sim, 600 * days - 101)
    const shares = sim.state.stats.minutes.map((r) => r.malShare)
    // day 1 is the first boundary after the cap (reached during day 0)
    shares.forEach((share, i) => {
      const want = Math.min(m.cap, atCap + m.postVictoryPerDay * (i + 1))
      expect(share, `day ${i + 1}`).toBeCloseTo(want, 10)
    })
    expect(shares.at(-1)).toBe(m.cap)
    expect(shares.filter((x) => x === m.cap).length).toBeGreaterThan(3)
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]!).toBeGreaterThanOrEqual(shares[i - 1]!)
    }
    // no escalation before the cap: an L1 game keeps baseShare all along
    const l1 = quiet(makeSim(1))
    runTicks(l1, 600 * 10)
    expect(
      l1.state.stats.minutes.every((r) => r.malShare === m.baseShare),
    ).toBe(true)
  })

  it('no checker in the lane: deferred up to deferUntilCheckerS, then ordinary malware (no forced catch)', () => {
    const fs = data.parcels.malware.firstScripted
    const sim = makeSim(2)
    const desk = laneNode(sim.state.lane, 'slot1')!
    desk.stations = []
    desk.fixture!.checker.stations = 0
    const log = spawnLog(sim)
    runSeconds(sim, fs.atS + fs.deferUntilCheckerS + 30)
    const due = sim.state.spawn.scriptedDeferredUntilTick
    expect(due).not.toBeNull()
    expect(due! - fs.deferUntilCheckerS * 10).toBeGreaterThanOrEqual(
      fs.atS * 10,
    )
    expect(log.some((p) => p.scripted)).toBe(false)
    const forced = log.find((p) => p.spawnedTick >= due!)
    expect(forced).toMatchObject({
      malware: true,
      strain: fs.strain,
      size: fs.size,
      scripted: false,
    })
    expect(sim.state.spawn.scriptedDone).toBe(true)
  })

  it('a checker arriving during the deferral makes the next spawn the scripted one', () => {
    const fs = data.parcels.malware.firstScripted
    const sim = makeSim(2)
    const desk = laneNode(sim.state.lane, 'slot1')!
    desk.stations = []
    desk.fixture!.checker.stations = 0
    const log = spawnLog(sim)
    runSeconds(sim, fs.atS + 20)
    expect(sim.state.spawn.scriptedDeferredUntilTick).not.toBeNull()
    expect(sim.state.spawn.scriptedDone).toBe(false)
    sim.dispatch({
      kind: 'buyMachine',
      defId: 'metal_detector',
      nodeId: 'slot2',
    })
    const t0 = sim.state.tick
    runSeconds(sim, 30)
    const next = log.find((p) => p.spawnedTick > t0)
    expect(next).toMatchObject({ malware: true, scripted: true, size: fs.size })
  })
})
