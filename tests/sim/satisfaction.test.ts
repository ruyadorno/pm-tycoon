// spec §9.1-§9.4 satisfaction: every delta (on time +2, favoured +1,
// favoured pickup +1, late −3, waiting 180 s −2, malware −20), the +4 / day
// positive cap and the −6 / day waiting cap, drift 1 / day toward 50, the
// trend arrow, m(s) at 0 / 50 / 100, the HUD mean of live districts.

import { describe, expect, it } from 'vitest'
import type { Sim } from '../../src/sim/sim.ts'
import {
  busiestDistrict,
  changeSatisfaction,
  liveSpawningDistricts,
  lowestDistrict,
  spawnMultiplier,
  waitingInDistrict,
} from '../../src/sim/systems/satisfaction.ts'
import { meanSatisfaction, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  buy,
  collect,
  dataFixture,
  injectParcel,
  noCheckers,
  quietSim,
  runTicks,
  runUntil,
  unlockDistrict,
} from './helpers.ts'

const data = dataFixture()
const c = data.economy.satisfaction
const sat = (sim: Sim, id: string): number =>
  sim.state.districts[id]?.satisfaction ?? Number.NaN

/** Bike delivers one injected parcel; returns the satisfaction events. */
function deliverOne(
  origin: string,
  dest: string,
  opts: Parameters<typeof injectParcel>[3] = {},
) {
  const sim = quietSim(1)
  if (opts.malware) noCheckers(sim) // nothing in the lane to catch it
  sim.state.tick = 100 // inside day 1, clear of the boundary
  buy(sim, 'bike')
  const p = injectParcel(sim, origin, dest, opts)
  const events = collect(sim, 'satisfaction:changed')
  const delivered = collect(sim, 'parcel:delivered')
  const n = runUntil(sim, () => delivered.length > 0, 3000)
  expect(n).toBeGreaterThan(0)
  expect(sim.state.tick).toBeLessThan(TICKS_PER_DAY) // no drift involved
  return { sim, p, events, delivered: delivered[0]! }
}

describe('satisfaction deltas (spec §9.1)', () => {
  it('on-time delivery +2 to the destination; a bike picking up in Node Heights (favours bike) +1 to the origin', () => {
    const { events, delivered } = deliverOne('hr_towers_a', 'dt_registry_tower')
    expect(delivered.onTime).toBe(true)
    expect(events).toEqual([
      {
        district: 'highres',
        value: c.start + c.favouredPickup,
        delta: c.favouredPickup,
      },
      { district: 'downtown', value: c.start + c.onTime, delta: c.onTime },
    ])
  })

  it('on time by the favoured vehicle: +2 +1 (a bike delivering in Node Heights)', () => {
    const { events } = deliverOne('dt_registry_tower', 'hr_towers_a')
    expect(events).toEqual([
      {
        district: 'highres',
        value: c.start + c.onTime + c.favouredBonus,
        delta: c.onTime + c.favouredBonus,
      },
    ])
  })

  it('late delivery (t > 160 s) −3 to the destination; no positive', () => {
    const { events, delivered } = deliverOne(
      'dt_registry_tower',
      'dt_cache_cafe',
      {
        spawnedTick: -1700,
      },
    )
    expect(delivered.onTime).toBe(false)
    expect(events).toEqual([
      { district: 'downtown', value: c.start + c.late, delta: c.late },
    ])
  })

  it('malware delivered: paid $0 and −20 to the destination district', () => {
    const { events, delivered } = deliverOne(
      'dt_registry_tower',
      'dt_cache_cafe',
      {
        malware: true,
      },
    )
    expect(delivered).toMatchObject({ paid: 0, malware: true })
    expect(events).toEqual([
      {
        district: 'downtown',
        value: c.start + c.malwareDelivered,
        delta: c.malwareDelivered,
      },
    ])
  })

  it('a waiting parcel crossing 180 s unpicked: −2 to its origin, capped at −6 per district per day', () => {
    const sim = quietSim(1)
    const ids = ['hr_towers_a', 'hr_towers_b', 'hr_async_arms', 'hr_daycare']
    for (const id of ids)
      injectParcel(sim, id, 'dt_cache_cafe', { spawnedTick: 100 })
    const crossAt = 100 + data.economy.satisfaction.waitingPenaltyAfterS * 10
    runTicks(sim, crossAt - 1)
    const before = sat(sim, 'highres')
    const events = collect(sim, 'satisfaction:changed')
    runTicks(sim, 1)
    expect(events.map((e) => e.delta)).toEqual([
      c.waitingOver180s,
      c.waitingOver180s,
      c.waitingOver180s,
    ])
    expect(sat(sim, 'highres')).toBe(before + c.waitingPenaltyCapPerDay)
    runTicks(sim, 600)
    expect(events.filter((e) => e.delta === c.waitingOver180s)).toHaveLength(3)
  })

  it('positive deltas are capped at +4 per district per day; the cap resets on the day boundary', () => {
    const sim = quietSim(1)
    expect(changeSatisfaction(sim, 'downtown', c.onTime, 'positive')).toBe(2)
    expect(changeSatisfaction(sim, 'downtown', c.onTime + 1, 'positive')).toBe(
      2,
    )
    expect(changeSatisfaction(sim, 'downtown', c.onTime, 'positive')).toBe(0)
    expect(sat(sim, 'downtown')).toBe(c.start + c.positiveCapPerDay)
    expect(changeSatisfaction(sim, 'downtown', c.late, 'other')).toBe(c.late)
    runTicks(sim, TICKS_PER_DAY)
    expect(sim.state.districts.downtown?.dayPositive).toBe(0)
    expect(changeSatisfaction(sim, 'downtown', c.onTime, 'positive')).toBe(2)
  })

  it('satisfaction is clamped to 0-100 and hubs / locked districts never change', () => {
    const sim = quietSim(1)
    changeSatisfaction(sim, 'downtown', -500, 'other')
    expect(sat(sim, 'downtown')).toBe(c.min)
    changeSatisfaction(sim, 'downtown', 500, 'other')
    expect(sat(sim, 'downtown')).toBe(c.max)
    expect(changeSatisfaction(sim, 'industrial', -20, 'other')).toBe(0)
    expect(changeSatisfaction(sim, 'docks', -20, 'other')).toBe(0)
  })
})

describe('drift, trend, m(s), mean (spec §9.1-§9.4)', () => {
  it('drift: 1 point per in-game day toward 50 (above, below, at 50)', () => {
    const sim = quietSim(1)
    sim.state.districts.highres!.satisfaction = 60
    sim.state.districts.downtown!.satisfaction = 40
    runTicks(sim, TICKS_PER_DAY)
    expect(sat(sim, 'highres')).toBe(60 - c.driftStep)
    expect(sat(sim, 'downtown')).toBe(40 + c.driftStep)
    sim.state.districts.highres!.satisfaction = 50
    runTicks(sim, TICKS_PER_DAY)
    expect(sat(sim, 'highres')).toBe(50)
  })

  it('trend arrow = Δ over the day: ▲ at ≥ +3, ▼ at ≤ −3, ▬ otherwise', () => {
    const sim = quietSim(1)
    const view = createViewSim(sim)
    expect(view.districtStats('downtown')?.trend).toBe('flat')
    changeSatisfaction(sim, 'downtown', 3, 'other')
    expect(view.districtStats('downtown')).toMatchObject({
      trend: 'up',
      trendDelta: 3,
    })
    changeSatisfaction(sim, 'downtown', -5, 'other')
    expect(view.districtStats('downtown')?.trend).toBe('flat')
    changeSatisfaction(sim, 'downtown', -1, 'other')
    expect(view.districtStats('downtown')).toMatchObject({
      trend: 'down',
      trendDelta: -3,
    })
  })

  it('m(s) = 1.5 at 0, 1.0 at 50, 0.6 at 100 (linear between)', () => {
    const sim = quietSim(1)
    expect(spawnMultiplier(sim, 0)).toBeCloseTo(1.5, 10)
    expect(spawnMultiplier(sim, 25)).toBeCloseTo(1.25, 10)
    expect(spawnMultiplier(sim, 50)).toBeCloseTo(1.0, 10)
    expect(spawnMultiplier(sim, 75)).toBeCloseTo(0.8, 10)
    expect(spawnMultiplier(sim, 100)).toBeCloseTo(0.6, 10)
  })

  it('HUD mood = rounded mean of live districts only', () => {
    const sim = quietSim(1)
    sim.state.districts.highres!.satisfaction = 71
    sim.state.districts.downtown!.satisfaction = 40
    sim.state.districts.industrial!.satisfaction = 0 // locked: ignored
    expect(meanSatisfaction(sim.state, data)).toBe(56)
    expect(createViewSim(sim).meanSatisfaction()).toBe(56)
  })
})

describe('build 3 event targets (B3 §3.5: pure reads, no draw)', () => {
  it('live spawning districts in file order (never a hub); busiest by waiting parcels, ties and none → file order; lowest by satisfaction', () => {
    const sim = quietSim(1)
    expect(liveSpawningDistricts(sim)).toEqual(['highres', 'downtown'])
    unlockDistrict(sim, 'docks') // a hub never counts
    unlockDistrict(sim, 'industrial')
    expect(liveSpawningDistricts(sim)).toEqual([
      'highres',
      'downtown',
      'industrial',
    ])
    expect(busiestDistrict(sim)).toBe('highres') // nothing waiting: the first
    injectParcel(sim, 'dt_cache_cafe', 'hr_towers_a')
    expect(waitingInDistrict(sim, 'downtown')).toBe(1)
    expect(busiestDistrict(sim)).toBe('downtown')
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(busiestDistrict(sim)).toBe('highres') // a tie: file order
    const d = sim.state.districts
    expect(lowestDistrict(sim)).toBe('highres') // all equal: file order
    d.industrial!.satisfaction = 40
    d.downtown!.satisfaction = 40
    expect(lowestDistrict(sim)).toBe('downtown')
    d.docks!.satisfaction = 0 // hubs have no satisfaction
    expect(lowestDistrict(sim)).toBe('downtown')
  })
})
