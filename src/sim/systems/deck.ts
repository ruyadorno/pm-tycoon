// The event deck (spec-build3 §3, §6; M11 contract §1, §2.8, §3 stream B):
// the deck tick step (step 10b, between levels and quests), the random draw
// (job cards folded into it, D-1 blanks), chains and routers, the rescue,
// the open card and its options, decide / debug commands.
//
// Streams (D-2): `state.events.rng` (Sim.eventRng) is the CADENCE stream —
// the job roll and the gap, always drawn in that order; `state.events.picks`
// (Sim.eventPicksRng) is the CONTENT stream — decision picks, random
// targets, `one` picks and every draw an effect makes. Job templates stay on
// the quest stream. Never state.rng.
//
// The step (B3 §3.2, contract §3B + critique 15/16/17/30): modifier expiry,
// absences, the wrong-toss day baseline; then (not game over) the rescue
// bookkeeping every tick; then, only while no card is open: the queue
// (debug cards, promoted first, D-15), the quiet rules (the first
// firstEventS, a payday tick, afterLevelUpS after a level-up, afterLevelUpS
// after the Golden Release became acceptable), due chain links (earliest due, then
// booking order; routers and conditional nexts resolved NOW, the resolved
// card's minLevel and cond re-checked — a failing link is dropped), then —
// with the deck on (nextDrawTick < DECK_OFF_TICK) — the rescue card
// (rescueDelayS after fleet = 0 ∧ balance < the cheapest vehicle), then the
// random draw when nextDrawTick is due: the job roll (jobShare, only while
// a job is eligible), the gap from the level's band (always drawn), then a
// job card (template on the quest stream), a decision card (SIM_FEATURES
// .events, picks stream) or a blank (D-1: no card, nextDrawTick = tick +
// gap). A drawn card restarts the timer when it closes (closeTick + gap);
// links, the rescue and debug cards never touch it (linkRestartsTimer
// false, D-39).
//
// Effects: deck.ts applies the option cost and the deck-internal kinds
// (`next`, `flag`, `job`, `jobDecline`); effects.ts applyEffect every world
// kind, in data order. The generated option lines (optionLines) are the cost
// line, effects.ts effectSummary's world lines, then the `then:` lines.

import type {
  CardPickRole,
  EventCond,
  EventDef,
  EventEffect,
  GameData,
  NextBranchDef,
  VehicleTypeDef,
} from '../../data/types.ts'
import type { CommandResult, FailReason } from '../commands.ts'
import { announcedStrains, laneCatchRate } from '../detection.ts'
import { SIM_FEATURES } from '../features.ts'
import { mapIndex } from '../map.ts'
import { priceOf } from '../modifiers.ts'
import { seedWord } from '../rng.ts'
import type { Sim } from '../sim.ts'
import type {
  CardPick,
  CardRefs,
  DistrictId,
  EventRecord,
  EventsState,
  OpenCard,
  ScheduledLink,
} from '../types.ts'
import {
  daysToTicks,
  isAbsent,
  meanSatisfaction,
  ticksFromS,
} from '../types.ts'
import type { EffectCtx, EffectLine } from './effects.ts'
import { absenceStep, applyEffect, dayText, effectSummary } from './effects.ts'
import { modifiersStep } from './modifierOps.ts'
import { payrollTicks } from './payroll.ts'
import {
  activateOffer,
  closeJobCard,
  debugOfferQuest,
  declineOffer,
  jobCandidates,
  jobsOpen,
  offerJob,
  questName,
  questTemplate,
  ultimateDef,
  withdrawOpenOffer,
} from './quests.ts'
import {
  busiestDistrict,
  liveSpawningDistricts,
  lowestDistrict,
} from './satisfaction.ts'
import { SORTER_ARM_ID } from './sorter.ts'

export type { CardRefs } from '../types.ts'

/** XORed into the seed word for the cadence stream (≠ the people / quest salts). */
export const EVENT_RNG_SALT = 0xc2b2ae35
/** XORed into the seed word for the content (picks) stream. */
export const EVENT_PICKS_RNG_SALT = 0x27d4eb2f
/** nextDrawTick at or above this = the deck makes no automatic card (tests, D-8). */
export const DECK_OFF_TICK = 1e12
/** A job card's option indexes (synthesized: Accept, then Decline = the default). */
export const JOB_ACCEPT = 0
export const JOB_DECLINE = 1
/** A job card's eventId prefix (`job:<templateId>`). */
export const JOB_PREFIX = 'job:'

/** One option of the open card as the UI and the policy see it. */
export interface CardOption {
  index: number
  /** Placeholders filled. */
  label: string
  effects: readonly EventEffect[]
  /** 0 when the option has no cost. */
  cost: number
  default: boolean
  danger: boolean
  /** Its `if` holds now (hidden options are never offered). */
  visible: boolean
  /** balance ≥ cost. */
  affordable: boolean
  /** A conditional next's filled hint, else null. */
  hint: string | null
}

const OK: CommandResult = { ok: true }
const fail = (reason: FailReason): CommandResult => ({ ok: false, reason })

/** The kinds deck.ts applies itself (never handed to effects.ts). */
const DECK_KINDS: readonly EventEffect['kind'][] = [
  'next',
  'flag',
  'job',
  'jobDecline',
]

/** The start state of the deck: both rng words, the first draw at firstEventS. */
export function startEventsState(data: GameData, seed: number): EventsState {
  return {
    rng: (seedWord(seed) ^ EVENT_RNG_SALT) >>> 0,
    picks: { rng: (seedWord(seed) ^ EVENT_PICKS_RNG_SALT) >>> 0 },
    open: null,
    queue: [],
    scheduled: [],
    nextDrawTick: ticksFromS(data.events.schedule.firstEventS),
    rescueTick: null,
    lastCategory: null,
    seen: {},
    cooldownUntil: {},
    flags: {},
    history: [],
    wrongTossDay: 0,
    wrongTossBase: 0,
    stats: {
      offered: 0,
      decided: 0,
      withdrawn: 0,
      blanks: 0,
      byCategory: {},
      livesLost: 0,
      livesGained: 0,
      vehiclesLost: 0,
      workersLost: 0,
      chainsStarted: 0,
      chainsFinished: 0,
      modifiersPeak: 0,
    },
  }
}

// Lookups ---------------------------------------------------------------------------

/** The events.json card with this id (routers included), or null. */
export function eventDef(data: GameData, id: string): EventDef | null {
  return data.events.deck.find((d) => d.id === id) ?? null
}

/** A job card's template id (`job:<id>` → id), else null. */
export function jobTemplateOf(eventId: string): string | null {
  return eventId.startsWith(JOB_PREFIX)
    ? eventId.slice(JOB_PREFIX.length)
    : null
}

/** One option = news, two or three = a decision (B3 §3.2 card kinds). */
function kindOf(def: EventDef): 'decision' | 'news' {
  return (def.options?.length ?? 0) >= 2 ? 'decision' : 'news'
}

/** The draw weight: `weight`, else schedule.weightDefault by kind. */
function weightOf(data: GameData, def: EventDef): number {
  return def.weight ?? data.events.schedule.weightDefault[kindOf(def)]
}

/** A district's display name ("Registry Row"). */
function districtName(data: GameData, id: DistrictId): string {
  return mapIndex(data).districtById[id]?.flavour ?? id
}

function fillVars(line: string, vars: Record<string, string>): string {
  let out = line
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v)
  return out
}

/** The cheapest vehicle type (the rescue's "a bike"; ties → file order). */
function cheapestVehicle(data: GameData): VehicleTypeDef | null {
  let best: VehicleTypeDef | null = null
  for (const t of data.vehicles.types) {
    if (best === null || t.price < best.price) best = t
  }
  return best
}

/** `level` → its interval band [lo, hi] s: the highest key ≤ level (the lowest key below every key). */
export function drawBand(data: GameData, level: number): [number, number] {
  const bands = data.events.schedule.intervalS
  let key: number | null = null
  let lowest: number | null = null
  for (const k of Object.keys(bands)) {
    const n = Number(k)
    if (lowest === null || n < lowest) lowest = n
    if (n <= level && (key === null || n > key)) key = n
  }
  const band = bands[String(key ?? lowest)]
  if (!band) throw new Error('events.schedule.intervalS has no bands')
  return band
}

/** One cadence-stream draw: a gap in ticks from the level's band (uniform whole seconds). */
function bandGapTicks(sim: Sim): number {
  const [lo, hi] = drawBand(sim.data, sim.state.level.level)
  return ticksFromS(lo + sim.eventRng.int(hi - lo + 1))
}

// People and vehicles a card can name -----------------------------------------------

/**
 * The candidates of a `pick` role, by id (critique 25): an inspector =
 * active, on a desk, not absent; the sorter = the seated, active, non-absent
 * one; a driver = active, at the wheel of a vehicle, not absent; a vehicle =
 * not absent, with such a driver at the wheel (review effects-3, B3 §3.5 "a
 * driver's vehicle parked": a driverless vehicle is already parked, so a
 * card parking it would cost nothing — the population of the absence's
 * `all`, which parks only vehicles with a driver).
 */
export function pickCandidates(sim: Sim, role: CardPickRole): CardPick[] {
  const s = sim.state
  const t = s.tick
  if (role === 'vehicle') {
    const drivers = new Set(pickCandidates(sim, 'driver').map((p) => p.id))
    return s.vehicles
      .filter(
        (v) =>
          !isAbsent(v, t) && v.driverId !== null && drivers.has(v.driverId),
      )
      .map((v) => ({ role, id: v.id, name: v.name }))
      .toSorted((a, b) => a.id - b.id)
  }
  const seated = new Set<number>()
  if (role === 'inspector') {
    for (const n of s.lane.nodes) {
      if (n.fixture?.kind === 'desk') {
        for (const id of n.fixture.inspectorIds) seated.add(id)
      }
    }
  } else if (role === 'sorter') {
    const f = s.lane.holdStation.fixture
    if (typeof f === 'number') seated.add(f)
  } else {
    for (const v of s.vehicles) if (v.driverId !== null) seated.add(v.driverId)
  }
  return s.employees
    .filter(
      (e) => e.role === role && e.active && seated.has(e.id) && !isAbsent(e, t),
    )
    .map((e) => ({ role, id: e.id, name: e.name }))
    .toSorted((a, b) => a.id - b.id)
}

/**
 * A card's target rule resolved without a draw (decision candidates):
 * busiest / lowest (null = unresolvable), a live spawning district id, and
 * `random` (resolvable while any spawning district is live; drawn later).
 */
function preTarget(
  sim: Sim,
  def: EventDef,
): { ok: boolean; target: DistrictId | null } {
  const rule = def.target
  if (rule === undefined) return { ok: true, target: null }
  if (rule === 'busiest') {
    const d = busiestDistrict(sim)
    return { ok: d !== null, target: d }
  }
  if (rule === 'lowest') {
    const d = lowestDistrict(sim)
    return { ok: d !== null, target: d }
  }
  const live = liveSpawningDistricts(sim)
  if (rule === 'random') return { ok: live.length > 0, target: null }
  return { ok: live.includes(rule), target: live.includes(rule) ? rule : null }
}

/** The target now (a `random` rule draws on the picks stream); `debug` keeps a fixed id that is not live. */
function resolveTarget(
  sim: Sim,
  def: EventDef,
  debug: boolean,
): DistrictId | null {
  const rule = def.target
  if (rule === undefined) return null
  if (rule === 'random') {
    const live = liveSpawningDistricts(sim)
    return live.length > 0 ? sim.eventPicksRng.pick(live) : null
  }
  const pre = preTarget(sim, def)
  if (pre.ok) return pre.target
  return debug && rule !== 'busiest' && rule !== 'lowest' ? rule : null
}

/** The `one` pick now (picks stream), or null when no one fits. */
function drawPick(sim: Sim, role: CardPickRole): CardPick | null {
  const c = pickCandidates(sim, role)
  return c.length > 0 ? sim.eventPicksRng.pick(c) : null
}

// Text ------------------------------------------------------------------------------

/**
 * `{district}` → the target's name; `{inspector}` / `{driver}` / `{sorter}`
 * / `{vehicle}` → the pick's name when its role matches, else `someone` /
 * `a vehicle`.
 */
export function fillCardText(
  data: GameData,
  text: string,
  card: CardRefs,
): string {
  if (!text.includes('{')) return text
  const who = (role: CardPickRole, other: string): string =>
    card.pick !== null && card.pick.role === role ? card.pick.name : other
  return fillVars(text, {
    district:
      card.target === null ? 'a district' : districtName(data, card.target),
    inspector: who('inspector', 'someone'),
    driver: who('driver', 'someone'),
    sorter: who('sorter', 'someone'),
    vehicle: who('vehicle', 'a vehicle'),
  })
}

/** The card's title as shown (a job: its quest's name; a deck card: filled). */
export function cardTitle(data: GameData, card: OpenCard): string {
  const tpl = jobTemplateOf(card.eventId)
  if (card.kind === 'job' && tpl !== null) return questName(data, tpl)
  const def = eventDef(data, card.eventId)
  return def === null ? card.eventId : fillCardText(data, def.title, card)
}

// Conditions ------------------------------------------------------------------------

/** min over announced strains of the lane's compounded catch rate (modifier-aware); 0 with none. */
function laneRateMin(sim: Sim): number {
  const s = sim.state
  const rates = announcedStrains(s, sim.data).map((x) =>
    laneCatchRate(s.lane, x, [], sim),
  )
  return rates.length === 0 ? 0 : Math.min(...rates)
}

/** A satisfaction scope's value, or null when it names no live spawning district. */
function satOf(sim: Sim, scope: string, card: CardRefs): number | null {
  const s = sim.state
  if (scope === 'all') return meanSatisfaction(s, sim.data)
  let id: DistrictId | null
  if (scope === 'target') id = card.target
  else if (scope === 'busiest') id = busiestDistrict(sim)
  else if (scope === 'lowest') id = lowestDistrict(sim)
  else id = scope
  if (id === null) return null
  const d = s.districts[id]
  return d?.live === true ? d.satisfaction : null
}

/**
 * Every key of `cond` holds (B3 §4.1; contract §2.1 doc comments + critique
 * 25); `anyOf` needs one of its entries; a missing cond is true.
 */
export function condHolds(
  sim: Sim,
  cond: EventCond | undefined,
  card: CardRefs,
): boolean {
  if (cond === undefined) return true
  const s = sim.state
  const data = sim.data
  const ev = s.events
  const eco = s.economy
  const fleet = s.vehicles.length
  if (cond.fleetAtLeast !== undefined && fleet < cond.fleetAtLeast) return false
  if (cond.fleetAtMost !== undefined && fleet > cond.fleetAtMost) return false
  if (cond.vehiclesAtLeast !== undefined) {
    const { type, n } = cond.vehiclesAtLeast
    if (s.vehicles.filter((v) => v.type === type).length < n) return false
  }
  if (cond.livesAtLeast !== undefined && eco.lives < cond.livesAtLeast)
    return false
  if (cond.livesBelowCap && eco.lives >= data.economy.lives.cap) return false
  if (
    cond.inspectorsAtLeast !== undefined &&
    pickCandidates(sim, 'inspector').length < cond.inspectorsAtLeast
  )
    return false
  if (
    cond.driversAtLeast !== undefined &&
    pickCandidates(sim, 'driver').length < cond.driversAtLeast
  )
    return false
  if (cond.hasSorter && pickCandidates(sim, 'sorter').length === 0) return false
  if (cond.hasArm && s.lane.holdStation.fixture !== SORTER_ARM_ID) return false
  if (
    cond.hasDesk2 &&
    !s.lane.nodes.some(
      (n) => n.fixture?.kind === 'desk' && n.fixture.index === 2,
    )
  )
    return false
  if (cond.hubLive !== undefined && s.districts[cond.hubLive]?.live !== true)
    return false
  if (cond.satBelow !== undefined) {
    const v = satOf(sim, cond.satBelow.scope, card)
    if (v === null || !(v < cond.satBelow.value)) return false
  }
  if (cond.satAtLeast !== undefined) {
    const v = satOf(sim, cond.satAtLeast.scope, card)
    if (v === null || !(v >= cond.satAtLeast.value)) return false
  }
  if (cond.balanceAtLeast !== undefined && eco.balance < cond.balanceAtLeast)
    return false
  if (cond.balanceBelow !== undefined && eco.balance >= cond.balanceBelow)
    return false
  if (cond.balanceBelowVehiclePrice !== undefined) {
    const def = data.vehicles.types.find(
      (t) => t.id === cond.balanceBelowVehiclePrice,
    )
    if (!def || eco.balance >= priceOf(sim, 'vehicle', def.price)) return false
  }
  if (
    cond.laneRateAtLeast !== undefined &&
    laneRateMin(sim) < cond.laneRateAtLeast
  )
    return false
  if (cond.flag !== undefined && ev.flags[cond.flag] !== true) return false
  if (cond.notFlag !== undefined && ev.flags[cond.notFlag] === true)
    return false
  if (
    cond.livesLostAtLeast !== undefined &&
    s.stats.livesLost < cond.livesLostAtLeast
  )
    return false
  if (
    cond.wrongTossTodayAtLeast !== undefined &&
    s.stats.wrongToss - ev.wrongTossBase < cond.wrongTossTodayAtLeast
  )
    return false
  if (cond.questFailedRecently) {
    const within = daysToTicks(data.events.schedule.recentDays)
    const recent = s.quests.history.some(
      (h) =>
        (h.outcome === 'failed' || h.outcome === 'abandoned') &&
        s.tick - h.tick <= within,
    )
    if (!recent) return false
  }
  if (
    cond.anyOf !== undefined &&
    !cond.anyOf.some((c) => condHolds(sim, c, card))
  )
    return false
  return true
}

/** The first branch whose `if` holds (the last has none), or null. */
function pickBranch(
  sim: Sim,
  branches: readonly NextBranchDef[],
  refs: CardRefs,
): string | null {
  for (const b of branches) {
    if (condHolds(sim, b.if, refs)) return b.id
  }
  return null
}

/**
 * A link's card now: a conditional next's branch, then routers followed
 * through their branches (at most chainMaxLinks hops). Null = nothing to
 * open (no branch held, an unknown id, a router loop).
 */
function resolveCard(
  sim: Sim,
  eventId: string | null,
  branches: readonly NextBranchDef[] | null,
  refs: CardRefs,
): EventDef | null {
  let id = eventId
  if (branches !== null) id = pickBranch(sim, branches, refs)
  if (id === null) return null
  let def = eventDef(sim.data, id)
  for (let hop = 0; def !== null && def.router; hop++) {
    if (hop >= sim.data.events.schedule.chainMaxLinks || !def.next) return null
    const next = pickBranch(sim, def.next.branches, refs)
    def = next === null ? null : eventDef(sim.data, next)
  }
  return def
}

// The step --------------------------------------------------------------------------

/**
 * Quiet (no link, rescue or draw; the timer keeps counting — B3 §3.2): the
 * first firstEventS (critique 15); a payday tick (review policy-1: the day
 * step debits payroll after the deck step, so a card opened then would have
 * its cond `balanceAtLeast` and its options' affordability checked against
 * a balance about to drop — the recall's paid way out greyed, the strike
 * forced; what was due opens on the next tick, against the paid balance);
 * afterLevelUpS after the current level's level-up; afterLevelUpS after the
 * Golden Release offer became acceptable (offered, or the last regular quest
 * ended, critique 30 / D-14).
 */
export function deckQuiet(sim: Sim): boolean {
  const s = sim.state
  const sch = sim.data.events.schedule
  const t = s.tick
  const calm = ticksFromS(sch.afterLevelUpS)
  if (t < ticksFromS(sch.firstEventS)) return true
  if (SIM_FEATURES.payroll && t > 0 && t % payrollTicks(sim.data) === 0)
    return true
  const lvlTick = s.stats.levelTick[String(s.level.level)]
  if (lvlTick !== undefined && t < lvlTick + calm) return true
  const o = s.quests.offer
  if (o !== null && o.ultimate && s.quests.active === null) {
    const ultimateId = ultimateDef(sim.data)?.def.id
    const ended = s.quests.history.findLast(
      (h) =>
        h.templateId !== ultimateId &&
        (h.outcome === 'completed' ||
          h.outcome === 'failed' ||
          h.outcome === 'abandoned'),
    )
    const since = Math.max(o.offeredTick, ended?.tick ?? 0)
    if (t < since + calm) return true
  }
  return false
}

/** The rescue's need (B3 §3.5): no vehicle at all and the balance below the cheapest one. */
function rescueNeeded(sim: Sim): boolean {
  const s = sim.state
  if (s.vehicles.length > 0) return false
  const cheapest = cheapestVehicle(sim.data)
  return (
    cheapest !== null &&
    s.economy.balance < priceOf(sim, 'vehicle', cheapest.price)
  )
}

/** The first rescue card whose minLevel and cond hold (a fresh head: no target / pick). */
function rescueCard(sim: Sim): EventDef | null {
  const level = sim.state.level.level
  for (const def of sim.data.events.deck) {
    if (!def.rescue || def.router) continue
    if ((def.minLevel ?? 1) > level) continue
    if (condHolds(sim, def.cond, { target: null, pick: null })) return def
  }
  return null
}

/** A chain headed by `id` is running (scheduled, open or queued — D-29). */
function chainRunning(ev: EventsState, id: string): boolean {
  if (ev.open?.chainHeadId === id) return true
  if (ev.queue.some((c) => c.chainHeadId === id)) return true
  return ev.scheduled.some((l) => l.chainHeadId === id)
}

/**
 * The decision draw's pool (B3 §3.2): drawable, not a router or rescue,
 * minLevel reached, not once-done, out of cooldown, no running chain of its
 * own, its target resolvable without a draw, pick candidates present, its
 * cond true; then the previous card's category left out when another
 * category remains.
 */
export function decisionCandidates(
  sim: Sim,
): { def: EventDef; target: DistrictId | null }[] {
  const s = sim.state
  const ev = s.events
  const level = s.level.level
  const out: { def: EventDef; target: DistrictId | null }[] = []
  for (const def of sim.data.events.deck) {
    if (def.drawable === false || def.router || def.rescue) continue
    if ((def.minLevel ?? 1) > level) continue
    if (def.once && (ev.seen[def.id] ?? 0) > 0) continue
    if ((ev.cooldownUntil[def.id] ?? -1) > s.tick) continue
    if (chainRunning(ev, def.id)) continue
    const pre = preTarget(sim, def)
    if (!pre.ok) continue
    if (def.pick !== undefined && pickCandidates(sim, def.pick).length === 0)
      continue
    if (!condHolds(sim, def.cond, { target: pre.target, pick: null })) continue
    out.push({ def, target: pre.target })
  }
  const others = out.filter((c) => c.def.category !== ev.lastCategory)
  return others.length > 0 ? others : out
}

/** A fresh deck card (a head: depth 1) with its resolved refs. */
function deckCard(
  def: EventDef,
  tick: number,
  refs: CardRefs,
  drawn: boolean,
  gapTicks: number | null,
): OpenCard {
  return {
    eventId: def.id,
    kind: kindOf(def),
    category: def.category,
    questId: null,
    target: refs.target,
    pick: refs.pick,
    openedTick: tick,
    parentChoice: null,
    chainHeadId: def.id,
    depth: 1,
    drawn,
    gapTicks,
  }
}

/**
 * Open `card` in the slot: the counters (offered, byCategory; deck cards
 * also seen and cooldown), lastCategory, `event:offered`, and for decision
 * and news cards the ticker line (job cards keep the quest's own, D-13).
 */
function openCard(sim: Sim, card: OpenCard): void {
  const s = sim.state
  const ev = s.events
  const data = sim.data
  card.openedTick = s.tick
  ev.open = card
  ev.stats.offered += 1
  ev.stats.byCategory[card.category] =
    (ev.stats.byCategory[card.category] ?? 0) + 1
  if (card.kind !== 'job') {
    ev.seen[card.eventId] = (ev.seen[card.eventId] ?? 0) + 1
    const cd = eventDef(data, card.eventId)?.cooldownDays
    if (cd !== undefined)
      ev.cooldownUntil[card.eventId] = s.tick + daysToTicks(cd)
  }
  ev.lastCategory = card.category
  sim.emit('event:offered', {
    eventId: card.eventId,
    kind: card.kind,
    category: card.category,
    chain: card.depth > 1,
    questId: card.questId,
  })
  if (card.kind !== 'job') {
    sim.emit('ticker:news', {
      text: fillVars(data.puns.tickerEvent.offered, {
        category: data.events.categories[card.category]?.word ?? card.category,
        title: cardTitle(data, card),
      }),
      kind: 'event',
    })
  }
}

/** The earliest due link (dueTick, then booking order) opens; failing links are dropped. True = a card opened. */
function openDueLink(sim: Sim): boolean {
  const s = sim.state
  const ev = s.events
  for (;;) {
    let best = -1
    ev.scheduled.forEach((l, i) => {
      if (l.dueTick > s.tick) return
      const b = best < 0 ? null : (ev.scheduled[best] as ScheduledLink)
      if (b === null || l.dueTick < b.dueTick) best = i
    })
    if (best < 0) return false
    const [link] = ev.scheduled.splice(best, 1) as [ScheduledLink]
    const inherited: CardRefs = { target: link.target, pick: link.pick }
    const def = resolveCard(sim, link.eventId, link.branches, inherited)
    if (def === null || !def.options) continue
    // A link inherits its head's target and pick; its own rule fills a gap
    // (a link naming another role draws its own person).
    const target =
      link.target ??
      (def.target !== undefined ? resolveTarget(sim, def, false) : null)
    const pick =
      def.pick !== undefined && link.pick?.role !== def.pick
        ? drawPick(sim, def.pick)
        : link.pick
    const refs: CardRefs = { target, pick }
    if ((def.minLevel ?? 1) > s.level.level) continue
    if (!condHolds(sim, def.cond, refs)) continue
    openCard(sim, {
      eventId: def.id,
      kind: kindOf(def),
      category: def.category,
      questId: null,
      target,
      pick,
      openedTick: s.tick,
      parentChoice: link.parentChoice,
      chainHeadId: link.chainHeadId,
      depth: link.depth,
      drawn: false,
      gapTicks: null,
    })
    return true
  }
}

/** The random draw (nextDrawTick due): job roll, gap, then a job, a decision or a blank. */
function drawCard(sim: Sim): void {
  const s = sim.state
  const ev = s.events
  const sch = sim.data.events.schedule
  const jobPool = jobsOpen(sim) ? jobCandidates(sim) : []
  const isJob = jobPool.length > 0 && sim.eventRng.chance(sch.jobShare)
  const gap = bandGapTicks(sim)
  if (isJob) {
    const c = sim.questRng.weighted(jobPool, (x) => x.t.weight)
    const q = c === null ? null : offerJob(sim, c.t.id)
    if (q !== null) {
      openCard(sim, {
        eventId: JOB_PREFIX + q.templateId,
        kind: 'job',
        category: 'job',
        questId: q.id,
        target: q.target,
        pick: null,
        openedTick: s.tick,
        parentChoice: null,
        chainHeadId: null,
        depth: 1,
        drawn: true,
        gapTicks: gap,
      })
      return
    }
  }
  const pool = SIM_FEATURES.events ? decisionCandidates(sim) : []
  const d =
    pool.length === 0
      ? null
      : sim.eventPicksRng.weighted(pool, (c) => weightOf(sim.data, c.def))
  if (d === null) {
    // D-1: a blank consumes the draw.
    ev.nextDrawTick = s.tick + gap
    ev.stats.blanks += 1
    return
  }
  const target =
    d.def.target === 'random' ? resolveTarget(sim, d.def, false) : d.target
  const pick = d.def.pick !== undefined ? drawPick(sim, d.def.pick) : null
  openCard(sim, deckCard(d.def, s.tick, { target, pick }, true, gap))
}

/** Tick step 10b (B3 §3.2 / plan §4): expiry, absences, the wrong-toss day, then queue / links / rescue / draw. */
export function deckStep(sim: Sim): void {
  modifiersStep(sim)
  absenceStep(sim)
  const s = sim.state
  const ev = s.events
  if (s.day !== ev.wrongTossDay) {
    ev.wrongTossDay = s.day
    ev.wrongTossBase = s.stats.wrongToss
  }
  if (s.economy.gameOver) return
  // The rescue's clock runs every tick (critique 16), whatever else holds the deck.
  if (!rescueNeeded(sim)) ev.rescueTick = null
  else if (ev.rescueTick === null)
    ev.rescueTick = s.tick + ticksFromS(sim.data.events.schedule.rescueDelayS)
  if (ev.open !== null) return
  const queued = ev.queue.shift()
  if (queued !== undefined) {
    openCard(sim, queued)
    return
  }
  if (deckQuiet(sim)) return
  if (openDueLink(sim)) return
  if (ev.nextDrawTick >= DECK_OFF_TICK) return
  if (ev.rescueTick !== null && s.tick >= ev.rescueTick) {
    const def = rescueCard(sim)
    if (def !== null) {
      ev.rescueTick = null
      openCard(
        sim,
        deckCard(def, s.tick, { target: null, pick: null }, false, null),
      )
      return
    }
  }
  if (s.tick < ev.nextDrawTick) return
  drawCard(sim)
}

// Options ---------------------------------------------------------------------------

/** The open card's options (job cards: Accept / Decline). */
export function cardOptions(sim: Sim, card: OpenCard): CardOption[] {
  const s = sim.state
  const tpl = jobTemplateOf(card.eventId)
  if (card.kind === 'job' && tpl !== null) {
    const base = {
      cost: 0,
      danger: false,
      visible: true,
      affordable: true,
      hint: null,
    }
    return [
      {
        ...base,
        index: JOB_ACCEPT,
        label: 'Accept',
        effects: [{ kind: 'job', templateId: tpl }],
        default: false,
      },
      {
        ...base,
        index: JOB_DECLINE,
        label: 'Decline',
        effects: [{ kind: 'jobDecline' }],
        default: true,
      },
    ]
  }
  const def = eventDef(sim.data, card.eventId)
  if (def === null || !def.options) return []
  return def.options.map((o, i) => {
    const cost = o.cost ?? 0
    let hint: string | null = null
    for (const e of o.effects) {
      if (e.kind === 'next' && 'branches' in e) {
        hint = fillCardText(sim.data, e.hint, card)
      }
    }
    return {
      index: i,
      label: fillCardText(sim.data, o.label, card),
      effects: o.effects,
      cost,
      default: o.default === true,
      danger: o.danger === true,
      visible: condHolds(sim, o.if, card),
      affordable: s.economy.balance >= cost,
      hint,
    }
  })
}

/** The generated lines of one option: the cost, the world effects, the `then:` lines. */
export function optionLines(
  sim: Sim,
  card: OpenCard,
  opt: CardOption,
): EffectLine[] {
  const data = sim.data
  const words = data.puns.eventWords
  const title = cardTitle(data, card)
  const refs = {
    target: card.target,
    pick: card.pick,
    eventId: card.eventId,
    title,
  }
  if (card.kind === 'job') {
    if (opt.index === JOB_ACCEPT) return effectSummary(sim, opt.effects, refs)
    const days = data.quests.offer.declineCooldownDays
    return [{ text: `Next job in ${dayText(days)}`, tone: 'neutral' }]
  }
  const out: EffectLine[] = []
  if (opt.cost > 0) out.push({ text: `−$${opt.cost}`, tone: 'cost' })
  const world = opt.effects.filter((e) => !DECK_KINDS.includes(e.kind))
  out.push(...effectSummary(sim, world, refs))
  for (const e of opt.effects) {
    if (e.kind !== 'next') continue
    if ('branches' in e) {
      out.push({
        text: fillVars(words.outcome, {
          hint: fillCardText(data, e.hint, card),
        }),
        tone: 'neutral',
      })
      continue
    }
    const next = eventDef(data, e.eventId)
    const nextTitle =
      next === null ? e.eventId : fillCardText(data, next.title, card)
    out.push({
      text:
        e.days === 0
          ? fillVars(words.thenNow, { title: nextTitle })
          : fillVars(words.then, { title: nextTitle, days: dayText(e.days) }),
      tone: 'neutral',
    })
  }
  return out
}

// Closing a card --------------------------------------------------------------------

/** Push a history record, newest last, trimmed to schedule.historyMax. */
function pushHistory(sim: Sim, rec: EventRecord): void {
  const h = sim.state.events.history
  h.push(rec)
  const max = sim.data.events.schedule.historyMax
  if (h.length > max) h.splice(0, h.length - max)
}

/** Apply a deck card's option: the cost, then the effects in data order. True = it booked a next. */
function applyOption(sim: Sim, card: OpenCard, opt: CardOption): boolean {
  const s = sim.state
  const ev = s.events
  if (opt.cost > 0) sim.debit(opt.cost, 'event')
  const ctx: EffectCtx = {
    eventId: card.eventId,
    title: cardTitle(sim.data, card),
    optionLabel: opt.label,
    optionIndex: opt.index,
    target: card.target,
    pick: card.pick,
    chainHeadId: card.chainHeadId ?? card.eventId,
    depth: card.depth,
  }
  let booked = false
  for (const e of opt.effects) {
    if (e.kind === 'next') {
      const link: ScheduledLink = {
        eventId: 'eventId' in e ? e.eventId : null,
        branches: 'branches' in e ? structuredClone(e.branches) : null,
        dueTick: s.tick + daysToTicks(e.days),
        target: card.target,
        pick: card.pick === null ? null : { ...card.pick },
        parentChoice: opt.label,
        chainHeadId: ctx.chainHeadId,
        depth: card.depth + 1,
        bookedTick: s.tick,
      }
      ev.scheduled.push(link)
      booked = true
    } else if (e.kind === 'flag') {
      if ('set' in e) ev.flags[e.set] = true
      else delete ev.flags[e.clear]
    } else if (e.kind === 'job' || e.kind === 'jobDecline') {
      // Synthesized on job cards only (schema): never in a deck option.
    } else {
      applyEffect(sim, ctx, e)
    }
  }
  return booked
}

/** The `decideEvent` command: answer the open card with option `option`. */
export function decideEvent(
  sim: Sim,
  eventId: string,
  option: number,
): CommandResult {
  const s = sim.state
  const ev = s.events
  const card = ev.open
  if (card === null || card.eventId !== eventId) return fail('no-event')
  if (s.economy.gameOver) return fail('invalid')
  const opts = cardOptions(sim, card)
  const opt = Number.isSafeInteger(option) ? opts[option] : undefined
  if (opt === undefined) return fail('bad-option')
  if (!opt.visible) return fail('option-hidden')
  if (!opt.affordable) return fail('cant-afford')
  // The lines describe the choice as it was offered (critique 18: before any change).
  const lines = optionLines(sim, card, opt)
  let booked = false
  if (card.kind === 'job') {
    const q = s.quests.offer
    if (q === null || q.id !== card.questId) {
      // A job card whose quest is gone (never in a valid state): withdraw it.
      closeJobCard(sim, card.questId ?? '')
      if (ev.open === card) ev.open = null
      return { ok: false, reason: 'invalid', applied: true }
    }
    if (opt.index === JOB_ACCEPT) {
      if (s.quests.active !== null) return fail('quest-active')
      const res = activateOffer(sim, q)
      // The magic route failed: activateOffer withdrew the offer, which
      // closed this card ('withdrawn', critique 18) — nothing more here.
      if (!res.ok) return res
    } else {
      declineOffer(sim, q)
    }
  } else {
    booked = applyOption(sim, card, opt)
  }
  pushHistory(sim, {
    eventId: card.eventId,
    kind: card.kind,
    category: card.category,
    openedTick: card.openedTick,
    closedTick: s.tick,
    option: opt.index,
    label: opt.label,
    default: opt.default,
    outcome: 'decided',
    chainHeadId: card.chainHeadId,
    depth: card.depth,
  })
  ev.stats.decided += 1
  if (card.kind !== 'job') {
    if (card.depth === 1 && booked) ev.stats.chainsStarted += 1
    if (card.depth >= 2 && !booked) {
      ev.stats.chainsFinished += 1
      const head = eventDef(sim.data, card.chainHeadId ?? card.eventId)
      sim.emit('ticker:news', {
        text: fillVars(sim.data.puns.tickerEvent.chainDone, {
          title:
            head === null
              ? cardTitle(sim.data, card)
              : fillCardText(sim.data, head.title, card),
        }),
        kind: 'event',
      })
    }
  }
  if (card.drawn && card.gapTicks !== null) {
    ev.nextDrawTick = s.tick + card.gapTicks
  }
  if (ev.open === card) ev.open = null
  sim.emit('event:decided', {
    eventId: card.eventId,
    option: opt.index,
    label: opt.label,
    default: opt.default,
    kind: card.kind,
    effects: lines.map((l) => l.text),
  })
  return OK
}

// Debug and job commands --------------------------------------------------------------

/**
 * The `debugOfferEvent` command (?event=, ViewSimDebug.offerEvent): open a
 * deck card now — a router resolves its branches now — ignoring minLevel,
 * cond, once and cooldown; target and pick resolve (on the picks stream; a
 * missing pick is null). With a card open it queues (`event:queued`) while
 * the queue has room (schedule.maxQueued), else `invalid`. A head: depth 1,
 * never drawn (the timer is untouched).
 */
export function debugOfferEvent(sim: Sim, eventId: string): CommandResult {
  const s = sim.state
  const ev = s.events
  const head = eventDef(sim.data, eventId)
  if (head === null || s.economy.gameOver) return fail('invalid')
  if (ev.open !== null && ev.queue.length >= sim.data.events.schedule.maxQueued)
    return fail('invalid')
  const def = head.router
    ? resolveCard(sim, head.id, null, { target: null, pick: null })
    : head
  if (def === null || !def.options) return fail('invalid')
  const target = resolveTarget(sim, def, true)
  const pick = def.pick !== undefined ? drawPick(sim, def.pick) : null
  const card = deckCard(def, s.tick, { target, pick }, false, null)
  if (ev.open !== null) {
    ev.queue.push(card)
    sim.emit('event:queued', { eventId: card.eventId })
    return OK
  }
  openCard(sim, card)
  return OK
}

/**
 * ?quest= and debug.offerQuest: the ultimate id → the build-2 path (the
 * Golden Release in the offer slot, no card); a template → its job card now
 * (an open job card and the open offer are withdrawn first; any other open
 * card refuses with `invalid`). Draws nothing; never drawn (the timer is
 * untouched).
 */
export function debugOfferJob(sim: Sim, templateId: string): CommandResult {
  if (!SIM_FEATURES.quests) return fail('locked')
  const s = sim.state
  const ev = s.events
  const u = ultimateDef(sim.data)
  if (u !== null && u.def.id === templateId) {
    return debugOfferQuest(sim, templateId)
  }
  if (questTemplate(sim.data, templateId) === null || s.economy.gameOver)
    return fail('invalid')
  if (s.quests.active !== null) return fail('quest-active')
  const open = ev.open
  if (open !== null && open.kind !== 'job') return fail('invalid')
  let changed = false
  if (open !== null) {
    closeJobCard(sim, open.questId ?? '')
    changed = true
  }
  if (s.quests.offer !== null) {
    withdrawOpenOffer(sim)
    changed = true
  }
  const q = offerJob(sim, templateId, { debug: true })
  if (q === null) {
    return changed
      ? { ok: false, reason: 'invalid', applied: true }
      : fail('invalid')
  }
  openCard(sim, {
    eventId: JOB_PREFIX + q.templateId,
    kind: 'job',
    category: 'job',
    questId: q.id,
    target: q.target,
    pick: null,
    openedTick: s.tick,
    parentChoice: null,
    chainHeadId: null,
    depth: 1,
    drawn: false,
    gapTicks: null,
  })
  return OK
}

/**
 * acceptQuest / declineQuest on a quest a job card holds → that card's
 * decision; null = not a card's quest (the Golden Release, a card-less
 * offer). A queued job card with that quest (never made by this build,
 * critique 29) leaves the queue and the command acts on the offer itself.
 */
export function resolveJobCommand(
  sim: Sim,
  questId: string,
  choice: 'accept' | 'decline',
): CommandResult | null {
  const s = sim.state
  const ev = s.events
  const open = ev.open
  if (open !== null && open.kind === 'job' && open.questId === questId) {
    return decideEvent(
      sim,
      open.eventId,
      choice === 'accept' ? JOB_ACCEPT : JOB_DECLINE,
    )
  }
  const i = ev.queue.findIndex((c) => c.kind === 'job' && c.questId === questId)
  if (i >= 0) {
    const [c] = ev.queue.splice(i, 1) as [OpenCard]
    if (c.drawn && c.gapTicks !== null) ev.nextDrawTick = s.tick + c.gapTicks
  }
  return null
}
