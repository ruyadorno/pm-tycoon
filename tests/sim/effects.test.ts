// Build 3 event effects (spec-build3 §3.5; M11 contract §3 stream C; plan-
// build3 §8.2 task 8): every world kind applies through effects.ts
// applyEffect and has its generated summary line — money (a cost clamped to
// the balance, moneyPct rounded on a low balance), lives (a life gained at
// the cap, a life lost at 1 → game over with cause 'event'), satisfaction,
// modifiers (every key has words), pips, vehicle lose (the last vehicle: the
// line, the ticker, no refund, cargo back, the driver `worker:fired
// {event}`) and gain (a volunteer driver: no pool eviction, fee 0, paid
// price 0), staff quit (the only inspector leaves a pass-through desk), ★,
// absence (unpaid at payday, the desk re-syncs, the vehicle parks and
// returns), wanted (nothing left), parcels spawn / lose (conservation), the
// shelf cap across a level-up, end — and auditState stays clean after each.

import { describe, expect, it } from 'vitest'
import type { EventEffect, StarApplicantDef } from '../../src/data/types.ts'
import { auditState, conservation, type Sim } from '../../src/sim/sim.ts'
import { sellRefund } from '../../src/sim/systems/economy.ts'
import {
  absenceStep,
  applyEffect,
  dayText,
  effectSummary,
  MINUS,
  modifierLine,
  type EffectCtx,
  type EffectLine,
} from '../../src/sim/systems/effects.ts'
import { pickCandidates } from '../../src/sim/systems/deck.ts'
import { isActiveSlot } from '../../src/sim/systems/lane.ts'
import { forceLevel } from '../../src/sim/systems/levels.ts'
import { salaryOf } from '../../src/sim/systems/people.ts'
import { offerJob, rewardSummary } from '../../src/sim/systems/quests.ts'
import { hasDriver } from '../../src/sim/systems/vehicles.ts'
import type { CardPick, DistrictId, Parcel } from '../../src/sim/types.ts'
import { laneNode } from '../../src/sim/types.ts'
import {
  buy,
  collect,
  dataFixture,
  fund,
  hireInspector,
  injectParcel,
  quiet,
  quietSim,
  runTicks,
  runUntil,
  shelveParcel,
  standardApplicant,
} from './helpers.ts'

const data = dataFixture()
const M = MINUS

function ctxOf(over: Partial<EffectCtx> = {}): EffectCtx {
  return {
    eventId: 'ev_test',
    title: 'Test card',
    optionLabel: 'Do it',
    optionIndex: 0,
    target: null,
    pick: null,
    chainHeadId: 'ev_test',
    depth: 1,
    ...over,
  }
}

function lines(
  sim: Sim,
  effects: readonly EventEffect[],
  refs: { target?: DistrictId | null; pick?: CardPick | null } = {},
): EffectLine[] {
  return effectSummary(sim, effects, {
    eventId: 'ev_test',
    title: 'Test card',
    target: refs.target ?? null,
    pick: refs.pick ?? null,
  })
}

const texts = (ls: readonly EffectLine[]): string[] => ls.map((l) => l.text)

/** auditState clean and the conservation identity holding. */
function clean(sim: Sim): void {
  expect(auditState(sim.state, sim.data)).toEqual([])
  expect(conservation(sim.state).ok).toBe(true)
}

const audrey: CardPick = { role: 'inspector', id: 1, name: 'Audrey' }

describe('money (B3 §3.5: balance only, a cost clamped to the balance)', () => {
  it('a gain credits the balance — never lifetime earned — and a cost debits it, clamped to the balance', () => {
    const sim = quietSim(1)
    sim.state.economy.balance = 100
    const earned = sim.state.economy.lifetimeEarned
    const money = collect(sim, 'money:changed')
    applyEffect(sim, ctxOf(), { kind: 'money', delta: 60 })
    expect(sim.state.economy.balance).toBe(160)
    expect(sim.state.economy.lifetimeEarned).toBe(earned)
    applyEffect(sim, ctxOf(), { kind: 'money', delta: -40 })
    expect(sim.state.economy.balance).toBe(120)
    sim.state.economy.balance = 25
    applyEffect(sim, ctxOf(), { kind: 'money', delta: -40 })
    expect(sim.state.economy.balance).toBe(0)
    expect(money).toEqual([
      { delta: 60, reason: 'event', balance: 160 },
      { delta: -40, reason: 'event', balance: 120 },
      { delta: -25, reason: 'event', balance: 0 },
    ])
    applyEffect(sim, ctxOf(), { kind: 'money', delta: -40 }) // nothing left: no event
    expect(money).toHaveLength(3)
    expect(
      lines(sim, [
        { kind: 'money', delta: 60 },
        { kind: 'money', delta: -40 },
      ]),
    ).toEqual([
      { text: '+$60', tone: 'gain' },
      { text: `${M}$40`, tone: 'cost' },
    ])
    clean(sim)
  })

  it('review sim-2: a loss the balance cuts short reads what it takes, in data order through a running balance (B3 §3.3)', () => {
    const sim = quietSim(1)
    buy(sim, 'bike')
    buy(sim, 'bike')
    sim.state.economy.balance = 30
    const effects: EventEffect[] = [
      { kind: 'money', delta: -200 },
      { kind: 'money', delta: 50 },
      { kind: 'moneyPct', pct: -0.1 },
      { kind: 'moneyPerVehicle', delta: -40 },
      { kind: 'money', delta: -10 },
    ]
    expect(lines(sim, effects)).toEqual([
      { text: `${M}$30 (all you have)`, tone: 'cost' },
      { text: '+$50', tone: 'gain' },
      { text: `${M}$5 (10 % of the balance)`, tone: 'cost' },
      { text: `${M}$45 (all you have)`, tone: 'cost' },
      { text: '$0 (nothing to take)', tone: 'neutral' },
    ])
    // The sim moves exactly that: −30, +50, −5, −45, 0.
    const money = collect(sim, 'money:changed')
    for (const e of effects) applyEffect(sim, ctxOf(), e)
    expect(money.map((m) => m.delta)).toEqual([-30, 50, -5, -45])
    expect(sim.state.economy.balance).toBe(0)
    // An explicit balance (deck.ts optionLines: the balance less the cost).
    sim.state.economy.balance = 1000
    expect(
      effectSummary(
        sim,
        [{ kind: 'money', delta: -200 }],
        {
          eventId: 'ev_test',
          title: 'Test card',
          target: null,
          pick: null,
        },
        150,
      ).map((l) => l.text),
    ).toEqual([`${M}$150 (all you have)`])
    clean(sim)
  })

  it('moneyPerVehicle: delta × the owned vehicles (of the type when set)', () => {
    const sim = quietSim(1)
    buy(sim, 'bike')
    buy(sim, 'bike')
    buy(sim, 'van')
    fund(sim, 500)
    expect(
      lines(sim, [
        { kind: 'moneyPerVehicle', delta: -40 },
        { kind: 'moneyPerVehicle', delta: -30, type: 'van' },
        { kind: 'moneyPerVehicle', delta: -50, type: 'truck' },
        { kind: 'moneyPerVehicle', delta: 20, type: 'bike' },
      ]),
    ).toEqual([
      { text: `${M}$120 ($40 × 3 vehicles)`, tone: 'cost' },
      { text: `${M}$30 ($30 × 1 van)`, tone: 'cost' },
      { text: '$0 (no trucks)', tone: 'neutral' },
      { text: '+$40 ($20 × 2 bikes)', tone: 'gain' },
    ])
    applyEffect(sim, ctxOf(), { kind: 'moneyPerVehicle', delta: -40 })
    expect(sim.state.economy.balance).toBe(380)
    applyEffect(sim, ctxOf(), {
      kind: 'moneyPerVehicle',
      delta: -30,
      type: 'van',
    })
    expect(sim.state.economy.balance).toBe(350)
    applyEffect(sim, ctxOf(), {
      kind: 'moneyPerVehicle',
      delta: -50,
      type: 'truck',
    })
    expect(sim.state.economy.balance).toBe(350)
    clean(sim)
  })

  it('moneyPct: |balance × pct| rounded to whole dollars (symmetric), on a low balance too', () => {
    const sim = quietSim(1)
    const eco = sim.state.economy
    eco.balance = 700
    expect(lines(sim, [{ kind: 'moneyPct', pct: -0.08 }])).toEqual([
      { text: `${M}$56 (8 % of the balance)`, tone: 'cost' },
    ])
    applyEffect(sim, ctxOf(), { kind: 'moneyPct', pct: -0.08 })
    expect(eco.balance).toBe(644)
    eco.balance = 13 // 1.04 → $1
    applyEffect(sim, ctxOf(), { kind: 'moneyPct', pct: -0.08 })
    expect(eco.balance).toBe(12)
    eco.balance = 25 // 2.5 → $3 both ways (no half-down on the cost side)
    applyEffect(sim, ctxOf(), { kind: 'moneyPct', pct: -0.1 })
    expect(eco.balance).toBe(22)
    eco.balance = 25
    applyEffect(sim, ctxOf(), { kind: 'moneyPct', pct: 0.1 })
    expect(eco.balance).toBe(28)
    eco.balance = 6 // 0.48 → $0: nothing moves
    const money = collect(sim, 'money:changed')
    expect(lines(sim, [{ kind: 'moneyPct', pct: -0.08 }])).toEqual([
      { text: '$0 (8 % of the balance)', tone: 'neutral' },
    ])
    applyEffect(sim, ctxOf(), { kind: 'moneyPct', pct: -0.08 })
    expect(eco.balance).toBe(6)
    expect(money).toEqual([])
    eco.balance = 81
    expect(texts(lines(sim, [{ kind: 'moneyPct', pct: 0.12 }]))).toEqual([
      '+$10 (12 % of the balance)',
    ])
    clean(sim)
  })
})

describe('lives (B3 §3.5, Q-B3-4: the last life included)', () => {
  it('+1 life up to the cap (life:gained {event}, events.stats.livesGained); at the cap "+1 life (already 5)" and nothing happens', () => {
    const sim = quietSim(1)
    const eco = sim.state.economy
    const cap = data.economy.lives.cap
    expect(eco.lives).toBe(3)
    const gained = collect(sim, 'life:gained')
    expect(lines(sim, [{ kind: 'lives', delta: 1 }])).toEqual([
      { text: '+1 life', tone: 'gain' },
    ])
    applyEffect(sim, ctxOf(), { kind: 'lives', delta: 1 })
    expect(eco.lives).toBe(4)
    expect(gained).toEqual([{ lives: 4, delta: 1, reason: 'event' }])
    expect(texts(lines(sim, [{ kind: 'lives', delta: 2 }]))).toEqual([
      `+2 lives (max ${cap})`,
    ])
    eco.lives = cap
    expect(lines(sim, [{ kind: 'lives', delta: 1 }])).toEqual([
      { text: `+1 life (already ${cap})`, tone: 'neutral' },
    ])
    applyEffect(sim, ctxOf(), { kind: 'lives', delta: 1 })
    expect(eco.lives).toBe(cap)
    expect(gained).toHaveLength(1)
    expect(sim.state.events.stats.livesGained).toBe(1)
    clean(sim)
  })

  it('−1 life: life:lost {cause: event}, an event-kind lastLostLife, the wanted list untouched', () => {
    const sim = quietSim(1)
    sim.state.wanted = ['l0dash']
    const lost = collect(sim, 'life:lost')
    expect(lines(sim, [{ kind: 'lives', delta: -1 }])).toEqual([
      { text: `${M}1 life`, tone: 'cost' },
    ])
    applyEffect(sim, ctxOf({ eventId: 'ev_sec_recall', title: 'The recall' }), {
      kind: 'lives',
      delta: -1,
    })
    expect(sim.state.economy.lives).toBe(2)
    expect(sim.state.economy.gameOver).toBe(false)
    expect(lost).toHaveLength(1)
    expect(lost[0]).toMatchObject({
      cause: 'event',
      eventId: 'ev_sec_recall',
      title: 'The recall',
      option: 'Do it',
      lives: 2,
    })
    expect(sim.state.wanted).toEqual(['l0dash'])
    expect(sim.state.stats.livesLost).toBe(1)
    expect(sim.state.events.stats.livesLost).toBe(1)
    clean(sim)
  })

  it('a life lost at 1 → gameOver, game:over {cause: event}, lastLostLife.kind event — the line warns "this can end the run"', () => {
    const sim = quietSim(1)
    sim.state.economy.lives = 1
    expect(lines(sim, [{ kind: 'lives', delta: -1 }])).toEqual([
      { text: `${M}1 life — this can end the run`, tone: 'cost' },
    ])
    const over = collect(sim, 'game:over')
    const lost = collect(sim, 'life:lost')
    applyEffect(
      sim,
      ctxOf({
        eventId: 'ev_sec_recall',
        title: 'The recall',
        optionLabel: 'Take the strike',
      }),
      { kind: 'lives', delta: -1 },
    )
    expect(sim.state.economy.lives).toBe(0)
    expect(sim.state.economy.gameOver).toBe(true)
    expect(over).toEqual([{ cause: 'event' }])
    expect(lost).toHaveLength(1)
    expect(sim.state.lastLostLife).toEqual({
      kind: 'event',
      tick: sim.state.tick,
      eventId: 'ev_sec_recall',
      title: 'The recall',
      option: 'Take the strike',
      livesLeft: 0,
    })
    clean(sim)
  })

  it('−2 at 1 life takes one life and stops at game over (one life:lost, one game:over)', () => {
    const sim = quietSim(1)
    sim.state.economy.lives = 2
    expect(texts(lines(sim, [{ kind: 'lives', delta: -2 }]))).toEqual([
      `${M}2 lives — this can end the run`,
    ])
    sim.state.economy.lives = 1
    const lost = collect(sim, 'life:lost')
    const over = collect(sim, 'game:over')
    applyEffect(sim, ctxOf(), { kind: 'lives', delta: -2 })
    expect(lost).toHaveLength(1)
    expect(over).toHaveLength(1)
    expect(sim.state.economy.lives).toBe(0)
  })
})

describe('satisfaction (B3 §3.5: scopes resolved now, outside the daily cap)', () => {
  it('all / target / lowest / busiest / a district id; a closed district or no target is a no-op', () => {
    const sim = quietSim(1)
    const d = sim.state.districts
    applyEffect(sim, ctxOf(), { kind: 'satisfaction', scope: 'all', delta: 3 })
    expect([d.highres?.satisfaction, d.downtown?.satisfaction]).toEqual([
      63, 63,
    ])
    applyEffect(sim, ctxOf({ target: 'downtown' }), {
      kind: 'satisfaction',
      scope: 'target',
      delta: -2,
    })
    expect(d.downtown?.satisfaction).toBe(61)
    expect(
      lines(sim, [{ kind: 'satisfaction', scope: 'lowest', delta: 5 }]),
    ).toEqual([{ text: 'Registry Row +5 happiness', tone: 'gain' }])
    applyEffect(sim, ctxOf(), {
      kind: 'satisfaction',
      scope: 'lowest',
      delta: 5,
    })
    expect(d.downtown?.satisfaction).toBe(66)
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(
      texts(lines(sim, [{ kind: 'satisfaction', scope: 'busiest', delta: 2 }])),
    ).toEqual(['Node Heights +2 happiness'])
    applyEffect(sim, ctxOf(), {
      kind: 'satisfaction',
      scope: 'busiest',
      delta: 2,
    })
    expect(d.highres?.satisfaction).toBe(65)
    applyEffect(sim, ctxOf(), {
      kind: 'satisfaction',
      scope: 'industrial',
      delta: 9,
    })
    applyEffect(sim, ctxOf(), {
      kind: 'satisfaction',
      scope: 'target',
      delta: 9,
    })
    expect(d.industrial?.satisfaction).toBe(60)
    expect([d.highres?.satisfaction, d.downtown?.satisfaction]).toEqual([
      65, 66,
    ])
    expect(
      lines(sim, [
        { kind: 'satisfaction', scope: 'all', delta: -2 },
        { kind: 'satisfaction', scope: 'industrial', delta: 3 },
        { kind: 'satisfaction', scope: 'downtown', delta: 3 },
      ]),
    ).toEqual([
      { text: `every district ${M}2 happiness`, tone: 'cost' },
      { text: '+3 happiness (no district)', tone: 'neutral' },
      { text: 'Registry Row +3 happiness', tone: 'gain' },
    ])
    clean(sim)
  })
})

describe('mod (B3 §3.5 / §3.6: a modifier row)', () => {
  it('pushes the row (scope target resolved, untilTick = now + days × 600, permanent = null), modifier:applied', () => {
    const sim = quietSim(1)
    runTicks(sim, 5)
    const applied = collect(sim, 'modifier:applied')
    applyEffect(sim, ctxOf({ target: 'downtown' }), {
      kind: 'mod',
      key: 'spawn',
      mult: 0.8,
      scope: 'target',
      days: 2,
    })
    applyEffect(sim, ctxOf(), { kind: 'mod', key: 'payrollAdd', add: 15 })
    expect(sim.state.modifiers).toEqual([
      {
        id: 'm1',
        key: 'spawn',
        mult: 0.8,
        add: 0,
        scope: 'downtown',
        untilTick: 5 + 1200,
        eventId: 'ev_test',
        label: 'Test card',
        appliedTick: 5,
      },
      {
        id: 'm2',
        key: 'payrollAdd',
        mult: 1,
        add: 15,
        scope: null,
        untilTick: null,
        eventId: 'ev_test',
        label: 'Test card',
        appliedTick: 5,
      },
    ])
    expect(applied.map((a) => a.id)).toEqual(['m1', 'm2'])
    const [spawn, subs] = sim.state.modifiers
    expect(modifierLine(sim, spawn!)).toBe('Registry Row orders +25 %')
    expect(modifierLine(sim, subs!)).toBe('bills +$15/day')
    clean(sim)
  })

  it('the words: × for speed and times, % for rates and money, the arrival rate for spawn, a duration or "for good"', () => {
    const sim = quietSim(1)
    expect(
      lines(
        sim,
        [
          {
            kind: 'mod',
            key: 'speed',
            mult: 0.92,
            scope: 'bike',
            days: 2,
          },
          { kind: 'mod', key: 'inspectorP', add: 0.03, days: 1 },
          { kind: 'mod', key: 'payrollAdd', add: 15 },
          { kind: 'mod', key: 'spawn', mult: 0.8, days: 2 },
          {
            kind: 'mod',
            key: 'spawn',
            mult: 0.8,
            scope: 'target',
            days: 0.5,
          },
          { kind: 'mod', key: 'wrongTossFee', mult: 0 },
          {
            kind: 'mod',
            key: 'processS',
            mult: 1.25,
            scope: 'desk',
            days: 2,
          },
          { kind: 'mod', key: 'income', mult: 1.1, days: 3 },
          { kind: 'mod', key: 'clearanceS', mult: 0.8, scope: 'docks' },
          { kind: 'mod', key: 'malwareShare', add: 0.04, days: 2 },
          { kind: 'mod', key: 'speed', mult: 1.1, days: 2 },
        ],
        { target: 'downtown' },
      ),
    ).toEqual([
      { text: 'bikes ×0.92 speed for 2 days', tone: 'cost' },
      { text: 'desk catch rate +3 % for 1 day', tone: 'gain' },
      { text: 'bills +$15/day for good', tone: 'cost' },
      { text: 'orders +25 % for 2 days', tone: 'gain' },
      { text: 'Registry Row orders +25 % for 12h', tone: 'gain' },
      { text: 'no wrong-toss fee for good', tone: 'gain' },
      { text: 'desk check time ×1.25 for 2 days', tone: 'cost' },
      { text: 'delivery pay +10 % for 3 days', tone: 'gain' },
      { text: 'Shrinkwrap Shore customs time ×0.8 for good', tone: 'gain' },
      { text: 'malware +4 % of parcels for 2 days', tone: 'cost' },
      { text: 'all vehicles ×1.1 speed for 2 days', tone: 'gain' },
    ])
  })

  it('every modifier key has words (no undefined / NaN, no ≥ — D-20), both directions, and mult 0 reads without NaN', () => {
    const sim = quietSim(1)
    const keys = Object.keys(
      data.events.modifiers.goodDirection,
    ) as (keyof typeof data.events.modifiers.goodDirection)[]
    expect(keys.length).toBe(18)
    const mults = new Set([
      'speed',
      'stop',
      'processS',
      'payrollMult',
      'income',
      'spawn',
      'tossBounty',
      'wrongTossFee',
      'vehiclePrice',
      'machinePrice',
      'clearanceS',
    ])
    for (const key of keys) {
      for (const v of mults.has(key) ? [0, 0.5, 1.5] : [-0.05, 0.05]) {
        const e: EventEffect = mults.has(key)
          ? { kind: 'mod', key, mult: v, days: 1 }
          : { kind: 'mod', key, add: v, days: 1 }
        const [l] = lines(sim, [e])
        expect(l, key).toBeDefined()
        expect(l!.text, key).not.toMatch(/undefined|NaN|Infinity|≥/)
        expect(l!.text.endsWith(' for 1 day'), key).toBe(true)
      }
    }
  })

  it('dayText: whole days, else hours', () => {
    expect([dayText(1), dayText(2), dayText(0.5), dayText(1.5)]).toEqual([
      '1 day',
      '2 days',
      '12h',
      '36h',
    ])
  })
})

describe('pips (B3 §3.5: permanent, clamped, salaries kept)', () => {
  it('all drivers: speed +1, charisma −1 — one merged line; clamped 1–5 / 0–2; the salary stays', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike', { speed: 3, energy: 3, charisma: 1 })
    const b = buy(sim, 'bike', { speed: 5, energy: 3, charisma: 0 })
    fund(sim, 500)
    const da = sim.state.employees.find((e) => e.vehicleId === a.id)!
    const db = sim.state.employees.find((e) => e.vehicleId === b.id)!
    const salaries = [da.salaryPerDay, db.salaryPerDay]
    const effects: EventEffect[] = [
      { kind: 'pips', role: 'driver', stat: 'speed', delta: 1, scope: 'all' },
      {
        kind: 'pips',
        role: 'driver',
        stat: 'charisma',
        delta: -1,
        scope: 'all',
      },
    ]
    expect(lines(sim, effects)).toEqual([
      {
        text: `all drivers: speed +1, charisma ${M}1`,
        tone: 'neutral',
      },
    ])
    for (const e of effects) applyEffect(sim, ctxOf(), e)
    expect([da.pips, db.pips]).toEqual([
      { speed: 4, energy: 3, charisma: 0 },
      { speed: 5, energy: 3, charisma: 0 },
    ])
    expect([da.salaryPerDay, db.salaryPerDay]).toEqual(salaries)
    expect(
      texts(
        lines(sim, [
          {
            kind: 'pips',
            role: 'sorter',
            stat: 'judgement',
            delta: 1,
            scope: 'all',
          },
        ]),
      ),
    ).toEqual(['all sorters: judgement +1 (none hired)'])
    clean(sim)
  })

  it('one: the card\'s pick (the desk re-syncs at once); a pick who has left is a no-op, "(Audrey has left)"', () => {
    const sim = quietSim(1)
    const pick = { pick: audrey }
    const effect: EventEffect = {
      kind: 'pips',
      role: 'inspector',
      stat: 'eye',
      delta: 1,
      scope: 'one',
    }
    expect(lines(sim, [effect], pick)).toEqual([
      { text: 'Audrey: eye +1', tone: 'gain' },
    ])
    const desk = laneNode(sim.state.lane, 'slot1')!
    const before = desk.stations[0]?.p
    applyEffect(sim, ctxOf(pick), effect)
    const e = sim.state.employees.find((x) => x.id === 1)!
    expect(e.pips.eye).toBe(4)
    expect(desk.stations[0]?.p).toBe(data.employees.roles.inspector.p[3])
    expect(desk.stations[0]?.p).not.toBe(before)
    clean(sim) // the audit re-derives every station p from the pips
    applyEffect(sim, ctxOf(pick), effect)
    expect(e.pips.eye).toBe(5)
    expect(texts(lines(sim, [effect], pick))).toEqual([
      'Audrey: eye +1 (already 5)',
    ])
    const ghost = { pick: { role: 'inspector', id: 99, name: 'Ghost' } }
    expect(lines(sim, [effect], ghost as never)).toEqual([
      { text: '(Ghost has left)', tone: 'neutral' },
    ])
    applyEffect(sim, ctxOf(ghost as never), effect)
    expect(e.pips.eye).toBe(5)
    clean(sim)
  })
})

describe('vehicle lose (B3 §3.5: the oldest of the type, the last one included)', () => {
  it('the last vehicle: last: true, the line and the ticker, no refund, cargo returned, the driver worker:fired {event}', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    fund(sim, 500)
    const driverId = bike.driverId!
    // Aboard: one inbound parcel (picked up) and one outbound (to deliver).
    const inb = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    const w = sim.state.buildings.hr_towers_a!.waiting
    w.splice(w.indexOf(inb.id), 1)
    Object.assign(inb, { state: 'picked_up', vehicleId: bike.id })
    const out = shelveParcel(sim, 'hr_towers_b', 'dt_peer_plaza')
    laneNode(sim.state.lane, 'shelf')!.queue.pop()
    Object.assign(out, {
      state: 'in_transit_out',
      nodeId: null,
      vehicleId: bike.id,
    })
    bike.cargo.push(inb.id, out.id)
    bike.unitsUsed = 2
    const effect: EventEffect = {
      kind: 'vehicle',
      lose: 'bike',
      fallback: -250,
    }
    expect(lines(sim, [effect])).toEqual([
      { text: 'Bike 1 lost — your last vehicle', tone: 'cost' },
    ])
    const balance = sim.state.economy.balance
    const money = collect(sim, 'money:changed')
    const lost = collect(sim, 'vehicle:lost')
    const fired = collect(sim, 'worker:fired')
    const ticker = collect(sim, 'ticker:news')
    applyEffect(sim, ctxOf({ eventId: 'ev_crime_gang_watch' }), effect)
    expect(sim.state.vehicles).toEqual([])
    expect(sim.state.economy.balance).toBe(balance)
    expect(money).toEqual([])
    expect(lost).toEqual([
      {
        id: bike.id,
        type: 'bike',
        eventId: 'ev_crime_gang_watch',
        last: true,
      },
    ])
    expect(fired).toEqual([
      {
        employeeId: driverId,
        role: 'driver',
        nodeId: null,
        vehicleId: bike.id,
        reason: 'event',
      },
    ])
    expect(ticker).toContainEqual({
      text: 'Bike 1 lost — your last vehicle',
      kind: 'event',
    })
    expect(sim.state.parcels[String(inb.id)]).toMatchObject({
      state: 'in_conveyor',
      vehicleId: null,
    })
    expect(sim.state.parcels[String(inb.id)]?.trace.at(-1)).toMatchObject({
      what: 'unloaded',
      text: 'Unloaded (Bike 1 lost)',
    })
    expect(sim.state.parcels[String(out.id)]?.state).toBe('on_shelf')
    expect(sim.state.events.stats).toMatchObject({
      vehiclesLost: 1,
      workersLost: 1,
    })
    clean(sim)
  })

  it('the oldest of the type (min boughtTick, then id; "any" = the oldest overall)', () => {
    const sim = quietSim(1)
    const van = buy(sim, 'van')
    runTicks(sim, 10)
    const bike1 = buy(sim, 'bike')
    const bike2 = buy(sim, 'bike')
    fund(sim, 5000)
    expect(
      texts(
        lines(sim, [
          { kind: 'vehicle', lose: 'bike', fallback: 0 },
          { kind: 'vehicle', lose: 'any', fallback: 0 },
        ]),
      ),
    ).toEqual([`${bike1.name} lost`, `${van.name} lost`])
    applyEffect(sim, ctxOf(), { kind: 'vehicle', lose: 'bike', fallback: 0 })
    expect(sim.state.vehicles.map((v) => v.id)).toEqual([van.id, bike2.id])
    applyEffect(sim, ctxOf(), { kind: 'vehicle', lose: 'any', fallback: 0 })
    expect(sim.state.vehicles.map((v) => v.id)).toEqual([bike2.id])
    expect(sim.state.events.stats).toMatchObject({
      vehiclesLost: 2,
      workersLost: 2,
    })
    clean(sim)
  })

  it('a pending Replace driver leaves with the vehicle (both worker:fired {event}, both counted)', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    buy(sim, 'bike')
    fund(sim, 5000)
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runUntil(sim, () => bike.state === 'collecting')
    const a = standardApplicant(sim, 'driver')
    expect(
      sim.dispatch({
        kind: 'hire',
        role: 'driver',
        applicantId: a.id,
        target: { vehicleId: bike.id },
      }).ok,
    ).toBe(true)
    expect(bike.nextDriverId).not.toBeNull()
    const ids = [bike.driverId, bike.nextDriverId]
    const fired = collect(sim, 'worker:fired')
    applyEffect(sim, ctxOf(), { kind: 'vehicle', lose: 'bike', fallback: 0 })
    expect(fired.map((f) => [f.employeeId, f.reason])).toEqual(
      ids.map((id) => [id, 'event']),
    )
    expect(sim.state.events.stats.workersLost).toBe(2)
    clean(sim)
  })

  it('none of the type: the fallback money delta (clamped), "−$250 (no bike to lose)"; fallback 0 does nothing', () => {
    const sim = quietSim(1)
    sim.state.economy.balance = 500
    expect(
      lines(sim, [
        { kind: 'vehicle', lose: 'bike', fallback: -250 },
        { kind: 'vehicle', lose: 'truck', fallback: 0 },
        { kind: 'vehicle', lose: 'any', fallback: -50 },
      ]),
    ).toEqual([
      { text: `${M}$250 (no bike to lose)`, tone: 'cost' },
      { text: 'no truck to lose', tone: 'neutral' },
      { text: `${M}$50 (no vehicle to lose)`, tone: 'cost' },
    ])
    // Review sim-2: the lines run through the balance as applyMoney clamps.
    sim.state.economy.balance = 100
    expect(
      lines(sim, [
        { kind: 'vehicle', lose: 'bike', fallback: -250 },
        { kind: 'vehicle', lose: 'any', fallback: -50 },
      ]),
    ).toEqual([
      { text: `${M}$100 (all you have, no bike)`, tone: 'cost' },
      { text: '$0 (nothing to take, no vehicle)', tone: 'neutral' },
    ])
    applyEffect(sim, ctxOf(), { kind: 'vehicle', lose: 'truck', fallback: 0 })
    expect(sim.state.economy.balance).toBe(100)
    applyEffect(sim, ctxOf(), {
      kind: 'vehicle',
      lose: 'bike',
      fallback: -250,
    })
    expect(sim.state.economy.balance).toBe(0)
    expect(sim.state.events.stats.vehiclesLost).toBe(0)
    clean(sim)
  })
})

describe('vehicle gain (B3 §3.5)', () => {
  const mo: StarApplicantDef = {
    role: 'driver',
    name: 'Mo',
    pips: { speed: 3, energy: 3, charisma: 0 },
  }

  it('with a driver: the volunteer drives at once — no pool eviction, fee 0, paid price 0 (refund 0), the normal salary', () => {
    const sim = quietSim(1)
    const zed: StarApplicantDef = { ...mo, name: 'Zed' }
    sim.state.economy.balance = 50
    const pools = structuredClone({
      inspector: sim.state.applicants.inspector,
      sorter: sim.state.applicants.sorter,
      driver: sim.state.applicants.driver,
    })
    const effect: EventEffect = {
      kind: 'vehicle',
      gain: 'bike',
      withDriver: zed,
    }
    expect(lines(sim, [effect])).toEqual([
      { text: '+1 bike, Zed driving', tone: 'gain' },
    ])
    const bought = collect(sim, 'vehicle:bought')
    const hired = collect(sim, 'worker:hired')
    const money = collect(sim, 'money:changed')
    applyEffect(sim, ctxOf(), effect)
    const v = sim.state.vehicles[0]!
    expect(v).toMatchObject({
      type: 'bike',
      state: 'idle_lot',
      purchasePrice: 0,
    })
    expect(bought).toEqual([{ id: v.id, free: true }])
    const e = sim.state.employees.find((x) => x.id === v.driverId)!
    expect(e).toMatchObject({
      role: 'driver',
      name: 'Zed',
      star: true,
      active: true,
      vehicleId: v.id,
      salaryPerDay: salaryOf(data, 'driver', zed.pips, 'bike'),
    })
    expect(hired).toHaveLength(1)
    expect(money).toEqual([])
    expect(sim.state.economy.balance).toBe(50)
    expect({
      inspector: sim.state.applicants.inspector,
      sorter: sim.state.applicants.sorter,
      driver: sim.state.applicants.driver,
    }).toEqual(pools)
    expect(hasDriver(sim, v)).toBe(true)
    expect(sellRefund(sim, v)).toBe(0)
    expect(sim.state.stats.truckTick).toBeNull()
    clean(sim)
  })

  it('a name already taken (staff or a waiting applicant) → "Mo 2"; the pool applicant is kept', () => {
    const sim = quietSim(1)
    const waiting = sim.state.applicants.driver[0]!
    waiting.name = 'Mo'
    const effect: EventEffect = {
      kind: 'vehicle',
      gain: 'bike',
      withDriver: mo,
    }
    expect(texts(lines(sim, [effect]))).toEqual(['+1 bike, Mo 2 driving'])
    applyEffect(sim, ctxOf(), effect)
    expect(sim.state.employees.at(-1)?.name).toBe('Mo 2')
    expect(sim.state.applicants.driver[0]).toEqual(waiting)
    clean(sim)
  })

  it('without a driver: parked `No driver` (vehicle:inactive); a gift truck does not set stats.truckTick (D-22)', () => {
    const sim = quietSim(1)
    const effect: EventEffect = { kind: 'vehicle', gain: 'truck' }
    expect(lines(sim, [effect])).toEqual([
      { text: '+1 truck (no driver)', tone: 'gain' },
    ])
    const inactive = collect(sim, 'vehicle:inactive')
    applyEffect(sim, ctxOf(), effect)
    const v = sim.state.vehicles[0]!
    expect(v).toMatchObject({
      type: 'truck',
      state: 'inactive',
      driverId: null,
      purchasePrice: 0,
    })
    expect(inactive).toEqual([{ id: v.id }])
    expect(sim.state.stats.truckTick).toBeNull()
    clean(sim)
  })
})

describe('staff (B3 §3.5: quit, ★, absence)', () => {
  it('staff.quit of the only inspector leaves a pass-through desk (isActiveSlot false), worker:fired {event}', () => {
    const sim = quietSim(1)
    const desk = laneNode(sim.state.lane, 'slot1')!
    expect(isActiveSlot(desk)).toBe(true)
    const effect: EventEffect = {
      kind: 'staff',
      quit: 'inspector',
      pick: 'one',
    }
    expect(lines(sim, [effect], { pick: audrey })).toEqual([
      { text: 'Audrey quits — the desk is empty', tone: 'cost' },
    ])
    const fired = collect(sim, 'worker:fired')
    applyEffect(sim, ctxOf({ pick: audrey }), effect)
    expect(fired).toEqual([
      {
        employeeId: 1,
        role: 'inspector',
        nodeId: 'slot1',
        vehicleId: null,
        reason: 'event',
      },
    ])
    expect(sim.state.employees.some((e) => e.role === 'inspector')).toBe(false)
    expect(desk.fixture?.kind).toBe('desk')
    expect(isActiveSlot(desk)).toBe(false)
    expect(sim.state.events.stats.workersLost).toBe(1)
    expect(lines(sim, [effect], { pick: audrey })).toEqual([
      { text: '(Audrey has left)', tone: 'neutral' },
    ])
    clean(sim)
  })

  it('best / worst by the first stat among the on-duty staff, ties to the lowest id; nobody to pick → nothing', () => {
    const sim = fund(quietSim(1))
    expect(hireInspector(sim, { eye: 5, pace: 3, charisma: 0 }).ok).toBe(true)
    expect(hireInspector(sim, { eye: 3, pace: 3, charisma: 0 }).ok).toBe(true)
    const [, sharp, twin] = sim.state.employees
    const best: EventEffect = { kind: 'staff', quit: 'inspector', pick: 'best' }
    const worst: EventEffect = {
      kind: 'staff',
      quit: 'inspector',
      pick: 'worst',
    }
    expect(texts(lines(sim, [best, worst]))).toEqual([
      `${sharp!.name} quits`,
      'Audrey quits', // eye 3 tie with the newcomer: the lowest id
    ])
    sharp!.absentUntilTick = sim.state.tick + 600 // off duty: not a candidate
    expect(texts(lines(sim, [best]))).toEqual(['Audrey quits'])
    delete sharp!.absentUntilTick
    applyEffect(sim, ctxOf(), best)
    expect(sim.state.employees.map((e) => e.id)).toEqual([1, twin!.id])
    const sorterQuit: EventEffect = {
      kind: 'staff',
      quit: 'sorter',
      pick: 'best',
    }
    expect(lines(sim, [sorterQuit])).toEqual([
      { text: '(no sorter to lose)', tone: 'neutral' },
    ])
    applyEffect(sim, ctxOf(), sorterQuit)
    expect(sim.state.events.stats.workersLost).toBe(1)
    clean(sim)
  })

  it('★: a star applicant in the pool and the ticker line', () => {
    const sim = quietSim(1)
    const dot: StarApplicantDef = {
      role: 'driver',
      name: 'Dot',
      pips: { speed: 4, energy: 4, charisma: 2 },
    }
    expect(lines(sim, [{ kind: 'staff', star: dot }])).toEqual([
      { text: '★ driver Dot applies', tone: 'gain' },
    ])
    const ticker = collect(sim, 'ticker:news')
    applyEffect(sim, ctxOf(), { kind: 'staff', star: dot })
    expect(sim.state.applicants.driver[0]).toMatchObject({
      name: 'Dot',
      star: true,
      pips: dot.pips,
    })
    expect(ticker).toEqual([
      {
        text: 'Dot is looking for work — ★ applicant in the driver pool',
        kind: 'event',
      },
    ])
    clean(sim)
  })

  it('absence: an inspector off the station (the desk re-syncs), unpaid at payday, back when the days end', () => {
    const sim = quietSim(1)
    buy(sim, 'bike')
    fund(sim, 1000)
    runTicks(sim, 10)
    const desk = laneNode(sim.state.lane, 'slot1')!
    const e = sim.state.employees.find((x) => x.id === 1)!
    const effect: EventEffect = {
      kind: 'staff',
      absent: 'inspector',
      pick: 'one',
      days: 1,
    }
    expect(lines(sim, [effect], { pick: audrey })).toEqual([
      { text: 'Audrey off for 1 day (unpaid)', tone: 'cost' },
    ])
    applyEffect(sim, ctxOf({ pick: audrey }), effect)
    expect(e.absentUntilTick).toBe(10 + 600)
    expect(e.active).toBe(true)
    expect(desk.stations).toHaveLength(0)
    expect(isActiveSlot(desk)).toBe(false)
    clean(sim)
    // Payday at tick 600 skips her (unpaid, no unpaid mark).
    const due = sim.state.employees
      .filter((x) => x.id !== 1)
      .reduce((sum, x) => sum + x.salaryPerDay, 0)
    runUntil(sim, () => sim.state.tick === 600)
    expect(sim.state.economy.lastPayroll).toMatchObject({
      tick: 600,
      paid: due,
      shortEmployeeIds: [],
    })
    expect(e.unpaidPaydays).toBe(0)
    runUntil(sim, () => sim.state.tick === 610)
    expect(e.absentUntilTick).toBeUndefined()
    expect(desk.stations).toHaveLength(1)
    expect(isActiveSlot(desk)).toBe(true)
    clean(sim)
  })

  it('absence: inspectors all → "the whole desk off"; the later of two absences wins', () => {
    const sim = fund(quietSim(1))
    expect(hireInspector(sim).ok).toBe(true)
    const effect: EventEffect = {
      kind: 'staff',
      absent: 'inspector',
      pick: 'all',
      days: 1,
    }
    expect(texts(lines(sim, [effect]))).toEqual([
      'the whole desk off for 1 day',
    ])
    applyEffect(sim, ctxOf(), {
      kind: 'staff',
      absent: 'inspector',
      pick: 'all',
      days: 2,
    })
    applyEffect(sim, ctxOf(), effect)
    expect(sim.state.employees.map((x) => x.absentUntilTick)).toEqual([
      1200, 1200,
    ])
    expect(laneNode(sim.state.lane, 'slot1')!.stations).toHaveLength(0)
    clean(sim)
  })

  it('absence: a vehicle parks at once when nothing is aboard, has no driver while away (driver unpaid), and goes back to the lot after', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    fund(sim, 1000)
    runTicks(sim, 10)
    const driver = sim.state.employees.find((x) => x.id === bike.driverId)!
    const pick: CardPick = { role: 'vehicle', id: bike.id, name: bike.name }
    const effect: EventEffect = {
      kind: 'staff',
      absent: 'vehicles',
      pick: 'one',
      days: 1,
    }
    expect(lines(sim, [effect], { pick })).toEqual([
      { text: 'Bike 1 parked for 1 day', tone: 'cost' },
    ])
    const inactive = collect(sim, 'vehicle:inactive')
    applyEffect(sim, ctxOf({ pick }), effect)
    expect(bike.state).toBe('inactive')
    expect(inactive).toEqual([{ id: bike.id }])
    expect(bike.absentUntilTick).toBe(610)
    expect(driver.absentUntilTick).toBe(610)
    expect(hasDriver(sim, bike)).toBe(false)
    clean(sim)
    // Nothing collects while away.
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runUntil(sim, () => sim.state.tick === 600)
    expect(bike.state).toBe('inactive')
    expect(sim.state.economy.lastPayroll?.paid).toBe(
      sim.state.employees
        .filter((x) => x.id !== driver.id)
        .reduce((sum, x) => sum + x.salaryPerDay, 0),
    )
    const parked = collect(sim, 'vehicle:parked')
    runUntil(sim, () => sim.state.tick === 610)
    expect(bike.absentUntilTick).toBeUndefined()
    expect(driver.absentUntilTick).toBeUndefined()
    expect(hasDriver(sim, bike)).toBe(true)
    expect(parked).toEqual([{ id: bike.id }])
    expect(bike.state).toBe('idle_lot')
    clean(sim)
    runUntil(sim, () => bike.state === 'collecting', 50) // back at work
    expect(bike.state).toBe('collecting')
  })

  it('absence: every vehicle — a busy one finishes its trip, then parks; all come back', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    const b = buy(sim, 'bike')
    fund(sim, 1000)
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    runUntil(sim, () => a.state === 'collecting' || b.state === 'collecting')
    const busy = a.state === 'collecting' ? a : b
    const idle = busy === a ? b : a
    const effect: EventEffect = {
      kind: 'staff',
      absent: 'vehicles',
      pick: 'all',
      days: 1,
    }
    expect(texts(lines(sim, [effect]))).toEqual([
      'every vehicle parked for 1 day',
    ])
    const until = sim.state.tick + 600
    applyEffect(sim, ctxOf(), effect)
    expect(idle.state).toBe('inactive')
    expect(busy.state).not.toBe('inactive') // the trip finishes
    clean(sim)
    expect(runUntil(sim, () => busy.state === 'inactive', 590)).toBeGreaterThan(
      0,
    )
    expect(busy.cargo).toEqual([])
    runUntil(sim, () => sim.state.tick === until)
    expect([a.state, b.state]).not.toContain('inactive')
    clean(sim)
  })

  it('absence of a driver = their vehicle parked (nobody unpaid behind the wheel)', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    const d = sim.state.employees.find((x) => x.id === bike.driverId)!
    const pick: CardPick = { role: 'driver', id: d.id, name: d.name }
    const effect: EventEffect = {
      kind: 'staff',
      absent: 'driver',
      pick: 'one',
      days: 1,
    }
    expect(texts(lines(sim, [effect], { pick }))).toEqual([
      `${d.name} off for 1 day (unpaid), Bike 1 parked`,
    ])
    applyEffect(sim, ctxOf({ pick }), effect)
    expect(bike.state).toBe('inactive')
    expect([bike.absentUntilTick, d.absentUntilTick]).toEqual([600, 600])
    clean(sim)
  })

  it('a vehicle pick is a driven vehicle (review effects-3, B3 §3.5): a Hire-later van is never a candidate, and a picked vehicle whose driver left parks nothing at no cost', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    sim.state.level.level = Math.max(
      sim.state.level.level,
      data.vehicles.types.find((t) => t.id === 'van')!.unlockLevel,
    )
    fund(sim, 10_000)
    expect(
      sim.dispatch({ kind: 'buyVehicle', type: 'van', applicantId: null }).ok,
    ).toBe(true)
    const van = sim.state.vehicles.at(-1)!
    expect(van.driverId).toBeNull()
    expect(van.state).toBe('inactive')
    expect(pickCandidates(sim, 'vehicle')).toEqual([
      { role: 'vehicle', id: bike.id, name: bike.name },
    ])
    // The same population as the absence's `all`.
    const all: EventEffect = {
      kind: 'staff',
      absent: 'vehicles',
      pick: 'all',
      days: 1,
    }
    applyEffect(sim, ctxOf(), all)
    expect(van.absentUntilTick).toBeUndefined()
    expect(bike.absentUntilTick).toBe(sim.state.tick + 600)
    delete bike.absentUntilTick
    // A pick made while the van had a driver, read after the driver left.
    const pick: CardPick = { role: 'vehicle', id: van.id, name: van.name }
    const one: EventEffect = {
      kind: 'staff',
      absent: 'vehicles',
      pick: 'one',
      days: 1,
    }
    expect(lines(sim, [one], { pick })).toEqual([
      { text: '(no vehicle to park)', tone: 'neutral' },
    ])
    applyEffect(sim, ctxOf({ pick }), one)
    expect(van.absentUntilTick).toBeUndefined()
    // No driver at all: no vehicle to name.
    const lone = fund(quietSim(2), 10_000)
    expect(
      lone.dispatch({ kind: 'buyVehicle', type: 'bike', applicantId: null }).ok,
    ).toBe(true)
    expect(lone.state.vehicles).toHaveLength(1)
    expect(pickCandidates(lone, 'vehicle')).toEqual([])
  })

  it('absenceStep alone brings back an absent employee and a parked vehicle', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    applyEffect(
      sim,
      ctxOf({ pick: { role: 'vehicle', id: bike.id, name: bike.name } }),
      { kind: 'staff', absent: 'vehicles', pick: 'one', days: 0.5 },
    )
    expect(bike.state).toBe('inactive')
    sim.state.tick = 300
    absenceStep(sim)
    expect(bike.absentUntilTick).toBeUndefined()
    expect(bike.state).toBe('idle_lot')
  })
})

describe('wanted (B3 §3.5: announced strains, oldest first)', () => {
  it('reveals the labels not yet wanted; with nothing left "wanted list +1 (none left)" and a no-op', () => {
    const sim = quietSim(1)
    const s = sim.state
    const metal = data.puns.malwareLabels.metal
    s.wanted = [metal[1]!]
    expect(lines(sim, [{ kind: 'wanted', reveal: 2 }])).toEqual([
      { text: 'wanted list +2', tone: 'gain' },
    ])
    applyEffect(sim, ctxOf(), { kind: 'wanted', reveal: 2 })
    expect(s.wanted).toEqual([metal[1], metal[0], metal[2]])
    s.level.announced.rattle = 100
    applyEffect(sim, ctxOf(), { kind: 'wanted', reveal: 2 })
    const rattle = data.puns.malwareLabels.rattle
    expect(s.wanted.slice(3)).toEqual([metal[3], rattle[0]])
    expect(texts(lines(sim, [{ kind: 'wanted', reveal: 5 }]))).toEqual([
      `wanted list +5 (${rattle.length - 1} left)`,
    ])
    applyEffect(sim, ctxOf(), { kind: 'wanted', reveal: 99 })
    const all = [...s.wanted]
    expect(lines(sim, [{ kind: 'wanted', reveal: 1 }])).toEqual([
      { text: 'wanted list +1 (none left)', tone: 'neutral' },
    ])
    applyEffect(sim, ctxOf(), { kind: 'wanted', reveal: 1 })
    expect(s.wanted).toEqual(all)
    clean(sim)
  })
})

describe('parcels (B3 §3.5)', () => {
  it('spawn: clean `source: event` parcels at the busiest senders, spilling, destinations on the content stream only; beyond the room dropped', () => {
    const sim = quietSim(1)
    const s = sim.state
    const effect: EventEffect = {
      kind: 'parcels',
      spawn: { size: 'L', count: 8, at: 'target' },
    }
    expect(lines(sim, [effect], { target: 'downtown' })).toEqual([
      { text: '+8 L parcels at Registry Row', tone: 'gain' },
    ])
    const main = s.rng
    const quests = s.quests.rng
    const people = s.applicants.rng
    const picks = s.events.picks.rng
    const spawned = collect(sim, 'parcel:spawned')
    const before = s.spawn.spawnedCount
    applyEffect(sim, ctxOf({ target: 'downtown' }), effect)
    expect(spawned).toHaveLength(8)
    expect(s.spawn.spawnedCount).toBe(before + 8)
    const at = (id: string): number => s.buildings[id]!.waiting.length
    expect([
      at('dt_registry_tower'),
      at('dt_monorepo_media'),
      at('dt_scope_offices'),
      at('dt_transpile_campus'),
    ]).toEqual([3, 3, 2, 0])
    const labels = data.puns.cleanLabels
    spawned.forEach((x, i) => {
      const p = s.parcels[String(x.id)] as Parcel
      expect(p).toMatchObject({
        size: 'L',
        source: 'event',
        malware: false,
        decoy: null,
        magic: false,
        state: 'waiting',
        label: labels[(before + i) % labels.length],
      })
      expect(p.dest).not.toBe(p.origin)
    })
    expect([s.rng, s.quests.rng, s.applicants.rng]).toEqual([
      main,
      quests,
      people,
    ])
    expect(s.events.picks.rng).not.toBe(picks)
    clean(sim)
    // The district's room is 12 × 3: the rest fills it, the excess is dropped.
    applyEffect(sim, ctxOf(), {
      kind: 'parcels',
      spawn: { size: 'S', count: 100, at: 'downtown' },
    })
    expect(s.spawn.spawnedCount).toBe(before + 36)
    expect(texts(lines(sim, [effect], { target: 'downtown' }))).toEqual([
      '+8 L parcels at Registry Row (no room)',
    ])
    clean(sim)
  })

  it('spawn at busiest; "room for N" when short; no district → nothing', () => {
    const sim = quietSim(1)
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    for (const b of sim.data.buildings.filter(
      (x) => x.district === 'highres' && x.id !== 'hr_towers_a',
    )) {
      for (let i = 0; i < 3; i++) injectParcel(sim, b.id, 'dt_cache_cafe')
    }
    expect(
      texts(
        lines(sim, [
          { kind: 'parcels', spawn: { size: 'M', count: 4, at: 'busiest' } },
          { kind: 'parcels', spawn: { size: 'M', count: 1, at: 'target' } },
        ]),
      ),
    ).toEqual([
      '+4 M parcels at Node Heights (room for 2)',
      '+1 M parcel (no district)',
    ])
    const before = sim.state.spawn.spawnedCount
    applyEffect(sim, ctxOf(), {
      kind: 'parcels',
      spawn: { size: 'M', count: 4, at: 'busiest' },
    })
    expect(sim.state.spawn.spawnedCount).toBe(before + 2)
    applyEffect(sim, ctxOf(), {
      kind: 'parcels',
      spawn: { size: 'M', count: 1, at: 'target' },
    })
    expect(sim.state.spawn.spawnedCount).toBe(before + 2)
    clean(sim)
  })

  it('lose: the n oldest unreserved, non-magic shelf parcels → lost (stats.lost, parcel:lost), conservation holds', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    const ps = Array.from({ length: 6 }, () =>
      shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe'),
    )
    const [p0, p1, p2, p3, p4, p5] = ps as [
      Parcel,
      Parcel,
      Parcel,
      Parcel,
      Parcel,
      Parcel,
    ]
    p0.reservedBy = bike.id
    bike.reserved.push(p0.id)
    p2.magic = true
    sim.state.spawn.magicAlive += 1
    clean(sim)
    const effect: EventEffect = {
      kind: 'parcels',
      lose: { where: 'shelf', count: 3 },
    }
    expect(lines(sim, [effect])).toEqual([
      { text: `${M}3 parcels off the shelf`, tone: 'cost' },
    ])
    const lost = collect(sim, 'parcel:lost')
    const happy = collect(sim, 'satisfaction:changed')
    applyEffect(sim, ctxOf(), effect)
    expect(lost).toEqual([{ id: p1.id }, { id: p3.id }, { id: p4.id }])
    for (const p of [p1, p3, p4]) {
      expect(p).toMatchObject({ state: 'lost', nodeId: null })
      expect(p.trace.at(-1)).toMatchObject({ what: 'lost', ref: 'shelf' })
    }
    expect(laneNode(sim.state.lane, 'shelf')!.queue).toEqual([
      p0.id,
      p2.id,
      p5.id,
    ])
    expect(sim.state.stats.lost).toBe(3)
    expect(happy).toEqual([])
    clean(sim)
    expect(texts(lines(sim, [effect]))).toEqual([
      `${M}3 parcels off the shelf (1 there)`,
    ])
    applyEffect(sim, ctxOf(), effect)
    expect(texts(lines(sim, [effect]))).toEqual([
      `${M}3 parcels off the shelf (shelf empty)`,
    ])
    clean(sim)
    runTicks(sim, 2) // gc drops the lost parcels; the identity still holds
    expect(sim.state.parcels[String(p1.id)]).toBeUndefined()
    clean(sim)
  })
})

/** levels.json shelfCap of level `n`. */
const row = (n: number): number =>
  data.levels.find((l) => l.level === n)!.shelfCap

describe('cap and end (B3 §3.5, §3.6)', () => {
  it('cap: a permanent shelf bonus that survives a level-up ("shelf +15 (to /45)")', () => {
    const sim = quietSim(1)
    const s = sim.state
    const shelf = laneNode(s.lane, 'shelf')!
    const effect: EventEffect = { kind: 'cap', cap: 'shelf', add: 15 }
    expect(lines(sim, [effect])).toEqual([
      { text: `shelf +15 (to /${row(1) + 15})`, tone: 'gain' },
    ])
    applyEffect(sim, ctxOf(), effect)
    expect(s.modifiers).toMatchObject([
      { key: 'shelfCap', add: 15, mult: 1, untilTick: null, scope: null },
    ])
    expect([s.level.shelfCap, shelf.cap]).toEqual([row(1) + 15, row(1) + 15])
    forceLevel(sim, 2)
    quiet(sim)
    expect([s.level.shelfCap, shelf.cap]).toEqual([row(2) + 15, row(2) + 15])
    expect(texts(lines(sim, [effect]))).toEqual([
      `shelf +15 (to /${row(2) + 30})`,
    ])
    clean(sim)
  })

  it('end: every modifier the named event applied ends (modifier:expired, the ticker); "ends: Rain"', () => {
    const sim = quietSim(1)
    const rain = ctxOf({ eventId: 'ev_wx_rain', title: 'Rain' })
    applyEffect(sim, rain, {
      kind: 'mod',
      key: 'speed',
      mult: 0.85,
      scope: 'bike',
      days: 1,
    })
    applyEffect(sim, ctxOf(), { kind: 'mod', key: 'income', mult: 1.1 })
    const effect: EventEffect = { kind: 'end', eventId: 'ev_wx_rain' }
    expect(lines(sim, [effect])).toEqual([{ text: 'ends: Rain', tone: 'gain' }])
    const expired = collect(sim, 'modifier:expired')
    const ticker = collect(sim, 'ticker:news')
    applyEffect(sim, ctxOf(), effect)
    expect(expired).toEqual([{ id: 'm1', key: 'speed' }])
    expect(ticker).toEqual([{ text: 'Rain is over', kind: 'event' }])
    expect(sim.state.modifiers.map((m) => m.id)).toEqual(['m2'])
    expect(lines(sim, [effect])).toEqual([
      { text: 'ends: Rain (not running)', tone: 'neutral' },
    ])
    clean(sim)
  })
})

describe('the deck kinds and the summary rules', () => {
  it("next / flag / job / jobDecline are deck.ts's: applyEffect throws; only `job` has lines (its reward and limit)", () => {
    const sim = quietSim(1)
    for (const e of [
      { kind: 'next', eventId: 'ev_crime_gang_watch', days: 1 },
      { kind: 'flag', set: 'gang_paid' },
      { kind: 'job', templateId: 'rush_district' },
      { kind: 'jobDecline' },
    ] as EventEffect[]) {
      expect(() => applyEffect(sim, ctxOf(), e)).toThrow(/deck\.ts/)
    }
    expect(
      lines(sim, [
        { kind: 'next', eventId: 'ev_crime_gang_watch', days: 1 },
        { kind: 'flag', set: 'gang_paid' },
        { kind: 'jobDecline' },
      ]),
    ).toEqual([])
    const q = offerJob(sim, 'rush_district', { debug: true })!
    expect(q).not.toBeNull()
    expect(lines(sim, [{ kind: 'job', templateId: 'rush_district' }])).toEqual([
      {
        text: `Reward: ${rewardSummary(data, q.reward, q.target)}`,
        tone: 'gain',
      },
      { text: 'Limit: 3 days', tone: 'neutral' },
    ])
  })

  it('one line per effect in data order; consecutive pips of another role or scope do not merge; the copy never uses ≥', () => {
    const sim = quietSim(1)
    const out = lines(sim, [
      { kind: 'money', delta: -40 },
      { kind: 'pips', role: 'driver', stat: 'speed', delta: 1, scope: 'all' },
      {
        kind: 'pips',
        role: 'inspector',
        stat: 'eye',
        delta: 1,
        scope: 'all',
      },
      { kind: 'lives', delta: 1 },
    ])
    expect(texts(out)).toEqual([
      `${M}$40`,
      'all drivers: speed +1 (none hired)',
      'all inspectors: eye +1',
      '+1 life',
    ])
    for (const l of out) expect(l.text).not.toContain('≥')
  })

  it('effects never draw on the main, quest or people streams (but a ★ / volunteer look on the people stream)', () => {
    const sim = quietSim(1)
    buy(sim, 'bike')
    fund(sim, 2000)
    const s = sim.state
    const words = (): number[] => [s.rng, s.quests.rng, s.applicants.rng]
    const start = words()
    const all: EventEffect[] = [
      { kind: 'money', delta: 10 },
      { kind: 'moneyPct', pct: -0.01 },
      { kind: 'satisfaction', scope: 'all', delta: 1 },
      { kind: 'mod', key: 'speed', mult: 0.9, days: 1 },
      { kind: 'pips', role: 'inspector', stat: 'eye', delta: 1, scope: 'all' },
      { kind: 'wanted', reveal: 1 },
      { kind: 'parcels', spawn: { size: 'S', count: 3, at: 'busiest' } },
      { kind: 'parcels', lose: { where: 'shelf', count: 1 } },
      { kind: 'cap', cap: 'shelf', add: 5 },
      { kind: 'staff', absent: 'inspector', pick: 'all', days: 1 },
      { kind: 'vehicle', gain: 'van' },
      { kind: 'vehicle', lose: 'bike', fallback: -10 },
      { kind: 'end', eventId: 'ev_test' },
      { kind: 'lives', delta: -1 },
    ]
    for (const e of all) {
      applyEffect(sim, ctxOf(), e)
      clean(sim)
    }
    expect(words()).toEqual(start)
    applyEffect(sim, ctxOf(), {
      kind: 'vehicle',
      gain: 'bike',
      withDriver: { role: 'driver', name: 'Mo', pips: { speed: 3 } },
    })
    expect([s.rng, s.quests.rng]).toEqual(start.slice(0, 2))
    expect(s.applicants.rng).not.toBe(start[2])
    clean(sim)
  })
})

describe('the shipped deck (events.json)', () => {
  it('every option of every card summarizes (no undefined / NaN / ≥) and applies its world effects with auditState clean', () => {
    const deck = data.events.deck
    expect(deck.length).toBeGreaterThan(0)
    for (const def of deck) {
      for (const [i, opt] of (def.options ?? []).entries()) {
        const sim = quietSim(1)
        forceLevel(sim, 3)
        quiet(sim)
        buy(sim, 'bike')
        buy(sim, 'van')
        fund(sim, 5000)
        const s = sim.state
        const driver = s.employees.find((e) => e.role === 'driver')!
        const v = s.vehicles[0]!
        const pick: CardPick | null =
          def.pick === 'inspector'
            ? audrey
            : def.pick === 'driver'
              ? { role: 'driver', id: driver.id, name: driver.name }
              : def.pick === 'vehicle'
                ? { role: 'vehicle', id: v.id, name: v.name }
                : null
        const target: DistrictId | null =
          def.target === undefined ? null : 'downtown'
        const where = `${def.id}#${i}`
        for (const l of lines(sim, opt.effects, { target, pick })) {
          expect(l.text, where).not.toMatch(/undefined|NaN|Infinity|≥/)
          expect(l.text.length, where).toBeGreaterThan(0)
        }
        const ctx = ctxOf({
          eventId: def.id,
          title: def.title,
          optionLabel: opt.label,
          optionIndex: i,
          target,
          pick,
          chainHeadId: def.id,
        })
        for (const e of opt.effects) {
          if (e.kind === 'next' || e.kind === 'flag') continue
          applyEffect(sim, ctx, e)
        }
        expect(auditState(s, sim.data), where).toEqual([])
        expect(conservation(s).ok, where).toBe(true)
      }
    }
  })
})
