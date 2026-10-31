// HUD readouts and a tap-zone helper (city-view.md §4.1, §4.3, §4.4, §3.1;
// spec §3.5, §6.3, §8, §9.2, §9.4). The readouts are pure functions over the
// data tables and ViewSim values, so they are unit-tested under Node
// (tests/ui/hud.test.ts); Phaser is a type-only import. The display
// thresholds below are spec display rules (face icon, shield colour, trend
// glyph), not balance numbers: balance stays in src/data/*.json.
import type Phaser from 'phaser'
import type { GameData } from '../data/types.ts'
import type { FrameName } from '../render/frames.ts'
import type { MoneyReason } from '../sim/events.ts'
import type { Role, Size, VehicleType } from '../sim/types.ts'
import type { Trend, VehicleSnapshot } from '../sim/view-api.ts'
import { eventChoiceLine } from './effectText.ts'
import type { Rect } from './layout.ts'
import { CHECK, ellipsize, formatMoney } from './text.ts'
import { THEME } from './theme.ts'

/** spec §9.4: the HUD face is happy at ≥ 70, neutral at 40–69, angry below. */
export const MOOD_HAPPY_MIN = 70
export const MOOD_NEUTRAL_MIN = 40
/** spec §6.3: detection readout green ≥ 90, amber 70–89, red < 70. */
export const DETECTION_GREEN_MIN = 90
export const DETECTION_AMBER_MIN = 70
/** Tap travel above which a press is a drag, not a tap (notes §4). */
export const TAP_PX = 8

export const LIVES_TAP_TEXT =
  'Lives: a malware parcel delivered to a customer costs one'

export function moodFace(value: number): FrameName {
  if (value >= MOOD_HAPPY_MIN) return 'ic_mood_happy'
  if (value >= MOOD_NEUTRAL_MIN) return 'ic_mood_neutral'
  return 'ic_mood_angry'
}

/** Shield / detection colour (spec §6.3 thresholds) as a palette tint. */
export function detectionColour(pct: number): number {
  if (pct >= DETECTION_GREEN_MIN) return THEME.ok
  if (pct >= DETECTION_AMBER_MIN) return THEME.warn
  return THEME.danger
}

export function trendGlyph(trend: Trend): string {
  return trend === 'up' ? '▲' : trend === 'down' ? '▼' : '▬'
}

/** `Lv1 Scrappy` (levels.json title). */
export function levelLabel(data: GameData, level: number): string {
  const row = data.levels.find((l) => l.level === level)
  return row ? `Lv${level} ${row.title}` : `Lv${level}`
}

export interface LevelProgress {
  /** Bar fill 0..1. */
  frac: number
  /**
   * `$1,240 / $2,000` (+ ` · Lv 4 coming soon` below the last level at the
   * playtest cap); at the top level `$18,400 · Tycoon`, `· Tycoon ✓` after
   * the Victory (M9, design-m8-m9 §6.3).
   */
  text: string
  /**
   * The counter is held below an existing levels.json row by
   * economy.playtestMaxLevel (false at the top level: nothing is "coming").
   */
  atCap: boolean
}

/**
 * True when `level` sits at economy.playtestMaxLevel with a levels.json row
 * after it: the "Lv N coming soon" suffixes read this, so they vanish by data
 * once the cap rises (plan-build2 §8.2 task 11).
 */
export function cappedBelowNext(data: GameData, level: number): boolean {
  return (
    level >= data.economy.playtestMaxLevel &&
    data.levels.some((l) => l.level === level + 1)
  )
}

/**
 * The top level's name with the Victory mark: `Tycoon` / `Tycoon ✓`
 * (levels.json title of `level`; B2 §3.4, design-m8-m9 §6.3).
 */
export function topLevelName(
  data: GameData,
  level: number,
  victory: boolean,
): string {
  const title = data.levels.find((l) => l.level === level)?.title ?? ''
  const name = title || `Lv ${level}`
  return victory ? `${name} ${CHECK}` : name
}

/**
 * The level bar (city-view §4.1, spec §8): lifetime earned between this
 * level's threshold and `nextThreshold`. At `playtestMaxLevel` the bar keeps
 * counting toward the next row's threshold and says "Lv N coming soon" —
 * unless `compact` (M7, design-m7 §6.4: the quest chip shortens the bar, so
 * the suffix goes and the HUD ellipsizes the rest to the bar). At the top
 * level (`nextThreshold` null: no row after it, nothing "coming") the full
 * bar reads `$18,400 · Tycoon`, `$18,400 · Tycoon ✓` once the Golden Release
 * is done (`victory`, endless mode — M9, design-m8-m9 §6.3); the compact bar
 * (98 px at 360 beside the chip) shortens it to `$18,400` / `$18,400 ✓`.
 */
export function levelProgress(
  data: GameData,
  level: number,
  lifetime: number,
  nextThreshold: number | null,
  opts: { compact?: boolean; victory?: boolean } = {},
): LevelProgress {
  const atCap = cappedBelowNext(data, level)
  const base = data.levels.find((l) => l.level === level)?.threshold ?? 0
  if (nextThreshold === null) {
    const money = formatMoney(lifetime)
    const victory = opts.victory === true
    // Compact (98 px at 360 beside the chip — endless mode keeps offering
    // quests): the label left of the bar already says `Lv5 Tycoon`, so the
    // bar keeps only the money and the mark (`$18,400 ✓`).
    const text = opts.compact
      ? victory
        ? `${money} ${CHECK}`
        : money
      : `${money} · ${topLevelName(data, level, victory)}`
    return { frac: 1, text, atCap }
  }
  const span = nextThreshold - base
  const raw = span > 0 ? (lifetime - base) / span : 1
  const frac = Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 0))
  let text = `${formatMoney(lifetime)} / ${formatMoney(nextThreshold)}`
  if (atCap && !opts.compact) text += ` · Lv ${level + 1} coming soon`
  return { frac, text, atCap }
}

/** The tap toast's endless-mode tail after the Victory (B2 §3.4, M9). */
export const ENDLESS_TAIL = 'endless mode'

/**
 * The level cell's tap toast: `Lv 2: Hoist Hill + trucks + Shaky shaker`
 * from the next levels.json row (region flavour names, vehicle names,
 * machine names); `Lv 4 coming soon` at a playtest cap below the last row.
 * At the top level (M9, design-m8-m9 §6.3): `Tycoon — top level`, and
 * `Tycoon ✓ — endless mode` after the Victory.
 */
export function nextUnlockLine(
  data: GameData,
  level: number,
  victory = false,
): string {
  const row = data.levels.find((l) => l.level === level + 1)
  if (!row) {
    const name = topLevelName(data, level, victory)
    return victory ? `${name} — ${ENDLESS_TAIL}` : `${name} — top level`
  }
  if (cappedBelowNext(data, level)) return `Lv ${level + 1} coming soon`
  const parts: string[] = []
  for (const id of row.unlockRegions) {
    const d = data.districts.find((x) => x.id === id)
    parts.push(d?.flavour ?? id)
  }
  for (const id of row.vehicles) {
    const v = data.vehicles.types.find((t) => t.id === id)
    parts.push(`${(v?.name ?? id).toLowerCase()}s`)
  }
  const machines = [
    ...data.machines.checkers,
    ...data.machines.upgrades,
  ] as readonly { id: string; name: string }[]
  for (const id of row.machines) {
    parts.push(machines.find((m) => m.id === id)?.name ?? id)
  }
  return parts.length > 0
    ? `Lv ${row.level}: ${parts.join(' + ')}`
    : `Lv ${row.level}`
}

/** The money cell's tap toast. */
export function moneyTapText(lifetime: number, payrollPerDay: number): string {
  return `Lifetime earned ${formatMoney(lifetime)} · Payroll ${formatMoney(payrollPerDay)}/day`
}

/** spec §3.5: "Hoist Hill — unlocks at Lv 2". */
export function lockedRegionText(data: GameData, districtId: string): string {
  const d = data.districts.find((x) => x.id === districtId)
  if (!d) return 'Locked'
  return `${d.flavour} — unlocks at Lv ${d.unlockLevel}`
}

/** money:changed reasons that float gold next to the money cell (§3.1). */
const GOLD_REASONS: ReadonlySet<MoneyReason> = new Set<MoneyReason>([
  'delivery',
  'clearance',
  'bounty',
  'quest',
  'refund',
])
/** Reasons that count as earned for the daily ticker summary. */
const EARNED_REASONS: ReadonlySet<MoneyReason> = new Set<MoneyReason>([
  'delivery',
  'clearance',
  'bounty',
  'quest',
])

export function floatsGold(reason: MoneyReason): boolean {
  return GOLD_REASONS.has(reason)
}

/**
 * The money float a delta joins (final review, mobile #2): earnings (gold),
 * other income and costs float separately; deltas of one kind inside a
 * float's lifetime add up in that one float instead of printing on top of
 * each other.
 */
export type FloatKind = 'gold' | 'plus' | 'minus'

export function floatKind(delta: number, gold: boolean): FloatKind {
  return gold ? 'gold' : delta < 0 ? 'minus' : 'plus'
}

/**
 * x of a new money float `w` wide: `base` (after the balance), or after the
 * floats still on screen (`live`, + `gap`) so two kinds sit side by side;
 * kept to end by `maxRight` (the lives cell), as a lone float always was.
 */
export function floatX(
  base: number,
  live: readonly { x: number; w: number }[],
  w: number,
  maxRight: number,
  gap = 4,
): number {
  const after = live.reduce((r, f) => Math.max(r, f.x + f.w + gap), base)
  return Math.min(after, maxRight - w)
}

export function isEarned(reason: MoneyReason): boolean {
  return EARNED_REASONS.has(reason)
}

// ---- chips row (city-view §4.4) ---------------------------------------------

export interface ChipEntry {
  /** map.json regions[].id ('warehouse' = HQ). */
  id: string
  label: string
  /** The next region to unlock: drawn with the lock and `Lv N`. */
  lockLevel: number | null
}

/**
 * `HQ` + every live region by `chipLabel` (map.json order) + the regions
 * that unlock at the next level (lock + `Lv N`).
 */
export function chipEntries(
  data: GameData,
  level: number,
  regionState: (id: string) => 'locked' | 'live',
): ChipEntry[] {
  const out: ChipEntry[] = []
  for (const r of data.map.regions) {
    if (r.id === 'warehouse') {
      out.push({ id: r.id, label: r.chipLabel, lockLevel: null })
      continue
    }
    const d = data.districts.find((x) => x.id === r.id)
    if (!d) continue
    if (regionState(r.id) === 'live')
      out.push({ id: r.id, label: r.chipLabel, lockLevel: null })
    else if (d.unlockLevel === level + 1)
      out.push({ id: r.id, label: r.chipLabel, lockLevel: d.unlockLevel })
  }
  return out
}

// ---- bottom bar --------------------------------------------------------------

/** Speed segment shown as active: 0 = ❚❚, 1 = 1×, 2 = 2× (also 4× debug). */
export function speedSegment(paused: boolean, speed: number): 0 | 1 | 2 {
  if (paused || speed <= 0) return 0
  return speed === 1 ? 1 : 2
}

/**
 * Garage badge (§4.3, §9.7): `!` while a driver is unpaid, a vehicle has no
 * driver (inactive, or walked out and finishing its trip), or the last
 * payday was short (`payroll().short`: an unpaid inspector also raises it,
 * the Garage header's red payroll line says why).
 */
export function garageAlert(
  vehicles: readonly Pick<VehicleSnapshot, 'unpaid' | 'state' | 'driverName'>[],
  payrollShort = false,
): boolean {
  return (
    payrollShort ||
    vehicles.some(
      (v) => v.unpaid || v.state === 'inactive' || v.driverName === null,
    )
  )
}

/**
 * Vehicle types unlocked after level 1 that are now unlocked and affordable
 * and not yet announced with the Garage `+` badge (§4.3).
 */
export function newlyAffordableTypes(
  data: GameData,
  level: number,
  money: number,
  seen: ReadonlySet<VehicleType>,
): VehicleType[] {
  return data.vehicles.types
    .filter(
      (t) =>
        t.unlockLevel > 1 &&
        t.unlockLevel <= level &&
        t.price <= money &&
        !seen.has(t.id),
    )
    .map((t) => t.id)
}

// ---- M3 ticker lines and toasts (city-view §8.1, §9.7) -----------------------

/** `region` kind: `Hoist Hill is now open` (districts.json flavour). */
export function regionOpenLine(data: GameData, district: string): string {
  const d = data.districts.find((x) => x.id === district)
  return `${d?.flavour ?? district} is now open`
}

/** `strain` kind: `New strain spotted: rattle` (after newStrainDelayS). */
export function strainLine(strain: string): string {
  return `New strain spotted: ${strain}`
}

/**
 * `mood` kind (§9.2 thresholds, economy.satisfaction loudBelow / happyAbove):
 * `Node Heights is grumbling` when the value drops below loudBelow,
 * `Registry Row loves the service` when it rises to happyAbove; null when no
 * threshold was crossed by this change.
 */
export function moodLine(
  data: GameData,
  district: string,
  value: number,
  delta: number,
): string | null {
  const s = data.economy.satisfaction
  const d = data.districts.find((x) => x.id === district)
  if (!d) return null
  const prev = value - delta
  if (prev >= s.loudBelow && value < s.loudBelow)
    return `${d.flavour} is grumbling`
  if (prev < s.happyAbove && value >= s.happyAbove)
    return `${d.flavour} loves the service`
  return null
}

/**
 * Payday toast `Payday — payroll −$28` with the amount drawn red from
 * `redFrom` (city-view §9.7: "number red").
 */
export function paydayToast(amount: number): { text: string; redFrom: number } {
  const head = 'Payday — payroll '
  return { text: head + formatMoney(-Math.abs(amount)), redFrom: head.length }
}

/** `Payroll short: Audrey unpaid` / `Payroll short: Audrey, Dee unpaid`. */
export function payrollShortLine(names: readonly string[]): string {
  return `Payroll short: ${names.join(', ')} unpaid`
}

/**
 * Walkout line (§8.1 `payroll`): `Audrey walked out — desk short-handed` /
 * `Dee walked out — Bike 2 has no driver` / (M6) `Pat walked out — the Hold
 * Bay has no sorter`.
 */
export function walkoutLine(
  name: string,
  role: Role,
  vehicleName: string | null,
): string {
  if (role === 'driver')
    return `${name} walked out — ${vehicleName ?? 'a vehicle'} has no driver`
  if (role === 'sorter')
    return `${name} walked out — the Hold Bay has no sorter`
  return `${name} walked out — desk short-handed`
}

/**
 * M6 (plan-build2 §8.3 task 10, design-m6 §6.3): the HUD toast for a new
 * inspector or sorter, `Lin hired — $24/day` (drivers toast from the Garage
 * buy / Replace flow, re-hires from their card).
 */
export function hiredToast(name: string, salaryPerDay: number): string {
  return `${name} hired — ${formatMoney(salaryPerDay)}/day`
}

/** The worker:hired events the HUD toasts: a new inspector or sorter. */
export function hiredToastsFor(p: { role: Role; rehire: boolean }): boolean {
  return !p.rehire && (p.role === 'inspector' || p.role === 'sorter')
}

/** `Lin let go` — the HUD toast for a fired inspector or sorter (M6). */
export function firedToast(name: string): string {
  return `${name} let go`
}

/**
 * The worker:fired events the HUD toasts: an inspector or sorter the player
 * fired (a replaced sorter is covered by the new hire's toast, a removed
 * desk by its confirm dialog, drivers by the Garage flow).
 */
export function firedToastsFor(p: { role: Role; reason: string }): boolean {
  return p.reason === 'fired' && (p.role === 'inspector' || p.role === 'sorter')
}

/**
 * The `defused` ticker line of a Toss by a delegate (M6, parcel:tossed
 * source): `Pat tossed evil-lodash — DEFUSED`; the Sorter Arm (M9 art, M6
 * rule) reads `The Sorter Arm tossed evil-lodash — DEFUSED`. Player tosses
 * keep Ticker.defusedLine.
 */
export function delegateDefusedLine(who: string | null, label: string): string {
  return `${who ?? 'The Sorter Arm'} tossed ${label} — DEFUSED`
}

/** `Audrey`, `Audrey and Dee`, `Audrey, Dee and Pax`. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Several walkouts on one payday make one toast and one paper:
 * `Audrey, Dee and Pax walked out — unpaid 2 paydays running`
 * (employees.json walkoutAfterUnpaidPaydays).
 */
export function walkoutGroupLine(
  names: readonly string[],
  paydays: number,
): string {
  return `${joinNames(names)} walked out — unpaid ${paydays} paydays running`
}

// ---- M7 quests (spec-build2 §3, design-m7 §6.5) -------------------------------

/**
 * `life:gained` toast: `+1 life — 4 of 5` (economy.lives.cap). A gain of
 * several reads `+2 lives — 5 of 5`.
 */
export function lifeGainedToast(
  lives: number,
  delta: number,
  cap: number,
): string {
  const d = Math.max(1, Math.round(delta))
  return `+${d} ${d === 1 ? 'life' : 'lives'} — ${Math.round(lives)} of ${cap}`
}

/** What decides whether a new offer opens its QuestCard by itself. */
export interface QuestAutoOpen {
  /** Entries on the shared modal stack (sheets, popovers, cards, dialogs). */
  modals: number
  /** The onboarding step on screen, or null. */
  onboardingStep: number | null
  view: 'city' | 'warehouse'
  /** The sim is held (a lost-life / game-over / victory / Paused card…). */
  held: boolean
  /** A newspaper is on screen, queued or held (the card would cover it). */
  paperVisible: boolean
  /** The Golden Release is offered while a regular quest is still active. */
  blocked: boolean
  /** An offer found at create / sync (a reload, `?quest=`): ignores the tour. */
  force: boolean
  /**
   * A scripted policy drives the stepper (?policy=1): it answers every offer
   * itself, so a card would only follow the quest and stay up.
   */
  policy: boolean
}

/**
 * The chips row scroll (≤ 0) that brings the span [left, right) — a chip and
 * its NEW badge, in row coordinates — inside the visible row [x0, x0 +
 * maxRowW) with the least movement (final review, mobile #1: the L5 chips
 * unlocked off-screen at 393 / 360). The result still needs the row clamp.
 */
export function chipRevealScroll(
  scroll: number,
  x0: number,
  maxRowW: number,
  left: number,
  right: number,
): number {
  let s = scroll
  if (right + s > x0 + maxRowW) s = x0 + maxRowW - right
  if (left + s < x0) s = x0 - left
  return Math.min(0, s)
}

/** Which ends of the chips row hide chips at `scroll` (the edge arrows). */
export function chipOverflow(
  scroll: number,
  rowW: number,
  maxRowW: number,
): { left: boolean; right: boolean } {
  return {
    left: Math.round(scroll) < 0,
    right: Math.round(rowW + scroll) > maxRowW,
  }
}

/**
 * A save written on the victory tick (final review, scenes #2): HudScene
 * saves right after `game:victory` and holds the sim while the VictoryCard
 * is up, so a save whose tick is within `slack` ticks of stats.victoryTick
 * (the HUD passes two frames' worth of the stepper's MAX_TICKS_PER_FRAME:
 * ticks after the event in the saved frame, and a frame between Continue on
 * the Title and the HUD's create) was written before Continue was tapped: a
 * reload of it reopens the card. Once endless play has run, later autosaves are past
 * the slack and the card stays closed. Never after a game over.
 */
export function victoryCardPending(
  q: { victory: boolean; victoryTick: number | null },
  tick: number,
  gameOver: boolean,
  slack: number,
): boolean {
  if (!q.victory || gameOver || q.victoryTick === null) return false
  const d = tick - q.victoryTick
  return d >= 0 && d <= slack
}

/**
 * design-m7 §6.5: a new offer opens the card in `offer` mode only when
 * nothing modal is up, no onboarding step shows (unless forced), the city is
 * the view (in the room the chip pulses instead — the card would cover the
 * lane), nothing holds the sim, no paper is up and it is not the blocked
 * ultimate. Otherwise the chip pulses and the HUD retries next frame. Never
 * while a policy drives the stepper (?policy=1).
 */
export function questCardAutoOpens(o: QuestAutoOpen): boolean {
  if (o.policy) return false
  if (o.blocked || o.held || o.modals > 0 || o.paperVisible) return false
  if (o.view !== 'city') return false
  return o.force || o.onboardingStep === null
}

/** audio:nowPlaying {title} toast (audio.md §3 item 8; m5x7 has no ♪). */
export function nowPlayingText(title: string): string {
  return `Now playing: ${title}`
}

/** The mute button's hint while the audio waits for its first tap (skipTitle). */
export const TAP_FOR_SOUND_TEXT = 'Tap for sound'

/** The strains whose announcement delay has run out at `tick` (spec §5.4, §8). */
export function strainsLive(
  announced: Partial<Record<string, number>>,
  tick: number,
  delayTicks: number,
): string[] {
  return Object.entries(announced)
    .filter(([, t]) => t !== undefined && tick >= t + delayTicks)
    .map(([s]) => s)
}

// ---- follow strip (city-view §2, spec §4.6) ---------------------------------

const SIZES: readonly Size[] = ['S', 'M', 'L', 'XL']

/** The §4.6 state as shown in the follow strip (`Delivering · 2 stops`). */
export function vehicleStateText(
  v: Pick<VehicleSnapshot, 'state' | 'queuePos' | 'stopsLeft'>,
): string {
  switch (v.state) {
    case 'idle_lot':
      return 'Idle'
    case 'collecting':
      return 'Collecting'
    case 'returning':
      return 'Returning'
    case 'queued':
      return v.queuePos === null ? 'Queued' : `Queued #${v.queuePos + 1}`
    case 'docked_unloading':
      return 'Unloading'
    case 'docked_loading':
      return 'Loading'
    case 'delivering': {
      const n = v.stopsLeft
      if (n <= 0) return 'Delivering'
      return `Delivering · ${n} ${n === 1 ? 'stop' : 'stops'}`
    }
    case 'inactive':
      return 'No driver'
  }
  return ''
}

/** `Bike 1 · Dee · Delivering · 2 stops` (`Bike 2 · No driver` when inactive). */
export function followText(
  v: Pick<
    VehicleSnapshot,
    'name' | 'driverName' | 'state' | 'queuePos' | 'stopsLeft'
  >,
): string {
  if (v.state === 'inactive' || v.driverName === null)
    return `${v.name} · No driver`
  return `${v.name} · ${v.driverName} · ${vehicleStateText(v)}`
}

/** The follow strip's speed pips: 5 dots (`ic_pip_on` / `ic_pip_off`), 7-px pitch. */
export const FOLLOW_PIPS = 5
export const FOLLOW_PIP_PITCH = 7
/** Air left of the first pip and right of the last one's 7-px cell. */
export const FOLLOW_PIP_GAP_L = 4
export const FOLLOW_PIP_GAP_R = 2
/** The pips block between the head and the tail text. */
export const FOLLOW_PIPS_W =
  FOLLOW_PIP_GAP_L + FOLLOW_PIPS * FOLLOW_PIP_PITCH + FOLLOW_PIP_GAP_R

/**
 * The follow strip parts that fit `maxW` px (`measure` = BitmapText width):
 * everything; else the tail ellipsized (dropped when only `…` would be
 * left); else the head alone, ellipsized, without pips.
 */
export function followFit(
  m: { head: string; pips: number | null; tail: string },
  maxW: number,
  measure: (s: string) => number,
): { head: string; pips: boolean; tail: string } {
  const headW = measure(m.head)
  if (m.pips === null) {
    const all = m.tail ? `${m.head} ${m.tail}` : m.head
    return { head: ellipsize(all, maxW, measure), pips: false, tail: '' }
  }
  if (headW + FOLLOW_PIPS_W > maxW)
    return { head: ellipsize(m.head, maxW, measure), pips: false, tail: '' }
  const room = maxW - headW - FOLLOW_PIPS_W
  if (!m.tail || measure(m.tail) <= room)
    return { head: m.head, pips: true, tail: m.tail }
  const tail = ellipsize(m.tail, room, measure)
  // `· …` alone says nothing: drop it.
  const useful = tail.replace(/[·…\s]/g, '').length > 0
  return { head: m.head, pips: true, tail: useful ? tail : '' }
}

/**
 * M6 (spec-build2 §2.5, design-m6 §6.3): the follow strip in three parts,
 * `Bike 1 · Dee` + the driver's speed pips (●●●●○) + `· Delivering · 2
 * stops`; `pips` is null (and `tail` empty) with no active driver
 * (`Bike 2 · No driver`). Speed only: the strip is one line.
 */
export function followModel(
  v: Pick<
    VehicleSnapshot,
    'name' | 'driverName' | 'driverPips' | 'state' | 'queuePos' | 'stopsLeft'
  >,
): { head: string; pips: number | null; tail: string } {
  if (v.state === 'inactive' || v.driverName === null)
    return { head: `${v.name} · No driver`, pips: null, tail: '' }
  const speed = v.driverPips?.speed
  return {
    head: `${v.name} · ${v.driverName}`,
    pips:
      speed === undefined
        ? null
        : Math.max(0, Math.min(FOLLOW_PIPS, Math.round(speed))),
    tail: `· ${vehicleStateText(v)}`,
  }
}

/** Cargo counts by size, in S, M, L, XL order, zero sizes omitted. */
export function cargoCounts(
  cargo: readonly { size: Size }[],
): { size: Size; n: number }[] {
  const n: Record<Size, number> = { S: 0, M: 0, L: 0, XL: 0 }
  for (const c of cargo) n[c.size]++
  return SIZES.filter((s) => n[s] > 0).map((size) => ({ size, n: n[size] }))
}

// ---- build 3 M12: the event card on the HUD (B3 §3.4) ---------------------------

/**
 * What decides whether a pending event card (the sim's open card, not yet on
 * screen) opens now. There is no HUD hold while a card only waits (D-M12-5:
 * paperSuppressed reads `holds`, so a held pending card and a waiting paper
 * would deadlock) — the sim holds itself and the event chip pulses.
 */
export interface EventOpenGate {
  /** A scripted policy drives the stepper: it decides the card on its step. */
  policy: boolean
  /** The EventCard already shows a card. */
  showing: boolean
  gameOver: boolean
  /** Entries on the shared modal stack (sheets, popovers, cards, dialogs). */
  modals: number
  /** A HUD hold other than 'event' (lost life, game over, hidden, rotate, summary, victory). */
  otherHolds: boolean
  /** A lost-life / game-over / victory lead-in timer runs. */
  timers: boolean
  /**
   * A newspaper is on screen — only a visible one: queued papers wait behind
   * the card (D-M12-4), so lost life → EventCard → papers.
   */
  paperVisible: boolean
  /** The level-up moment (the 2.4-s stamp hold or the bar's refill sweep; R34). */
  levelMoment: boolean
  /** The Golden Release's gold card would open now: it goes first (R34, critique 3). */
  questFirst: boolean
}

/** True when nothing in `g` stops the pending card from opening. */
export function eventCardOpens(g: EventOpenGate): boolean {
  return (
    !g.policy &&
    !g.showing &&
    !g.gameOver &&
    g.modals === 0 &&
    !g.otherHolds &&
    !g.timers &&
    !g.paperVisible &&
    !g.levelMoment &&
    !g.questFirst
  )
}

/** One HUD-cell pulse leg (down, then back up): 2 × 120 ms (Reigns' meter dots). */
export const EVENT_PULSE_MS = 120
/** The pulse's lowest alpha (at the middle of the 240 ms). */
export const EVENT_PULSE_MIN_ALPHA = 0.3
/**
 * B3 §3.4 presentation thresholds (UI constants, not balance — D-M12-9): the
 * bell rings on a gain of at least $100, and a decision that moved at least
 * $100 gets a newspaper item.
 */
export const EVENT_BELL_MIN_MONEY = 100
export const EVENT_NEWS_MIN_MONEY = 100

/** The HUD cells and counts a decision can move, read just before and after it. */
export interface CellSnapshot {
  money: number
  lives: number
  /** meanSatisfaction(), unrounded (critique 14: +2 on one district moves no rounded mean). */
  mood: number
  /** lifetimeEarned (the level bar). */
  earned: number
  vehicles: number
  workers: number
  /** Chain links waiting (events().scheduledCount): a link that schedules its next one raises it. */
  scheduled: number
}

/** after − before, field by field (mood unrounded). */
export type CellDiff = CellSnapshot

export function cellDiff(before: CellSnapshot, after: CellSnapshot): CellDiff {
  return {
    money: after.money - before.money,
    lives: after.lives - before.lives,
    mood: after.mood - before.mood,
    earned: after.earned - before.earned,
    vehicles: after.vehicles - before.vehicles,
    workers: after.workers - before.workers,
    scheduled: after.scheduled - before.scheduled,
  }
}

export type PulseCell = 'money' | 'lives' | 'mood' | 'level'

/** Below this a mood difference is float noise, not an effect. */
const MOOD_EPS = 1e-9

/** The top-bar cells a decision moved (money, lives, mood, the level bar), in bar order. */
export function pulsedCells(d: CellDiff): PulseCell[] {
  const out: PulseCell[] = []
  if (d.money !== 0) out.push('money')
  if (d.lives !== 0) out.push('lives')
  if (Math.abs(d.mood) > MOOD_EPS) out.push('mood')
  if (d.earned !== 0) out.push('level')
  return out
}

/**
 * The decision's sound (B3 §3.4; `tap` is the button's own ui:tap): `wah`
 * when it cost a life, a vehicle or a worker; else `bell` on a gain of at
 * least $100 or a life; else none.
 */
export function decisionSfx(d: CellDiff): 'wah' | 'bell' | null {
  if (d.lives < 0 || d.vehicles < 0 || d.workers < 0) return 'wah'
  if (d.money >= EVENT_BELL_MIN_MONEY || d.lives > 0) return 'bell'
  return null
}

/**
 * The decided card was a chain's last link: a link (depth ≥ 2) whose option
 * scheduled no next link (the sim's `chainDone` rule: chainsFinished).
 */
export function eventChainEnded(depth: number, d: CellDiff): boolean {
  return depth >= 2 && d.scheduled <= 0
}

/** B3 §3.4: a chain's last link, or a decision that moved ≥ $100, a life, a vehicle or a worker. */
export function eventNewsworthy(d: CellDiff, chainEnd: boolean): boolean {
  return (
    chainEnd ||
    Math.abs(d.money) >= EVENT_NEWS_MIN_MONEY ||
    d.lives !== 0 ||
    d.vehicles !== 0 ||
    d.workers !== 0
  )
}

/** The decided card as the paper's headline reads it. */
export interface EventNewsCard {
  /** The card's own (filled) title. */
  title: string
  /** The chosen option's label. */
  option: string
  kind: 'decision' | 'news' | 'job'
  /** A link's chain-head title (OpenCardView.chainTitle; critique 6), else null. */
  chainTitle: string | null
  /** The chosen option's first effects line (a news card's headline tail), if any. */
  firstLine?: string | null
}

/**
 * The event paper's one-line headline: a chain's end names the chain as the
 * sim's ticker does (`Protection — the story ends`, the head's title —
 * critique 6); a news card (one OK) its title and what it did (`The loaner —
 * +1 bike`, never `you chose: OK` — critique 7); any other decision the
 * choice (`The recall — you chose: Take the strike`).
 */
export function eventNewsHeadline(
  data: Pick<GameData, 'puns'>,
  card: EventNewsCard,
  chainEnd: boolean,
): string {
  if (chainEnd)
    return data.puns.tickerEvent.chainDone.replaceAll(
      '{title}',
      card.chainTitle ?? card.title,
    )
  if (card.kind === 'news') {
    const line = card.firstLine?.trim() ?? ''
    return line === '' ? card.title : `${card.title} — ${line}`
  }
  return eventChoiceLine(data, card.title, card.option)
}

/**
 * The `incident` ticker line of a life an event option took (the Ticker's
 * incidentLine wording): `The recall cost a life — 2 lives left`.
 */
export function eventIncidentLine(title: string, livesLeft: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(livesLeft) ? livesLeft : 0))
  const left =
    n === 0 ? 'no lives left' : `${n} ${n === 1 ? 'life' : 'lives'} left`
  return `${title} cost a life — ${left}`
}

/**
 * The pulse alpha at `v` ∈ [0, 1] of its 240 ms: 1 → EVENT_PULSE_MIN_ALPHA at
 * the middle → 1 (linear legs).
 */
export function eventPulseAlpha(v: number): number {
  const t = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1))
  const dip = 1 - EVENT_PULSE_MIN_ALPHA
  return t < 0.5 ? 1 - 2 * dip * t : EVENT_PULSE_MIN_ALPHA + 2 * dip * (t - 0.5)
}

// ---- tap zones -----------------------------------------------------------------

/**
 * An invisible interactive Zone over `rect` (a layout Target's `hit`): a tap
 * (down + up on it with ≤ TAP_PX travel) emits `ui:tap {id}` and calls onTap.
 * Zones never render, so they cost no draw calls; the tap is swallowed so it
 * never reaches the city (globalTopOnly).
 */
export function addTapZone(
  scene: Phaser.Scene,
  rect: Rect,
  onTap: () => void,
  id = '',
): Phaser.GameObjects.Zone {
  const z = scene.add.zone(rect.x, rect.y, rect.w, rect.h).setOrigin(0, 0)
  z.setInteractive()
  let down = false
  z.on('pointerdown', () => {
    down = true
  })
  z.on('pointerout', () => {
    down = false
  })
  z.on('pointerup', (p: Phaser.Input.Pointer) => {
    if (!down) return
    down = false
    if (p.getDistance() > TAP_PX) return
    scene.game.events.emit('ui:tap', { id })
    onTap()
  })
  z.setData('id', id)
  return z
}

/** Move/resize a tap zone (input hit area follows the size). */
export function setZoneRect(
  z: Phaser.GameObjects.Zone,
  rect: Rect,
): Phaser.GameObjects.Zone {
  z.setPosition(Math.round(rect.x), Math.round(rect.y))
  z.setSize(Math.round(rect.w), Math.round(rect.h))
  const area = z.input?.hitArea as Phaser.Geom.Rectangle | undefined
  area?.setTo(0, 0, Math.round(rect.w), Math.round(rect.h))
  return z
}
