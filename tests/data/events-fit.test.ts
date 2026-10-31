// The real copy fit (B3 §3.4, plan-build3 §8.3 acceptance, M12 contract
// §1.5 + D-M12-7, critique 9-10): every non-router deck card and every job
// card goes through the EventCard's own layout (src/ui/effectText.ts
// layoutEventCard) with the sim's real lines (deck.ts cardOptions /
// optionLines, the ViewSim's OpenCardView) and the m5x7 advance widths, and
// must fit: h ≤ 340, the title in 1 line, the body in ≤ 4, a link's
// `You chose: …` in ≤ 2, a job's objective in ≤ 2, every effects line in ≤ 2
// rows of the 276-px inner width and every button label inside its face
// (labels never wrap: inner − 2·CONTENT_PAD). The card rect then sits 8 px
// above the bottom bar at 360 × 604 and 393 × 659 (never pushed by the
// ticker), and every string drawn is in m5x7 glyphs (the width tables
// default a missing glyph to 6 px, so only this catches one).
//
// The states (worst cases for the state-aware lines, effects.ts summary):
//   S1 the start crew (one inspector, no vehicle): `−$250 (no bike to lose)`,
//      `$0 (no vehicles)`, `(no vehicle to park)`;
//   S2 one life, one bike with its driver, the one inspector: `— this can
//      end the run`, `— your last vehicle`, `— the desk is empty`;
//   S3 the long suffixes S1 and S2 never reach: lives at the cap (`+1 life
//      (already 5)`), the wanted list complete (`(none left)`), the shelf
//      empty (`(shelf empty)`), the shelf cap at shelfCapMax (`(already
//      /140)`), every pip at its max (`(already 5)`), one free spot per
//      district (`(room for 1)`) and a pick whose person has left (`(X has
//      left)`).
// Every state has every spawning district live (target names are shown),
// the longest people name on every worker and `Truck 12` on every vehicle;
// a card with a target (or a link of one) is laid out for every spawning
// district, a link with the longest parent label as its `You chose: …`.
// Jobs run at level 5 (the level-scaled rewards at their top: rush_district
// $500) for every spawning district as the target (a magic-parcel offer has
// no route yet: its objective reads `across town`). The guard (critique
// 10d): at balance 0 every card in every state keeps at least one visible,
// affordable option — else a held sim would have no way out through the UI.
//
// The plan's acceptance command `vlr test -- tests/data/events` matches this
// file and tests/data/events.test.ts (Vitest filters by substring).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type {
  CardPickRole,
  DistrictId,
  EventDef,
  EventEffect,
  EventOptionDef,
} from '../../src/data/types.ts'
import type { Sim } from '../../src/sim/sim.ts'
import {
  cardOptions,
  eventDef,
  fillCardText,
} from '../../src/sim/systems/deck.ts'
import type { OpenCard } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  EVENT_CANT_AFFORD,
  EVENT_CARD_GAP,
  EVENT_CARD_MAX_H,
  EVENT_ENTER_DENY,
  EVENT_PAUSED_TEXT,
  type EventCardInput,
  type EventCardLayout,
  eventCardMisfits,
  eventCardRect,
  layoutEventCard,
} from '../../src/ui/effectText.ts'
import { computeLayout } from '../../src/ui/layout.ts'
import { buildingNamer, objectiveText } from '../../src/ui/questText.ts'
import {
  buy,
  dataFixture,
  injectParcel,
  makeSim,
  unlockDistrict,
} from '../sim/helpers.ts'

const data = dataFixture()
const deck: readonly EventDef[] = data.events.deck
const cards = deck.filter((c) => !c.router)

// ---- m5x7 metrics ---------------------------------------------------------------

const xml = readFileSync(
  new URL('../../src/assets/m5x7.xml', import.meta.url),
  'utf8',
)
const adv = new Map<number, number>()
for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
  adv.set(Number(m[1]), Number(m[2]))
const width = (s: string): number =>
  [...s].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 6), 0)
const missingGlyphs = (s: string): string[] =>
  [...new Set(s)].filter((ch) => ch !== '\n' && !adv.has(ch.codePointAt(0)!))

// ---- worst-case names -------------------------------------------------------------

const longestBy = (xs: readonly string[]): string =>
  xs.reduce((a, b) => (width(b) > width(a) ? b : a), '')
const LONG_PERSON = longestBy(data.puns.peopleNames)
const LONG_VEHICLE = 'Truck 12'
const SPAWNING: readonly DistrictId[] = data.districts
  .filter((d) => d.kind === 'district')
  .map((d) => d.id)
const LEFT_ID = 99_999

// ---- the deck graph: links, their parents, inherited targets and picks ------------

const byId = new Map(deck.map((d) => [d.id, d] as const))

/** The cards a `next` to `id` can open (a router expands to its branches). */
function reach(id: string, seen = new Set<string>()): string[] {
  if (seen.has(id)) return []
  seen.add(id)
  const d = byId.get(id)
  if (d?.router && d.next)
    return d.next.branches.flatMap((b) => reach(b.id, seen))
  return [id]
}

function optionReach(o: EventOptionDef): string[] {
  const out: string[] = []
  for (const e of o.effects) {
    if (e.kind !== 'next') continue
    if ('eventId' in e) out.push(...reach(e.eventId))
    else out.push(...e.branches.flatMap((b) => reach(b.id)))
  }
  return out
}

/** Card id → the deck options (with their card) whose next reaches it. */
const parents = new Map<string, { def: EventDef; label: string }[]>()
for (const def of deck)
  for (const o of def.options ?? [])
    for (const id of optionReach(o)) {
      const list = parents.get(id) ?? []
      list.push({ def, label: o.label })
      parents.set(id, list)
    }

/** The role a card's `one` effects name (pips, quit, absent). */
function effectPickRole(def: EventDef): CardPickRole | null {
  for (const o of def.options ?? [])
    for (const e of o.effects as readonly EventEffect[]) {
      if (e.kind === 'pips' && e.scope === 'one') return e.role
      if (e.kind === 'staff' && 'quit' in e && e.pick === 'one') return e.quit
      if (e.kind === 'staff' && 'absent' in e && e.pick === 'one')
        return e.absent === 'vehicles' ? 'vehicle' : e.absent
    }
  return null
}

/** The card's pick role: its own, else its effects', else its parent's (links inherit). */
function pickRoleOf(id: string, seen = new Set<string>()): CardPickRole | null {
  if (seen.has(id)) return null
  seen.add(id)
  const def = byId.get(id)
  if (!def) return null
  const own = def.pick ?? effectPickRole(def)
  if (own !== null) return own
  for (const p of parents.get(id) ?? []) {
    const r = pickRoleOf(p.def.id, seen)
    if (r !== null) return r
  }
  return null
}

/** The card has a target: its own rule, or a head up its chain has one. */
function hasTarget(id: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false
  seen.add(id)
  const def = byId.get(id)
  if (!def) return false
  if (def.target !== undefined) return true
  return (parents.get(id) ?? []).some((p) => hasTarget(p.def.id, seen))
}

// ---- the states -------------------------------------------------------------------

type StateName = 'S1' | 'S2' | 'S3'
const STATES: readonly StateName[] = ['S1', 'S2', 'S3']

function stateSim(name: StateName, balance = 99_999): Sim {
  const sim = makeSim(1)
  const s = sim.state
  for (const id of SPAWNING) unlockDistrict(sim, id)
  if (name === 'S2') {
    buy(sim, 'bike')
    s.economy.lives = 1
  }
  if (name === 'S3') {
    buy(sim, 'bike')
    buy(sim, 'van')
    s.economy.lives = sim.data.economy.lives.cap
    s.wanted = [...new Set(Object.values(sim.data.puns.malwareLabels).flat())]
    s.level.shelfCap = sim.data.events.modifiers.shelfCapMax
    for (const e of s.employees)
      for (const k of Object.keys(e.pips) as (keyof typeof e.pips)[])
        e.pips[k] = k === 'charisma' ? 2 : 5
    // One free spot per district: every sender full but the first.
    const max = sim.data.parcels.spawn.maxWaitingPerBuilding
    for (const id of SPAWNING) {
      const senders = sim.data.buildings.filter(
        (b) => b.district === id && b.send > 0,
      )
      const dest = sim.data.buildings.find(
        (b) => b.district !== id && SPAWNING.includes(b.district),
      )!
      senders.forEach((b, i) => {
        const w = s.buildings[b.id]!.waiting
        while (w.length < max - (i === 0 ? 1 : 0))
          injectParcel(sim, b.id, dest.id)
      })
    }
  }
  for (const e of s.employees) e.name = LONG_PERSON
  for (const v of s.vehicles) v.name = LONG_VEHICLE
  s.economy.balance = balance
  return sim
}

/** The `one` pick of `role` in this state (S3: someone who has left). */
function pickFor(
  sim: Sim,
  name: StateName,
  role: CardPickRole,
): OpenCard['pick'] {
  const longName = role === 'vehicle' ? LONG_VEHICLE : LONG_PERSON
  if (name === 'S3') return { role, id: LEFT_ID, name: longName }
  const s = sim.state
  const id =
    role === 'vehicle'
      ? (s.vehicles[0]?.id ?? 1)
      : (s.employees.find((e) => e.role === role)?.id ?? 1)
  return { role, id, name: longName }
}

/** The longest parent label (filled with the card's refs), or null for a head / single. */
function parentChoiceOf(
  def: EventDef,
  refs: Pick<OpenCard, 'target' | 'pick'>,
): string | null {
  const ps = parents.get(def.id) ?? []
  if (ps.length === 0) return null
  return longestBy(ps.map((p) => fillCardText(data, p.label, refs)))
}

function cardOf(
  def: EventDef,
  refs: Pick<OpenCard, 'target' | 'pick'>,
  parentChoice: string | null,
): OpenCard {
  const link = (parents.get(def.id) ?? []).length > 0
  return {
    eventId: def.id,
    kind: (def.options?.length ?? 0) === 1 ? 'news' : 'decision',
    category: def.category,
    questId: null,
    target: refs.target,
    pick: refs.pick,
    openedTick: 0,
    parentChoice,
    chainHeadId: def.id,
    depth: link ? 2 : 1,
    drawn: false,
    gapTicks: null,
  }
}

/** The ViewSim's OpenCardView of `card` on `sim` (the production path). */
function viewOf(sim: Sim, card: OpenCard): EventCardInput {
  sim.state.events.open = card
  const v = createViewSim(sim).events().open
  sim.state.events.open = null
  if (v === null) throw new Error(`${card.eventId}: no open card view`)
  return v
}

/** Every string the card draws. */
function drawnStrings(m: EventCardLayout): string[] {
  return [
    m.masthead,
    m.day,
    ...m.flow.map((f) => f.text),
    ...m.options.flatMap((o) => [o.label, ...o.rows.map((r) => r.text)]),
  ]
}

interface Case {
  where: string
  view: EventCardInput
}

/** Every layout of a deck card: per state, per target district. */
function deckCases(def: EventDef): Case[] {
  const out: Case[] = []
  const role = pickRoleOf(def.id)
  const targets: (DistrictId | null)[] = hasTarget(def.id)
    ? [...SPAWNING]
    : [null]
  for (const name of STATES) {
    const sim = stateSim(name)
    const pick = role === null ? null : pickFor(sim, name, role)
    for (const target of targets) {
      const refs = { target, pick }
      const card = cardOf(def, refs, parentChoiceOf(def, refs))
      out.push({
        where: `${def.id} ${name}${target ? ` @${target}` : ''}`,
        view: viewOf(sim, card),
      })
    }
  }
  return out
}

/** A level-5 sim (every district live, the long names) with `templateId`'s job card open. */
function jobSim(templateId: string): Sim | null {
  const sim = stateSim('S1')
  sim.dispatch({ kind: 'debugForceLevel', level: 5 })
  for (const id of SPAWNING) unlockDistrict(sim, id)
  sim.state.economy.balance = 99_999
  const r = sim.dispatch({ kind: 'debugOfferQuest', templateId })
  if (!r.ok || sim.state.events.open?.kind !== 'job') return null
  return sim
}

const namer = buildingNamer(data)

/** Every layout of a job card: each spawning district as its target (a targeted template). */
function jobCases(templateId: string): Case[] {
  const sim = jobSim(templateId)
  if (sim === null) return []
  const s = sim.state
  const offer = s.quests.offer!
  const open = s.events.open!
  const targets: (DistrictId | null)[] =
    offer.target === null ? [null] : [...SPAWNING]
  return targets.map((target) => {
    offer.target = target
    open.target = target
    const vs = createViewSim(sim)
    const view = vs.events().open!
    const q = vs.quests().offer!
    return {
      where: `job:${templateId}${target ? ` @${target}` : ''}`,
      view: { ...view, objective: objectiveText(data, q, namer) },
    }
  })
}

/** The fit problems of one case ([] = fits). */
function misfits(c: Case): string[] {
  const m = layoutEventCard(c.view, width)
  const out = eventCardMisfits(m).map((p) => `${c.where}: ${p}`)
  for (const [W, H] of [
    [360, 604],
    [393, 659],
  ] as const) {
    const L = computeLayout(W, H, 0, 0, 1)
    const r = eventCardRect(L, m.h)
    if (
      r.y < L.ticker.y + L.ticker.h ||
      r.y + r.h !== L.bottomBar.y - EVENT_CARD_GAP
    )
      out.push(`${c.where}: rect at ${W}×${H} (y ${r.y}, h ${r.h})`)
  }
  const miss = [...new Set(drawnStrings(m).flatMap(missingGlyphs))]
  if (miss.length > 0) out.push(`${c.where}: glyphs ${miss.join(' ')}`)
  return out
}

describe('B3 §3.4 copy fit: every deck card on the EventCard (S1, S2, S3; every target)', () => {
  it('the deck has cards to fit', () => {
    expect(cards.length).toBeGreaterThan(0)
  })

  it.each(cards.map((c) => [c.id, c] as const))('%s fits', (_id, def) => {
    const cases = deckCases(def)
    expect(cases.length).toBeGreaterThan(0)
    expect(cases.flatMap(misfits)).toEqual([])
  })
})

describe('B3 §3.2 copy fit: every job card at level 5 (every target district)', () => {
  it.each(data.quests.templates.map((t) => [t.id] as const))(
    'job:%s fits',
    (id) => {
      const cases = jobCases(id)
      expect(cases.length, `${id}: no job card opened`).toBeGreaterThan(0)
      for (const c of cases) {
        expect(c.view.kind).toBe('job')
        expect(c.view.options.map((o) => o.label)).toEqual([
          'Accept',
          'Decline',
        ])
      }
      expect(cases.flatMap(misfits)).toEqual([])
    },
  )

  it('the level-scaled reward is at its top: Rush hour pays $500 at level 5', () => {
    const c = jobCases('rush_district')[0]!
    const accept = c.view.options[0]!.lines.map((l) => l.text).join(' ')
    expect(accept).toContain('$500')
  })
})

describe('critique 10d: a held card always has a way out (balance 0)', () => {
  it('every deck card keeps a visible, affordable option in every state at $0', () => {
    const bad: string[] = []
    for (const def of cards) {
      const role = pickRoleOf(def.id)
      for (const name of STATES) {
        const sim = stateSim(name, 0)
        const pick = role === null ? null : pickFor(sim, name, role)
        const target = hasTarget(def.id) ? (SPAWNING[0] ?? null) : null
        const card = cardOf(def, { target, pick }, null)
        const open = cardOptions(sim, card).filter(
          (o) => o.visible && o.affordable,
        )
        if (open.length === 0) bad.push(`${def.id} ${name}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('a job card is always free to answer', () => {
    for (const t of data.quests.templates) {
      const sim = jobSim(t.id)
      if (sim === null) continue
      sim.state.economy.balance = 0
      const v = createViewSim(sim).events().open!
      expect(v.options.every((o) => o.affordable)).toBe(true)
    }
  })
})

/** Every generated effects line of every deck card in one state. */
function stateTexts(name: StateName): string {
  const all: string[] = []
  for (const def of cards)
    for (const c of deckCases(def))
      if (c.where.includes(` ${name}`))
        for (const o of c.view.options) all.push(...o.lines.map((l) => l.text))
  return all.join('\n')
}

/** Some deck option carries an effect matching `pred`. */
const deckHas = (pred: (e: EventEffect) => boolean): boolean =>
  cards.some((d) => (d.options ?? []).some((o) => o.effects.some(pred)))

describe('the copy-fit harness itself', () => {
  it('S2 and S3 reach the long suffixes (the states do what they claim)', () => {
    const s2 = stateTexts('S2')
    const s3 = stateTexts('S3')
    if (deckHas((e) => e.kind === 'lives' && e.delta < 0))
      expect(s2).toContain('this can end the run')
    if (deckHas((e) => e.kind === 'lives' && e.delta > 0))
      expect(s3).toMatch(/\(already \d\)/)
    if (deckHas((e) => e.kind === 'wanted')) expect(s3).toContain('(none left)')
    if (deckHas((e) => e.kind === 'cap'))
      expect(s3).toContain(`(already /${data.events.modifiers.shelfCapMax})`)
    if (
      deckHas((e) => e.kind === 'parcels' && 'spawn' in e && e.spawn.count > 1)
    )
      expect(s3).toContain('(room for 1)')
    if (deckHas((e) => e.kind === 'pips' && e.scope === 'one'))
      expect(s3).toContain(`(${LONG_PERSON} has left)`)
  })

  it('a link gets the longest parent label as its You chose line; a head none', () => {
    const link = cards.find((c) => (parents.get(c.id) ?? []).length > 0)
    const head = cards.find((c) => (parents.get(c.id) ?? []).length === 0)
    if (link) {
      const v = deckCases(link)[0]!.view
      expect(v.parentChoice).toMatch(/^You chose: /)
    }
    if (head) expect(deckCases(head)[0]!.view.parentChoice).toBeNull()
  })

  it('every constant string the card draws is in m5x7 (PAUSED, Tap an option, the greyed row)', () => {
    for (const s of [
      EVENT_PAUSED_TEXT,
      EVENT_ENTER_DENY,
      EVENT_CANT_AFFORD,
      data.puns.eventWords.cantAfford,
      ...Object.values(data.events.categories).map((c) => c.word),
    ])
      expect(missingGlyphs(s), s).toEqual([])
  })

  it('the limit the test applies is B3 §3.4: 340 px', () => {
    expect(EVENT_CARD_MAX_H).toBe(340)
    expect(eventDef(data, cards[0]!.id)).not.toBeNull()
  })
})
