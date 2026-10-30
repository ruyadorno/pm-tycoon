// Quests (spec-build2 §3; plan-build2 §8.4; design-m7 §3.4): one offer slot,
// one active slot (quests.offer.maxActive = 1), the offer scheduler, the
// goal counters, limits, rewards, the accept / decline / abandon commands
// and the Golden Release → Victory. Tick step 11 (`questsStep`, after
// `levels` so `level:up {5}` offers the ultimate the same tick, before `day`
// so a boundary tick closes `onTimeRateDay` with all of that day's
// deliveries) plus one event observer (`observeQuestEvent`, called by
// Sim.emit before the taps) that only counts — it never emits, draws or
// dispatches. Counting (observer) and evaluation (step) are separate, and
// each counter reads one terminal event per parcel id, so nothing is counted
// twice; only the ACTIVE quest counts (an offer never does).
//
// Scheduler (B2 §3.1): the first regular offer at firstOfferDay (state.day
// semantics: tick 3 × 600 = 3:00, design Q3); after a completion or a fail
// the next waits intervalDays, after a Decline or an expiry
// declineCooldownDays (design Q8). An offer stays open offerExpiresDays. No
// eligible template when due: retry every tick, no draw. The template is one
// weighted draw on the QUEST stream (state.quests.rng, design Q21 — never
// state.rng), the newest history entry's template left out when another is
// eligible (no back-to-back repeat). The Golden Release (levels.json
// ultimateQuest) is offered from its level on: it withdraws an open regular
// offer, waits in the offer slot while a regular quest is active (Accept →
// 'quest-active'), never expires, cannot be declined (Later only), and a
// fail re-offers it after declineCooldownDays. While it is pending (its
// level reached, no Victory yet) no regular template is offered, its
// cooldown included (B2 §3.4 "while it is open or active no other template
// is offered"); its end, Victory included, starts the regular interval like
// any other end (`nextOfferTick` ≥ tick + intervalDays), so endless play
// gets its first regular offer intervalDays after Victory.
//
// Rewards (B2 §3.1): cash → Sim.credit(…, 'quest', earned = true) (lifetime
// earned, Q-B2-12); lives capped at economy.lives.cap (`life:gained`, design
// Q9); satisfaction to the target outside the +N/day cap; a ★ applicant
// (people.ts addStarApplicant, on the applicant stream); a voucher (a free
// machine in the first empty live slot, else held for the BuySheet). No
// penalty on a fail (Q-B2-7). Victory sets economy.victory, stats.victoryTick
// (malwareShare escalates from the next day boundary) and emits
// `game:victory` last.

import type {
  GameData,
  LevelScaled,
  QuestTemplateDef,
  UltimateQuestDef,
} from '../../data/types.ts'
import type { CommandResult, FailReason } from '../commands.ts'
import {
  announcedStrains,
  laneCatchRate,
  machineChecker,
} from '../detection.ts'
import type { SimEventName, SimEventPayloads } from '../events.ts'
import { SIM_FEATURES } from '../features.ts'
import { districtOf, mapIndex } from '../map.ts'
import type { Rng } from '../rng.ts'
import type { Sim } from '../sim.ts'
import type { TickContext } from '../tick.ts'
import type {
  DistrictId,
  Quest,
  QuestFailReason,
  QuestGoalKind,
  QuestOutcome,
  QuestProgress,
  QuestReward,
  QuestsState,
  Tick,
} from '../types.ts'
import {
  daysToTicks,
  laneNode,
  liveSlotIds,
  QUEST_HISTORY_MAX,
  TICKS_PER_DAY,
  ticksFromS,
} from '../types.ts'
import { placeFixture } from './lane.ts'
import { magicRoute, spawnMagicParcel } from './magic.ts'
import { addStarApplicant, starApplicantName } from './people.ts'
import { changeSatisfaction } from './satisfaction.ts'

/** XORed into the seed word for the quest stream (≠ people.ts PEOPLE_RNG_SALT). */
export const QUEST_RNG_SALT = 0x85ebca6b

/** Every progress kind (quests.json goal kinds + the ultimate). */
export const QUEST_KINDS: readonly QuestGoalKind[] = [
  'deliveriesFrom',
  'satisfactionAtLeast',
  'magicParcel',
  'tossStreak',
  'onTimeRateDay',
  'deliveriesOfSize',
  'holdDecisions',
  'overseasCleared',
  'detectionAllStrains',
  'ultimate',
]

const OK: CommandResult = { ok: true }
const fail = (reason: FailReason): CommandResult => ({ ok: false, reason })

// Lookups ----------------------------------------------------------------------------

/** The quest stream (cached on the Sim; never state.rng). */
export function questRng(sim: Sim): Rng {
  return sim.questRng
}

/** A quests.json template, or null (the ultimate id is not a template). */
export function questTemplate(
  data: GameData,
  templateId: string,
): QuestTemplateDef | null {
  return data.quests.templates.find((t) => t.id === templateId) ?? null
}

/** The levels.json ultimateQuest and the level that carries it, or null. */
export function ultimateDef(
  data: GameData,
): { level: number; def: UltimateQuestDef } | null {
  for (const l of data.levels) {
    if (l.ultimateQuest) return { level: l.level, def: l.ultimateQuest }
  }
  return null
}

/** The ultimate quest def for this id, or null. */
function ultimateById(data: GameData, id: string): UltimateQuestDef | null {
  const u = ultimateDef(data)
  return u && u.def.id === id ? u.def : null
}

/** Template name, or puns.ultimateQuestName for the ultimate. */
export function questName(data: GameData, templateId: string): string {
  const t = questTemplate(data, templateId)
  if (t) return t.name
  if (ultimateById(data, templateId)) return data.puns.ultimateQuestName
  return templateId
}

/** A district's display name (districts.json flavour, "Registry Row"). */
function districtName(data: GameData, id: DistrictId | null): string {
  if (id === null) return ''
  return mapIndex(data).districtById[id]?.flavour ?? id
}

/** puns.quests line with `{district}` = the target's flavour. */
export function questFlavour(
  data: GameData,
  q: Pick<Quest, 'templateId' | 'target'>,
): string {
  const line = data.puns.quests[q.templateId] ?? ''
  return line.replaceAll('{district}', districtName(data, q.target))
}

/**
 * The reward in one line, the sim's single formatter (ticker, card, chip):
 * "+1 life + $150", "$150 + 5 satisfaction in Registry Row", "★ inspector
 * Vera", "free Metal detector", "Victory".
 */
export function rewardSummary(
  data: GameData,
  r: QuestReward,
  target: DistrictId | null,
): string {
  const parts: string[] = []
  if (r.victory) parts.push('Victory')
  if (r.lives > 0) parts.push(`+${r.lives} ${r.lives === 1 ? 'life' : 'lives'}`)
  if (r.cash > 0) parts.push(`$${r.cash}`)
  if (r.satisfaction > 0) {
    parts.push(
      `${r.satisfaction} satisfaction${target === null ? '' : ` in ${districtName(data, target)}`}`,
    )
  }
  if (r.star) parts.push(`★ ${r.star.role} ${r.star.name}`)
  if (r.voucher !== null) {
    const def = data.machines.checkers.find((c) => c.id === r.voucher)
    parts.push(`free ${def?.name ?? r.voucher}`)
  }
  return parts.length > 0 ? parts.join(' + ') : 'nothing'
}

/** Template entry for `level`: index min(level, len) − 1 (read at offer time). */
function scaled(v: LevelScaled, level: number): number {
  if (!Array.isArray(v)) return v
  return v[Math.max(0, Math.min(level, v.length) - 1)] ?? 0
}

/** The quest's time allowance in ticks (the card's "Time: 3 days"). */
export function questLimitTicks(
  data: GameData,
  q: Pick<Quest, 'templateId' | 'ultimate'>,
): number {
  if (q.ultimate) {
    const u = ultimateById(data, q.templateId)
    return u ? daysToTicks(u.days) : 0
  }
  const t = questTemplate(data, q.templateId)
  if (!t) return 0
  if (t.goal.kind === 'magicParcel') {
    return ticksFromS(data.parcels.magic.countdownS)
  }
  return daysToTicks(t.limitDays ?? 0)
}

/** The value sent in quest:progress (design-m7 §3.3). */
export function questValue(q: Quest): number {
  const pr = q.progress
  switch (pr.kind) {
    case 'deliveriesFrom':
    case 'deliveriesOfSize':
    case 'holdDecisions':
    case 'overseasCleared':
      return pr.count
    case 'satisfactionAtLeast':
      return pr.satisfaction
    case 'magicParcel':
      return pr.deliveredTick !== null && pr.onTime ? 1 : 0
    case 'tossStreak':
      return pr.streak
    case 'onTimeRateDay':
      return pr.deliveries
    case 'detectionAllStrains':
      return pr.minPct
    case 'ultimate':
      return pr.delivered
  }
}

const clamp01 = (x: number): number =>
  Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0

/** Ticks left: an offer until it expires (null: the ultimate), an active quest until its deadline. */
export function questTicksLeft(sim: Sim, q: Quest): number | null {
  const t = sim.state.tick
  if (q.status === 'offered') {
    return q.expiresTick === null ? null : Math.max(0, q.expiresTick - t)
  }
  return q.deadlineTick === null ? null : Math.max(0, q.deadlineTick - t)
}

/** The facade's 0..1 progress (design-m7 §3.3 column); an offer is 0. */
export function questProgress01(sim: Sim, q: Quest): number {
  if (q.status === 'offered') return 0
  const pr = q.progress
  const goal = Math.max(1, q.goal)
  switch (pr.kind) {
    case 'deliveriesFrom':
    case 'deliveriesOfSize':
    case 'holdDecisions':
    case 'overseasCleared':
      return clamp01(pr.count / goal)
    case 'tossStreak':
      return clamp01(pr.streak / goal)
    case 'ultimate':
      return clamp01(pr.delivered / goal)
    case 'satisfactionAtLeast': {
      if (q.goal <= pr.start) return pr.satisfaction >= q.goal ? 1 : 0
      return clamp01((pr.satisfaction - pr.start) / (q.goal - pr.start))
    }
    case 'magicParcel': {
      if (pr.deliveredTick !== null) return pr.onTime ? 1 : 0
      const total = ticksFromS(sim.data.parcels.magic.countdownS)
      return clamp01((questTicksLeft(sim, q) ?? 0) / Math.max(1, total))
    }
    case 'onTimeRateDay': {
      const g = questTemplate(sim.data, q.templateId)?.goal
      const rate = g?.kind === 'onTimeRateDay' ? g.rate : 1
      const pct = pr.deliveries > 0 ? pr.onTime / pr.deliveries : 0
      return clamp01(
        Math.min(1, pr.deliveries / goal, rate > 0 ? pct / rate : 1),
      )
    }
    case 'detectionAllStrains': {
      if (pr.sinceTick === null) return 0
      const g = questTemplate(sim.data, q.templateId)?.goal
      const hold = daysToTicks(
        g?.kind === 'detectionAllStrains' ? g.holdDays : 1,
      )
      return clamp01((sim.state.tick - pr.sinceTick) / Math.max(1, hold))
    }
  }
}

/** +n lives up to economy.lives.cap; `life:gained` when any; returns the lives gained. */
export function gainLives(
  sim: Sim,
  n: number,
  reason: 'magic' | 'quest',
): number {
  const eco = sim.state.economy
  const next = Math.min(sim.data.economy.lives.cap, eco.lives + n)
  const delta = next - eco.lives
  if (delta <= 0) return 0
  eco.lives = next
  sim.emit('life:gained', { lives: next, delta, reason })
  return delta
}

// Making quests -----------------------------------------------------------------------

function fillTicker(line: string, vars: Record<string, string>): string {
  let out = line
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v)
  return out
}

function initialProgress(
  sim: Sim,
  kind: QuestGoalKind,
  target: DistrictId | null,
): QuestProgress {
  switch (kind) {
    case 'deliveriesFrom':
    case 'deliveriesOfSize':
    case 'overseasCleared':
      return { kind, count: 0 }
    case 'satisfactionAtLeast': {
      const sat =
        target === null ? 0 : (sim.state.districts[target]?.satisfaction ?? 0)
      return { kind, start: sat, satisfaction: sat }
    }
    case 'magicParcel':
      return {
        kind,
        parcelId: null,
        origin: null,
        dest: null,
        deliveredTick: null,
        onTime: false,
      }
    case 'tossStreak':
      return { kind, streak: 0, best: 0 }
    case 'onTimeRateDay':
      return { kind, dayStartTick: 0, deliveries: 0, onTime: 0, bestPct: 0 }
    case 'holdDecisions':
      return { kind, count: 0, resets: 0 }
    case 'detectionAllStrains':
      return { kind, sinceTick: null, minPct: 0 }
    case 'ultimate':
      return { kind, delivered: 0, onTime: 0, malware: 0 }
  }
}

const NO_REWARD: QuestReward = {
  cash: 0,
  lives: 0,
  satisfaction: 0,
  star: null,
  voucher: null,
  victory: false,
}

/** The goal number of design-m7 §3.3 (level arrays read now). */
function goalOf(t: QuestTemplateDef, level: number): number {
  const g = t.goal
  switch (g.kind) {
    case 'deliveriesFrom':
    case 'tossStreak':
    case 'deliveriesOfSize':
    case 'holdDecisions':
    case 'overseasCleared':
      return scaled(g.count, level)
    case 'satisfactionAtLeast':
      return g.value
    case 'magicParcel':
      return 1
    case 'onTimeRateDay':
      return g.minDeliveries
    case 'detectionAllStrains':
      return Math.round(g.rate * 100)
  }
}

/** The reward with the level arrays read now; the magic parcel's from parcels.json magic. */
function rewardOf(
  data: GameData,
  t: QuestTemplateDef,
  level: number,
): QuestReward {
  if (t.goal.kind === 'magicParcel') {
    const m = data.parcels.magic
    return { ...NO_REWARD, cash: m.reward, lives: m.lives }
  }
  const r = t.reward ?? {}
  return {
    cash: r.cash === undefined ? 0 : scaled(r.cash, level),
    lives: r.lives ?? 0,
    satisfaction: r.satisfaction ?? 0,
    star: r.starApplicant ? structuredClone(r.starApplicant) : null,
    voucher: r.voucher ?? null,
    victory: false,
  }
}

function newQuest(
  sim: Sim,
  templateId: string,
  ultimate: boolean,
  kind: QuestGoalKind,
  target: DistrictId | null,
  goal: number,
  reward: QuestReward,
  expiresTick: Tick | null,
): Quest {
  const s = sim.state
  const id = `q${s.nextId.quest}`
  s.nextId.quest += 1
  return {
    id,
    templateId,
    ultimate,
    status: 'offered',
    target,
    goal,
    reward,
    offeredTick: s.tick,
    expiresTick,
    acceptedTick: null,
    deadlineTick: null,
    emittedValue: 0,
    progress: initialProgress(sim, kind, target),
  }
}

function makeQuest(
  sim: Sim,
  t: QuestTemplateDef,
  target: DistrictId | null,
): Quest {
  const level = sim.state.level.level
  const expires =
    sim.state.tick + daysToTicks(sim.data.quests.offer.offerExpiresDays)
  return newQuest(
    sim,
    t.id,
    false,
    t.goal.kind,
    target,
    goalOf(t, level),
    rewardOf(sim.data, t, level),
    expires,
  )
}

function makeUltimate(sim: Sim, def: UltimateQuestDef): Quest {
  return newQuest(
    sim,
    def.id,
    true,
    'ultimate',
    null,
    def.deliveries,
    { ...NO_REWARD, victory: true },
    null,
  )
}

/** Put `q` in the offer slot: `quest:offered`, then the ticker line. */
function offerQuest(sim: Sim, q: Quest): void {
  const s = sim.state
  s.quests.offer = q
  s.quests.lastOfferDay = s.day
  sim.emit('quest:offered', {
    questId: q.id,
    templateId: q.templateId,
    target: q.target,
    ultimate: q.ultimate,
  })
  sim.emit('ticker:news', {
    text: fillTicker(sim.data.puns.tickerQuest.offered, {
      name: questName(sim.data, q.templateId),
    }),
    kind: 'quest',
  })
}

function record(
  sim: Sim,
  q: Quest,
  outcome: QuestOutcome,
  reason: QuestFailReason | null,
): void {
  const h = sim.state.quests.history
  h.push({
    id: q.id,
    templateId: q.templateId,
    outcome,
    tick: sim.state.tick,
    reason,
  })
  if (h.length > QUEST_HISTORY_MAX) h.splice(0, h.length - QUEST_HISTORY_MAX)
}

/** Take the open offer down (record `withdrawn`, `quest:declined {withdrawn}`); no cooldown here. */
function withdrawOffer(
  sim: Sim,
  q: Quest,
  reason: QuestFailReason | null,
): void {
  record(sim, q, 'withdrawn', reason)
  sim.state.quests.offer = null
  sim.emit('quest:declined', {
    questId: q.id,
    templateId: q.templateId,
    reason: 'withdrawn',
  })
}

// Targets, conditions, eligibility ------------------------------------------------------

/** Parcels waiting (reserved or not — "unpicked") at a district's buildings. */
function waitingIn(sim: Sim, district: DistrictId): number {
  let n = 0
  for (const b of mapIndex(sim.data).buildingsByDistrict[district] ?? []) {
    n += sim.state.buildings[b.id]?.waiting.length ?? 0
  }
  return n
}

/** Live kind-'district' districts in districts.json order. */
function liveDistricts(sim: Sim): DistrictId[] {
  return sim.data.districts
    .filter((d) => d.kind === 'district' && sim.state.districts[d.id]?.live)
    .map((d) => d.id)
}

/**
 * The target district of a rule (state reads only, no draw):
 * mostWaiting — the most waiting parcels (ties → file order; none waiting →
 * no target); satisfactionBelow — satisfaction < arg, the HIGHEST first (the
 * one that can reach the goal, design Q20; ties → file order). `debug`
 * falls back to the first live district / the lowest satisfaction.
 */
function resolveTarget(
  sim: Sim,
  t: QuestTemplateDef,
  debug: boolean,
): DistrictId | null {
  const live = liveDistricts(sim)
  if (t.target === 'district:mostWaiting') {
    let best: DistrictId | null = null
    let most = 0
    for (const d of live) {
      const n = waitingIn(sim, d)
      if (n > most) {
        best = d
        most = n
      }
    }
    return best ?? (debug ? (live[0] ?? null) : null)
  }
  if (t.target === 'district:satisfactionBelow') {
    const sat = (d: DistrictId): number =>
      sim.state.districts[d]?.satisfaction ?? 0
    const arg = t.targetArg ?? 0
    let best: DistrictId | null = null
    for (const d of live) {
      if (sat(d) < arg && (best === null || sat(d) > sat(best))) best = d
    }
    if (best !== null || !debug) return best
    let low: DistrictId | null = null
    for (const d of live) if (low === null || sat(d) < sat(low)) low = d
    return low
  }
  return null
}

function conditionHolds(sim: Sim, t: QuestTemplateDef): boolean {
  const s = sim.state
  const c = t.condition
  if (c === undefined) return true
  if (c === 'livesBelowCap') return s.economy.lives < sim.data.economy.lives.cap
  const hub = /^hubLive:(.+)$/.exec(c)?.[1]
  return hub !== undefined && s.districts[hub]?.live === true
}

function requiresHolds(sim: Sim, t: QuestTemplateDef): boolean {
  if (t.requires === 'firstToss') return sim.state.lane.quarantine.count >= 1
  return true
}

/** A magic quest can run now: fewer than maxAlive magic parcels live and a route exists (no draw). */
function magicReady(sim: Sim, t: QuestTemplateDef): boolean {
  if (t.goal.kind !== 'magicParcel') return true
  const m = sim.data.parcels.magic
  if (sim.state.spawn.magicAlive >= m.maxAlive) return false
  return magicRoute(sim, t.goal.maxRoadTiles, false) !== null
}

interface Candidate {
  t: QuestTemplateDef
  target: DistrictId | null
}

/** Templates offerable now (quests.json order) with their resolved targets. */
export function eligibleTemplates(sim: Sim): Candidate[] {
  const level = sim.state.level.level
  const out: Candidate[] = []
  for (const t of sim.data.quests.templates) {
    if (t.unlockLevel > level) continue
    if (!conditionHolds(sim, t) || !requiresHolds(sim, t)) continue
    let target: DistrictId | null = null
    if (t.target !== undefined) {
      target = resolveTarget(sim, t, false)
      if (target === null) continue
    }
    if (!magicReady(sim, t)) continue
    out.push({ t, target })
  }
  return out
}

// The tick step ------------------------------------------------------------------------

/** The quest's template goal (null for the ultimate). */
function goalDef(sim: Sim, q: Quest): QuestTemplateDef['goal'] | null {
  return questTemplate(sim.data, q.templateId)?.goal ?? null
}

function isComplete(sim: Sim, q: Quest): boolean {
  const pr = q.progress
  switch (pr.kind) {
    case 'deliveriesFrom':
    case 'deliveriesOfSize':
    case 'holdDecisions':
    case 'overseasCleared':
      return pr.count >= q.goal
    case 'satisfactionAtLeast':
      return pr.satisfaction >= q.goal
    case 'magicParcel':
      return pr.deliveredTick !== null && pr.onTime
    case 'tossStreak':
      // `best`: a streak reached the goal even if a later Toss this tick reset it.
      return Math.max(pr.streak, pr.best) >= q.goal
    case 'onTimeRateDay':
      return false // judged when a full day closes (questsStep 1b)
    case 'detectionAllStrains': {
      const g = goalDef(sim, q)
      const hold = daysToTicks(
        g?.kind === 'detectionAllStrains' ? g.holdDays : 1,
      )
      return pr.sinceTick !== null && sim.state.tick - pr.sinceTick >= hold
    }
    case 'ultimate': {
      const u = ultimateById(sim.data, q.templateId)
      if (!u || pr.delivered < q.goal) return false
      return (
        pr.onTime / pr.delivered >= u.minOnTimeRate &&
        pr.malware <= u.maxMalwareDelivered
      )
    }
  }
}

/** Step 1 for the active quest: refresh, the day close, complete / fail, progress. */
function stepActive(sim: Sim, a: Quest, ctx: TickContext): void {
  const s = sim.state
  const data = sim.data
  const pr = a.progress
  // a. derived values
  if (pr.kind === 'satisfactionAtLeast' && a.target !== null) {
    pr.satisfaction = s.districts[a.target]?.satisfaction ?? pr.satisfaction
  } else if (pr.kind === 'detectionAllStrains') {
    const g = goalDef(sim, a)
    const rate = g?.kind === 'detectionAllStrains' ? g.rate : 1
    const rates = announcedStrains(s, data).map((x) => laneCatchRate(s.lane, x))
    const ok = rates.length > 0 && rates.every((d) => d >= rate)
    if (!ok) pr.sinceTick = null
    else if (pr.sinceTick === null) pr.sinceTick = s.tick
    pr.minPct = rates.length > 0 ? Math.round(100 * Math.min(...rates)) : 0
  }
  // b. a full day (tick − 600, tick] closed
  if (
    pr.kind === 'onTimeRateDay' &&
    ctx.dayBoundary &&
    s.tick > pr.dayStartTick
  ) {
    const g = goalDef(sim, a)
    const n = pr.deliveries
    const pct = n > 0 ? pr.onTime / n : 0
    if (g?.kind === 'onTimeRateDay' && n >= g.minDeliveries && pct >= g.rate) {
      completeQuest(sim, a)
      return
    }
    pr.bestPct = Math.max(pr.bestPct, Math.round(100 * pct))
    pr.deliveries = 0
    pr.onTime = 0
    pr.dayStartTick = s.tick
  }
  // c. completion (on the deadline tick it wins over the timeout)
  if (isComplete(sim, a)) {
    completeQuest(sim, a)
    return
  }
  // d. fails
  if (pr.kind === 'ultimate') {
    const u = ultimateById(data, a.templateId)
    if (u && pr.malware > u.maxMalwareDelivered) {
      failQuest(sim, a, 'malware')
      return
    }
  }
  if (a.deadlineTick !== null && s.tick > a.deadlineTick) {
    failQuest(sim, a, 'timeout')
    return
  }
  // e. progress
  const value = questValue(a)
  if (value !== a.emittedValue) {
    a.emittedValue = value
    sim.emit('quest:progress', { questId: a.id, value, target: a.goal })
  }
}

/** The ultimate quest sits in the offer or the active slot. */
function holdsUltimate(qs: QuestsState): boolean {
  return qs.offer?.ultimate === true || qs.active?.ultimate === true
}

/** Tick step 11 (after levels, before day). */
export function questsStep(sim: Sim, ctx: TickContext): void {
  if (!SIM_FEATURES.quests) return
  const s = sim.state
  if (s.economy.gameOver) return
  const qs = s.quests
  const offer = sim.data.quests.offer
  // 1. the active quest
  if (qs.active !== null) stepActive(sim, qs.active, ctx)
  // 2. offer expiry (as a Decline: declineCooldownDays, design Q8)
  const o = qs.offer
  if (o !== null && o.expiresTick !== null && s.tick >= o.expiresTick) {
    record(sim, o, 'expired', null)
    qs.offer = null
    qs.nextOfferTick = s.tick + daysToTicks(offer.declineCooldownDays)
    sim.emit('quest:declined', {
      questId: o.id,
      templateId: o.templateId,
      reason: 'expired',
    })
  }
  // 3. the ultimate quest from its level on (design Q15)
  const u = ultimateDef(sim.data)
  if (
    u !== null &&
    s.level.level >= u.level &&
    !s.economy.victory &&
    !holdsUltimate(qs) &&
    s.tick >= qs.ultimateNextTick
  ) {
    if (qs.offer !== null) withdrawOffer(sim, qs.offer, null)
    offerQuest(sim, makeUltimate(sim, u.def))
  }
  // 4. a regular offer (one quest-stream draw; none when nothing is eligible)
  //    — never while the ultimate is pending (its cooldown after a fail too)
  const ultimatePending =
    u !== null && s.level.level >= u.level && !s.economy.victory
  if (
    !ultimatePending &&
    qs.offer === null &&
    qs.active === null &&
    s.tick >= qs.nextOfferTick
  ) {
    // A weight-0 template is never drawn, so it never counts as eligible.
    const all = eligibleTemplates(sim).filter((c) => c.t.weight > 0)
    const last = qs.history.at(-1)?.templateId
    const fresh = all.filter((c) => c.t.id !== last)
    const pool = fresh.length > 0 ? fresh : all
    if (pool.length === 0) return
    const c = questRng(sim).weighted(pool, (x) => x.t.weight)
    if (c) offerQuest(sim, makeQuest(sim, c.t, c.target))
  }
}

// Completion and failure -------------------------------------------------------------------

/** A voucher: a free machine into the first empty live slot, else held for the BuySheet. */
function grantVoucher(sim: Sim, defId: string): void {
  const s = sim.state
  const def = sim.data.machines.checkers.find((c) => c.id === defId)
  if (!def) return
  const node = liveSlotIds(s.lane)
    .map((id) => laneNode(s.lane, id))
    .find((n) => n !== null && n.fixture === null)
  if (!node) {
    s.quests.vouchers.push(defId)
    return
  }
  const checker = machineChecker(def, `chk${s.nextId.checker}`, s.tick)
  s.nextId.checker += 1
  checker.price = 0 // a gift: removing it refunds nothing
  placeFixture(sim, node, { kind: 'machine', checker })
  sim.emit('lane:fixturePlaced', {
    nodeId: node.id,
    fixture: structuredClone({ kind: 'machine' as const, checker }),
  })
}

function completeQuest(sim: Sim, q: Quest): void {
  const s = sim.state
  const data = sim.data
  const qs = s.quests
  const r = q.reward
  record(sim, q, 'completed', null)
  qs.active = null
  scheduleAfterEnd(sim, q)
  // The ★ applicant's name as the pool will hold it (a staff clash gives
  // "Vera 2"): the event and the ticker line carry that name.
  const shown: QuestReward = structuredClone(r)
  if (shown.star) shown.star.name = starApplicantName(s, r.star!)
  sim.emit('quest:completed', {
    questId: q.id,
    templateId: q.templateId,
    reward: structuredClone(shown),
  })
  if (r.cash > 0) sim.credit(r.cash, 'quest', true)
  if (r.lives > 0) {
    gainLives(
      sim,
      r.lives,
      q.progress.kind === 'magicParcel' ? 'magic' : 'quest',
    )
  }
  if (r.satisfaction > 0 && q.target !== null) {
    changeSatisfaction(sim, q.target, r.satisfaction, 'other')
  }
  if (r.star) {
    const a = addStarApplicant(sim, r.star)
    sim.emit('ticker:news', {
      text: fillTicker(data.puns.tickerQuest.star, {
        name: a.name,
        role: a.role,
      }),
      kind: 'quest',
    })
  }
  if (r.voucher !== null) grantVoucher(sim, r.voucher)
  const name = questName(data, q.templateId)
  sim.emit('ticker:news', {
    text: fillTicker(data.puns.tickerQuest.completed, {
      name,
      reward: rewardSummary(data, shown, q.target),
    }),
    kind: 'quest',
  })
  if (r.victory) {
    s.economy.victory = true
    s.stats.victoryTick ??= s.tick // the first Victory (a debug re-run keeps it)
    sim.emit('ticker:news', {
      text: fillTicker(data.puns.tickerQuest.victory, {
        name,
        company: data.puns.companyName,
      }),
      kind: 'level',
    })
    sim.emit('game:victory', { day: s.day })
  }
}

/**
 * After a quest ends (complete, fail, abandon): the next regular offer waits
 * intervalDays. The ultimate's end never pulls an offer earlier (max) — after
 * a fail it comes back first (ultimateNextTick, and step 4 waits while it is
 * pending), after Victory the regular scheduler resumes intervalDays later.
 */
function scheduleAfterEnd(sim: Sim, q: Quest): void {
  const qs = sim.state.quests
  const next = sim.state.tick + daysToTicks(sim.data.quests.offer.intervalDays)
  qs.nextOfferTick = q.ultimate ? Math.max(qs.nextOfferTick, next) : next
}

/** Fail / abandon: no penalty (Q-B2-7); the next offer after the interval (ultimate: re-offered after the cooldown). */
function failQuest(sim: Sim, q: Quest, reason: QuestFailReason): void {
  const s = sim.state
  const data = sim.data
  const qs = s.quests
  record(sim, q, reason === 'abandoned' ? 'abandoned' : 'failed', reason)
  qs.active = null
  if (q.ultimate) {
    qs.ultimateNextTick =
      s.tick + daysToTicks(data.quests.offer.declineCooldownDays)
  }
  scheduleAfterEnd(sim, q)
  sim.emit('quest:failed', {
    questId: q.id,
    templateId: q.templateId,
    reason,
  })
  if (reason !== 'abandoned') {
    sim.emit('ticker:news', {
      text: fillTicker(data.puns.tickerQuest.failed, {
        name: questName(data, q.templateId),
      }),
      kind: 'questFailed',
    })
  }
}

// Commands ------------------------------------------------------------------------------

/** Accept the open offer (design-m7 §3.2). */
export function acceptQuest(sim: Sim, questId: string): CommandResult {
  if (!SIM_FEATURES.quests) return fail('locked')
  const s = sim.state
  const data = sim.data
  const qs = s.quests
  if (s.economy.gameOver) return fail('invalid')
  const o = qs.offer
  if (o === null || o.id !== questId) {
    const h = qs.history.findLast((x) => x.id === questId)
    const gone = h?.outcome === 'expired' || h?.outcome === 'withdrawn'
    return fail(gone ? 'quest-expired' : 'invalid')
  }
  if (qs.active !== null) return fail('quest-active')
  const pr = o.progress
  if (pr.kind === 'magicParcel') {
    const g = goalDef(sim, o)
    const route =
      g?.kind === 'magicParcel' &&
      s.spawn.magicAlive < data.parcels.magic.maxAlive
        ? magicRoute(sim, g.maxRoadTiles, true)
        : null
    if (route === null) {
      // Nothing can carry it now: the offer is withdrawn (logged for replay).
      withdrawOffer(sim, o, 'unavailable')
      qs.nextOfferTick =
        s.tick + daysToTicks(data.quests.offer.declineCooldownDays)
      return { ok: false, reason: 'quest-expired', applied: true }
    }
    o.status = 'active'
    o.acceptedTick = s.tick
    qs.offer = null
    qs.active = o
    const p = spawnMagicParcel(sim, route)
    pr.parcelId = p.id
    pr.origin = route.origin
    pr.dest = route.dest
    o.deadlineTick = p.spawnedTick + ticksFromS(data.parcels.magic.countdownS)
  } else {
    o.status = 'active'
    o.acceptedTick = s.tick
    qs.offer = null
    qs.active = o
    o.deadlineTick = s.tick + questLimitTicks(data, o)
    if (pr.kind === 'satisfactionAtLeast' && o.target !== null) {
      const sat = s.districts[o.target]?.satisfaction ?? 0
      pr.start = sat
      pr.satisfaction = sat
    } else if (pr.kind === 'onTimeRateDay') {
      // Only full days count: the next boundary (now, on a boundary tick).
      const day = TICKS_PER_DAY
      pr.dayStartTick =
        s.tick % day === 0 ? s.tick : (Math.floor(s.tick / day) + 1) * day
    }
  }
  sim.emit('quest:accepted', { questId: o.id, templateId: o.templateId })
  return OK
}

/** Decline the open offer (the ultimate is Later-only). */
export function declineQuest(sim: Sim, questId: string): CommandResult {
  if (!SIM_FEATURES.quests) return fail('locked')
  const s = sim.state
  const qs = s.quests
  if (s.economy.gameOver) return fail('invalid')
  const o = qs.offer
  if (o === null || o.id !== questId || o.ultimate) return fail('invalid')
  record(sim, o, 'declined', null)
  qs.offer = null
  qs.nextOfferTick =
    s.tick + daysToTicks(sim.data.quests.offer.declineCooldownDays)
  sim.emit('quest:declined', {
    questId: o.id,
    templateId: o.templateId,
    reason: 'declined',
  })
  return OK
}

/** Give up the active quest: a fail with `abandoned`, no penalty. */
export function abandonQuest(sim: Sim): CommandResult {
  if (!SIM_FEATURES.quests) return fail('locked')
  const s = sim.state
  if (s.economy.gameOver) return fail('invalid')
  const a = s.quests.active
  if (a === null) return fail('invalid')
  failQuest(sim, a, 'abandoned')
  return OK
}

/**
 * Debug builds (ViewSim.debug.offerQuest, `?quest=`): offer `templateId` now,
 * ignoring unlockLevel, condition, requires and the scheduler (targets still
 * resolve, with the debug fallbacks); an open offer is withdrawn first; the
 * ultimate id offers the ultimate at any level.
 */
export function debugOfferQuest(sim: Sim, templateId: string): CommandResult {
  if (!SIM_FEATURES.quests) return fail('locked')
  const s = sim.state
  const qs = s.quests
  const t = questTemplate(sim.data, templateId)
  const u = ultimateById(sim.data, templateId)
  if ((t === null && u === null) || s.economy.gameOver) return fail('invalid')
  if (qs.active !== null) return fail('quest-active')
  let target: DistrictId | null = null
  if (t !== null && t.target !== undefined) {
    target = resolveTarget(sim, t, true)
    if (target === null) return fail('invalid')
  }
  if (qs.offer !== null) withdrawOffer(sim, qs.offer, null)
  offerQuest(
    sim,
    t !== null ? makeQuest(sim, t, target) : makeUltimate(sim, u!),
  )
  return OK
}

// The observer ------------------------------------------------------------------------------

/** The golden parcel `id` was delivered at `tick`: on time when by the deadline (once). */
function recordMagicDelivery(
  tick: Tick,
  a: Quest,
  pr: Extract<QuestProgress, { kind: 'magicParcel' }>,
  id: number,
): void {
  if (id !== pr.parcelId || pr.deliveredTick !== null) return
  pr.deliveredTick = tick
  pr.onTime = a.deadlineTick !== null && tick <= a.deadlineTick
}

/**
 * Called by Sim.emit for every event, before the taps: the ACTIVE quest's
 * counters only (design-m7 §3.4 table). Never emits, draws or dispatches;
 * quest:* events and everything before Accept / after the quest left the
 * slot count for nothing. Game over stops the counters; only the golden
 * parcel's delivery is still recorded (the audit's "alive or delivered").
 */
export function observeQuestEvent<K extends SimEventName>(
  sim: Sim,
  name: K,
  payload: SimEventPayloads[K],
): void {
  if (!SIM_FEATURES.quests) return
  const s = sim.state
  const a = s.quests.active
  if (a === null) return
  const pr = a.progress
  if (s.economy.gameOver) {
    // Counting stops at game over, but the golden parcel's delivery is a
    // fact the quest must hold: the parcel itself is gone after gc, and a
    // continued run judges it on time or late from deliveredTick.
    if (name === 'parcel:delivered' && pr.kind === 'magicParcel') {
      recordMagicDelivery(
        s.tick,
        a,
        pr,
        (payload as SimEventPayloads['parcel:delivered']).id,
      )
    }
    return
  }
  switch (name) {
    case 'parcel:delivered': {
      const e = payload as SimEventPayloads['parcel:delivered']
      const p = s.parcels[String(e.id)] ?? null
      switch (pr.kind) {
        case 'deliveriesFrom':
          if (
            !e.malware &&
            p !== null &&
            a.target !== null &&
            districtOf(sim.data, p.origin) === a.target
          ) {
            pr.count += 1
          }
          return
        case 'deliveriesOfSize': {
          const g = goalDef(sim, a)
          if (
            !e.malware &&
            p !== null &&
            g?.kind === 'deliveriesOfSize' &&
            p.size === g.size
          ) {
            pr.count += 1
          }
          return
        }
        case 'onTimeRateDay':
          if (!e.malware && s.tick > pr.dayStartTick) {
            pr.deliveries += 1
            if (e.onTime) pr.onTime += 1
          }
          return
        case 'magicParcel':
          recordMagicDelivery(s.tick, a, pr, e.id)
          return
        case 'ultimate':
          if (e.malware) pr.malware += 1
          else {
            pr.delivered += 1
            if (e.onTime) pr.onTime += 1
          }
          return
        default:
          return
      }
    }
    case 'parcel:cleared': {
      const e = payload as SimEventPayloads['parcel:cleared']
      if (pr.kind === 'overseasCleared') {
        const g = goalDef(sim, a)
        if (!e.malware && g?.kind === 'overseasCleared' && e.hub === g.hub) {
          pr.count += 1
        }
      } else if (pr.kind === 'ultimate') {
        // A malware clearance costs a life: "malware delivered" (design Q13).
        if (e.malware) pr.malware += 1
        else {
          pr.delivered += 1
          if (e.onTime) pr.onTime += 1
        }
      }
      return
    }
    case 'parcel:tossed': {
      const e = payload as SimEventPayloads['parcel:tossed']
      if (pr.kind === 'tossStreak') {
        // A wrong Toss resets the streak (design Q1); the quest fails only on its deadline.
        if (e.wasMalware) {
          pr.streak += 1
          pr.best = Math.max(pr.best, pr.streak)
        } else pr.streak = 0
      } else if (pr.kind === 'holdDecisions') {
        pr.count += 1
      }
      return
    }
    case 'parcel:cleared_by_player':
      if (pr.kind === 'holdDecisions') pr.count += 1
      return
    case 'lane:stalled': {
      const e = payload as SimEventPayloads['lane:stalled']
      if (pr.kind !== 'holdDecisions' || e.reason !== 'holdBayFull') return
      const g = goalDef(sim, a)
      if (g?.kind === 'holdDecisions' && g.noStall) {
        // A full-bay stall resets the count (design Q2).
        pr.count = 0
        pr.resets += 1
      }
      return
    }
    default:
      return
  }
}
