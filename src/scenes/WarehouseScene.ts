// WarehouseScene `Warehouse` (warehouse-view.md §1, §2.3, §3.3-§3.4, §4, §5,
// §7; plan.md §8): the one-screen intake-lane room. No camera pan, no zoom,
// no scroll: a 352 × 448 room container centred between the HUD bands
// (roomPlacement, §1.1) with the lane readout strip glued 24 px above it.
//
// Parts (src/render/warehouse): RoomLayout (FixedLaneLayout, the rect table
// by node id), LaneRenderer (room, slots, Hold Bay, bin, shelf, parcels,
// stall visuals, readout), DockView (door, tail, lamp, status panel),
// WorkerSprites (inspectors), Fx (catch moment, stamps, banner, shake,
// flashes). The three sheets (src/ui/warehouse: BuySheet, SlotCard,
// HoldBayCard) are WarehouseSheets owned here; they call the facade
// themselves and keep one open at a time.
//
// Input (only the primary pointer, §1.14): taps are hit-tested against the
// layout (no interactive objects in the room, so a sheet's scrim or button
// always wins). Empty slot → BuySheet, occupied slot / desk strip →
// SlotCard, held bay → HoldBayCard, everything else → a pm:tooltip (HUD) or
// a 3-s popover (readout strip: per-strain detection; wanted poster: the
// malware labels revealed so far). A 450-ms hold on a fixture lifts it
// (§2.3, own scene-clock timer so the frozen test clock drives it): drop on
// another live slot = lane.moveFixture (the sim swaps when occupied),
// anywhere else snaps back 150 ms. SlotCard's Move uses the same targets
// in tap mode (onMoveRequest).
//
// Sim events through bindSim (attached on create / WAKE, detached on SLEEP /
// SHUTDOWN; syncAll on WAKE and sim swaps). Game events: emits pm:view
// {name: 'warehouse'} on create / wake, pm:tooltip, ui:tap, ui:sfx (deny);
// pm:goto {view: 'warehouse', highlight} arrives as run()/wake data and
// pulses the first empty slot + opens the BuySheet with that row pulsing.
// The city ↔ warehouse transition (§5.3): the City plays its pan / snap /
// fade (nav.ts); this scene fades in 150 ms while the room drops 16 px, and
// fades out 120 ms (transitionOut) on the way back.
import Phaser from 'phaser'
import { REG_ONBOARDING } from '../boot/autosave.ts'
import {
  EV_GOTO,
  EV_VIEW,
  FADE_IN_MS,
  FADE_OUT_MS,
  FADE_RGB,
  type WorldTransition,
  type WorldView,
} from '../boot/nav.ts'
import { bindSim, getSim, getViewSim, REG } from '../boot/simBinding.ts'
import type { GameData } from '../data/types.ts'
import { formatMmSs } from '../render/decayPhase.ts'
import { atlasOf, frameOrNull } from '../render/frames.ts'
import { DockView, lockedDockText } from '../render/warehouse/DockView.ts'
import { Fx, reducedMotion } from '../render/warehouse/Fx.ts'
import {
  createRoomLayers,
  LaneRenderer,
  type RoomLayers,
} from '../render/warehouse/LaneRenderer.ts'
import {
  bayRect,
  BAY_COUNT,
  DOCK_PANEL,
  FixedLaneLayout,
  POSTER,
  POSTER_HIT,
  READOUT_GAP,
  READOUT_H,
  ROOM_W,
  roomPlacement,
  SIGN,
  type Point,
  type Rect,
} from '../render/warehouse/RoomLayout.ts'
import { WorkerSprites } from '../render/warehouse/WorkerSprites.ts'
import type { SimEventPayloads } from '../sim/events.ts'
import type { OnboardingSave } from '../sim/save.ts'
import type { Employee, LaneNode, Strain } from '../sim/types.ts'
import type { ViewSim } from '../sim/view-api.ts'
import { computeLayout, type Layout } from '../ui/layout.ts'
import { addPanel } from '../ui/Panel.ts'
import { claimKey } from '../ui/Sheet.ts'
import { laneReadout, strainRows, TONE_TEXT } from '../ui/ShieldPopover.ts'
import { addText, textTop } from '../ui/text.ts'
import { PALETTE, THEME } from '../ui/theme.ts'
import { BuySheet, warehouseFailText } from '../ui/warehouse/BuySheet.ts'
import { HoldBayCard } from '../ui/warehouse/HoldBayCard.ts'
import { SlotCard } from '../ui/warehouse/SlotCard.ts'

export const EV_TOOLTIP = 'pm:tooltip'
export const EV_UI_TAP = 'ui:tap'
export const EV_UI_SFX = 'ui:sfx'

/** §2.3 long-press lift and the tap slop. */
export const HOLD_MS = 450
export const TAP_PX = 8
export const SNAP_BACK_MS = 150
export const GHOST_ALPHA = 0.7
/** §5.3 entry: the room drops 16 px under the fade-in. */
export const ENTRY_DROP_PX = 16
/** Popovers (readout strip, wanted poster) auto-close after 3 s. */
export const POPOVER_MS = 3000
export const POPOVER_DEPTH = 4000
/** pm:goto highlight: the target slot pulses this long. */
export const HIGHLIGHT_MS = 3000
const READOUT_REFRESH_MS = 250
const SHEET_DELAY_MS = 200

type Pick =
  | { kind: 'slot'; nodeId: string; rect: Rect }
  | { kind: 'bay'; bay: number; rect: Rect }
  | { kind: 'bin'; rect: Rect }
  | { kind: 'shelf'; rect: Rect }
  | { kind: 'dock'; rect: Rect }
  | { kind: 'lockedDock'; index: number; rect: Rect }
  | { kind: 'ext'; rect: Rect }
  | { kind: 'poster'; rect: Rect }
  | { kind: 'sign'; rect: Rect }
  | { kind: 'readout'; rect: Rect }

interface Press {
  pointer: Phaser.Input.Pointer
  pick: Pick | null
  x0: number
  y0: number
  t0: number
  moved: boolean
  lifted: boolean
}

interface Drag {
  from: string
  ghost: Phaser.GameObjects.Image
  dx: number
  dy: number
}

/** One popover line: optional icon frame, text, tint. */
interface PopRow {
  icon: string | null
  text: string
  tint: number
}

export interface WarehouseInit {
  highlight?: string
}

/** "Slots 5–6 — unlock at Lv 4 and Lv 5 · coming soon" (§6). */
export function extTooltip(
  data: GameData,
  locked: readonly { id: string; level: number }[],
): string {
  const lv = locked.map((x) => x.level)
  const soon = lv.some((l) => l > data.economy.playtestMaxLevel)
    ? ' · coming soon'
    : ''
  const nums = locked.map((x) => x.id.replace(/\D+/g, '')).join('–')
  const lvls = lv.map((l) => `Lv ${l}`).join(' and ')
  return `Slots ${nums} — unlock at ${lvls}${soon}`
}

/** "Slot 4 — unlocks at Lv 2" (+ " · coming soon" past the playtest cap). */
export function lockedSlotTooltip(
  data: GameData,
  label: string,
  level: number,
): string {
  const soon = level > data.economy.playtestMaxLevel ? ' · coming soon' : ''
  return `${label} — unlocks at Lv ${level}${soon}`
}

/** Wanted-poster rows: revealed malware labels grouped by strain (§5.1). */
export function wantedGroups(
  data: GameData,
  wanted: readonly string[],
): { strain: Strain | null; labels: string[] }[] {
  const out = new Map<Strain | null, string[]>()
  const byLabel = new Map<string, Strain>()
  for (const [s, labels] of Object.entries(data.puns.malwareLabels))
    for (const l of labels) byLabel.set(l, s as Strain)
  for (const label of wanted) {
    const s = byLabel.get(label) ?? null
    const list = out.get(s) ?? []
    if (!list.includes(label)) list.push(label)
    out.set(s, list)
  }
  return [...out.entries()].map(([strain, labels]) => ({ strain, labels }))
}

export class WarehouseScene extends Phaser.Scene implements WorldTransition {
  private vs!: ViewSim
  private gd!: GameData
  private layout!: FixedLaneLayout
  private L!: Layout
  private roomX = 0
  private roomY = 0
  private layers!: RoomLayers
  private fx!: Fx
  private lane!: LaneRenderer
  private dock!: DockView
  private workers!: WorkerSprites
  private buy: BuySheet | null = null
  private slotCard: SlotCard | null = null
  private holdCard: HoldBayCard | null = null
  private press: Press | null = null
  private drag: Drag | null = null
  private moveFrom: string | null = null
  private popover: Phaser.GameObjects.Container | null = null
  private popoverTimer: Phaser.Time.TimerEvent | null = null
  private closeCalls = new Map<number, boolean>()
  private pendingHighlight: string | null = null
  private readoutAcc = 0
  private transitioning = false
  private entryTween: Phaser.Tweens.Tween | null = null

  constructor() {
    super('Warehouse')
  }

  init(data?: WarehouseInit): void {
    this.press = null
    this.drag = null
    this.moveFrom = null
    this.popover = null
    this.popoverTimer = null
    this.closeCalls = new Map()
    this.pendingHighlight = data?.highlight ?? null
    this.readoutAcc = 0
    this.transitioning = false
    this.entryTween = null
    this.buy = null
    this.slotCard = null
    this.holdCard = null
  }

  create(): void {
    this.vs = getViewSim(this)
    this.gd = this.vs.data
    this.layout = new FixedLaneLayout()
    this.cameras.main.setBackgroundColor(PALETTE.outline)
    this.L = this.computeL()
    const place = this.placement()
    this.roomX = place.roomX
    this.roomY = place.roomY
    this.layers = createRoomLayers(this, this.roomX, this.roomY)
    this.fx = new Fx(this, this.layers.fx)
    this.lane = new LaneRenderer(
      this,
      this.layers,
      this.layout,
      this.vs,
      this.fx,
    )
    this.dock = new DockView(this, this.layers, this.vs)
    this.workers = new WorkerSprites(
      this,
      this.layers,
      this.layout,
      this.vs,
      () => this.employees(),
    )
    this.buildSheets()
    this.installInput()
    this.installGameEvents()

    bindSim(
      this,
      {
        'parcel:flagged': (p) => this.onFlagged(p),
        'parcel:tossed': (p) => this.onTossed(p),
        'parcel:cleared_by_player': (p) => this.lane.onCleared(p.id),
        'lane:fixturePlaced': (p) => this.lane.onFixturePlaced(p.nodeId),
        'lane:fixtureMoved': () => this.lane.syncSlots(),
        'lane:fixtureRemoved': () => this.lane.syncSlots(),
        'lane:stalled': () => this.lane.refreshReadout(),
        'lane:resumed': () => this.lane.refreshReadout(),
        'worker:walkedOut': (p) => this.workers.onWalkedOut(p.employeeId),
        'level:up': () => this.lane.onLevelUp(),
        'life:lost': () => this.lane.onLifeLost(),
        'day:ended': () => this.lane.refreshSign(),
        'game:over': () => this.onGameOver(),
      },
      () => this.syncAll(),
    )

    this.events.on(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.events.on(Phaser.Scenes.Events.SLEEP, this.onSleep, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this)
    this.syncAll()
    this.enter()
    this.game.events.emit(EV_VIEW, { name: 'warehouse' })
  }

  // ---------------------------------------------------------------- lifecycle

  private onWake(_sys: unknown, data?: WarehouseInit): void {
    this.transitioning = false
    this.pendingHighlight = data?.highlight ?? null
    // bindSim's own WAKE handler already re-attached and ran syncAll().
    this.relayout()
    this.enter()
    this.game.events.emit(EV_VIEW, { name: 'warehouse' })
  }

  private onSleep(): void {
    this.cancelPress()
    this.closePopover()
    this.closeSheets(true)
    this.fx.clear()
    this.lane.clearTransient()
    this.cameras.main.resetFX()
    this.entryTween?.stop()
    this.entryTween = null
    this.layers.root.setY(this.roomY)
  }

  private onShutdown(): void {
    this.events.off(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.events.off(Phaser.Scenes.Events.SLEEP, this.onSleep, this)
    this.removeGameEvents()
    this.cancelPress()
    this.closePopover()
    this.lane.destroy()
    this.dock.destroy()
    this.workers.destroy()
  }

  /** §5.3 entry: fade in 150 ms while the room drops 16 px into place. */
  private enter(): void {
    const cam = this.cameras.main
    cam.resetFX()
    const root = this.layers.root
    this.entryTween?.stop()
    if (!this.game.loop.running || reducedMotion()) {
      root.setY(this.roomY)
    } else {
      cam.fadeIn(FADE_IN_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2])
      root.setY(this.roomY - ENTRY_DROP_PX)
      this.entryTween = this.tweens.add({
        targets: root,
        y: this.roomY,
        duration: FADE_IN_MS,
        ease: 'Quad.easeOut',
        onUpdate: () => root.setY(Math.round(root.y)),
        onComplete: () => {
          this.entryTween = null
          root.setY(this.roomY)
        },
      })
    }
    if (this.pendingHighlight) {
      const id = this.pendingHighlight
      this.pendingHighlight = null
      this.time.delayedCall(SHEET_DELAY_MS, () => this.highlight(id))
    }
  }

  /** nav.ts: the warehouse → city exit (close everything, 120 ms fade). */
  transitionOut(_to: WorldView, done: () => void): void {
    this.transitioning = true
    this.cancelPress()
    this.closePopover()
    this.closeSheets(true)
    const cam = this.cameras.main
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, done)
    cam.fadeOut(FADE_OUT_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2])
  }

  /** Rebuild every dynamic part from sim state (create, WAKE, sim swap). */
  private syncAll(): void {
    this.closeCalls.clear()
    this.lane.syncAll()
    this.dock.syncAll()
    this.workers.syncAll()
  }

  private employees(): readonly Employee[] {
    const ext = this.vs as ViewSim & { employees?: readonly Employee[] }
    return ext.employees ?? getSim(this)?.state.employees ?? []
  }

  // ---------------------------------------------------------------- layout

  private computeL(): Layout {
    const st = (this.registry.get(REG.safeTop) as number | undefined) ?? 0
    const sb = (this.registry.get(REG.safeBottom) as number | undefined) ?? 0
    return computeLayout(
      this.scale.width,
      this.scale.height,
      st,
      sb,
      this.scale.zoom,
    )
  }

  private placement() {
    const L = this.L
    return roomPlacement(L.W, L.ticker.y + L.ticker.h, L.bottomBar.y)
  }

  private relayout(): void {
    this.L = this.computeL()
    const p = this.placement()
    this.roomX = p.roomX
    this.roomY = p.roomY
    if (!this.entryTween) this.layers.root.setPosition(this.roomX, this.roomY)
    else this.layers.root.setX(this.roomX)
    const sheetL = {
      ...this.L,
      labelFor: (id: string) => this.layout.labelFor(id),
    }
    this.buy?.relayout(sheetL)
    this.slotCard?.relayout(sheetL)
    this.holdCard?.relayout(sheetL)
    this.closePopover()
  }

  /** Room px → screen px. */
  private toScreen(x: number, y: number): Point {
    return { x: Math.round(this.roomX + x), y: Math.round(this.roomY + y) }
  }

  // ---------------------------------------------------------------- sheets

  private buildSheets(): void {
    const opts = { labelFor: (id: string) => this.layout.labelFor(id) }
    this.buy = new BuySheet(this, this.L, this.vs, opts)
    this.slotCard = new SlotCard(this, this.L, this.vs, opts)
    this.holdCard = new HoldBayCard(this, this.L, this.vs, opts)
    this.slotCard.onMoveRequest((nodeId) => this.beginMove(nodeId))
  }

  private anySheetOpen(): boolean {
    return Boolean(
      this.buy?.isOpen() || this.slotCard?.isOpen() || this.holdCard?.isOpen(),
    )
  }

  private closeSheets(instant = false): void {
    this.buy?.close(instant)
    this.slotCard?.close(instant)
    this.holdCard?.close(instant)
    this.workers?.showNames(null)
  }

  // ---------------------------------------------------------------- game events

  private onResize = (): void => this.relayout()
  private onRegistry = (_p: unknown, key: string): void => {
    if (key === REG.safeTop || key === REG.safeBottom) this.relayout()
  }

  /**
   * pm:goto {view: 'warehouse', highlight} while this room is already awake
   * (the lost-life card's Open warehouse): nav.ts drops a goto to the awake
   * scene, so the highlight is handled here. Asleep, nav's run() data does it.
   */
  private onGotoAwake = (p: { view: WorldView; highlight?: string }): void => {
    if (p.view !== 'warehouse' || !p.highlight) return
    if (!this.sys.isActive() || this.sys.isSleeping() || this.transitioning)
      return
    const id = p.highlight
    this.time.delayedCall(SHEET_DELAY_MS, () => this.highlight(id))
  }

  private installGameEvents(): void {
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize)
    this.registry.events.on('changedata', this.onRegistry)
    this.input.keyboard?.on('keydown', this.onKey, this)
    this.game.events.on(EV_GOTO, this.onGotoAwake)
  }

  private removeGameEvents(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize)
    this.registry.events.off('changedata', this.onRegistry)
    this.input.keyboard?.off('keydown', this.onKey, this)
    this.game.events.off(EV_GOTO, this.onGotoAwake)
  }

  /** Esc / Android back → the city (§1.10), unless a modal owns the key. */
  private onKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || ev.repeat) return
    if (this.drag || this.moveFrom) {
      if (claimKey(ev, null)) this.cancelPress()
      this.endMove()
      return
    }
    if (this.anySheetOpen() || this.transitioning) return
    if (!claimKey(ev, null)) return
    this.game.events.emit(EV_GOTO, { view: 'city' })
  }

  private onGameOver(): void {
    this.cancelPress()
    this.endMove()
    this.closePopover()
    this.closeSheets()
    this.lane.clearTransient()
  }

  // ---------------------------------------------------------------- sim effects

  private onFlagged(p: SimEventPayloads['parcel:flagged']): void {
    this.closeCalls.set(p.id, this.isLastChecker(p.nodeId))
    this.lane.onFlagged(p.id, p.nodeId, () => {
      this.workers.jump()
      this.fx.shake()
    })
  }

  /**
   * §3.4 "flaggedByLastChecker": no live node downstream of the flagging
   * slot (along `next` edges) holds a fixture with ≥ 1 station.
   */
  private isLastChecker(nodeId: string): boolean {
    const nodes = this.vs.lane.nodes()
    const byId = new Map(nodes.map((n) => [n.id, n]))
    let cur = byId.get(nodeId)
    for (let guard = 0; cur && guard <= nodes.length; guard++) {
      const nextId = cur.next[0]
      const next = nextId === undefined ? undefined : byId.get(nextId)
      if (!next || next.kind !== 'slot') return true
      if (!next.locked && next.fixture && next.stations.length > 0) return false
      cur = next
    }
    return true
  }

  private onTossed(p: SimEventPayloads['parcel:tossed']): void {
    const parcel = this.vs.parcel(p.id)
    let closeCall = this.closeCalls.get(p.id)
    if (closeCall === undefined) {
      const slot = parcel ? this.flaggingNode(parcel.flaggedBy) : null
      closeCall = slot ? this.isLastChecker(slot) : false
    }
    this.closeCalls.delete(p.id)
    this.lane.onTossed({
      id: p.id,
      wasMalware: p.wasMalware,
      bounty: p.bounty,
      closeCall,
      label: parcel?.label ?? '',
    })
  }

  private flaggingNode(checkerId: string | null): string | null {
    if (!checkerId) return null
    const n = this.vs.lane
      .nodes()
      .find((x) => x.fixture?.checker.id === checkerId)
    return n?.id ?? null
  }

  // ---------------------------------------------------------------- highlight

  /** pm:goto {view: 'warehouse', highlight: machineId} (§1.9 / city §5.3). */
  private highlight(machineId: string): void {
    const empty = this.firstEmptySlot()
    if (!empty) {
      const r = this.lane.readoutRect()
      this.tooltip('No empty slot — move or sell a machine', {
        x: r.x + r.w / 2,
        y: r.y + r.h,
      })
      return
    }
    this.lane.pulseSlot(empty, PALETTE.blue1, HIGHLIGHT_MS)
    if (!this.anySheetOpen()) this.buy?.open(empty, machineId)
  }

  private firstEmptySlot(): string | null {
    const live = new Set(this.lane.liveSlotIds())
    const n = this.vs.lane
      .nodes()
      .find((x) => live.has(x.id) && !x.locked && x.fixture === null)
    return n?.id ?? null
  }

  // ---------------------------------------------------------------- input

  private installInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this)
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this)
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this)
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onCancel, this)
    this.input.on(Phaser.Input.Events.GAME_OUT, this.onCancel, this)
  }

  private isPrimary(p: Phaser.Input.Pointer): boolean {
    return p === this.input.activePointer || p.id <= 1
  }

  private onDown(
    p: Phaser.Input.Pointer,
    over: Phaser.GameObjects.GameObject[],
  ): void {
    if (!this.isPrimary(p) || this.press) return
    if (over.length > 0 || this.anySheetOpen() || this.transitioning) return
    if (this.popover) {
      this.closePopover()
      return
    }
    this.press = {
      pointer: p,
      pick: this.pick(p.x - this.roomX, p.y - this.roomY),
      x0: p.x,
      y0: p.y,
      t0: this.time.now,
      moved: false,
      lifted: false,
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const press = this.press
    if (!press || press.pointer !== p) return
    if (Math.hypot(p.x - press.x0, p.y - press.y0) > TAP_PX) press.moved = true
    if (this.drag) {
      this.drag.ghost.setPosition(
        Math.round(p.x - this.roomX - this.drag.dx),
        Math.round(p.y - this.roomY - this.drag.dy),
      )
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const press = this.press
    if (!press || press.pointer !== p) return
    this.press = null
    if (press.lifted) {
      this.drop(p.x - this.roomX, p.y - this.roomY)
      return
    }
    if (press.moved || !press.pick) {
      if (this.moveFrom && !press.moved) this.endMove()
      return
    }
    this.tap(press.pick)
  }

  private onCancel(): void {
    this.cancelPress()
  }

  private cancelPress(): void {
    this.press = null
    if (this.drag) this.snapBack()
  }

  /** The hit target under room point (x, y), most specific first. */
  private pick(x: number, y: number): Pick | null {
    const lay = this.layout
    const rr = this.lane.readoutRect()
    const readout = { x: rr.x, y: rr.y - 6, w: rr.w, h: rr.h + 12 }
    if (inside(readout, x, y)) return { kind: 'readout', rect: rr }
    if (inside(POSTER_HIT, x, y)) return { kind: 'poster', rect: { ...POSTER } }
    const signR = { ...SIGN }
    if (inside(signR, x, y)) return { kind: 'sign', rect: signR }
    for (let i = 0; i < BAY_COUNT; i++) {
      const r = bayRect(i)
      if (inside(r, x, y)) return { kind: 'bay', bay: i, rect: r }
    }
    const lockedDoor = this.dock.lockedDoorAt(x, y)
    if (lockedDoor !== null) {
      const r = { x: 0, y: 100 + 64 * lockedDoor, w: 32, h: 56 }
      return { kind: 'lockedDock', index: lockedDoor, rect: r }
    }
    // The desk's west strip belongs to the desk slot (§1.3).
    for (const n of this.vs.lane.nodes()) {
      if (n.fixture?.kind !== 'desk') continue
      const h = lay.deskHit(n.id)
      if (h && inside(h, x, y))
        return { kind: 'slot', nodeId: n.id, rect: lay.rectFor(n.id) as Rect }
    }
    const panel = DockView.panel
    if (inside(panel, x, y)) return { kind: 'dock', rect: { ...DOCK_PANEL } }
    const id = lay.nodeAt(x, y)
    if (!id) return null
    const r = lay.rectFor(id) as Rect
    if (id === 'bin') return { kind: 'bin', rect: r }
    if (id === 'shelf') return { kind: 'shelf', rect: r }
    if (id === 'dock1') return { kind: 'dock', rect: lay.hitFor(id) as Rect }
    if (id === 'hold') return null
    if (!lay.isBeltSlot(id)) return { kind: 'ext', rect: lay.extRect() }
    return { kind: 'slot', nodeId: id, rect: r }
  }

  private node(id: string): LaneNode | null {
    return this.vs.lane.nodes().find((n) => n.id === id) ?? null
  }

  private tap(pick: Pick): void {
    this.game.events.emit(EV_UI_TAP, { id: `wh:${pick.kind}` })
    this.fx.flash(pick.rect)
    if (this.moveFrom) {
      const from = this.moveFrom
      this.endMove()
      if (pick.kind === 'slot' && pick.nodeId !== from) {
        this.tryMove(from, pick.nodeId, pick.rect)
      }
      return
    }
    const top = this.toScreen(pick.rect.x + pick.rect.w / 2, pick.rect.y)
    switch (pick.kind) {
      case 'slot':
        this.tapSlot(pick.nodeId, top)
        return
      case 'bay':
        this.tapBay(pick.bay, top)
        return
      case 'bin': {
        const q = this.vs.quarantine
        this.tooltip(
          `Quarantine: ${q.count} tossed (${q.malware} malware, ${q.clean} clean)`,
          top,
        )
        return
      }
      case 'shelf':
        this.tooltip(this.shelfText(), top)
        return
      case 'dock':
        this.tooltip(this.dock.tooltipText(), top)
        return
      case 'lockedDock':
        this.tooltip(lockedDockText(this.gd, pick.index) ?? '', top)
        return
      case 'ext': {
        const locked = this.vs.lane
          .nodes()
          .filter(
            (n) =>
              n.locked && !this.layout.isBeltSlot(n.id) && n.kind === 'slot',
          )
          .map((n) => ({ id: n.id, level: n.locked?.level ?? 0 }))
        if (locked.length > 0) this.tooltip(extTooltip(this.gd, locked), top)
        return
      }
      case 'sign': {
        const n = this.vs.daysSinceIncident
        this.tooltip(
          `${n} day${n === 1 ? '' : 's'} since the last incident`,
          top,
        )
        return
      }
      case 'poster':
        this.openWanted()
        return
      case 'readout':
        this.openStrains()
        return
    }
  }

  private tapSlot(nodeId: string, top: Point): void {
    const n = this.node(nodeId)
    if (!n) return
    if (n.locked) {
      const text = lockedSlotTooltip(
        this.gd,
        this.layout.labelFor(nodeId),
        n.locked.level,
      )
      this.tooltip(text, top)
      return
    }
    if (n.fixture) {
      this.slotCard?.open(nodeId)
      if (n.fixture.kind === 'desk') this.workers.showNames(nodeId)
      return
    }
    this.buy?.open(nodeId)
  }

  private tapBay(bay: number, top: Point): void {
    const id = this.lane.heldAt(bay)
    if (id !== null) {
      this.holdCard?.open(id)
      return
    }
    const cap = this.vs.holdBay.cap
    if (bay >= cap) {
      const lv = this.lane.bayUnlockLevel(bay)
      const soon =
        lv !== null && lv > this.gd.economy.playtestMaxLevel
          ? ' · coming soon'
          : ''
      this.tooltip(
        `Hold Bay ${bay + 1} — unlocks at Lv ${lv ?? '?'}${soon}`,
        top,
      )
      return
    }
    this.tooltip(
      `Hold Bay ${this.vs.holdBay.count}/${cap} · flagged parcels wait here`,
      top,
    )
  }

  private shelfText(): string {
    const s = this.vs.shelf
    const oldest = s.ids[0]
    const p = oldest === undefined ? null : this.vs.parcel(oldest)
    const since = p?.nodeEnterTick ?? null
    const age =
      since === null
        ? ''
        : ` · oldest ${formatMmSs((this.vs.tick - since) / 10)} ago`
    return `Shelf ${s.ids.length}/${s.cap}${age}`
  }

  private tooltip(text: string, at: Point): void {
    if (!text) return
    this.game.events.emit(EV_TOOLTIP, { text, x: at.x, y: at.y })
  }

  // ---------------------------------------------------------------- move / drag

  /** SlotCard → Move: highlight the other slots, the next slot tap moves. */
  beginMove(nodeId: string): void {
    this.closeSheets()
    this.moveFrom = nodeId
    this.lane.showCandidates(nodeId)
    const r = this.layout.rectFor(nodeId)
    if (r) {
      this.tooltip(
        'Tap a slot to move it there',
        this.toScreen(r.x + r.w / 2, r.y),
      )
    }
  }

  private endMove(): void {
    if (this.moveFrom === null) return
    this.moveFrom = null
    if (!this.drag) this.lane.showCandidates(null)
  }

  private tryMove(from: string, to: string, rect: Rect): boolean {
    const target = this.node(to)
    if (!target || target.locked || !this.layout.isBeltSlot(to)) return false
    const res = this.vs.lane.moveFixture(from, to)
    if (res.ok) return true
    this.game.events.emit(EV_UI_SFX, { name: 'deny' })
    this.tooltip(
      warehouseFailText(res.reason),
      this.toScreen(rect.x + rect.w / 2, rect.y),
    )
    return false
  }

  /** §2.3 long-press: lift the fixture as a 70 % ghost under the finger. */
  private lift(press: Press): void {
    const pick = press.pick
    if (!pick || pick.kind !== 'slot') return
    const n = this.node(pick.nodeId)
    if (!n || n.locked || !n.fixture) return
    const src = this.lane.fixtureImage(pick.nodeId)
    if (!src) return
    press.lifted = true
    this.endMove()
    // the ghost copies the fixture's own texture (interior, or world for a
    // frame only that atlas holds — tools/art/atlas.ts)
    const ghost = this.add
      .image(src.x, src.y, src.texture.key, src.frame.name)
      .setOrigin(0, 0)
      .setAlpha(GHOST_ALPHA)
    this.layers.fx.add(ghost)
    const px = press.pointer.x - this.roomX
    const py = press.pointer.y - this.roomY
    this.drag = { from: pick.nodeId, ghost, dx: px - src.x, dy: py - src.y }
    this.lane.setLifted(pick.nodeId)
    this.lane.showCandidates(pick.nodeId)
    this.game.events.emit(EV_UI_TAP, { id: 'wh:lift' })
  }

  private drop(x: number, y: number): void {
    const drag = this.drag
    if (!drag) return
    const to = this.layout.nodeAt(x, y)
    const target = to ? this.node(to) : null
    const ok =
      to !== null &&
      to !== drag.from &&
      target !== null &&
      target.kind === 'slot' &&
      !target.locked &&
      this.layout.isBeltSlot(to) &&
      this.tryMove(drag.from, to, this.layout.rectFor(to) as Rect)
    if (!ok) {
      this.snapBack()
      return
    }
    drag.ghost.destroy()
    this.drag = null
    this.lane.setLifted(null)
    this.lane.showCandidates(null)
    this.lane.syncSlots()
  }

  /** 150 ms snap back to the source slot, then the fixture reappears. */
  private snapBack(): void {
    const drag = this.drag
    if (!drag) return
    this.drag = null
    const src = this.lane.fixtureImage(drag.from)
    const home = src
      ? { x: src.x, y: src.y }
      : { x: drag.ghost.x, y: drag.ghost.y }
    this.tweens.add({
      targets: drag.ghost,
      x: home.x,
      y: home.y,
      duration: SNAP_BACK_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        drag.ghost.destroy()
        this.lane.setLifted(null)
        this.lane.showCandidates(null)
      },
    })
  }

  // ---------------------------------------------------------------- popovers

  private closePopover(): void {
    this.popoverTimer?.remove(false)
    this.popoverTimer = null
    this.popover?.destroy()
    this.popover = null
  }

  /**
   * A 3-s `ui_panel` popover at screen (x, y) (top-left), clamped on screen;
   * `rows` are [icon frame | null, text, tint] lines under `title`.
   */
  private showPopover(
    title: string,
    rows: readonly PopRow[],
    anchor: Point,
    w = 240,
  ): void {
    this.closePopover()
    const pad = 8
    const parts: Phaser.GameObjects.GameObject[] = []
    const head = addText(this, pad, 0, title, { tint: THEME.textDark })
    head.setY(textTop(4, 16))
    let y = 24
    const lines: Phaser.GameObjects.GameObject[] = [head]
    for (const r of rows) {
      let x = pad
      if (r.icon && frameOrNull(r.icon)) {
        // on a ui_panel with text: the icon's home atlas (world for the
        // shared icons) batches with the panel and the BitmapText
        const ic = this.add
          .image(x, y + 2, atlasOf(r.icon), r.icon)
          .setOrigin(0, 0)
        lines.push(ic)
        x += 20
      }
      const t = addText(this, x, 0, r.text, {
        tint: r.tint,
        maxWidth: w - x - pad,
      })
      const n = Math.max(1, Math.round(t.height / 14))
      t.setY(textTop(y, 20 + 14 * (n - 1), n))
      lines.push(t)
      y += 20 + 14 * (n - 1)
    }
    const h = y + 6
    const panel = addPanel(this, 0, 0, w, h, 'ui_panel')
    parts.push(panel, ...lines)
    const x = Math.round(Math.min(this.L.W - w - 4, Math.max(4, anchor.x)))
    const top = Math.round(Math.min(this.L.H - h - 4, Math.max(4, anchor.y)))
    this.popover = this.add.container(x, top, parts).setDepth(POPOVER_DEPTH)
    this.popoverTimer = this.time.delayedCall(POPOVER_MS, () =>
      this.closePopover(),
    )
  }

  /** Readout tap (§1.9): one line per announced strain, weakest first. */
  private openStrains(): void {
    const stats = this.vs.laneStats()
    const rows = strainRows(stats, this.gd).toSorted((a, b) => a.pct - b.pct)
    const out: PopRow[] = rows.map((r) => ({
      icon: `ic_strain_${r.strain}`,
      text: r.counter ? `${r.text} ${r.counter.text}` : r.text,
      tint: TONE_TEXT[r.tone],
    }))
    if (out.length === 0)
      out.push({
        icon: null,
        text: 'No strain announced yet',
        tint: PALETTE.grey1,
      })
    const rr = this.lane.readoutRect()
    const w = 240
    const at = this.toScreen(rr.x + (ROOM_W - w) / 2, rr.y + rr.h + 2)
    // The city shield popover's header (`Lane 15/min · Detection 97%`): the
    // bare `… · Detection` read as a cut-off title (UX M3 review).
    this.showPopover(laneReadout(stats), out, at, w)
  }

  /** Wanted poster tap (§5.1): malware labels revealed so far, by strain. */
  private openWanted(): void {
    const ob = this.registry.get(REG_ONBOARDING) as OnboardingSave | undefined
    const groups = wantedGroups(this.gd, ob?.wanted ?? [])
    const rows: PopRow[] = groups.map((g) => ({
      icon: g.strain ? `ic_strain_${g.strain}` : null,
      text: g.labels.join(', '),
      tint: THEME.malware,
    }))
    if (rows.length === 0)
      rows.push({
        icon: null,
        text: 'No malware caught yet',
        tint: PALETTE.grey1,
      })
    const w = 260
    const at = this.toScreen((ROOM_W - w) / 2, POSTER.y - 40)
    this.showPopover(this.gd.puns.wantedTitle, rows, at, w)
  }

  // ---------------------------------------------------------------- frame

  update(time: number, delta: number): void {
    const press = this.press
    if (
      press &&
      !press.lifted &&
      !press.moved &&
      press.pointer.isDown &&
      time - press.t0 >= HOLD_MS
    ) {
      this.lift(press)
    }
    this.lane.update(time, delta)
    this.dock.update(time, delta)
    this.workers.update(time, delta)
    if (!this.slotCard?.isOpen()) this.workers.showNames(null)
    this.readoutAcc += delta
    if (this.readoutAcc >= READOUT_REFRESH_MS) {
      this.readoutAcc = 0
      this.lane.refreshReadout()
      this.lane.refreshSign()
    }
  }

  /** Debug / e2e: what the room shows right now. */
  stats(): {
    roomX: number
    roomY: number
    readout: Rect
    sheetOpen: boolean
  } {
    return {
      roomX: this.roomX,
      roomY: this.roomY,
      readout: {
        x: this.roomX,
        y: this.roomY - READOUT_GAP,
        w: ROOM_W,
        h: READOUT_H,
      },
      sheetOpen: this.anySheetOpen(),
    }
  }
}

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}
