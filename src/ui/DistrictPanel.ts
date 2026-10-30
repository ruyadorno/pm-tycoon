// District sheet (city-view.md §5.1, spec §9.2): a Sheet in HudScene opened
// by `pm:select {kind: 'district'}`. Its height fits the rows it shows
// (report-playtest1 §6.14: the fixed max(280, round(H × 0.5)) half-sheet
// left ~200 px empty at 430×932): districtFitHeight() at open, growing — never
// shrinking — while open, so a row that comes and goes (the mood note at a
// band edge) cannot make the sheet bob.
// Rows (16-px text, 28-px pitch, x 12; tap rows are 44 px):
//   1 flavour name + the real name in grey (+ ic_lock when locked)
//   2 satisfaction bar (green ≥ 70 / amber 40–69 / red < 40) + number + the
//     trend arrow (ic_up / ic_down / ic_flat from districtStats.trend);
//     < economy.satisfaction.loudBelow adds ic_angry `Residents are
//     grumbling`, ≥ happyAbove ic_flower `Loves the service`
//   3 favoured vehicle (`Favours: bike (+1 satisfaction)`), or for a
//     hard-rule district (Industrial) the red `Trucks only — bikes and vans
//     never enter` and, while the player owns none of its allowed types,
//     `No truck yet (Lv 2, $1,200)` (vehicles.json)
//   4 `Earned here: $1,240` (payouts delivered to the district)
//   5 `Waiting parcels: 7 at 3 buildings · oldest 1:40` (age tinted by the
//     decay phase) + per-size counts and a `Show ▸` link; tap → close +
//     pm:panTo {buildingId} of the building with the most waiting parcels
//   6 `Vehicles homed here: 2 (Dee, Pax)` (M6: the drivers' names,
//     ellipsized before the link) + `Garage ▸` (toggleGarage)
// M7 (spec-build2 §3.1, design-m7 §6.5): a district-targeted quest takes the
// row after row 2 (in place of the mood note: the bar's colour and the
// quest's own flavour already say it) — `ic_quest` + `Rush hour · 4/10 · 1d
// 12h` (active) or `Job offer: Rush hour ▸` (offered; questText.questRowText);
// its 44-px tap band (grown over the non-interactive rows around it) calls
// opts.onQuest(questId) and the HUD opens the QuestCard. The quest comes from
// vs.quests() (the offer or active quest whose target is this district), so
// the sheet's tallest case (Industrial with every row) stays at M5's height.
// Locked regions replace rows 2–6 with `Unlocks at Lv 2 — $2,000 lifetime
// earned`, the trucks-only line for Industrial and the locked sign art.
// M8 (spec-core §5.6, design-m8-m9 §6.3): an overseas hub (`stats.kind ===
// 'overseas'`, live) has no satisfaction, favoured, waiting or homed rows
// (hubs never send parcels and are no home zone); its rows are
//   2 ic_ship / ic_plane `Overseas hub · pays ×1.5`
//   (the M7 quest row, when a quest targets the hub)
//   3 ic_cleared `Clearance 45 s · 3 clearing · next 0:32` (vs.hub(id); the
//     2-Hz re-read keeps the countdown moving)
//   4 `Earned here: $1,240` (the clearances paid)
//   5 `Sizes: S M L XL` (Airport `Sizes: S M`)
// and the sheet fits them like any other district (≤ the old half-sheet).
// Opening emits pm:panTo {regionId, cover} so the City centres the label in
// the part of the screen the sheet leaves uncovered. The panel never subscribes to the sim: HudScene
// calls refresh() on the §5.1 events; it also re-reads at 2 Hz while open
// (the oldest age ticks without an event).
import type Phaser from 'phaser'
import type {
  DistrictDef,
  GameData,
  OverseasDistrictDef,
} from '../data/types.ts'
import type {
  DistrictStats,
  HubView,
  QuestsView,
  QuestView,
  Trend,
  ViewSim,
} from '../sim/view-api.ts'
import type { Size, VehicleType } from '../sim/types.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { decayPhase, type DecayPhase } from '../render/decayPhase.ts'
import {
  frameOrNull,
  SIGN_LOCKED_FACE,
  type FrameName,
} from '../render/frames.ts'
import { toggleGarage } from '../scenes/GarageSheet.ts'
import { Button } from './Button.ts'
import { hubIcon, hubPanelRows, type HubPanelRows } from './hubText.ts'
import { HUD_TOP_H, type Layout } from './layout.ts'
import { addBar, barFrame, BAR_H, setBarFill, type BarColour } from './Panel.ts'
import { questRowText } from './questText.ts'
import { Sheet } from './Sheet.ts'
import {
  addText,
  CAP_H,
  CAP_TOP,
  ellipsize,
  formatClock,
  formatInt,
  formatMoney,
  LINE_H,
  textTop,
} from './text.ts'
import { PALETTE, THEME } from './theme.ts'
import { addTapZone } from './ZonePicker.ts'

export const DISTRICT_SHEET_ID = 'district'
export const EV_PAN_TO = 'pm:panTo'

/** Row geometry (sheet-local px): text x, first row top, pitches. */
const X = 12
const TOP = 16
const ROW = 28
const TAP_ROW = 44

/** The playtest-1 half-sheet height (city-view §5.1): now only a reference. */
export function districtSheetHeight(H: number): number {
  return Math.max(280, Math.round(H * 0.5))
}

/** Space under the last row, above the safe-area inset. */
export const DISTRICT_PAD_BOTTOM = 12

/**
 * The sheet height that fits rows ending at sheet-local `contentBottom`: the
 * pad and the safe-area inset under them, never past the HUD's top band.
 */
export function districtFitHeight(
  contentBottom: number,
  L: { H: number; safeTop: number; safeBottom: number },
): number {
  const fit =
    Math.round(contentBottom) + DISTRICT_PAD_BOTTOM + Math.max(0, L.safeBottom)
  return Math.min(fit, L.H - Math.max(0, L.safeTop) - HUD_TOP_H)
}

/**
 * Sheet-local bottom of the rows render() lays out (the same row pitches),
 * for the sizing tests and the 360×604 / 393×659 fit checks.
 */
export function districtContentBottom(rows: {
  locked: boolean
  /** Locked: the sign's height (drawn 8 px under the text rows). */
  signH?: number
  /** Unlocked: a `district` (hubs have no satisfaction row). */
  satisfaction?: boolean
  moodNote?: boolean
  favouredOrRule?: boolean
  missing?: boolean
  /** The waiting row is a 44-px tap row when anything waits. */
  waiting?: boolean
  /** Locked: the trucks-only line of a hard-rule district. */
  rule?: boolean
  /** M7: a quest offered / active for this district (takes the mood note's row). */
  quest?: boolean
  /** M8: a live overseas hub (pay, clearance, earned, sizes; no other row). */
  hub?: boolean
}): number {
  let y = TOP + ROW
  if (rows.locked) {
    y += ROW
    if (rows.rule) y += ROW
    return y + 8 + (rows.signH ?? 0)
  }
  if (rows.hub) {
    y += ROW // pay
    if (rows.quest) y += ROW
    return y + 3 * ROW // clearance, earned, sizes
  }
  if (rows.satisfaction) y += ROW
  if (rows.moodNote || rows.quest) y += ROW
  if (rows.favouredOrRule) y += ROW
  if (rows.missing) y += ROW
  y += ROW // earned
  y += rows.waiting ? TAP_ROW : ROW
  return y + TAP_ROW // homed + Garage
}

/** Spec §9.4 bands for the satisfaction bar (display rule, same as the mood face). */
export const SAT_GOOD = 70
export const SAT_FAIR = 40

export function satisfactionColour(v: number): BarColour {
  if (v >= SAT_GOOD) return 'green'
  if (v >= SAT_FAIR) return 'amber'
  return 'red'
}

const TREND_ICON: Record<Trend, FrameName> = {
  up: 'ic_up',
  down: 'ic_down',
  flat: 'ic_flat',
}

/** The loud-district note (economy.satisfaction.loudBelow / happyAbove). */
export function moodNote(
  v: number,
  data: GameData,
): { icon: FrameName; text: string } | null {
  const s = data.economy.satisfaction
  if (v < s.loudBelow)
    return { icon: 'ic_angry', text: 'Residents are grumbling' }
  if (v >= s.happyAbove) return { icon: 'ic_flower', text: 'Loves the service' }
  return null
}

/** `Favours: bike (+1 satisfaction)`; null for hubs / hard-rule districts. */
export function favouredLine(def: DistrictDef, data: GameData): string | null {
  if (def.kind !== 'district' || def.hardRule || def.favoured.length === 0)
    return null
  const names = def.favoured.map((t) => typeName(data, t).toLowerCase())
  return `Favours: ${names.join(' or ')} (+${data.economy.satisfaction.favouredBonus} satisfaction)`
}

/** `Trucks only — bikes and vans never enter` for a hard-rule district. */
export function vehicleRuleLine(
  def: DistrictDef,
  data: GameData,
): string | null {
  if (!def.hardRule) return null
  const allowed = data.vehicles.types.filter((t) => def.allowed.includes(t.id))
  const banned = data.vehicles.types.filter((t) => !def.allowed.includes(t.id))
  if (allowed.length === 0) return null
  const only = allowed.map((t) => `${t.name}s`).join(' and ')
  if (banned.length === 0) return `${only} only`
  const never = banned.map((t) => `${t.name.toLowerCase()}s`).join(' and ')
  return `${only} only — ${never} never enter`
}

/**
 * `No truck yet (Lv 2, $1,200)` while a hard-rule district has no owned
 * vehicle that may enter it (the cheapest allowed type's unlock and price).
 */
export function missingVehicleLine(
  def: DistrictDef,
  data: GameData,
  owned: readonly VehicleType[],
): string | null {
  if (!def.hardRule) return null
  if (owned.some((t) => def.allowed.includes(t))) return null
  const cheapest = data.vehicles.types
    .filter((t) => def.allowed.includes(t.id))
    .toSorted((a, b) => a.price - b.price)[0]
  if (!cheapest) return null
  return `No ${cheapest.name.toLowerCase()} yet (Lv ${cheapest.unlockLevel}, ${formatMoney(cheapest.price)})`
}

/** `Earned here: $1,240` */
export function earnedLine(earned: number): string {
  return `Earned here: ${formatMoney(earned)}`
}

/**
 * Row 5 text split in two (the age is tinted separately):
 * `Waiting parcels: 7 at 3 buildings · oldest ` + `1:40`, or `none`.
 */
export function waitingLine(
  s: Pick<
    DistrictStats,
    'waitingCount' | 'waitingBuildings' | 'oldestWaitingS'
  >,
  data: GameData,
): { text: string; age: string; phase: DecayPhase } | null {
  if (s.waitingCount <= 0) return null
  const b = s.waitingBuildings
  const at = `${formatInt(s.waitingCount)} at ${b} building${b === 1 ? '' : 's'}`
  if (s.oldestWaitingS === null)
    return { text: `Waiting parcels: ${at}`, age: '', phase: 'plain' }
  return {
    text: `Waiting parcels: ${at} · oldest `,
    age: formatClock(Math.floor(s.oldestWaitingS)),
    phase: decayPhase(s.oldestWaitingS, data.parcels),
  }
}

export const NO_WAITING = 'Waiting parcels: none'
/** The waiting row's link: pans to the busiest building (city-view §5.1 row 5). */
export const WAIT_LINK = 'Show ▸'

/**
 * `Vehicles homed here: 2`; with the homed vehicles' active drivers (M6,
 * spec-build2 §2.5) `Vehicles homed here: 2 (Dee, Pax)` — a vehicle with no
 * driver adds `no driver` (`2 no driver` for several).
 */
export function homedLine(
  n: number,
  drivers: readonly (string | null)[] = [],
): string {
  const head = `Vehicles homed here: ${n}`
  if (n <= 0 || drivers.length === 0) return head
  const parts = drivers.filter((d): d is string => d !== null)
  const none = drivers.length - parts.length
  if (none === 1) parts.push('no driver')
  else if (none > 1) parts.push(`${none} no driver`)
  return `${head} (${parts.join(', ')})`
}

/** The active driver names of the vehicles homed in `districtId` (fleet order). */
export function homedDrivers(
  vehicles: readonly { zone: string; driverName: string | null }[],
  districtId: string,
): (string | null)[] {
  return vehicles.filter((v) => v.zone === districtId).map((v) => v.driverName)
}

/** `Unlocks at Lv 2 — $2,000 lifetime earned` (levels.json threshold). */
export function lockedLine(def: DistrictDef, data: GameData): string {
  const row = data.levels.find((l) => l.level === def.unlockLevel)
  const at = `Unlocks at Lv ${def.unlockLevel}`
  return row ? `${at} — ${formatMoney(row.threshold)} lifetime earned` : at
}

/**
 * M8: the hub rows of an overseas district — from `vs.hub(id)`, or from its
 * districts.json row with nothing clearing when map.hubs has no row for it
 * yet (a debug-forced level ahead of the hub's render row).
 */
export function districtHubRows(
  hub: HubView | null,
  def: OverseasDistrictDef,
  tick: number,
): HubPanelRows {
  return hubPanelRows(
    hub ?? {
      valueMult: def.valueMult,
      clearanceS: def.clearanceS,
      sizes: def.sizes,
      clearing: [],
    },
    tick,
  )
}

/** The building with the most waiting parcels (ties: the oldest parcel). */
export function busiestBuilding(
  buildings: readonly { id: string; district: string }[],
  districtId: string,
  waitingOf: (buildingId: string) => readonly { spawnedTick: number }[],
): string | null {
  let best: string | null = null
  let bestN = 0
  let bestOldest = Infinity
  for (const b of buildings) {
    if (b.district !== districtId) continue
    const w = waitingOf(b.id)
    if (w.length === 0) continue
    const oldest = Math.min(...w.map((p) => p.spawnedTick))
    if (w.length > bestN || (w.length === bestN && oldest < bestOldest)) {
      best = b.id
      bestN = w.length
      bestOldest = oldest
    }
  }
  return best
}

// ---- M7 quest row ------------------------------------------------------------

/**
 * The quest the district panel shows for `districtId`: the active quest
 * targeting it, else the open offer targeting it, else null.
 */
export function districtQuest(
  qs: Pick<QuestsView, 'offer' | 'active'>,
  districtId: string,
): QuestView | null {
  if (qs.active && qs.active.target === districtId) return qs.active
  if (qs.offer && qs.offer.target === districtId) return qs.offer
  return null
}

/**
 * The quest row's 44-px tap band for a 28-px row at sheet-local `rowY`:
 * centred on the row, grown over the non-interactive rows above and below.
 */
export function questTapBand(
  rowY: number,
  W: number,
): { x: number; y: number; w: number; h: number } {
  return { x: 0, y: rowY - Math.floor((TAP_ROW - ROW) / 2), w: W, h: TAP_ROW }
}

/** Make a hidden row object visible (render() hides them all first). */
function show<T extends { setVisible(v: boolean): T }>(o: T): T {
  return o.setVisible(true)
}

function typeName(data: GameData, id: string): string {
  return data.vehicles.types.find((t) => t.id === id)?.name ?? id
}

// ---- view ------------------------------------------------------------------

const BAR_W = 200
const ICON = 16
const GAP = 6
const SIZES: readonly Size[] = ['S', 'M', 'L', 'XL']
const REFRESH_MS = 500
const MUTED = PALETTE.grey1
const RED = PALETTE.red0

export interface DistrictPanelOptions {
  /** M7: the quest row was tapped (the HUD opens the QuestCard). */
  onQuest?: (questId: string) => void
}

const AGE_TINT: Record<DecayPhase, number> = {
  plain: THEME.textDark,
  amber: PALETTE.yellow0,
  red: PALETTE.red0,
}

export class DistrictPanel {
  readonly scene: Phaser.Scene
  readonly sheet: Sheet
  private vs: ViewSim
  private L: Layout
  private id: string | null = null
  private sinceRefresh = 0

  private title: Phaser.GameObjects.BitmapText
  private subtitle: Phaser.GameObjects.BitmapText
  private lockIcon: Phaser.GameObjects.Image
  private barTrack: Phaser.GameObjects.NineSlice
  private barFill: Phaser.GameObjects.NineSlice
  private satText: Phaser.GameObjects.BitmapText
  private trendIcon: Phaser.GameObjects.Image
  private noteIcon: Phaser.GameObjects.Image
  private noteText: Phaser.GameObjects.BitmapText
  private favIcon: Phaser.GameObjects.Image
  private favText: Phaser.GameObjects.BitmapText
  private missingText: Phaser.GameObjects.BitmapText
  private earnIcon: Phaser.GameObjects.Image
  private earnText: Phaser.GameObjects.BitmapText
  private waitText: Phaser.GameObjects.BitmapText
  private waitAge: Phaser.GameObjects.BitmapText
  private waitMore: Phaser.GameObjects.BitmapText
  private sizeIcons: Phaser.GameObjects.Image[] = []
  private sizeTexts: Phaser.GameObjects.BitmapText[] = []
  private waitZone: Phaser.GameObjects.Rectangle
  private homedText: Phaser.GameObjects.BitmapText
  private garageBtn: Button
  private lockText: Phaser.GameObjects.BitmapText
  private ruleText: Phaser.GameObjects.BitmapText
  private sign: Phaser.GameObjects.Image
  private signLines: Phaser.GameObjects.BitmapText[] = []
  private questIcon: Phaser.GameObjects.Image
  private questText: Phaser.GameObjects.BitmapText
  private questZone: Phaser.GameObjects.Rectangle
  private questId: string | null = null
  private hubIcon: Phaser.GameObjects.Image
  private hubPayText: Phaser.GameObjects.BitmapText
  private clearIcon: Phaser.GameObjects.Image
  private clearText: Phaser.GameObjects.BitmapText
  private sizesIcon: Phaser.GameObjects.Image
  private sizesText: Phaser.GameObjects.BitmapText
  private opts: DistrictPanelOptions

  constructor(
    scene: Phaser.Scene,
    L: Layout,
    viewSim: ViewSim,
    opts: DistrictPanelOptions = {},
  ) {
    this.scene = scene
    this.L = L
    this.vs = viewSim
    this.opts = opts
    this.sheet = new Sheet(scene, {
      height: districtFitHeight(districtContentBottom({ locked: false }), L),
      W: L.W,
      H: L.H,
      id: DISTRICT_SHEET_ID,
      headerH: TOP + ROW,
      onClose: () => {
        this.id = null
      },
    })

    const img = (frame: FrameName): Phaser.GameObjects.Image =>
      scene.add.image(0, 0, UI_ATLAS, frame).setOrigin(0, 0)
    this.title = addText(scene, X, 0, '')
    this.subtitle = addText(scene, X, 0, '', { tint: MUTED })
    this.lockIcon = img('ic_lock')
    this.barTrack = addBar(scene, X, 0, BAR_W)
    this.barFill = addBar(scene, X, 0, BAR_W, barFrame('green'))
    this.satText = addText(scene, 0, 0, '')
    this.trendIcon = img('ic_flat')
    this.noteIcon = img('ic_angry')
    this.noteText = addText(scene, 0, 0, '')
    this.favIcon = img('ic_bike')
    this.favText = addText(scene, 0, 0, '')
    this.missingText = addText(scene, 0, 0, '', { tint: RED })
    this.earnIcon = img('ic_money')
    this.earnText = addText(scene, 0, 0, '')
    this.waitText = addText(scene, X, 0, '')
    this.waitAge = addText(scene, 0, 0, '')
    // A worded link (not a lone 3-px `▸`) so the row reads as tappable.
    this.waitMore = addText(scene, 0, 0, WAIT_LINK, { tint: THEME.primary })
    for (const s of SIZES) {
      this.sizeIcons.push(img(`ic_parcel_${s.toLowerCase()}` as FrameName))
      this.sizeTexts.push(addText(scene, 0, 0, ''))
    }
    this.waitZone = addTapZone(
      scene,
      { x: 0, y: 0, w: L.W, h: TAP_ROW },
      'district:waiting',
      () => this.onWaitingTap(),
    )
    this.homedText = addText(scene, X, 0, '')
    this.garageBtn = new Button(scene, {
      x: 0,
      y: 0,
      w: 76,
      h: ROW,
      label: 'Garage ▸',
      minHit: L.minHit,
      id: 'district:garage',
      onClick: () => toggleGarage(scene),
    })
    this.lockText = addText(scene, X, 0, '')
    this.ruleText = addText(scene, X, 0, '', { tint: RED })
    this.sign = img('sign_locked')
    for (let i = 0; i < 2; i++) this.signLines.push(addText(scene, 0, 0, ''))
    this.questIcon = img('ic_quest')
    this.questText = addText(scene, 0, 0, '')
    this.questZone = addTapZone(
      scene,
      { x: 0, y: 0, w: L.W, h: TAP_ROW },
      'district:quest',
      () => this.onQuestTap(),
    )
    // M8 hub rows (icons resolved per hub at render: ship / plane).
    this.hubIcon = img('ic_money')
    this.hubPayText = addText(scene, 0, 0, '')
    this.clearIcon = img(frameOrNull('ic_cleared') ?? 'ic_flat')
    this.clearText = addText(scene, 0, 0, '')
    this.sizesIcon = img('ic_parcel_m')
    this.sizesText = addText(scene, 0, 0, '')

    this.sheet.add(
      this.title,
      this.subtitle,
      this.lockIcon,
      this.barTrack,
      this.barFill,
      this.satText,
      this.trendIcon,
      this.noteIcon,
      this.noteText,
      this.favIcon,
      this.favText,
      this.missingText,
      this.earnIcon,
      this.earnText,
      this.waitText,
      this.waitAge,
      this.waitMore,
      ...this.sizeIcons,
      ...this.sizeTexts,
      this.waitZone,
      this.homedText,
      this.garageBtn,
      this.lockText,
      this.ruleText,
      this.sign,
      ...this.signLines,
      this.questIcon,
      this.questText,
      this.questZone,
      this.hubIcon,
      this.hubPayText,
      this.clearIcon,
      this.clearText,
      this.sizesIcon,
      this.sizesText,
    )

    scene.events.on('update', this.onUpdate, this)
    scene.events.once('shutdown', this.destroy, this)
  }

  isOpen(): boolean {
    return this.sheet.isOpen()
  }

  /** The district shown (null while closed). */
  get districtId(): string | null {
    return this.id
  }

  /** Open on `districtId` (a districts.json id); ignores ids with no stats. */
  open(districtId: string): void {
    if (!this.vs.districtStats(districtId)) return
    const again = this.id === districtId && this.sheet.isOpen()
    this.id = districtId
    this.refresh(!again)
    if (!this.sheet.isOpen()) this.sheet.open()
    if (!again)
      this.scene.game.events.emit(EV_PAN_TO, {
        regionId: districtId,
        cover: this.sheet.height / this.L.H,
      })
  }

  close(): void {
    this.sheet.close()
  }

  relayout(L: Layout): void {
    this.L = L
    this.sheet.relayout(L)
    this.garageBtn.setRect({ x: 0, y: 0, w: 76, h: ROW }, undefined, L.minHit)
    this.refresh(true)
  }

  /**
   * Re-read districtStats and re-lay the rows; the sheet fits them (`exact`:
   * shrink too — opening, a resize — else it only grows while open).
   */
  refresh(exact = false): void {
    const id = this.id
    if (!id) return
    const stats = this.vs.districtStats(id)
    const def = this.vs.data.districts.find((d) => d.id === id)
    if (!stats || !def) return
    const bottom = this.render(stats, def)
    const h = districtFitHeight(bottom, this.L)
    const open = this.sheet.isOpen()
    if (h > this.sheet.height || (h !== this.sheet.height && (exact || !open)))
      this.sheet.resize(h)
  }

  destroy(): void {
    this.scene.events.off('update', this.onUpdate, this)
    this.scene.events.off('shutdown', this.destroy, this)
    this.sheet.destroy()
  }

  // ---- internals -----------------------------------------------------------

  /** Lay the rows out; returns their sheet-local bottom. */
  private render(stats: DistrictStats, def: DistrictDef): number {
    const data = this.vs.data
    const W = this.L.W
    const all: Phaser.GameObjects.GameObject[] = this.sheet.root.list.filter(
      (o) => o !== this.sheet.bg && o !== this.sheet.handle,
    )
    for (const o of all)
      (o as unknown as { setVisible(v: boolean): unknown }).setVisible(false)
    this.questId = null
    // 1 header
    let y = TOP
    show(this.title).setText(def.flavour).setY(textTop(y, ROW))
    show(this.subtitle)
      .setText(def.name)
      .setPosition(X + Math.round(this.title.width) + 8, textTop(y, ROW))
    if (stats.locked)
      show(this.lockIcon).setPosition(
        this.subtitle.x + Math.round(this.subtitle.width) + GAP,
        y + Math.floor((ROW - ICON) / 2),
      )
    y += ROW

    if (stats.locked) {
      show(this.lockText).setText(lockedLine(def, data)).setY(textTop(y, ROW))
      y += ROW
      const rule = vehicleRuleLine(def, data)
      if (rule) {
        show(this.ruleText).setText(rule).setY(textTop(y, ROW))
        y += ROW
      }
      this.layoutSign(def, y + 8)
      return y + 8 + Math.round(this.sign.height)
    }

    if (def.kind === 'overseas') return this.renderHub(stats, def, y)

    // 2 satisfaction (districts only: hubs have none) + the mood note, or
    // (M7) the quest row in its place
    let note: { icon: FrameName; text: string } | null = null
    if (stats.kind === 'district') {
      const v = stats.satisfaction
      show(this.barTrack).setPosition(X, y + Math.floor((ROW - BAR_H) / 2))
      this.barFill.setFrame(barFrame(satisfactionColour(v)))
      this.barFill.setPosition(X, this.barTrack.y)
      setBarFill(this.barFill, BAR_W, v / 100)
      show(this.satText)
        .setText(String(Math.round(v)))
        .setPosition(X + BAR_W + GAP, textTop(y, ROW))
      show(this.trendIcon)
        .setFrame(TREND_ICON[stats.trend])
        .setPosition(
          this.satText.x + Math.round(this.satText.width) + 4,
          y + Math.floor((ROW - ICON) / 2),
        )
      y += ROW
      note = moodNote(v, data)
    }
    const quest = districtQuest(this.vs.quests(), def.id)
    this.questId = quest?.id ?? null
    if (quest) y = this.renderQuest(quest, y)
    else if (note) {
      show(this.noteIcon)
        .setFrame(note.icon)
        .setPosition(X, y + Math.floor((ROW - ICON) / 2))
      show(this.noteText)
        .setText(note.text)
        .setPosition(X + ICON + GAP, textTop(y, ROW))
      y += ROW
    }

    // 3 favoured vehicle / hard rule
    const owned = this.vs.vehicles.map((v) => v.type)
    const rule = vehicleRuleLine(def, data)
    const fav = favouredLine(def, data)
    if (rule) {
      const t = def.allowed[0] ?? 'truck'
      show(this.favIcon)
        .setFrame(`ic_${t}` as FrameName)
        .setTint(PALETTE.red1)
        .setPosition(X, y + Math.floor((ROW - ICON) / 2))
      show(this.favText)
        .setText(rule)
        .setTint(RED)
        .setPosition(X + ICON + GAP, textTop(y, ROW))
      y += ROW
      const missing = missingVehicleLine(def, data, owned)
      if (missing) {
        show(this.missingText)
          .setText(missing)
          .setPosition(X + ICON + GAP, textTop(y, ROW))
        y += ROW
      }
    } else if (fav) {
      const t = def.favoured[0] ?? 'bike'
      show(this.favIcon)
        .setFrame(`ic_${t}` as FrameName)
        .clearTint()
        .setPosition(X, y + Math.floor((ROW - ICON) / 2))
      show(this.favText)
        .setText(fav)
        .setTint(THEME.textDark)
        .setPosition(X + ICON + GAP, textTop(y, ROW))
      y += ROW
    }

    // 4 earned here
    show(this.earnIcon).setPosition(X, y + Math.floor((ROW - ICON) / 2))
    show(this.earnText)
      .setText(earnedLine(stats.earned))
      .setPosition(X + ICON + GAP, textTop(y, ROW))
    y += ROW

    // 5 waiting parcels (a 44-px tap row when anything waits)
    const wl = waitingLine(stats, data)
    if (!wl) {
      show(this.waitText).setText(NO_WAITING).setY(textTop(y, ROW))
      y += ROW
    } else {
      const lineTop = y + 2
      show(this.waitText)
        .setText(wl.text)
        .setY(textTop(lineTop, LINE_H + 4))
      show(this.waitAge)
        .setText(wl.age)
        .setTint(AGE_TINT[wl.phase])
        .setPosition(
          X + Math.round(this.waitText.width),
          textTop(lineTop, LINE_H + 4),
        )
      let x = X
      const iconY = y + TAP_ROW - ICON - 4
      // On the size-icon line, right-aligned (the first line can be long).
      show(this.waitMore).setPosition(
        W - X - Math.round(this.waitMore.width),
        iconY + Math.floor((ICON - CAP_H) / 2) - CAP_TOP,
      )
      SIZES.forEach((s, i) => {
        const n = stats.waiting[s]
        if (n <= 0) return
        const icon = show(this.sizeIcons[i] as Phaser.GameObjects.Image)
        icon.setPosition(x, iconY)
        const t = show(this.sizeTexts[i] as Phaser.GameObjects.BitmapText)
        t.setText(`×${n}`).setPosition(
          x + ICON + 2,
          iconY + Math.floor((ICON - CAP_H) / 2) - CAP_TOP,
        )
        x += ICON + 2 + Math.round(t.width) + 10
      })
      show(this.waitZone).setPosition(0, y)
      this.waitZone.setSize(W, TAP_ROW)
      const area = this.waitZone.input?.hitArea as
        | Phaser.Geom.Rectangle
        | undefined
      area?.setSize(W, TAP_ROW)
      y += TAP_ROW
    }

    // 6 vehicles homed (+ their drivers, ellipsized) + Garage link (44 px)
    const bx = W - X - this.garageBtn.btnWidth
    const line = homedLine(
      stats.vehiclesHomed,
      homedDrivers(this.vs.vehicles, def.id),
    )
    const homed = show(this.homedText)
    homed
      .setText(ellipsize(line, bx - 8 - X, (s) => homed.setText(s).width))
      .setY(textTop(y, TAP_ROW))
    const by = y + Math.floor((TAP_ROW - ROW) / 2)
    show(this.garageBtn).setRect(
      { x: bx, y: by, w: this.garageBtn.btnWidth, h: ROW },
      { x: bx, y, w: this.garageBtn.btnWidth, h: TAP_ROW },
    )
    return y + TAP_ROW
  }

  /**
   * M8: a live overseas hub's rows from `y` (under the header); returns
   * their bottom. The M7 quest row (a quest targeting the hub) sits under
   * the pay row.
   */
  private renderHub(
    stats: DistrictStats,
    def: OverseasDistrictDef,
    y: number,
  ): number {
    const rows = districtHubRows(this.vs.hub(def.id), def, this.vs.tick)
    const iconY = (rowY: number): number => rowY + Math.floor((ROW - ICON) / 2)
    const tx = X + ICON + GAP
    const icon = frameOrNull(hubIcon(this.vs.data, def.id))
    if (icon) show(this.hubIcon).setFrame(icon).setPosition(X, iconY(y))
    show(this.hubPayText).setText(rows.pay).setPosition(tx, textTop(y, ROW))
    y += ROW
    const quest = districtQuest(this.vs.quests(), def.id)
    this.questId = quest?.id ?? null
    if (quest) y = this.renderQuest(quest, y)
    if (frameOrNull('ic_cleared')) show(this.clearIcon).setPosition(X, iconY(y))
    show(this.clearText)
      .setText(rows.clearance)
      .setPosition(tx, textTop(y, ROW))
    y += ROW
    show(this.earnIcon).setPosition(X, iconY(y))
    show(this.earnText)
      .setText(earnedLine(stats.earned))
      .setPosition(tx, textTop(y, ROW))
    y += ROW
    show(this.sizesIcon).setPosition(X, iconY(y))
    show(this.sizesText).setText(rows.sizes).setPosition(tx, textTop(y, ROW))
    return y + ROW
  }

  /** The quest row at `y`; returns the next y. */
  private renderQuest(q: QuestView, y: number): number {
    const W = this.L.W
    show(this.questIcon).setPosition(X, y + Math.floor((ROW - ICON) / 2))
    const t = show(this.questText)
    const tx = X + ICON + GAP
    t.setTint(q.status === 'offered' ? THEME.primary : THEME.textDark)
    t.setText(ellipsize(questRowText(q), W - X - tx, (s) => t.setText(s).width))
    t.setPosition(tx, textTop(y, ROW))
    const band = questTapBand(y, W)
    show(this.questZone).setPosition(band.x, band.y)
    this.questZone.setSize(band.w, band.h)
    const area = this.questZone.input?.hitArea as
      | Phaser.Geom.Rectangle
      | undefined
    area?.setSize(band.w, band.h)
    return y + ROW
  }

  private onQuestTap(): void {
    const id = this.questId
    if (!id) return
    this.opts.onQuest?.(id)
  }

  private layoutSign(def: DistrictDef, y: number): void {
    const W = this.L.W
    const sx = Math.round((W - this.sign.width) / 2)
    this.sign.setVisible(true).setPosition(sx, y)
    const lines = [`Unlocks at Lv ${def.unlockLevel}`]
    if (def.hardRule)
      lines.push(`${typeName(this.vs.data, def.allowed[0] ?? 'truck')}s only`)
    const f = SIGN_LOCKED_FACE
    const ink = CAP_H + LINE_H * (lines.length - 1)
    lines.forEach((s, i) => {
      const t = this.signLines[i]
      if (!t) return
      t.setVisible(true).setText(s).setTint(THEME.textDark)
      t.setPosition(
        sx + f.x + Math.round((f.w - t.width) / 2),
        y + f.y + Math.floor((f.h - ink) / 2) - CAP_TOP + LINE_H * i,
      )
    })
  }

  private onWaitingTap(): void {
    const id = this.id
    if (!id) return
    const b = busiestBuilding(this.vs.data.buildings, id, (bid) =>
      this.vs.waitingAt(bid),
    )
    if (!b) return
    this.close()
    this.scene.game.events.emit(EV_PAN_TO, { buildingId: b })
  }

  private onUpdate(_t: number, delta: number): void {
    if (!this.sheet.isOpen()) return
    this.sinceRefresh += delta
    if (this.sinceRefresh < REFRESH_MS) return
    this.sinceRefresh = 0
    this.refresh()
  }
}
