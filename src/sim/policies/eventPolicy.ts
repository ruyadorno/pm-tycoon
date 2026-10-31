// The event policy (spec-build3 §3.8; M11 contract §3 stream D, D-37, D-38;
// critique 7, 20, 24): the competent policy's card answers, shared by the
// `competent` and `delegating` kinds (policy.ts calls eventPolicyStep first
// in every step, so a card is answered on the step after the tick that
// offered it — the hold never sees a policy-played sim wait).
//
// Every visible, affordable option is scored in dollars and the best one
// taken; ties → the card's default, then the lowest index. The score is the
// sum over the option's effects in data order of a data-driven value
// (events.json policy.weights), walked with a running balance and lives so
// the clamps the appliers make are the clamps scored:
//
//   cost / money / moneyPerVehicle / moneyPct  × weights.money, a negative
//       amount clamped to the balance (the appliers debit at most it);
//   lives      +life per life gained below the cap (0 at the cap), −life per
//       life lost, −Infinity when the option takes the last one (the policy
//       never ends its own run — it is chosen only when every option is −∞);
//   satisfaction  satisfactionPerPoint × delta × n (n = the live spawning
//       districts for `all`, else 1);
//   mod        weights.mod[key] × size × (days ?? permanentDaysForScore) ×
//       sign — size |mult − 1| for a mult row (mult 0 → 1, never NaN), |add|
//       for an add row; sign +1 when the change moves the key in its
//       modifiers.goodDirection;
//   pips       weights.pips[stat] × delta × persons (`all` → the role's active
//       employees; `one` → 1, or 0 once the card's pick has left);
//   vehicle    lose → −(the paid price of the vehicle that would go: the
//       oldest of the type, `any` the oldest overall), or the fallback money
//       when there is none; gain → vehicleGainShare × list price (+ the star
//       value of a volunteer driver);
//   staff      quit → −staffQuit when someone would quit; star → Σ_stat
//       weights.pips[stat] × (pip − 3) (D-38); absent → −absentPerDay × days
//       × persons;
//   wanted     wantedPerLabel × min(n, labels still revealable);
//   parcels    spawn → parcelSpawnShare × count × the size's value; lose →
//       −parcelLostEach × min(count, losable shelf parcels) (D-38);
//   cap        capPerUnit × add;
//   end        −Σ the remaining score of the rows it ends (remaining days of a
//       timed row, permanentDaysForScore for a permanent one);
//   flag       0;
//   next       weights.chain; a conditional next, or a next to a router, adds
//       the best score of the branch card the condition picks NOW, one level
//       deep (nested nexts score the chain weight only) — with this option's
//       own `flag` set / clear applied virtually (critique 24, Q-B3-8: the
//       audit's consultant sets `audit_ready` before the router reads it); a
//       plain next stays the chain weight (Q-B3-8) unless every shown,
//       affordable option of the card it books takes the last life now —
//       then −∞ (review policy-2: the policy never walks into a link that
//       would end its run while the chain offered a way out);
//   job        a job card's Accept = max(1, the reward's value) (D-37: cash +
//       life × lives + satisfactionPerPoint × satisfaction + the star value +
//       vehicleGainShare × the voucher machine's list price + 1e6 for the
//       victory) and Decline 0, so the policy always accepts (plan-build3 §7).
//
// Scores are rounded to cents, so float noise never breaks a tie the data
// meant (the radio ad's −$120 against +$120 of orders is a tie → the default).
//
// staticScore is the state-free part (the evMax schema test, deckEvMean):
// lives ±life (never −∞), `all` × the spawning districts unlocked at the
// card's minLevel, one person, a vehicle loss at the type's list price, the
// chain weight only for a next, 0 for `end`, moneyPct 0 and one vehicle for
// moneyPerVehicle and a costPerVehicle price (review deck-1: in scoreOption
// that price is the option's cost — every owned vehicle, greyed while
// unaffordable, never clamped). The evMax rule leaves life gains out (critique 20: lives
// are rewards, not cash; deckEvMean keeps them).
//
// Pure sim code (tools/check-sim-purity.mjs): reads sim.state, acts only
// through sim.dispatch. The virtual flags of a conditional next are a scoped
// swap of state.events.flags, restored before scoreOption returns (no
// dispatch, emit or tick happens inside).

import type {
  EventDef,
  EventEffect,
  EventOptionDef,
  EventPolicyWeightsDef,
  GameData,
  ModifierKey,
  NextBranchDef,
  StarApplicantDef,
  StatId,
} from '../../data/types.ts'
import { MULT_KEYS } from '../modifiers.ts'
import type { Sim } from '../sim.ts'
import type { CardOption } from '../systems/deck.ts'
import { cardOptions, condHolds, eventDef } from '../systems/deck.ts'
import { liveSpawningDistricts } from '../systems/satisfaction.ts'
import type {
  CardRefs,
  Employee,
  Modifier,
  OpenCard,
  Vehicle,
} from '../types.ts'
import { isAbsent, laneNode, TICKS_PER_DAY } from '../types.ts'

/** Metrics-only running totals over decision cards (never read by the sim). */
export interface PolicyTally {
  decisions: number
  evSum: number
  nonDefault: number
}

export function newTally(): PolicyTally {
  return { decisions: 0, evSum: 0, nonDefault: 0 }
}

/** The Golden Release's Accept: above any other reward (D-37). */
const VICTORY_SCORE = 1e6

const MULT: ReadonlySet<ModifierKey> = new Set(MULT_KEYS)

/** Cents: float noise never breaks a tie the data meant (and −0 is 0). −∞ stays −∞. */
function cents(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 + 0 : x
}

/** A modifier's value per the key's weight (mult 0 → size 1, never NaN; critique 7). */
function modScore(
  data: GameData,
  key: ModifierKey,
  mult: number | undefined,
  add: number | undefined,
  days: number,
): number {
  const w = data.events.policy.weights.mod[key] ?? 0
  const up = data.events.modifiers.goodDirection[key] === 'up'
  const size = mult !== undefined ? Math.abs(mult - 1) : Math.abs(add ?? 0)
  if (size === 0) return 0
  const good = mult !== undefined ? mult > 1 === up : (add ?? 0) > 0 === up
  return w * size * days * (good ? 1 : -1)
}

/** A ★ (or a volunteer driver): Σ_stat weights.pips[stat] × (pip − 3) (D-38). */
export function starValue(
  w: EventPolicyWeightsDef,
  star: StarApplicantDef,
): number {
  let v = 0
  for (const [stat, pip] of Object.entries(star.pips)) {
    v += (w.pips[stat as StatId] ?? 0) * ((pip ?? 0) - 3)
  }
  return v
}

/** A live modifier row's remaining value (the `end` effect scores minus this). */
function rowScore(data: GameData, m: Modifier, tick: number): number {
  const days =
    m.untilTick === null
      ? data.events.modifiers.permanentDaysForScore
      : Math.max(0, m.untilTick - tick) / TICKS_PER_DAY
  return MULT.has(m.key)
    ? modScore(data, m.key, m.mult, undefined, days)
    : modScore(data, m.key, undefined, m.add, days)
}

/** The card's pick, if it is a still-active employee of `role`. */
function pickedEmployee(
  sim: Sim,
  refs: CardRefs,
  role: string,
): Employee | null {
  const p = refs.pick
  if (p === null || p.role !== role) return null
  const e = sim.state.employees.find((x) => x.id === p.id)
  return e !== undefined && e.active && e.role === role ? e : null
}

/** The vehicle a `vehicle lose` takes: the oldest (boughtTick, then id) of the type. */
function vehicleToLose(sim: Sim, type: string): Vehicle | null {
  let best: Vehicle | null = null
  for (const v of sim.state.vehicles) {
    if (type !== 'any' && v.type !== type) continue
    if (
      best === null ||
      v.boughtTick < best.boughtTick ||
      (v.boughtTick === best.boughtTick && v.id < best.id)
    ) {
      best = v
    }
  }
  return best
}

/** Malware labels of the announced strains not yet on the wanted list. */
function revealableLabels(sim: Sim): number {
  const s = sim.state
  let n = 0
  for (const st of sim.data.parcels.malware.strains) {
    if (s.level.announced[st.id] === undefined) continue
    for (const label of sim.data.puns.malwareLabels[st.id] ?? []) {
      if (!s.wanted.includes(label)) n += 1
    }
  }
  return n
}

/** Shelf parcels a `parcels lose` may take (unreserved, not magic). */
function losableShelfParcels(sim: Sim): number {
  const s = sim.state
  const shelf = laneNode(s.lane, s.lane.shelfNodeId)
  let n = 0
  for (const id of shelf?.queue ?? []) {
    const p = s.parcels[String(id)]
    if (p !== undefined && p.reservedBy === null && !p.magic) n += 1
  }
  return n
}

/** The first branch whose `if` holds (the last has none); null when none does. */
function firstBranch(
  sim: Sim,
  branches: readonly NextBranchDef[],
  refs: CardRefs,
): string | null {
  for (const b of branches) {
    if (b.if === undefined || condHolds(sim, b.if, refs)) return b.id
  }
  return null
}

/** A link id resolved through routers now (at most chainMaxLinks hops); null = no card. */
function resolveLink(
  sim: Sim,
  id: string | null,
  refs: CardRefs,
): EventDef | null {
  let cur = id
  for (let hop = 0; hop <= sim.data.events.schedule.chainMaxLinks; hop++) {
    if (cur === null) return null
    const def = eventDef(sim.data, cur)
    if (def === null) return null
    if (def.router !== true) return def
    cur = firstBranch(sim, def.next?.branches ?? [], refs)
  }
  return null
}

/** The option's `flag` set / clear applied to a copy of the flags (critique 24). */
function virtualFlags(
  flags: Record<string, true>,
  effects: readonly EventEffect[],
): Record<string, true> | null {
  let out: Record<string, true> | null = null
  for (const e of effects) {
    if (e.kind !== 'flag') continue
    out ??= { ...flags }
    if ('set' in e) out[e.set] = true
    else delete out[e.clear]
  }
  return out
}

/** The best visible, affordable option's score of `def` opened as `parent`'s link now. */
function bestLinkScore(
  sim: Sim,
  parent: OpenCard,
  def: EventDef,
  label: string,
): number {
  const card: OpenCard = {
    eventId: def.id,
    kind: (def.options?.length ?? 0) === 1 ? 'news' : 'decision',
    category: def.category,
    questId: null,
    target: parent.target,
    pick: parent.pick,
    openedTick: sim.state.tick,
    parentChoice: label,
    chainHeadId: parent.chainHeadId ?? parent.eventId,
    depth: parent.depth + 1,
    drawn: false,
    gapTicks: null,
  }
  let best: number | null = null
  for (const o of cardOptions(sim, card)) {
    if (!o.visible || !o.affordable) continue
    const sc = scoreAt(sim, card, o, true)
    if (best === null || sc > best) best = sc
  }
  return best ?? 0
}

/**
 * A `next`: the chain weight, + the branch card picked now for a conditional
 * next or a router (one level deep); a plain next −∞ when its card's every
 * answer takes the last life now (review policy-2), else the chain weight.
 */
function nextScore(
  sim: Sim,
  card: OpenCard,
  opt: CardOption,
  e: Extract<EventEffect, { kind: 'next' }>,
  nested: boolean,
): number {
  const chain = sim.data.events.policy.weights.chain
  if (nested) return chain
  const refs: CardRefs = { target: card.target, pick: card.pick }
  const conditional =
    'branches' in e || eventDef(sim.data, e.eventId)?.router === true
  const ev = sim.state.events
  const saved = ev.flags
  const flags = virtualFlags(saved, opt.effects)
  if (flags !== null) ev.flags = flags
  try {
    const def =
      'branches' in e
        ? resolveLink(sim, firstBranch(sim, e.branches, refs), refs)
        : resolveLink(sim, e.eventId, refs)
    // The deck re-checks a due link's minLevel and cond: one that fails is dropped.
    if (
      def === null ||
      (def.minLevel ?? 1) > sim.state.level.level ||
      !condHolds(sim, def.cond, refs)
    ) {
      return chain
    }
    const best = bestLinkScore(sim, card, def, opt.label)
    if (!conditional) return best === Number.NEGATIVE_INFINITY ? best : chain
    return chain + best
  } finally {
    ev.flags = saved
  }
}

/** A job card's Accept: max(1, the offered quest's reward value) (D-37). */
function jobScore(sim: Sim, card: OpenCard): number {
  const w = sim.data.events.policy.weights
  const q = sim.state.quests.offer
  if (q === null || q.id !== card.questId) return 1
  const r = q.reward
  const voucher =
    r.voucher === null
      ? 0
      : Math.round(
          (sim.data.machines.checkers.find((c) => c.id === r.voucher)?.price ??
            0) * w.vehicleGainShare,
        )
  const value =
    r.cash * w.money +
    r.lives * w.life +
    r.satisfaction * w.satisfactionPerPoint +
    (r.star === null ? 0 : starValue(w, r.star)) +
    voucher +
    (r.victory ? VICTORY_SCORE : 0)
  return Math.max(1, value)
}

function scoreAt(
  sim: Sim,
  card: OpenCard,
  opt: CardOption,
  nested: boolean,
): number {
  const data = sim.data
  const s = sim.state
  const w = data.events.policy.weights
  const refs: CardRefs = { target: card.target, pick: card.pick }
  const cap = data.economy.lives.cap
  let balance = s.economy.balance
  let lives = s.economy.lives
  let score = 0
  /** A money amount through the running balance (a debit is clamped to it). */
  const money = (delta: number): void => {
    const d = delta < 0 ? -Math.min(-delta, Math.max(0, balance)) : delta
    balance += d
    score += d * w.money
  }
  if (opt.cost > 0) money(-opt.cost)
  for (const e of opt.effects) {
    switch (e.kind) {
      case 'money':
        money(e.delta)
        break
      case 'moneyPerVehicle': {
        const n = s.vehicles.filter(
          (v) => e.type === undefined || v.type === e.type,
        ).length
        money(e.delta * n)
        break
      }
      case 'moneyPct':
        money(Math.round(balance * e.pct))
        break
      case 'lives':
        if (e.delta > 0) {
          const gained = Math.max(0, Math.min(e.delta, cap - lives))
          lives += gained
          score += gained * w.life
        } else if (e.delta < 0) {
          if (-e.delta >= lives) return Number.NEGATIVE_INFINITY
          lives += e.delta
          score += e.delta * w.life
        }
        break
      case 'satisfaction': {
        const n = e.scope === 'all' ? liveSpawningDistricts(sim).length : 1
        score += w.satisfactionPerPoint * e.delta * n
        break
      }
      case 'mod':
        score += modScore(
          data,
          e.key,
          e.mult,
          e.add,
          e.days ?? data.events.modifiers.permanentDaysForScore,
        )
        break
      case 'pips': {
        const persons =
          e.scope === 'all'
            ? s.employees.filter((x) => x.role === e.role && x.active).length
            : pickedEmployee(sim, refs, e.role) === null
              ? 0
              : 1
        score += (w.pips[e.stat] ?? 0) * e.delta * persons
        break
      }
      case 'vehicle':
        if ('lose' in e) {
          const v = vehicleToLose(sim, e.lose)
          if (v === null) money(e.fallback)
          else score -= v.purchasePrice * w.money
        } else {
          const def = data.vehicles.types.find((t) => t.id === e.gain)
          score += w.vehicleGainShare * (def?.price ?? 0)
          if (e.withDriver !== undefined) score += starValue(w, e.withDriver)
        }
        break
      case 'staff':
        if ('quit' in e) {
          const someone =
            e.pick === 'one'
              ? pickedEmployee(sim, refs, e.quit) !== null
              : s.employees.some(
                  (x) => x.role === e.quit && x.active && !isAbsent(x, s.tick),
                )
          if (someone) score -= w.staffQuit
        } else if ('star' in e) {
          score += starValue(w, e.star)
        } else {
          let persons: number
          if (e.absent === 'vehicles') {
            persons =
              e.pick === 'all'
                ? s.vehicles.filter((v) => v.driverId !== null).length
                : refs.pick?.role === 'vehicle' &&
                    s.vehicles.some(
                      (v) => v.id === refs.pick?.id && v.driverId !== null,
                    )
                  ? 1
                  : 0
          } else {
            const role = e.absent
            persons =
              e.pick === 'all'
                ? s.employees.filter((x) => x.role === role && x.active).length
                : pickedEmployee(sim, refs, role) === null
                  ? 0
                  : 1
          }
          score -= w.absentPerDay * e.days * persons
        }
        break
      case 'wanted':
        score += w.wantedPerLabel * Math.min(e.reveal, revealableLabels(sim))
        break
      case 'parcels':
        if ('spawn' in e) {
          const value = data.parcels.sizes[e.spawn.size]?.value ?? 0
          score += w.parcelSpawnShare * e.spawn.count * value
        } else {
          score -=
            w.parcelLostEach * Math.min(e.lose.count, losableShelfParcels(sim))
        }
        break
      case 'cap':
        score += w.capPerUnit * e.add
        break
      case 'end':
        for (const m of s.modifiers) {
          if (m.eventId === e.eventId) score -= rowScore(data, m, s.tick)
        }
        break
      case 'flag':
        break
      case 'next':
        score += nextScore(sim, card, opt, e, nested)
        break
      case 'job':
        score += jobScore(sim, card)
        break
      case 'jobDecline':
        break
    }
  }
  return cents(score)
}

/** An option's score in dollars now (−Infinity = it takes the last life). */
export function scoreOption(sim: Sim, card: OpenCard, opt: CardOption): number {
  return scoreAt(sim, card, opt, false)
}

/** Live spawning districts at a level (staticScore's `all`). */
function spawningAt(data: GameData, level: number): number {
  return data.districts.filter(
    (d) => d.kind === 'district' && d.unlockLevel <= level,
  ).length
}

/**
 * State-free part of an option's score (the evMax schema test, deckEvMean);
 * `lifeGains: false` leaves the life gains out (the evMax rule, critique 20).
 */
export function staticScore(
  data: GameData,
  def: EventDef,
  opt: EventOptionDef,
  opts: { lifeGains?: boolean } = {},
): number {
  const w = data.events.policy.weights
  const permanent = data.events.modifiers.permanentDaysForScore
  const listPrice = (type: string): number => {
    const t =
      type === 'any'
        ? data.vehicles.types[0]
        : data.vehicles.types.find((x) => x.id === type)
    return t?.price ?? 0
  }
  // A per-vehicle price (review deck-1) counts one vehicle, as moneyPerVehicle does.
  let score = -((opt.cost ?? 0) + (opt.costPerVehicle?.each ?? 0)) * w.money
  for (const e of opt.effects) {
    switch (e.kind) {
      case 'money':
        score += e.delta * w.money
        break
      case 'moneyPerVehicle':
        score += e.delta * w.money
        break
      case 'moneyPct':
        break
      case 'lives':
        if (e.delta < 0 || opts.lifeGains !== false) score += e.delta * w.life
        break
      case 'satisfaction': {
        const n = e.scope === 'all' ? spawningAt(data, def.minLevel ?? 1) : 1
        score += w.satisfactionPerPoint * e.delta * n
        break
      }
      case 'mod':
        score += modScore(data, e.key, e.mult, e.add, e.days ?? permanent)
        break
      case 'pips':
        score += (w.pips[e.stat] ?? 0) * e.delta
        break
      case 'vehicle':
        if ('lose' in e) score -= listPrice(e.lose) * w.money
        else {
          score += w.vehicleGainShare * listPrice(e.gain)
          if (e.withDriver !== undefined) score += starValue(w, e.withDriver)
        }
        break
      case 'staff':
        if ('quit' in e) score -= w.staffQuit
        else if ('star' in e) score += starValue(w, e.star)
        else score -= w.absentPerDay * e.days
        break
      case 'wanted':
        score += w.wantedPerLabel * e.reveal
        break
      case 'parcels':
        if ('spawn' in e) {
          const value = data.parcels.sizes[e.spawn.size]?.value ?? 0
          score += w.parcelSpawnShare * e.spawn.count * value
        } else score -= w.parcelLostEach * e.lose.count
        break
      case 'cap':
        score += w.capPerUnit * e.add
        break
      case 'next':
        score += w.chain
        break
      case 'end':
      case 'flag':
      case 'job':
      case 'jobDecline':
        break
    }
  }
  return cents(score)
}

/** Mean staticScore over every option of every card (B3 §3.8, printed by the gate). */
export function deckEvMean(data: GameData): number | null {
  let sum = 0
  let n = 0
  for (const def of data.events.deck) {
    for (const opt of def.options ?? []) {
      sum += staticScore(data, def, opt)
      n += 1
    }
  }
  return n === 0 ? null : cents(sum / n)
}

/** Options above policy.evMax with their life gains left out (critique 20); [] = the rule holds. */
export function evMaxViolations(
  data: GameData,
): { id: string; option: string; score: number }[] {
  const out: { id: string; option: string; score: number }[] = []
  for (const def of data.events.deck) {
    for (const opt of def.options ?? []) {
      const score = staticScore(data, def, opt, { lifeGains: false })
      if (score > data.events.policy.evMax) {
        out.push({ id: def.id, option: opt.label, score })
      }
    }
  }
  return out
}

/**
 * The policy's pick among `opts` (only visible, affordable ones count): the
 * max score; ties → the default, then the lowest index. Null with none.
 */
export function chooseOption(
  sim: Sim,
  card: OpenCard,
  opts: readonly CardOption[],
): { option: CardOption; score: number } | null {
  let best: { option: CardOption; score: number } | null = null
  for (const o of opts.toSorted((a, b) => a.index - b.index)) {
    if (!o.visible || !o.affordable) continue
    const score = scoreOption(sim, card, o)
    if (
      best === null ||
      score > best.score ||
      (score === best.score && o.default && !best.option.default)
    ) {
      best = { option: o, score }
    }
  }
  return best
}

/**
 * Answer the open card, if any (the competent policy's first step): the
 * chosen option goes through `decideEvent`; a decision card (2+ options)
 * adds to the tally — its score (−∞ counted as −life) and whether the pick
 * was not the default — once the command succeeds.
 */
export function eventPolicyStep(sim: Sim, tally: PolicyTally): void {
  const open = sim.state.events.open
  if (open === null) return
  const pick = chooseOption(sim, open, cardOptions(sim, open))
  if (pick === null) return
  const res = sim.dispatch({
    kind: 'decideEvent',
    eventId: open.eventId,
    option: pick.option.index,
  })
  if (!res.ok || open.kind !== 'decision') return
  tally.decisions += 1
  tally.evSum += Number.isFinite(pick.score)
    ? pick.score
    : -sim.data.events.policy.weights.life
  if (!pick.option.default) tally.nonDefault += 1
}

/**
 * `--policy none` and other policy-less loops (D-8): answer the open card
 * with its default option (else the first visible, affordable one) through a
 * logged `decideEvent`. False when no card is open or none could be answered.
 */
export function answerWithDefault(sim: Sim): boolean {
  const open = sim.state.events.open
  if (open === null) return false
  const opts = cardOptions(sim, open).filter((o) => o.visible && o.affordable)
  const pick = opts.find((o) => o.default) ?? opts[0]
  if (pick === undefined) return false
  const res = sim.dispatch({
    kind: 'decideEvent',
    eventId: open.eventId,
    option: pick.index,
  })
  return res.ok
}
