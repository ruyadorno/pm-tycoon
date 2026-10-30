// DockView (warehouse-view.md §1.4, §4, §6): the dock doors on the west wall,
// each docked vehicle's tail poking through its door (code-drawn 40 × 40
// `dock_tail_<type>_{closed,open}`, Q27), the dock lamps, the status panel
// (a lamp per dock, what the docks are doing, the queue with up to three
// vehicle glyphs, the unload progress bars) and the docks not owned yet.
//
// State-derived like the rest of the room: every frame it reads
// `vs.docks` / `vs.vehicles` / `vs.dockQueue` / `vs.lane.dockSlots()`; a
// newly docked vehicle slides its tail in from x −48 (300 ms Quad.out, then
// `open`), a departed / sold / walked-out one slides out (`closed`, 300 ms)
// — the part outside the room is cropped so the tail really comes through
// the door. Parcel flights (unload → conveyor / pad, shelf → door) are the
// LaneRenderer's.
//
// M8 (spec-build2 §4.1, design-m8-m9 §6.1, R7, R8): one bay per dock number
// 1..3 (RoomLayout dockGeom: door, tail, lamp, door point; docks 2–3 add
// the `dock_pad` roller pad, their conveyor). A dock not owned shows
// `dock_door_locked` with the lock and `Lv3` while below its level, a "+"
// and its price once it can be bought (the scene opens the buy dialog on a
// tap, `dockBuyDialog`). `dock:bought` (onBought) opens that door for the
// 300 ms the pad fades in, then closes it; WAKE (syncAll) shows the owned
// state at once. The panel shows a column of three lamps (top = dock 1,
// like the doors; `lamp_lock` for a dock not owned), `Dock 1` + its
// activity with one dock or `2 docks` + `1 unloading` with more, the shared
// queue, and one progress bar per owned dock. Dock 3 may be owned without
// dock 2 (bought at L4 first): everything is keyed by the dock number.
// M9: the price of a buyable dock sits on a `ui_badge` tag (dark text on
// the light pill, like the shelf count) — the tier-4 steel and tier-5 glass
// walls are too light for the white `Lv3` style (priceTagRect).
import type Phaser from 'phaser'
import type { GameData } from '../../data/types.ts'
import type {
  DockSlotView,
  VehicleSnapshot,
  ViewSim,
} from '../../sim/view-api.ts'
import { addPanel } from '../../ui/Panel.ts'
import { addText, textTop } from '../../ui/text.ts'
import { PALETTE, THEME } from '../../ui/theme.ts'
import { atlasOf, frameOrNull, roomAtlas } from '../frames.ts'
import type { RoomLayers } from './LaneRenderer.ts'
import {
  DOCK_COUNT,
  DOCK_PANEL,
  dockGeom,
  TAIL_HIDDEN_X,
  type DockGeom,
  type Rect,
} from './RoomLayout.ts'

const TAIL_MS = 300
const BLINK_MS = 250 // 2 Hz red blink
/** dock:bought — the door stays open while the pad fades in. */
export const PAD_UNROLL_MS = 300
const SHAKE_PX = 2
const SHAKE_MS = 40
export const PANEL_H = 44
const GLYPHS = 3
/** Panel lamp column (8 × 8 each, 2 px apart): top = dock 1. */
export const PANEL_LAMP_X = 6
export const PANEL_LAMP_Y = 6
export const PANEL_LAMP_PITCH = 10
/** Panel text columns: title, status (at least), the queue line. */
export const PANEL_TITLE_X = 18
export const PANEL_STATUS_X = 62
const BAR_GAP = 4

type Img = Phaser.GameObjects.Image
type Txt = Phaser.GameObjects.BitmapText
type Rectangle = Phaser.GameObjects.Rectangle

// ---- pure helpers ---------------------------------------------------------------

/** "Van 2 unloading 4/9" / "Truck 1 loading" / "Empty" for the panel + tooltip. */
export function dockActivity(
  v: Pick<VehicleSnapshot, 'name' | 'state'> | null,
  unloaded: number,
  total: number,
): string {
  if (!v) return 'Empty'
  if (v.state === 'docked_unloading')
    return `${v.name} unloading ${unloaded}/${total}`
  if (v.state === 'docked_loading') return `${v.name} loading`
  return 'Empty'
}

/** `$800`, `$2,000`. */
function price(n: number): string {
  return `$${n.toLocaleString('en-US')}`
}

/**
 * Tooltip of a dock not owned (§6): "Loading dock 2 — unlocks at Lv 3
 * ($800)", + " · coming soon" past economy.playtestMaxLevel. `index` = the
 * dock number (economy.docks row index); null for an unknown dock.
 */
export function lockedDockText(data: GameData, index: number): string | null {
  const row = data.economy.docks.find((r) => r.index === index)
  if (!row) return null
  const soon =
    row.unlockLevel > data.economy.playtestMaxLevel ? ' · coming soon' : ''
  return `Loading dock ${row.index} — unlocks at Lv ${row.unlockLevel} (${price(row.price)})${soon}`
}

const ORDINAL = ['', 'first', 'second', 'third'] as const

/**
 * The buy dialog of an available dock (design-m8-m9 §6.1): title `Loading
 * dock 2`, text `$800 · a second door into slot 1`, action `Buy $800`. The
 * ordinal counts doors (`owned` docks + 1), not the dock number: dock 3
 * bought before dock 2 (from L4, §4.9) is the second door, as the
 * dock:bought toast says (hubText.dockBoughtToast).
 */
export function dockBuyDialog(
  slot: Pick<DockSlotView, 'index' | 'price'>,
  owned: number,
): {
  title: string
  text: string
  action: string
} {
  const n = owned + 1
  const nth = ORDINAL[n] ?? `#${n}`
  return {
    title: `Loading dock ${slot.index}`,
    text: `${price(slot.price)} · a ${nth} door into slot 1`,
    action: `Buy ${price(slot.price)}`,
  }
}

/** What a dock bay draws (one state → one look). */
export interface DockBayLook {
  /** The bay's door frame. */
  door: 'dock_door_open' | 'dock_door_closed' | 'dock_door_locked'
  /** The roller pad (docks 2–3 owned). */
  pad: boolean
  /** The wall lamp over the door (owned). */
  lamp: boolean
  /** On the locked door: the lock + `Lv3` (below the level), a "+" + the price (buyable), none (owned). */
  badge: 'lock' | 'buy' | null
  /** `Lv3` / `$800` under the badge, else null. */
  badgeText: string | null
}

/**
 * The x of a door's badge text `w` px wide: centred on the door, never left
 * of the room's west wall (x 0) — `$2,000` (33 px) on the 32-px door spills
 * its extra pixel east, into the room (M8 review).
 */
export function badgeTextX(door: { x: number; w: number }, w: number): number {
  return Math.max(0, Math.round(door.x + (door.w - w) / 2))
}

/** The `ui_badge` price tag (40 × 16, the shelf badge's pill). */
export const PRICE_TAG = { w: 40, h: 16, dy: 30 } as const

/**
 * Where a buyable door's price tag sits: centred on the door below the "+",
 * never left of the room's west wall (x 0) — `$1,000` (33 px) fits inside.
 */
export function priceTagRect(door: { x: number; y: number; w: number }): Rect {
  return {
    x: Math.max(0, Math.round(door.x + (door.w - PRICE_TAG.w) / 2)),
    y: door.y + PRICE_TAG.dy,
    w: PRICE_TAG.w,
    h: PRICE_TAG.h,
  }
}

/** The look of a bay for its DockSlotView (+ a vehicle docked or a tail moving). */
export function dockBayLook(
  slot: Pick<
    DockSlotView,
    'index' | 'owned' | 'available' | 'unlockLevel' | 'price'
  >,
  busy: boolean,
): DockBayLook {
  if (slot.owned)
    return {
      door: busy ? 'dock_door_open' : 'dock_door_closed',
      pad: slot.index > 1,
      lamp: true,
      badge: null,
      badgeText: null,
    }
  return {
    door: 'dock_door_locked',
    pad: false,
    lamp: false,
    badge: slot.available ? 'buy' : 'lock',
    badgeText: slot.available ? price(slot.price) : `Lv${slot.unlockLevel}`,
  }
}

/** One owned dock as the panel reads it. */
export interface DockPanelDock {
  index: number
  v: Pick<VehicleSnapshot, 'name' | 'state'> | null
  unloaded: number
  total: number
}

/**
 * The panel's first line (design-m8-m9 §6.1): one dock → `Dock 1` +
 * `unloading 4/9` (the vehicle's name is in the tooltip; the panel is 156 px
 * wide); more → `2 docks` + `1 unloading` (else `1 loading`, else `Empty`).
 */
export function dockPanelLine(docks: readonly DockPanelDock[]): {
  title: string
  status: string
} {
  if (docks.length <= 1) {
    const d = docks[0]
    const act = d ? dockActivity(d.v, d.unloaded, d.total) : 'Empty'
    return {
      title: `Dock ${d?.index ?? 1}`,
      status: act.replace(/^\S+ \d+ /, ''),
    }
  }
  const n = (s: string): number => docks.filter((d) => d.v?.state === s).length
  const un = n('docked_unloading')
  const lo = n('docked_loading')
  const status = un > 0 ? `${un} unloading` : lo > 0 ? `${lo} loading` : 'Empty'
  return { title: `${docks.length} docks`, status }
}

/** Panel tap: `Dock 1 — Van 2 unloading 4/9 · queue 1`, or `2 docks · 1 unloading · queue 1`. */
export function dockPanelTooltip(
  docks: readonly DockPanelDock[],
  queue: number,
): string {
  if (docks.length <= 1) {
    const d = docks[0]
    const act = d ? dockActivity(d.v, d.unloaded, d.total) : 'Empty'
    return `Dock ${d?.index ?? 1} — ${act} · queue ${queue}`
  }
  const line = dockPanelLine(docks)
  return `${line.title} · ${line.status} · queue ${queue}`
}

/**
 * The wall / panel lamp of an owned dock (§1.4): red blink (`on` half) while
 * its vehicle is blocked by a full conveyor or vehicles queue while it is
 * busy (one dock: whenever vehicles queue, as in playtest 1), green while a
 * vehicle stands in it, else off.
 */
export function dockLamp(
  blocked: boolean,
  docked: boolean,
  queued: number,
  ownedDocks: number,
  on: boolean,
): 'lamp_red' | 'lamp_green' | 'lamp_off' {
  const waiting = queued > 0 && (docked || ownedDocks <= 1)
  if (blocked || waiting) return on ? 'lamp_red' : 'lamp_off'
  return docked ? 'lamp_green' : 'lamp_off'
}

/** The progress bar segments under the panel (x offset, width), one per owned dock. */
export function dockBarSegments(
  inner: number,
  owned: number,
): { x: number; w: number }[] {
  const n = Math.max(1, owned)
  const w = Math.floor((inner - BAR_GAP * (n - 1)) / n)
  return Array.from({ length: n }, (_, i) => ({ x: i * (w + BAR_GAP), w }))
}

// ---- the view ------------------------------------------------------------------

interface Bay {
  index: number
  dockId: string
  geom: DockGeom
  door: Img
  pad: Img | null
  tail: Img
  lamp: Img
  badge: Img
  /** The buyable door's price tag (ui_badge) under badgeText. */
  tag: Img
  badgeText: Txt
  panelLamp: Img
  barTrack: Rectangle
  barFill: Rectangle
  lookKey: string
  owned: boolean
  /** dock:bought: the door shows open until this scene time. */
  openUntil: number
  tailId: number | null
  tailType: string
  tailTween: Phaser.Tweens.Tween | null
  leaving: boolean
  startCargo: number
}

export class DockView {
  readonly scene: Phaser.Scene
  private L: RoomLayers
  private vs: ViewSim
  private bays: Bay[] = []
  private title: Txt
  private status: Txt
  private queue: Txt
  private glyphs: Img[] = []
  private barKey = ''
  private blink = 0

  constructor(scene: Phaser.Scene, layers: RoomLayers, vs: ViewSim) {
    this.scene = scene
    this.L = layers
    this.vs = vs
    const P = DOCK_PANEL
    const panel = addPanel(scene, P.x, P.y, P.w, PANEL_H, 'ui_panel_dark')
    layers.badges.add(panel)
    for (let k = 1; k <= DOCK_COUNT; k++) {
      const g = dockGeom(k)
      if (g) this.bays.push(this.buildBay(g))
    }
    // Status panel (§1.4): lamp column, title + activity, queue + glyphs, bars.
    this.title = addText(
      scene,
      P.x + PANEL_TITLE_X,
      textTop(P.y + 2, 18),
      'Dock 1',
      {
        tint: THEME.textLight,
      },
    )
    this.status = addText(
      scene,
      P.x + PANEL_STATUS_X,
      textTop(P.y + 2, 18),
      '',
      {
        tint: PALETTE.grey3,
      },
    )
    this.queue = addText(
      scene,
      P.x + PANEL_TITLE_X,
      textTop(P.y + 20, 18),
      '',
      {
        tint: PALETTE.grey3,
      },
    )
    layers.badges.add([this.title, this.status, this.queue])
    for (let i = 0; i < GLYPHS; i++)
      this.glyphs.push(
        this.add(layers.badges, P.x + 70 + i * 18, P.y + 21, 'ic_van'),
      )
    for (const b of this.bays) layers.badges.add([b.barTrack, b.barFill])
  }

  private add(
    layer: Phaser.GameObjects.Container,
    x: number,
    y: number,
    f: string,
  ): Img {
    const name = frameOrNull(f) ?? '__MISSING'
    // back layers (walls, belts, tail) batch from `interior`, the badges
    // (with the dock panel and its text) from `world` (spec-build2 §6.8)
    const L = this.L
    const back = layer === L.walls || layer === L.belts || layer === L.tail
    const key = back ? roomAtlas(name) : atlasOf(name)
    const img = this.scene.add.image(x, y, key, name).setOrigin(0, 0)
    layer.add(img)
    return img
  }

  private buildBay(g: DockGeom): Bay {
    const L = this.L
    const P = DOCK_PANEL
    const door = this.add(L.walls, g.door.x, g.door.y, 'dock_door_closed')
    const pad = g.pad ? this.add(L.belts, g.pad.x, g.pad.y, 'dock_pad') : null
    pad?.setVisible(false)
    const tail = this.add(
      L.tail,
      TAIL_HIDDEN_X,
      g.tail.y,
      'dock_tail_van_closed',
    )
    tail.setVisible(false)
    const lamp = this.add(L.badges, g.lamp.x, g.lamp.y, 'lamp_off')
    const badge = this.add(L.badges, g.door.x + 8, g.door.y + 12, 'ic_lock')
    badge.setVisible(false)
    const tagR = priceTagRect(g.door)
    const tag = this.add(L.badges, tagR.x, tagR.y, 'ui_badge')
    tag.setVisible(false)
    const badgeText = addText(this.scene, 0, g.door.y + 32, '', {
      tint: PALETTE.grey5,
      shadow: true,
    })
    badgeText.setVisible(false)
    L.badges.add(badgeText)
    const panelLamp = this.add(
      L.badges,
      P.x + PANEL_LAMP_X,
      P.y + PANEL_LAMP_Y + PANEL_LAMP_PITCH * (g.index - 1),
      'lamp_off',
    )
    // The bars are added after every image of the layer (addBars): a shape
    // between images would split the badges' one-texture batch.
    const barTrack = this.scene.add
      .rectangle(P.x + 6, P.y + PANEL_H - 5, 0, 2, PALETTE.grey0, 1)
      .setOrigin(0, 0)
    const barFill = this.scene.add
      .rectangle(P.x + 6, P.y + PANEL_H - 5, 0, 2, THEME.ok, 1)
      .setOrigin(0, 0)
    return {
      index: g.index,
      dockId: `dock${g.index}`,
      geom: g,
      door,
      pad,
      tail,
      lamp,
      badge,
      tag,
      badgeText,
      panelLamp,
      barTrack,
      barFill,
      lookKey: '',
      owned: false,
      openUntil: -1,
      tailId: null,
      tailType: 'van',
      tailTween: null,
      leaving: false,
      startCargo: 0,
    }
  }

  // ---- reads ------------------------------------------------------------------

  private slots(): readonly DockSlotView[] {
    return this.vs.lane.dockSlots()
  }

  private slotOf(index: number): DockSlotView | null {
    return this.slots().find((s) => s.index === index) ?? null
  }

  /** The vehicle standing in dock `dockId` (docked_unloading / docked_loading), or null. */
  dockedVehicle(dockId = 'dock1'): VehicleSnapshot | null {
    const id = this.vs.docks.find((d) => d.id === dockId)?.vehicleId ?? null
    if (id === null) return null
    const v = this.vs.vehicles.find((x) => x.id === id) ?? null
    return v && v.state.startsWith('docked') ? v : null
  }

  private panelDock(b: Bay): DockPanelDock {
    const v = this.dockedVehicle(b.dockId)
    const total = Math.max(b.startCargo, v?.cargo.length ?? 0)
    return {
      index: b.index,
      v,
      unloaded: total - (v?.cargo.length ?? 0),
      total,
    }
  }

  private ownedBays(): Bay[] {
    return this.bays.filter((b) => b.owned)
  }

  /** Dock tap tooltip: "Dock 2 — Van 2 unloading 4/9 · queue 1". */
  tooltipText(dockId = 'dock1'): string {
    const b = this.bays.find((x) => x.dockId === dockId)
    const d = b ? this.panelDock(b) : null
    const act = d ? dockActivity(d.v, d.unloaded, d.total) : 'Empty'
    const n = b?.index ?? 1
    return `Dock ${n} — ${act} · queue ${this.vs.dockQueue.length}`
  }

  /** Panel tap tooltip (one dock: as the dock's; more: the summary line). */
  panelTooltipText(): string {
    const docks = this.ownedBays().map((b) => this.panelDock(b))
    return dockPanelTooltip(docks, this.vs.dockQueue.length)
  }

  /**
   * The dock 2–3 bay under room (x, y) (door + pad, 56 × 56), with whether
   * the player owns it; null elsewhere (dock 1 is the layout's `dock1` hit).
   */
  bayAt(
    x: number,
    y: number,
  ): { index: number; owned: boolean; rect: Rect } | null {
    for (const b of this.bays) {
      if (b.index === 1) continue
      const r = b.geom.hit
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
        return {
          index: b.index,
          owned: this.slotOf(b.index)?.owned ?? false,
          rect: { ...r },
        }
    }
    return null
  }

  /** Index (dock number) of the dock not owned whose door holds room (x, y), or null. */
  lockedDoorAt(x: number, y: number): number | null {
    const hit = this.bayAt(x, y)
    return hit && !hit.owned ? hit.index : null
  }

  // ---- sync ---------------------------------------------------------------------

  syncAll(): void {
    for (const b of this.bays) {
      b.tailTween?.stop()
      b.tailTween = null
      b.leaving = false
      b.openUntil = -1
      b.lookKey = ''
      if (b.pad) {
        this.scene.tweens.killTweensOf(b.pad)
        b.pad.setAlpha(1)
      }
      const v = this.dockedVehicle(b.dockId)
      if (v) {
        b.tailId = v.id
        b.tailType = v.type
        b.startCargo = v.cargo.length
        this.setTail(b, b.geom.tail.x, true)
      } else {
        b.tailId = null
        b.tail.setVisible(false)
      }
    }
    this.barKey = ''
    this.refresh(0)
  }

  update(_time: number, delta: number): void {
    for (const b of this.bays) {
      const v = this.dockedVehicle(b.dockId)
      if (v && v.id !== b.tailId) this.slideIn(b, v)
      else if (!v && b.tailId !== null && !b.leaving) this.slideOut(b)
      if (v && v.cargo.length > b.startCargo) b.startCargo = v.cargo.length
    }
    this.refresh(delta)
  }

  /**
   * dock:bought (M8): the door opens while the roller pad fades in over
   * PAD_UNROLL_MS, then closes (or stays open for a vehicle docking at once).
   */
  onBought(index: number): void {
    const b = this.bays.find((x) => x.index === index)
    if (!b) return
    b.openUntil = this.scene.time.now + PAD_UNROLL_MS
    b.lookKey = ''
    this.refresh(0)
    if (b.pad) {
      this.scene.tweens.killTweensOf(b.pad)
      b.pad.setVisible(true).setAlpha(0)
      this.scene.tweens.add({
        targets: b.pad,
        alpha: 1,
        duration: PAD_UNROLL_MS,
        onComplete: () => b.pad?.setAlpha(1),
      })
    }
  }

  /** A refused buy (§2.1 deny): the door shakes 2 px. */
  shake(index: number): void {
    const b = this.bays.find((x) => x.index === index)
    if (!b) return
    const x = b.geom.door.x
    this.scene.tweens.killTweensOf(b.door)
    this.scene.tweens.add({
      targets: b.door,
      x: x + SHAKE_PX,
      duration: SHAKE_MS,
      yoyo: true,
      repeat: 2,
      onComplete: () => b.door.setX(x),
    })
  }

  private setTail(b: Bay, x: number, open: boolean): void {
    const f = frameOrNull(`dock_tail_${b.tailType}_${open ? 'open' : 'closed'}`)
    if (f) b.tail.setFrame(f)
    b.tail.setVisible(true).setX(Math.round(x))
    // Crop what is still outside the room (left of the west wall).
    const w = b.geom.tail.w
    const cut = Math.max(0, -Math.round(x))
    if (cut > 0) b.tail.setCrop(cut, 0, w - cut, b.geom.tail.h)
    else b.tail.setCrop()
  }

  private slideIn(b: Bay, v: VehicleSnapshot): void {
    b.tailTween?.stop()
    b.leaving = false
    b.tailId = v.id
    b.tailType = v.type
    b.startCargo = v.cargo.length
    this.setTail(b, TAIL_HIDDEN_X, false)
    const prog = { x: TAIL_HIDDEN_X }
    b.tailTween = this.scene.tweens.add({
      targets: prog,
      x: b.geom.tail.x,
      duration: TAIL_MS,
      ease: 'Quad.easeOut',
      onUpdate: () => this.setTail(b, prog.x, false),
      onComplete: () => {
        b.tailTween = null
        this.setTail(b, b.geom.tail.x, true)
      },
    })
  }

  private slideOut(b: Bay): void {
    b.tailTween?.stop()
    b.leaving = true
    const prog = { x: b.tail.x }
    this.setTail(b, prog.x, false)
    b.tailTween = this.scene.tweens.add({
      targets: prog,
      x: TAIL_HIDDEN_X,
      duration: TAIL_MS,
      ease: 'Quad.easeIn',
      onUpdate: () => this.setTail(b, prog.x, false),
      onComplete: () => {
        b.tailTween = null
        b.tail.setVisible(false)
        b.tailId = null
        b.leaving = false
      },
    })
  }

  /** The bay's door / pad / lamp / lock-or-buy badge for its DockSlotView. */
  private syncBay(b: Bay, slot: DockSlotView | null, busy: boolean): void {
    const s: DockSlotView = slot ?? {
      index: b.index as DockSlotView['index'],
      dockId: b.dockId,
      owned: b.index === 1,
      unlockLevel: 1,
      price: 0,
      available: b.index === 1,
    }
    b.owned = s.owned
    const look = dockBayLook(s, busy)
    const key = `${look.door}|${look.pad}|${look.lamp}|${look.badge}|${look.badgeText}`
    if (key === b.lookKey) return
    b.lookKey = key
    if (b.door.frame.name !== look.door) b.door.setFrame(look.door)
    if (b.pad && !this.scene.tweens.isTweening(b.pad))
      b.pad.setVisible(look.pad)
    b.lamp.setVisible(look.lamp)
    const g = b.geom.door
    b.badge.setVisible(look.badge !== null)
    if (look.badge === 'lock') {
      b.badge
        .setFrame('ic_lock')
        .setOrigin(0, 0)
        .setPosition(g.x + 8, g.y + 12)
    } else if (look.badge === 'buy') {
      b.badge
        .setFrame('ic_plus')
        .setOrigin(0.5, 0.5)
        .setPosition(g.x + g.w / 2, g.y + 20)
    }
    const buy = look.badge === 'buy'
    b.tag.setVisible(buy)
    b.badgeText.setVisible(look.badgeText !== null)
    if (look.badgeText !== null) {
      b.badgeText.setText(look.badgeText)
      if (buy) {
        // Dark on the light tag, no shadow (the price tag, M9).
        const r = priceTagRect(g)
        b.tag.setPosition(r.x, r.y)
        b.badgeText
          .setTint(THEME.textDark)
          .setDropShadow(0, 0, THEME.shadow, 0)
          .setPosition(
            Math.round(r.x + (r.w - b.badgeText.width) / 2),
            textTop(r.y, r.h),
          )
      } else {
        b.badgeText
          .setTint(PALETTE.grey5)
          .setDropShadow(1, 1, THEME.shadow, 1)
          .setPosition(badgeTextX(g, b.badgeText.width), g.y + 32)
      }
    }
  }

  private refresh(delta: number): void {
    this.blink = (this.blink + delta) % (2 * BLINK_MS)
    const on = this.blink < BLINK_MS
    const now = this.scene.time.now
    const slots = this.slots()
    const queued = this.vs.dockQueue.length
    const nodes = this.vs.lane.nodes()
    const ownedN = slots.filter((s) => s.owned).length || 1
    for (const b of this.bays) {
      const v = this.dockedVehicle(b.dockId)
      const busy = v !== null || b.tailTween !== null || now < b.openUntil
      this.syncBay(b, slots.find((s) => s.index === b.index) ?? null, busy)
      if (!b.owned) {
        const f = frameOrNull('lamp_lock') ?? 'lamp_off'
        if (b.panelLamp.frame.name !== f) b.panelLamp.setFrame(f)
        continue
      }
      const convId =
        this.vs.docks.find((d) => d.id === b.dockId)?.conveyorNodeId ?? null
      const conv = convId ? nodes.find((n) => n.id === convId) : undefined
      const blocked =
        v?.state === 'docked_unloading' &&
        conv !== undefined &&
        conv.cap !== null &&
        conv.queue.length >= conv.cap
      const lamp = dockLamp(blocked, v !== null, queued, ownedN, on)
      if (b.lamp.frame.name !== lamp) b.lamp.setFrame(lamp)
      if (b.panelLamp.frame.name !== lamp) b.panelLamp.setFrame(lamp)
    }

    const owned = this.ownedBays()
    const docks = owned.map((b) => this.panelDock(b))
    const line = dockPanelLine(docks)
    this.title.setText(line.title)
    this.status.setText(line.status)
    this.status.setX(
      Math.max(
        DOCK_PANEL.x + PANEL_STATUS_X,
        Math.round(this.title.x + this.title.width + 6),
      ),
    )
    this.queue.setText(`Queue ${queued}`)
    this.queue.setTint(queued > 0 ? THEME.danger : PALETTE.grey3)
    const ids = this.vs.dockQueue
    this.glyphs.forEach((g, i) => {
      const id = ids[i]
      const qv =
        id === undefined ? null : this.vs.vehicles.find((x) => x.id === id)
      if (!qv) {
        g.setVisible(false)
        return
      }
      const f = frameOrNull(`ic_${qv.type}`)
      if (f && g.frame.name !== f) g.setFrame(f)
      g.setVisible(true)
    })
    this.refreshBars(owned, docks)
  }

  /** One unload bar per owned dock, side by side under the panel. */
  private refreshBars(owned: Bay[], docks: DockPanelDock[]): void {
    const P = DOCK_PANEL
    const key = owned.map((b) => b.index).join(',')
    const segs = dockBarSegments(P.w - 12, owned.length)
    if (key !== this.barKey) {
      this.barKey = key
      for (const b of this.bays) {
        b.barTrack.setVisible(false)
        b.barFill.setVisible(false)
      }
      owned.forEach((b, i) => {
        const s = segs[i]
        if (!s) return
        b.barTrack.setX(P.x + 6 + s.x)
        b.barTrack.width = s.w
        b.barFill.setX(P.x + 6 + s.x)
      })
    }
    owned.forEach((b, i) => {
      const d = docks[i]
      const unloading = d?.v?.state === 'docked_unloading' && d.total > 0
      const frac = unloading && d ? d.unloaded / d.total : 0
      b.barTrack.setVisible(unloading)
      b.barFill.setVisible(unloading)
      b.barFill.width = Math.round(b.barTrack.width * frac)
    })
  }

  destroy(): void {
    for (const b of this.bays) {
      b.tailTween?.stop()
      if (b.pad) this.scene.tweens.killTweensOf(b.pad)
      this.scene.tweens.killTweensOf(b.door)
    }
  }

  /** Rect of dock 1 (tap target) in room px. */
  static readonly hit: Rect = { x: 0, y: 32, w: 128, h: 64 }
  /** For the scene: the panel rect is part of the docks' tap area. */
  static readonly panel: Rect = { ...DOCK_PANEL, h: PANEL_H }
}
