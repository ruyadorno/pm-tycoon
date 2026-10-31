// spec-build3 §3.8-§3.9; plan-build3 §7, §8.2 tasks 7-8; M11 contract §3
// stream D (D-37, D-38; critique 7, 20, 24, 26): the event policy
// (src/sim/policies/eventPolicy.ts) — every effect kind's score in dollars,
// the six hand-checked cards of B3 §3.8 (the scanner course and the gang
// from the seed deck, cake day / shorter breaks / the loan / the investor
// chain as synthetic EventDefs), the last life (−∞, never chosen while
// another option exists), a job card's Accept ≥ Decline for every template,
// a scripted deck → the expected picks, the seed deck (state-free scores ≤
// evMax without life gains, deckEvMean printed, a 30-minute decks-on run's
// picks); eventPolicyStep answering on the step a card opens; the CLI
// (--events, --policy none) and the report's event rows (gated behind
// SIM_FEATURES.events; the lives row counts malware only).

import { afterEach, describe, expect, it } from 'vitest'
import type { EventDef, EventEffect, GameData } from '../../src/data/types.ts'
import { onSimEvent } from '../../src/sim/events.ts'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import {
  answerWithDefault,
  chooseOption,
  deckEvMean,
  eventPolicyStep,
  evMaxViolations,
  newTally,
  scoreOption,
  starValue,
  staticScore,
} from '../../src/sim/policies/eventPolicy.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import {
  payrollDuePerDay,
  payrollTicks,
} from '../../src/sim/systems/payroll.ts'
import { Sim } from '../../src/sim/sim.ts'
import type { CardOption } from '../../src/sim/systems/deck.ts'
import {
  cardOptions,
  DECK_OFF_TICK,
  optionLines,
} from '../../src/sim/systems/deck.ts'
import type { OpenCard } from '../../src/sim/types.ts'
import { TICKS_PER_DAY } from '../../src/sim/types.ts'
import {
  BUILD_EVENTS,
  gateFileBase,
  parseCli,
  runSeed,
  UsageError,
} from '../../tools/sim/cli.ts'
import type { RecordedEvent } from '../../tools/sim/report.ts'
import {
  checkMetrics,
  computeMetrics,
  eventMetrics,
  Highlights,
  NO_POLICY_BAND_NOTE,
  policyWeightsLine,
  summarise,
} from '../../tools/sim/report.ts'
import {
  buy,
  dataFixture,
  deckOn,
  hireInspector,
  makeSim,
  quiet,
} from './helpers.ts'

const data = dataFixture()
const W = data.events.policy.weights
const targets = data.economy.pacingTargets
const featureEvents = SIM_FEATURES.events

afterEach(() => {
  SIM_FEATURES.events = featureEvents
})

/** A card as the policy sees it (no deck id needed unless a next resolves). */
function card(sim: Sim, over: Partial<OpenCard> = {}): OpenCard {
  return {
    eventId: 'ev_test',
    kind: 'decision',
    category: 'staff',
    questId: null,
    target: null,
    pick: null,
    openedTick: sim.state.tick,
    parentChoice: null,
    chainHeadId: 'ev_test',
    depth: 1,
    drawn: false,
    gapTicks: null,
    ...over,
  }
}

/** One option as cardOptions builds it (visible, affordable, no cost). */
function option(
  effects: EventEffect[],
  over: Partial<CardOption> = {},
): CardOption {
  return {
    index: 0,
    label: 'X',
    effects,
    cost: 0,
    default: false,
    danger: false,
    visible: true,
    affordable: true,
    hint: null,
    ...over,
  }
}

const score = (
  sim: Sim,
  effects: EventEffect[],
  over: Partial<CardOption> = {},
  cardOver: Partial<OpenCard> = {},
): number => scoreOption(sim, card(sim, cardOver), option(effects, over))

/** The shipped data plus `defs` appended to the deck (synthetic cards). */
function withDeck(defs: EventDef[]): GameData {
  const d = structuredClone(dataFixture())
  d.events.deck.push(...structuredClone(defs))
  return d
}

/** A sim on `d` with no automatic card (the deck off, D-8) and no spawns. */
function simOn(d: GameData, seed = 1): Sim {
  const sim = new Sim(d, seed)
  sim.state.events.nextDrawTick = DECK_OFF_TICK
  return quiet(sim)
}

/** Open deck card `id` now (debugOfferEvent: ignores cond / level, resolves the pick). */
function open(sim: Sim, id: string): OpenCard {
  const res = sim.dispatch({ kind: 'debugOfferEvent', eventId: id })
  if (!res.ok) throw new Error(`debugOfferEvent ${id}: ${res.reason}`)
  const c = sim.state.events.open
  if (c === null || c.eventId !== id) throw new Error(`${id} is not open`)
  return c
}

/** Every option's score of the open card, by label. */
function scores(sim: Sim, c: OpenCard): Record<string, number> {
  return Object.fromEntries(
    cardOptions(sim, c).map((o) => [o.label, scoreOption(sim, c, o)]),
  )
}

/** The label the policy picks on the open card. */
function pickOf(sim: Sim, c: OpenCard): string | null {
  return chooseOption(sim, c, cardOptions(sim, c))?.option.label ?? null
}

/** +1 eye for every inspector / the card's pick. */
const eye = (scope: 'all' | 'one'): EventEffect => ({
  kind: 'pips',
  role: 'inspector',
  stat: 'eye',
  delta: 1,
  scope,
})

/** Lose the oldest vehicle of `type`, else −$250. */
const lose = (type: 'bike' | 'van' | 'any'): EventEffect => ({
  kind: 'vehicle',
  lose: type,
  fallback: -250,
})

/** A tick `extra` after minute `min`. */
const at = (min: number, extra = 0): number => min * TICKS_PER_DAY + extra

/** A recorded event. */
const ev = (
  tick: number,
  name: RecordedEvent['name'],
  fields: Record<string, unknown>,
): RecordedEvent => ({ tick, name, ...fields }) as RecordedEvent

/** Hire inspectors until `n` are active (standard 3/3/0, first desk). */
function inspectors(sim: Sim, n: number): void {
  sim.state.economy.balance += 10_000
  while (
    sim.state.employees.filter((e) => e.role === 'inspector' && e.active)
      .length < n
  ) {
    const r = hireInspector(sim)
    if (!r.ok) throw new Error(`hire: ${r.reason}`)
  }
  sim.state.economy.balance -= 10_000
}

// Synthetic cards of B3 §4 (the hand-checked ones the seed deck lacks) ----------------

const CAKE: EventDef = {
  id: 'ev_t_birthday',
  category: 'staff',
  title: 'Cake day',
  pick: 'inspector',
  body: "It's {inspector}'s birthday. The desk is hinting about cake.",
  options: [
    {
      label: 'Cake for everyone',
      cost: 40,
      effects: [{ kind: 'mod', key: 'inspectorP', add: 0.03, days: 1 }],
    },
    {
      label: 'No cake',
      default: true,
      effects: [{ kind: 'mod', key: 'inspectorP', add: -0.02, days: 1 }],
    },
  ],
}

const BREAKS: EventDef = {
  id: 'ev_t_pauses',
  category: 'staff',
  title: 'Shorter breaks',
  body: "Your office admin proposes cutting the drivers' breaks.",
  options: [
    {
      label: 'Adopt it',
      effects: [
        { kind: 'pips', role: 'driver', stat: 'speed', delta: 1, scope: 'all' },
        {
          kind: 'pips',
          role: 'driver',
          stat: 'charisma',
          delta: -1,
          scope: 'all',
        },
      ],
    },
    { label: 'No', default: true, effects: [] },
  ],
}

const LOAN: EventDef = {
  id: 'ev_t_loan',
  category: 'money',
  title: 'Quick loan',
  body: 'The bank offers a quick loan: $400 now, $25 a day for 20 days.',
  options: [
    {
      label: 'Take it',
      effects: [
        { kind: 'money', delta: 400 },
        { kind: 'mod', key: 'payrollAdd', add: 25, days: 20 },
      ],
    },
    { label: 'No', default: true, effects: [] },
  ],
}

const INVESTOR: EventDef[] = [
  {
    id: 'ev_t_investor',
    category: 'money',
    title: 'An angel',
    body: 'An angel investor offers $800 for a cut of every delivery.',
    options: [
      {
        label: 'Take it',
        effects: [
          { kind: 'money', delta: 800 },
          { kind: 'mod', key: 'income', mult: 0.9 },
          { kind: 'flag', set: 'investor' },
          { kind: 'next', eventId: 'ev_t_investor_buyout', days: 3 },
        ],
      },
      { label: 'Decline', default: true, effects: [] },
    ],
  },
  {
    id: 'ev_t_investor_buyout',
    category: 'money',
    title: 'Buy them out?',
    drawable: false,
    body: 'Buy the investor out?',
    options: [
      {
        label: 'Buy out ($1,000)',
        cost: 1000,
        effects: [{ kind: 'end', eventId: 'ev_t_investor' }],
      },
      {
        label: 'Keep them',
        default: true,
        effects: [{ kind: 'next', eventId: 'ev_t_investor_exit', days: 3 }],
      },
    ],
  },
  {
    id: 'ev_t_investor_exit',
    category: 'money',
    title: 'Cashing out',
    drawable: false,
    body: 'The investor cashes out.',
    options: [
      {
        label: 'OK',
        default: true,
        effects: [
          { kind: 'money', delta: -300 },
          { kind: 'end', eventId: 'ev_t_investor' },
        ],
      },
    ],
  },
]

/** A harsh card with a dearer way out: the strike wins at 2 lives, never at the last. */
const HARSH: EventDef = {
  id: 'ev_t_harsh',
  category: 'security',
  title: 'Strike or pay',
  body: 'Pay a lot, or take the strike.',
  options: [
    { label: 'Pay', cost: 700, effects: [] },
    {
      label: 'Take the strike',
      danger: true,
      default: true,
      effects: [{ kind: 'lives', delta: -1 }],
    },
  ],
}

/**
 * A head whose default books a link that only takes a life or costs $500
 * (review policy-2); the head's Pay ($300) is its way out, covered by its cond.
 */
const TRAP: EventDef[] = [
  {
    id: 'ev_t_trap',
    category: 'underworld',
    title: 'Protection',
    cond: { balanceAtLeast: 300 },
    body: 'A man in a long coat offers protection.',
    options: [
      { label: 'Pay ($300)', cost: 300, effects: [] },
      {
        label: 'Refuse',
        default: true,
        effects: [{ kind: 'next', eventId: 'ev_t_trap_due', days: 1 }],
      },
    ],
  },
  {
    id: 'ev_t_trap_due',
    category: 'underworld',
    title: 'He came back',
    drawable: false,
    body: 'The man is back, with friends.',
    options: [
      { label: 'Pay ($500)', cost: 500, effects: [] },
      {
        label: 'Take the strike',
        danger: true,
        default: true,
        effects: [{ kind: 'lives', delta: -1 }],
      },
    ],
  },
]

/** A plain next to a router whose branch reads a flag the option sets (critique 24). */
const ROUTED: EventDef[] = [
  {
    id: 'ev_t_prep',
    category: 'cityhall',
    title: 'Inspection',
    body: 'An inspection is coming.',
    options: [
      {
        label: 'Prepare',
        cost: 50,
        effects: [
          { kind: 'flag', set: 'prepared_t' },
          { kind: 'next', eventId: 'ev_t_prep_day', days: 1 },
        ],
      },
      {
        label: 'Wing it',
        default: true,
        effects: [{ kind: 'next', eventId: 'ev_t_prep_day', days: 1 }],
      },
    ],
  },
  {
    id: 'ev_t_prep_day',
    category: 'cityhall',
    title: 'Inspection day',
    router: true,
    drawable: false,
    next: {
      days: 0,
      branches: [
        { if: { flag: 'prepared_t' }, id: 'ev_t_prep_pass' },
        { id: 'ev_t_prep_fail' },
      ],
    },
  },
  {
    id: 'ev_t_prep_pass',
    category: 'cityhall',
    title: 'Passed',
    drawable: false,
    body: 'Passed.',
    options: [
      { label: 'OK', default: true, effects: [{ kind: 'money', delta: 200 }] },
    ],
  },
  {
    id: 'ev_t_prep_fail',
    category: 'cityhall',
    title: 'Failed',
    drawable: false,
    body: 'Failed.',
    options: [
      { label: 'OK', default: true, effects: [{ kind: 'money', delta: -100 }] },
    ],
  },
]

describe('scoreOption: every effect kind in dollars (B3 §3.8, D-38)', () => {
  it('money 1:1, a debit clamped to the running balance (after the cost); per vehicle; % of the balance, rounded', () => {
    const sim = makeSim(1)
    sim.state.economy.balance = 200
    expect(score(sim, [{ kind: 'money', delta: 60 }])).toBe(60 * W.money)
    expect(score(sim, [{ kind: 'money', delta: -40 }])).toBe(-40)
    expect(score(sim, [{ kind: 'money', delta: -500 }])).toBe(-200)
    expect(score(sim, [], { cost: 150 })).toBe(-150)
    expect(score(sim, [{ kind: 'money', delta: -100 }], { cost: 150 })).toBe(
      -200,
    )
    expect(score(sim, [{ kind: 'moneyPerVehicle', delta: -40 }])).toBe(0)
    buy(sim, 'bike')
    buy(sim, 'bike')
    sim.state.economy.balance = 700
    expect(score(sim, [{ kind: 'moneyPerVehicle', delta: -40 }])).toBe(-80)
    expect(
      score(sim, [{ kind: 'moneyPerVehicle', delta: 50, type: 'van' }]),
    ).toBe(0)
    expect(score(sim, [{ kind: 'moneyPct', pct: -0.08 }])).toBe(-56)
    sim.state.economy.balance = 455
    expect(score(sim, [{ kind: 'moneyPct', pct: 0.1 }])).toBe(46)
  })

  it('lives: +life below the cap (0 at the cap), −life per loss, −∞ for the last one', () => {
    const sim = makeSim(1)
    const cap = data.economy.lives.cap
    sim.state.economy.lives = cap - 2
    expect(score(sim, [{ kind: 'lives', delta: 1 }])).toBe(W.life)
    expect(score(sim, [{ kind: 'lives', delta: 3 }])).toBe(2 * W.life)
    sim.state.economy.lives = cap
    expect(score(sim, [{ kind: 'lives', delta: 1 }])).toBe(0)
    sim.state.economy.lives = 3
    expect(score(sim, [{ kind: 'lives', delta: -1 }])).toBe(-W.life)
    expect(score(sim, [{ kind: 'lives', delta: -3 }])).toBe(
      Number.NEGATIVE_INFINITY,
    )
    sim.state.economy.lives = 1
    expect(score(sim, [{ kind: 'lives', delta: -1 }])).toBe(
      Number.NEGATIVE_INFINITY,
    )
    // A life gained first makes the loss survivable.
    expect(
      score(sim, [
        { kind: 'lives', delta: 1 },
        { kind: 'lives', delta: -1 },
      ]),
    ).toBe(0)
  })

  it('satisfaction: per point per district (all = the live spawning districts)', () => {
    const sim = makeSim(1)
    const live = Object.entries(sim.state.districts).filter(
      ([id, d]) =>
        d.live && data.districts.find((x) => x.id === id)?.kind === 'district',
    ).length
    expect(live).toBe(2)
    expect(score(sim, [{ kind: 'satisfaction', scope: 'all', delta: 3 }])).toBe(
      W.satisfactionPerPoint * 3 * live,
    )
    expect(
      score(sim, [{ kind: 'satisfaction', scope: 'target', delta: -3 }]),
    ).toBe(-W.satisfactionPerPoint * 3)
  })

  it('mod: weight × |mult − 1| (or |add|) × days (permanent = permanentDaysForScore), signed by goodDirection; mult 0 scores without NaN', () => {
    const sim = makeSim(1)
    const perm = data.events.modifiers.permanentDaysForScore
    const mod = (e: Omit<Extract<EventEffect, { kind: 'mod' }>, 'kind'>) =>
      score(sim, [{ kind: 'mod', ...e }])
    expect(mod({ key: 'speed', mult: 0.92, scope: 'bike', days: 2 })).toBe(-80)
    expect(mod({ key: 'spawn', mult: 0.8, days: 2 })).toBe(120)
    expect(mod({ key: 'inspectorP', add: 0.03, days: 1 })).toBe(27)
    expect(mod({ key: 'payrollAdd', add: 25, days: 20 })).toBe(-500)
    expect(mod({ key: 'processS', mult: 0.9 })).toBe(
      Math.round(150 * 0.1 * perm * 100) / 100,
    )
    expect(mod({ key: 'income', mult: 0.9 })).toBe(-525)
    // ×0 (B3 §4 ev_sec_insurance: wrongTossFee ×0, perm): |0 − 1| = 1, a good change.
    const zero = mod({ key: 'wrongTossFee', mult: 0 })
    expect(Number.isNaN(zero)).toBe(false)
    expect(zero).toBe(W.mod.wrongTossFee * perm)
    expect(mod({ key: 'tossBounty', mult: 0 })).toBe(-W.mod.tossBounty * perm)
    expect(mod({ key: 'speed', mult: 1, days: 3 })).toBe(0)
    expect(mod({ key: 'machineP', add: 0, days: 3 })).toBe(0)
  })

  it('pips: per stat per person (all → the role’s active staff; one → the pick, 0 once they have left)', () => {
    const sim = makeSim(1)
    inspectors(sim, 3)
    expect(score(sim, [eye('all')])).toBe(3 * W.pips.eye!)
    const first = sim.state.employees[0]!
    const pick = { role: 'inspector' as const, id: first.id, name: first.name }
    expect(score(sim, [eye('one')], {}, { pick })).toBe(W.pips.eye)
    expect(score(sim, [eye('one')])).toBe(0) // no pick
    first.active = false
    expect(score(sim, [eye('one')], {}, { pick })).toBe(0)
    expect(score(sim, [eye('all')])).toBe(2 * W.pips.eye!)
  })

  it('vehicle: lose → −the paid price of the oldest of the type (any = the oldest overall), the fallback money with none; gain → vehicleGainShare × list price (+ the volunteer driver)', () => {
    const sim = makeSim(1)
    sim.state.economy.balance = 100
    expect(score(sim, [lose('bike')])).toBe(-100) // fallback, clamped
    const b1 = buy(sim, 'bike')
    const b2 = buy(sim, 'bike')
    b1.purchasePrice = 170 // bought on a sale
    b2.purchasePrice = 200
    sim.state.economy.balance = 1000
    expect(score(sim, [lose('bike')])).toBe(-170)
    expect(score(sim, [lose('any')])).toBe(-170)
    expect(score(sim, [lose('van')])).toBe(-250)
    const van = data.vehicles.types.find((t) => t.id === 'van')!
    expect(score(sim, [{ kind: 'vehicle', gain: 'van' }])).toBe(
      W.vehicleGainShare * van.price,
    )
    const mo = {
      role: 'driver' as const,
      name: 'Mo',
      pips: { speed: 3, energy: 3, charisma: 0 },
    }
    const bike = data.vehicles.types.find((t) => t.id === 'bike')!
    expect(
      score(sim, [{ kind: 'vehicle', gain: 'bike', withDriver: mo }]),
    ).toBe(W.vehicleGainShare * bike.price + starValue(W, mo))
    expect(starValue(W, mo)).toBe(W.pips.charisma! * (0 - 3))
  })

  it('staff: quit → −staffQuit when someone would quit; star → Σ pip weight × (pip − 3); absent → −absentPerDay × days × persons', () => {
    const sim = makeSim(1)
    expect(
      score(sim, [{ kind: 'staff', quit: 'inspector', pick: 'best' }]),
    ).toBe(-W.staffQuit)
    expect(score(sim, [{ kind: 'staff', quit: 'sorter', pick: 'worst' }])).toBe(
      0,
    )
    expect(
      score(sim, [{ kind: 'staff', quit: 'inspector', pick: 'one' }]),
    ).toBe(0) // no pick
    const dot = {
      role: 'driver' as const,
      name: 'Dot',
      pips: { speed: 4, energy: 4, charisma: 2 },
    }
    expect(score(sim, [{ kind: 'staff', star: dot }])).toBe(
      W.pips.speed! + W.pips.energy! - W.pips.charisma!,
    )
    inspectors(sim, 2)
    const first = sim.state.employees[0]!
    const pick = { role: 'inspector' as const, id: first.id, name: first.name }
    expect(
      score(
        sim,
        [{ kind: 'staff', absent: 'inspector', pick: 'one', days: 1 }],
        {},
        { pick },
      ),
    ).toBe(-W.absentPerDay)
    expect(
      score(sim, [
        { kind: 'staff', absent: 'inspector', pick: 'all', days: 2 },
      ]),
    ).toBe(-W.absentPerDay * 2 * 2)
    buy(sim, 'bike')
    buy(sim, 'bike')
    buy(sim, 'bike')
    expect(
      score(sim, [{ kind: 'staff', absent: 'vehicles', pick: 'all', days: 1 }]),
    ).toBe(-W.absentPerDay * 3)
  })

  it('wanted: per label still revealable (0 with none left); parcels: spawn × the size value, lose × min(count, losable); cap per unit; flag 0', () => {
    const sim = makeSim(1)
    const metal = data.puns.malwareLabels.metal
    expect(score(sim, [{ kind: 'wanted', reveal: 1 }])).toBe(W.wantedPerLabel)
    expect(score(sim, [{ kind: 'wanted', reveal: 99 }])).toBe(
      W.wantedPerLabel * metal.length,
    )
    sim.state.wanted.push(...metal)
    expect(score(sim, [{ kind: 'wanted', reveal: 1 }])).toBe(0)
    expect(
      score(sim, [
        { kind: 'parcels', spawn: { size: 'L', count: 8, at: 'busiest' } },
      ]),
    ).toBe(W.parcelSpawnShare * 8 * data.parcels.sizes.L.value)
    expect(
      score(sim, [{ kind: 'parcels', lose: { where: 'shelf', count: 3 } }]),
    ).toBe(0) // an empty shelf
    expect(score(sim, [{ kind: 'cap', cap: 'shelf', add: 15 }])).toBe(
      15 * W.capPerUnit,
    )
    expect(score(sim, [{ kind: 'flag', set: 'x' }])).toBe(0)
  })

  it('end: minus the remaining score of the rows it ends (timed: the days left; permanent: permanentDaysForScore)', () => {
    const sim = makeSim(1)
    sim.state.modifiers.push(
      {
        id: 'm1',
        key: 'income',
        mult: 0.9,
        add: 0,
        scope: null,
        untilTick: null,
        eventId: 'ev_a',
        label: 'A',
        appliedTick: 0,
      },
      {
        id: 'm2',
        key: 'speed',
        mult: 0.85,
        add: 0,
        scope: null,
        untilTick: sim.state.tick + 1.5 * TICKS_PER_DAY,
        eventId: 'ev_b',
        label: 'B',
        appliedTick: 0,
      },
    )
    expect(score(sim, [{ kind: 'end', eventId: 'ev_a' }])).toBe(525)
    expect(score(sim, [{ kind: 'end', eventId: 'ev_b' }])).toBe(
      W.mod.speed * 0.15 * 1.5,
    )
    expect(score(sim, [{ kind: 'end', eventId: 'ev_none' }])).toBe(0)
  })

  it('next: the chain weight; to a router or conditional, + the best option of the branch picked now, with this option’s own flags applied virtually (critique 24); nested nexts score the chain only', () => {
    const sim = simOn(withDeck(ROUTED))
    const c = open(sim, 'ev_t_prep')
    const s = scores(sim, c)
    // Prepare: −50 cost, the chain, then the pass card (+$200) — its flag counts.
    expect(s.Prepare).toBe(-50 + W.chain + 200)
    // Wing it: the router reads no flag → the fail card (−$100).
    expect(s['Wing it']).toBe(W.chain - 100)
    expect(pickOf(sim, c)).toBe('Prepare')
    // The virtual flag never leaks into the state.
    expect(sim.state.events.flags).toEqual({})
    // A plain next to a non-router card: the chain weight only.
    expect(
      score(sim, [{ kind: 'next', eventId: 'ev_t_prep_pass', days: 1 }]),
    ).toBe(W.chain)
    // A conditional next: the branch whose `if` holds now.
    const cond: EventEffect = {
      kind: 'next',
      days: 2,
      hint: 'h',
      branches: [
        { if: { flag: 'prepared_t' }, id: 'ev_t_prep_pass' },
        { id: 'ev_t_prep_fail' },
      ],
    }
    expect(score(sim, [cond])).toBe(W.chain - 100)
    expect(score(sim, [{ kind: 'flag', set: 'prepared_t' }, cond])).toBe(
      W.chain + 200,
    )
    sim.state.events.flags.prepared_t = true
    expect(score(sim, [cond])).toBe(W.chain + 200)
    expect(score(sim, [{ kind: 'flag', clear: 'prepared_t' }, cond])).toBe(
      W.chain - 100,
    )
    expect(sim.state.events.flags).toEqual({ prepared_t: true })
  })

  it('the seed deck’s audit: the consultant (it sets audit_ready) beats winging it on a lane under 95 % (critique 24)', () => {
    const sim = makeSim(1)
    sim.state.level.level = 2
    const c = open(sim, 'ev_city_audit')
    const s = scores(sim, c)
    const n = 2 // live spawning districts
    expect(s['Hire a consultant ($120)']).toBe(
      -120 + W.chain + 100 + W.satisfactionPerPoint * 2 * n,
    )
    // Wing it → the fail card: Pay the fine (−$250) or Fix it first (a nested next: the chain only).
    expect(s['Wing it']).toBe(W.chain + W.chain)
    expect(pickOf(sim, c)).toBe('Hire a consultant ($120)')
  })
})

describe('the six hand-checked cards of B3 §3.8', () => {
  it('cake beats no cake (−13 vs −18)', () => {
    const sim = simOn(withDeck([CAKE]))
    const c = open(sim, 'ev_t_birthday')
    expect(c.pick?.role).toBe('inspector')
    expect(scores(sim, c)).toEqual({ 'Cake for everyone': -13, 'No cake': -18 })
    expect(pickOf(sim, c)).toBe('Cake for everyone')
  })

  it('the scanner course (seed deck): one inspector at L1, everyone with three', () => {
    const sim = makeSim(1)
    const c = open(sim, 'ev_staff_training')
    const name = c.pick!.name
    expect(scores(sim, c)).toEqual({
      'Send everyone': -150 + W.pips.eye!,
      [`Send ${name}`]: -60 + W.pips.eye!,
      Skip: 0,
    })
    expect(pickOf(sim, c)).toBe(`Send ${name}`)
    const three = makeSim(1)
    inspectors(three, 3)
    const c3 = open(three, 'ev_staff_training')
    expect(scoreOption(three, c3, cardOptions(three, c3)[0]!)).toBe(
      -150 + 3 * W.pips.eye!,
    )
    expect(pickOf(three, c3)).toBe('Send everyone')
  })

  it('"Shorter breaks" is adopted (+80 per driver)', () => {
    const sim = simOn(withDeck([BREAKS]))
    buy(sim, 'bike')
    buy(sim, 'bike')
    sim.state.economy.balance = 500
    const c = open(sim, 'ev_t_pauses')
    expect(scores(sim, c)).toEqual({ 'Adopt it': 2 * 80, No: 0 })
    expect(W.pips.speed! - W.pips.charisma!).toBe(80)
    expect(pickOf(sim, c)).toBe('Adopt it')
  })

  it('the gang (seed deck): defied, then the fleet hidden (−95: −75 + the chain) rather than a bike lost', () => {
    const sim = makeSim(1)
    sim.state.level.level = 2
    buy(sim, 'bike')
    sim.state.economy.balance = 1000
    const head = open(sim, 'ev_crime_gang')
    expect(scores(sim, head)).toEqual({ 'Accept ($300)': -300, Deny: W.chain })
    expect(pickOf(sim, head)).toBe('Deny')
    sim.state.events.open = null
    const watch = open(sim, 'ev_crime_gang_watch')
    const bike = sim.state.vehicles[0]!
    expect(scores(sim, watch)).toEqual({
      Yes: -75 + W.chain,
      No: -bike.purchasePrice + W.chain,
    })
    expect(pickOf(sim, watch)).toBe('Yes')
  })

  it('the loan is never taken (+$400 against $25 a day for 20 days)', () => {
    const sim = simOn(withDeck([LOAN]))
    sim.state.economy.balance = 100
    const c = open(sim, 'ev_t_loan')
    expect(scores(sim, c)).toEqual({ 'Take it': 400 - 500, No: 0 })
    expect(pickOf(sim, c)).toBe('No')
  })

  it("the investor's $800 is taken and never bought out", () => {
    const sim = simOn(withDeck(INVESTOR))
    const c = open(sim, 'ev_t_investor')
    // B3 §3.8 says +275 (800 − 525): the chain weight makes it 255.
    expect(scores(sim, c)).toEqual({
      'Take it': 800 - 525 + W.chain,
      Decline: 0,
    })
    expect(pickOf(sim, c)).toBe('Take it')
    const tally = newTally()
    eventPolicyStep(sim, tally)
    expect(sim.state.events.open).toBeNull()
    expect(sim.state.modifiers.map((m) => [m.key, m.mult])).toEqual([
      ['income', 0.9],
    ])
    expect(tally).toEqual({ decisions: 1, evSum: 255, nonDefault: 1 })
    sim.state.economy.balance = 5000 // the buy-out is affordable
    const buyout = open(sim, 'ev_t_investor_buyout')
    expect(scores(sim, buyout)).toEqual({
      'Buy out ($1,000)': -1000 + 525,
      'Keep them': W.chain,
    })
    expect(pickOf(sim, buyout)).toBe('Keep them')
  })
})

describe('the policy’s choice (ties → the default, then the lowest index; the last life)', () => {
  it('the last life scores −∞ and is never chosen while another option exists; a strike that is cheaper than the way out is taken at 2 lives', () => {
    const sim = simOn(withDeck([HARSH]))
    sim.state.economy.balance = 1000
    sim.state.economy.lives = 2
    let c = open(sim, 'ev_t_harsh')
    expect(scores(sim, c)).toEqual({ Pay: -700, 'Take the strike': -W.life })
    expect(pickOf(sim, c)).toBe('Take the strike')
    sim.state.events.open = null
    sim.state.economy.lives = 1
    c = open(sim, 'ev_t_harsh')
    expect(scores(sim, c)['Take the strike']).toBe(Number.NEGATIVE_INFINITY)
    expect(pickOf(sim, c)).toBe('Pay')
    // The recall (seed deck) at 1 life: the fine.
    sim.state.events.open = null
    const recall = open(sim, 'ev_sec_recall')
    expect(pickOf(sim, recall)).toBe('Pay the fine ($250)')
    // Forced (the way out unaffordable): the −∞ option, tallied as −life.
    sim.state.events.open = null
    sim.state.economy.balance = 100
    c = open(sim, 'ev_t_harsh')
    expect(pickOf(sim, c)).toBe('Take the strike')
    const tally = newTally()
    eventPolicyStep(sim, tally)
    expect(tally).toEqual({ decisions: 1, evSum: -W.life, nonDefault: 0 })
    expect(sim.state.economy.gameOver).toBe(true)
  })

  it('a card due on a payday tick opens the tick after, against the paid balance: the recall with its fine barely covered is never offered with the fine greyed, and the policy keeps its last life (review policy-1)', () => {
    SIM_FEATURES.events = true
    const P = payrollTicks(data)
    const payday = Math.ceil(3000 / P) * P
    /** Seed 1 at payday − 1: L2, 1 life, only the recall drawable, the draw due on payday. */
    const atPayday = (over: number): Sim => {
      const sim = makeSim(1)
      const s = sim.state
      while (s.tick < payday - 1) sim.tick()
      s.level.level = 2
      s.quests.jobReadyTick = 1e9
      for (const d of data.events.deck)
        if (d.id !== 'ev_sec_recall') s.events.cooldownUntil[d.id] = 1e9
      s.events.nextDrawTick = payday
      s.economy.lives = 1
      const due = payrollDuePerDay(sim)
      expect(due).toBeGreaterThan(0)
      // over < due: the fine is covered before payday, not after it.
      s.economy.balance = 250 + over
      return sim
    }
    const due = payrollDuePerDay(makeSim(1))
    // Barely covered: nothing on the payday tick; after payroll the recall's
    // cond fails, so the draw on the next tick is a blank, not the recall.
    const short = atPayday(due - 5)
    short.tick()
    expect(short.state.tick).toBe(payday)
    expect(short.state.economy.lastPayroll?.tick).toBe(payday)
    expect(short.state.events.open).toBeNull()
    expect(short.state.economy.balance).toBe(245)
    short.tick()
    expect(short.state.events.open).toBeNull()
    expect(short.state.events.stats.blanks).toBe(1)
    // Covered after payroll too: the recall opens on payday + 1, the fine
    // affordable, and the policy pays it.
    const rich = atPayday(due + 10)
    rich.tick()
    expect(rich.state.events.open).toBeNull()
    rich.tick()
    const c = rich.state.events.open
    expect(c?.eventId).toBe('ev_sec_recall')
    expect(c?.openedTick).toBe(payday + 1)
    expect(cardOptions(rich, c!).every((o) => o.affordable)).toBe(true)
    const policy = createPolicy(rich, 'competent')
    try {
      policy.step()
    } finally {
      policy.dispose?.()
    }
    expect(rich.state.events.history.at(-1)?.label).toBe('Pay the fine ($250)')
    expect(rich.state.economy.lives).toBe(1)
    expect(rich.state.economy.gameOver).toBe(false)
  })

  it('a plain next to a link whose every answer takes the last life scores −∞: at 1 life the policy takes the head’s paid way out; at 2 lives, or with the link’s way out affordable now, the chain weight (review policy-2)', () => {
    const sim = simOn(withDeck(TRAP))
    sim.state.economy.balance = 350
    sim.state.economy.lives = 1
    let c = open(sim, 'ev_t_trap')
    expect(scores(sim, c)).toEqual({
      'Pay ($300)': -300,
      Refuse: Number.NEGATIVE_INFINITY,
    })
    expect(pickOf(sim, c)).toBe('Pay ($300)')
    const tally = newTally()
    eventPolicyStep(sim, tally)
    expect(sim.state.events.scheduled).toEqual([])
    expect(sim.state.economy.lives).toBe(1)
    // Two lives: the strike is a cost, not the end — the chain weight only (Q-B3-8).
    sim.state.economy.balance = 350
    sim.state.economy.lives = 2
    c = open(sim, 'ev_t_trap')
    expect(scores(sim, c)).toEqual({ 'Pay ($300)': -300, Refuse: W.chain })
    expect(pickOf(sim, c)).toBe('Refuse')
    sim.state.events.open = null
    // One life, the link's Pay ($500) affordable now: the link has a way out.
    sim.state.economy.balance = 600
    sim.state.economy.lives = 1
    c = open(sim, 'ev_t_trap')
    expect(scores(sim, c)).toEqual({ 'Pay ($300)': -300, Refuse: W.chain })
    // The probe of the review: the policy at 1 life never ends its own run.
    const run = simOn(withDeck(TRAP))
    run.state.economy.balance = 350
    run.state.economy.lives = 1
    const policy = createPolicy(run, 'competent')
    try {
      open(run, 'ev_t_trap')
      for (let i = 0; i < 3 * TICKS_PER_DAY; i++) {
        policy.step()
        run.tick()
      }
    } finally {
      policy.dispose?.()
    }
    expect(run.state.economy.gameOver).toBe(false)
    expect(run.state.economy.lives).toBe(1)
  })

  it('ties → the default, then the lowest index; hidden or unaffordable options never count', () => {
    const sim = makeSim(1)
    const c = card(sim)
    const opts = [
      option([], { index: 0, label: 'a' }),
      option([], { index: 1, label: 'b', default: true }),
      option([{ kind: 'money', delta: 5 }], {
        index: 2,
        label: 'c',
        visible: false,
      }),
      option([{ kind: 'money', delta: 9 }], {
        index: 3,
        label: 'd',
        affordable: false,
      }),
    ]
    expect(chooseOption(sim, c, opts)?.option.label).toBe('b')
    expect(chooseOption(sim, c, opts.slice(0, 1))?.option.label).toBe('a')
    expect(
      chooseOption(sim, c, [
        option([], { index: 1, label: 'y' }),
        option([], { index: 0, label: 'x' }),
      ])?.option.label,
    ).toBe('x')
    expect(chooseOption(sim, c, opts.slice(2))).toBeNull()
    // The radio ad (seed deck): −$120 against +$120 of orders is a tie → No.
    const ad = open(sim, 'ev_press_ad')
    expect(scores(sim, ad)).toEqual({ 'Buy ($120)': 0, No: 0 })
    expect(pickOf(sim, ad)).toBe('No')
  })

  it('a scripted deck → the expected picks, each answered by eventPolicyStep on the step it opens (decideEvent logged, the tally counts decisions only)', () => {
    const sim = simOn(withDeck([CAKE, LOAN, ...ROUTED, ...INVESTOR]))
    sim.state.level.level = 2
    buy(sim, 'bike')
    sim.state.economy.balance = 450
    const script: [string, string][] = [
      ['ev_t_birthday', 'Cake for everyone'],
      ['ev_t_loan', 'No'],
      ['ev_t_prep', 'Prepare'],
      ['ev_money_grant', 'Apply'],
      ['ev_fleet_tyres', 'No'],
      ['ev_cust_refund', 'Refuse'],
      ['ev_tech_barcode', 'Adopt ($50)'],
      ['ev_luck_friend', 'Hire them'],
      ['ev_wx_rain', 'OK'],
      ['ev_crime_gang', 'Deny'],
      ['ev_t_investor', 'Take it'],
    ]
    const tally = newTally()
    let decisions = 0
    let nonDefault = 0
    for (const [id, label] of script) {
      const c = open(sim, id)
      const opts = cardOptions(sim, c)
      const want = opts.find((o) => o.label === label)!
      expect(want, id).toBeDefined()
      const n = sim.commandLog.length
      eventPolicyStep(sim, tally)
      expect(sim.state.events.open, id).toBeNull()
      expect(
        sim.commandLog.slice(n).map((e) => e.cmd),
        id,
      ).toEqual([{ kind: 'decideEvent', eventId: id, option: want.index }])
      if (opts.length > 1) {
        decisions += 1
        if (!want.default) nonDefault += 1
      }
    }
    expect(tally.decisions).toBe(decisions)
    expect(tally.nonDefault).toBe(nonDefault)
    expect(Number.isFinite(tally.evSum)).toBe(true)
  })

  it('a job card: Accept = max(1, the reward value) ≥ Decline (0) for every template at every level (D-37); the policy accepts through decideEvent', () => {
    const sim = makeSim(1)
    expect(
      sim.dispatch({ kind: 'debugOfferQuest', templateId: 'rush_district' }).ok,
    ).toBe(true)
    const c = sim.state.events.open!
    expect(c.kind).toBe('job')
    const [accept, decline] = cardOptions(sim, c)
    const q = sim.state.quests.offer!
    expect(scoreOption(sim, c, decline!)).toBe(0)
    expect(scoreOption(sim, c, accept!)).toBe(Math.max(1, q.reward.cash))
    for (const t of data.quests.templates) {
      const cash = t.reward?.cash ?? 0
      for (const lvlCash of Array.isArray(cash) ? cash : [cash]) {
        sim.state.quests.offer = {
          ...q,
          templateId: t.id,
          reward: {
            cash: lvlCash,
            lives: t.reward?.lives ?? 0,
            satisfaction: t.reward?.satisfaction ?? 0,
            star: t.reward?.starApplicant ?? null,
            voucher: t.reward?.voucher ?? null,
            victory: false,
          },
        }
        const a = scoreOption(sim, c, accept!)
        expect(a, t.id).toBeGreaterThanOrEqual(1)
        expect(a, t.id).toBeGreaterThanOrEqual(scoreOption(sim, c, decline!))
      }
    }
    sim.state.quests.offer = q
    const tally = newTally()
    eventPolicyStep(sim, tally)
    expect(sim.commandLog.at(-1)?.cmd).toEqual({
      kind: 'decideEvent',
      eventId: c.eventId,
      option: accept!.index,
    })
    expect(sim.state.quests.active?.id).toBe(q.id)
    expect(tally).toEqual(newTally()) // jobs are not decisions
  })

  it('answerWithDefault (--policy none, D-8) takes the default option; false with no card', () => {
    const sim = makeSim(1)
    expect(answerWithDefault(sim)).toBe(false)
    open(sim, 'ev_money_grant')
    expect(answerWithDefault(sim)).toBe(true)
    expect(sim.state.events.history.at(-1)).toMatchObject({
      eventId: 'ev_money_grant',
      label: 'Skip',
      default: true,
    })
  })
})

describe('M12 review: per-vehicle prices, driverless vehicles, the poach tie', () => {
  const drivers = (sim: Sim) =>
    sim.state.employees.filter((e) => e.role === 'driver')

  it('deck-1: a costPerVehicle option is priced at each × the fleet — greyed while short (never clamped to a free upgrade), its line names the count, decide debits it once', () => {
    const sim = makeSim(1)
    buy(sim, 'bike')
    buy(sim, 'bike')
    buy(sim, 'bike')
    sim.state.economy.balance = 100
    const c = open(sim, 'ev_staff_radio')
    const [buyIt, no] = cardOptions(sim, c)
    expect(buyIt).toMatchObject({
      label: 'Buy them',
      cost: 120,
      perVehicle: { each: 40 },
      affordable: false,
    })
    expect(no).toMatchObject({ cost: 0, affordable: true, default: true })
    expect(optionLines(sim, c, buyIt!)[0]).toEqual({
      text: '−$120 ($40 × 3 vehicles)',
      tone: 'cost',
    })
    // The policy never counts an unaffordable price as a cheap upgrade.
    expect(pickOf(sim, c)).toBe('No')
    const energy = drivers(sim).map((e) => e.pips.energy)
    expect(
      sim.dispatch({ kind: 'decideEvent', eventId: c.eventId, option: 0 }),
    ).toEqual({ ok: false, reason: 'cant-afford' })
    expect(sim.state.economy.balance).toBe(100)
    expect(drivers(sim).map((e) => e.pips.energy)).toEqual(energy)
    sim.state.economy.balance = 130
    expect(scores(sim, c)['Buy them']).toBe(-120 + 3 * W.pips.energy!)
    expect(
      sim.dispatch({ kind: 'decideEvent', eventId: c.eventId, option: 0 }).ok,
    ).toBe(true)
    expect(sim.state.economy.balance).toBe(10)
    expect(drivers(sim).map((e) => e.pips.energy)).toEqual(
      energy.map((x) => Math.min(5, (x ?? 0) + 1)),
    )
  })

  it('deck-2: a driver a card took (the poach) and a driverless gift (the buy-out van) each get the best driver applicant on the next policy step', () => {
    const sim = makeSim(1)
    buy(sim, 'bike')
    buy(sim, 'bike')
    sim.state.economy.balance = 1000
    const poach = open(sim, 'ev_cust_rival_poach')
    const quitter = poach.pick!.id
    const bike = sim.state.vehicles.find((v) => v.driverId === quitter)!
    expect(
      sim.dispatch({ kind: 'decideEvent', eventId: poach.eventId, option: 1 })
        .ok,
    ).toBe(true)
    expect(bike.driverId).toBeNull()
    expect(bike.state).toBe('inactive')
    const trouble = open(sim, 'ev_cust_rival_trouble')
    expect(
      sim.dispatch({ kind: 'decideEvent', eventId: trouble.eventId, option: 0 })
        .ok,
    ).toBe(true)
    const van = sim.state.vehicles.find((v) => v.type === 'van')!
    expect(van.driverId).toBeNull()
    sim.state.economy.balance = 1000
    const policy = createPolicy(sim, 'competent')
    policy.step()
    policy.dispose?.()
    expect(bike.driverId).not.toBeNull()
    expect(bike.driverId).not.toBe(quitter)
    expect(van.driverId).not.toBeNull()
    expect(bike.state).not.toBe('inactive')
    expect(van.state).not.toBe('inactive')
    const hires = sim.commandLog
      .map((e) => e.cmd)
      .filter((cmd) => cmd.kind === 'hire' && cmd.role === 'driver')
    expect(hires.map((cmd) => (cmd as { target: unknown }).target)).toEqual([
      { vehicleId: bike.id },
      { vehicleId: van.id },
    ])
  })

  it('deck-2: short of the fee + buffer, or with no applicant, the vehicle waits (never a refused hire)', () => {
    const sim = makeSim(1)
    buy(sim, 'bike')
    buy(sim, 'bike')
    sim.state.economy.balance = 1000
    const poach = open(sim, 'ev_cust_rival_poach')
    sim.dispatch({ kind: 'decideEvent', eventId: poach.eventId, option: 1 })
    const idle = sim.state.vehicles.find((v) => v.driverId === null)!
    sim.state.economy.balance = 0
    const policy = createPolicy(sim, 'competent')
    policy.step()
    expect(idle.driverId).toBeNull()
    sim.state.applicants.driver = []
    sim.state.economy.balance = 1000
    policy.step()
    expect(idle.driverId).toBeNull()
    policy.dispose?.()
    expect(
      sim.commandLog.some(
        (e) => e.cmd.kind === 'hire' && e.cmd.role === 'driver',
      ),
    ).toBe(false)
  })

  it('deck-3: the poach is no tie — the bonus is the cheaper answer, so the policy keeps the driver', () => {
    const sim = makeSim(1)
    buy(sim, 'bike')
    sim.state.economy.balance = 500
    const c = open(sim, 'ev_cust_rival_poach')
    expect(scores(sim, c)).toEqual({
      'Match it (a bonus)': -180 + W.chain,
      'Let them go': -W.staffQuit + W.chain,
    })
    expect(pickOf(sim, c)).toBe('Match it (a bonus)')
  })
})

describe('the seed deck under the policy', () => {
  it('no option scores above policy.evMax state-free, life gains left out (critique 20); deckEvMean printed', () => {
    expect(evMaxViolations(data)).toEqual([])
    const mean = deckEvMean(data)
    expect(mean).not.toBeNull()
    const all = data.events.deck.flatMap((d) =>
      (d.options ?? []).map((o) => staticScore(data, d, o)),
    )
    expect(mean).toBeCloseTo(all.reduce((a, b) => a + b, 0) / all.length, 2)
    console.log(
      `[events-policy] deckEvMean ${mean} over ${all.length} options (evMax ${data.events.policy.evMax})`,
    )
    // The gang's raid: +$100, +3 happiness × 2 districts, wanted +1, +1 life.
    const bust = data.events.deck.find((d) => d.id === 'ev_crime_gang_bust')!
    const bustScore = 100 + W.satisfactionPerPoint * 3 * 2 + W.wantedPerLabel
    expect(staticScore(data, bust, bust.options![0]!)).toBe(bustScore + W.life)
    expect(
      staticScore(data, bust, bust.options![0]!, { lifeGains: false }),
    ).toBe(bustScore)
  })

  it('staticScore: lives ±life (never −∞), one person, a vehicle loss at its list price, the chain only for a next, 0 for end / moneyPct', () => {
    const def = data.events.deck.find((d) => d.id === 'ev_crime_gang_watch')!
    const bike = data.vehicles.types.find((t) => t.id === 'bike')!
    expect(def.options!.map((o) => staticScore(data, def, o))).toEqual([
      -75 + W.chain,
      -bike.price + W.chain,
    ])
    const recall = data.events.deck.find((d) => d.id === 'ev_sec_recall')!
    expect(recall.options!.map((o) => staticScore(data, recall, o))).toEqual([
      -250,
      -W.life,
    ])
    const training = data.events.deck.find((d) => d.id === 'ev_staff_training')!
    expect(
      training.options!.map((o) => staticScore(data, training, o)),
    ).toEqual([-150 + W.pips.eye!, -60 + W.pips.eye!, 0])
    const synthetic: EventDef = {
      id: 'ev_t_static',
      category: 'money',
      title: 't',
      minLevel: 4,
      body: 'b',
      options: [
        {
          label: 'a',
          effects: [
            { kind: 'moneyPct', pct: -0.5 },
            { kind: 'end', eventId: 'ev_x' },
            { kind: 'moneyPerVehicle', delta: -40 },
            { kind: 'satisfaction', scope: 'all', delta: 1 },
          ],
        },
      ],
    }
    // L4: highres, downtown, industrial, lowres, rural spawn.
    expect(staticScore(data, synthetic, synthetic.options![0]!)).toBe(
      -40 + W.satisfactionPerPoint * 5,
    )
  })

  it('a 30-minute decks-on run under the competent policy (seed 3): every card is answered on the step it opens and the picks are the ones the data implies', () => {
    SIM_FEATURES.events = true
    const sim = deckOn(makeSim(3))
    const policy = createPolicy(sim, 'competent')
    const offered: { id: string; tick: number }[] = []
    const decided: { id: string; label: string; tick: number }[] = []
    onSimEvent(sim.events, 'event:offered', (p) => {
      offered.push({ id: p.eventId, tick: sim.state.tick })
    })
    onSimEvent(sim.events, 'event:decided', (p) => {
      decided.push({ id: p.eventId, label: p.label, tick: sim.state.tick })
    })
    for (let i = 0; i < 30 * TICKS_PER_DAY; i++) {
      policy.step()
      sim.tick()
    }
    policy.step()
    const m = policy.metrics?.()
    policy.dispose?.()
    expect(sim.state.events.open).toBeNull()
    expect(offered.length).toBeGreaterThan(10)
    expect(decided.length).toBe(offered.length)
    for (const [i, o] of offered.entries()) {
      expect(decided[i]?.id).toBe(o.id)
      expect(decided[i]!.tick - o.tick).toBeLessThanOrEqual(1)
    }
    // Picks the state cannot change (B3 §3.8 weights on the seed deck).
    const fixed: Record<string, string> = {
      ev_money_grant: 'Apply',
      ev_fleet_tyres: 'No',
      ev_cust_refund: 'Refuse',
      ev_tech_barcode: 'Adopt ($50)',
      ev_press_ad: 'No',
      ev_port_fastlane: 'No',
      ev_luck_friend: 'Hire them',
      ev_crime_gang: 'Deny',
      ev_crime_gang_watch: 'Yes',
      ev_sec_recall: 'Pay the fine ($250)',
      ev_city_audit_fine: 'Pay ($400)',
    }
    for (const d of decided) {
      if (d.id.startsWith('job:')) expect(d.label, d.id).toBe('Accept')
      else if (fixed[d.id] !== undefined)
        expect(d.label, d.id).toBe(fixed[d.id])
    }
    const nonJob = decided.filter((d) => !d.id.startsWith('job:'))
    console.log(
      `[events-policy] seed 3 × 30 min: ${offered.length} cards (${nonJob.length} deck) · tally ${JSON.stringify(m)} · ${nonJob.map((d) => `${d.id}=${d.label}`).join(', ')}`,
    )
    expect(nonJob.length).toBeGreaterThan(0)
    expect(m?.decisions).toBeGreaterThan(0)
  }, 60_000)
})

describe('the CLI and the report, build 3 (B3 §3.9; M11 contract §3 D tasks 6-7)', () => {
  it('--events on|off sets the decision draw; a gate with the non-default value writes its own files', () => {
    expect(parseCli([]).events).toBeNull()
    expect(parseCli(['--events', 'on']).events).toBe(true)
    expect(parseCli(['--events', 'off']).events).toBe(false)
    expect(() => parseCli(['--events', 'maybe'])).toThrow(UsageError)
    const other = !BUILD_EVENTS
    const word = other ? 'on' : 'off'
    const base = { quick: false, policy: null, minutes: 30 }
    expect(gateFileBase({ ...base, events: BUILD_EVENTS })).toBe('latest')
    expect(gateFileBase({ ...base, events: other })).toBe(
      `latest-events-${word}`,
    )
    expect(gateFileBase({ ...base, minutes: 35, events: other })).toBe(
      `latest-35min-events-${word}`,
    )
    expect(gateFileBase({ ...base, quick: true, events: other })).toBe(
      `quick-events-${word}`,
    )
    expect(gateFileBase(base)).toBe('latest')
  })

  it('--policy none answers every card with its default (the hold never freezes the run); the policy run reads the tally before dispose', () => {
    const none = runSeed(data, 1, 6, null)
    expect(none.result.asserts).toEqual([])
    expect(none.perf.ticks).toBe(6 * TICKS_PER_DAY)
    const offered = none.events.filter((e) => e.name === 'event:offered')
    const decided = none.events.filter((e) => e.name === 'event:decided')
    expect(offered.length).toBeGreaterThan(0)
    expect(decided.length).toBe(offered.length)
    expect(decided.every((e) => e.default === true)).toBe(true)
    expect(none.result.metrics.policyEvPerCard).toBeNull()
    SIM_FEATURES.events = true
    const on = runSeed(data, 1, 10, createPolicy)
    expect(on.result.asserts).toEqual([])
    const m = on.result.metrics
    expect(m.eventsOpenMaxTicks).toBeLessThanOrEqual(1)
    expect(m.eventsOffered30).toBe(
      on.events.filter((e) => e.name === 'event:offered').length,
    )
    expect(
      m.policyEvPerCard === null || Number.isFinite(m.policyEvPerCard),
    ).toBe(true)
    expect(
      on.result.checks.find((c) => c.key === 'policyEvPerCard')?.target,
    ).toContain(
      `${data.events.policy.evBand[0]} to ${data.events.policy.evBand[1]}`,
    )
  }, 60_000)

  it('eventMetrics: cards by 30 min, the longest open span (decided / withdrawn / still open at the end), L1 decisions from minute 3 to L2, the non-default share, the tally mean, the informational counts', () => {
    const events: RecordedEvent[] = [
      ev(at(2), 'event:offered', {
        eventId: 'a',
        kind: 'decision',
        category: 'staff',
      }),
      ev(at(2), 'event:decided', {
        eventId: 'a',
        kind: 'decision',
        default: false,
      }),
      ev(at(4), 'event:offered', {
        eventId: 'b',
        kind: 'decision',
        category: 'staff',
      }),
      ev(at(4, 1), 'event:decided', {
        eventId: 'b',
        kind: 'decision',
        default: true,
      }),
      ev(at(5), 'event:offered', {
        eventId: 'job:x',
        kind: 'job',
        category: 'job',
      }),
      ev(at(5, 3), 'event:withdrawn', { eventId: 'job:x' }),
      ev(at(9), 'event:offered', {
        eventId: 'c',
        kind: 'news',
        category: 'weather',
      }),
      ev(at(9), 'event:decided', { eventId: 'c', kind: 'news', default: true }),
      ev(at(11), 'event:offered', {
        eventId: 'd',
        kind: 'decision',
        category: 'money',
      }),
      ev(at(11), 'event:decided', {
        eventId: 'd',
        kind: 'decision',
        default: false,
      }),
      ev(at(12), 'modifier:applied', { id: 'm1' }),
      ev(at(12), 'modifier:applied', { id: 'm2' }),
      ev(at(13), 'modifier:expired', { id: 'm1' }),
      ev(at(13), 'modifier:applied', { id: 'm3' }),
      ev(at(14), 'life:lost', { cause: 'event', eventId: 'd' }),
      ev(at(14), 'life:lost', { cause: 'malware', parcelId: 1 }),
      ev(at(15), 'life:gained', { reason: 'event', delta: 1 }),
      ev(at(15), 'life:gained', { reason: 'quest', delta: 1 }),
      ev(at(16), 'vehicle:lost', {
        id: 1,
        type: 'bike',
        eventId: 'g',
        last: false,
      }),
      ev(at(16), 'worker:fired', { reason: 'event' }),
      ev(at(16), 'worker:fired', { reason: 'fired' }),
      ev(at(29), 'event:offered', {
        eventId: 'e',
        kind: 'decision',
        category: 'press',
      }),
      ev(at(31), 'event:offered', {
        eventId: 'f',
        kind: 'decision',
        category: 'press',
      }),
      ev(at(32), 'game:over', { cause: 'event' }),
    ]
    const end = at(33)
    const m = eventMetrics(
      events,
      end,
      at(10),
      { decisions: 4, evSum: 30, nonDefault: 2 },
      {
        chainsStarted: 2,
        chainsFinished: 1,
      },
    )
    expect(m).toEqual({
      eventsOffered30: 6,
      eventsOpenMaxTicks: end - at(29), // `e` is still open at the end
      eventsL1Decisions: 1, // `b` (min 4); `a` is before min 3, `d` after L2
      policyEvPerCard: 7.5,
      policyNonDefaultShare: 0.667,
      eventsByCategory: { staff: 2, job: 1, weather: 1, money: 1, press: 2 },
      chainsStarted: 2,
      chainsFinished: 1,
      modifiersActiveMax: 2,
      eventLivesLost: 1,
      eventLivesGained: 1,
      eventVehiclesLost: 1,
      eventWorkersLost: 1,
      eventGameOvers: 1,
    })
    // Without L2 the plateau runs to the end; without a tally no EV.
    const noL2 = eventMetrics(events, end, null)
    expect(noL2.eventsL1Decisions).toBe(4) // b, d, e, f
    expect(noL2.policyEvPerCard).toBeNull()
    expect(noL2.chainsStarted).toBeNull()
    // computeMetrics: the lives row counts malware only (critique 26).
    const stats = makeSim(1).state.stats
    const cm = computeMetrics(1, 33, events, [], stats, null, null)
    expect(cm.livesLost).toBe(1)
    expect(cm.eventLivesLost).toBe(1)
  })

  it('the five event rows gate behind SIM_FEATURES.events (informational (M12) when off); the policy band comes from events.json policy (D-42); eventsOfferedBy30MinMin is informational on a shorter run', () => {
    const m = {
      firstDeliveryS: 40,
      firstMalwareCaughtS: 100,
      level2Min: 10,
      truckAfterLevel2Min: 1,
      livesLost: 0,
      shelfStallS: 0,
      holdBayEventsPer10MinL1: 8,
      questsOffered30: 5,
      questsCompleted30: 3,
      eventsOffered30: 20,
      eventsOpenMaxTicks: 0,
      eventsL1Decisions: 4,
      policyEvPerCard: 12,
      policyNonDefaultShare: 0.5,
    }
    const keys = [
      'eventsOfferedBy30MinMin',
      'eventsOpenMaxTicks',
      'eventsL1PlateauMin',
      'policyEvPerCard',
      'policyNonDefaultShare',
    ]
    const rows = (cs: ReturnType<typeof checkMetrics>) =>
      cs.filter((c) => keys.includes(c.key)).map((c) => [c.key, c.pass, c.note])
    const off = { ...SIM_FEATURES, events: false }
    const on = { ...SIM_FEATURES, events: true }
    const band = data.events.policy
    expect(rows(checkMetrics(m, targets, off, null, band))).toEqual(
      keys.map((k) => [k, true, 'informational (M12)']),
    )
    expect(rows(checkMetrics(m, targets, on, null, band))).toEqual(
      keys.map((k) => [k, true, null]),
    )
    const bad = {
      ...m,
      eventsOffered30: targets.eventsOfferedBy30MinMin - 1,
      eventsOpenMaxTicks: targets.eventsOpenMaxTicks + 1,
      eventsL1Decisions: targets.eventsL1PlateauMin - 1,
      policyEvPerCard: band.evBand[1] + 1,
      policyNonDefaultShare: band.nonDefaultShareMin - 0.01,
    }
    expect(rows(checkMetrics(bad, targets, on, null, band))).toEqual(
      keys.map((k) => [k, false, null]),
    )
    expect(
      checkMetrics(
        { ...m, policyEvPerCard: band.evBand[0] },
        targets,
        on,
        null,
        band,
      ).find((c) => c.key === 'policyEvPerCard')?.pass,
    ).toBe(true)
    // No band: the policy rows are informational, never a silent pass.
    const noBand = checkMetrics(m, targets, on)
    expect(
      noBand
        .filter((c) => c.key.startsWith('policy'))
        .map((c) => [c.pass, c.note]),
    ).toEqual([
      [false, NO_POLICY_BAND_NOTE],
      [false, NO_POLICY_BAND_NOTE],
    ])
    // Absent metrics (a build-2 GateInputs): never = fail when gated.
    const bare = { ...m } as Partial<typeof m>
    for (const k of [
      'eventsOffered30',
      'eventsOpenMaxTicks',
      'eventsL1Decisions',
      'policyEvPerCard',
      'policyNonDefaultShare',
    ] as const) {
      delete bare[k]
    }
    expect(
      rows(checkMetrics(bare as typeof m, targets, on, null, band)).map(
        (r) => r[1],
      ),
    ).toEqual([false, false, false, false, false])
    const short = checkMetrics({ ...m, minutes: 20 }, targets, on, null, band)
    expect(short.find((c) => c.key === 'eventsOfferedBy30MinMin')?.note).toBe(
      'informational (minutes too short)',
    )
  })

  it('the summary prints the policy weights, the event rows and deckEvMean; the narrative names a decided card, an event’s life, a lost vehicle and an event game over', () => {
    SIM_FEATURES.events = true
    const run = runSeed(data, 2, 8, createPolicy)
    const g = summarise([run.result], {
      dataHash: data.hash,
      config: null,
      policy: 'competent',
      minutes: 8,
      targets,
      eventPolicy: data.events.policy,
      deckEvMean: deckEvMean(data),
    })
    expect(g.eventPolicy).toEqual(data.events.policy)
    const info = Object.fromEntries(g.informational.map((i) => [i.key, i]))
    for (const k of [
      'eventsByCategory',
      'chainsStarted',
      'modifiersActiveMax',
      'eventLivesLost',
      'eventLivesGained',
      'eventVehiclesLost',
      'eventWorkersLost',
      'eventGameOvers',
      'deckEvMean',
      'livesLostShare',
    ]) {
      expect(info[k], k).toBeDefined()
    }
    expect(info.deckEvMean?.median).toBe(deckEvMean(data))
    expect(info.livesLostShare?.text).toMatch(/^\d+\/1 seeds$/)
    expect(info.eventsByCategory?.text).toContain('job')
    expect(policyWeightsLine(data.events.policy)).toContain(
      `life ${W.life} (the last −∞)`,
    )
    const lights = new Highlights()
    const sim = makeSim(1)
    const line = (e: Record<string, unknown>): string | null =>
      lights.line({ tick: 600, ...e } as RecordedEvent, sim)
    expect(
      line({
        name: 'life:lost',
        cause: 'event',
        title: 'The recall',
        option: 'Take the strike',
        lives: 2,
      }),
    ).toBe(
      '!  1:00 LIFE LOST to an event: The recall — "Take the strike" (lives 2)',
    )
    expect(
      line({
        name: 'event:decided',
        eventId: 'ev_x',
        label: 'Yes',
        default: false,
        kind: 'decision',
      }),
    ).toBe('!  1:00 card ev_x: "Yes" (not the default)')
    expect(
      line({
        name: 'event:decided',
        eventId: 'job:x',
        label: 'Accept',
        default: false,
        kind: 'job',
      }),
    ).toBeNull()
    expect(
      line({
        name: 'vehicle:lost',
        id: 2,
        type: 'bike',
        eventId: 'ev_g',
        last: true,
      }),
    ).toBe('!  1:00 bike 2 lost to ev_g — the last vehicle')
    expect(line({ name: 'game:over', cause: 'event' })).toBe(
      '!  1:00 GAME OVER (an event took the last life)',
    )
    expect(line({ name: 'game:over', cause: 'malware' })).toBe(
      '!  1:00 GAME OVER',
    )
  }, 60_000)
})
