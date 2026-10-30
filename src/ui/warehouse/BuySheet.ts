// Warehouse BuySheet (warehouse-view.md §2.1, §2.5, §6; plan.md §8; spec
// §6.2-§6.3, §6.7; spec-build2 §2.4, design-m6 §6.2) plus the shared base of
// the warehouse sheets (`WarehouseSheet`, also used by SlotCard, HoldBayCard
// and StationCard).
//
// Shared base (warehouse-view.md §2 preamble): a kit `Sheet` (composition,
// like DistrictPanel) inside the Warehouse scene: full width, its bottom
// edge on the top of the HUD bottom band (L.bottomBar.y, so it slides out
// from behind the HUD's City/Garage bar), 8-px inner padding, a 40 % black
// scrim over the room (tap = close), Esc closes, buttons ≥ 44 px hit. One
// warehouse sheet is open at a time (opening one closes the other at
// once). The sim keeps running: each sheet subscribes to the sim events it
// displays through bindSim (attached while the scene is awake; WAKE / a sim
// swap re-validate and rebuild via sync()), rebuilds on the next frame
// after an event (dirty flag, so a burst of events costs one rebuild and a
// button is never destroyed inside its own tap), re-reads clock-driven
// text every 500 ms, ignores taps for 150 ms after opening (§2.5 rapid
// double taps) and closes on `game:over`. A refused command shakes its
// row/button 2 px, emits `ui:sfx {name: 'deny'}` and a `pm:tooltip` with
// the failure text above it. `ui:tap` comes from the Button kit; the `buy`
// SFX is the director's (money:changed purchase), never emitted here.
// People (M6): a card that hires (SlotCard's desk, StationCard) asks the
// scene for the shared HireSheet through `openHire(req)` (an option, so the
// cards never import the sheet); it closes itself first and `req.onDone` /
// `req.onCancel` reopen it. The base also draws a person's 16×16 face
// (`face_NN`, the sim's `look`) and compact pips (`ic_pip_on/off` at a 7-px
// pitch, 4 px between stats).
//
// Construction (the WarehouseScene owns the instances):
//   new BuySheet(scene, L, viewSim, {labelFor?, openHire?})  L = computeLayout(...)
//   open(nodeId, highlight?) · close(instant?) · isOpen() · relayout(L)
// `labelFor` is the room layout's `labelFor(nodeId)` ('Slot 2'); it can also
// ride on L (`{...L, labelFor}`) or be set later with setLabelFor(). Without
// it the node id is title-cased ('slot2' → 'Slot 2').
//
// BuySheet.open(nodeId, highlight?) on an empty live slot: height
// 40 + 56 × rows; rows from machines.json + employees.json desks.rows,
// unlocked first — the unlocked checkers, the desk rows (an unplaced, open
// desk: `Inspection desk` free / `Second desk $400`; a placed desk: `Move
// desk here`, numbered `Move desk N here` once two are placed), then the
// locked rows by unlock level (checkers and desk 2, dimmed, `Unlocks at
// Lv N` + ` · coming soon` past economy.playtestMaxLevel). A row: icon, name,
// price (red and dimmed when unaffordable), two detail lines (`catch 80%
// metal · 15% other · false-flag 50%`, `60/min`; a desk: `seats 1–3 · hire
// from 3 applicants`, `catch 75–94% by eye · $12–36/day each`).
// Tap → lane.buyMachine / placeDesk(node, index) / moveFixture; success
// closes the sheet (the scene animates the fixture from
// lane:fixturePlaced/Moved). `highlight` (a machines.json id, pm:goto's
// highlight) pulses that row.
//
// M7 (spec-build2 §3.1, design-m7 §6.8): a checker row whose id is in the
// quest vouchers (`vs.quests().vouchers`) shows a gold `FREE` tag (a
// `ui_tag` pill) instead of its price and stays enabled at any balance —
// buyMachine spends the voucher, not money. Locked rows ignore vouchers (the
// sim refuses them too). A `quest:completed` (a voucher reward) rebuilds.
import type Phaser from 'phaser'
import {
  bindSim,
  type SimBinding,
  type SimHandlers,
} from '../../boot/simBinding.ts'
import type { CheckerDef, GameData, StatId } from '../../data/types.ts'
import { UI_ATLAS } from '../../render/atlases.ts'
import { frameOrNull, type FrameName } from '../../render/frames.ts'
import type { CommandResult } from '../../sim/commands.ts'
import { salaryOf } from '../../sim/systems/people.ts'
import type { HireTarget, LaneNode, Pips, Role } from '../../sim/types.ts'
import type { ViewSim } from '../../sim/view-api.ts'
import { Button } from '../Button.ts'
import { HUD_BOTTOM_H } from '../layout.ts'
import { addPanel, type PanelFrame } from '../Panel.ts'
import { Sheet } from '../Sheet.ts'
import { addText, ellipsize, formatMoney, formatPct, textTop } from '../text.ts'
import { PALETTE, THEME } from '../theme.ts'
import { EV_UI_SFX, failText } from '../ZonePicker.ts'

// ---- shared constants --------------------------------------------------------

/** pm:tooltip {text, x, y} (HudScene renders it above the point). */
export const EV_TOOLTIP = 'pm:tooltip'
/** Scrim over the room (warehouse-view.md §2: 40 % black). */
export const SCRIM_ALPHA = 0.4
/** Taps are ignored this long after a sheet opens (§2.5 rapid double taps). */
export const OPEN_GUARD_MS = 150
/** Clock-driven text (payday, value now) is re-read this often. */
export const REFRESH_MS = 500
/** Inner padding (§2: 8 px). */
export const PAD = 8
/** Handle + title band; also the drag-to-close zone. */
export const HEADER_H = 40
/** Refused command: the row/button shakes this far (§2.1). */
export const SHAKE_PX = 2
export const SHAKE_MS = 160
/** Locked / unaffordable row content alpha. */
export const DIM_ALPHA = 0.45
/** Secondary text on light panels (DistrictPanel's muted grey). */
export const MUTED = PALETTE.grey1
/** Red text on light panels. */
export const RED_TEXT = PALETTE.red0
/** A ★ hire's name on light panels (gold, legible on the grey5 panel). */
export const STAR_TINT = PALETTE.gold0
/** `ic_star` (16 × 16) after a ★ name: the width it takes and its y offset from the text top. */
export const STAR_W = 15
export const STAR_DY = -1

// ---- BuySheet geometry -------------------------------------------------------

export const BUY_SHEET_ID = 'wh:buy'
export const ROW_PITCH = 56
export const ROW_H = 52
/** Icon column inside a row (48-px machine art + 8). */
export const ROW_TEXT_X = 56
/** Text line tops inside a 52-px row (caps 8, 23, 38). */
export const ROW_LINE_Y = [4, 19, 34] as const

/** BuySheet height for `rows` rows (warehouse-view.md §2.1: 40 + 56 × rows). */
export function buySheetHeight(rows: number): number {
  return HEADER_H + ROW_PITCH * Math.max(0, rows)
}

// ---- pure text helpers ---------------------------------------------------------

/** `80%` for a 0..1 probability. */
export function pctOf(p: number): string {
  return formatPct(p * 100)
}

/** `60/min`: `stations` parallel stations of a `processS`-second checker (§6.3). */
export function perMinText(processS: number, stations = 1): string {
  const n = processS > 0 ? Math.round((60 * stations) / processS) : 0
  return `${n}/min`
}

/**
 * `catch 80% metal · 15% other · false-flag 50%` (§6.3 pMatch / pOther /
 * decoyFlag); a generalist (strain 'any'): `catch 70% any strain ·
 * false-flag 25%`.
 */
export function catchLine(
  c: Pick<CheckerDef, 'strain' | 'pMatch' | 'pOther' | 'decoyFlag'>,
): string {
  const ff = `false-flag ${pctOf(c.decoyFlag)}`
  if (c.strain === 'any') return `catch ${pctOf(c.pMatch)} any strain · ${ff}`
  return `catch ${pctOf(c.pMatch)} ${c.strain} · ${pctOf(c.pOther)} other · ${ff}`
}

/** `Unlocks at Lv 3 · coming soon` (suffix past economy.playtestMaxLevel, Q34). */
export function unlockText(data: GameData, level: number): string {
  const s = `Unlocks at Lv ${level}`
  return level > data.economy.playtestMaxLevel ? `${s} · coming soon` : s
}

/** The price tag of a checker row paid by a quest voucher (design-m7 §6.8). */
export const VOUCHER_TEXT = 'FREE'
/** The voucher tag: a `ui_tag` pill around the text (row-local px). */
export const VOUCHER_PAD_X = 4
export const VOUCHER_TAG_Y = 4
export const VOUCHER_TAG_H = 15
/** Gap between the voucher tag's right edge and the row button's. */
export const VOUCHER_TAG_RIGHT = 6

/** `$150`, or `free` for a zero price (the desk, employees.json deskPrice). */
export function priceText(price: number): string {
  return price > 0 ? formatMoney(price) : 'free'
}

/** Display name of the desk fixture (warehouse-view.md §2.1). */
export const DESK_NAME = 'Inspection desk'

/** Card header of desk `index`: `Inspection desk` (1), `Inspection desk 2`. */
export function deskTitle(index: number): string {
  return index <= 1 ? DESK_NAME : `${DESK_NAME} ${index}`
}

const ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth']

/** BuySheet name of an unplaced desk: `Inspection desk` (1), `Second desk` (2). */
export function deskRowName(index: number): string {
  if (index <= 1) return DESK_NAME
  const o = ORDINALS[index]
  return o ? `${o} desk` : `Desk ${index}`
}

/**
 * `catch 88% avg` with ≥ 2 seated inspectors (the desk readout is their
 * mean, spec-build2 §2.3), `catch 85%` with one, null with nobody seated.
 */
export function deskCatchText(meanP: number, seated: number): string | null {
  if (seated <= 0) return null
  return `catch ${pctOf(meanP)}${seated >= 2 ? ' avg' : ''}`
}

/** Highest pip of `stat` (charisma 0..2, the others 1..5; employees.json tables). */
export function pipMax(data: GameData, stat: StatId): number {
  const ap = data.employees.applicants
  if (stat === 'charisma') return Math.max(0, ap.charismaWeights.length - 1)
  return ap.pipWeights['1']?.length ?? 5
}

/** The lowest (1s, charisma 0) or highest pips of a role (salary ranges). */
export function cornerPips(data: GameData, role: Role, top: boolean): Pips {
  const pips: Pips = {}
  for (const stat of data.employees.roles[role].stats)
    pips[stat] = top ? pipMax(data, stat) : stat === 'charisma' ? 0 : 1
  return pips
}

/** An inspector's catch and salary ranges over every pip (employees.json roles). */
export function inspectorRanges(data: GameData): {
  pMin: number
  pMax: number
  salaryMin: number
  salaryMax: number
} {
  const p = data.employees.roles.inspector.p
  return {
    pMin: Math.min(...p),
    pMax: Math.max(...p),
    salaryMin: salaryOf(
      data,
      'inspector',
      cornerPips(data, 'inspector', false),
    ),
    salaryMax: salaryOf(data, 'inspector', cornerPips(data, 'inspector', true)),
  }
}

/**
 * The detail lines of an unplaced desk row (design-m6 §6.2): `seats 1–3 ·
 * hire from 3 applicants`, `catch 75–94% by eye · $12–36/day each`.
 */
export function deskRowLines(data: GameData): [string, string] {
  const e = data.employees
  const r = inspectorRanges(data)
  return [
    `seats 1–${e.desks.maxPerDesk} · hire from ${e.applicants.poolSize} applicants`,
    `catch ${Math.round(r.pMin * 100)}–${pctOf(r.pMax)} by eye · ${formatMoney(r.salaryMin)}–${r.salaryMax}/day each`,
  ]
}

/** `Move desk here` detail lines: where it is now, its crew and its mean catch. */
export function moveDeskLines(desk: DeskInfo): [string, string] {
  const n = desk.inspectors
  const crew = `${n} inspector${n === 1 ? '' : 's'}`
  const avg = deskCatchText(desk.meanP, n) ?? 'no inspectors'
  return [
    `${deskTitle(desk.index)} from ${desk.label} · ${crew}`,
    `${avg} · moves are free`,
  ]
}

const WH_FAIL: Partial<Record<string, string>> = {
  'slot-occupied': 'Slot already taken',
  'slot-locked': 'Slot not open yet',
  'desk-full': 'Desk is full',
  'desk-exists': 'That desk is already placed',
  'desk-locked': 'That desk is not open yet',
  'shelf-full': 'Shelf full',
  'no-applicant': 'That applicant took another job',
  'station-locked': 'Not open yet',
  'station-occupied': 'The station is taken',
}

/**
 * Tooltip text for a refused warehouse command (plan.md §5 reason strings;
 * design-m6 §6.2-§6.3). With `data`, the level-gated reasons name their
 * level from employees.json: `Second desk opens at Lv 3`, `Opens at Lv 2`.
 */
export function warehouseFailText(reason: string, data?: GameData): string {
  if (data && reason === 'desk-locked') {
    const row = data.employees.desks.rows.find((r) => r.unlockLevel > 1)
    if (row) return `${deskRowName(row.index)} opens at Lv ${row.unlockLevel}`
  }
  if (data && reason === 'station-locked')
    return `Opens at Lv ${data.employees.holdStation.unlockLevel}`
  return WH_FAIL[reason] ?? failText(reason)
}

/** Title-cased node id when no room layout label is wired: 'slot2' → 'Slot 2'. */
export function fallbackLabel(nodeId: string): string {
  const m = /^([A-Za-z]+)(\d+)$/.exec(nodeId)
  const word = m?.[1] ?? nodeId
  const cap = word.charAt(0).toUpperCase() + word.slice(1)
  return m ? `${cap} ${m[2]}` : cap
}

/** Atlas frame for a machines.json checker: `<id>_f0`, `<id>_sil`, `<id>`, else ic_lock. */
export function machineFrame(defId: string): FrameName {
  return (
    frameOrNull(`${defId}_f0`) ??
    frameOrNull(`${defId}_sil`) ??
    frameOrNull(defId) ??
    'ic_lock'
  )
}

/** The `face_NN` portrait of a person's `look` (null while the art lacks it). */
export function faceFrame(look: number): FrameName | null {
  return frameOrNull(`face_${String(Math.max(0, look)).padStart(2, '0')}`)
}

/** `n` of `max` pips as on/off dots (●●●○○); n is clamped to 0..max. */
export function pipDots(n: number, max: number): boolean[] {
  const on = Math.min(max, Math.max(0, Math.round(n)))
  return Array.from({ length: Math.max(0, max) }, (_, i) => i < on)
}

/**
 * Compact pips of a person in the role's `stats` order (design-m6 §6.2:
 * inspector `●●●○○ ●●●○○ ●○` = eye, pace, charisma; sorter judgement, pace).
 */
export function pipGroups(data: GameData, role: Role, pips: Pips): boolean[][] {
  return data.employees.roles[role].stats.map((stat) =>
    pipDots(pips[stat] ?? 0, pipMax(data, stat)),
  )
}

/** Pip pitch and the gap between two stats (35 + 4 + 35 + 4 + 14 px). */
export const PIP_PITCH = 7
export const PIP_GROUP_GAP = 4
/** The pip frame canvas (ui class, 8 × 8). */
export const PIP_SIZE = 8

/** Width of compact pips: 7 px per pip, 4 px between stats. */
export function pipGroupsWidth(
  groups: readonly (readonly boolean[])[],
): number {
  let w = 0
  groups.forEach((g, i) => {
    w += g.length * PIP_PITCH + (i > 0 ? PIP_GROUP_GAP : 0)
  })
  return w
}

// ---- BuySheet row model ----------------------------------------------------------

export type BuyRowKind = 'machine' | 'desk' | 'moveDesk'

export interface BuyRow {
  kind: BuyRowKind
  /** machines.json checker id; 'desk' (desks.rows index 1) or `desk<N>`. */
  id: string
  name: string
  price: number
  priceText: string
  /** Rows 2 and 3 of the 52-px row. */
  lines: [string, string]
  unlockLevel: number
  locked: boolean
  /** Desk rows: the employees.json desks.rows index. */
  index?: number
  /** M7: a quest voucher pays for this machine (price 0, `FREE`). */
  voucher?: boolean
}

/** A placed desk (for its `Move desk here` row). */
export interface DeskInfo {
  /** employees.json desks.rows index. */
  index: number
  nodeId: string
  label: string
  /** Seated (active) inspectors. */
  inspectors: number
  /** The desk readout p (the mean of its seated inspectors' effective p). */
  meanP: number
}

/** BuyRow id of desk `index` ('desk' for the start desk, e2e `buy:desk`). */
export function deskRowId(index: number): string {
  return index <= 1 ? 'desk' : `desk${index}`
}

/**
 * The BuySheet rows (warehouse-view.md §2.1, §6; design-m6 §6.2): unlocked
 * checkers in machines.json order; one row per open desks.rows entry — place
 * it (unplaced) or `Move desk here` (placed; numbered once two are placed);
 * then the locked checkers and desks by unlock level (stable). M7: an
 * unlocked checker held as a quest voucher (`vouchers`, machines.json ids)
 * costs 0 and reads `FREE` (design-m7 §6.8).
 */
export function buyRows(
  data: GameData,
  level: number,
  placed: readonly DeskInfo[],
  vouchers: readonly string[] = [],
): BuyRow[] {
  const machines: BuyRow[] = data.machines.checkers.map((def) => {
    const locked = def.unlockLevel > level
    const speed = perMinText(def.processS)
    const voucher = !locked && vouchers.includes(def.id)
    const row: BuyRow = {
      kind: 'machine',
      id: def.id,
      name: def.name,
      price: voucher ? 0 : def.price,
      priceText: voucher ? VOUCHER_TEXT : priceText(def.price),
      lines: [
        catchLine(def),
        locked ? `${speed} · ${unlockText(data, def.unlockLevel)}` : speed,
      ],
      unlockLevel: def.unlockLevel,
      locked,
    }
    if (voucher) row.voucher = true
    return row
  })
  const desks: BuyRow[] = []
  const lockedDesks: BuyRow[] = []
  const numbered = placed.length >= 2
  const [seats, catchSalary] = deskRowLines(data)
  for (const row of data.employees.desks.rows) {
    const id = deskRowId(row.index)
    const here = placed.find((d) => d.index === row.index)
    if (here) {
      desks.push({
        kind: 'moveDesk',
        id,
        index: row.index,
        name: numbered ? `Move desk ${row.index} here` : 'Move desk here',
        price: 0,
        priceText: priceText(0),
        lines: moveDeskLines(here),
        unlockLevel: row.unlockLevel,
        locked: false,
      })
      continue
    }
    const locked = row.unlockLevel > level
    const r: BuyRow = {
      kind: 'desk',
      id,
      index: row.index,
      name: deskRowName(row.index),
      price: row.price,
      priceText: priceText(row.price),
      lines: [seats, locked ? unlockText(data, row.unlockLevel) : catchSalary],
      unlockLevel: row.unlockLevel,
      locked,
    }
    if (locked) lockedDesks.push(r)
    else desks.push(r)
  }
  const locked = machines
    .filter((r) => r.locked)
    .concat(lockedDesks)
    .toSorted((a, b) => a.unlockLevel - b.unlockLevel)
  return machines.filter((r) => !r.locked).concat(desks, locked)
}

export type RowState = 'ok' | 'locked' | 'poor'

/**
 * ok, locked (level gate) or poor (price above the balance, §2.5); a
 * voucher row is ok at any balance (M7: the sim spends the voucher).
 */
export function rowState(row: BuyRow, balance: number): RowState {
  if (row.locked) return 'locked'
  if (row.voucher === true) return 'ok'
  return row.price > balance ? 'poor' : 'ok'
}

/** The lane node with `id`, or null. */
export function findNode(vs: ViewSim, id: string): LaneNode | null {
  return vs.lane.nodes().find((n) => n.id === id) ?? null
}

/** An unlocked slot with no fixture (the BuySheet's precondition, §8). */
export function isEmptyLiveSlot(node: LaneNode | null): boolean {
  return !!node && node.kind === 'slot' && !node.locked && !node.fixture
}

/** The first slot holding a desk, or null. */
export function deskNode(nodes: readonly LaneNode[]): LaneNode | null {
  return nodes.find((n) => n.fixture?.kind === 'desk') ?? null
}

/** The slot holding desk `index` (desks.rows), or null. */
export function deskNodeByIndex(
  nodes: readonly LaneNode[],
  index: number,
): LaneNode | null {
  return (
    nodes.find(
      (n) => n.fixture?.kind === 'desk' && n.fixture.index === index,
    ) ?? null
  )
}

/** The Hold Bay node's id (lane.holdBayNodeId; 'hold' in the shipped lane). */
export function holdNodeId(vs: ViewSim): string {
  return vs.lane.nodes().find((n) => n.kind === 'holdBay')?.id ?? 'hold'
}

/**
 * What a card asks the scene to open (design-m6 §6.1-§6.2): the shared
 * HireSheet for `role` seating `target`. The card has closed itself;
 * onDone / onCancel run after the HireSheet closed (to reopen the card).
 */
export interface HireRequest {
  role: Role
  target: HireTarget
  /** 'Hire an inspector' | 'Hire a sorter' | 'Replace Pat'. */
  title: string
  onDone?: (res: CommandResult) => void
  onCancel?: () => void
}

// ---- shared base -------------------------------------------------------------------

/** The HUD layout fields a warehouse sheet reads (computeLayout's Layout fits). */
export interface WarehouseSheetLayout {
  W: number
  H: number
  /** ceil(44 / zoom): minimum hit size per axis. */
  minHit: number
  /** The HUD bottom band; the sheet's bottom edge sits on its top. */
  bottomBar?: { y: number }
  safeBottom?: number
  /** Room layout label lookup (FixedLaneLayout.labelFor). */
  labelFor?: (nodeId: string) => string
}

export interface WarehouseSheetOptions {
  /** Room layout label lookup (FixedLaneLayout.labelFor); wins over L.labelFor. */
  labelFor?: (nodeId: string) => string
  /** Chrome depth (scrim at depth − 1); default the Sheet's 5000. */
  depth?: number
  /**
   * M6: open the shared HireSheet (the scene owns it, design-m6 §6.1). The
   * card closes itself before calling it; without it a Hire is refused.
   */
  openHire?: (req: HireRequest) => void
}

/** Screen y of the sheet's bottom edge: the top of the HUD bottom band. */
export function sheetBottom(L: WarehouseSheetLayout): number {
  return Math.round(
    L.bottomBar?.y ?? L.H - Math.max(0, L.safeBottom ?? 0) - HUD_BOTTOM_H,
  )
}

/** The warehouse sheet that is open (one at a time, §2): at most one entry. */
const openSheets = new Set<WarehouseSheet>()

interface BaseConfig extends WarehouseSheetOptions {
  id: string
  height: number
  frame?: PanelFrame
}

/** Base of BuySheet, SlotCard, HoldBayCard and StationCard (see the header comment). */
export abstract class WarehouseSheet {
  readonly scene: Phaser.Scene
  readonly sheet: Sheet
  protected vs: ViewSim
  protected L: WarehouseSheetLayout
  /** Rebuilt children (sheet-local coordinates). */
  protected readonly content: Phaser.GameObjects.Container
  private labelLookup: ((nodeId: string) => string) | null
  private optsLabel: boolean
  private openedAt = -Infinity
  private sinceRefresh = 0
  private dirty = false
  private binding: SimBinding | null = null
  private destroyed = false
  private hireOpener: ((req: HireRequest) => void) | null

  constructor(
    scene: Phaser.Scene,
    L: WarehouseSheetLayout,
    viewSim: ViewSim,
    cfg: BaseConfig,
  ) {
    this.scene = scene
    this.L = L
    this.vs = viewSim
    this.optsLabel = !!cfg.labelFor
    this.labelLookup = cfg.labelFor ?? L.labelFor ?? null
    this.hireOpener = cfg.openHire ?? null
    this.sheet = new Sheet(scene, {
      height: cfg.height,
      W: L.W,
      H: sheetBottom(L),
      id: cfg.id,
      headerH: HEADER_H,
      scrimAlpha: SCRIM_ALPHA,
      frame: cfg.frame,
      depth: cfg.depth,
      onClose: () => this.onClosing(),
    })
    this.content = scene.add.container(0, 0)
    this.sheet.add(this.content)
    scene.events.on('update', this.onUpdate, this)
    scene.events.once('shutdown', this.destroy, this)
  }

  // ---- public API --------------------------------------------------------

  isOpen(): boolean {
    return this.sheet.isOpen()
  }

  close(instant = false): void {
    this.sheet.close(instant)
  }

  /** Screen y of the sheet's top edge when open. */
  get top(): number {
    return this.sheet.top
  }

  get height(): number {
    return this.sheet.height
  }

  /** Wire the room layout's labelFor (FixedLaneLayout). */
  setLabelFor(fn: ((nodeId: string) => string) | null): void {
    this.labelLookup = fn
    this.optsLabel = !!fn
    if (this.isOpen()) this.dirty = true
  }

  /** Wire the scene's HireSheet opener (WarehouseSheetOptions.openHire). */
  setHireOpener(fn: ((req: HireRequest) => void) | null): void {
    this.hireOpener = fn
  }

  /** Re-fit to a new canvas (pass the new computeLayout result). */
  relayout(L: WarehouseSheetLayout): void {
    this.L = L
    if (!this.optsLabel && L.labelFor) this.labelLookup = L.labelFor
    this.sheet.relayout({ W: L.W, H: sheetBottom(L) }, this.sheet.height)
    if (this.isOpen()) this.rebuild()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    openSheets.delete(this)
    this.binding?.unbind()
    this.binding = null
    this.scene.events.off('update', this.onUpdate, this)
    this.scene.events.off('shutdown', this.destroy, this)
    this.sheet.destroy()
  }

  // ---- for subclasses ------------------------------------------------------

  /** Height for the current target (the sheet is resized to it on rebuild). */
  protected abstract contentHeight(): number
  /** Create every child of `content` for the current target. */
  protected abstract build(): void
  /** False when the target no longer exists (the sheet then closes). */
  protected abstract valid(): boolean
  /** Every REFRESH_MS while open: clock-driven text. */
  protected refresh(): void {}
  /** Every frame while open (after a pending rebuild): sim-tick-driven work. */
  protected frame(): void {}
  /** close() started. */
  protected closed(): void {}

  /** Subscribe sim events (plus game:over → close) for as long as the scene is awake. */
  protected bind(handlers: SimHandlers): void {
    this.binding = bindSim(
      this.scene,
      { ...handlers, 'game:over': () => this.close() },
      () => {
        if (this.isOpen()) this.dirty = true
      },
    )
  }

  /** Rebuild on the next frame (or close if the target is gone). */
  protected markDirty(): void {
    if (this.isOpen()) this.dirty = true
  }

  /** Open (closing any other warehouse sheet) on the target set by the subclass. */
  protected show(): void {
    if (this.destroyed) return
    for (const other of openSheets)
      if (other !== this && other.isOpen()) other.close(true)
    openSheets.clear()
    openSheets.add(this)
    const wasOpen = this.sheet.isOpen()
    this.resize()
    this.clear()
    this.build()
    this.dirty = false
    this.sinceRefresh = 0
    if (!wasOpen) {
      this.openedAt = this.scene.time.now
      this.sheet.open()
    }
  }

  /** Re-validate, resize and rebuild now. */
  protected rebuild(): void {
    this.dirty = false
    if (!this.isOpen()) return
    if (!this.valid()) {
      this.close()
      return
    }
    this.resize()
    this.clear()
    this.build()
  }

  /** `labelFor(nodeId)` of the room layout ('Slot 2'). */
  protected label(nodeId: string): string {
    return this.labelLookup?.(nodeId) ?? fallbackLabel(nodeId)
  }

  /** Wrap a tap handler: ignored while closed or within OPEN_GUARD_MS of opening. */
  protected guard(fn: () => void): () => void {
    return () => {
      if (!this.isOpen()) return
      if (this.scene.time.now - this.openedAt < OPEN_GUARD_MS) return
      fn()
    }
  }

  /** A Button added to `content` (hit ≥ L.minHit). */
  protected button(
    x: number,
    y: number,
    w: number,
    h: number,
    opts: {
      id: string
      label?: string
      face?: 'secondary' | 'primary' | 'red'
      icon?: FrameName | null
      onClick: () => void
      onDisabledTap?: () => void
    },
  ): Button {
    const b = new Button(this.scene, {
      x,
      y,
      w,
      h,
      label: opts.label,
      face: opts.face,
      icon: opts.icon,
      minHit: this.L.minHit,
      id: opts.id,
      onClick: this.guard(opts.onClick),
      onDisabledTap: opts.onDisabledTap
        ? this.guard(opts.onDisabledTap)
        : undefined,
    })
    this.content.add(b)
    return b
  }

  /** A m5x7 line added to `content`. */
  protected text(
    x: number,
    y: number,
    s: string,
    tint: number = THEME.textDark,
    maxWidth?: number,
  ): Phaser.GameObjects.BitmapText {
    const t = addText(this.scene, x, y, s, { tint, maxWidth })
    this.content.add(t)
    return t
  }

  /** An atlas image (origin top-left) added to `content`. */
  protected image(x: number, y: number, frame: FrameName) {
    const img = this.scene.add
      .image(Math.round(x), Math.round(y), UI_ATLAS, frame)
      .setOrigin(0, 0)
    this.content.add(img)
    return img
  }

  /**
   * A refused tap: shake `target` 2 px, `ui:sfx deny` and a tooltip with
   * `text` above it (screen px).
   */
  protected deny(target: Button | null, text: string): void {
    this.scene.game.events.emit(EV_UI_SFX, { name: 'deny' })
    let x = Math.round(this.L.W / 2)
    let y = this.sheet.top
    if (target) {
      this.shake(target)
      x = Math.round(target.x + target.btnWidth / 2)
      y = this.sheet.root.y + target.y
    }
    this.scene.game.events.emit(EV_TOOLTIP, { text, x, y })
  }

  /** deny() with the failure reason of a command result. */
  protected denyResult(target: Button | null, res: CommandResult): void {
    if (!res.ok) this.deny(target, warehouseFailText(res.reason, this.vs.data))
  }

  /**
   * Hand a hire to the scene's HireSheet: this card closes at once and
   * `req.onDone` / `req.onCancel` reopen it. Refused (deny on `btn`) when no
   * opener is wired.
   */
  protected requestHire(req: HireRequest, btn: Button | null): void {
    const open = this.hireOpener
    if (!open) {
      this.deny(btn, warehouseFailText('invalid'))
      return
    }
    this.close(true)
    open(req)
  }

  /** A person's 16×16 face (`face_NN`), or null while the art lacks it. */
  protected face(
    x: number,
    y: number,
    look: number,
  ): Phaser.GameObjects.Image | null {
    const f = faceFrame(look)
    return f ? this.image(x, y, f) : null
  }

  /** Compact pips (`ic_pip_on/off`, 7-px pitch, 4 px between stats); returns the end x. */
  protected pips(
    x: number,
    y: number,
    groups: readonly (readonly boolean[])[],
    alpha = 1,
  ): number {
    const on = frameOrNull('ic_pip_on')
    const off = frameOrNull('ic_pip_off')
    let px = x
    groups.forEach((g, i) => {
      if (i > 0) px += PIP_GROUP_GAP
      for (const lit of g) {
        const f = lit ? on : off
        if (f) this.image(px, y, f).setAlpha(alpha)
        px += PIP_PITCH
      }
    })
    return px
  }

  /**
   * A person's name at (x, y), ellipsized to `maxW`; a ★ applicant-hire is
   * gold with `ic_star` after it (the star counts against `maxW`).
   */
  protected personName(
    x: number,
    y: number,
    name: string,
    star: boolean,
    maxW: number,
    tint: number = THEME.textDark,
  ): Phaser.GameObjects.BitmapText {
    const starFrame = star ? frameOrNull('ic_star') : null
    const room = starFrame ? maxW - STAR_W : maxW
    const t = this.text(x, y, name, star ? STAR_TINT : tint)
    const fit = ellipsize(name, room, (s) => t.setText(s).width)
    t.setText(fit)
    if (starFrame)
      this.image(x + Math.round(t.width) + 1, y + STAR_DY, starFrame)
    return t
  }

  // ---- internals ---------------------------------------------------------

  private resize(): void {
    const h = Math.round(this.contentHeight())
    if (h !== this.sheet.height)
      this.sheet.relayout({ W: this.L.W, H: sheetBottom(this.L) }, h)
  }

  private clear(): void {
    for (const o of this.content.list) this.scene.tweens.killTweensOf(o)
    this.content.removeAll(true)
  }

  private shake(obj: Button): void {
    const prev = obj.getData('shake') as Phaser.Tweens.Tween | undefined
    const x0 = (obj.getData('restX') as number | undefined) ?? obj.x
    prev?.stop()
    obj.setData('restX', x0)
    const tw = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: SHAKE_MS,
      onUpdate: (t) => {
        const v = t.getValue() ?? 0
        obj.setX(x0 + Math.round(SHAKE_PX * Math.sin(v * Math.PI * 4)))
      },
      onComplete: () => obj.setX(x0),
      onStop: () => obj.setX(x0),
    })
    obj.setData('shake', tw)
  }

  private onClosing(): void {
    openSheets.delete(this)
    this.dirty = false
    this.closed()
  }

  private onUpdate(_t: number, delta: number): void {
    if (!this.isOpen()) return
    if (this.dirty) this.rebuild()
    if (!this.isOpen()) return
    this.frame()
    this.sinceRefresh += delta
    if (this.sinceRefresh < REFRESH_MS) return
    this.sinceRefresh = 0
    if (!this.valid()) {
      this.close()
      return
    }
    this.refresh()
  }
}

// ---- BuySheet ------------------------------------------------------------------------

interface RowView {
  model: BuyRow
  btn: Button
  price: Phaser.GameObjects.BitmapText
  parts: (
    | Phaser.GameObjects.Image
    | Phaser.GameObjects.BitmapText
    | Phaser.GameObjects.NineSlice
  )[]
}

export class BuySheet extends WarehouseSheet {
  private node: string | null = null
  private highlight: string | null = null
  private rows: RowView[] = []

  constructor(
    scene: Phaser.Scene,
    L: WarehouseSheetLayout,
    viewSim: ViewSim,
    opts: WarehouseSheetOptions = {},
  ) {
    super(scene, L, viewSim, {
      ...opts,
      id: BUY_SHEET_ID,
      height: buySheetHeight(buyRows(viewSim.data, viewSim.level, []).length),
    })
    const dirty = (): void => this.markDirty()
    this.bind({
      'money:changed': () => this.update(),
      'level:up': dirty,
      'lane:fixturePlaced': dirty,
      'lane:fixtureMoved': dirty,
      'lane:fixtureRemoved': dirty,
      'worker:hired': dirty,
      'worker:fired': dirty,
      'worker:walkedOut': dirty,
      'desk:placed': dirty,
      // M7: a voucher reward lands in quests.vouchers (design-m7 §6.8).
      'quest:completed': dirty,
    })
  }

  /** The slot the sheet is buying for (null while closed). */
  get nodeId(): string | null {
    return this.isOpen() ? this.node : null
  }

  /**
   * Open on an empty live slot (ignored otherwise); `highlight` = a
   * machines.json id whose row pulses (pm:goto's highlight).
   */
  open(nodeId: string, highlight: string | null = null): void {
    if (!isEmptyLiveSlot(findNode(this.vs, nodeId))) return
    this.node = nodeId
    this.highlight = highlight
    this.show()
  }

  /** The current rows (e2e / tests). */
  models(): BuyRow[] {
    const placed: DeskInfo[] = []
    for (const n of this.vs.lane.nodes()) {
      const f = n.fixture
      if (f?.kind !== 'desk') continue
      placed.push({
        index: f.index,
        nodeId: n.id,
        label: this.label(n.id),
        inspectors: f.inspectorIds.length,
        meanP: f.checker.pMatch,
      })
    }
    return buyRows(this.vs.data, this.vs.level, placed, this.vouchers())
  }

  /** M7: machines.json ids held as quest vouchers (oldest first). */
  private vouchers(): readonly string[] {
    return this.vs.quests().vouchers
  }

  /** Screen rect of row `i` while open (e2e taps). */
  rowRect(i: number): { x: number; y: number; w: number; h: number } {
    return {
      x: PAD,
      y: this.sheet.root.y + HEADER_H + i * ROW_PITCH,
      w: this.L.W - 2 * PAD,
      h: ROW_H,
    }
  }

  protected contentHeight(): number {
    return buySheetHeight(this.models().length)
  }

  protected valid(): boolean {
    return !!this.node && isEmptyLiveSlot(findNode(this.vs, this.node))
  }

  protected closed(): void {
    for (const r of this.rows) r.btn.setPulse(false)
    this.highlight = null
  }

  protected build(): void {
    const node = this.node
    if (!node) return
    this.rows = []
    const W = this.L.W
    this.text(PAD + 4, textTop(12, 24), `${this.label(node)} — add a checker`)
    this.models().forEach((m, i) => {
      const y = HEADER_H + i * ROW_PITCH
      const btn = this.button(PAD, y, W - 2 * PAD, ROW_H, {
        id: `buy:${m.id}`,
        onClick: () => this.choose(m, btn),
        onDisabledTap: () => this.denyRow(m, btn),
      })
      const sc = this.scene
      const frame: FrameName =
        m.kind === 'machine' ? machineFrame(m.id) : 'desk'
      const icon = sc.add.image(
        2,
        m.kind === 'machine' ? 2 : 10,
        UI_ATLAS,
        frame,
      )
      icon.setOrigin(0, 0)
      const name = addText(sc, ROW_TEXT_X, ROW_LINE_Y[0], m.name)
      const price = addText(sc, 0, ROW_LINE_Y[0], m.priceText)
      const parts: RowView['parts'] = [icon, name]
      if (m.voucher === true) {
        // M7: a gold FREE tag (ui_tag pill, dark text) instead of the price.
        const tw = Math.round(price.width)
        const w = tw + 2 * VOUCHER_PAD_X
        const x = btn.btnWidth - VOUCHER_TAG_RIGHT - w
        const tag = addPanel(sc, x, VOUCHER_TAG_Y, w, VOUCHER_TAG_H, 'ui_tag')
        price.setPosition(
          x + VOUCHER_PAD_X,
          textTop(VOUCHER_TAG_Y, VOUCHER_TAG_H),
        )
        btn.add(tag)
        parts.push(tag)
      } else price.setX(btn.btnWidth - 8 - Math.round(price.width))
      const l2 = addText(sc, ROW_TEXT_X, ROW_LINE_Y[1], m.lines[0], {
        tint: MUTED,
      })
      const l3 = addText(sc, ROW_TEXT_X, ROW_LINE_Y[2], m.lines[1], {
        tint: m.locked ? RED_TEXT : MUTED,
      })
      btn.add([icon, name, price, l2, l3])
      parts.push(l2, l3)
      this.rows.push({ model: m, btn, price, parts })
    })
    this.update()
  }

  /** Enabled / dimmed / red price per row from the balance (§2.5). */
  private update(): void {
    if (this.rows.length === 0) return
    const bal = this.vs.money
    for (const r of this.rows) {
      const st = rowState(r.model, bal)
      r.btn.setEnabled(st === 'ok')
      const a = st === 'ok' ? 1 : DIM_ALPHA
      for (const p of r.parts) p.setAlpha(a)
      r.price.setTint(st === 'poor' ? RED_TEXT : THEME.textDark)
      r.price.setAlpha(st === 'locked' ? DIM_ALPHA : 1)
      r.btn.setPulse(this.highlight === r.model.id && st !== 'locked')
    }
  }

  private choose(m: BuyRow, btn: Button): void {
    const node = this.node
    if (!node) return
    const lane = this.vs.lane
    let res: CommandResult
    if (m.kind === 'machine') res = lane.buyMachine(m.id, node)
    else if (m.kind === 'desk') res = lane.placeDesk(node, m.index ?? 1)
    else {
      const from = deskNodeByIndex(lane.nodes(), m.index ?? 1)
      if (!from) {
        this.deny(btn, warehouseFailText('invalid'))
        return
      }
      res = lane.moveFixture(from.id, node)
    }
    if (res.ok) this.close()
    else this.denyResult(btn, res)
  }

  private denyRow(m: BuyRow, btn: Button): void {
    if (m.locked) this.deny(btn, unlockText(this.vs.data, m.unlockLevel))
    else this.deny(btn, warehouseFailText('insufficient-funds'))
  }
}
