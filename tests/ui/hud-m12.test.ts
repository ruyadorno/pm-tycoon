// Build 3 M12 HUD plumbing (B3 §3.3-§3.5, §6; plan-build3 §8.3; the M12
// contract §5 and its critique): the pure parts HudScene runs the EventCard
// through — when a pending card may open (hudKit.eventCardOpens: each input
// alone blocks; the Golden Release goes first only when it could open now,
// so a blocked gold offer never freezes the game — critique 3), the
// before / after cell diff of a decision (the pulsed top-bar cells with an
// unrounded mood — critique 14 —, wah / bell, the newspaper rule and its
// one-line headline: the chain head's title at a chain's end — critique 6 —,
// a news card's title and line, never `you chose: OK` — critique 7), the
// incident line of a life an option took and the pulse curve. Then the same
// rules on a real sim, the way HudScene reads it (state before and after
// ViewSim.event.decide): the grant, the rain, the strike and the gang chain to
// its last link, the job card the quest chip / district row / ?quest= raise
// (its objective line, Accept through decide), and the hold itself — a card
// the HUD has not answered keeps a policy-less sim still (the M11 interim
// auto-answer is gone: nothing decides for the player) and the decisions
// replay exactly. Every string drawn is in m5x7. Phaser is stubbed.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
  class Stub {
    readonly stub = true
  }
  return {
    default: {
      Scene: Stub,
      GameObjects: { Container: Stub, NineSlice: Stub, Image: Stub },
      Geom: { Rectangle: Stub },
    },
  }
})

const kit = await import('../../src/ui/hudKit.ts')
const qt = await import('../../src/ui/questText.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { replay, stateHash } = await import('../../src/sim/sim.ts')
const { DECK_OFF_TICK, JOB_ACCEPT } =
  await import('../../src/sim/systems/deck.ts')
const h = await import('../sim/helpers.ts')

type Gate = Parameters<typeof kit.eventCardOpens>[0]
type Snap = ReturnType<typeof kit.cellDiff>
type Sim = ReturnType<typeof h.makeSim>
type VS = ReturnType<typeof createViewSim>

const data = h.dataFixture()

const CLEAR: Gate = {
  policy: false,
  showing: false,
  gameOver: false,
  modals: 0,
  otherHolds: false,
  timers: false,
  paperVisible: false,
  levelMoment: false,
  questFirst: false,
}

const ZERO: Snap = {
  money: 0,
  lives: 0,
  mood: 0,
  earned: 0,
  vehicles: 0,
  workers: 0,
  scheduled: 0,
}

describe('B3 §3.4: when a pending card opens (hudKit.eventCardOpens)', () => {
  it('all clear: it opens', () => {
    expect(kit.eventCardOpens(CLEAR)).toBe(true)
  })

  it('each input alone keeps it waiting', () => {
    const blockers: Partial<Gate>[] = [
      { policy: true },
      { showing: true },
      { gameOver: true },
      { modals: 1 },
      { modals: 3 },
      { otherHolds: true },
      { timers: true },
      { paperVisible: true },
      { levelMoment: true },
      { questFirst: true },
    ]
    for (const b of blockers)
      expect(kit.eventCardOpens({ ...CLEAR, ...b }), JSON.stringify(b)).toBe(
        false,
      )
  })

  it('critique 3: a Golden Release offer blocked by an active job (or by the tour, or seen from the warehouse) is not "first" — the card opens', () => {
    const gold = {
      modals: 0,
      onboardingStep: null,
      view: 'city' as const,
      held: false,
      paperVisible: false,
      blocked: false,
      force: false,
      policy: false,
    }
    // The gold card could open now: it goes first.
    expect(kit.questCardAutoOpens(gold)).toBe(true)
    for (const why of [
      { blocked: true },
      { onboardingStep: 1 },
      { view: 'warehouse' as const },
      { paperVisible: true },
    ]) {
      const first = kit.questCardAutoOpens({ ...gold, ...why })
      expect(first, JSON.stringify(why)).toBe(false)
      expect(kit.eventCardOpens({ ...CLEAR, questFirst: first })).toBe(true)
    }
    // A forced offer (a reload, ?quest=golden_release) ignores the tour.
    expect(
      kit.questCardAutoOpens({ ...gold, onboardingStep: 1, force: true }),
    ).toBe(true)
  })
})

describe('B3 §3.4: the decision diff (pulse, sound, paper)', () => {
  it('cellDiff is after − before, field by field', () => {
    const a = {
      money: 500,
      lives: 3,
      mood: 61.4,
      earned: 900,
      vehicles: 2,
      workers: 3,
      scheduled: 0,
    }
    const b = { ...a, money: 350, lives: 2, mood: 61.8, scheduled: 1 }
    const d = kit.cellDiff(a, b)
    expect(d).toMatchObject({
      money: -150,
      lives: -1,
      earned: 0,
      vehicles: 0,
      workers: 0,
      scheduled: 1,
    })
    expect(d.mood).toBeCloseTo(0.4)
  })

  it('the grant (+$150): the money cell pulses, the bell rings, a paper runs', () => {
    const d = { ...ZERO, money: 150 }
    expect(kit.pulsedCells(d)).toEqual(['money'])
    expect(kit.decisionSfx(d)).toBe('bell')
    expect(kit.eventNewsworthy(d, false)).toBe(true)
  })

  it('the rain (a modifier only): nothing pulses, no sound, no paper', () => {
    expect(kit.pulsedCells(ZERO)).toEqual([])
    expect(kit.decisionSfx(ZERO)).toBeNull()
    expect(kit.eventNewsworthy(ZERO, false)).toBe(false)
  })

  it('the strike (a life): the lives cell, the wah, a paper', () => {
    const d = { ...ZERO, lives: -1 }
    expect(kit.pulsedCells(d)).toEqual(['lives'])
    expect(kit.decisionSfx(d)).toBe('wah')
    expect(kit.eventNewsworthy(d, false)).toBe(true)
  })

  it('a vehicle or a worker lost is a wah (over any money gain); a life gained rings', () => {
    expect(kit.decisionSfx({ ...ZERO, vehicles: -1, money: 400 })).toBe('wah')
    expect(kit.decisionSfx({ ...ZERO, workers: -1 })).toBe('wah')
    expect(kit.decisionSfx({ ...ZERO, lives: 1 })).toBe('bell')
    expect(kit.decisionSfx({ ...ZERO, money: 99 })).toBeNull()
    expect(kit.decisionSfx({ ...ZERO, money: -500 })).toBeNull()
    expect(kit.eventNewsworthy({ ...ZERO, vehicles: 1 }, false)).toBe(true)
    expect(kit.eventNewsworthy({ ...ZERO, workers: 1 }, false)).toBe(true)
    expect(kit.eventNewsworthy({ ...ZERO, money: -100 }, false)).toBe(true)
    expect(kit.eventNewsworthy({ ...ZERO, money: 99 }, false)).toBe(false)
  })

  it('critique 14: the mood cell pulses on an unrounded change (+0.4 on the mean moves no rounded value)', () => {
    expect(kit.pulsedCells({ ...ZERO, mood: 0.4 })).toEqual(['mood'])
    expect(kit.pulsedCells({ ...ZERO, mood: -0.2, earned: 10 })).toEqual([
      'mood',
      'level',
    ])
    expect(kit.pulsedCells({ ...ZERO, mood: 1e-12 })).toEqual([])
  })

  it('a chain ends on a link (depth ≥ 2) whose option booked no next link; a head never ends one', () => {
    expect(kit.eventChainEnded(2, ZERO)).toBe(true)
    expect(kit.eventChainEnded(4, ZERO)).toBe(true)
    expect(kit.eventChainEnded(2, { ...ZERO, scheduled: 1 })).toBe(false)
    expect(kit.eventChainEnded(1, ZERO)).toBe(false)
    expect(kit.eventNewsworthy(ZERO, true)).toBe(true)
  })

  it('the headline: the chain head at a chain end (critique 6), a news card its title and line (critique 7), else the choice', () => {
    const card = {
      title: 'On the doorstep',
      option: 'Yes',
      kind: 'decision' as const,
      chainTitle: 'Protection',
    }
    expect(kit.eventNewsHeadline(data, card, true)).toBe(
      'Protection — the story ends',
    )
    expect(
      kit.eventNewsHeadline(data, { ...card, chainTitle: null }, true),
    ).toBe('On the doorstep — the story ends')
    expect(
      kit.eventNewsHeadline(
        data,
        {
          title: 'The recall',
          option: 'Take the strike',
          kind: 'decision',
          chainTitle: null,
        },
        false,
      ),
    ).toBe('The recall — you chose: Take the strike')
    const news = {
      title: 'The loaner',
      option: 'OK',
      kind: 'news' as const,
      chainTitle: null,
    }
    expect(
      kit.eventNewsHeadline(data, { ...news, firstLine: '+1 bike' }, false),
    ).toBe('The loaner — +1 bike')
    expect(kit.eventNewsHeadline(data, news, false)).toBe('The loaner')
    expect(kit.eventNewsHeadline(data, news, false)).not.toContain('OK')
  })

  it('the incident line of a life an option took (the Ticker wording)', () => {
    expect(kit.eventIncidentLine('The recall', 2)).toBe(
      'The recall cost a life — 2 lives left',
    )
    expect(kit.eventIncidentLine('The recall', 1)).toBe(
      'The recall cost a life — 1 life left',
    )
    expect(kit.eventIncidentLine('The recall', 0)).toBe(
      'The recall cost a life — no lives left',
    )
    expect(kit.eventIncidentLine('X', Number.NaN)).toBe(
      'X cost a life — no lives left',
    )
  })

  it('the pulse: 240 ms, 1 → 0.3 at the middle → 1', () => {
    expect(2 * kit.EVENT_PULSE_MS).toBe(240)
    expect(kit.eventPulseAlpha(0)).toBe(1)
    expect(kit.eventPulseAlpha(0.5)).toBeCloseTo(kit.EVENT_PULSE_MIN_ALPHA)
    expect(kit.eventPulseAlpha(1)).toBeCloseTo(1)
    expect(kit.eventPulseAlpha(0.25)).toBeCloseTo(0.65)
    expect(kit.eventPulseAlpha(2)).toBeCloseTo(1)
    expect(kit.eventPulseAlpha(-1)).toBe(1)
  })

  it('D-M12-9: the $100 thresholds are UI constants', () => {
    expect(kit.EVENT_BELL_MIN_MONEY).toBe(100)
    expect(kit.EVENT_NEWS_MIN_MONEY).toBe(100)
  })
})

// ---- on a real sim, the way HudScene reads it ----------------------------------

/** HudScene.cellSnapshot (state reads: no tick runs between before and after). */
function snap(sim: Sim, vs: VS): Snap {
  const s = sim.state
  return {
    money: vs.money,
    lives: vs.lives,
    mood: vs.meanSatisfaction(),
    earned: vs.lifetimeEarned,
    vehicles: s.vehicles.length,
    workers: s.employees.length,
    scheduled: s.events.scheduled.length,
  }
}

/** HudScene.onEventOption's success path, minus the drawing. */
function decide(sim: Sim, vs: VS, label: string) {
  const view = vs.events().open
  if (!view) throw new Error('no open card')
  const opt = view.options.find((o) => o.label === label)
  if (!opt) throw new Error(`${view.eventId}: no option ${label}`)
  const before = snap(sim, vs)
  const r = vs.event.decide(view.eventId, opt.index)
  expect(r, `${view.eventId} ${label}`).toEqual({ ok: true })
  const d = kit.cellDiff(before, snap(sim, vs))
  const depth = vs.events().history.at(-1)?.depth ?? 1
  const chainEnd = view.kind !== 'job' && kit.eventChainEnded(depth, d)
  const paper =
    view.kind !== 'job' && kit.eventNewsworthy(d, chainEnd)
      ? kit.eventNewsHeadline(
          data,
          {
            title: view.title,
            option: opt.label,
            kind: view.kind,
            chainTitle: view.chainTitle,
            firstLine: opt.lines.find((l) => l.text.trim() !== '')?.text,
          },
          chainEnd,
        )
      : null
  return {
    view,
    d,
    cells: kit.pulsedCells(d),
    sfx: kit.decisionSfx(d),
    chainEnd,
    paper,
  }
}

/** A quiet game (no spawns, no draws) at `level` with money, and the debug facet. */
function game(seed: number, level = 2, money = 5000) {
  const sim = h.quietSim(seed)
  sim.state.level.level = level
  sim.state.economy.balance = money
  return { sim, vs: createViewSim(sim, { debug: true }) }
}

/** Tick until `id` is the open card (any other card is answered with its default). */
function tickUntilOpen(sim: Sim, id: string, cap = 4000): void {
  for (let i = 0; i < cap; i++) {
    const o = sim.state.events.open
    if (o?.eventId === id) return
    if (o) h.answerCards(sim, 'default')
    sim.tick()
  }
  throw new Error(`${id} never opened`)
}

describe('on a real sim: the decisions as the HUD presents them', () => {
  it('the grant: +$150, the money cell, the bell, a paper `Small-business grant — you chose: Apply`', () => {
    const { sim, vs } = game(1)
    expect(vs.debug!.offerEvent('ev_money_grant').ok).toBe(true)
    const r = decide(sim, vs, 'Apply')
    expect(r.d.money).toBe(150)
    expect(r.cells).toContain('money')
    expect(r.sfx).toBe('bell')
    expect(r.paper).toBe('Small-business grant — you chose: Apply')
  })

  it('the rain (a news card, a modifier only): nothing pulses, no sound, no paper; the chip counts the modifier', () => {
    const { sim, vs } = game(2)
    expect(vs.debug!.offerEvent('ev_wx_rain').ok).toBe(true)
    expect(vs.events().open?.kind).toBe('news')
    const r = decide(sim, vs, 'OK')
    expect(r.cells).toEqual([])
    expect(r.sfx).toBeNull()
    expect(r.paper).toBeNull()
    expect(vs.events().modifiers).toHaveLength(1)
  })

  it('the strike: a life, the lives cell, the wah, `The recall — you chose: Take the strike`', () => {
    const { sim, vs } = game(3)
    const lost = h.collect(sim, 'life:lost')
    expect(vs.debug!.offerEvent('ev_sec_recall').ok).toBe(true)
    const strike = vs.events().open!.options.find((o) => o.danger)!
    expect(strike.label).toBe('Take the strike')
    const r = decide(sim, vs, strike.label)
    expect(r.d.lives).toBe(-1)
    expect(r.cells).toEqual(['lives'])
    expect(r.sfx).toBe('wah')
    expect(r.paper).toBe('The recall — you chose: Take the strike')
    // The payload HudScene routes to the lost-life card's event variant.
    expect(lost).toHaveLength(1)
    const p = lost[0]!
    expect(p.cause).toBe('event')
    if (p.cause === 'event') {
      expect(p.title).toBe('The recall')
      expect(p.option).toBe('Take the strike')
      expect(kit.eventIncidentLine(p.title, p.report.livesLeft)).toBe(
        'The recall cost a life — 2 lives left',
      )
    }
  })

  it('the gang chain: Deny books the next link (no paper); the link names its head; the last link ends it — `Protection — the story ends`', () => {
    const { sim, vs } = game(4)
    expect(vs.debug!.offerEvent('ev_crime_gang').ok).toBe(true)
    const head = decide(sim, vs, 'Deny')
    expect(head.d.scheduled).toBe(1)
    expect(head.chainEnd).toBe(false)
    expect(head.paper).toBeNull()

    tickUntilOpen(sim, 'ev_crime_gang_watch')
    const watch = vs.events().open!
    expect(watch.chainTitle).toBe('Protection')
    expect(watch.parentChoice).toBe('You chose: Deny')
    const w = decide(sim, vs, 'Yes')
    expect(w.chainEnd).toBe(false)
    expect(w.paper).toBeNull()

    tickUntilOpen(sim, 'ev_crime_gang_return')
    const back = decide(sim, vs, 'Call the police')
    expect(back.chainEnd).toBe(false)
    expect(back.d.mood).toBeLessThan(0)
    expect(back.cells).toContain('mood')

    tickUntilOpen(sim, 'ev_crime_gang_bust')
    const bust = decide(sim, vs, 'OK')
    expect(bust.view.kind).toBe('news')
    expect(bust.chainEnd).toBe(true)
    expect(bust.paper).toBe('Protection — the story ends')
    expect(bust.sfx).toBe('bell')
    expect(bust.cells).toEqual(
      expect.arrayContaining(['money', 'lives', 'mood']),
    )
  })

  it('a job card (?quest=, the quest chip, the district row): its objective line from the offer it holds, Accept through decide', () => {
    const { sim, vs } = game(5, 1, 500)
    expect(vs.debug!.offerQuest('rush_district').ok).toBe(true)
    // The job card holds the sim like any card.
    expect(sim.held).toBe(true)
    const open = vs.events().open!
    expect(open.kind).toBe('job')
    const offer = vs.quests().offer!
    // HudScene.isJobOffer: a regular offer lives on its job card.
    expect(offer.status === 'offered' && !offer.ultimate).toBe(true)
    expect(offer.id).toBe(open.questId)
    const objective = qt.objectiveText(data, offer, qt.buildingNamer(data))
    expect(objective.length).toBeGreaterThan(0)
    expect(open.options.map((o) => o.index)).toContain(JOB_ACCEPT)
    const r = vs.event.decide(open.eventId, JOB_ACCEPT)
    expect(r.ok).toBe(true)
    expect(vs.events().open).toBeNull()
    expect(sim.held).toBe(false)
    expect(vs.quests().active?.templateId).toBe('rush_district')
  })

  it('the hold: nothing answers for the player (no interim auto-answer) — a policy-less sim stays still until decide; the decisions replay exactly', () => {
    const { sim, vs } = game(6)
    expect(vs.debug!.offerEvent('ev_staff_training').ok).toBe(true)
    expect(sim.held).toBe(true)
    expect(vs.held).toBe(true)
    const at = sim.state.tick
    for (let i = 0; i < 200; i++) sim.tick()
    expect(sim.state.tick).toBe(at)
    expect(vs.events().open?.eventId).toBe('ev_staff_training')
    decide(sim, vs, 'Skip')
    expect(sim.held).toBe(false)
    h.runTicks(sim, 300)
    expect(sim.state.tick).toBe(at + 300)
    expect(
      sim.commandLog.some(
        (e) =>
          e.cmd.kind === 'decideEvent' && e.cmd.eventId === 'ev_staff_training',
      ),
    ).toBe(true)
    // The same tick-0 setup (quiet, level, balance, deck off), then the log.
    const again = replay(
      data,
      sim.state.seed,
      sim.commandLog,
      sim.state.tick,
      (r) => {
        h.quiet(r)
        r.state.level.level = 2
        r.state.economy.balance = 5000
        r.state.events.nextDrawTick =
          sim.state.events.nextDrawTick >= DECK_OFF_TICK
            ? DECK_OFF_TICK
            : r.state.events.nextDrawTick
      },
    )
    expect(again.state.tick).toBe(sim.state.tick)
    expect(stateHash(again.state)).toBe(stateHash(sim.state))
  })
})

describe('m5x7: every M12 HUD string is drawn in glyphs the font has', () => {
  const xml = readFileSync(
    new URL('../../src/assets/m5x7.xml', import.meta.url),
    'utf8',
  )
  const glyphs = new Set(
    [...xml.matchAll(/<char id="(\d+)"/g)].map((m) => Number(m[1])),
  )
  const missing = (s: string): string[] =>
    [...s].filter((ch) => ch !== '\n' && !glyphs.has(ch.codePointAt(0)!))

  it('the incident lines, the headlines and the chain-end line', () => {
    const strings = [
      kit.eventIncidentLine('The recall', 2),
      kit.eventIncidentLine('The recall', 1),
      kit.eventIncidentLine('The recall', 0),
      kit.eventNewsHeadline(
        data,
        {
          title: 'Protection',
          option: 'Deny',
          kind: 'decision',
          chainTitle: 'Protection',
        },
        true,
      ),
      kit.eventNewsHeadline(
        data,
        {
          title: 'The recall',
          option: 'Take the strike',
          kind: 'decision',
          chainTitle: null,
        },
        false,
      ),
      kit.eventNewsHeadline(
        data,
        {
          title: 'The loaner',
          option: 'OK',
          kind: 'news',
          chainTitle: null,
          firstLine: '+1 bike',
        },
        false,
      ),
    ]
    for (const s of strings) expect(missing(s), s).toEqual([])
  })

  it('every deck card title and option label the paper and the incident line can carry', () => {
    for (const c of data.events.deck) {
      expect(missing(c.title), c.id).toEqual([])
      for (const o of c.options ?? [])
        expect(missing(o.label), `${c.id} ${o.label}`).toEqual([])
    }
  })
})
