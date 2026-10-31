// Quest text (spec-build2 §3.1–§3.4; design-m7 §6.2): the pure strings the
// QuestCard, the HUD quest chip, the district panel's quest row, the
// `QUEST COMPLETE` stamp and the newspaper read. Phaser- and DOM-free
// (tools/check-sim-purity.mjs PHASER_FREE) so Vitest loads it under Node
// (tests/ui/quest-text.test.ts).
//
// Time: an in-game day is TICKS_PER_DAY (60 s) and reads as 24 "hours", so
// one hour is 25 ticks: `2d 3h`, `23h`, `<1h`. The magic parcel's clock is
// real seconds (`1:58`, parcels.json magic.countdownS). The reward line is
// the sim's single formatter (rewardSummary, re-exported by the ViewSim).
// Every glyph used here is in m5x7: `—`, `·`, `▸`, `★` and `✕` (U+2715 —
// the spec's `✗` is not in the font, design-m7 Q11).
import type { GameData } from '../data/types.ts'
import type { BuildingId, DistrictId, QuestReward } from '../sim/types.ts'
import { TICKS_PER_DAY, TICKS_PER_S } from '../sim/types.ts'
import type { QuestsView, QuestView } from '../sim/view-api.ts'
import { rewardSummary } from '../sim/view-api.ts'
import { formatClock, formatMoney } from './text.ts'

/** The HUD day reads as 24 hours (one hour = 25 ticks = 2.5 s). */
export const HOURS_PER_DAY = 24
const TICKS_PER_HOUR = TICKS_PER_DAY / HOURS_PER_DAY
/** The magic countdown turns red under this many seconds (design-m7 §6.2). */
export const MAGIC_DANGER_S = 30
/** U+2715: the malware cross of the Golden Release chip (m5x7 has no ✗). */
export const CROSS = '✕'
export type QuestTone = 'light' | 'warn' | 'danger'

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`

const finite = (n: number): number => (Number.isFinite(n) ? n : 0)

// ---- time ---------------------------------------------------------------------

/**
 * Quest time left or allowed: `2d 3h` from one day up (h = floor(ticks %
 * 600 / 25)), `23h` below a day, `<1h` below an hour.
 */
export function formatQuestTime(ticks: number): string {
  const t = Math.max(0, Math.floor(finite(ticks)))
  if (t >= TICKS_PER_DAY) {
    const d = Math.floor(t / TICKS_PER_DAY)
    const h = Math.floor((t % TICKS_PER_DAY) / TICKS_PER_HOUR)
    return `${d}d ${h}h`
  }
  if (t < TICKS_PER_HOUR) return '<1h'
  return `${Math.floor(t / TICKS_PER_HOUR)}h`
}

/** The magic parcel's clock: `m:ss` of ticks / 10 (seconds round up). */
export function formatCountdown(ticks: number): string {
  return formatClock(Math.max(0, finite(ticks)) / TICKS_PER_S)
}

/** A quest's allowance: `3 days` / `1 day` on whole days, else formatQuestTime. */
export function formatQuestDays(ticks: number): string {
  const t = Math.max(0, Math.round(finite(ticks)))
  if (t > 0 && t % TICKS_PER_DAY === 0) return plural(t / TICKS_PER_DAY, 'day')
  return formatQuestTime(t)
}

/**
 * Ticks left at `tick`: an offer until it expires (null: the ultimate and,
 * since build 3, every job offer never expire — B3 §3.2), an active
 * quest until its deadline. Falls back to the view's own `ticksLeft`
 * (computed at the view's revision) without a tick.
 */
export function questTicksLeftAt(q: QuestView, tick?: number): number | null {
  if (tick === undefined || !Number.isFinite(tick)) return q.ticksLeft
  const end = q.status === 'offered' ? q.expiresTick : q.deadlineTick
  return end === null ? null : Math.max(0, end - tick)
}

// ---- lookups (data only; the sim's own lookups stay in the sim) -----------------

function templateGoal(data: GameData, templateId: string) {
  return data.quests.templates.find((t) => t.id === templateId)?.goal ?? null
}

function ultimateOf(data: GameData, templateId: string) {
  for (const l of data.levels) {
    if (l.ultimateQuest?.id === templateId) return l.ultimateQuest
  }
  return null
}

function districtName(data: GameData, id: DistrictId | null): string {
  if (id === null) return 'a district'
  return data.districts.find((d) => d.id === id)?.flavour ?? id
}

/** buildings.json name by id (the magic route's A and B). */
export function buildingNamer(
  data: Pick<GameData, 'buildings'>,
): (id: BuildingId) => string {
  return (id) => data.buildings.find((b) => b.id === id)?.name ?? id
}

// ---- card lines -----------------------------------------------------------------

/**
 * The objective in one sentence (design-m7 §6.2). The magic parcel names
 * its A and B once accepted (`Deliver the golden parcel: Registry Tower →
 * Node Heights Towers A in 2:00` — the arrow, not the design's `from … to`,
 * keeps every A/B pair of buildings.json within two 276-px lines); as an
 * offer it goes `across town`.
 */
export function objectiveText(
  data: GameData,
  q: QuestView,
  buildingName: (id: BuildingId) => string,
): string {
  const n = q.goal
  const target = q.targetName ?? districtName(data, q.target)
  switch (q.kind) {
    case 'deliveriesFrom':
      return `Deliver ${plural(n, 'parcel')} sent from ${target}`
    case 'satisfactionAtLeast':
      return `Bring ${target} to ${n} satisfaction`
    case 'magicParcel': {
      const t = formatCountdown(q.limitTicks)
      return q.route
        ? `Deliver the golden parcel: ${buildingName(q.route.origin)} → ${buildingName(q.route.dest)} in ${t}`
        : `Deliver the golden parcel across town in ${t}`
    }
    case 'tossStreak':
      return `Toss ${n} malware in a row — a clean parcel tossed resets it`
    case 'onTimeRateDay': {
      const g = templateGoal(data, q.templateId)
      const pct = g?.kind === 'onTimeRateDay' ? Math.round(g.rate * 100) : 100
      return `One full day at ${pct}% on time (${n}+ deliveries)`
    }
    case 'deliveriesOfSize': {
      const g = templateGoal(data, q.templateId)
      const size = g?.kind === 'deliveriesOfSize' ? `${g.size} ` : ''
      return `Deliver ${plural(n, `${size}parcel`)}`
    }
    case 'holdDecisions': {
      const g = templateGoal(data, q.templateId)
      const noStall = g?.kind === 'holdDecisions' ? g.noStall : false
      return noStall
        ? `Make ${plural(n, 'Hold Bay call')} without a full bay`
        : `Make ${plural(n, 'Hold Bay call')}`
    }
    case 'overseasCleared': {
      const g = templateGoal(data, q.templateId)
      const hub = g?.kind === 'overseasCleared' ? g.hub : q.target
      return `Clear ${plural(n, 'parcel')} through ${districtName(data, hub)}`
    }
    case 'detectionAllStrains': {
      const g = templateGoal(data, q.templateId)
      const days = g?.kind === 'detectionAllStrains' ? g.holdDays : 1
      const span = days === 1 ? 'a day' : plural(days, 'day')
      return `Hold ${n}% detection on every strain for ${span}`
    }
    case 'ultimate': {
      const u = ultimateOf(data, q.templateId)
      const days = u?.days ?? Math.round(q.limitTicks / TICKS_PER_DAY)
      const mal = u?.maxMalwareDelivered ?? 0
      const pct = Math.round((u?.minOnTimeRate ?? 1) * 100)
      const malware = mal === 0 ? 'no malware' : `at most ${mal} malware`
      return `In ${plural(days, 'day')}: ${n} deliveries, ${malware}, ${pct}% on time`
    }
  }
}

/**
 * `Reward: $150 + 5 satisfaction in Registry Row` (the sim's rewardSummary).
 * `withTarget` false drops the district (`… + 5 satisfaction`): the card
 * falls back to it when the full line overflows its row (Pasture Peer
 * Fields) — the objective names the district anyway.
 */
export function rewardText(
  data: GameData,
  q: Pick<QuestView, 'reward' | 'target'>,
  withTarget = true,
): string {
  return `Reward: ${rewardSummary(data, q.reward, withTarget ? q.target : null)}`
}

// ---- the HUD chip ----------------------------------------------------------------

/**
 * The chip bar's text (design-m7 §3.3 values): count kinds `4/10`,
 * satisfaction `58/60`, the magic clock `1:58`, `6/8 96%` for a day on time
 * (just the count before the first delivery), detection `93%`, the Golden
 * Release `41/60`. Rates floor, so a shown 95% is a reached 95%.
 */
export function chipProgressText(q: QuestView): string {
  const pr = q.progress
  switch (pr.kind) {
    case 'deliveriesFrom':
    case 'deliveriesOfSize':
    case 'holdDecisions':
    case 'overseasCleared':
      return `${pr.count}/${q.goal}`
    case 'tossStreak':
      return `${pr.streak}/${q.goal}`
    case 'satisfactionAtLeast':
      return `${Math.floor(finite(pr.satisfaction))}/${q.goal}`
    case 'magicParcel':
      return formatCountdown(
        q.status === 'active' ? (q.ticksLeft ?? 0) : q.limitTicks,
      )
    case 'onTimeRateDay': {
      if (pr.deliveries <= 0) return `0/${q.goal}`
      const pct = Math.floor((100 * pr.onTime) / pr.deliveries)
      return `${pr.deliveries}/${q.goal} ${pct}%`
    }
    case 'detectionAllStrains':
      return `${pr.minPct}%`
    case 'ultimate':
      return `${pr.delivered}/${q.goal}`
  }
}

/**
 * The chip's right-hand label and its tone: an offer shows its expiry
 * (none for the Golden Release); an active quest its time left (`warn` on
 * its last day); the magic parcel its `m:ss` clock (`danger` under 30 s);
 * the Golden Release `0✕ 94%` — malware delivered and the on-time rate
 * (`danger` with any malware, `warn` under levels.json minOnTimeRate when
 * `data` is given).
 */
export function chipLabel(
  q: QuestView,
  data?: GameData,
): { text: string; tone: QuestTone } {
  const left = q.ticksLeft
  if (q.status === 'offered') {
    return { text: left === null ? '' : formatQuestTime(left), tone: 'light' }
  }
  const pr = q.progress
  if (pr.kind === 'magicParcel') {
    const t = left ?? 0
    return {
      text: formatCountdown(t),
      tone: t < MAGIC_DANGER_S * TICKS_PER_S ? 'danger' : 'light',
    }
  }
  if (pr.kind === 'ultimate') {
    const pct =
      pr.delivered > 0 ? Math.floor((100 * pr.onTime) / pr.delivered) : 100
    const min = data ? ultimateOf(data, q.templateId)?.minOnTimeRate : undefined
    const tone: QuestTone =
      pr.malware > 0
        ? 'danger'
        : min !== undefined && pct < Math.round(min * 100)
          ? 'warn'
          : 'light'
    return { text: `${pr.malware}${CROSS} ${pct}%`, tone }
  }
  if (left === null) return { text: '', tone: 'light' }
  return {
    text: formatQuestTime(left),
    tone: left < TICKS_PER_DAY ? 'warn' : 'light',
  }
}

/**
 * The district panel's quest row (design-m7 §6.5): `Rush hour · 4/10 · 1d
 * 12h` while active (the magic clock in place of the time), `Job offer:
 * Rush hour ▸` while offered.
 */
export function questRowText(q: QuestView): string {
  if (q.status === 'offered') return `Job offer: ${q.name} ▸`
  const time =
    q.kind === 'magicParcel'
      ? null
      : q.ticksLeft === null
        ? null
        : formatQuestTime(q.ticksLeft)
  return [q.name, chipProgressText(q), time].filter(Boolean).join(' · ')
}

/**
 * The name of the quest that keeps `q` from being accepted: an offer (the
 * Golden Release, design-m7 §4) waits while another quest is active. Null
 * when `q` can be accepted.
 */
export function questBlockedBy(qs: QuestsView, q: QuestView): string | null {
  if (q.status !== 'offered') return null
  const a = qs.active
  return a && a.id !== q.id ? a.name : null
}

/**
 * The name of the offer waiting on the active quest `q` (the Golden Release
 * offered while a regular quest runs, design-m7 §4), or null. The chip and
 * the active card are the only way to it until the slot frees.
 */
export function questWaitingOn(qs: QuestsView, q: QuestView): string | null {
  if (q.status !== 'active') return null
  const o = qs.offer
  return o && o.id !== q.id ? o.name : null
}

/** The active card's line for an offer waiting on it (in the flavour row). */
export function waitingText(name: string): string {
  return `${name} is waiting — finish or abandon this job to take it.`
}

// ---- stamp and newspaper ---------------------------------------------------------

/** The reward's short pieces: `+1 life`, `+$150`, `+5 satisfaction`, `★ Vera`, `free Metal detector`. */
function rewardBits(data: GameData, r: QuestReward): string[] {
  const out: string[] = []
  if (r.lives > 0) out.push(`+${plural(r.lives, 'life', 'lives')}`)
  if (r.cash > 0) out.push(`+${formatMoney(r.cash)}`)
  if (r.satisfaction > 0) out.push(`+${r.satisfaction} satisfaction`)
  if (r.star) out.push(`★ ${r.star.name}`)
  if (r.voucher !== null) {
    const def = data.machines.checkers.find((c) => c.id === r.voucher)
    out.push(`free ${def?.name ?? r.voucher}`)
  }
  return out
}

/**
 * The gold stamp at the HUD money cell (spec-build2 §3.1): `QUEST COMPLETE
 * +$300`, `QUEST COMPLETE +1 life +$150`, `QUEST COMPLETE ★ Vera`; the Golden
 * Release `QUEST COMPLETE — VICTORY`.
 */
export function stampText(data: GameData, r: QuestReward): string {
  if (r.victory) return 'QUEST COMPLETE — VICTORY'
  return ['QUEST COMPLETE', ...rewardBits(data, r)].join(' ')
}

/** The line after `NAME DONE — ` per goal kind. */
function doneTail(data: GameData, q: QuestView): string {
  const target = q.targetName ?? districtName(data, q.target)
  switch (q.kind) {
    case 'deliveriesFrom':
      return `${target} is moving again`
    case 'satisfactionAtLeast':
      return `${target} is smiling again`
    case 'magicParcel':
      return 'the VIP got the golden parcel on time'
    case 'tossStreak':
      return `${q.goal} malware in a row, no false alarms`
    case 'onTimeRateDay':
      return 'a whole day on time'
    case 'deliveriesOfSize': {
      const g = templateGoal(data, q.templateId)
      const size = g?.kind === 'deliveriesOfSize' ? `${g.size} ` : ''
      return `${plural(q.goal, `${size}parcel`)} shipped`
    }
    case 'holdDecisions':
      return `${plural(q.goal, 'Hold Bay call')}, no backlog`
    case 'overseasCleared': {
      const g = templateGoal(data, q.templateId)
      const hub = g?.kind === 'overseasCleared' ? g.hub : q.target
      return `${plural(q.goal, 'parcel')} cleared at ${districtName(data, hub)}`
    }
    case 'detectionAllStrains':
      return 'every strain caught, all day long'
    case 'ultimate':
      return `${q.goal} deliveries, no malware`
  }
}

/**
 * The newspaper item of a completed quest (design-m7 §6.7): a ★ reward is a
 * `star` item (`Star inspector Vera wants to join (Clean sweep)`), the
 * Golden Release the puns tickerQuest.victory line, everything else a
 * `quest` item (`RUSH HOUR DONE — Registry Row is moving again: +$200`).
 */
export function newsHeadline(
  data: GameData,
  q: QuestView,
  r: QuestReward,
): { kind: 'quest' | 'star'; text: string } {
  if (r.star) {
    return {
      kind: 'star',
      text: `Star ${r.star.role} ${r.star.name} wants to join (${q.name})`,
    }
  }
  if (r.victory) {
    return {
      kind: 'quest',
      text: data.puns.tickerQuest.victory.replaceAll(
        '{company}',
        data.puns.companyName,
      ),
    }
  }
  const bits = rewardBits(data, r)
  const head = `${q.name.toUpperCase()} DONE — ${doneTail(data, q)}`
  return {
    kind: 'quest',
    text: bits.length ? `${head}: ${bits.join(' ')}` : head,
  }
}
