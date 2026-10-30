// WarehouseScene `Warehouse` (warehouse-view.md §1, §2.3, §3.3-§3.4, §4, §5,
// §7; plan.md §8): the one-screen intake-lane room. No camera pan, no zoom:
// a 352-px-wide room container centred between the HUD bands
// (roomPlacement, §1.1) with the lane readout strip glued 24 px above it.
// Through tier 3 the room (448 px) always fits; M9 (below) scrolls it.
//
// Parts (src/render/warehouse): RoomLayout (FixedLaneLayout, the rect table
// by node id), LaneRenderer (room, slots, Hold Bay, bin, shelf, parcels,
// stall visuals, readout), DockView (door, tail, lamp, status panel),
// WorkerSprites (inspectors of every desk + the sorter), Fx (catch moment,
// stamps, banner, shake, flashes). The four sheets (src/ui/warehouse:
// BuySheet, SlotCard, HoldBayCard, StationCard) are WarehouseSheets owned
// here; they call the facade themselves and keep one open at a time. The
// shared HireSheet (src/ui/HireSheet.ts, M6 people) is opened here on a
// card's request (WarehouseSheetOptions.openHire: the desk card's Hire
// inspector, the StationCard's Hire a sorter / Replace); the card closed
// itself and reopens from the request's onDone / onCancel. The sheet sits
// above the HUD bottom band like the cards; a sleep / game over / New game
// — or the Garage opening over the room (EV_GARAGE_OPENING: its own driver
// picker must not stack on this one) — closes it without reopening the card.
//
// Input (only the primary pointer, §1.14): taps are hit-tested against the
// layout (no interactive objects in the room, so a sheet's scrim or button
// always wins). Empty slot → BuySheet, occupied slot / desk strip →
// SlotCard, held bay → HoldBayCard, the Hold Bay station (RoomLayout
// HOLD_STATION_HIT, M6) → StationCard (a tooltip while locked), everything
// else → a pm:tooltip (HUD) or a 3-s popover (readout strip: per-strain
// detection; wanted poster: the malware labels revealed so far, the sim's
// `wanted` list). A 450-ms hold on a fixture lifts it
// (§2.3, own scene-clock timer so the frozen test clock drives it): drop on
// another live slot = lane.moveFixture (the sim swaps when occupied),
// anywhere else snaps back 150 ms. SlotCard's Move uses the same targets
// in tap mode (onMoveRequest).
//
// Sim events through bindSim (attached on create / WAKE, detached on SLEEP /
// SHUTDOWN; syncAll on WAKE and sim swaps); M6 adds `sorter:decided` (the
// sorter's jump), `parcel:tossed {source: 'arm'}` (the Sorter Arm's swing)
// and `desk:placed` (a hint to staff the new desk). Game events: emits pm:view
// {name: 'warehouse'} on create / wake, pm:tooltip, ui:tap, ui:sfx (deny);
// pm:goto {view: 'warehouse', highlight} arrives as run()/wake data and
// pulses the first empty slot + opens the BuySheet with that row pulsing.
// The city ↔ warehouse transition (§5.3): the City plays its pan / snap /
// fade (nav.ts); this scene fades in 150 ms while the room drops 16 px, and
// fades out 120 ms (transitionOut) on the way back.
//
// M8 (spec-build2 §4.1, design-m8-m9 §6.1): docks 2–3. A tap on a dock not
// owned opens the buy Dialog once its level is reached (`Loading dock 2`,
// `$800 · a second door into slot 1`, `Buy $800` → lane.buyDock; a refusal
// shakes the door, plays deny and tooltips the reason), else the unlock
// tooltip; an owned dock 2–3 (door + pad) tooltips its own activity, the
// panel the summary. `dock:bought` opens the new door while its pad fades
// in (DockView.onBought). The room layout is the LaneRenderer's, which
// follows the warehouse tier (the tier-3 shelf grid).
//
// M9 (spec-build2 §4.4; design-m8-m9 §6.1, R10, R21, R22): room growth. The
// room is `layout.height` tall (448 / 512 / 576 at tiers 1–3 / 4 / 5); when
// it does not fit between the bands (`roomPlacement(…, roomH).fits` false:
// tier 4 at 360 × 604 and 393 × 659, tier 5 everywhere below 430 × 932)
// the readout strip stays fixed at the band's top (its own container,
// RoomLayers.readout), the room's top sits 28 px below the band and the
// room scrolls vertically: integer `scrollY` in [0, maxScroll], the root
// container moved up by it, and an opaque cover (two world-atlas ui
// nine-slices at COVER_DEPTH, FILL-tinted the camera's background colour,
// so they batch with the readout and the HUD — a Graphics cost two draw
// calls, M9 review) masks everything outside the viewport — the HUD's
// ticker is translucent. Not a second camera: the
// sheets, dialogs, popovers and tooltips this scene creates later would
// all have to be ignored by it one by one. Gesture (R22): a press that
// travels more than TAP_PX vertically before it lifts a fixture drags the
// room 1:1 (no inertia; the tap is suppressed); a lifted fixture never
// scrolls (edge auto-scroll while lifting is the first item of the cut
// order, so it is not built); the mouse wheel scrolls 32 px a notch.
// Pointer → room px subtracts the scrolled origin (`roomY`); presses
// outside the viewport (under the cover) pick nothing but the readout.
// A press whose pointer-up a HUD band caught (Phaser's topOnly: the HUD
// scene is above) never sees onUp: update() drops a press whose pointer is
// no longer down, and onDown replaces one from an earlier touch (the same
// Pointer object, another downTime), so a lifted ghost snaps back and the
// next tap is a tap (M9 review). Tooltips anchor on a picked rect's top
// clamped into the viewport, popovers below the HUD's top band.
// pm:goto's highlight and every card opened from the room (BuySheet,
// SlotCard, HoldBayCard, StationCard) scroll their target toward the part
// of the viewport above the sheet (as far as the scroll range goes: slot 6
// stays under a BuySheet, as the lowest slots do in a room that fits). A
// level-up that changes the room's rows while inside (3 → 4, 4 → 5; R21)
// rebuilds the room on the next frame — new layers, LaneRenderer,
// DockView, WorkerSprites and Fx on `new FixedLaneLayout(tier)` + syncAll
// — while the old room fades out above it over the tier fade, moved onto
// the new room's origin so the walls, sign and slots they share line up
// with what a tap hits (in-flight parcel tweens snap), and the newly live
// slot unrolls after it; a WAKE or a sim swap at another row count
// rebuilds at once. A level-up within the same rows keeps the in-place
// cross-fade.
import Phaser from 'phaser'
import {
  EV_GARAGE_OPENING,
  EV_GOTO,
  EV_VIEW,
  FADE_IN_MS,
  FADE_OUT_MS,
  FADE_RGB,
  type WorldTransition,
  type WorldView,
} from '../boot/nav.ts'
import { bindSim, getViewSim, REG } from '../boot/simBinding.ts'
import type { GameData } from '../data/types.ts'
import { formatMmSs } from '../render/decayPhase.ts'
import { atlasOf, frameOrNull } from '../render/frames.ts'
import {
  DockView,
  dockBuyDialog,
  lockedDockText,
} from '../render/warehouse/DockView.ts'
import { Fx, reducedMotion } from '../render/warehouse/Fx.ts'
import {
  createRoomLayers,
  LaneRenderer,
  TIER_FADE_MS,
  visualTier,
  type RoomLayers,
} from '../render/warehouse/LaneRenderer.ts'
import {
  bayRect,
  BAY_COUNT,
  clampScroll,
  coverRects,
  DOCK_PANEL,
  dragScrolls,
  FixedLaneLayout,
  HOLD_STATION,
  POSTER,
  POSTER_HIT,
  READOUT_GAP,
  READOUT_H,
  ROOM_W,
  roomPlacement,
  scrollForDrag,
  scrollToShow,
  SIGN,
  type Point,
  type Rect,
  type RoomPlacement,
} from '../render/warehouse/RoomLayout.ts'
import { WorkerSprites } from '../render/warehouse/WorkerSprites.ts'
import type { SimEventPayloads } from '../sim/events.ts'
import type { LaneNode, Strain } from '../sim/types.ts'
import type { DockSlotView, ViewSim } from '../sim/view-api.ts'
import { Dialog } from '../ui/Dialog.ts'
import { HireSheet } from '../ui/HireSheet.ts'
import { computeLayout, type Layout } from '../ui/layout.ts'
import { addPanel, setPanelRect, SLICE } from '../ui/Panel.ts'
import { claimKey } from '../ui/Sheet.ts'
import { laneReadout, strainRows, TONE_TEXT } from '../ui/ShieldPopover.ts'
import { addText, textTop } from '../ui/text.ts'
import { PALETTE, THEME } from '../ui/theme.ts'
import {
  BuySheet,
  holdNodeId,
  sheetBottom,
  warehouseFailText,
  type HireRequest,
} from '../ui/warehouse/BuySheet.ts'
import { HoldBayCard } from '../ui/warehouse/HoldBayCard.ts'
import { SlotCard } from '../ui/warehouse/SlotCard.ts'
import { StationCard, stationLockedLine } from '../ui/warehouse/StationCard.ts'

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
/**
 * M9 scroll (R10): the cover masking the room outside its viewport, the
 * fixed readout strip above it, and a room fading out after a rebuild
 * (R21) — all below the popovers (4000) and the sheets (5000).
 */
export const COVER_DEPTH = 10
export const READOUT_DEPTH = 11
const OLD_ROOM_DEPTH = 1
/** Mouse wheel: room px per notch. */
export const WHEEL_STEP_PX = 32

type Pick =
  | { kind: 'slot'; nodeId: string; rect: Rect }
  | { kind: 'bay'; bay: number; rect: Rect }
  | { kind: 'bin'; rect: Rect }
  | { kind: 'shelf'; rect: Rect }
  /** dockId null = the status panel (the summary tooltip). */
  | { kind: 'dock'; dockId: string | null; rect: Rect }
  /** A dock not owned: `index` = its number (economy.docks row). */
  | { kind: 'lockedDock'; index: number; rect: Rect }
  | { kind: 'ext'; rect: Rect }
  | { kind: 'poster'; rect: Rect }
  | { kind: 'station'; rect: Rect }
  | { kind: 'sign'; rect: Rect }
  | { kind: 'readout'; rect: Rect }

interface Press {
  pointer: Phaser.Input.Pointer
  /** The pointer's downTime at this press (Phaser reuses one Pointer per touch slot). */
  downTime: number
  pick: Pick | null
  x0: number
  y0: number
  t0: number
  moved: boolean
  lifted: boolean
  /** M9 (R22): the press went down inside the room's viewport. */
  inView: boolean
  /** The scroll when it went down, and whether it drags the room now. */
  scroll0: number
  scrolling: boolean
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

/**
 * "Slots 5–6 — unlock at Lv 4 and Lv 5" (§6; " · coming soon" past the
 * playtest cap); one slot left past the column (tier 4, M9): "Slot 6 —
 * unlocks at Lv 5".
 */
export function extTooltip(
  data: GameData,
  locked: readonly { id: string; level: number }[],
): string {
  const lv = locked.map((x) => x.level)
  const soon = lv.some((l) => l > data.economy.playtestMaxLevel)
    ? ' · coming soon'
    : ''
  const nums = locked.map((x) => x.id.replace(/\D+/g, ''))
  const lvls = lv.map((l) => `Lv ${l}`).join(' and ')
  if (nums.length === 1) return `Slot ${nums[0]} — unlocks at ${lvls}${soon}`
  return `Slots ${nums.join('–')} — unlock at ${lvls}${soon}`
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
  private L!: Layout
  private roomX = 0
  /** Screen y of room px 0 now (the unscrolled top minus the scroll). */
  private roomY = 0
  /** M9: screen y of the room's top at scroll 0 (roomPlacement.roomY). */
  private roomTop = 0
  /** M9: integer vertical scroll in [0, place.maxScroll] (room px). */
  private scrollY = 0
  /** The entry drop's current offset (−16 → 0, §5.3). */
  private entryDy = 0
  private place!: RoomPlacement
  /** M9: masks the room outside its viewport while it scrolls (above, below). */
  private cover: Phaser.GameObjects.NineSlice[] = []
  /** M9 (R21): a level-up changed the room's rows; rebuild on the next frame. */
  private relayoutPending = false
  /** Old rooms fading out after a rebuild (destroyed on completion / sleep). */
  private fading: Phaser.GameObjects.Container[] = []
  private layers!: RoomLayers
  private fx!: Fx
  private lane!: LaneRenderer
  private dock!: DockView
  private workers!: WorkerSprites
  private buy: BuySheet | null = null
  private slotCard: SlotCard | null = null
  private holdCard: HoldBayCard | null = null
  private stationCard: StationCard | null = null
  /** The open HireSheet (a card's request) and its token. */
  private hireSheet: HireSheet | null = null
  private hireToken: object | null = null
  /** M8: the open buy-dock confirm. */
  private dockDialog: Dialog | null = null
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
    this.stationCard = null
    this.hireSheet = null
    this.hireToken = null
    this.dockDialog = null
    this.scrollY = 0
    this.entryDy = 0
    this.relayoutPending = false
    this.fading = []
  }

  /** The room layout of the current tier (the LaneRenderer's, M8). */
  private get layout(): FixedLaneLayout {
    return this.lane.layout
  }

  create(): void {
    this.vs = getViewSim(this)
    this.gd = this.vs.data
    this.cameras.main.setBackgroundColor(PALETTE.outline)
    this.L = this.computeL()
    this.cover = [0, 1].map(() =>
      addPanel(this, 0, 0, 1, 1, 'ui_panel_dark')
        .setTint(PALETTE.outline)
        .setTintMode(Phaser.TintModes.FILL)
        .setDepth(COVER_DEPTH)
        .setVisible(false),
    )
    this.buildRoom(new FixedLaneLayout(visualTier(this.gd, this.vs.level)))
    this.buildSheets()
    this.installInput()
    this.installGameEvents()

    bindSim(
      this,
      {
        'parcel:flagged': (p) => this.onFlagged(p),
        'parcel:tossed': (p) => {
          this.onTossed(p)
          if (p.source === 'arm') this.lane.onArmToss()
        },
        'sorter:decided': (p) => this.workers.onSorterDecided(p),
        'desk:placed': (p) => this.onDeskPlaced(p),
        'parcel:cleared_by_player': (p) => this.lane.onCleared(p.id),
        'lane:fixturePlaced': (p) => this.lane.onFixturePlaced(p.nodeId),
        'lane:fixtureMoved': () => this.lane.syncSlots(),
        'lane:fixtureRemoved': () => this.lane.syncSlots(),
        'lane:stalled': () => this.lane.refreshReadout(),
        'lane:resumed': () => this.lane.refreshReadout(),
        'worker:walkedOut': (p) => this.workers.onWalkedOut(p.employeeId),
        'level:up': () => this.onLevelUp(),
        'dock:bought': (p) => this.dock.onBought(p.index),
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
    this.entryDy = 0
    this.dropFading()
    this.applyRoomPosition()
  }

  private onShutdown(): void {
    this.events.off(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.events.off(Phaser.Scenes.Events.SLEEP, this.onSleep, this)
    this.removeGameEvents()
    this.cancelPress()
    this.closePopover()
    this.dropFading()
    this.lane.destroy()
    this.dock.destroy()
    this.workers.destroy()
  }

  /** §5.3 entry: fade in 150 ms while the room drops 16 px into place. */
  private enter(): void {
    const cam = this.cameras.main
    cam.resetFX()
    this.entryTween?.stop()
    this.entryTween = null
    if (!this.game.loop.running || reducedMotion()) {
      this.entryDy = 0
      this.applyRoomPosition()
    } else {
      cam.fadeIn(FADE_IN_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2])
      const prog = { dy: -ENTRY_DROP_PX }
      this.entryDy = prog.dy
      this.applyRoomPosition()
      this.entryTween = this.tweens.add({
        targets: prog,
        dy: 0,
        duration: FADE_IN_MS,
        ease: 'Quad.easeOut',
        onUpdate: () => {
          this.entryDy = Math.round(prog.dy)
          this.applyRoomPosition()
        },
        onComplete: () => {
          this.entryTween = null
          this.entryDy = 0
          this.applyRoomPosition()
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

  /**
   * Rebuild every dynamic part from sim state (create, WAKE, sim swap); a
   * room of other rows than the sim's tier is rebuilt first (M9, R21).
   */
  private syncAll(): void {
    if (this.lane.needsRebuild()) {
      this.rebuildRoom(false)
      return
    }
    this.syncParts()
  }

  private syncParts(): void {
    this.closeCalls.clear()
    this.lane.syncAll()
    this.dock.syncAll()
    this.workers.syncAll()
  }

  // ---------------------------------------------------------------- room build (M9)

  /** The room's layers and parts on `layout`, placed for its height. */
  private buildRoom(layout: FixedLaneLayout): void {
    this.place = this.placementFor(layout.height)
    this.roomX = this.place.roomX
    this.roomTop = this.place.roomY
    this.scrollY = clampScroll(this.scrollY, this.place.maxScroll)
    this.layers = createRoomLayers(this, this.roomX, this.roomTop)
    this.layers.readout.setDepth(READOUT_DEPTH)
    this.fx = new Fx(this, this.layers.fx)
    this.lane = new LaneRenderer(this, this.layers, layout, this.vs, this.fx)
    this.dock = new DockView(this, this.layers, this.vs)
    this.workers = new WorkerSprites(this, this.layers, this.layout, this.vs)
    this.applyRoomPosition()
    this.drawCover()
  }

  /** level:up — in place within the same rows, else a rebuild next frame (R21). */
  private onLevelUp(): void {
    if (this.relayoutPending) return
    if (this.lane.needsRebuild()) {
      this.relayoutPending = true
      return
    }
    this.lane.onLevelUp()
  }

  /**
   * R21 hard re-layout: drop a lift / Move / popover on the old room, stop
   * its parts, build the room of the sim's tier and sync it; with `fade`
   * the old room fades out above the new one over TIER_FADE_MS and the
   * slots it showed locked unroll after it (§1.6), else it goes at once.
   */
  private rebuildRoom(fade: boolean): void {
    this.relayoutPending = false
    const tier = visualTier(this.gd, this.vs.level)
    const prevLocked = this.lane.lockedSlotIds()
    const old = this.layers
    this.dropDrag()
    this.endMove()
    this.closePopover()
    this.lane.clearTransient()
    this.lane.destroy()
    this.dock.destroy()
    this.workers.destroy()
    this.fx.clear()
    this.buildRoom(new FixedLaneLayout(tier))
    this.syncParts()
    old.readout.destroy()
    this.killTweensIn(old.root)
    if (!fade) {
      old.root.destroy()
      return
    }
    this.lane.unrollOpened(prevLocked, TIER_FADE_MS)
    // On the new room's origin: what they share lines up with the taps.
    old.root.setPosition(this.layers.root.x, this.layers.root.y)
    old.root.setDepth(OLD_ROOM_DEPTH)
    this.fading.push(old.root)
    this.tweens.add({
      targets: old.root,
      alpha: 0,
      duration: TIER_FADE_MS,
      onComplete: () => {
        this.fading = this.fading.filter((c) => c !== old.root)
        old.root.destroy()
      },
    })
  }

  /** Stop every tween on `c` and its descendants (a room being replaced). */
  private killTweensIn(c: Phaser.GameObjects.Container): void {
    this.tweens.killTweensOf(c)
    for (const child of c.list) {
      this.tweens.killTweensOf(child)
      if (child instanceof Phaser.GameObjects.Container)
        this.killTweensIn(child)
    }
  }

  /** Destroy the rooms still fading out (sleep, shutdown). */
  private dropFading(): void {
    for (const c of this.fading) {
      this.tweens.killTweensOf(c)
      c.destroy()
    }
    this.fading = []
  }

  /** A lifted fixture's ghost goes without the snap-back (its room is replaced). */
  private dropDrag(): void {
    this.press = null
    if (!this.drag) return
    this.drag.ghost.destroy()
    this.drag = null
    this.lane.setLifted(null)
    this.lane.showCandidates(null)
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

  /** roomPlacement for a room `roomH` px tall between this layout's bands. */
  private placementFor(roomH: number): RoomPlacement {
    const L = this.L
    return roomPlacement(L.W, L.ticker.y + L.ticker.h, L.bottomBar.y, roomH)
  }

  private relayout(): void {
    this.L = this.computeL()
    this.place = this.placementFor(this.layout.height)
    this.roomX = this.place.roomX
    this.roomTop = this.place.roomY
    this.scrollY = clampScroll(this.scrollY, this.place.maxScroll)
    this.applyRoomPosition()
    this.drawCover()
    const sheetL = {
      ...this.L,
      labelFor: (id: string) => this.layout.labelFor(id),
    }
    this.buy?.relayout(sheetL)
    this.slotCard?.relayout(sheetL)
    this.holdCard?.relayout(sheetL)
    this.stationCard?.relayout(sheetL)
    if (this.hireSheet?.isOpen()) this.hireSheet.relayout(this.hireLayout())
    this.dockDialog?.relayout(this.L)
    this.closePopover()
  }

  /** Room px → screen px. */
  private toScreen(x: number, y: number): Point {
    return { x: Math.round(this.roomX + x), y: Math.round(this.roomY + y) }
  }

  /**
   * A tooltip's anchor for room rect `r`: its top centre, clamped into the
   * viewport — a rect scrolled half out of view would put the bubble over
   * the HUD's top band (M9 review).
   */
  private tipAt(r: Rect): Point {
    const p = this.toScreen(r.x + r.w / 2, r.y)
    const v = this.place.viewport
    return { x: p.x, y: Math.min(v.y + v.h, Math.max(v.y, p.y)) }
  }

  // ---------------------------------------------------------------- scroll (M9)

  /**
   * Put the room at the scroll (and the entry drop): root at the scrolled
   * origin, the readout strip at the unscrolled one (fixed, R10).
   */
  private applyRoomPosition(): void {
    this.roomY = this.roomTop - this.scrollY
    this.layers.root.setPosition(this.roomX, this.roomY + this.entryDy)
    this.layers.readout.setPosition(this.roomX, this.roomTop + this.entryDy)
    this.fx.viewTop = this.scrollY
  }

  /**
   * The cover over everything outside the viewport while the room scrolls
   * (coverRects: the corners of the nine-slices off screen).
   */
  private drawCover(): void {
    const rects = coverRects(this.place, this.L.W, this.L.H, SLICE)
    this.cover.forEach((panel, i) => {
      const r = rects[i]
      panel.setVisible(r !== undefined)
      if (r) setPanelRect(panel, r)
    })
  }

  /** Scroll to `y` (clamped, integer); the new scroll. */
  private setScroll(y: number): number {
    const s = clampScroll(y, this.place.maxScroll)
    if (s !== this.scrollY) {
      this.scrollY = s
      this.applyRoomPosition()
    }
    return s
  }

  /** True when screen (x, y) shows the room (always while it fits). */
  private inViewport(x: number, y: number): boolean {
    const p = this.place
    if (p.maxScroll <= 0) return true
    const v = p.viewport
    return y >= v.y && y < v.y + v.h && x >= 0 && x < this.L.W
  }

  /**
   * Scroll room rect `r` into the viewport — above `sheetTop` (screen y)
   * when a sheet covers the bottom of it. No-op while the room fits.
   */
  private showInView(r: Rect, sheetTop?: number): void {
    const p = this.place
    if (p.maxScroll <= 0) return
    const v = p.viewport
    const bottom = Math.min(v.y + v.h, sheetTop ?? Number.POSITIVE_INFINITY)
    const viewH = Math.max(r.h, bottom - v.y)
    this.setScroll(scrollToShow(r, this.scrollY, viewH, p.maxScroll))
  }

  /** The readout strip in screen px (fixed while the room scrolls). */
  private readoutScreen(): Rect {
    const rr = this.lane.readoutRect()
    return {
      x: this.roomX + rr.x,
      y: this.roomTop + rr.y,
      w: rr.w,
      h: rr.h,
    }
  }

  /** Mouse wheel over the room: WHEEL_STEP_PX a notch while it scrolls. */
  private onWheel(
    _p: Phaser.Input.Pointer,
    _over: unknown,
    _dx: number,
    dy: number,
  ): void {
    if (this.place.maxScroll <= 0 || dy === 0) return
    if (this.anySheetOpen() || this.transitioning || this.drag) return
    this.closePopover()
    this.setScroll(this.scrollY + Math.sign(dy) * WHEEL_STEP_PX)
  }

  // ---------------------------------------------------------------- sheets

  private buildSheets(): void {
    const opts = {
      labelFor: (id: string) => this.layout.labelFor(id),
      openHire: (req: HireRequest) => this.openHire(req),
    }
    this.buy = new BuySheet(this, this.L, this.vs, opts)
    this.slotCard = new SlotCard(this, this.L, this.vs, opts)
    this.holdCard = new HoldBayCard(this, this.L, this.vs, opts)
    this.stationCard = new StationCard(this, this.L, this.vs, opts)
    this.slotCard.onMoveRequest((nodeId) => this.beginMove(nodeId))
  }

  private anySheetOpen(): boolean {
    return Boolean(
      this.buy?.isOpen() ||
      this.slotCard?.isOpen() ||
      this.holdCard?.isOpen() ||
      this.stationCard?.isOpen() ||
      this.hireSheet?.isOpen() ||
      this.dockDialog?.isOpen(),
    )
  }

  private closeSheets(instant = false): void {
    this.dropHire()
    this.dockDialog?.destroy()
    this.dockDialog = null
    this.buy?.close(instant)
    this.slotCard?.close(instant)
    this.holdCard?.close(instant)
    this.stationCard?.close(instant)
    this.workers?.showNames(null)
  }

  // ---------------------------------------------------------------- hire sheet

  /** The HireSheet's frame: full canvas, its panel above the HUD bottom band. */
  private hireLayout(): { W: number; H: number; safeBottom: number } {
    const L = this.L
    return { W: L.W, H: L.H, safeBottom: Math.max(0, L.H - sheetBottom(L)) }
  }

  /**
   * A card asked for the HireSheet (it closed itself). onDone / onCancel of
   * the request run only while this sheet is still the current one — a
   * sleep, game over or another request drops it silently.
   */
  private openHire(req: HireRequest): void {
    this.dropHire()
    if (this.transitioning || this.vs.gameOver) return
    const token = {}
    this.hireToken = token
    const settle = (after: () => void): void => {
      if (this.hireToken !== token) return
      this.hireToken = null
      this.hireSheet = null
      after()
    }
    const L = this.L
    this.hireSheet = new HireSheet(this, {
      vs: this.vs,
      role: req.role,
      target: req.target,
      title: req.title,
      ...this.hireLayout(),
      minHit: L.minHit,
      id: 'wh:hire',
      onDone: (res) => settle(() => req.onDone?.(res)),
      onCancel: () => settle(() => req.onCancel?.()),
    })
  }

  /** Close the HireSheet without its callbacks (the card stays closed). */
  private dropHire(): void {
    const sheet = this.hireSheet
    this.hireToken = null
    this.hireSheet = null
    if (sheet?.isOpen()) sheet.close()
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

  /** The Garage opens over the room: no second applicant picker under it. */
  private onGarageOpening = (): void => this.dropHire()

  private installGameEvents(): void {
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize)
    this.registry.events.on('changedata', this.onRegistry)
    this.input.keyboard?.on('keydown', this.onKey, this)
    this.game.events.on(EV_GOTO, this.onGotoAwake)
    this.game.events.on(EV_GARAGE_OPENING, this.onGarageOpening)
  }

  private removeGameEvents(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize)
    this.registry.events.off('changedata', this.onRegistry)
    this.input.keyboard?.off('keydown', this.onKey, this)
    this.game.events.off(EV_GOTO, this.onGotoAwake)
    this.game.events.off(EV_GARAGE_OPENING, this.onGarageOpening)
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
    this.dropHire()
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
      const r = this.readoutScreen()
      this.tooltip('No empty slot — move or sell a machine', {
        x: r.x + r.w / 2,
        y: r.y + r.h,
      })
      return
    }
    this.lane.pulseSlot(empty, PALETTE.blue1, HIGHLIGHT_MS)
    if (!this.anySheetOpen()) this.buy?.open(empty, machineId)
    const r = this.layout.rectFor(empty)
    if (r) this.showInView(r, this.buy?.isOpen() ? this.buy.top : undefined)
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
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this)
  }

  private isPrimary(p: Phaser.Input.Pointer): boolean {
    return p === this.input.activePointer || p.id <= 1
  }

  private onDown(
    p: Phaser.Input.Pointer,
    over: Phaser.GameObjects.GameObject[],
  ): void {
    if (!this.isPrimary(p)) return
    // A press from an earlier touch whose up a HUD band caught (stale).
    if (this.press && this.isStale(this.press)) this.cancelPress()
    if (this.press) return
    if (over.length > 0 || this.anySheetOpen() || this.transitioning) return
    if (this.popover) {
      this.closePopover()
      return
    }
    this.press = {
      pointer: p,
      downTime: p.downTime,
      pick: this.pickAt(p.x, p.y),
      x0: p.x,
      y0: p.y,
      t0: this.time.now,
      moved: false,
      lifted: false,
      inView: this.inViewport(p.x, p.y),
      scroll0: this.scrollY,
      scrolling: false,
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const press = this.press
    if (!press || press.pointer !== p) return
    if (Math.hypot(p.x - press.x0, p.y - press.y0) > TAP_PX) press.moved = true
    // R22: vertical travel past the slop before a lift drags the room 1:1.
    const dy = p.y - press.y0
    if (
      !press.scrolling &&
      press.inView &&
      dragScrolls(dy, press.lifted, this.place.maxScroll, TAP_PX)
    ) {
      press.scrolling = true
      press.moved = true
    }
    if (press.scrolling) {
      this.setScroll(scrollForDrag(press.scroll0, dy, this.place.maxScroll))
      return
    }
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
      if (this.inViewport(p.x, p.y))
        this.drop(p.x - this.roomX, p.y - this.roomY)
      else this.snapBack()
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

  /**
   * The press's pointer went up without onUp (a HUD band caught it — the
   * HUD scene is on top) or went down again since: the press is over.
   */
  private isStale(press: Press): boolean {
    return !press.pointer.isDown || press.pointer.downTime !== press.downTime
  }

  private cancelPress(): void {
    this.press = null
    if (this.drag) this.snapBack()
  }

  /**
   * The hit target under screen point (x, y): the fixed readout strip
   * (padded 6 px), else — inside the viewport — the room under it.
   */
  private pickAt(x: number, y: number): Pick | null {
    const rr = this.readoutScreen()
    const pad = { x: rr.x, y: rr.y - 6, w: rr.w, h: rr.h + 12 }
    if (inside(pad, x, y)) {
      // the strip in its own (fixed) container's px: the tap flash
      return { kind: 'readout', rect: this.lane.readoutRect() }
    }
    if (!this.inViewport(x, y)) return null
    return this.pick(x - this.roomX, y - this.roomY)
  }

  /** The hit target under room point (x, y), most specific first. */
  private pick(x: number, y: number): Pick | null {
    const lay = this.layout
    if (inside(POSTER_HIT, x, y)) return { kind: 'poster', rect: { ...POSTER } }
    // The Hold Bay station is not a lane node (layout.stationAt, M6).
    if (lay.stationAt(x, y))
      return { kind: 'station', rect: { ...HOLD_STATION } }
    const signR = { ...SIGN }
    if (inside(signR, x, y)) return { kind: 'sign', rect: signR }
    for (let i = 0; i < BAY_COUNT; i++) {
      const r = bayRect(i)
      if (inside(r, x, y)) return { kind: 'bay', bay: i, rect: r }
    }
    // Docks 2–3 (door + pad, M8): owned → its tooltip, else buy / unlock.
    const bay = this.dock.bayAt(x, y)
    if (bay)
      return bay.owned
        ? { kind: 'dock', dockId: `dock${bay.index}`, rect: bay.rect }
        : { kind: 'lockedDock', index: bay.index, rect: bay.rect }
    // The desk's west strip belongs to the desk slot (§1.3).
    for (const n of this.vs.lane.nodes()) {
      if (n.fixture?.kind !== 'desk') continue
      const h = lay.deskHit(n.id)
      if (h && inside(h, x, y))
        return { kind: 'slot', nodeId: n.id, rect: lay.rectFor(n.id) as Rect }
    }
    const panel = DockView.panel
    if (inside(panel, x, y))
      return { kind: 'dock', dockId: null, rect: { ...DOCK_PANEL } }
    const id = lay.nodeAt(x, y)
    if (!id) return null
    const r = lay.rectFor(id) as Rect
    if (id === 'bin') return { kind: 'bin', rect: r }
    if (id === 'shelf') return { kind: 'shelf', rect: r }
    if (id === 'dock1')
      return { kind: 'dock', dockId: id, rect: lay.hitFor(id) as Rect }
    if (/^dock\d+$/.test(id)) return null
    if (id === 'hold') return null
    if (!lay.isBeltSlot(id)) {
      const er = lay.extRect()
      return er ? { kind: 'ext', rect: er } : null
    }
    return { kind: 'slot', nodeId: id, rect: r }
  }

  private node(id: string): LaneNode | null {
    return this.vs.lane.nodes().find((n) => n.id === id) ?? null
  }

  private tap(pick: Pick): void {
    this.game.events.emit(EV_UI_TAP, { id: `wh:${pick.kind}` })
    // The strip's flash goes in its container, above the cover (M9 review).
    this.fx.flash(
      pick.rect,
      pick.kind === 'readout' ? this.layers.readout : undefined,
    )
    if (this.moveFrom) {
      const from = this.moveFrom
      this.endMove()
      if (pick.kind === 'slot' && pick.nodeId !== from) {
        this.tryMove(from, pick.nodeId, pick.rect)
      }
      return
    }
    const top = this.tipAt(pick.rect)
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
        this.tooltip(
          pick.dockId === null
            ? this.dock.panelTooltipText()
            : this.dock.tooltipText(pick.dockId),
          top,
        )
        return
      case 'lockedDock':
        this.tapLockedDock(pick.index, top)
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
      case 'station':
        this.tapStation(top)
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
    const r = this.layout.rectFor(nodeId)
    if (n.fixture) {
      this.slotCard?.open(nodeId)
      if (n.fixture.kind === 'desk') this.workers.showNames(nodeId)
      if (r && this.slotCard?.isOpen()) this.showInView(r, this.slotCard.top)
      return
    }
    this.buy?.open(nodeId)
    if (r && this.buy?.isOpen()) this.showInView(r, this.buy.top)
  }

  /**
   * A dock not owned (M8): the buy Dialog once its level is reached, else
   * `Loading dock 2 — unlocks at Lv 3 ($800)`.
   */
  private tapLockedDock(index: number, top: Point): void {
    const slot = this.vs.lane.dockSlots().find((s) => s.index === index)
    if (slot && slot.available && !slot.owned) {
      this.openDockDialog(slot, top)
      return
    }
    this.tooltip(lockedDockText(this.gd, index) ?? '', top)
  }

  /** `Loading dock 2` · `$800 · a second door into slot 1` · `Buy $800` → lane.buyDock. */
  private openDockDialog(slot: DockSlotView, top: Point): void {
    this.dockDialog?.destroy()
    const owned = this.vs.lane.dockSlots().filter((s) => s.owned).length
    const text = dockBuyDialog(slot, owned)
    const L = this.L
    this.dockDialog = new Dialog(this, {
      ...text,
      W: L.W,
      H: L.H,
      minHit: L.minHit,
      id: 'wh:dockDialog',
      onConfirm: () => {
        this.dockDialog = null
        const res = this.vs.lane.buyDock(slot.index)
        if (res.ok) return
        this.game.events.emit(EV_UI_SFX, { name: 'deny' })
        this.dock.shake(slot.index)
        this.tooltip(warehouseFailText(res.reason, this.gd), top)
      },
      onCancel: () => {
        this.dockDialog = null
      },
    })
  }

  /** The Hold Bay station (B2 §2.6): StationCard, or the unlock tooltip while locked. */
  private tapStation(top: Point): void {
    const hs = this.vs.holdStation
    if (!hs.unlocked && hs.kind === null) {
      this.tooltip(stationLockedLine(this.gd, hs.unlockLevel), top)
      return
    }
    this.stationCard?.open()
    if (this.stationCard?.isOpen())
      this.showInView({ ...HOLD_STATION }, this.stationCard.top)
  }

  /** desk:placed — point at the new desk: it checks nothing until staffed. */
  private onDeskPlaced(p: SimEventPayloads['desk:placed']): void {
    const n = this.node(p.nodeId)
    if (n?.fixture?.kind !== 'desk' || n.fixture.inspectorIds.length > 0) return
    const r = this.layout.rectFor(p.nodeId)
    if (!r) return
    this.tooltip('Desk placed — tap it to hire inspectors', this.tipAt(r))
  }

  private tapBay(bay: number, top: Point): void {
    const id = this.lane.heldAt(bay)
    if (id !== null) {
      this.holdCard?.open(id)
      if (this.holdCard?.isOpen())
        this.showInView(bayRect(bay), this.holdCard.top)
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
    if (r) this.tooltip('Tap a slot to move it there', this.tipAt(r))
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
    this.tooltip(warehouseFailText(res.reason), this.tipAt(rect))
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
    // Below the HUD's top band (the ticker is translucent): the wanted
    // poster scrolled near the viewport's top would put it under (M9 review).
    const band = this.L.ticker.y + this.L.ticker.h + 4
    const top = Math.round(Math.min(this.L.H - h - 4, Math.max(band, anchor.y)))
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
    const rr = this.readoutScreen()
    const w = 240
    const at = {
      x: Math.round(rr.x + (ROOM_W - w) / 2),
      y: Math.round(rr.y + rr.h + 2),
    }
    // The city shield popover's header (`Lane 15/min · Detection 97%`): the
    // bare `… · Detection` read as a cut-off title (UX M3 review).
    this.showPopover(laneReadout(stats), out, at, w)
  }

  /** Wanted poster tap (§5.1): malware labels revealed so far (the sim's `wanted`, B2 §2.8), by strain. */
  private openWanted(): void {
    const groups = wantedGroups(this.gd, this.vs.wanted)
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
    if (this.relayoutPending)
      this.rebuildRoom(this.game.loop.running && !reducedMotion())
    if (this.press && this.isStale(this.press)) this.cancelPress()
    const press = this.press
    if (press && !press.lifted && !press.moved && time - press.t0 >= HOLD_MS) {
      this.lift(press)
    }
    this.lane.update(time, delta)
    this.dock.update(time, delta)
    this.workers.update(time, delta)
    this.workers.showNames(this.namesFor())
    this.readoutAcc += delta
    if (this.readoutAcc >= READOUT_REFRESH_MS) {
      this.readoutAcc = 0
      this.lane.refreshReadout()
      this.lane.refreshSign()
    }
  }

  /**
   * Whose name tags show (WorkerSprites.showNames): the crew of the desk
   * whose SlotCard is open, the sorter while the StationCard is open.
   */
  private namesFor(): string | null {
    const id = this.slotCard?.nodeId ?? null
    if (id !== null && this.node(id)?.fixture?.kind === 'desk') return id
    if (this.stationCard?.isOpen()) return holdNodeId(this.vs)
    return null
  }

  /**
   * Debug / e2e: what the room shows right now. `roomY` is the screen y of
   * room px 0 at the current scroll (a tap at room (x, y) lands at (roomX
   * + x, roomY + y)); `readout` is the fixed strip; M9 adds the tier, the
   * room's height, the scroll, its maximum and the viewport.
   */
  stats(): {
    roomX: number
    roomY: number
    readout: Rect
    sheetOpen: boolean
    tier: number
    roomH: number
    fits: boolean
    scrollY: number
    maxScroll: number
    viewport: Rect
  } {
    return {
      roomX: this.roomX,
      roomY: this.roomY,
      readout: {
        x: this.roomX,
        y: this.roomTop - READOUT_GAP,
        w: ROOM_W,
        h: READOUT_H,
      },
      sheetOpen: this.anySheetOpen(),
      tier: this.layout.tier,
      roomH: this.layout.height,
      fits: this.place.maxScroll <= 0,
      scrollY: this.scrollY,
      maxScroll: this.place.maxScroll,
      viewport: { ...this.place.viewport },
    }
  }

  /** Debug / e2e (shots): scroll the room to `y` (clamped); the scroll now. */
  scrollTo(y: number): number {
    return this.setScroll(y)
  }
}

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}
