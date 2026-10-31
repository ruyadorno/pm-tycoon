// Build 3 M11 — chains (spec-build3 §3.7, §3.3, §6; plan-build3 §8.2 task 8;
// M11 contract §3B): a `next` books a link due `days × 600` ticks later (the
// parent's label, the head's id, depth + 1), flags set / clear, a
// conditional next resolved when DUE (not when booked), routers, a link
// whose cond fails dropped, a link inheriting the head's target and pick, a
// pick whose person left, the chain counters and the chainDone ticker line,
// decideEvent's failure reasons and its generated lines, save / load
// mid-chain (the scheduled links, an open card, the flags and the draw timer
// survive; the hash matches after the same ticks) and two-run determinism
// with the seed deck under the competent policy.

import { describe, expect, it } from 'vitest'
import { buildGameData } from '../../src/data/index.ts'
import type { EventDef, EventsData } from '../../src/data/types.ts'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { auditState, replay, Sim, stateHash } from '../../src/sim/sim.ts'
import type { SimSnapshot } from '../../src/sim/sim.ts'
import {
  cardOptions,
  condHolds,
  DECK_OFF_TICK,
  fillCardText,
  optionLines,
} from '../../src/sim/systems/deck.ts'
import { effectSummary } from '../../src/sim/systems/effects.ts'
import {
  laneNode,
  liveSlotIds,
  TICKS_PER_DAY,
  ticksFromS,
} from '../../src/sim/types.ts'
import { loadRawData } from '../../tools/sim/load.node.ts'
import {
  collect,
  dataFixture,
  decideOpen,
  fund,
  injectParcel,
  makeSim,
  placeMachine,
  quiet,
  quietSim,
  runTicks,
  runUntil,
} from './helpers.ts'

const data = dataFixture()
const DAY = TICKS_PER_DAY
const FIRST = ticksFromS(data.events.schedule.firstEventS)

/** A synthetic two-card chain: a head with a target and a pick, a link that names both. */
const VIP: EventDef[] = [
  {
    id: 'ev_t_vip',
    category: 'customers',
    title: 'A visitor',
    body: '{inspector} meets a buyer from {district}.',
    target: 'busiest',
    pick: 'inspector',
    options: [
      {
        label: 'Show them round',
        effects: [{ kind: 'next', eventId: 'ev_t_vip_back', days: 1 }],
      },
      { label: 'Not today', default: true, effects: [] },
    ],
  },
  {
    id: 'ev_t_vip_back',
    category: 'customers',
    title: 'The visitor is back',
    drawable: false,
    body: '{inspector} sees the buyer from {district} again.',
    options: [
      {
        label: 'Train {inspector}',
        effects: [
          {
            kind: 'pips',
            role: 'inspector',
            stat: 'eye',
            delta: 1,
            scope: 'one',
          },
        ],
      },
      {
        label: 'Wave',
        default: true,
        effects: [{ kind: 'satisfaction', scope: 'target', delta: 1 }],
      },
    ],
  },
]

/** The shipped tables plus extra deck cards. */
function withCards(extra: EventDef[]) {
  const raw = loadRawData()
  const events = raw.events as EventsData
  events.deck = [...events.deck, ...extra]
  return buildGameData(raw)
}

/** A quiet deck-off sim past the first 200 s (links wait out the first 200 s like any card). */
function playing(seed = 1, simData = data): Sim {
  const sim = quiet(new Sim(simData, seed))
  sim.state.events.nextDrawTick = DECK_OFF_TICK
  runTicks(sim, FIRST)
  return fund(sim, 10_000)
}

/** Offer a deck card now (debugOfferEvent), throwing when refused. */
function offer(sim: Sim, eventId: string): void {
  const res = sim.dispatch({ kind: 'debugOfferEvent', eventId })
  if (!res.ok) throw new Error(`offer ${eventId}: ${res.reason}`)
}

/** C's effectSummary produces lines (stream C landed): the pick-left line can be checked. */
const summariesLanded =
  effectSummary(data as never, [{ kind: 'money', delta: 1 }], {
    target: null,
    pick: null,
    eventId: 'x',
    title: 'x',
  }).length > 0

describe('links (B3 §3.7)', () => {
  it('a next books {eventId, due = tick + days × 600, depth + 1, the parent label, the head id}; the link opens when due, not drawn, with "You chose"', () => {
    const sim = playing()
    offer(sim, 'ev_crime_gang')
    const t = sim.state.tick
    decideOpen(sim, 1) // Refuse
    expect(sim.state.events.scheduled).toEqual([
      {
        eventId: 'ev_crime_gang_watch',
        branches: null,
        dueTick: t + DAY,
        target: null,
        pick: null,
        parentChoice: 'Refuse',
        chainHeadId: 'ev_crime_gang',
        depth: 2,
        bookedTick: t,
      },
    ])
    const offered = collect(sim, 'event:offered')
    runTicks(sim, DAY - 1)
    expect(sim.state.events.open).toBeNull()
    runTicks(sim, 1)
    expect(sim.state.events.open).toMatchObject({
      eventId: 'ev_crime_gang_watch',
      kind: 'decision',
      category: 'underworld',
      openedTick: t + DAY,
      parentChoice: 'Refuse',
      chainHeadId: 'ev_crime_gang',
      depth: 2,
      drawn: false,
      gapTicks: null,
    })
    expect(offered).toEqual([
      {
        eventId: 'ev_crime_gang_watch',
        kind: 'decision',
        category: 'underworld',
        chain: true,
        questId: null,
      },
    ])
    expect(sim.state.events.scheduled).toEqual([])
    // The hold: the link waits for its answer.
    runTicks(sim, 50)
    expect(sim.state.tick).toBe(t + DAY)
  })

  it('several links: due order is (dueTick, booking order); each opens after the previous closes', () => {
    const sim = playing()
    offer(sim, 'ev_crime_gang')
    decideOpen(sim, 1) // watch in 1 day
    offer(sim, 'ev_city_audit')
    decideOpen(sim, 1) // Wing it: the audit day in 2 days
    const t = sim.state.tick
    for (const l of sim.state.events.scheduled) l.dueTick = t + 5
    runTicks(sim, 5)
    expect(sim.state.events.open?.eventId).toBe('ev_crime_gang_watch')
    decideOpen(sim, 0)
    runTicks(sim, 1)
    // The audit router resolved now: the lane is below 95 % with no flag.
    expect(sim.state.events.open?.eventId).toBe('ev_city_audit_fail')
  })

  it('flags: set and clear (data order), read by flag / notFlag', () => {
    const sim = playing()
    offer(sim, 'ev_crime_gang_return')
    decideOpen(sim, 0) // Pay ($500): flag gang_paid
    expect(sim.state.events.flags).toEqual({ gang_paid: true })
    const refs = { target: null, pick: null }
    expect(condHolds(sim, { flag: 'gang_paid' }, refs)).toBe(true)
    expect(condHolds(sim, { notFlag: 'gang_paid' }, refs)).toBe(false)
    expect(
      condHolds(
        sim,
        { anyOf: [{ flag: 'nope' }, { flag: 'gang_paid' }] },
        refs,
      ),
    ).toBe(true)
    const clearer: EventDef = {
      id: 'ev_t_clear',
      category: 'luck',
      title: 'Clean slate',
      body: 'Forget it all.',
      options: [
        {
          label: 'OK',
          default: true,
          effects: [
            { kind: 'flag', set: 'fresh' },
            { kind: 'flag', clear: 'gang_paid' },
          ],
        },
      ],
    }
    const b = playing(1, withCards([clearer]))
    b.state.events.flags.gang_paid = true
    offer(b, 'ev_t_clear')
    decideOpen(b, 0)
    expect(b.state.events.flags).toEqual({ fresh: true })
  })

  it('a conditional branch is evaluated when due, not when booked (the flag flipped in between); routers resolve the same way', () => {
    for (const flip of [false, true]) {
      const sim = playing(2)
      offer(sim, 'ev_city_audit')
      const opts = cardOptions(sim, sim.state.events.open!)
      expect(opts[1]!.label).toBe('Wing it')
      decideOpen(sim, 1) // no consultant: the router books with no flag
      expect(sim.state.events.scheduled[0]).toMatchObject({
        eventId: 'ev_city_audit_day',
        branches: null,
      })
      if (flip) sim.state.events.flags.audit_ready = true
      runUntil(sim, () => sim.state.events.open !== null, 3 * DAY)
      expect(sim.state.events.open?.eventId).toBe(
        flip ? 'ev_city_audit_pass' : 'ev_city_audit_fail',
      )
      expect(sim.state.events.open).toMatchObject({
        parentChoice: 'Wing it',
        chainHeadId: 'ev_city_audit',
        depth: 2,
      })
    }

    // The conditional next on the fail card: the lane's catch rate when due.
    for (const fix of [false, true]) {
      const sim = playing(3)
      offer(sim, 'ev_city_audit_fail')
      const card = sim.state.events.open!
      const fixFirst = cardOptions(sim, card)[1]!
      expect(fixFirst.hint).toBe('catch rate in 2 days (95 %+)')
      expect(optionLines(sim, card, fixFirst).map((l) => l.text)).toContain(
        'Outcome depends on catch rate in 2 days (95 %+)',
      )
      decideOpen(sim, 1) // Fix it first
      expect(sim.state.events.scheduled[0]).toMatchObject({
        eventId: null,
        branches: [
          { if: { laneRateAtLeast: 0.95 }, id: 'ev_city_audit_pass' },
          { id: 'ev_city_audit_fine' },
        ],
      })
      expect(condHolds(sim, { laneRateAtLeast: 0.95 }, card)).toBe(false)
      if (fix) {
        const free = liveSlotIds(sim.state.lane).find(
          (id) => laneNode(sim.state.lane, id)?.fixture === null,
        )!
        placeMachine(sim, 'metal_detector', free)
      }
      fund(sim, 10_000)
      runUntil(sim, () => sim.state.events.open !== null, 3 * DAY)
      expect(sim.state.events.open?.eventId).toBe(
        fix ? 'ev_city_audit_pass' : 'ev_city_audit_fine',
      )
    }
  })

  it('a debug offer of a router resolves it now', () => {
    const sim = playing()
    offer(sim, 'ev_city_audit_day')
    expect(sim.state.events.open?.eventId).toBe('ev_city_audit_fail')
    decideOpen(sim, 0)
    sim.state.events.flags.audit_ready = true
    offer(sim, 'ev_city_audit_day')
    expect(sim.state.events.open).toMatchObject({
      eventId: 'ev_city_audit_pass',
      chainHeadId: 'ev_city_audit_pass',
      depth: 1,
    })
  })

  it('a link whose cond fails when due is dropped: no card, nothing left scheduled, the timer untouched', () => {
    const sim = playing(4)
    offer(sim, 'ev_city_audit_fail')
    decideOpen(sim, 1) // Fix it first → the fine (cond balanceAtLeast 400) unless the lane passes
    sim.state.economy.balance = 100
    const offered = collect(sim, 'event:offered')
    runTicks(sim, 3 * DAY)
    expect(offered).toEqual([])
    expect(sim.state.events.open).toBeNull()
    expect(sim.state.events.scheduled).toEqual([])
    expect(sim.state.events.nextDrawTick).toBe(DECK_OFF_TICK)
  })

  it('a link inherits the head’s resolved target and pick (the text names them)', () => {
    const d = withCards(VIP)
    const sim = playing(5, d)
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe') // highres the busiest
    offer(sim, 'ev_t_vip')
    const head = sim.state.events.open!
    expect(head.target).toBe('highres')
    expect(head.pick).toEqual({ role: 'inspector', id: 1, name: 'Audrey' })
    expect(fillCardText(d, VIP[0]!.body!, head)).toBe(
      'Audrey meets a buyer from Node Heights.',
    )
    decideOpen(sim, 0)
    injectParcel(sim, 'dt_registry_tower', 'hr_towers_a')
    injectParcel(sim, 'dt_peer_plaza', 'hr_towers_a') // downtown busiest now
    runUntil(sim, () => sim.state.events.open !== null, 2 * DAY)
    const link = sim.state.events.open!
    expect(link).toMatchObject({
      eventId: 'ev_t_vip_back',
      target: 'highres',
      pick: { role: 'inspector', id: 1, name: 'Audrey' },
      parentChoice: 'Show them round',
    })
    expect(cardOptions(sim, link)[0]!.label).toBe('Train Audrey')
  })

  it('a pick whose person has left: the `one` effect is a no-op (and its line says so once effects land)', () => {
    const d = withCards(VIP)
    const sim = playing(6, d)
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    offer(sim, 'ev_t_vip')
    decideOpen(sim, 0)
    const audrey = sim.state.employees.find((e) => e.name === 'Audrey')!
    const pips = { ...audrey.pips }
    expect(sim.dispatch({ kind: 'fire', employeeId: audrey.id })).toEqual({
      ok: true,
    })
    runUntil(sim, () => sim.state.events.open !== null, 2 * DAY)
    const link = sim.state.events.open!
    expect(link.pick?.name).toBe('Audrey')
    const train = cardOptions(sim, link)[0]!
    if (summariesLanded) {
      expect(optionLines(sim, link, train).map((l) => l.text)).toContain(
        '(Audrey has left)',
      )
    }
    decideOpen(sim, 0)
    expect(sim.state.employees.some((e) => e.id === audrey.id)).toBe(false)
    expect(audrey.pips).toEqual(pips)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})

describe('decide (B3 §6): failures, lines, history, counters', () => {
  it('no-event, bad-option, option-hidden, cant-afford, invalid at game over — none logged, nothing changed', () => {
    const hidden: EventDef = {
      id: 'ev_t_hidden',
      category: 'money',
      title: 'Insider tip',
      body: 'Only after the audit consultant.',
      options: [
        { label: 'Use it', if: { flag: 'audit_ready' }, effects: [] },
        { label: 'Buy it', cost: 900, effects: [] },
        { label: 'No', default: true, effects: [] },
      ],
    }
    const sim = playing(1, withCards([hidden]))
    sim.state.economy.balance = 100
    expect(
      sim.dispatch({ kind: 'decideEvent', eventId: 'ev_t_hidden', option: 0 }),
    ).toEqual({ ok: false, reason: 'no-event' })
    offer(sim, 'ev_t_hidden')
    const log = sim.commandLog.length
    const hash = stateHash(sim.state)
    const go = (option: number, eventId = 'ev_t_hidden') =>
      sim.dispatch({ kind: 'decideEvent', eventId, option })
    expect(go(0, 'ev_wx_rain')).toEqual({ ok: false, reason: 'no-event' })
    expect(go(3)).toEqual({ ok: false, reason: 'bad-option' })
    expect(go(-1)).toEqual({ ok: false, reason: 'bad-option' })
    expect(go(0)).toEqual({ ok: false, reason: 'option-hidden' })
    expect(go(1)).toEqual({ ok: false, reason: 'cant-afford' })
    sim.state.economy.gameOver = true
    expect(go(2)).toEqual({ ok: false, reason: 'invalid' })
    sim.state.economy.gameOver = false
    expect(sim.commandLog).toHaveLength(log)
    expect(stateHash(sim.state)).toBe(hash)
    const opts = cardOptions(sim, sim.state.events.open!)
    expect(opts.map((o) => [o.visible, o.affordable, o.cost])).toEqual([
      [false, true, 0],
      [true, false, 900],
      [true, true, 0],
    ])
    expect(go(2)).toEqual({ ok: true })
  })

  it('event:decided carries the lines generated before applying; the cost is debited (event); history and counters', () => {
    const sim = playing()
    const decided = collect(sim, 'event:decided')
    const money = collect(sim, 'money:changed')
    offer(sim, 'ev_crime_gang')
    const card = sim.state.events.open!
    const lines = optionLines(sim, card, cardOptions(sim, card)[0]!)
    expect(lines[0]).toEqual({ text: '−$300', tone: 'cost' })
    const deny = optionLines(sim, card, cardOptions(sim, card)[1]!)
    expect(deny.map((l) => l.text)).toEqual([
      '…then: On the doorstep (in 1 day)',
    ])
    const before = sim.state.economy.balance
    decideOpen(sim, 0)
    expect(sim.state.economy.balance).toBe(before - 300)
    expect(money.at(-1)).toMatchObject({ delta: -300, reason: 'event' })
    expect(decided).toEqual([
      {
        eventId: 'ev_crime_gang',
        option: 0,
        label: 'Pay up ($300)',
        default: false,
        kind: 'decision',
        effects: lines.map((l) => l.text),
      },
    ])
    expect(sim.state.events.history.at(-1)).toMatchObject({
      eventId: 'ev_crime_gang',
      option: 0,
      label: 'Pay up ($300)',
      default: false,
      outcome: 'decided',
      chainHeadId: 'ev_crime_gang',
      depth: 1,
    })
    expect(sim.state.events.stats).toMatchObject({
      offered: 1,
      decided: 1,
      chainsStarted: 0,
    })
  })

  it('chainsStarted when a head books a link; chainsFinished + the chainDone ticker line when a link books nothing', () => {
    const sim = playing()
    const news = collect(sim, 'ticker:news')
    offer(sim, 'ev_crime_gang')
    decideOpen(sim, 1)
    expect(sim.state.events.stats.chainsStarted).toBe(1)
    runUntil(sim, () => sim.state.events.open !== null, 2 * DAY)
    decideOpen(sim, 0) // Hide the fleet: the return in 2 days
    expect(sim.state.events.stats.chainsFinished).toBe(0)
    runUntil(sim, () => sim.state.events.open !== null, 3 * DAY)
    expect(sim.state.events.open?.eventId).toBe('ev_crime_gang_return')
    expect(sim.state.events.open?.depth).toBe(3)
    decideOpen(sim, 0) // Pay: the story ends
    expect(sim.state.events.stats.chainsFinished).toBe(1)
    expect(news.filter((n) => n.kind === 'event').map((n) => n.text)).toContain(
      'Protection — the story ends',
    )
    expect(news.filter((n) => n.kind === 'event').map((n) => n.text)).toContain(
      'UNDERWORLD: Protection',
    )
  })

  it('history keeps the last historyMax records', () => {
    const sim = playing()
    const max = sim.data.events.schedule.historyMax
    for (let i = 0; i < max + 5; i++) {
      offer(sim, 'ev_wx_rain')
      decideOpen(sim, 0)
    }
    expect(sim.state.events.history).toHaveLength(max)
    expect(auditState(sim.state, sim.data)).toEqual([])
    sim.state.events.history.push(sim.state.events.history[0]!)
    expect(auditState(sim.state, sim.data)).toContain(
      `events.history: ${max + 1} records > historyMax ${max}`,
    )
  })
})

describe('save / load and determinism (B3 §6; plan.md §6.4)', () => {
  it('save and load mid-chain: the scheduled links, an open card, the flags and nextDrawTick survive; the same ticks give the same hash', () => {
    const sim = fund(makeSim(7), 5_000)
    runTicks(sim, FIRST)
    offer(sim, 'ev_city_audit')
    decideOpen(sim, 0) // the consultant: flag + the audit day in 2 days
    offer(sim, 'ev_crime_gang')
    decideOpen(sim, 1) // Refuse: the watch in 1 day
    offer(sim, 'ev_wx_rain') // open at the save
    const snap = JSON.parse(JSON.stringify(sim.snapshot())) as SimSnapshot
    const loaded = Sim.load(sim.data, snap)
    expect(loaded.state.events.open).toEqual(sim.state.events.open)
    expect(loaded.state.events.scheduled).toEqual(sim.state.events.scheduled)
    expect(loaded.state.events.scheduled).toHaveLength(2)
    expect(loaded.state.events.flags).toEqual({ audit_ready: true })
    expect(loaded.state.events.nextDrawTick).toBe(DECK_OFF_TICK)
    expect(stateHash(loaded.state)).toBe(stateHash(sim.state))
    // Held: neither moves until the card is answered.
    runTicks(loaded, 10)
    expect(loaded.state.tick).toBe(sim.state.tick)
    for (const s of [sim, loaded]) {
      decideOpen(s, 0)
      for (let t = 0; t < 3 * DAY; t++) {
        if (s.state.events.open !== null) decideOpen(s, 0)
        s.tick()
      }
    }
    expect(stateHash(loaded.state)).toBe(stateHash(sim.state))
    expect(loaded.state.events.history.map((h) => h.eventId)).toContain(
      'ev_city_audit_pass',
    )
    expect(auditState(loaded.state, loaded.data)).toEqual([])
    // A damaged reference is named on load.
    const bad = JSON.parse(JSON.stringify(sim.snapshot())) as SimSnapshot
    bad.state.events.flags = {}
    bad.state.events.scheduled.push({
      eventId: 'ev_nope',
      branches: null,
      dueTick: 1,
      target: null,
      pick: null,
      parentChoice: 'x',
      chainHeadId: 'ev_city_audit',
      depth: 2,
      bookedTick: 0,
    })
    expect(() => Sim.load(sim.data, bad)).toThrow(/ev_nope/)
  })

  it('two runs, same seed, the seed deck with decisions on and the competent policy: the same hash and history; the replay matches', () => {
    const was = SIM_FEATURES.events
    SIM_FEATURES.events = true
    try {
      const run = (): Sim => {
        const sim = new Sim(data, 3)
        const policy = createPolicy(sim, 'competent')
        for (let t = 0; t < 14 * DAY; t++) {
          policy.step()
          sim.tick()
        }
        policy.dispose?.()
        return sim
      }
      const a = run()
      const b = run()
      expect(stateHash(a.state)).toBe(stateHash(b.state))
      expect(a.state.events.history).toEqual(b.state.events.history)
      expect(a.state.events.stats.offered).toBeGreaterThan(5)
      expect(a.commandLog).toEqual(b.commandLog)
      const again = replay(a.data, 3, a.commandLog, a.state.tick)
      expect(stateHash(again.state)).toBe(stateHash(a.state))
    } finally {
      SIM_FEATURES.events = was
    }
  }, 60_000)
})

describe('the deck-off test sims (D-8)', () => {
  it('makeSim and quietSim make no automatic card; links booked by a debug card still come', () => {
    const sim = quietSim(8)
    runTicks(sim, FIRST + 3 * DAY)
    expect(sim.state.events.stats.offered).toBe(0)
    expect(sim.state.events.stats.blanks).toBe(0)
    offer(sim, 'ev_crime_gang')
    decideOpen(sim, 1)
    runTicks(sim, DAY)
    expect(sim.state.events.open?.eventId).toBe('ev_crime_gang_watch')
  })
})
