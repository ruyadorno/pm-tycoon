// M7 the Golden Release and Victory (spec-build2 §3.4; plan-build2 §8.4;
// design-m7 §2.2, §3.4, Q13, Q15, Q16): offered on level:up {5} the same
// tick (forced here with playtestMaxLevel 5 and a funded lifetime), it
// withdraws an open regular offer, waits while a regular quest is active,
// never expires and cannot be declined; its counters read local deliveries
// and overseas clearances (on-time hand-offs); malware fails it at once and
// it comes back after declineCooldownDays; completion sets economy.victory
// and stats.victoryTick with game:victory last; malware escalates from the
// next day boundary after Victory.

import { describe, expect, it } from 'vitest'
import type { Sim } from '../../src/sim/sim.ts'
import { auditState } from '../../src/sim/sim.ts'
import type { Parcel } from '../../src/sim/types.ts'
import { malwareShare, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  acceptOffer,
  capConfig,
  collect,
  dataFixture,
  eventLog,
  injectParcel,
  noOffers,
  offerQuest,
  quiet,
  quietSim,
  runTicks,
  startQuest,
} from './helpers.ts'

const DAY = TICKS_PER_DAY
const PM5 = capConfig(5)
const u = dataFixture().levels.find((l) => l.ultimateQuest)!.ultimateQuest!

let next = 0
function parcel(sim: Sim, malware = false): Parcel {
  next += 1
  return injectParcel(
    sim,
    next % 2 ? 'hr_towers_a' : 'dt_registry_tower',
    next % 2 ? 'dt_cache_cafe' : 'hr_towers_b',
    { malware },
  )
}

function delivered(sim: Sim, n: number, onTime = true, malware = false): void {
  for (let i = 0; i < n; i++) {
    const p = parcel(sim, malware)
    sim.emit('parcel:delivered', { id: p.id, paid: 20, onTime, malware })
  }
}

function clearedAtHub(
  sim: Sim,
  n: number,
  onTime = true,
  malware = false,
): void {
  for (let i = 0; i < n; i++) {
    const p = parcel(sim, malware)
    sim.emit('parcel:cleared', {
      id: p.id,
      paid: 30,
      malware,
      hub: 'docks',
      buildingId: 'dk_pier_1',
      onTime,
    })
  }
}

/** A quiet game levelled to L5 the levels.json way (lifetime earned), the ultimate offered. */
function atLevel5(seed = 1): Sim {
  const sim = noOffers(quietSim(seed, PM5))
  sim.state.economy.lifetimeEarned = dataFixture(PM5).levels.at(-1)!.threshold
  runTicks(sim, 1)
  quiet(sim)
  return sim
}

describe('the Golden Release offer (B2 §3.4; design Q15)', () => {
  it('ultimateQuest in levels.json L5 is unchanged; the quest card name lives in puns', () => {
    expect(u).toEqual({
      id: 'golden_release',
      days: 5,
      deliveries: 60,
      maxMalwareDelivered: 0,
      minOnTimeRate: 0.9,
    })
    expect(dataFixture().puns.ultimateQuestName).toBe('The Golden Release')
  })

  it('offered on level:up {5} the same tick; an open regular offer is withdrawn (no cooldown); no expiry; Decline is refused', () => {
    const sim = noOffers(quietSim(1, PM5))
    const regular = offerQuest(sim, 'rush_district')
    sim.state.economy.lifetimeEarned = 16_000
    const log = eventLog(sim)
    runTicks(sim, 1)
    quiet(sim)
    expect(sim.state.level.level).toBe(5)
    const names = log.map((e) => e.name)
    const up5 = log.findIndex(
      (e) => e.name === 'level:up' && (e.p as { level: number }).level === 5,
    )
    const withdrawn = names.indexOf('quest:declined')
    const offered = names.indexOf('quest:offered')
    expect(up5).toBeGreaterThanOrEqual(0)
    expect(withdrawn).toBeGreaterThan(up5)
    expect(offered).toBeGreaterThan(withdrawn)
    expect(log[withdrawn]?.p).toEqual({
      questId: regular.id,
      templateId: 'rush_district',
      reason: 'withdrawn',
    })
    expect(log[offered]).toMatchObject({
      tick: 1,
      p: { templateId: 'golden_release', target: null, ultimate: true },
    })
    expect(sim.state.quests.nextOfferTick).toBe(1e12) // no cooldown from the withdrawal
    const q = sim.state.quests.offer!
    expect(q).toMatchObject({
      ultimate: true,
      goal: u.deliveries,
      expiresTick: null,
      reward: { victory: true, cash: 0, lives: 0 },
    })
    runTicks(sim, 3 * DAY)
    expect(sim.state.quests.offer?.id).toBe(q.id) // Later keeps it open
    expect(sim.dispatch({ kind: 'declineQuest', questId: q.id })).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(createViewSim(sim).quests().offer).toMatchObject({
      name: 'The Golden Release',
      flavour: 'Five perfect days — the Golden Release',
      ticksLeft: null,
      limitTicks: 5 * DAY,
      kind: 'ultimate',
    })
  })

  it('waits while a regular quest is active (Accept → quest-active), then accepts once the slot frees; no regular offer meanwhile', () => {
    const sim = noOffers(quietSim(2, PM5))
    startQuest(sim, 'rush_district')
    sim.state.economy.lifetimeEarned = 16_000
    sim.state.quests.nextOfferTick = 0
    runTicks(sim, 1)
    quiet(sim)
    const q = sim.state.quests.offer!
    expect(q.ultimate).toBe(true)
    expect(sim.dispatch({ kind: 'acceptQuest', questId: q.id })).toEqual({
      ok: false,
      reason: 'quest-active',
    })
    sim.dispatch({ kind: 'abandonQuest' })
    runTicks(sim, 2)
    expect(sim.state.quests.offer?.id).toBe(q.id)
    acceptOffer(sim)
    expect(sim.state.quests.active).toMatchObject({
      id: q.id,
      deadlineTick: sim.state.tick + u.days * DAY,
    })
    runTicks(sim, 4 * DAY)
    expect(sim.state.quests.offer).toBeNull() // maxActive 1: nothing else is offered
  })
})

describe('the Golden Release counters (design Q13)', () => {
  it('local deliveries and overseas clearances count, the on-time rate gates completion; Victory: economy.victory, stats.victoryTick, game:victory last', () => {
    const sim = noOffers(quietSim(3))
    const q = startQuest(sim, 'golden_release') // debug: any level
    delivered(sim, 40)
    delivered(sim, 7, false)
    clearedAtHub(sim, 13)
    expect(q.progress).toEqual({
      kind: 'ultimate',
      delivered: 60,
      onTime: 53,
      malware: 0,
    })
    runTicks(sim, 1) // 53/60 < 90 %: not yet
    expect(sim.state.quests.active?.id).toBe(q.id)
    expect(createViewSim(sim).quests().active?.progress01).toBe(1)
    const log = eventLog(sim)
    delivered(sim, 2) // 55/62 = 88.7 %
    runTicks(sim, 1)
    expect(sim.state.quests.active?.id).toBe(q.id)
    delivered(sim, 2) // 57/64 = 89.1 %
    delivered(sim, 6) // 63/70 = 90 %
    runTicks(sim, 1)
    const t = sim.state.tick
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: q.id,
      outcome: 'completed',
      tick: t,
    })
    expect(sim.state.economy.victory).toBe(true)
    expect(sim.state.stats.victoryTick).toBe(t)
    const quest = log.filter((e) => e.tick === t && e.name !== 'quest:progress')
    expect(quest.map((e) => e.name)).toEqual([
      'quest:completed',
      'ticker:news',
      'ticker:news',
      'game:victory',
    ])
    expect(quest[2]?.p).toEqual({
      text: 'The Golden Release ships — Node Heights Courier is a Tycoon!',
      kind: 'level',
    })
    expect(quest[3]?.p).toEqual({ day: sim.state.day })
    const vs = createViewSim(sim)
    expect(vs.victory).toBe(true)
    expect(vs.quests()).toMatchObject({ victory: true, victoryTick: t })
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('malware delivered (or cleared) fails it at once (reason malware); at L5 it is re-offered after declineCooldownDays; never after Victory', () => {
    const sim = atLevel5(4)
    const q = acceptOffer(sim)
    const failed = collect(sim, 'quest:failed')
    const news = collect(sim, 'ticker:news')
    delivered(sim, 5)
    clearedAtHub(sim, 1, true, true)
    expect(q.progress).toMatchObject({ delivered: 5, malware: 1 })
    runTicks(sim, 1)
    const t = sim.state.tick
    expect(failed).toEqual([
      { questId: q.id, templateId: 'golden_release', reason: 'malware' },
    ])
    expect(news).toEqual([
      { text: 'Quest expired: The Golden Release', kind: 'questFailed' },
    ])
    expect(sim.state.quests.ultimateNextTick).toBe(t + DAY)
    runTicks(sim, DAY - 1)
    expect(sim.state.quests.offer).toBeNull()
    runTicks(sim, 1)
    const again = sim.state.quests.offer!
    expect(again).toMatchObject({ templateId: 'golden_release' })
    expect(again.id).not.toBe(q.id)
    // A malware delivery the same way.
    acceptOffer(sim)
    delivered(sim, 1, true, true)
    runTicks(sim, 1)
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      reason: 'malware',
    })
    // After Victory the ultimate never comes back.
    runTicks(sim, DAY)
    const third = acceptOffer(sim)
    delivered(sim, u.deliveries)
    runTicks(sim, 1)
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: third.id,
      outcome: 'completed',
    })
    runTicks(sim, 3 * DAY)
    expect(sim.state.quests.offer).toBeNull()
  })

  it('a timeout after 5 days fails it and it comes back after the cooldown', () => {
    const sim = atLevel5(5)
    const q = acceptOffer(sim)
    delivered(sim, 10)
    runTicks(sim, q.deadlineTick! - sim.state.tick)
    expect(sim.state.quests.active?.id).toBe(q.id)
    runTicks(sim, 1)
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: q.id,
      outcome: 'failed',
      reason: 'timeout',
    })
    runTicks(sim, DAY)
    expect(sim.state.quests.offer?.templateId).toBe('golden_release')
  })
})

describe('the regular scheduler around the ultimate (B2 §3.1, §3.4; review M7)', () => {
  /** L5 with the regular scheduler live (nextOfferTick long past), the ultimate offered. */
  function level5Live(seed: number): Sim {
    const sim = quietSim(seed, PM5)
    sim.state.economy.lifetimeEarned = dataFixture(PM5).levels.at(-1)!.threshold
    runTicks(sim, 1)
    quiet(sim)
    sim.state.quests.nextOfferTick = 0
    return sim
  }

  it('a fail or an abandon: no regular offer during the cooldown; the ultimate comes back first, and nothing else while it waits', () => {
    for (const how of ['malware', 'abandon'] as const) {
      const sim = level5Live(how === 'malware' ? 11 : 12)
      const q = acceptOffer(sim)
      expect(q.ultimate).toBe(true)
      if (how === 'malware') {
        delivered(sim, 1, true, true)
        runTicks(sim, 1)
      } else sim.dispatch({ kind: 'abandonQuest' })
      const t = sim.state.tick
      expect(sim.state.quests.history.at(-1)).toMatchObject({ id: q.id })
      expect(sim.state.quests.nextOfferTick).toBeGreaterThanOrEqual(t + 2 * DAY)
      const offered = collect(sim, 'quest:offered')
      runTicks(sim, DAY - 1)
      expect(offered).toEqual([]) // on_time_day is eligible, yet nothing comes
      runTicks(sim, 1)
      expect(offered.map((o) => o.templateId)).toEqual(['golden_release'])
      runTicks(sim, 4 * DAY) // Later: it stays, nothing else is drawn
      expect(offered).toHaveLength(1)
    }
  })

  it('Victory: the regular scheduler resumes intervalDays later, not on the victory tick', () => {
    const sim = level5Live(13)
    acceptOffer(sim)
    delivered(sim, u.deliveries)
    const offered = collect(sim, 'quest:offered')
    runTicks(sim, 1)
    expect(sim.state.economy.victory).toBe(true)
    const t = sim.state.tick
    const interval = sim.data.quests.offer.intervalDays * DAY
    expect(sim.state.quests.nextOfferTick).toBe(t + interval)
    runTicks(sim, interval - 1)
    expect(offered).toEqual([])
    runTicks(sim, 1)
    expect(offered).toHaveLength(1)
    expect(offered[0]?.ultimate).toBe(false)
  })
})

describe('endless after Victory: malware escalation (B2 §3.4; design §2.2, Q16)', () => {
  it('unchanged on the victory day, + postVictoryPerDay from the next boundary (a debug Victory below the cap too)', () => {
    const sim = noOffers(quietSim(6))
    const data = sim.data
    const m = data.parcels.malware
    runTicks(sim, 2 * DAY + 100)
    const before = malwareShare(sim.state, data)
    expect(before).toBeCloseTo(m.baseShare)
    startQuest(sim, 'golden_release')
    delivered(sim, u.deliveries)
    runTicks(sim, 1)
    expect(sim.state.economy.victory).toBe(true)
    expect(malwareShare(sim.state, data)).toBeCloseTo(before)
    runTicks(sim, 3 * DAY - sim.state.tick - 1)
    expect(malwareShare(sim.state, data)).toBeCloseTo(before)
    runTicks(sim, 1) // the first boundary after Victory
    expect(malwareShare(sim.state, data)).toBeCloseTo(
      before + m.postVictoryPerDay,
    )
    runTicks(sim, DAY)
    expect(malwareShare(sim.state, data)).toBeCloseTo(
      before + 2 * m.postVictoryPerDay,
    )
  })

  it('with the playtest cap below the last level the cap rule still escalates (M7 data); at the last level, reaching L5 alone does not', () => {
    // The playtest-1 cap (2) pins the cap rule; M8 ships cap 3.
    const capped = noOffers(quietSim(7, { economy: { playtestMaxLevel: 2 } }))
    const m = capped.data.parcels.malware
    capped.state.economy.lifetimeEarned = capped.data.levels[1]!.threshold
    runTicks(capped, 1)
    quiet(capped)
    expect(capped.state.level.level).toBe(2)
    const l2 = m.baseShare + m.perLevel
    expect(malwareShare(capped.state, capped.data)).toBeCloseTo(l2)
    runTicks(capped, DAY)
    expect(malwareShare(capped.state, capped.data)).toBeCloseTo(
      l2 + m.postVictoryPerDay,
    )
    const top = atLevel5(8)
    const l5 = m.baseShare + 4 * m.perLevel
    runTicks(top, 3 * DAY)
    expect(malwareShare(top.state, top.data)).toBeCloseTo(l5)
  })
})
