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
import type { Rect } from './layout.ts'
import { ellipsize, formatMoney } from './text.ts'
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
  /** `$1,240 / $2,000` (+ ` · Lv 3 coming soon` at the playtest cap). */
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
 * The level bar (city-view §4.1, spec §8): lifetime earned between this
 * level's threshold and `nextThreshold`. At `playtestMaxLevel` the bar keeps
 * counting toward the next row's threshold and says "Lv N coming soon".
 */
export function levelProgress(
  data: GameData,
  level: number,
  lifetime: number,
  nextThreshold: number | null,
): LevelProgress {
  const atCap = cappedBelowNext(data, level)
  const base = data.levels.find((l) => l.level === level)?.threshold ?? 0
  if (nextThreshold === null) {
    return { frac: 1, text: formatMoney(lifetime), atCap }
  }
  const span = nextThreshold - base
  const raw = span > 0 ? (lifetime - base) / span : 1
  const frac = Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 0))
  let text = `${formatMoney(lifetime)} / ${formatMoney(nextThreshold)}`
  if (atCap) text += ` · Lv ${level + 1} coming soon`
  return { frac, text, atCap }
}

/**
 * The level cell's tap toast: `Lv 2: Hoist Hill + trucks + Shaky shaker`
 * from the next levels.json row (region flavour names, vehicle names,
 * machine names); `Lv 3 coming soon` at the playtest cap.
 */
export function nextUnlockLine(data: GameData, level: number): string {
  const row = data.levels.find((l) => l.level === level + 1)
  if (!row) return `${levelLabel(data, level)} — top level`
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
