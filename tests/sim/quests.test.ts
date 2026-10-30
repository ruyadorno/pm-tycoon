// M7 quests (spec-build2 §3, §8, §9; plan-build2 §8.4 task 7 + acceptance;
// design-m7 §3, §4, §7): the offer scheduler ("first offer on day 3, next 2
// days after completion, 1 day after decline", expiry, one active quest, no
// back-to-back repeat, no draw on an empty pool), the quest stream (an offer
// and a magic Accept never advance state.rng), targets and conditions, every
// template's goal counter on a scripted event feed, the rewards ("cash
// counts toward lifetime earned, lives capped at 5, star applicant appears
// with fee 0 and leaves after 2 days", satisfaction outside the cap, the
// voucher), every command failure, determinism with saves mid-quest, and the
// no-double-counting property test over 200 seeded random feeds. M9 (design-
// m8-m9 §4.5, §7 M9 6): the Golden Release at the real L5 — the shipped cap
// 5, the threshold earned — offered on `level:up {5}`, kept by Later, its
// 60 / 0 / 90 % counters, Victory.

import { describe, expect, it } from 'vitest'
import type { SimEventName, SimEventPayloads } from '../../src/sim/events.ts'
import { isCommand } from '../../src/sim/commands.ts'
import { Rng } from '../../src/sim/rng.ts'
import { auditState, replay, Sim, stateHash } from '../../src/sim/sim.ts'
import {
  eligibleTemplates,
  gainLives,
  questFlavour,
  questName,
  rewardSummary,
} from '../../src/sim/systems/quests.ts'
import type { Parcel, Quest, QuestProgress } from '../../src/sim/types.ts'
import { laneNode, TICKS_PER_DAY } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  acceptOffer,
  buy,
  collect,
  dataFixture,
  eventLog,
  fund,
  injectParcel,
  makeSim,
  noOffers,
  offerQuest,
  openingA,
  placeMachine,
  quietSim,
  runTicks,
  startQuest,
  unlockDistrict,
} from './helpers.ts'

const data = dataFixture()
const offerDef = data.quests.offer
const DAY = TICKS_PER_DAY

/** Only Rush hour is ever drawn at L1 (on_time_day weight 0): a deterministic scheduler. */
const RUSH_ONLY = { quests: { templates: [{}, {}, {}, {}, { weight: 0 }] } }

/** Mulberry32 one step ahead of `word` (what one quest-stream draw leaves behind). */
function afterDraws(word: number, n: number): number {
  const cell = { rng: word }
  const r = new Rng(() => cell)
  for (let i = 0; i < n; i++) r.next()
  return cell.rng
}

function deliver(sim: Sim, p: Parcel, onTime = true): void {
  sim.emit('parcel:delivered', {
    id: p.id,
    paid: 10,
    onTime,
    malware: p.malware,
  })
}

function toss(sim: Sim, p: Parcel): void {
  sim.emit('parcel:tossed', {
    id: p.id,
    wasMalware: p.malware,
    bounty: 0,
    source: 'player',
    employeeId: null,
  })
}

function cleared(sim: Sim, p: Parcel, hub: string, onTime = true): void {
  sim.emit('parcel:cleared', {
    id: p.id,
    paid: 10,
    malware: p.malware,
    hub,
    buildingId: p.dest,
    onTime,
  })
}

describe('quests.json (B2 §9) and the start state', () => {
  it('ships the B2 §9 table, the quest slots empty, the first offer due on day 3', () => {
    expect(offerDef).toEqual({
      firstOfferDay: 3,
      intervalDays: 2,
      declineCooldownDays: 1,
      offerExpiresDays: 1,
      maxActive: 1,
    })
    expect(data.quests.templates.map((t) => t.id)).toEqual([
      'rush_district',
      'cheer_up',
      'magic_parcel',
      'clean_sweep',
      'on_time_day',
      'big_haul',
      'night_shift',
      'customs_run',
      'inspector_general',
      'express_lane',
    ])
    const sim = makeSim(3)
    expect(sim.state.quests).toMatchObject({
      offer: null,
      active: null,
      nextOfferTick: 3 * DAY,
      ultimateNextTick: 0,
      lastOfferDay: null,
      history: [],
      vouchers: [],
    })
    expect(sim.state.quests.rng).not.toBe(sim.state.rng)
    expect(sim.state.quests.rng).not.toBe(sim.state.applicants.rng)
    expect(sim.state.nextId.quest).toBe(1)
    expect(sim.state.stats.victoryTick).toBeNull()
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('names, flavour lines with {district}, reward summaries', () => {
    expect(questName(data, 'rush_district')).toBe('Rush hour')
    expect(questName(data, 'golden_release')).toBe('The Golden Release')
    expect(
      questFlavour(data, { templateId: 'rush_district', target: 'downtown' }),
    ).toBe('Registry Row is swamped — get their parcels moving')
    expect(
      questFlavour(data, { templateId: 'cheer_up', target: 'highres' }),
    ).toBe('Node Heights is grumbling; win them back')
    const none = {
      cash: 0,
      lives: 0,
      satisfaction: 0,
      star: null,
      voucher: null,
      victory: false,
    }
    expect(rewardSummary(data, { ...none, cash: 150, lives: 1 }, null)).toBe(
      '+1 life + $150',
    )
    expect(
      rewardSummary(data, { ...none, cash: 150, satisfaction: 5 }, 'downtown'),
    ).toBe('$150 + 5 satisfaction in Registry Row')
    expect(
      rewardSummary(
        data,
        { ...none, star: { role: 'inspector', name: 'Vera', pips: {} } },
        null,
      ),
    ).toBe('★ inspector Vera')
    expect(
      rewardSummary(data, { ...none, voucher: 'metal_detector' }, null),
    ).toBe('free Metal detector')
    expect(rewardSummary(data, { ...none, victory: true }, null)).toBe(
      'Victory',
    )
  })
})

describe('scheduler (B2 §3.1): first offer on day 3, next 2 days after completion, 1 day after decline', () => {
  it('first offer on day 3: none before tick 1800, one at 1800 (quest:offered, then the ticker line)', () => {
    const sim = quietSim(1, RUSH_ONLY)
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    const log = eventLog(sim)
    runTicks(sim, 3 * DAY - 1)
    expect(sim.state.quests.offer).toBeNull()
    expect(log.filter((e) => e.name.startsWith('quest:'))).toEqual([])
    runTicks(sim, 1)
    const q = sim.state.quests.offer!
    expect(q).toMatchObject({
      id: 'q1',
      templateId: 'rush_district',
      status: 'offered',
      target: 'downtown',
      goal: 6,
      reward: { cash: 120, lives: 0, star: null, victory: false },
      offeredTick: 1800,
      expiresTick: 2400,
      acceptedTick: null,
      deadlineTick: null,
    })
    expect(sim.state.quests.lastOfferDay).toBe(3)
    const at = log.filter((e) => e.tick === 1800).map((e) => e.name)
    const i = at.indexOf('quest:offered')
    expect(at.slice(i, i + 2)).toEqual(['quest:offered', 'ticker:news'])
    expect(log.find((e) => e.name === 'quest:offered')?.p).toEqual({
      questId: 'q1',
      templateId: 'rush_district',
      target: 'downtown',
      ultimate: false,
    })
    expect(
      log.find((e) => e.name === 'ticker:news' && e.tick === 1800)?.p,
    ).toEqual({
      text: 'New job on the board: Rush hour',
      kind: 'quest',
    })
    // The shipped data offers something at 3:00 too (Like clockwork needs nothing).
    const plain = quietSim(1)
    runTicks(plain, 3 * DAY)
    expect(plain.state.quests.offer?.templateId).toBe('on_time_day')
  })

  it('next 2 days after completion', () => {
    const sim = quietSim(2, RUSH_ONLY)
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    runTicks(sim, 3 * DAY)
    const q = acceptOffer(sim)
    expect(q.deadlineTick).toBe(1800 + 3 * DAY)
    runTicks(sim, 10)
    if (q.progress.kind !== 'deliveriesFrom') throw new Error('kind')
    q.progress.count = q.goal
    runTicks(sim, 1)
    expect(sim.state.quests.active).toBeNull()
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: q.id,
      outcome: 'completed',
      tick: 1811,
    })
    expect(sim.state.quests.nextOfferTick).toBe(1811 + 2 * DAY)
    runTicks(sim, 2 * DAY - 1)
    expect(sim.state.quests.offer).toBeNull()
    runTicks(sim, 1)
    expect(sim.state.quests.offer?.offeredTick).toBe(1811 + 2 * DAY)
  })

  it('1 day after decline', () => {
    const sim = quietSim(3, RUSH_ONLY)
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    runTicks(sim, 3 * DAY)
    const q = sim.state.quests.offer!
    const declined = collect(sim, 'quest:declined')
    expect(sim.dispatch({ kind: 'declineQuest', questId: q.id })).toEqual({
      ok: true,
    })
    expect(declined).toEqual([
      { questId: q.id, templateId: 'rush_district', reason: 'declined' },
    ])
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      outcome: 'declined',
      tick: 1800,
    })
    expect(sim.state.quests.nextOfferTick).toBe(1800 + DAY)
    runTicks(sim, DAY - 1)
    expect(sim.state.quests.offer).toBeNull()
    runTicks(sim, 1)
    expect(sim.state.quests.offer?.offeredTick).toBe(2400)
  })

  it('an unanswered offer expires after offerExpiresDays → quest:declined {expired} and the 1-day cooldown', () => {
    const sim = quietSim(4, RUSH_ONLY)
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    const declined = collect(sim, 'quest:declined')
    runTicks(sim, 3 * DAY + DAY - 1)
    expect(sim.state.quests.offer?.id).toBe('q1')
    runTicks(sim, 1)
    expect(sim.state.quests.offer).toBeNull()
    expect(declined).toEqual([
      { questId: 'q1', templateId: 'rush_district', reason: 'expired' },
    ])
    expect(sim.state.quests.history).toEqual([
      {
        id: 'q1',
        templateId: 'rush_district',
        outcome: 'expired',
        tick: 2400,
        reason: null,
      },
    ])
    runTicks(sim, DAY)
    expect(sim.state.quests.offer).toMatchObject({
      id: 'q2',
      offeredTick: 3000,
    })
  })

  it('maxActive 1: no offer while a quest is active; a timeout fails it (grey ticker line, no penalty) and the next waits intervalDays', () => {
    const sim = quietSim(5, RUSH_ONLY)
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    runTicks(sim, 3 * DAY)
    const q = acceptOffer(sim)
    const money = sim.state.economy.balance
    const failed = collect(sim, 'quest:failed')
    const news = collect(sim, 'ticker:news')
    runTicks(sim, 3 * DAY)
    expect(sim.state.tick).toBe(q.deadlineTick)
    expect(sim.state.quests.active?.id).toBe(q.id)
    expect(sim.state.quests.offer).toBeNull()
    runTicks(sim, 1)
    expect(sim.state.quests.active).toBeNull()
    expect(failed).toEqual([
      { questId: q.id, templateId: 'rush_district', reason: 'timeout' },
    ])
    expect(news.filter((n) => n.kind === 'questFailed')).toEqual([
      { text: 'Quest expired: Rush hour', kind: 'questFailed' },
    ])
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      outcome: 'failed',
      reason: 'timeout',
    })
    expect(sim.state.quests.nextOfferTick).toBe(q.deadlineTick! + 1 + 2 * DAY)
    // No penalty (Q-B2-7): only payroll moved the balance.
    const payroll = sim.state.employees.reduce((s, e) => s + e.salaryPerDay, 0)
    expect(sim.state.economy.balance).toBe(money - 3 * payroll)
  })

  it('no back-to-back repeat: the newest history template is left out while another is eligible', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const sim = quietSim(seed)
      injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
      runTicks(sim, 3 * DAY)
      const first = sim.state.quests.offer!
      expect(['rush_district', 'on_time_day']).toContain(first.templateId)
      sim.dispatch({ kind: 'declineQuest', questId: first.id })
      runTicks(sim, DAY)
      const second = sim.state.quests.offer!
      expect(second.templateId).not.toBe(first.templateId)
      expect(['rush_district', 'on_time_day']).toContain(second.templateId)
    }
  })

  it('an empty pool offers nothing and draws nothing; the next tick with an eligible template offers with one quest-stream draw', () => {
    // Like clockwork locked to L2: nothing at L1 is eligible in a quiet city.
    const sim = quietSim(6, {
      quests: { templates: [{}, {}, {}, {}, { unlockLevel: 2 }] },
    })
    const word = sim.state.quests.rng
    runTicks(sim, 3 * DAY + 200)
    expect(sim.state.quests.offer).toBeNull()
    expect(sim.state.quests.rng).toBe(word)
    expect(sim.state.quests.nextOfferTick).toBe(3 * DAY)
    expect(eligibleTemplates(sim)).toEqual([])
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    runTicks(sim, 1)
    expect(sim.state.quests.offer?.templateId).toBe('rush_district')
    expect(sim.state.quests.rng).toBe(afterDraws(word, 1))
  })
})

describe('the quest stream: offers and a magic Accept never advance state.rng (design-m7 §3.6)', () => {
  it('quiet city: the offer is one quest-stream draw, the magic route ≤ 2; the main word never moves', () => {
    const sim = quietSim(7)
    buy(sim, 'bike')
    sim.state.lane.quarantine.count = 1 // a first Toss happened
    const main = sim.state.rng
    runTicks(sim, 3 * DAY - 1)
    const quest = sim.state.quests.rng
    runTicks(sim, 1)
    expect(sim.state.quests.offer).not.toBeNull()
    expect(sim.state.rng).toBe(main)
    expect(sim.state.quests.rng).toBe(afterDraws(quest, 1))
    const before = sim.state.quests.rng
    offerQuest(sim, 'magic_parcel') // a debug offer draws nothing
    expect(sim.state.quests.rng).toBe(before)
    const q = acceptOffer(sim)
    expect(q.progress).toMatchObject({ kind: 'magicParcel' })
    expect(sim.state.rng).toBe(main)
    expect([afterDraws(before, 1), afterDraws(before, 2)]).toContain(
      sim.state.quests.rng,
    )
  })

  it('a live run: the main word at the offer and after a magic Accept equals a run whose offers the test skipped', () => {
    for (const seed of [1, 4, 9]) {
      const a = makeSim(seed)
      const b = makeSim(seed)
      for (const sim of [a, b]) openingA(sim, 'pool')
      noOffers(b)
      runTicks(a, 3 * DAY)
      runTicks(b, 3 * DAY)
      expect(a.state.quests.offer).not.toBeNull()
      expect(b.state.quests.offer).toBeNull()
      expect(a.state.rng).toBe(b.state.rng)
      expect(a.state.parcels).toEqual(b.state.parcels)
      a.state.lane.quarantine.count = Math.max(1, a.state.lane.quarantine.count)
      offerQuest(a, 'magic_parcel')
      const res = a.dispatch({
        kind: 'acceptQuest',
        questId: a.state.quests.offer!.id,
      })
      expect(res.ok || res.reason === 'quest-expired').toBe(true)
      expect(a.state.rng).toBe(b.state.rng)
    }
  })
})

const targetOf = (sim: Sim, id: string) =>
  eligibleTemplates(sim).find((c) => c.t.id === id)?.target ?? null
const eligible = (sim: Sim, id: string) =>
  eligibleTemplates(sim).some((c) => c.t.id === id)

describe('targets and conditions (B2 §3.2; design-m7 §3.4, Q20)', () => {
  it('district:mostWaiting: the most waiting parcels, ties → districts.json order, none → ineligible', () => {
    const sim = quietSim(1)
    expect(eligible(sim, 'rush_district')).toBe(false)
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    injectParcel(sim, 'hr_towers_b', 'dt_cache_cafe')
    expect(targetOf(sim, 'rush_district')).toBe('highres')
    injectParcel(sim, 'dt_peer_plaza', 'hr_towers_a')
    expect(targetOf(sim, 'rush_district')).toBe('downtown')
  })

  it('district:satisfactionBelow 50: the HIGHEST district below it (closest to 60), none → ineligible', () => {
    const sim = quietSim(1)
    expect(eligible(sim, 'cheer_up')).toBe(false)
    sim.state.districts.highres!.satisfaction = 30
    sim.state.districts.downtown!.satisfaction = 45
    expect(targetOf(sim, 'cheer_up')).toBe('downtown')
    sim.state.districts.downtown!.satisfaction = 49
    sim.state.districts.highres!.satisfaction = 49
    expect(targetOf(sim, 'cheer_up')).toBe('highres')
    sim.state.districts.highres!.satisfaction = 50
    sim.state.districts.downtown!.satisfaction = 50
    expect(eligible(sim, 'cheer_up')).toBe(false)
  })

  it('magic_parcel: livesBelowCap, firstToss, a servable route, maxAlive', () => {
    const sim = quietSim(1)
    expect(eligible(sim, 'magic_parcel')).toBe(false) // no Toss, no vehicle
    sim.state.lane.quarantine.count = 1
    expect(eligible(sim, 'magic_parcel')).toBe(false) // no vehicle
    buy(sim, 'bike')
    expect(eligible(sim, 'magic_parcel')).toBe(true)
    sim.state.economy.lives = data.economy.lives.cap
    expect(eligible(sim, 'magic_parcel')).toBe(false)
    sim.state.economy.lives = 4
    sim.state.lane.quarantine.count = 0
    expect(eligible(sim, 'magic_parcel')).toBe(false)
    sim.state.lane.quarantine.count = 1
    sim.state.spawn.magicAlive = data.parcels.magic.maxAlive
    expect(eligible(sim, 'magic_parcel')).toBe(false)
  })

  it('hubLive:docks is false until the hub is live; unlockLevel gates L2+ templates', () => {
    const sim = quietSim(1)
    expect(eligible(sim, 'big_haul')).toBe(false)
    sim.state.level.level = 3
    expect(eligible(sim, 'big_haul')).toBe(true)
    expect(eligible(sim, 'inspector_general')).toBe(true)
    expect(eligible(sim, 'customs_run')).toBe(false)
    unlockDistrict(sim, 'docks')
    expect(eligible(sim, 'customs_run')).toBe(true)
    expect(eligible(sim, 'express_lane')).toBe(false) // L5
  })
})

describe('goal counters on a scripted event feed (design-m7 §3.3, §3.4)', () => {
  it('deliveriesFrom: only the target district’s origins, never malware; completes at the goal', () => {
    const sim = noOffers(quietSim(1))
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    const q = startQuest(sim, 'rush_district')
    expect(q.target).toBe('downtown')
    const progress = collect(sim, 'quest:progress')
    deliver(sim, injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe'))
    deliver(
      sim,
      injectParcel(sim, 'dt_peer_plaza', 'hr_towers_a', { malware: true }),
    )
    for (let i = 0; i < 5; i++) {
      deliver(sim, injectParcel(sim, 'dt_semver_bank', 'hr_towers_b'))
    }
    expect(q.progress).toEqual({ kind: 'deliveriesFrom', count: 5 })
    runTicks(sim, 1)
    expect(progress).toEqual([{ questId: q.id, value: 5, target: 6 }])
    deliver(sim, injectParcel(sim, 'dt_cache_cafe', 'hr_towers_b'))
    runTicks(sim, 1)
    expect(sim.state.quests.history.at(-1)?.outcome).toBe('completed')
  })

  it('satisfactionAtLeast: the target’s satisfaction reaches 52 (already there → done next step)', () => {
    const sim = noOffers(quietSim(1))
    sim.state.districts.downtown!.satisfaction = 45
    const q = startQuest(sim, 'cheer_up')
    expect(q).toMatchObject({ target: 'downtown', goal: 52 })
    expect(q.progress).toEqual({
      kind: 'satisfactionAtLeast',
      start: 45,
      satisfaction: 45,
    })
    sim.state.districts.downtown!.satisfaction = 50
    runTicks(sim, 1)
    expect(q.progress).toMatchObject({ satisfaction: 50 })
    expect(createViewSim(sim).quests().active?.progress01).toBeCloseTo(5 / 7)
    sim.state.districts.downtown!.satisfaction = 52
    runTicks(sim, 1)
    expect(sim.state.quests.history.at(-1)?.outcome).toBe('completed')
  })

  it('tossStreak: malware Tosses in a row; a wrong Toss resets it (Q1), the quest only fails on its deadline', () => {
    const sim = noOffers(quietSim(1))
    const q = startQuest(sim, 'clean_sweep')
    const bad = () =>
      injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { malware: true })
    const clean = () => injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    toss(sim, bad())
    toss(sim, bad())
    toss(sim, clean())
    expect(q.progress).toEqual({ kind: 'tossStreak', streak: 0, best: 2 })
    runTicks(sim, 1)
    expect(sim.state.quests.active?.id).toBe(q.id)
    toss(sim, bad())
    toss(sim, bad())
    toss(sim, bad())
    toss(sim, clean()) // reset in the same tick: the streak still happened
    runTicks(sim, 1)
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: q.id,
      outcome: 'completed',
    })
  })

  it('onTimeRateDay: the partial accept day is ignored; a qualifying full day completes at its boundary, else the counters reset', () => {
    const sim = noOffers(quietSim(1))
    runTicks(sim, 1850)
    const q = startQuest(sim, 'on_time_day')
    expect(q.progress).toEqual({
      kind: 'onTimeRateDay',
      dayStartTick: 2400,
      deliveries: 0,
      onTime: 0,
      bestPct: 0,
    })
    const p = () => injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    for (let i = 0; i < 9; i++) deliver(sim, p()) // before the first full day
    runTicks(sim, 2400 - 1850)
    expect(q.progress).toMatchObject({ deliveries: 0, dayStartTick: 2400 })
    runTicks(sim, 1)
    for (let i = 0; i < 5; i++) deliver(sim, p())
    deliver(
      sim,
      injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { malware: true }),
    )
    runTicks(sim, 3000 - 2401)
    // 5 < 6 deliveries (malware never counts): the day did not qualify;
    // counters reset.
    expect(sim.state.quests.active?.id).toBe(q.id)
    expect(q.progress).toEqual({
      kind: 'onTimeRateDay',
      dayStartTick: 3000,
      deliveries: 0,
      onTime: 0,
      bestPct: 100,
    })
    runTicks(sim, 1)
    for (let i = 0; i < 19; i++) deliver(sim, p())
    deliver(sim, p(), false) // 19 / 20 = 95 %
    runTicks(sim, 3600 - 3001)
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: q.id,
      outcome: 'completed',
      tick: 3600,
    })
  })

  it('deliveriesOfSize: XL only, never malware', () => {
    const sim = noOffers(quietSim(1))
    const q = startQuest(sim, 'big_haul')
    expect(q.goal).toBe(3)
    deliver(
      sim,
      injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { size: 'L' }),
    )
    deliver(
      sim,
      injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
        size: 'XL',
        malware: true,
      }),
    )
    for (let i = 0; i < q.goal - 1; i++) {
      deliver(
        sim,
        injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { size: 'XL' }),
      )
    }
    expect(q.progress).toEqual({
      kind: 'deliveriesOfSize',
      count: q.goal - 1,
    })
  })

  it('holdDecisions: Tosses and Clears count; a holdBayFull stall resets the count (Q2), other stalls do not', () => {
    const sim = noOffers(quietSim(1))
    const q = startQuest(sim, 'night_shift')
    const p = () => injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    toss(sim, p())
    sim.emit('parcel:cleared_by_player', { id: p().id })
    sim.emit('lane:stalled', { reason: 'shelfFull', nodeId: 'slot1' })
    expect(q.progress).toEqual({ kind: 'holdDecisions', count: 2, resets: 0 })
    sim.emit('lane:stalled', { reason: 'holdBayFull', nodeId: 'slot1' })
    expect(q.progress).toEqual({ kind: 'holdDecisions', count: 0, resets: 1 })
    for (let i = 0; i < 6; i++) toss(sim, p())
    runTicks(sim, 1)
    expect(sim.state.quests.history.at(-1)?.outcome).toBe('completed')
  })

  it('overseasCleared: parcel:cleared at its hub only (M8 emits it), never malware', () => {
    const sim = noOffers(quietSim(1))
    const q = startQuest(sim, 'customs_run')
    const p = () => injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    cleared(sim, p(), 'airport')
    cleared(
      sim,
      injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { malware: true }),
      'docks',
    )
    cleared(sim, p(), 'docks')
    expect(q.progress).toEqual({ kind: 'overseasCleared', count: 1 })
  })

  it('detectionAllStrains: every announced strain ≥ 95 % held one full day; a dip restarts the clock', () => {
    const sim = fund(noOffers(quietSim(1)))
    const q = startQuest(sim, 'inspector_general')
    expect(q.goal).toBe(95)
    runTicks(sim, 1)
    expect(q.progress).toEqual({
      kind: 'detectionAllStrains',
      sinceTick: null,
      minPct: 85,
    })
    placeMachine(sim, 'metal_detector', 'slot2')
    runTicks(sim, 1)
    const since = sim.state.tick
    expect(q.progress).toEqual({
      kind: 'detectionAllStrains',
      sinceTick: since,
      minPct: 97,
    })
    runTicks(sim, 300)
    sim.dispatch({ kind: 'removeFixture', nodeId: 'slot2' })
    runTicks(sim, 1)
    expect(q.progress).toMatchObject({ sinceTick: null, minPct: 85 })
    placeMachine(sim, 'metal_detector', 'slot2')
    runTicks(sim, 1)
    const again = sim.state.tick
    runTicks(sim, DAY - 1)
    expect(sim.state.quests.active?.id).toBe(q.id)
    runTicks(sim, 1)
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      outcome: 'completed',
      tick: again + DAY,
    })
  })
})

describe('rewards (B2 §3.1, §7.1)', () => {
  it('cash counts toward lifetime earned (stats.income too, money:changed reason quest)', () => {
    const sim = noOffers(quietSim(1))
    const q = startQuest(sim, 'rush_district')
    const before = { ...sim.state.economy }
    const income = sim.state.stats.income
    const money = collect(sim, 'money:changed')
    const done = collect(sim, 'quest:completed')
    if (q.progress.kind !== 'deliveriesFrom') throw new Error('kind')
    q.progress.count = q.goal
    runTicks(sim, 1)
    expect(done).toEqual([
      { questId: q.id, templateId: 'rush_district', reward: q.reward },
    ])
    expect(money).toContainEqual({
      delta: 120,
      reason: 'quest',
      balance: before.balance + 120,
    })
    expect(sim.state.economy.lifetimeEarned).toBe(before.lifetimeEarned + 120)
    expect(sim.state.stats.income).toBe(income + 120)
  })

  it('reward arrays are read at offer time (level 2 Rush hour: 10 for $200), unchanged by a later level-up', () => {
    const sim = noOffers(quietSim(1))
    sim.state.level.level = 2
    const q = offerQuest(sim, 'rush_district')
    expect(q).toMatchObject({ goal: 10, reward: { cash: 200 } })
    sim.state.level.level = 3
    acceptOffer(sim)
    expect(q).toMatchObject({ goal: 10, reward: { cash: 200 } })
  })

  it('lives capped at 5: 4 → 5 with life:gained, 5 → 5 without', () => {
    const sim = quietSim(1)
    const gained = collect(sim, 'life:gained')
    sim.state.economy.lives = 4
    expect(gainLives(sim, 1, 'magic')).toBe(1)
    expect(sim.state.economy.lives).toBe(5)
    expect(gainLives(sim, 1, 'quest')).toBe(0)
    expect(sim.state.economy.lives).toBe(5)
    expect(gained).toEqual([{ lives: 5, delta: 1, reason: 'magic' }])
  })

  it('satisfaction +5 to the target outside the +4/day positive cap', () => {
    const sim = noOffers(quietSim(1))
    const d = sim.state.districts.downtown!
    d.satisfaction = 45
    const q = startQuest(sim, 'cheer_up')
    d.satisfaction = 60
    d.dayPositive = data.economy.satisfaction.positiveCapPerDay
    const money = sim.state.economy.balance
    runTicks(sim, 1)
    expect(sim.state.quests.history.at(-1)?.id).toBe(q.id)
    expect(d.satisfaction).toBe(65)
    expect(sim.state.economy.balance).toBe(money + 150)
  })

  it('star applicant appears with fee 0 and leaves after 2 days (M6 pool, ticker line)', () => {
    const sim = noOffers(quietSim(1))
    const q = startQuest(sim, 'clean_sweep')
    const news = collect(sim, 'ticker:news')
    if (q.progress.kind !== 'tossStreak') throw new Error('kind')
    q.progress.best = 3
    runTicks(sim, 1)
    const vs = createViewSim(sim)
    const vera = vs.applicants('inspector').find((a) => a.star)
    expect(vera).toMatchObject({
      name: 'Vera',
      star: true,
      hireFee: 0,
      leavesInDays: 2,
      pips: { eye: 5, pace: 3, charisma: 1 },
    })
    expect(sim.state.applicants.inspector).toHaveLength(
      data.employees.applicants.poolSize,
    )
    expect(news.map((n) => n.text)).toEqual([
      'Vera is looking for work — ★ applicant in the inspector pool',
      'Quest complete: Clean sweep — ★ inspector Vera',
    ])
    runTicks(sim, 2 * DAY)
    expect(sim.state.applicants.inspector.some((a) => a.star)).toBe(true)
    runTicks(sim, DAY)
    expect(sim.state.applicants.inspector.some((a) => a.star)).toBe(false)
    // Rae, the driver ★, keeps her van affinity.
    const sim2 = noOffers(quietSim(2))
    const q2 = startQuest(sim2, 'on_time_day')
    sim2.dispatch({ kind: 'abandonQuest' })
    expect(q2.reward.star).toEqual({
      role: 'driver',
      name: 'Rae',
      pips: { speed: 5, energy: 4, charisma: 1 },
      affinity: 'van',
    })
  })

  it('a ★ whose name an employee holds is announced by the name the pool gives it (quest:completed, both ticker lines: "Vera 2")', () => {
    const sim = noOffers(quietSim(1))
    const staff = sim.state.employees[0]!
    staff.name = 'Vera'
    const q = startQuest(sim, 'clean_sweep')
    const news = collect(sim, 'ticker:news')
    const done = collect(sim, 'quest:completed')
    if (q.progress.kind !== 'tossStreak') throw new Error('kind')
    q.progress.best = 3
    runTicks(sim, 1)
    const star = sim.state.applicants.inspector.find((a) => a.star)!
    expect(star.name).toBe('Vera 2')
    expect(done).toHaveLength(1)
    expect(done[0]?.reward.star).toMatchObject({
      role: 'inspector',
      name: 'Vera 2',
    })
    expect(news.map((n) => n.text)).toEqual([
      'Vera 2 is looking for work — ★ applicant in the inspector pool',
      'Quest complete: Clean sweep — ★ inspector Vera 2',
    ])
    // The template keeps its name (the next ★ Vera matches by starKey).
    expect(
      data.quests.templates.find((t) => t.id === 'clean_sweep')?.reward,
    ).toMatchObject({ starApplicant: { name: 'Vera' } })
    expect(star.starKey).toBe('Vera')
  })

  it('voucher: a free machine into the first empty live slot, else held; buyMachine then charges $0', () => {
    const vdata = {
      quests: {
        templates: [
          {},
          {},
          {},
          {},
          {},
          { reward: { cash: 0, voucher: 'metal_detector' } },
        ],
      },
    }
    const sim = noOffers(quietSim(1, vdata))
    const complete = () => {
      const q = startQuest(sim, 'big_haul')
      if (q.progress.kind !== 'deliveriesOfSize') throw new Error('kind')
      q.progress.count = q.goal
      runTicks(sim, 1)
    }
    const placed = collect(sim, 'lane:fixturePlaced')
    complete()
    const slot2 = laneNode(sim.state.lane, 'slot2')!
    expect(slot2.fixture).toMatchObject({
      kind: 'machine',
      checker: { defId: 'metal_detector', price: 0 },
    })
    expect(placed).toHaveLength(1)
    placeMachine(sim, 'metal_detector', 'slot3')
    complete()
    expect(sim.state.quests.vouchers).toEqual(['metal_detector'])
    expect(createViewSim(sim).quests().vouchers).toEqual(['metal_detector'])
    sim.dispatch({ kind: 'removeFixture', nodeId: 'slot2' })
    sim.state.economy.balance = 0
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'metal_detector',
        nodeId: 'slot2',
      }),
    ).toEqual({ ok: true })
    expect(sim.state.economy.balance).toBe(0)
    expect(sim.state.quests.vouchers).toEqual([])
    expect(sim.dispatch({ kind: 'removeFixture', nodeId: 'slot2' })).toEqual({
      ok: true,
    })
    expect(sim.state.economy.balance).toBe(0) // a gift refunds nothing
  })
})

describe('commands (design-m7 §3.2): every failure reason', () => {
  it('shapes: the four quest commands are well-formed commands', () => {
    expect(isCommand({ kind: 'acceptQuest', questId: 'q1' })).toBe(true)
    expect(isCommand({ kind: 'declineQuest', questId: 'q1' })).toBe(true)
    expect(isCommand({ kind: 'abandonQuest' })).toBe(true)
    expect(isCommand({ kind: 'debugOfferQuest', templateId: 'x' })).toBe(true)
    expect(isCommand({ kind: 'declineQuest' })).toBe(false)
  })

  it('acceptQuest: invalid, quest-expired (expired / withdrawn), quest-active, game over', () => {
    const sim = quietSim(1, RUSH_ONLY)
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    expect(sim.dispatch({ kind: 'acceptQuest', questId: 'q1' })).toEqual({
      ok: false,
      reason: 'invalid',
    })
    runTicks(sim, 4 * DAY) // q1 offered at 3:00, expired at 4:00
    expect(sim.state.quests.history.at(-1)?.outcome).toBe('expired')
    expect(sim.dispatch({ kind: 'acceptQuest', questId: 'q1' })).toEqual({
      ok: false,
      reason: 'quest-expired',
    })
    noOffers(sim)
    offerQuest(sim, 'rush_district') // q2
    offerQuest(sim, 'big_haul') // q3 withdraws q2
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: 'q2',
      outcome: 'withdrawn',
    })
    expect(sim.dispatch({ kind: 'acceptQuest', questId: 'q2' })).toEqual({
      ok: false,
      reason: 'quest-expired',
    })
    acceptOffer(sim) // q3 active
    // The ultimate waits in the offer slot while a quest is active.
    sim.state.level.level = 5
    runTicks(sim, 1)
    const u = sim.state.quests.offer!
    expect(u).toMatchObject({ templateId: 'golden_release', ultimate: true })
    expect(sim.dispatch({ kind: 'acceptQuest', questId: u.id })).toEqual({
      ok: false,
      reason: 'quest-active',
    })
    sim.state.economy.gameOver = true
    expect(sim.dispatch({ kind: 'acceptQuest', questId: u.id })).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('acceptQuest of a magic offer nobody can carry: withdrawn (logged), quest-expired, the decline cooldown', () => {
    const sim = noOffers(quietSim(1))
    const q = offerQuest(sim, 'magic_parcel')
    const declined = collect(sim, 'quest:declined')
    const res = sim.dispatch({ kind: 'acceptQuest', questId: q.id })
    expect(res).toEqual({ ok: false, reason: 'quest-expired', applied: true })
    expect(sim.commandLog.at(-1)?.cmd).toEqual({
      kind: 'acceptQuest',
      questId: q.id,
    })
    expect(declined).toEqual([
      { questId: q.id, templateId: 'magic_parcel', reason: 'withdrawn' },
    ])
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      outcome: 'withdrawn',
      reason: 'unavailable',
    })
    expect(sim.state.quests.offer).toBeNull()
    expect(sim.state.quests.nextOfferTick).toBe(sim.state.tick + DAY)
  })

  it('declineQuest: invalid for another id and for the ultimate (Later only)', () => {
    const sim = noOffers(quietSim(1))
    const q = offerQuest(sim, 'rush_district')
    expect(sim.dispatch({ kind: 'declineQuest', questId: 'q9' })).toEqual({
      ok: false,
      reason: 'invalid',
    })
    const u = offerQuest(sim, 'golden_release')
    expect(q.id).not.toBe(u.id)
    expect(u.expiresTick).toBeNull()
    expect(sim.dispatch({ kind: 'declineQuest', questId: u.id })).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('abandonQuest: invalid with none; abandons with no ticker line, the next offer after intervalDays', () => {
    const sim = noOffers(quietSim(1))
    expect(sim.dispatch({ kind: 'abandonQuest' })).toEqual({
      ok: false,
      reason: 'invalid',
    })
    const q = startQuest(sim, 'rush_district')
    const failed = collect(sim, 'quest:failed')
    const news = collect(sim, 'ticker:news')
    expect(sim.dispatch({ kind: 'abandonQuest' })).toEqual({ ok: true })
    expect(failed).toEqual([
      { questId: q.id, templateId: 'rush_district', reason: 'abandoned' },
    ])
    expect(news).toEqual([])
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      outcome: 'abandoned',
      reason: 'abandoned',
    })
    expect(sim.state.quests.nextOfferTick).toBe(sim.state.tick + 2 * DAY)
  })

  it('debugOfferQuest: invalid id, quest-active; ignores unlockLevel / condition / requires; the debug target fallbacks', () => {
    const sim = noOffers(quietSim(1))
    expect(
      sim.dispatch({ kind: 'debugOfferQuest', templateId: 'nope' }),
    ).toEqual({ ok: false, reason: 'invalid' })
    expect(offerQuest(sim, 'express_lane')).toMatchObject({
      templateId: 'express_lane',
      goal: 4,
      reward: { cash: 600 },
    })
    expect(offerQuest(sim, 'rush_district').target).toBe('highres')
    // Nobody below 50: the debug fallback is the lowest satisfaction.
    sim.state.districts.downtown!.satisfaction = 55
    expect(offerQuest(sim, 'cheer_up').target).toBe('downtown')
    acceptOffer(sim)
    expect(
      sim.dispatch({ kind: 'debugOfferQuest', templateId: 'big_haul' }),
    ).toEqual({ ok: false, reason: 'quest-active' })
  })

  it('ViewSim: quests() views, quest.accept / decline / abandon, debug.offerQuest, victory', () => {
    const sim = noOffers(quietSim(1))
    sim.state.quests.nextOfferTick = 1800
    const vs = createViewSim(sim, { debug: true })
    expect(vs.quests()).toMatchObject({
      offer: null,
      active: null,
      nextOfferInTicks: 1800,
      victory: false,
      victoryTick: null,
    })
    expect(vs.debug?.offerQuest('rush_district')).toEqual({ ok: true })
    const v = vs.quests()
    expect(v.nextOfferInTicks).toBeNull()
    expect(v.offer).toMatchObject({
      name: 'Rush hour',
      flavour: 'Node Heights is swamped — get their parcels moving',
      kind: 'deliveriesFrom',
      progress01: 0,
      ticksLeft: DAY,
      limitTicks: 3 * DAY,
      targetName: 'Node Heights',
      route: null,
    })
    expect(vs.quests()).toBe(v) // cached per revision
    expect(vs.quest.decline('q1')).toEqual({ ok: true })
    vs.debug?.offerQuest('big_haul')
    expect(vs.quest.accept(vs.quests().offer!.id)).toEqual({ ok: true })
    runTicks(sim, 10)
    expect(vs.quests().active).toMatchObject({
      status: 'active',
      ticksLeft: 4 * DAY - 10,
      progress01: 0,
    })
    expect(vs.quest.abandon()).toEqual({ ok: true })
    expect(vs.victory).toBe(false)
    expect(createViewSim(sim).debug).toBeNull()
  })
})

/** A run where every offer is accepted at once (the policy rule, written here). */
function questRun(
  seed: number,
  ticks: number,
  saveAt?: number,
): { sim: Sim; snap: string | null } {
  const sim = makeSim(seed)
  openingA(sim, 'pool')
  let snap: string | null = null
  for (let t = 0; t < ticks; t++) {
    const o = sim.state.quests.offer
    if (o && sim.state.quests.active === null) {
      sim.dispatch({ kind: 'acceptQuest', questId: o.id })
    }
    if (saveAt !== undefined && t === saveAt) {
      snap = JSON.stringify(sim.snapshot())
    }
    sim.tick()
  }
  return { sim, snap }
}

describe('determinism and saves mid-quest (plan.md §6.4)', () => {
  it('two sims, same seed + same commands → same state hash; seed + log replay matches', () => {
    for (const seed of [2, 5]) {
      const a = questRun(seed, 9 * DAY).sim
      const b = questRun(seed, 9 * DAY).sim
      expect(stateHash(a.state)).toBe(stateHash(b.state))
      expect(a.state.quests.history.length).toBeGreaterThan(0)
      expect(auditState(a.state, a.data)).toEqual([])
      const again = replay(a.data, seed, a.commandLog, a.state.tick)
      expect(stateHash(again.state)).toBe(stateHash(a.state))
    }
  }, 30_000)

  it('snapshot → load mid onTimeRateDay day and mid magic countdown → identical continuation', () => {
    // Mid Like clockwork: dayStartTick and today's counters in the save.
    const a = fund(noOffers(makeSim(3)))
    openingA(a)
    runTicks(a, 1850)
    startQuest(a, 'on_time_day')
    runTicks(a, 900) // past the first boundary, mid-day
    expect(a.state.quests.active?.progress).toMatchObject({
      dayStartTick: 2400,
    })
    const loadedA = Sim.load(a.data, JSON.parse(JSON.stringify(a.snapshot())))
    runTicks(a, 1200)
    runTicks(loadedA, 1200)
    expect(stateHash(loadedA.state)).toBe(stateHash(a.state))

    // Mid magic countdown: the golden parcel waiting / aboard.
    const b = fund(noOffers(makeSim(4)))
    openingA(b)
    runTicks(b, 400)
    const q = startQuest(b, 'magic_parcel') // a debug offer: no first Toss needed
    runTicks(b, 300)
    expect(b.state.quests.active?.id).toBe(q.id)
    const loadedB = Sim.load(b.data, JSON.parse(JSON.stringify(b.snapshot())))
    expect(loadedB.state).toEqual(b.state)
    runTicks(b, 1200)
    runTicks(loadedB, 1200)
    expect(stateHash(loadedB.state)).toBe(stateHash(b.state))
    expect(auditState(loadedB.state, loadedB.data)).toEqual([])
  }, 30_000)

  it('the MinuteRow carries the active template and the cumulative completions', () => {
    const { sim } = questRun(6, 12 * DAY)
    const rows = sim.state.stats.minutes
    expect(rows).toHaveLength(12)
    const done = sim.state.quests.history.filter(
      (r) => r.outcome === 'completed',
    )
    expect(rows.at(-1)?.questsDone).toBe(done.length)
    for (const r of rows) {
      expect(r.quest === null || typeof r.quest === 'string').toBe(true)
    }
    expect(rows.slice(0, 3).every((r) => r.quest === null)).toBe(true)
  }, 30_000)
})

type Ev = {
  [K in SimEventName]: { name: K; p: SimEventPayloads[K] }
}[SimEventName]

/** One parcel's terminal path through the events (each id ends once, as in the sim). */
function lifecycle(r: Rng, p: Parcel): Ev[] {
  const k = r.int(4)
  const onTime = r.chance(0.7)
  const delivered: Ev = {
    name: 'parcel:delivered',
    p: { id: p.id, paid: 10, onTime, malware: p.malware },
  }
  if (k === 0) return [delivered]
  if (k === 1) {
    return [
      {
        name: 'parcel:tossed',
        p: {
          id: p.id,
          wasMalware: p.malware,
          bounty: 0,
          source: 'player',
          employeeId: null,
        },
      },
    ]
  }
  if (k === 2)
    return [{ name: 'parcel:cleared_by_player', p: { id: p.id } }, delivered]
  return [
    {
      name: 'parcel:cleared',
      p: {
        id: p.id,
        paid: 10,
        malware: p.malware,
        hub: r.chance(0.6) ? 'docks' : 'airport',
        buildingId: p.dest,
        onTime,
      },
    },
  ]
}

function noise(r: Rng, ids: number[]): Ev {
  const id = ids[r.int(ids.length)]!
  switch (r.int(5)) {
    case 0:
      return { name: 'parcel:pickedUp', p: { id, vehicleId: 1 } }
    case 1:
      return { name: 'parcel:shelved', p: { id } }
    case 2:
      return {
        name: 'money:changed',
        p: { delta: 1, reason: 'delivery', balance: 1 },
      }
    case 3:
      return {
        name: 'quest:progress',
        p: { questId: 'q99', value: 3, target: 6 },
      }
    default:
      return {
        name: 'lane:stalled',
        p: {
          reason: r.chance(0.5) ? 'holdBayFull' : 'shelfFull',
          nodeId: 'slot1',
        },
      }
  }
}

describe('no quest counts an event twice (plan-build2 §8.4 acceptance; design-m7 §3.4)', () => {
  type Spec = { id: string; kind: QuestProgress['kind'] }
  const SPECS: Spec[] = [
    { id: 'rush_district', kind: 'deliveriesFrom' },
    { id: 'big_haul', kind: 'deliveriesOfSize' },
    { id: 'night_shift', kind: 'holdDecisions' },
    { id: 'customs_run', kind: 'overseasCleared' },
    { id: 'clean_sweep', kind: 'tossStreak' },
    { id: 'golden_release', kind: 'ultimate' },
  ]
  const ORIGINS = [
    'hr_towers_a',
    'hr_async_arms',
    'dt_registry_tower',
    'dt_scope_offices',
  ]
  const SIZES = ['S', 'M', 'L', 'XL'] as const

  /** The independent reference: distinct qualifying ids while the quest is active. */
  class Reference {
    from = new Set<number>()
    xl = new Set<number>()
    decisions = new Set<number>()
    cleared = new Set<number>()
    streak = 0
    best = 0
    delivered = new Set<number>()
    onTime = new Set<number>()
    malware = new Set<number>()
    resets = 0

    see(sim: Sim, q: Quest, ev: Ev): void {
      const parcel = (id: number) => sim.state.parcels[String(id)]!
      switch (ev.name) {
        case 'parcel:delivered': {
          const p = parcel(ev.p.id)
          if (
            !p.malware &&
            sim.data.buildings.find((b) => b.id === p.origin)?.district ===
              q.target
          )
            this.from.add(p.id)
          if (!p.malware && p.size === 'XL') this.xl.add(p.id)
          if (p.malware) this.malware.add(p.id)
          else {
            this.delivered.add(p.id)
            if (ev.p.onTime) this.onTime.add(p.id)
          }
          return
        }
        case 'parcel:cleared':
          if (!ev.p.malware && ev.p.hub === 'docks') this.cleared.add(ev.p.id)
          if (ev.p.malware) this.malware.add(ev.p.id)
          else {
            this.delivered.add(ev.p.id)
            if (ev.p.onTime) this.onTime.add(ev.p.id)
          }
          return
        case 'parcel:tossed':
          this.decisions.add(ev.p.id)
          if (ev.p.wasMalware) {
            this.streak += 1
            this.best = Math.max(this.best, this.streak)
          } else this.streak = 0
          return
        case 'parcel:cleared_by_player':
          this.decisions.add(ev.p.id)
          return
        case 'lane:stalled':
          if (ev.p.reason === 'holdBayFull') {
            this.decisions.clear()
            this.resets += 1
          }
          return
        default:
          return
      }
    }

    expected(kind: QuestProgress['kind']): Record<string, number> {
      switch (kind) {
        case 'deliveriesFrom':
          return { count: this.from.size }
        case 'deliveriesOfSize':
          return { count: this.xl.size }
        case 'holdDecisions':
          return { count: this.decisions.size, resets: this.resets }
        case 'overseasCleared':
          return { count: this.cleared.size }
        case 'tossStreak':
          return { streak: this.streak, best: this.best }
        case 'ultimate':
          return {
            delivered: this.delivered.size,
            onTime: this.onTime.size,
            malware: this.malware.size,
          }
        default:
          return {}
      }
    }
  }

  it('200 seeded random feeds: every counter = the distinct qualifying ids after Accept and before the quest left the slot; an offer never counts', () => {
    let completedMidFeed = 0
    let failedMidFeed = 0
    for (let seed = 1; seed <= 200; seed++) {
      const r = Rng.fromSeed(seed * 7919)
      const spec = SPECS[seed % SPECS.length]!
      const sim = noOffers(quietSim(seed))
      const parcels: Parcel[] = []
      const n = 20 + r.int(30)
      for (let i = 0; i < n; i++) {
        parcels.push(
          injectParcel(sim, ORIGINS[r.int(ORIGINS.length)]!, 'dt_cache_cafe', {
            size: SIZES[r.int(SIZES.length)]!,
            malware: r.chance(spec.kind === 'ultimate' ? 0.04 : 0.25),
          }),
        )
      }
      const q = offerQuest(sim, spec.id)
      const initial = structuredClone(q.progress)
      const queues = parcels.map((p) => lifecycle(r, p))
      const ids = parcels.map((p) => p.id)
      const total = queues.reduce((s, x) => s + x.length, 0)
      const acceptAt = r.int(Math.max(1, Math.floor(total / 2)))
      const ref = new Reference()
      let step = 0
      let accepted = false
      while (queues.some((x) => x.length > 0)) {
        if (!accepted && step === acceptAt) {
          expect(q.progress, `seed ${seed}: the offer counted`).toEqual(initial)
          acceptOffer(sim)
          accepted = true
        }
        step += 1
        const roll = r.next()
        if (roll < 0.08) {
          runTicks(sim, 1 + r.int(3))
          continue
        }
        let ev: Ev
        if (roll < 0.2) ev = noise(r, ids)
        else {
          const live = queues.filter((x) => x.length > 0)
          ev = live[r.int(live.length)]!.shift()!
        }
        if (sim.state.quests.active?.id === q.id) ref.see(sim, q, ev)
        sim.emit(ev.name, ev.p as never)
      }
      runTicks(sim, 1)
      if (!accepted) {
        expect(q.progress).toEqual(initial)
        continue
      }
      expect(q.progress, `seed ${seed} ${spec.id}`).toMatchObject(
        ref.expected(spec.kind),
      )
      const outcome = sim.state.quests.history.find(
        (h) => h.id === q.id,
      )?.outcome
      if (outcome === 'completed') completedMidFeed += 1
      if (outcome === 'failed') failedMidFeed += 1
      // A second quest, offered and never accepted, counts nothing.
      if (sim.state.quests.active !== null)
        sim.dispatch({ kind: 'abandonQuest' })
      const second = offerQuest(sim, spec.id)
      const before = structuredClone(second.progress)
      const extra = injectParcel(sim, 'dt_registry_tower', 'hr_towers_a', {
        size: 'XL',
      })
      sim.emit('parcel:delivered', {
        id: extra.id,
        paid: 1,
        onTime: true,
        malware: false,
      })
      sim.emit('parcel:tossed', {
        id: extra.id,
        wasMalware: true,
        bounty: 0,
        source: 'player',
        employeeId: null,
      })
      expect(second.progress).toEqual(before)
      expect(q.progress, `seed ${seed}: counted after it left`).toMatchObject(
        ref.expected(spec.kind),
      )
    }
    expect(completedMidFeed).toBeGreaterThan(20)
    expect(failedMidFeed).toBeGreaterThan(0) // the ultimate's malware fail
  })
})

describe('the Golden Release at the real L5 (M9: the shipped cap 5; design-m8-m9 §4.5, §7 M9 6)', () => {
  it('offered on the level:up {5} tick of an earned L5; Later keeps it (no expiry, no Decline); 60 deliveries, 0 malware, 90 % on time → Victory: economy.victory, stats.victoryTick, game:victory', () => {
    const L5 = data.levels.find((l) => l.level === 5)!
    const u = L5.ultimateQuest!
    expect(u).toMatchObject({
      deliveries: 60,
      maxMalwareDelivered: 0,
      minOnTimeRate: 0.9,
    })
    expect(data.economy.playtestMaxLevel).toBe(5)
    const sim = noOffers(quietSim(21))
    const log = eventLog(sim)
    sim.state.economy.lifetimeEarned = L5.threshold
    runTicks(sim, 1)
    const at = sim.state.tick
    expect(sim.state.level.level).toBe(5)
    expect(sim.commandLog).toEqual([])
    const up5 = log.findIndex(
      (e) => e.name === 'level:up' && (e.p as { level: number }).level === 5,
    )
    const offered = log.findIndex((e) => e.name === 'quest:offered')
    expect(up5).toBeGreaterThanOrEqual(0)
    expect(offered).toBeGreaterThan(up5)
    expect(log[offered]).toMatchObject({
      tick: at,
      p: { templateId: u.id, ultimate: true, target: null },
    })
    const q = sim.state.quests.offer!
    expect(q).toMatchObject({ templateId: u.id, expiresTick: null })
    // Later: nothing to do — it waits; Decline is refused.
    expect(sim.dispatch({ kind: 'declineQuest', questId: q.id })).toEqual({
      ok: false,
      reason: 'invalid',
    })
    for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
    runTicks(sim, 3 * DAY)
    expect(sim.state.quests.offer?.id).toBe(q.id)
    expect(acceptOffer(sim).id).toBe(q.id)
    const parcels = Array.from({ length: u.deliveries }, (_, i) =>
      injectParcel(
        sim,
        i % 2 ? 'hr_towers_a' : 'dt_registry_tower',
        i % 2 ? 'dt_cache_cafe' : 'hr_towers_b',
      ),
    )
    parcels.slice(0, 6).forEach((p) => deliver(sim, p, false))
    parcels.slice(6, -1).forEach((p) => deliver(sim, p))
    runTicks(sim, 1)
    expect(sim.state.quests.active?.progress).toEqual({
      kind: 'ultimate',
      delivered: 59,
      onTime: 53,
      malware: 0,
    })
    expect(sim.state.economy.victory).toBe(false)
    const victory = collect(sim, 'game:victory')
    deliver(sim, parcels.at(-1)!) // 54 / 60 = 90 %
    runTicks(sim, 1)
    const t = sim.state.tick
    expect(victory).toEqual([{ day: sim.state.day }])
    expect(sim.state.economy.victory).toBe(true)
    expect(sim.state.stats.victoryTick).toBe(t)
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      templateId: u.id,
      outcome: 'completed',
      tick: t,
    })
    expect(createViewSim(sim).quests()).toMatchObject({
      victory: true,
      victoryTick: t,
    })
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})
