// Warehouse BuySheet (warehouse-view.md §2.1, §2.5, §6; plan.md §8; spec
// §6.2-§6.3, §6.7) plus the shared base of the three warehouse sheets
// (`WarehouseSheet`, also used by SlotCard and HoldBayCard).
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
//
// Construction (the WarehouseScene owns the instances):
//   new BuySheet(scene, L, viewSim, {labelFor?})  L = computeLayout(...)
//   open(nodeId, highlight?) · close(instant?) · isOpen() · relayout(L)
// `labelFor` is the room layout's `labelFor(nodeId)` ('Slot 2'); it can also
// ride on L (`{...L, labelFor}`) or be set later with setLabelFor(). Without
// it the node id is title-cased ('slot2' → 'Slot 2').
//
// BuySheet.open(nodeId, highlight?) on an empty live slot: height
// 40 + 56 × rows; rows from machines.json + employees.json, unlocked first —
// the unlocked checkers, the desk row, then the locked checkers (dimmed,
// `Unlocks at Lv N` + ` · coming soon` past economy.playtestMaxLevel). A row:
// icon, name, price (red and dimmed when unaffordable), `catch 80% metal ·
// 15% other · false-flag 50%`, `60/min`. The desk row places the desk while
// no desk exists (`maxDesks`), else reads `Move desk here` and moves it.
// Tap → lane.buyMachine / placeDesk / moveFixture; success closes the sheet
// (the scene animates the fixture from lane:fixturePlaced/Moved).
// `highlight` (a machines.json id, pm:goto's highlight) pulses that row.
import type Phaser from 'phaser'
import {
  bindSim,
  getSim,
  type SimBinding,
  type SimHandlers,
} from '../../boot/simBinding.ts'
import type { CheckerDef, GameData } from '../../data/types.ts'
import { UI_ATLAS } from '../../render/atlases.ts'
import { frameOrNull, type FrameName } from '../../render/frames.ts'
import type { CommandResult } from '../../sim/commands.ts'
import type { Sim } from '../../sim/sim.ts'
import type { Employee, LaneNode } from '../../sim/types.ts'
import type { ViewSim } from '../../sim/view-api.ts'
import { Button } from '../Button.ts'
import { HUD_BOTTOM_H } from '../layout.ts'
import type { PanelFrame } from '../Panel.ts'
import { Sheet } from '../Sheet.ts'
import { addText, formatMoney, formatPct, textTop } from '../text.ts'
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

/** `$150`, or `free` for a zero price (the desk, employees.json deskPrice). */
export function priceText(price: number): string {
  return price > 0 ? formatMoney(price) : 'free'
}

/** Display name of the desk fixture (warehouse-view.md §2.1). */
export const DESK_NAME = 'Inspection desk'

/** The desk row's two detail lines (§2.1: seats, catch, speed, salary). */
export function deskRowLines(data: GameData): [string, string] {
  const i = data.employees.inspector
  return [
    `seats 1–${i.maxPerDesk} inspectors · ${pctOf(i.pMatch)} any strain`,
    `${perMinText(i.processS)} each · ${formatMoney(i.salaryPerDay)}/day each`,
  ]
}

/** `Move desk here` detail lines: where it is now and its crew. */
export function moveDeskLines(
  data: GameData,
  fromLabel: string,
  inspectors: number,
): [string, string] {
  const i = data.employees.inspector
  const crew = `${inspectors} inspector${inspectors === 1 ? '' : 's'}`
  return [
    `${DESK_NAME} from ${fromLabel} · ${crew}`,
    `${pctOf(i.pMatch)} any strain · ${perMinText(i.processS)} each · moves are free`,
  ]
}

const WH_FAIL: Partial<Record<string, string>> = {
  'slot-occupied': 'Slot already taken',
  'slot-locked': 'Slot not open yet',
  'desk-full': 'Desk is full',
  'desk-exists': 'Only one desk',
  'shelf-full': 'Shelf full',
}

/** Tooltip text for a refused warehouse command (plan.md §5 reason strings). */
export function warehouseFailText(reason: string): string {
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

// ---- BuySheet row model ----------------------------------------------------------

export type BuyRowKind = 'machine' | 'desk' | 'moveDesk'

export interface BuyRow {
  kind: BuyRowKind
  /** machines.json checker id, or 'desk'. */
  id: string
  name: string
  price: number
  priceText: string
  /** Rows 2 and 3 of the 52-px row. */
  lines: [string, string]
  unlockLevel: number
  locked: boolean
}

/** Where the existing desk is (for `Move desk here`), or null if none exists. */
export interface DeskInfo {
  nodeId: string
  label: string
  inspectors: number
}

/**
 * The BuySheet rows (warehouse-view.md §2.1, §6): unlocked checkers in
 * machines.json order, the desk row (place while fewer than maxDesks desks
 * exist, else `Move desk here`), then the locked checkers.
 */
export function buyRows(
  data: GameData,
  level: number,
  desk: DeskInfo | null,
  deskCount = desk ? 1 : 0,
): BuyRow[] {
  const machines: BuyRow[] = data.machines.checkers.map((def) => {
    const locked = def.unlockLevel > level
    const speed = perMinText(def.processS)
    return {
      kind: 'machine',
      id: def.id,
      name: def.name,
      price: def.price,
      priceText: priceText(def.price),
      lines: [
        catchLine(def),
        locked ? `${speed} · ${unlockText(data, def.unlockLevel)}` : speed,
      ],
      unlockLevel: def.unlockLevel,
      locked,
    }
  })
  const rows = machines.filter((r) => !r.locked)
  const emp = data.employees
  if (deskCount < emp.maxDesks) {
    rows.push({
      kind: 'desk',
      id: 'desk',
      name: DESK_NAME,
      price: emp.deskPrice,
      priceText: priceText(emp.deskPrice),
      lines: deskRowLines(data),
      unlockLevel: 1,
      locked: false,
    })
  } else if (desk) {
    rows.push({
      kind: 'moveDesk',
      id: 'desk',
      name: 'Move desk here',
      price: 0,
      priceText: priceText(0),
      lines: moveDeskLines(data, desk.label, desk.inspectors),
      unlockLevel: 1,
      locked: false,
    })
  }
  return rows.concat(machines.filter((r) => r.locked))
}

export type RowState = 'ok' | 'locked' | 'poor'

/** ok, locked (level gate) or poor (price above the balance, §2.5). */
export function rowState(row: BuyRow, balance: number): RowState {
  if (row.locked) return 'locked'
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

/** The slot holding the desk, or null. */
export function deskNode(nodes: readonly LaneNode[]): LaneNode | null {
  return nodes.find((n) => n.fixture?.kind === 'desk') ?? null
}

/**
 * Inspector names, unpaid marks and walkouts (read-only). The desk fixture
 * only holds employee ids and the facade has no employee list yet, so this
 * prefers a facade `employees` field when one exists and otherwise reads
 * the registry Sim's state (never mutated here).
 */
export function employeesOf(
  vs: ViewSim,
  scene: Phaser.Scene,
): readonly Employee[] {
  const ext = vs as ViewSim & { readonly employees?: readonly Employee[] }
  if (ext.employees) return ext.employees
  return (getSim(scene) as Sim | undefined)?.state.employees ?? []
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

/** Base of BuySheet, SlotCard and HoldBayCard (see the header comment). */
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
    if (!res.ok) this.deny(target, warehouseFailText(res.reason))
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
  parts: (Phaser.GameObjects.Image | Phaser.GameObjects.BitmapText)[]
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
      height: buySheetHeight(buyRows(viewSim.data, viewSim.level, null).length),
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
    const nodes = this.vs.lane.nodes()
    const d = deskNode(nodes)
    const deskCount = nodes.filter((n) => n.fixture?.kind === 'desk').length
    const info: DeskInfo | null =
      d?.fixture?.kind === 'desk'
        ? {
            nodeId: d.id,
            label: this.label(d.id),
            inspectors: d.fixture.inspectorIds.length,
          }
        : null
    return buyRows(this.vs.data, this.vs.level, info, deskCount)
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
      price.setX(btn.btnWidth - 8 - Math.round(price.width))
      const l2 = addText(sc, ROW_TEXT_X, ROW_LINE_Y[1], m.lines[0], {
        tint: MUTED,
      })
      const l3 = addText(sc, ROW_TEXT_X, ROW_LINE_Y[2], m.lines[1], {
        tint: m.locked ? RED_TEXT : MUTED,
      })
      btn.add([icon, name, price, l2, l3])
      this.rows.push({ model: m, btn, price, parts: [icon, name, l2, l3] })
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
    else if (m.kind === 'desk') res = lane.placeDesk(node)
    else {
      const from = deskNode(lane.nodes())
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
