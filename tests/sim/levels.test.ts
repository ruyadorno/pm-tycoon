// spec §8 company levels (+ §3.5 region unlock, §5.4 strain announcement,
// §6.2 lane growth; plan.md §12.6 tasks 1 + 11): lifetime earned vs the
// levels.json thresholds → `level:up` the tick the threshold is crossed; the
// playtest cap (economy.playtestMaxLevel = 2: no `level:up {3}`, the bar keeps
// counting toward the L3 threshold); the L2 unlocks (Industrial live at
// satisfaction 60 with its first spawn firstSpawnDelayS later, the truck,
// the Shaky shaker, slot 4, shelf 45, tier 2, the ticker line) and rattle,
// announced at the level-up and drawn only newStrainDelayS later.

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
  quietSim,
  runTicks,
  runUntil,
  shelveParcel,
} from './helpers.ts'

const data = dataFixture()
const L2 = data.levels.find((l) => l.level === 2)!
const L3 = data.levels.find((l) => l.level === 3)!
const cap = data.economy.playtestMaxLevel

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

  it('no level:up past playtestMaxLevel: lifetime far past the L3-L5 thresholds levels up to 2 only', () => {
    expect(cap).toBe(2)
    const sim = quietSim(1)
    const ups = collect(sim, 'level:up')
    sim.state.economy.lifetimeEarned = 100_000
    runTicks(sim, 600 * 3)
    expect(ups).toEqual([{ level: 2 }])
    expect(sim.state.level.level).toBe(cap)
    expect(Object.keys(sim.state.stats.levelTick).toSorted()).toEqual([
      '1',
      '2',
    ])
    // the L3 row's unlocks never apply
    expect(sim.state.districts.docks!.live).toBe(false)
    expect(sim.state.level.holdBayCap).toBe(L2.holdBayCap)
    expect(sim.state.level.announced.battery).toBeUndefined()
  })

  it('a 30-minute competent run (seeds 1-3) never fires level:up {3}', () => {
    for (const seed of [1, 2, 3]) {
      const sim = makeSim(seed)
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

  it('nextThreshold stays $5,000 at the cap (the HUD bar keeps counting toward the L3 row)', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    expect(vs.nextThreshold).toBe(L2.threshold)
    sim.state.economy.lifetimeEarned = L2.threshold
    runTicks(sim, 1)
    expect(vs.level).toBe(2)
    expect(vs.nextThreshold).toBe(L3.threshold)
    expect(L3.threshold).toBe(5000)
    sim.state.economy.lifetimeEarned = 40_000
    runTicks(sim, 600)
    expect(vs.level).toBe(2)
    expect(vs.nextThreshold).toBe(5000)
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
})
