// The ViewSim's build-3 surface (spec-build3 §3.4, §6; M11 contract §3
// stream E): events() — the open card as the EventCard will draw it (the
// category word and picture, the filled title / body, the HUD day, the
// parent's `You chose: …`, the visible options with their generated lines,
// `Can't afford` on a paid option the balance does not cover), a job card
// (its quest's name and flavour, Accept / Decline with the reward and the
// decline cooldown), links and the next due tick, history, the live
// modifiers newest first — cached per sim revision; event.decide and
// debug.offerEvent (logged commands); effectSummary / modifierSummary /
// priceOf passthroughs; and the modded display numbers (the payroll per day,
// a hub's clearance under a clearanceS modifier), plus
// QuestsView.nextOfferInTicks as critique 19 defines it.
import { describe, expect, it } from 'vitest'
import { createViewSim } from '../../src/sim/view-api.ts'
import { applyModifier } from '../../src/sim/systems/modifierOps.ts'
import { payrollDuePerDay } from '../../src/sim/systems/payroll.ts'
import { DECK_OFF_TICK } from '../../src/sim/systems/deck.ts'
import { TICKS_PER_DAY } from '../../src/sim/types.ts'
import type { Sim } from '../../src/sim/sim.ts'
import type { ModifierKey } from '../../src/data/types.ts'
import {
  dataFixture,
  deckOn,
  makeSim,
  offerQuest,
  runTicks,
  unlockDistrict,
} from '../sim/helpers.ts'

const DAY = TICKS_PER_DAY

/** A modifier row by hand (modifierOps, as an event's `mod` would). */
function mod(
  sim: Sim,
  key: ModifierKey,
  m: { mult?: number; add?: number; scope?: string; days?: number },
) {
  return applyModifier(sim, {
    key,
    mult: m.mult ?? 1,
    add: m.add ?? 0,
    scope: m.scope ?? null,
    untilTick: m.days === undefined ? null : sim.state.tick + m.days * DAY,
    eventId: 'ev_test',
    label: 'Test card',
  })
}

describe('ViewSim.events(): the deck as the HUD reads it', () => {
  it('a deck-off sim: nothing open, no link, no draw due, no modifier', () => {
    const vs = createViewSim(makeSim(1))
    expect(vs.events()).toEqual({
      open: null,
      queue: 0,
      scheduledCount: 0,
      nextDueTicks: null,
      history: [],
      modifiers: [],
    })
  })

  it('cached per sim revision: the same object until a tick or a command', () => {
    const sim = deckOn(makeSim(1))
    const vs = createViewSim(sim)
    const a = vs.events()
    expect(vs.events()).toBe(a)
    expect(a.nextDueTicks).toBe(
      sim.data.events.schedule.firstEventS * 10 - sim.state.tick,
    )
    runTicks(sim, 1)
    const b = vs.events()
    expect(b).not.toBe(a)
    expect(b.nextDueTicks).toBe(a.nextDueTicks! - 1)
  })

  it('debug.offerEvent opens a deck card: word, picture, filled copy, the HUD day, the visible options with their lines', () => {
    const sim = makeSim(1)
    sim.state.tick = 2 * DAY + 10
    sim.state.economy.balance = 1000
    const vs = createViewSim(sim, { debug: true })
    expect(vs.debug!.offerEvent('ev_staff_training').ok).toBe(true)
    const open = vs.events().open!
    expect(open).toMatchObject({
      eventId: 'ev_staff_training',
      kind: 'decision',
      category: 'staff',
      word: 'STAFF',
      picture: 'ev_pic_staff',
      title: 'Scanner course',
      body: 'A one-day scanning course is on offer in Registry Row.',
      day: 3,
      parentChoice: null,
      questId: null,
    })
    expect(open.options.map((o) => [o.index, o.cost, o.default])).toEqual([
      [0, 150, false],
      [1, 60, false],
      [2, 0, true],
    ])
    // The inspector pick is drawn when the card opens and fills the label.
    const audrey = sim.state.employees[0]!.name
    expect(open.options[1]!.label).toBe(`Send ${audrey}`)
    expect(open.options[0]!.lines[0]).toEqual({ text: '−$150', tone: 'cost' })
    expect(open.options.every((o) => o.affordable && o.reason === null)).toBe(
      true,
    )
    // The command was logged (a replay sees it).
    expect(sim.commandLog.at(-1)?.cmd).toEqual({
      kind: 'debugOfferEvent',
      eventId: 'ev_staff_training',
    })
  })

  it("a paid option the balance does not cover: affordable false and the reason `Can't afford`", () => {
    const sim = makeSim(1)
    sim.state.economy.balance = 100
    const vs = createViewSim(sim, { debug: true })
    vs.debug!.offerEvent('ev_staff_training')
    const o = vs.events().open!.options
    expect(o.map((x) => [x.affordable, x.reason])).toEqual([
      [false, "Can't afford"],
      [true, null],
      [true, null],
    ])
  })

  it('an option whose `if` fails is not shown (options keep their data index)', () => {
    // A config patch merges arrays by index: hide the course's first option.
    const at = dataFixture().events.deck.findIndex(
      (d) => d.id === 'ev_staff_training',
    )
    const deck = Array.from({ length: at + 1 }, (_, i) =>
      i === at ? { options: [{ if: { livesAtLeast: 9 } }] } : {},
    )
    const sim = makeSim(1, { events: { deck } })
    sim.state.economy.balance = 1000
    const vs = createViewSim(sim, { debug: true })
    expect(sim.data.events.deck[at]!.id).toBe('ev_staff_training')
    vs.debug!.offerEvent('ev_staff_training')
    expect(vs.events().open!.options.map((o) => o.index)).toEqual([1, 2])
  })

  it('event.decide answers the card: it closes, the history records the choice', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim, { debug: true })
    vs.debug!.offerEvent('ev_money_grant')
    const before = sim.state.economy.balance
    expect(vs.event.decide('ev_money_grant', 0).ok).toBe(true)
    const ev = vs.events()
    expect(ev.open).toBeNull()
    expect(ev.history.at(-1)).toMatchObject({
      eventId: 'ev_money_grant',
      option: 0,
      label: 'Apply',
      outcome: 'decided',
    })
    expect(sim.state.economy.balance).toBe(before + 150)
    expect(sim.commandLog.at(-1)?.cmd).toEqual({
      kind: 'decideEvent',
      eventId: 'ev_money_grant',
      option: 0,
    })
    expect(vs.event.decide('ev_money_grant', 0)).toMatchObject({
      ok: false,
      reason: 'no-event',
    })
  })

  it("a chain: the link booked shows in scheduledCount / nextDueTicks, and opens with the parent's `You chose: …`", () => {
    const sim = makeSim(1)
    // Past the deck's quiet first firstEventS (links wait for it too).
    runTicks(sim, sim.data.events.schedule.firstEventS * 10 + 100)
    const vs = createViewSim(sim, { debug: true })
    vs.debug!.offerEvent('ev_crime_gang')
    expect(vs.events().open!.options.map((o) => o.label)).toEqual([
      'Accept ($300)',
      'Deny',
    ])
    expect(vs.events().open!.options[1]!.lines.at(-1)?.text).toBe(
      '…then: On the doorstep (in 1 day)',
    )
    vs.event.decide('ev_crime_gang', 1)
    let ev = vs.events()
    expect(ev.scheduledCount).toBe(1)
    expect(ev.nextDueTicks).toBe(DAY)
    runTicks(sim, DAY + 1)
    ev = vs.events()
    expect(ev.open).toMatchObject({
      eventId: 'ev_crime_gang_watch',
      title: 'On the doorstep',
      parentChoice: 'You chose: Deny',
    })
    expect(ev.scheduledCount).toBe(0)
  })

  it('a job card: JOB BOARD, the quest name and flavour, Accept (the reward) / Decline (the cooldown)', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim, { debug: true })
    const q = offerQuest(sim, 'rush_district')
    const open = vs.events().open!
    const quest = vs.quests().offer!
    expect(open).toMatchObject({
      eventId: 'job:rush_district',
      kind: 'job',
      category: 'job',
      word: 'JOB BOARD',
      picture: 'ev_pic_job',
      title: 'Rush hour',
      body: quest.flavour,
      questId: q.id,
    })
    expect(open.options.map((o) => [o.index, o.label, o.default])).toEqual([
      [0, 'Accept', false],
      [1, 'Decline', true],
    ])
    expect(open.options[0]!.lines.map((l) => l.text).join(' · ')).toMatch(
      /^Reward: .+ · Limit: 3 days$/,
    )
    expect(open.options[1]!.lines.map((l) => l.text)).toEqual([
      'Next job in 1 day',
    ])
    // The HUD's acceptQuest is the card's answer (commands.ts routes it).
    expect(vs.quest.accept(q.id).ok).toBe(true)
    expect(vs.events().open).toBeNull()
    expect(vs.quests().active?.id).toBe(q.id)
  })

  it('the live modifiers, newest first, with their words and time left (permanent: null)', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    const a = mod(sim, 'speed', { mult: 0.85, scope: 'bike', days: 1 })
    const b = mod(sim, 'processS', { mult: 0.9 })
    runTicks(sim, 100)
    const list = vs.events().modifiers
    expect(list.map((m) => m.id)).toEqual([b.id, a.id])
    expect(list[1]).toMatchObject({
      key: 'speed',
      untilTick: a.untilTick,
      ticksLeft: DAY - 100,
      eventId: 'ev_test',
      label: 'Test card',
    })
    expect(list[1]!.line).toBe(vs.modifierSummary(a))
    expect(list[1]!.line).toContain('×0.85')
    expect(list[0]).toMatchObject({ untilTick: null, ticksLeft: null })
    // Expired: gone from the list (the deck step ends it).
    runTicks(sim, DAY)
    expect(vs.events().modifiers.map((m) => m.id)).toEqual([b.id])
  })
})

describe('ViewSim build-3 helpers and modded numbers (B3 §3.6)', () => {
  it('effectSummary is the sim’s words; priceOf follows vehiclePrice / machinePrice', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    const lines = vs.effectSummary([{ kind: 'money', delta: 60 }], {
      eventId: 'ev_x',
      title: 'X',
      target: null,
      pick: null,
    })
    expect(lines).toEqual([{ text: '+$60', tone: 'gain' }])
    expect(vs.priceOf('vehicle', 200)).toBe(200)
    mod(sim, 'vehiclePrice', { mult: 0.8, days: 1 })
    mod(sim, 'machinePrice', { mult: 1.25, days: 1 })
    expect(vs.priceOf('vehicle', 200)).toBe(160)
    expect(vs.priceOf('machine', 150)).toBe(188)
  })

  it('payroll().perDay is what payday debits: salaries × payrollMult + the subscriptions', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    const salaries = sim.state.employees
      .filter((e) => e.active)
      .reduce((s, e) => s + e.salaryPerDay, 0)
    expect(vs.payroll().perDay).toBe(salaries)
    mod(sim, 'payrollMult', { mult: 0.5, days: 1 })
    mod(sim, 'payrollAdd', { add: 15 })
    runTicks(sim, 1)
    expect(vs.payroll().perDay).toBe(payrollDuePerDay(sim))
    expect(vs.payroll().perDay).toBe(
      sim.state.employees
        .filter((e) => e.active)
        .reduce((s, e) => s + Math.round(e.salaryPerDay * 0.5), 0) + 15,
    )
  })

  it("a hub's clearance readout follows its clearanceS modifier (its own hub only)", () => {
    const sim = makeSim(1)
    unlockDistrict(sim, 'docks')
    const vs = createViewSim(sim)
    const def = (id: string) =>
      sim.data.districts.find((d) => d.id === id) as { clearanceS: number }
    expect(vs.hub('docks')!.clearanceS).toBe(def('docks').clearanceS)
    mod(sim, 'clearanceS', { mult: 0.5, scope: 'docks', days: 3 })
    runTicks(sim, 1)
    expect(vs.hub('docks')!.clearanceS).toBeCloseTo(
      def('docks').clearanceS * 0.5,
      10,
    )
    expect(vs.hub('airport')!.clearanceS).toBe(def('airport').clearanceS)
  })
})

describe('QuestsView.nextOfferInTicks (D-17, critique 19)', () => {
  it('null while the deck makes no draw; else max(jobReadyTick, nextDrawTick) − tick while a job can come', () => {
    const off = makeSim(1)
    expect(off.state.events.nextDrawTick).toBe(DECK_OFF_TICK)
    expect(createViewSim(off).quests().nextOfferInTicks).toBeNull()

    const sim = deckOn(makeSim(1))
    const vs = createViewSim(sim)
    const draw = sim.state.events.nextDrawTick
    expect(vs.quests().nextOfferInTicks).toBe(draw - sim.state.tick)
    // A cooldown past the next draw: the first draw at or after it.
    sim.state.quests.jobReadyTick = draw + 300
    runTicks(sim, 1)
    expect(vs.quests().nextOfferInTicks).toBe(draw + 300 - sim.state.tick)
    // An offer in the slot (its job card): nothing to wait for.
    sim.state.quests.jobReadyTick = 0
    offerQuest(sim, 'rush_district')
    expect(vs.quests().nextOfferInTicks).toBeNull()
  })
})
