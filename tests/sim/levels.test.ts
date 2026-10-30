// spec §8 company levels (+ §3.5 region unlock, §5.4 strain announcement,
// §6.2 lane growth; plan.md §12.6 tasks 1 + 11): lifetime earned vs the
// levels.json thresholds → `level:up` the tick the threshold is crossed; the
// playtest cap (economy.playtestMaxLevel — 5 since M9, the last row, B2 §9;
// the mechanism is pinned with a cap-2 override: no `level:up {3}`, the bar
// keeps counting toward the L3 threshold); the L2 unlocks (Industrial live at
// satisfaction 60 with its first spawn firstSpawnDelayS later, the truck,
// the Shaky shaker, slot 4, shelf 45, tier 2, the ticker line) and rattle,
// announced at the level-up and drawn only newStrainDelayS later; the L3
// row (spec-build2 §4.1: Docks live without a spawn timer, Hold Bay 5,
// shelf 60, tier 3, battery, the Battery checker, dock 2); the L4 row
// (B2 §4.2: Low-density + Rural live with timers, slot 5, shelf 80, tier 4,
// `dense` with its typosquat labels, the X-ray, the Sorter Arm, dock 3) and
// the L5 row (B2 §4.3: Airport live without a timer + Park & civic, slot 6,
// shelf 100, tier 5, no strain, nextThreshold null, the Golden Release
// offered the same tick) — every one reached the levels.json way (lifetime
// earned), never through debug.forceLevel (design-m8-m9 §7 M9 1).

import { describe, expect, it } from 'vitest'
import { availableStrains } from '../../src/sim/systems/spawn.ts'
import { strainSpottedText } from '../../src/sim/systems/levels.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import type { Parcel } from '../../src/sim/types.ts'
import { laneNode, liveSlotIds, TICKS_PER_S } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import { auditState, Sim } from '../../src/sim/sim.ts'
import {
  buy,
  collect,
  dataFixture,
  eventLog,
  fund,
  makeSim,
  noOffers,
  quiet,
  quietSim,
  runTicks,
  runUntil,
  shelveParcel,
} from './helpers.ts'

const data = dataFixture()
const L2 = data.levels.find((l) => l.level === 2)!
const L3 = data.levels.find((l) => l.level === 3)!
const L4 = data.levels.find((l) => l.level === 4)!
const L5 = data.levels.find((l) => l.level === 5)!
const cap = data.economy.playtestMaxLevel
/** The playtest-1 cap: pins the cap mechanism below the shipped one. */
const CAP2 = { economy: { playtestMaxLevel: 2 } }

describe('level-ups (spec §8)', () => {
  it('level:up fires at lifetime $2,000 — not a dollar before — on the tick it is crossed', () => {
    const sim = quietSim(1)
    const ups = collect(sim, 'level:up')
    sim.state.economy.lifetimeEarned = L2.threshold - 1
    runTicks(sim, 50)
    expect(ups).toEqual([])
    expect(sim.state.level.level).toBe(1)
    sim.credit(1, 'bounty', true)
    expect(sim.state.economy.lifetimeEarned).toBe(L2.threshold)
    const at = sim.state.tick + 1
    runTicks(sim, 1)
    expect(ups).toEqual([{ level: 2 }])
    expect(sim.state.level.level).toBe(2)
    expect(sim.state.stats.levelTick['2']).toBe(at)
    runTicks(sim, 600)
    expect(ups).toHaveLength(1)
  })

  it('a delivery that crosses the threshold levels up in the same tick it pays', () => {
    const sim = quietSim(2)
    buy(sim, 'bike')
    fund(sim)
    const p = shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    sim.state.economy.lifetimeEarned = L2.threshold - 1
    const log = eventLog(sim)
    runUntil(sim, () => sim.state.level.level === 2, 6000)
    const delivered = log.find(
      (e) =>
        e.name === 'parcel:delivered' && (e.p as { id: number }).id === p.id,
    )
    const up = log.find((e) => e.name === 'level:up')
    expect(delivered).toBeDefined()
    expect(up?.tick).toBe(delivered!.tick)
  })

  it('no level:up past playtestMaxLevel: lifetime far past the L3-L5 thresholds levels up to 2 only (cap 2)', () => {
    const sim = quietSim(1, CAP2)
    expect(sim.data.economy.playtestMaxLevel).toBe(2)
    const ups = collect(sim, 'level:up')
    sim.state.economy.lifetimeEarned = 100_000
    runTicks(sim, 600 * 3)
    expect(ups).toEqual([{ level: 2 }])
    expect(sim.state.level.level).toBe(2)
    expect(Object.keys(sim.state.stats.levelTick).toSorted()).toEqual([
      '1',
      '2',
    ])
    // the L3 row's unlocks never apply
    expect(sim.state.districts.docks!.live).toBe(false)
    expect(sim.state.level.holdBayCap).toBe(L2.holdBayCap)
    expect(sim.state.level.announced.battery).toBeUndefined()
  })

  it('the shipped cap is the last row, L5 (B2 §9; design-m8-m9 R1): lifetime far past every threshold levels up 2, 3, 4, 5 in order on one tick; nextThreshold null; debug.forceLevel past L5 is invalid', () => {
    const top = Math.max(...data.levels.map((l) => l.level))
    expect(top).toBe(5)
    expect(cap).toBe(top)
    const sim = quietSim(1)
    const ups = collect(sim, 'level:up')
    sim.state.economy.lifetimeEarned = 100_000
    runTicks(sim, 1)
    expect(ups).toEqual([
      { level: 2 },
      { level: 3 },
      { level: 4 },
      { level: 5 },
    ])
    const at = sim.state.tick
    expect(sim.state.stats.levelTick).toMatchObject({
      '2': at,
      '3': at,
      '4': at,
      '5': at,
    })
    runTicks(sim, 600 * 3)
    expect(ups).toHaveLength(4)
    expect(sim.state.level.level).toBe(5)
    expect(sim.state.level.nextThreshold).toBeNull()
    expect(createViewSim(sim).nextThreshold).toBeNull()
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 6 })).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('a 30-minute competent run (seeds 1-3) never levels past the cap (cap 2: never level:up {3})', () => {
    for (const seed of [1, 2, 3]) {
      const sim = makeSim(seed, CAP2)
      const policy = createPolicy(sim, 'competent')
      const ups = collect(sim, 'level:up')
      for (let i = 0; i < 18000; i++) {
        policy.step()
        sim.tick()
      }
      expect(
        ups.map((u) => u.level),
        `seed ${seed}`,
      ).toEqual([2])
      expect(sim.state.economy.lifetimeEarned).toBeGreaterThan(L2.threshold)
    }
  }, 30_000)

  it('nextThreshold stays at the L3 threshold at the cap (the HUD bar keeps counting toward the L3 row; cap 2)', () => {
    const sim = quietSim(1, CAP2)
    const vs = createViewSim(sim)
    expect(vs.nextThreshold).toBe(L2.threshold)
    sim.state.economy.lifetimeEarned = L2.threshold
    runTicks(sim, 1)
    expect(vs.level).toBe(2)
    expect(vs.nextThreshold).toBe(L3.threshold)
    sim.state.economy.lifetimeEarned = 40_000
    runTicks(sim, 600)
    expect(vs.level).toBe(2)
    expect(vs.nextThreshold).toBe(L3.threshold)
  })
})

describe('L2 unlocks (spec §8, §3.5, §6.2)', () => {
  it('Industrial spawns start 5 s after unlock at satisfaction 60 (region:unlocked; live in districts.json order)', () => {
    const sim = makeSim(3)
    runTicks(sim, 333)
    const unlocked = collect(sim, 'region:unlocked')
    const spawned: { tick: number; origin: string }[] = []
    sim.addTap((name, p, tick) => {
      if (name === 'parcel:spawned') {
        spawned.push({ tick, origin: (p as { origin: string }).origin })
      }
    })
    sim.state.economy.lifetimeEarned = L2.threshold
    runTicks(sim, 1)
    const at = sim.state.tick
    const ind = sim.state.districts.industrial!
    expect(unlocked).toEqual([{ district: 'industrial' }])
    expect(ind.live).toBe(true)
    expect(ind.satisfaction).toBe(data.economy.satisfaction.start)
    expect(ind.satisfaction).toBe(60)
    const delay = data.parcels.spawn.firstSpawnDelayS * TICKS_PER_S
    expect(ind.nextSpawnTick).toBe(at + delay)
    expect(sim.state.level.unlocked).toEqual([
      'highres',
      'downtown',
      'industrial',
    ])
    runTicks(sim, delay + 5)
    const industrial = spawned.filter((s) => s.origin.startsWith('in_'))
    expect(industrial[0]?.tick).toBe(at + delay)
    expect(createViewSim(sim).regionState('industrial')).toBe('live')
  })

  it('slot 4 and shelf 45 apply at L2 (Hold Bay 3, warehouse tier 2); the truck and the Shaky shaker unlock', () => {
    const sim = quietSim(1)
    fund(sim)
    expect(liveSlotIds(sim.state.lane)).toEqual(['slot1', 'slot2', 'slot3'])
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'metal_detector',
        nodeId: 'slot4',
      }),
    ).toEqual({ ok: false, reason: 'slot-locked' })
    expect(
      sim.dispatch({ kind: 'buyVehicle', type: 'truck', applicantId: null }),
    ).toEqual({
      ok: false,
      reason: 'locked',
    })
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'shaky_shaker',
        nodeId: 'slot2',
      }),
    ).toEqual({ ok: false, reason: 'locked' })
    sim.state.economy.lifetimeEarned = L2.threshold
    runTicks(sim, 1)
    const lane = sim.state.lane
    expect(liveSlotIds(lane)).toEqual(['slot1', 'slot2', 'slot3', 'slot4'])
    expect(laneNode(lane, 'slot4')!.locked).toBeUndefined()
    expect(laneNode(lane, 'slot5')!.locked).toEqual({ level: 4 })
    expect(laneNode(lane, 'shelf')!.cap).toBe(45)
    expect(laneNode(lane, 'hold')!.cap).toBe(3)
    expect(sim.state.level).toMatchObject({
      level: 2,
      slots: 4,
      shelfCap: 45,
      holdBayCap: 3,
      warehouseTier: 2,
    })
    expect(createViewSim(sim).shelf.cap).toBe(45)
    expect(
      sim.dispatch({ kind: 'buyVehicle', type: 'truck', applicantId: null }),
    ).toMatchObject({
      ok: true,
    })
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'shaky_shaker',
        nodeId: 'slot4',
      }),
    ).toEqual({ ok: true })
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('the level-up moment: level:up, then the levels.json ticker line (kind level), then region:unlocked', () => {
    const sim = quietSim(1)
    const log = eventLog(sim)
    sim.state.economy.lifetimeEarned = L2.threshold
    runTicks(sim, 1)
    const names = log
      .filter((e) =>
        ['level:up', 'ticker:news', 'region:unlocked'].includes(e.name),
      )
      .map((e) => [e.name, e.p])
    expect(names).toEqual([
      ['level:up', { level: 2 }],
      ['ticker:news', { text: L2.ticker, kind: 'level' }],
      ['region:unlocked', { district: 'industrial' }],
    ])
  })

  it('rattle spawns only after newStrainDelayS: announced at the level-up (Detection % counts it at once), drawn from announced + delay, the "New strain spotted: rattle" ticker on that tick', () => {
    const sim = makeSim(5, {
      parcels: {
        malware: { baseShare: 0.6, cap: 1, graceS: 0, graceCount: 0 },
      },
    })
    const delay = sim.data.parcels.malware.newStrainDelayS * TICKS_PER_S
    runTicks(sim, delay + 100) // past the start strain's own delay (metal at 0)
    const malware: Parcel[] = []
    sim.addTap((name, p) => {
      if (name !== 'parcel:spawned') return
      const parcel = sim.state.parcels[String((p as { id: number }).id)]
      if (parcel?.malware) malware.push(structuredClone(parcel))
    })
    const ticker = eventLog(sim)
    sim.state.economy.lifetimeEarned = L2.threshold
    runTicks(sim, 1)
    const at = sim.state.tick
    expect(sim.state.level.announced.rattle).toBe(at)
    expect(
      createViewSim(sim)
        .laneStats()
        .byStrain.map((x) => x.strain),
    ).toEqual(['metal', 'rattle'])
    expect(availableStrains(sim)).toEqual(['metal'])
    runTicks(sim, delay - 1)
    expect(availableStrains(sim)).toEqual(['metal'])
    expect(malware.length).toBeGreaterThan(5)
    expect(malware.every((p) => p.strain === 'metal')).toBe(true)
    const before = malware.length
    runTicks(sim, 1)
    expect(sim.state.tick).toBe(at + delay)
    expect(availableStrains(sim)).toEqual(['metal', 'rattle'])
    const strainLines = ticker.filter(
      (e) =>
        e.name === 'ticker:news' && (e.p as { kind: string }).kind === 'strain',
    )
    expect(strainLines).toEqual([
      {
        tick: at + delay,
        name: 'ticker:news',
        p: { text: strainSpottedText('rattle'), kind: 'strain' },
      },
    ])
    expect(strainSpottedText('rattle')).toBe('New strain spotted: rattle')
    runTicks(sim, 600 * 3)
    const after = malware.slice(before)
    expect(after.some((p) => p.strain === 'rattle')).toBe(true)
    expect(after.some((p) => p.strain === 'metal')).toBe(true)
    expect(
      malware
        .filter((p) => p.strain === 'rattle')
        .every((p) => p.spawnedTick >= at + delay),
    ).toBe(true)
    // the start strain (announced at tick 0) never gets a "spotted" line
    expect(
      ticker.filter(
        (e) =>
          e.name === 'ticker:news' &&
          (e.p as { text: string }).text === strainSpottedText('metal'),
      ),
    ).toEqual([])
  })

  it('a level-up survives a JSON save round trip mid-announcement (the strain line still fires once)', () => {
    const sim = quietSim(1)
    sim.state.economy.lifetimeEarned = L2.threshold
    runTicks(sim, 10)
    const snap = JSON.parse(JSON.stringify(sim.snapshot()))
    const loaded = Sim.load(data, snap)
    const lines = collect(loaded, 'ticker:news')
    const ups = collect(loaded, 'level:up')
    runTicks(loaded, 600)
    expect(ups).toEqual([])
    expect(lines).toEqual([
      { text: strainSpottedText('rattle'), kind: 'strain' },
    ])
  })

  it('a level forced at tick 0 (the ?level=N boot) still spots every strain it announces, once, newStrainDelayS later; the start strain never (M9 review)', () => {
    const sim = quietSim(1)
    const lines = collect(sim, 'ticker:news')
    expect(sim.state.tick).toBe(0)
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 5 }).ok).toBe(true)
    expect(sim.state.level.announced).toEqual({
      metal: 0,
      rattle: 0,
      battery: 0,
      dense: 0,
    })
    const delay = data.parcels.malware.newStrainDelayS * TICKS_PER_S
    runTicks(sim, delay + 5)
    const spotted = lines.filter((l) => l.kind === 'strain')
    expect(spotted).toEqual(
      ['rattle', 'battery', 'dense'].map((s) => ({
        text: strainSpottedText(s as 'rattle'),
        kind: 'strain',
      })),
    )
  })
})

describe('L3 "Regional" unlocks (spec-build2 §4.1; design-m8-m9 §4.5, §7 M8 1)', () => {
  it('the L3 row applies: Docks live without a spawn timer, Hold Bay 5, shelf 60, tier 3, slots stay 4, battery announced now and spawnable 60 s later; level:up → ticker → region:unlocked', () => {
    const sim = quietSim(1)
    fund(sim)
    sim.state.economy.lifetimeEarned = L2.threshold
    runTicks(sim, 1)
    expect(sim.state.level.level).toBe(2)
    // Below L3: the Battery checker and dock 2 are locked.
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'battery_checker',
        nodeId: 'slot2',
      }),
    ).toEqual({ ok: false, reason: 'locked' })
    expect(sim.dispatch({ kind: 'buyDock', index: 2 })).toEqual({
      ok: false,
      reason: 'locked',
    })
    const log = eventLog(sim)
    sim.state.economy.lifetimeEarned = L3.threshold
    runTicks(sim, 1)
    const at = sim.state.tick
    const s = sim.state
    expect(s.level).toMatchObject({
      level: 3,
      slots: 4,
      holdBayCap: 5,
      shelfCap: 60,
      warehouseTier: 3,
      nextThreshold: L4.threshold,
    })
    expect(L3).toMatchObject({ holdBayCap: 5, shelfCap: 60, warehouseTier: 3 })
    expect(s.stats.levelTick['3']).toBe(at)
    const lane = s.lane
    expect(laneNode(lane, 'hold')!.cap).toBe(5)
    expect(laneNode(lane, 'shelf')!.cap).toBe(60)
    expect(liveSlotIds(lane)).toEqual(['slot1', 'slot2', 'slot3', 'slot4'])
    expect(laneNode(lane, 'slot5')!.locked).toEqual({ level: 4 })
    const docks = s.districts.docks!
    expect(docks.live).toBe(true)
    expect(docks.nextSpawnTick).toBeNull()
    expect(s.level.unlocked).toEqual([
      'highres',
      'downtown',
      'industrial',
      'docks',
    ])
    expect(createViewSim(sim).regionState('docks')).toBe('live')
    expect(createViewSim(sim).hub('docks')).toMatchObject({
      live: true,
      office: 'dk_customs',
      clearanceS: 45,
      valueMult: 1.5,
      clearing: [],
    })
    // The level-up moment, in order.
    expect(
      log
        .filter((e) =>
          ['level:up', 'ticker:news', 'region:unlocked'].includes(e.name),
        )
        .map((e) => [e.name, e.p]),
    ).toEqual([
      ['level:up', { level: 3 }],
      ['ticker:news', { text: L3.ticker, kind: 'level' }],
      ['region:unlocked', { district: 'docks' }],
    ])
    // battery: announced at the level-up (Detection % counts it), drawn
    // newStrainDelayS later with its "New strain spotted" line.
    expect(L3.strain).toBe('battery')
    expect(s.level.announced.battery).toBe(at)
    expect(
      createViewSim(sim)
        .laneStats()
        .byStrain.map((x) => x.strain),
    ).toEqual(['metal', 'rattle', 'battery'])
    const delay = data.parcels.malware.newStrainDelayS * TICKS_PER_S
    expect(delay).toBe(600)
    runTicks(sim, delay - 1)
    expect(availableStrains(sim)).not.toContain('battery')
    runTicks(sim, 1)
    expect(availableStrains(sim)).toContain('battery')
    expect(
      log.filter(
        (e) =>
          e.name === 'ticker:news' &&
          (e.p as { text: string }).text === strainSpottedText('battery'),
      ),
    ).toEqual([
      {
        tick: at + delay,
        name: 'ticker:news',
        p: { text: strainSpottedText('battery'), kind: 'strain' },
      },
    ])
    // L3 purchases: the Battery checker and dock 2; dock 3 waits for L4.
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'battery_checker',
        nodeId: 'slot2',
      }),
    ).toEqual({ ok: true })
    expect(sim.dispatch({ kind: 'buyDock', index: 2 })).toEqual({ ok: true })
    expect(sim.dispatch({ kind: 'buyDock', index: 3 })).toEqual({
      ok: false,
      reason: 'locked',
    })
    expect(s.lane.docks.map((d) => d.id)).toEqual(['dock1', 'dock2'])
    expect(auditState(s, data)).toEqual([])
  })

  it('debug.forceLevel(3) applies the same row (past a cap-2 config)', () => {
    const sim = quietSim(2, CAP2)
    const res = createViewSim(sim, { debug: true }).debug!.forceLevel(3)
    expect(res).toEqual({ ok: true })
    expect(sim.state.level).toMatchObject({
      level: 3,
      holdBayCap: 5,
      shelfCap: 60,
      warehouseTier: 3,
    })
    expect(sim.state.districts.docks!.live).toBe(true)
    // Forcing is not income: lifetime earned stays the money the game paid
    // (stats.income === lifetimeEarned; the minute rows and the profile).
    expect(sim.state.economy.lifetimeEarned).toBe(0)
    expect(sim.state.stats.income).toBe(sim.state.economy.lifetimeEarned)
  })

  it('debug.forceLevel(5) (the tycoon recipe) books no income: the first minute row earns what was paid, not the L5 threshold', () => {
    const sim = quietSim(2)
    const vs = createViewSim(sim, { debug: true })
    expect(vs.debug!.forceLevel(5)).toEqual({ ok: true })
    expect(sim.state.economy.lifetimeEarned).toBe(0)
    for (let i = 0; i < 600; i++) sim.tick()
    const row = sim.state.stats.minutes[0]!
    expect(row.earned).toBe(sim.state.stats.income)
    expect(row.earned).toBeLessThan(L5.threshold)
  })
})

/** A quiet funded game levelled to `level` the levels.json way (lifetime earned → the levels step, never debug), the new districts quiet again. */
function reached(level: number, seed = 1): Sim {
  const sim = fund(quietSim(seed))
  const row = data.levels.find((l) => l.level === level)!
  sim.state.economy.lifetimeEarned = row.threshold
  runTicks(sim, 1)
  expect(sim.state.level.level).toBe(level)
  return quiet(sim)
}

/** [name, payload] of the level-up moment's events in `log`. */
function levelMoment(log: { name: string; p: unknown }[]): [string, unknown][] {
  return log
    .filter((e) =>
      ['level:up', 'ticker:news', 'region:unlocked'].includes(e.name),
    )
    .map((e) => [e.name, e.p])
}

describe('L4 "National" unlocks (spec-build2 §4.2; design-m8-m9 §4.5, §7 M9 1)', () => {
  it('the L4 row applies at the real threshold: Low-density + Rural live with their first spawn firstSpawnDelayS later, slot 5 open, Hold Bay 5, shelf 80, tier 4; level:up → ticker → region:unlocked ×2; dense announced now, spawnable newStrainDelayS later', () => {
    const sim = reached(3)
    // Below L4: the X-ray, the Sorter Arm, slot 5 and dock 3 are locked.
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: 'xray', nodeId: 'slot2' }),
    ).toEqual({ ok: false, reason: 'locked' })
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: 'sorter_arm', nodeId: 'hold' }),
    ).toEqual({ ok: false, reason: 'locked' })
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'metal_detector',
        nodeId: 'slot5',
      }),
    ).toEqual({ ok: false, reason: 'slot-locked' })
    expect(sim.dispatch({ kind: 'buyDock', index: 3 })).toEqual({
      ok: false,
      reason: 'locked',
    })
    const log = eventLog(sim)
    sim.state.economy.lifetimeEarned = L4.threshold
    runTicks(sim, 1)
    const at = sim.state.tick
    const s = sim.state
    expect(L4).toMatchObject({
      slots: 5,
      holdBayCap: 5,
      shelfCap: 80,
      warehouseTier: 4,
      strain: 'dense',
      unlockRegions: ['lowres', 'rural'],
      machines: ['xray', 'sorter_arm'],
    })
    expect(s.level).toMatchObject({
      level: 4,
      slots: 5,
      holdBayCap: 5,
      shelfCap: 80,
      warehouseTier: 4,
      nextThreshold: L5.threshold,
    })
    expect(s.stats.levelTick['4']).toBe(at)
    expect(liveSlotIds(s.lane)).toEqual([
      'slot1',
      'slot2',
      'slot3',
      'slot4',
      'slot5',
    ])
    expect(laneNode(s.lane, 'slot5')!.locked).toBeUndefined()
    expect(laneNode(s.lane, 'slot6')!.locked).toEqual({ level: 5 })
    expect(laneNode(s.lane, 'shelf')!.cap).toBe(80)
    expect(laneNode(s.lane, 'hold')!.cap).toBe(5)
    expect(createViewSim(sim).shelf.cap).toBe(80)
    const firstSpawn = data.parcels.spawn.firstSpawnDelayS * TICKS_PER_S
    for (const id of ['lowres', 'rural']) {
      expect(s.districts[id], id).toMatchObject({
        live: true,
        satisfaction: data.economy.satisfaction.start,
        nextSpawnTick: at + firstSpawn,
      })
      expect(createViewSim(sim).regionState(id)).toBe('live')
    }
    expect(s.level.unlocked).toEqual([
      'highres',
      'downtown',
      'industrial',
      'docks',
      'lowres',
      'rural',
    ])
    expect(s.districts.airport!.live).toBe(false)
    expect(s.districts.civic!.live).toBe(false)
    expect(levelMoment(log)).toEqual([
      ['level:up', { level: 4 }],
      ['ticker:news', { text: L4.ticker, kind: 'level' }],
      ['region:unlocked', { district: 'lowres' }],
      ['region:unlocked', { district: 'rural' }],
    ])
    // dense: announced at the level-up (Detection % counts it at once),
    // drawn newStrainDelayS later with its "New strain spotted" line.
    expect(s.level.announced.dense).toBe(at)
    expect(
      createViewSim(sim)
        .laneStats()
        .byStrain.map((x) => x.strain),
    ).toEqual(['metal', 'rattle', 'battery', 'dense'])
    const delay = data.parcels.malware.newStrainDelayS * TICKS_PER_S
    runTicks(sim, delay - 1)
    expect(availableStrains(sim)).not.toContain('dense')
    runTicks(sim, 1)
    expect(availableStrains(sim)).toEqual([
      'metal',
      'rattle',
      'battery',
      'dense',
    ])
    expect(
      log.filter(
        (e) =>
          e.name === 'ticker:news' &&
          (e.p as { text: string }).text === strainSpottedText('dense'),
      ),
    ).toEqual([
      {
        tick: at + delay,
        name: 'ticker:news',
        p: { text: strainSpottedText('dense'), kind: 'strain' },
      },
    ])
    expect(auditState(s, data)).toEqual([])
  })

  it('dense malware spawns only from announced + newStrainDelayS, every one with a typosquat label (puns.malwareLabels.dense; the strain row says flavour "typosquat")', () => {
    const sim = makeSim(9, {
      parcels: {
        malware: { baseShare: 0.6, cap: 1, graceS: 0, graceCount: 0 },
      },
    })
    const dense = sim.data.parcels.malware.strains.find((x) => x.id === 'dense')
    expect(dense).toMatchObject({
      level: 4,
      counter: 'xray',
      flavour: 'typosquat',
    })
    const labels = sim.data.puns.malwareLabels.dense
    // Typosquats: lookalikes of clean package names, never a clean label.
    expect(labels).toEqual(['lodahs', 'expresss', 'mongose', 'reqeusts'])
    for (const l of labels) expect(sim.data.puns.cleanLabels).not.toContain(l)
    const malware: Parcel[] = []
    sim.addTap((name, p) => {
      if (name !== 'parcel:spawned') return
      const parcel = sim.state.parcels[String((p as { id: number }).id)]
      if (parcel?.malware) malware.push(structuredClone(parcel))
    })
    sim.state.economy.lifetimeEarned = L4.threshold
    runTicks(sim, 1)
    expect(sim.state.level.level).toBe(4)
    const at = sim.state.tick
    const delay = sim.data.parcels.malware.newStrainDelayS * TICKS_PER_S
    // Keep the buildings from filling up (no fleet): drop what waits.
    for (let t = 0; t < delay + 8 * 600; t++) {
      sim.tick()
      for (const b of Object.values(sim.state.buildings)) {
        for (const id of b.waiting) delete sim.state.parcels[String(id)]
        b.waiting = []
      }
    }
    const denseOnes = malware.filter((p) => p.strain === 'dense')
    expect(denseOnes.length).toBeGreaterThan(10)
    expect(denseOnes.every((p) => p.spawnedTick >= at + delay)).toBe(true)
    expect(denseOnes.every((p) => labels.includes(p.label))).toBe(true)
    expect(new Set(denseOnes.map((p) => p.label)).size).toBe(labels.length)
    expect(
      malware
        .filter((p) => p.spawnedTick < at + delay)
        .some((p) => p.strain === 'dense'),
    ).toBe(false)
  })

  it('L4 purchases: the X-ray into slot 5, the Sorter Arm into the Hold Bay station ($600), dock 3 for $1,000 before dock 2 (lane.docks [dock1, dock3])', () => {
    const sim = reached(4, 2)
    const s = sim.state
    const xray = data.machines.checkers.find((c) => c.id === 'xray')!
    const arm = data.machines.upgrades.find((u) => u.id === 'sorter_arm')!
    const dock3 = data.economy.docks.find((d) => d.index === 3)!
    expect([xray.unlockLevel, arm.unlockLevel, dock3.unlockLevel]).toEqual([
      4, 4, 4,
    ])
    expect(dock3.price).toBe(1000)
    let balance = s.economy.balance
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: 'xray', nodeId: 'slot5' }),
    ).toEqual({ ok: true })
    expect(laneNode(s.lane, 'slot5')!.fixture).toMatchObject({
      kind: 'machine',
      checker: { defId: 'xray' },
    })
    expect(s.economy.balance).toBe(balance - xray.price)
    balance = s.economy.balance
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: 'sorter_arm', nodeId: 'hold' }),
    ).toEqual({ ok: true })
    expect(s.lane.holdStation.fixture).toBe('sorter_arm')
    expect(s.economy.balance).toBe(balance - arm.price)
    balance = s.economy.balance
    const bought = collect(sim, 'dock:bought')
    expect(sim.dispatch({ kind: 'buyDock', index: 3 })).toEqual({ ok: true })
    expect(bought).toEqual([{ index: 3, dockId: 'dock3' }])
    expect(s.economy.balance).toBe(balance - dock3.price)
    expect(s.lane.docks.map((d) => d.id)).toEqual(['dock1', 'dock3'])
    expect(auditState(s, data)).toEqual([])
  })
})

describe('L5 "Tycoon" unlocks (spec-build2 §4.3, §3.4; design-m8-m9 §4.5, §7 M9 1)', () => {
  it('the L5 row applies at the real threshold: Airport live without a spawn timer + Park & civic with one, slot 6, Hold Bay 5, shelf 100, tier 5, no strain, nextThreshold null; level:up → ticker → region:unlocked ×2 → the Golden Release offered the same tick', () => {
    const sim = noOffers(reached(4, 3))
    const announced = structuredClone(sim.state.level.announced)
    const log = eventLog(sim)
    sim.state.economy.lifetimeEarned = L5.threshold
    runTicks(sim, 1)
    const at = sim.state.tick
    const s = sim.state
    expect(L5).toMatchObject({
      slots: 6,
      holdBayCap: 5,
      shelfCap: 100,
      warehouseTier: 5,
      strain: null,
      unlockRegions: ['airport', 'civic'],
    })
    expect(s.level).toMatchObject({
      level: 5,
      slots: 6,
      holdBayCap: 5,
      shelfCap: 100,
      warehouseTier: 5,
      nextThreshold: null,
    })
    expect(s.stats.levelTick['5']).toBe(at)
    expect(liveSlotIds(s.lane)).toEqual([
      'slot1',
      'slot2',
      'slot3',
      'slot4',
      'slot5',
      'slot6',
    ])
    expect(s.lane.nodes.some((n) => n.locked)).toBe(false)
    expect(laneNode(s.lane, 'shelf')!.cap).toBe(100)
    expect(laneNode(s.lane, 'hold')!.cap).toBe(5)
    expect(s.districts.airport).toMatchObject({
      live: true,
      nextSpawnTick: null,
    })
    expect(s.districts.civic).toMatchObject({
      live: true,
      satisfaction: data.economy.satisfaction.start,
      nextSpawnTick: at + data.parcels.spawn.firstSpawnDelayS * TICKS_PER_S,
    })
    expect(s.level.unlocked).toEqual(data.districts.map((d) => d.id))
    expect(s.level.announced).toEqual(announced) // L5 brings no strain
    const vs = createViewSim(sim)
    expect(vs.regionState('airport')).toBe('live')
    expect(vs.regionState('civic')).toBe('live')
    expect(vs.hub('airport')).toMatchObject({
      live: true,
      office: 'ap_terminal',
      clearanceS: 20,
      valueMult: 2,
      sizes: ['S', 'M'],
      clearing: [],
    })
    expect(vs.nextThreshold).toBeNull()
    expect(levelMoment(log).slice(0, 4)).toEqual([
      ['level:up', { level: 5 }],
      ['ticker:news', { text: L5.ticker, kind: 'level' }],
      ['region:unlocked', { district: 'airport' }],
      ['region:unlocked', { district: 'civic' }],
    ])
    const offered = log.filter((e) => e.name === 'quest:offered')
    expect(offered).toHaveLength(1)
    expect(offered[0]).toMatchObject({
      tick: at,
      p: { templateId: 'golden_release', ultimate: true, target: null },
    })
    const names = log.map((e) => e.name)
    expect(names.indexOf('quest:offered')).toBeGreaterThan(
      names.lastIndexOf('region:unlocked'),
    )
    expect(s.quests.offer).toMatchObject({
      templateId: 'golden_release',
      ultimate: true,
      expiresTick: null,
    })
    // No level past the top: lifetime keeps counting, nothing fires.
    s.economy.lifetimeEarned = 1_000_000
    runTicks(sim, 600)
    expect(log.filter((e) => e.name === 'level:up')).toHaveLength(1)
    expect(auditState(s, data)).toEqual([])
  })
})
