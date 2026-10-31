// Build 3 M11 — the event deck's scheduler (spec-build3 §3.2, §3.4, §6;
// plan-build3 §8.2 task 8; M11 contract §3B + critique 15–18, 28–30): the
// first card at firstEventS, the interval bands by level, links / the rescue
// / debug cards never touching the draw timer (a drawn card restarts it at
// close), the quiet rules (the first 200 s, game over, a level-up, the Golden
// Release, an open card) and the queue, blank draws (D-1), jobs as cards
// (eligibility, jobShare, the cooldowns, Accept = acceptQuest, the magic
// failure, the Golden Release withdrawing a job card, ?quest=), the hold (no
// policy: tick() is a no-op; a policy never holds), replay stopping at a held
// card, the rescue, once / cooldown and the category rule, and the stream
// discipline (D-2: the cadence and content words, never state.rng).

import { describe, expect, it } from 'vitest'
import { buildGameData } from '../../src/data/index.ts'
import type { EventDef, EventsData } from '../../src/data/types.ts'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { replay, Sim, stateHash } from '../../src/sim/sim.ts'
import {
  cardOptions,
  DECK_OFF_TICK,
  decisionCandidates,
  drawBand,
  JOB_ACCEPT,
  JOB_DECLINE,
  optionLines,
} from '../../src/sim/systems/deck.ts'
import { payrollTicks } from '../../src/sim/systems/payroll.ts'
import { jobsOpen } from '../../src/sim/systems/quests.ts'
import { TICKS_PER_DAY, ticksFromS } from '../../src/sim/types.ts'
import { loadRawData } from '../../tools/sim/load.node.ts'
import {
  acceptOffer,
  buy,
  collect,
  dataFixture,
  deckOn,
  decideOpen,
  eventLog,
  injectParcel,
  makeSim,
  offerQuest,
  quiet,
  quietSim,
  replayOf,
  runTicks,
  runUntil,
  startQuest,
} from './helpers.ts'

const data = dataFixture()
const sch = data.events.schedule
const DAY = TICKS_PER_DAY
/** The first draw (200 s). */
const FIRST = ticksFromS(sch.firstEventS)
const CALM = ticksFromS(sch.afterLevelUpS)
const RESCUE = ticksFromS(sch.rescueDelayS)
/** Every due draw is a job while one is eligible. */
const ALWAYS_JOBS = { events: { schedule: { jobShare: 1 } } }
/** No draw is ever a job (the roll still happens while a job is eligible). */
const NO_JOBS = { events: { schedule: { jobShare: 0 } } }
/** Far ahead but below DECK_OFF_TICK: the deck is on, the draw never due. */
const LATER = 5e8

/** Run `f` with SIM_FEATURES.events set, restored after. */
function withEvents<T>(on: boolean, f: () => T): T {
  const was = SIM_FEATURES.events
  SIM_FEATURES.events = on
  try {
    return f()
  } finally {
    SIM_FEATURES.events = was
  }
}

/** The shipped tables with the deck filtered (every draw a non-job when `noJobs`). */
function deckData(keep: (d: EventDef) => boolean, noJobs = false) {
  const raw = loadRawData()
  const events = raw.events as EventsData
  events.deck = events.deck.filter(keep)
  if (noJobs) events.schedule.jobShare = 0
  return buildGameData(raw)
}

/** A quiet deck-on sim past the first 200 s (no card yet: the draw pushed out). */
function playing(seed = 1, overrides?: unknown): Sim {
  const sim = deckOn(quietSim(seed, overrides))
  sim.state.events.nextDrawTick = LATER
  runTicks(sim, FIRST)
  return sim
}

describe('the draw timer (B3 §3.2)', () => {
  it('the first card at firstEventS (200 s) on a deck-on sim with a policy, never before; without a policy it holds the sim there', () => {
    withEvents(true, () => {
      for (const seed of [1, 2, 3]) {
        const sim = deckOn(makeSim(seed))
        const policy = createPolicy(sim, 'competent')
        const offered: number[] = []
        sim.addTap((name, _p, tick) => {
          if (name === 'event:offered') offered.push(tick)
        })
        for (let t = 0; t < FIRST + 5; t++) {
          policy.step()
          sim.tick()
        }
        policy.dispose?.()
        expect(offered[0]).toBe(FIRST)
        expect(sim.state.tick).toBe(FIRST + 5)
      }
      const held = deckOn(makeSim(1))
      runTicks(held, FIRST + 50)
      expect(held.state.tick).toBe(FIRST)
      expect(held.state.events.open).not.toBeNull()
    })
  })

  it('band gaps by level: whole seconds inside intervalS[level] (exact bounds), the mean near the middle across seeds; a level past the last key uses it', () => {
    for (let level = 1; level <= 5; level++) {
      const [lo, hi] = drawBand(data, level)
      expect([lo, hi]).toEqual(sch.intervalS[String(level)])
      const gaps: number[] = []
      for (const seed of [1, 2, 3, 4]) {
        const sim = playing(seed, NO_JOBS)
        sim.state.level.level = level
        sim.state.economy.victory = true // no Golden Release window at L5
        for (let i = 0; i < 60; i++) {
          sim.state.events.nextDrawTick = sim.state.tick + 1
          sim.tick()
          gaps.push(sim.state.events.nextDrawTick - sim.state.tick)
        }
        expect(sim.state.events.stats.blanks).toBe(60)
      }
      for (const g of gaps) {
        expect(g % 10).toBe(0)
        expect(g).toBeGreaterThanOrEqual(ticksFromS(lo))
        expect(g).toBeLessThanOrEqual(ticksFromS(hi))
      }
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
      const mid = ticksFromS((lo + hi) / 2)
      expect(Math.abs(mean - mid)).toBeLessThan(0.08 * mid)
      expect(new Set(gaps).size).toBeGreaterThan((hi - lo) / 2)
    }
    expect(drawBand(data, 9)).toEqual(sch.intervalS['5'])
  })

  it('a drawn card restarts the timer when it closes (closeTick + its gap); links, the rescue and debug cards leave nextDrawTick alone', () => {
    // A drawn job card, closed 100 ticks after it opened (a policy keeps the sim ticking).
    const sim = deckOn(quietSim(1, ALWAYS_JOBS))
    runTicks(sim, FIRST)
    const card = sim.state.events.open!
    expect(card).toMatchObject({ kind: 'job', drawn: true, openedTick: FIRST })
    const detach = sim.attachPolicy()
    runTicks(sim, 100)
    expect(sim.state.events.open).toBe(card) // no draw while it is open
    detach()
    decideOpen(sim, JOB_DECLINE)
    expect(sim.state.events.nextDrawTick).toBe(FIRST + 100 + card.gapTicks!)

    // Debug cards, a chain link and the rescue: the timer never moves.
    const d = playing(2, NO_JOBS)
    d.state.economy.balance = 10_000
    expect(
      d.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_wx_rain' }),
    ).toEqual({ ok: true })
    expect(d.state.events.open).toMatchObject({ drawn: false, gapTicks: null })
    decideOpen(d, 0)
    d.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_crime_gang' })
    decideOpen(d, 1) // Deny → the watch in 1 day
    expect(
      runUntil(d, () => d.state.events.open !== null, 2 * DAY),
    ).toBeGreaterThan(0)
    expect(d.state.events.open).toMatchObject({
      eventId: 'ev_crime_gang_watch',
      drawn: false,
      depth: 2,
    })
    decideOpen(d, 0)
    d.state.economy.balance = 50 // the rescue: no vehicle, balance < a bike
    expect(
      runUntil(d, () => d.state.events.open !== null, 2 * DAY),
    ).toBeGreaterThan(0)
    expect(d.state.events.open).toMatchObject({
      eventId: 'ev_luck_loaner',
      drawn: false,
    })
    decideOpen(d, 0)
    expect(d.state.events.nextDrawTick).toBe(LATER)
  })
})

describe('quiet rules and the queue (B3 §3.2; critique 15, 30)', () => {
  it('the first firstEventS: a draw due earlier waits until 200 s', () => {
    const sim = deckOn(quietSim(1, NO_JOBS))
    sim.state.events.nextDrawTick = 100
    runTicks(sim, FIRST - 1)
    expect(sim.state.events.stats.blanks).toBe(0)
    runTicks(sim, 1)
    expect(sim.state.events.stats.blanks).toBe(1)
  })

  it('a payday tick: nothing opens while the day step is about to pay payroll; what was due opens the next tick (review policy-1)', () => {
    const P = payrollTicks(data)
    const sim = playing(1, NO_JOBS)
    const payday = Math.ceil((sim.state.tick + 1) / P) * P
    runTicks(sim, payday - 1 - sim.state.tick)
    sim.state.events.nextDrawTick = payday
    runTicks(sim, 1)
    expect(sim.state.tick).toBe(payday)
    expect(sim.state.economy.lastPayroll?.tick).toBe(payday)
    expect(sim.state.events.stats.blanks).toBe(0)
    runTicks(sim, 1)
    expect(sim.state.events.stats.blanks).toBe(1)
    // A link due on a payday waits the same tick.
    const linked = playing(2, NO_JOBS)
    const pd = Math.ceil((linked.state.tick + 1) / P) * P
    runTicks(linked, pd - 1 - linked.state.tick)
    linked.state.events.scheduled.push({
      eventId: 'ev_crime_gang_bust',
      branches: null,
      dueTick: pd,
      target: null,
      pick: null,
      parentChoice: 'Call the police',
      chainHeadId: 'ev_crime_gang',
      depth: 4,
      bookedTick: pd - 10,
    })
    runTicks(linked, 1)
    expect(linked.state.events.open).toBeNull()
    runTicks(linked, 1)
    expect(linked.state.events.open).toMatchObject({
      eventId: 'ev_crime_gang_bust',
      openedTick: pd + 1,
    })
  })

  it('game over: no link, rescue or draw (the timer keeps its tick)', () => {
    const sim = playing(1, NO_JOBS)
    sim.state.economy.gameOver = true
    sim.state.economy.balance = 0
    sim.state.events.nextDrawTick = sim.state.tick + 1
    runTicks(sim, RESCUE + 50)
    expect(sim.state.events.stats.blanks).toBe(0)
    expect(sim.state.events.open).toBeNull()
    expect(sim.state.events.rescueTick).toBeNull()
  })

  it('afterLevelUpS (15 s) after a level-up', () => {
    const sim = playing(1, NO_JOBS)
    const t = sim.state.tick
    sim.state.level.level = 2
    sim.state.stats.levelTick['2'] = t
    sim.state.events.nextDrawTick = t + 1
    runTicks(sim, CALM - 1)
    expect(sim.state.events.stats.blanks).toBe(0)
    runTicks(sim, 1)
    expect(sim.state.events.stats.blanks).toBe(1)
    expect(sim.state.tick).toBe(t + CALM)
  })

  it('the Golden Release: quiet afterLevelUpS after it is offered, or after the last regular quest ended while it waited (D-14, critique 30)', () => {
    const sim = playing(1, NO_JOBS)
    sim.state.level.level = 5 // no levelTick row: only the Golden Release window
    sim.state.events.nextDrawTick = sim.state.tick + 2
    runTicks(sim, 1)
    const offered = sim.state.quests.offer!
    expect(offered.ultimate).toBe(true)
    runTicks(sim, CALM - 1)
    expect(sim.state.events.stats.blanks).toBe(0)
    runTicks(sim, 1)
    expect(sim.state.events.stats.blanks).toBe(1)
    expect(sim.state.tick).toBe(offered.offeredTick + CALM)

    // Offered while a regular quest runs: the window opens when that quest ends.
    const b = playing(2, NO_JOBS)
    startQuest(b, 'on_time_day')
    b.state.level.level = 5
    runTicks(b, 1)
    expect(b.state.quests.offer?.ultimate).toBe(true)
    runTicks(b, CALM + 10)
    expect(b.dispatch({ kind: 'abandonQuest' })).toEqual({ ok: true })
    const end = b.state.tick
    const blanks = b.state.events.stats.blanks
    b.state.events.nextDrawTick = end + 1
    runTicks(b, CALM - 1)
    expect(b.state.events.stats.blanks).toBe(blanks)
    runTicks(b, 1)
    expect(b.state.events.stats.blanks).toBe(blanks + 1)
  })

  it('an open card: no draw while it is up (even with the sim ticking), the draw comes the tick after it closes', () => {
    const sim = playing(1, NO_JOBS)
    sim.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_wx_rain' })
    const detach = sim.attachPolicy()
    sim.state.events.nextDrawTick = sim.state.tick + 1
    runTicks(sim, 50)
    expect(sim.state.events.stats.blanks).toBe(0)
    detach()
    decideOpen(sim, 0)
    runTicks(sim, 1)
    expect(sim.state.events.stats.blanks).toBe(1)
  })

  it('the queue: a debug card behind an open one queues (event:queued; maxQueued 1 — a second is refused) and opens first when the slot frees, before a due link or draw', () => {
    const sim = playing(1, NO_JOBS)
    const queued = collect(sim, 'event:queued')
    sim.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_crime_gang' })
    expect(
      sim.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_wx_rain' }),
    ).toEqual({ ok: true })
    expect(queued).toEqual([{ eventId: 'ev_wx_rain' }])
    expect(sim.state.events.queue).toHaveLength(1)
    expect(
      sim.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_press_ad' }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
    })
    decideOpen(sim, 1) // Deny: the watch booked
    const t = sim.state.tick
    sim.state.events.scheduled[0]!.dueTick = t // the link due now
    sim.state.events.nextDrawTick = t // and the draw
    runTicks(sim, 1)
    expect(sim.state.events.open).toMatchObject({
      eventId: 'ev_wx_rain',
      openedTick: t + 1,
    })
    expect(sim.state.events.queue).toEqual([])
    decideOpen(sim, 0)
    runTicks(sim, 1)
    expect(sim.state.events.open).toMatchObject({
      eventId: 'ev_crime_gang_watch',
      depth: 2,
    })
    expect(sim.state.events.stats.blanks).toBe(0) // the draw waits behind the link
  })
})

describe('blank draws and the streams (D-1, D-2)', () => {
  it('decisions off: a due draw with no job yields no card — a blank, counted, the next draw one gap later', () => {
    const sim = deckOn(quietSim(1, NO_JOBS))
    const offered = collect(sim, 'event:offered')
    runTicks(sim, FIRST)
    expect(sim.state.events.open).toBeNull()
    expect(sim.state.events.stats.blanks).toBe(1)
    const gap = sim.state.events.nextDrawTick - FIRST
    expect(gap).toBeGreaterThanOrEqual(600)
    expect(gap).toBeLessThanOrEqual(1000)
    runTicks(sim, gap)
    expect(sim.state.events.stats.blanks).toBe(2)
    expect(offered).toEqual([])
    expect(sim.state.events.stats.offered).toBe(0)
  })

  it('decisions on with no candidate is a blank too; with candidates the draw is a decision card (event:offered, its ticker line)', () => {
    withEvents(true, () => {
      const l5only = deckData((d) => d.id === 'ev_port_fastlane', true)
      const none = deckOn(quiet(new Sim(l5only, 1)))
      none.state.events.nextDrawTick = FIRST
      runTicks(none, FIRST)
      expect(none.state.events.open).toBeNull()
      expect(none.state.events.stats.blanks).toBe(1)

      const sim = playing(3, NO_JOBS)
      const news = collect(sim, 'ticker:news')
      const offered = collect(sim, 'event:offered')
      sim.state.events.nextDrawTick = sim.state.tick + 1
      runTicks(sim, 1)
      const open = sim.state.events.open!
      expect(open).toMatchObject({
        drawn: true,
        depth: 1,
        chainHeadId: open.eventId,
      })
      expect(['decision', 'news']).toContain(open.kind)
      expect(offered).toEqual([
        {
          eventId: open.eventId,
          kind: open.kind,
          category: open.category,
          chain: false,
          questId: null,
        },
      ])
      const word = data.events.categories[open.category]!.word
      expect(news.at(-1)?.kind).toBe('event')
      expect(news.at(-1)?.text.startsWith(`${word}: `)).toBe(true)
      expect(sim.state.events.seen[open.eventId]).toBe(1)
      expect(sim.state.events.lastCategory).toBe(open.category)
    })
  })

  it('a job draw is one cadence roll, one gap and one quest-stream draw; a blank with no job pool is one cadence draw; state.rng moves exactly as in a deck-off twin', () => {
    const a = deckOn(quietSim(4, ALWAYS_JOBS))
    const b = quietSim(4, ALWAYS_JOBS)
    const cadence = a.state.events.rng
    const quest = a.state.quests.rng
    runTicks(a, FIRST)
    runTicks(b, FIRST)
    expect(a.state.events.open?.kind).toBe('job')
    expect(a.state.quests.rng).not.toBe(quest)
    expect(a.state.rng).toBe(b.state.rng)
    // Two draws: the roll, then the gap.
    const twin = deckOn(quietSim(4, ALWAYS_JOBS))
    twin.eventRng.next()
    twin.eventRng.next()
    expect(a.state.events.rng).toBe(twin.state.events.rng)
    expect(a.state.events.picks.rng).toBe(twin.state.events.picks.rng)
    expect(cadence).not.toBe(a.state.events.rng)
  })
})

describe('jobs as cards (B3 §3.1–§3.2, §6)', () => {
  it('eligibility: quests on, not game over, both slots empty, the Golden Release not pending, the cooldown over', () => {
    const sim = quietSim(1)
    expect(jobsOpen(sim)).toBe(true)
    sim.state.quests.jobReadyTick = sim.state.tick + 10
    expect(jobsOpen(sim)).toBe(false)
    sim.state.quests.jobReadyTick = 0
    startQuest(sim, 'on_time_day')
    expect(jobsOpen(sim)).toBe(false)
    sim.dispatch({ kind: 'abandonQuest' })
    sim.state.quests.jobReadyTick = 0
    expect(jobsOpen(sim)).toBe(true)
    sim.state.level.level = 5
    expect(jobsOpen(sim)).toBe(false) // the Golden Release is pending
    sim.state.level.level = 1
    SIM_FEATURES.quests = false
    try {
      expect(jobsOpen(sim)).toBe(false)
    } finally {
      SIM_FEATURES.quests = true
    }
    sim.state.economy.gameOver = true
    expect(jobsOpen(sim)).toBe(false)
  })

  it('jobShare: about 65 % of the due draws are jobs while one is eligible (400 draws)', () => {
    const sim = playing(5)
    let jobs = 0
    const n = 400
    for (let i = 0; i < n; i++) {
      sim.state.events.nextDrawTick = sim.state.tick + 1
      sim.tick()
      const open = sim.state.events.open
      if (open !== null) {
        expect(open.kind).toBe('job')
        jobs += 1
        sim.dispatch({ kind: 'declineQuest', questId: open.questId! })
        sim.state.quests.jobReadyTick = 0
      }
    }
    expect(jobs / n).toBeGreaterThan(sch.jobShare - 0.08)
    expect(jobs / n).toBeLessThan(sch.jobShare + 0.08)
  })

  it('a job card: Accept and Decline (the default) as its options and lines; Accept starts the quest as acceptQuest does (deadline, satisfaction start)', () => {
    const sim = playing(1)
    sim.state.districts.downtown!.satisfaction = 45
    offerQuest(sim, 'cheer_up')
    expect(sim.state.quests.offer?.target).toBe('downtown')
    const card = sim.state.events.open!
    const opts = cardOptions(sim, card)
    expect(
      opts.map((o) => [o.index, o.label, o.default, o.visible, o.affordable]),
    ).toEqual([
      [JOB_ACCEPT, 'Accept', false, true, true],
      [JOB_DECLINE, 'Decline', true, true, true],
    ])
    expect(optionLines(sim, card, opts[1]!)).toEqual([
      { text: 'Next job in 1 day', tone: 'neutral' },
    ])
    sim.state.districts.downtown!.satisfaction = 47
    const q = acceptOffer(sim)
    expect(q).toMatchObject({ status: 'active', acceptedTick: sim.state.tick })
    expect(q.deadlineTick).toBe(sim.state.tick + 5 * DAY) // cheer_up limitDays
    expect(q.progress).toMatchObject({ kind: 'satisfactionAtLeast', start: 47 })
    expect(sim.state.events.open).toBeNull()
  })

  it('Accept of a magic job: the golden parcel spawns at once (quest stream only)', () => {
    const sim = playing(2)
    buy(sim, 'bike')
    sim.state.lane.quarantine.count = 1
    const main = sim.state.rng
    const spawned = collect(sim, 'parcel:spawned')
    offerQuest(sim, 'magic_parcel')
    const q = acceptOffer(sim)
    expect(spawned).toHaveLength(1)
    expect(sim.state.spawn.magicAlive).toBe(1)
    expect(q.progress).toMatchObject({
      kind: 'magicParcel',
      parcelId: spawned[0]!.id,
    })
    expect(sim.state.rng).toBe(main)
  })

  it('a magic job nobody can carry: Accept closes the card withdrawn (applied, quest-expired) and starts the decline cooldown', () => {
    const sim = playing(3)
    const q = offerQuest(sim, 'magic_parcel')
    const withdrawn = collect(sim, 'event:withdrawn')
    const decided = collect(sim, 'event:decided')
    const res = sim.dispatch({
      kind: 'decideEvent',
      eventId: 'job:magic_parcel',
      option: JOB_ACCEPT,
    })
    expect(res).toEqual({ ok: false, reason: 'quest-expired', applied: true })
    expect(sim.commandLog.at(-1)?.cmd).toEqual({
      kind: 'decideEvent',
      eventId: 'job:magic_parcel',
      option: 0,
    })
    expect(sim.state.events.open).toBeNull()
    expect(withdrawn).toEqual([{ eventId: 'job:magic_parcel' }])
    expect(decided).toEqual([])
    expect(sim.state.events.history).toMatchObject([
      { outcome: 'withdrawn', option: null },
    ])
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: q.id,
      outcome: 'withdrawn',
      reason: 'unavailable',
    })
    expect(sim.state.quests.jobReadyTick).toBe(sim.state.tick + DAY)
  })

  it('the Golden Release withdraws an open job card (event:withdrawn; a drawn card restarts the timer), and so does debugOfferQuest(golden_release)', () => {
    const sim = deckOn(quietSim(1, ALWAYS_JOBS))
    runTicks(sim, FIRST)
    const card = sim.state.events.open!
    expect(card.drawn).toBe(true)
    const withdrawn = collect(sim, 'event:withdrawn')
    const detach = sim.attachPolicy() // a debug state: tick with the card up
    sim.state.level.level = 5
    runTicks(sim, 1)
    detach()
    expect(withdrawn).toEqual([{ eventId: card.eventId }])
    expect(sim.state.events.open).toBeNull()
    expect(sim.state.quests.offer?.ultimate).toBe(true)
    expect(sim.state.events.nextDrawTick).toBe(FIRST + 1 + card.gapTicks!)
    expect(sim.state.events.stats.withdrawn).toBe(1)

    const b = playing(2)
    offerQuest(b, 'rush_district')
    const w = collect(b, 'event:withdrawn')
    expect(
      b.dispatch({ kind: 'debugOfferQuest', templateId: 'golden_release' }),
    ).toEqual({ ok: true })
    expect(w).toEqual([{ eventId: 'job:rush_district' }])
    expect(b.state.events.open).toBeNull()
    expect(b.state.quests.offer?.ultimate).toBe(true)
  })

  it('?quest= / debugOfferJob: a job card opens now (not drawn, the timer untouched) and holds the sim; an open job card is replaced; another open card refuses', () => {
    const sim = playing(1)
    const q = offerQuest(sim, 'rush_district')
    expect(sim.state.events.open).toMatchObject({
      eventId: 'job:rush_district',
      questId: q.id,
      drawn: false,
      gapTicks: null,
    })
    expect(sim.state.events.nextDrawTick).toBe(LATER)
    const t = sim.state.tick
    runTicks(sim, 30)
    expect(sim.state.tick).toBe(t)
    const w = collect(sim, 'event:withdrawn')
    const q2 = offerQuest(sim, 'big_haul')
    expect(w).toEqual([{ eventId: 'job:rush_district' }])
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: q.id,
      outcome: 'withdrawn',
    })
    expect(sim.state.events.open?.questId).toBe(q2.id)
    sim.dispatch({ kind: 'declineQuest', questId: q2.id })
    sim.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_wx_rain' })
    expect(
      sim.dispatch({ kind: 'debugOfferQuest', templateId: 'rush_district' }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })
})

describe('the hold (B3 §6, D-8, D-9)', () => {
  it('no policy: Sim.tick() leaves tick and revision unchanged and draws nothing while a card is open', () => {
    const sim = deckOn(quietSim(1, ALWAYS_JOBS))
    runTicks(sim, FIRST)
    expect(sim.state.events.open).not.toBeNull()
    const words = (): number[] => [
      sim.state.rng,
      sim.state.events.rng,
      sim.state.events.picks.rng,
      sim.state.quests.rng,
      sim.state.applicants.rng,
    ]
    const before = {
      tick: sim.state.tick,
      revision: sim.revision,
      words: words(),
      hash: stateHash(sim.state),
    }
    runTicks(sim, 100)
    expect(sim.state.tick).toBe(before.tick)
    expect(sim.revision).toBe(before.revision)
    expect(words()).toEqual(before.words)
    expect(stateHash(sim.state)).toBe(before.hash)
    expect(sim.policyAttached).toBe(false)
  })

  it('with createPolicy the sim never holds: every card is decided on the step after it opens', () => {
    withEvents(true, () => {
      const sim = deckOn(makeSim(2))
      const policy = createPolicy(sim, 'competent')
      expect(sim.policyAttached).toBe(true)
      const opened: number[] = []
      const closed: number[] = []
      sim.addTap((name, _p, tick) => {
        if (name === 'event:offered') opened.push(tick)
        if (name === 'event:decided' || name === 'event:withdrawn')
          closed.push(tick)
      })
      for (let t = 0; t < 8 * DAY; t++) {
        policy.step()
        expect(sim.state.events.open).toBeNull()
        sim.tick()
        expect(sim.state.tick).toBe(t + 1)
      }
      policy.dispose?.()
      expect(sim.policyAttached).toBe(false)
      expect(opened.length).toBeGreaterThan(3)
      const last = sim.state.events.open === null ? opened : opened.slice(0, -1)
      expect(closed).toEqual(last)
    })
  })

  it('replay stops at a held card with no logged decision; with the decision logged it reproduces the run', () => {
    const sim = deckOn(makeSim(1, ALWAYS_JOBS))
    runTicks(sim, FIRST)
    const held = replay(sim.data, 1, sim.commandLog, FIRST + 500)
    expect(held.state.tick).toBe(FIRST)
    expect(held.state.events.open).toEqual(sim.state.events.open)
    decideOpen(sim, JOB_DECLINE)
    runTicks(sim, 700)
    const again = replayOf(sim)
    expect(again.state.tick).toBe(sim.state.tick)
    expect(stateHash(again.state)).toBe(stateHash(sim.state))
  })
})

describe('the rescue (B3 §3.5, §4.13; critique 16)', () => {
  it('opens rescueDelayS after fleet = 0 ∧ balance < the cheapest vehicle (the loaner, not drawn, depth 1)', () => {
    const sim = playing(1, NO_JOBS)
    sim.state.economy.balance = 100
    runTicks(sim, 1)
    const due = sim.state.events.rescueTick!
    expect(due).toBe(sim.state.tick + RESCUE)
    runTicks(sim, RESCUE - 1)
    expect(sim.state.events.open).toBeNull()
    runTicks(sim, 1)
    expect(sim.state.events.open).toMatchObject({
      eventId: 'ev_luck_loaner',
      kind: 'news',
      drawn: false,
      depth: 1,
      openedTick: due,
    })
    expect(sim.state.events.rescueTick).toBeNull()
  })

  it('the clock runs through the first 200 s; the card opens when the quiet ends', () => {
    const sim = deckOn(quietSim(2, NO_JOBS))
    sim.state.economy.balance = 100
    runTicks(sim, FIRST)
    expect(sim.state.events.open?.eventId).toBe('ev_luck_loaner')
    expect(sim.state.events.open?.openedTick).toBe(FIRST)
  })

  it('never otherwise: a balance that buys a bike, the fleet regained, the deck off', () => {
    const rich = playing(3, NO_JOBS)
    runTicks(rich, 3 * RESCUE)
    expect(rich.state.events.rescueTick).toBeNull()
    expect(rich.state.events.open).toBeNull()

    const regained = playing(4, NO_JOBS)
    regained.state.economy.balance = 100
    runTicks(regained, RESCUE / 2)
    expect(regained.state.events.rescueTick).not.toBeNull()
    buy(regained, 'bike')
    regained.state.economy.balance = 0
    runTicks(regained, 3 * RESCUE)
    expect(regained.state.events.rescueTick).toBeNull()
    expect(regained.state.events.open).toBeNull()

    const off = quietSim(5)
    off.state.economy.balance = 0
    runTicks(off, FIRST + 3 * RESCUE)
    expect(off.state.events.nextDrawTick).toBe(DECK_OFF_TICK)
    expect(off.state.events.open).toBeNull()
  })
})

/** The decision pool's ids now. */
const ids = (sim: Sim): string[] => decisionCandidates(sim).map((c) => c.def.id)

describe('the decision pool (B3 §3.2): once, cooldown, the category rule, running chains', () => {
  it('a once card is never drawn again; a cooldown card waits cooldownDays after it was offered', () => {
    const sim = playing(1)
    sim.state.economy.balance = 10_000
    expect(ids(sim)).toContain('ev_money_grant')
    sim.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_money_grant' })
    decideOpen(sim, 1)
    sim.state.events.lastCategory = null
    expect(ids(sim)).not.toContain('ev_money_grant')
    sim.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_wx_rain' })
    const until = sim.state.events.cooldownUntil.ev_wx_rain!
    expect(until).toBe(sim.state.tick + 5 * DAY)
    decideOpen(sim, 0)
    sim.state.events.lastCategory = null
    expect(ids(sim)).not.toContain('ev_wx_rain')
    runTicks(sim, until - sim.state.tick - 1)
    sim.state.events.lastCategory = null
    expect(ids(sim)).not.toContain('ev_wx_rain')
    runTicks(sim, 1)
    sim.state.events.lastCategory = null
    expect(ids(sim)).toContain('ev_wx_rain')
    expect(ids(sim)).not.toContain('ev_money_grant')
  })

  it('the previous card’s category is left out while another remains; alone, it stays', () => {
    const d = deckData((x) => x.id === 'ev_wx_rain' || x.id === 'ev_press_ad')
    const sim = new Sim(d, 1)
    expect(decisionCandidates(sim).map((c) => c.def.id)).toEqual([
      'ev_wx_rain',
      'ev_press_ad',
    ])
    sim.state.events.lastCategory = 'weather'
    expect(decisionCandidates(sim).map((c) => c.def.id)).toEqual([
      'ev_press_ad',
    ])
    sim.state.events.cooldownUntil.ev_press_ad = 1e6
    expect(decisionCandidates(sim).map((c) => c.def.id)).toEqual(['ev_wx_rain'])
  })

  it('minLevel, cond, pick candidates and links: never in the pool; a head is out while its chain runs (D-29)', () => {
    const sim = playing(1)
    sim.state.events.lastCategory = null
    const pool = ids(sim)
    expect(pool).not.toContain('ev_crime_gang') // minLevel 2
    expect(pool).not.toContain('ev_crime_gang_watch') // a link
    expect(pool).not.toContain('ev_luck_loaner') // the rescue
    expect(pool).not.toContain('ev_city_audit_day') // a router
    expect(pool).not.toContain('ev_fleet_tyres') // no bike yet
    sim.state.level.level = 2
    expect(ids(sim)).toContain('ev_crime_gang')
    sim.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_crime_gang' })
    decideOpen(sim, 1) // Deny: the chain runs
    sim.state.events.seen = {}
    sim.state.events.lastCategory = null
    expect(ids(sim)).not.toContain('ev_crime_gang')
    sim.state.events.scheduled = []
    expect(ids(sim)).toContain('ev_crime_gang')
    // ev_staff_training needs an inspector to name.
    const audrey = sim.state.employees[0]!
    audrey.absentUntilTick = sim.state.tick + DAY
    expect(ids(sim)).not.toContain('ev_staff_training')
    delete audrey.absentUntilTick
    expect(ids(sim)).toContain('ev_staff_training')
  })

  it('a pick and a target resolve when the card is drawn (picks stream) and fill its text', () => {
    withEvents(true, () => {
      const d = deckData(
        (x) => x.id === 'ev_staff_training' || x.id === 'ev_cust_refund',
        true,
      )
      const sim = deckOn(quiet(new Sim(d, 1)))
      injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
      sim.state.events.nextDrawTick = FIRST
      runTicks(sim, FIRST)
      const open = sim.state.events.open!
      if (open.eventId === 'ev_staff_training') {
        expect(open.pick).toEqual({ role: 'inspector', id: 1, name: 'Audrey' })
        expect(cardOptions(sim, open)[1]!.label).toBe('Send Audrey')
      } else {
        expect(open.target).toBe('highres')
      }
    })
  })
})

describe('the log stays replayable (eventLog sanity)', () => {
  it('every command a card took is logged: a decided run replays to the same hash', () => {
    withEvents(true, () => {
      const sim = deckOn(makeSim(9))
      const log = eventLog(sim)
      for (let t = 0; t < 4 * DAY; t++) {
        const open = sim.state.events.open
        if (open !== null) {
          const opts = cardOptions(sim, open).filter(
            (o) => o.visible && o.affordable,
          )
          decideOpen(sim, opts[opts.length - 1]!.index)
        }
        sim.tick()
      }
      expect(log.some((e) => e.name === 'event:decided')).toBe(true)
      const again = replayOf(sim)
      expect(stateHash(again.state)).toBe(stateHash(sim.state))
    })
  })
})
