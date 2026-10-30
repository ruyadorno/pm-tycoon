// M9 endless mode after Victory (spec-build2 §3.4; design-m8-m9 §2.1, §4.7,
// R17, §7 M9 5): the two escalation rules of malwareShare (M7 §2.2, the only
// definition — verified here, not redefined): with the shipped cap at the
// last level (B2 §9: playtestMaxLevel 5) reaching it never escalates, only
// Victory does — + parcels.malware.postVictoryPerDay from the first day
// boundary after stats.victoryTick, capped at malware.cap, overseas ×
// overseasMult capped; a cap below the last level (M8's 3) keeps the cap
// rule; a debug Victory below the cap escalates from victoryTick (M7's
// precedence). The sim-owned endless ticker line (puns.tickerQuest.endless,
// kind 'level') fires once, at that first boundary, across a save / load;
// the quest scheduler keeps offering regular templates, never the Golden
// Release again.

import { describe, expect, it } from 'vitest'
import { Sim } from '../../src/sim/sim.ts'
import {
  endlessFirstDay,
  malwareShare,
  TICKS_PER_DAY,
} from '../../src/sim/types.ts'
import {
  acceptOffer,
  collect,
  dataFixture,
  eventLog,
  injectParcel,
  noOffers,
  quiet,
  quietSim,
  runTicks,
  startQuest,
} from './helpers.ts'

const DAY = TICKS_PER_DAY
const data = dataFixture()
const m = data.parcels.malware
const L5 = data.levels.find((l) => l.level === 5)!
const u = L5.ultimateQuest!
/** M8's cap: below the last level, so the cap rule escalates (design R1, R17). */
const CAP3 = { economy: { playtestMaxLevel: 3 } }
const ENDLESS = data.puns.tickerQuest.endless

/** The share at `level` before any escalation. */
const levelShare = (level: number): number =>
  m.baseShare + m.perLevel * (level - 1)

/** A quiet game at L5 the levels.json way (lifetime earned, the shipped cap), the Golden Release offered. */
function atL5(seed: number): Sim {
  const sim = noOffers(quietSim(seed))
  sim.state.economy.lifetimeEarned = L5.threshold
  runTicks(sim, 1)
  expect(sim.state.level.level).toBe(5)
  expect(sim.state.quests.offer?.templateId).toBe(u.id)
  return quiet(sim)
}

/** Complete the active Golden Release now (its deliveries, all on time — scripted events); returns stats.victoryTick. */
function winNow(sim: Sim): number {
  expect(sim.state.quests.active?.templateId).toBe(u.id)
  for (let i = 0; i < u.deliveries; i++) {
    const p = injectParcel(
      sim,
      i % 2 ? 'hr_towers_a' : 'dt_registry_tower',
      i % 2 ? 'dt_cache_cafe' : 'hr_towers_b',
    )
    sim.emit('parcel:delivered', {
      id: p.id,
      paid: 20,
      onTime: true,
      malware: false,
    })
  }
  runTicks(sim, 1)
  expect(sim.state.economy.victory).toBe(true)
  expect(sim.state.stats.victoryTick).toBe(sim.state.tick)
  return sim.state.tick
}

const share = (sim: Sim, overseas = false): number =>
  malwareShare(sim.state, sim.data, overseas)

describe('no escalation at the top level before Victory (B2 §9: the cap is the last row)', () => {
  it('at L5 the share stays baseShare + 4 × perLevel (overseas × overseasMult, capped) for ten days; no endless line', () => {
    expect(data.economy.playtestMaxLevel).toBe(
      Math.max(...data.levels.map((l) => l.level)),
    )
    const sim = atL5(1)
    const news = collect(sim, 'ticker:news')
    const l5 = levelShare(5)
    expect(share(sim)).toBeCloseTo(l5, 10)
    runTicks(sim, 10 * DAY)
    expect(sim.state.economy.victory).toBe(false)
    expect(endlessFirstDay(sim.state)).toBeNull()
    expect(share(sim)).toBeCloseTo(l5, 10)
    expect(share(sim, true)).toBeCloseTo(
      Math.min(m.cap, l5 * m.overseasMult),
      10,
    )
    const rows = sim.state.stats.minutes
    expect(rows).toHaveLength(10)
    for (const r of rows) expect(r.malShare).toBeCloseTo(l5, 10)
    expect(news.some((n) => n.text === ENDLESS)).toBe(false)
  })
})

describe('escalation from Victory (B2 §3.4 "from the next day boundary")', () => {
  it('unchanged until the first boundary after stats.victoryTick, then + postVictoryPerDay per boundary up to malware.cap; overseas = min(cap, share × overseasMult); the MinuteRow malShare follows', () => {
    const sim = atL5(2)
    acceptOffer(sim)
    runTicks(sim, DAY + 200) // Victory mid-day 1
    const vt = winNow(sim)
    const l5 = levelShare(5)
    const firstDay = Math.floor(vt / DAY) + 1
    expect(endlessFirstDay(sim.state)).toBe(firstDay)
    expect(share(sim)).toBeCloseTo(l5, 10) // the victory tick itself
    runTicks(sim, firstDay * DAY - sim.state.tick - 1)
    expect(share(sim)).toBeCloseTo(l5, 10)
    runTicks(sim, 1)
    expect(sim.state.tick).toBe(firstDay * DAY)
    expect(share(sim)).toBeCloseTo(l5 + m.postVictoryPerDay, 10)
    const days = Math.ceil((m.cap - l5) / m.postVictoryPerDay) + 3
    for (let k = 2; k <= days; k++) {
      runTicks(sim, DAY)
      const want = Math.min(m.cap, l5 + k * m.postVictoryPerDay)
      expect(share(sim), `boundary ${k}`).toBeCloseTo(want, 10)
      expect(share(sim, true), `boundary ${k}`).toBeCloseTo(
        Math.min(m.cap, want * m.overseasMult),
        10,
      )
    }
    expect(share(sim)).toBe(m.cap)
    expect(share(sim, true)).toBe(m.cap)
    // The day rows: flat through the victory day, then climbing, then flat at the cap.
    const rows = sim.state.stats.minutes.map((r) => r.malShare)
    rows.forEach((x, i) => {
      const day = i + 1 // the row of the boundary that closed day i
      const k = Math.max(0, day - firstDay + 1)
      expect(x, `row ${i}`).toBeCloseTo(
        Math.min(m.cap, l5 + k * m.postVictoryPerDay),
        10,
      )
    })
  }, 30_000)

  it('the endless ticker line (puns.tickerQuest.endless, kind level) fires once at that first boundary — not on the victory tick, never again — and a save / load before it still fires it exactly once', () => {
    expect(ENDLESS).toBe('Endless mode — the malware keeps evolving')
    const sim = atL5(3)
    acceptOffer(sim)
    runTicks(sim, 300)
    const log = eventLog(sim)
    const vt = winNow(sim)
    const first = (Math.floor(vt / DAY) + 1) * DAY
    expect(
      log.filter(
        (e) =>
          e.name === 'ticker:news' &&
          (e.p as { text: string }).text === ENDLESS,
      ),
    ).toEqual([])
    runTicks(sim, first - sim.state.tick - 5)
    const loaded = Sim.load(
      sim.data,
      JSON.parse(JSON.stringify(sim.snapshot())),
    )
    const logLoaded = eventLog(loaded)
    runTicks(sim, 4 * DAY)
    runTicks(loaded, 4 * DAY)
    const endless = (l: { tick: number; name: string; p: unknown }[]) =>
      l.filter(
        (e) =>
          e.name === 'ticker:news' &&
          (e.p as { text: string }).text === ENDLESS,
      )
    const want = [
      {
        tick: first,
        name: 'ticker:news',
        p: { text: ENDLESS, kind: 'level' },
      },
    ]
    expect(endless(log)).toEqual(want)
    expect(endless(logLoaded)).toEqual(want)
    // A game saved after the line does not repeat it.
    const later = Sim.load(sim.data, JSON.parse(JSON.stringify(sim.snapshot())))
    const news = collect(later, 'ticker:news')
    runTicks(later, 3 * DAY)
    expect(news.some((n) => n.text === ENDLESS)).toBe(false)
  }, 30_000)

  it('quests continue after Victory: a regular template intervalDays later, never the Golden Release again', () => {
    const sim = atL5(4)
    sim.state.quests.nextOfferTick = 0 // the regular scheduler live
    acceptOffer(sim)
    const offered = collect(sim, 'quest:offered')
    const vt = winNow(sim)
    const interval = sim.data.quests.offer.intervalDays * DAY
    runTicks(sim, interval)
    expect(sim.state.tick).toBe(vt + interval)
    expect(offered).toHaveLength(1)
    expect(offered[0]?.ultimate).toBe(false)
    // Decline every regular offer for ten days: still never the ultimate.
    for (let d = 0; d < 10 * DAY; d++) {
      const o = sim.state.quests.offer
      if (o && !o.ultimate) {
        sim.dispatch({ kind: 'declineQuest', questId: o.id })
      }
      sim.tick()
    }
    expect(offered.length).toBeGreaterThan(2)
    expect(offered.some((o) => o.ultimate || o.templateId === u.id)).toBe(false)
  }, 30_000)
})

describe('the cap rule and its precedence (design R17; M7 §2.2)', () => {
  it('a cap below the last level (M8: 3) keeps the cap rule: + postVictoryPerDay from the first boundary after the L3 tick', () => {
    const sim = noOffers(quietSim(5, CAP3))
    sim.state.economy.lifetimeEarned = 100_000
    runTicks(sim, 1)
    quiet(sim)
    expect(sim.state.level.level).toBe(3)
    const l3 = levelShare(3)
    expect(share(sim)).toBeCloseTo(l3, 10)
    runTicks(sim, DAY - sim.state.tick - 1)
    expect(share(sim)).toBeCloseTo(l3, 10)
    runTicks(sim, 1)
    expect(share(sim)).toBeCloseTo(l3 + m.postVictoryPerDay, 10)
    runTicks(sim, 5 * DAY)
    expect(share(sim)).toBeCloseTo(l3 + 6 * m.postVictoryPerDay, 10)
    expect(share(sim, true)).toBeCloseTo(
      Math.min(m.cap, (l3 + 6 * m.postVictoryPerDay) * m.overseasMult),
      10,
    )
    // No Victory, no endless line.
    expect(endlessFirstDay(sim.state)).toBeNull()
  })

  it('a debug Victory below the cap escalates from stats.victoryTick (Victory first, M7 precedence): nothing before it, + postVictoryPerDay after, overseas × overseasMult below malware.cap', () => {
    const sim = noOffers(quietSim(6, CAP3))
    runTicks(sim, 2 * DAY + 100)
    expect(sim.state.level.level).toBe(1)
    const l1 = levelShare(1)
    expect(share(sim)).toBeCloseTo(l1, 10) // below the cap: no cap escalation
    startQuest(sim, u.id) // debug: any level
    const news = collect(sim, 'ticker:news')
    const vt = winNow(sim)
    expect(Math.floor(vt / DAY)).toBe(2)
    expect(share(sim)).toBeCloseTo(l1, 10)
    runTicks(sim, 3 * DAY - sim.state.tick)
    expect(share(sim)).toBeCloseTo(l1 + m.postVictoryPerDay, 10)
    expect(share(sim, true)).toBeCloseTo(
      (l1 + m.postVictoryPerDay) * m.overseasMult,
      10,
    )
    expect((l1 + m.postVictoryPerDay) * m.overseasMult).toBeLessThan(m.cap)
    runTicks(sim, 2 * DAY)
    expect(share(sim)).toBeCloseTo(l1 + 3 * m.postVictoryPerDay, 10)
    expect(news.filter((n) => n.text === ENDLESS)).toEqual([
      { text: ENDLESS, kind: 'level' },
    ])
  })
})
