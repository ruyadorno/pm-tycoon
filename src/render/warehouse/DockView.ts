// DockView (warehouse-view.md §1.4, §4, §6): the dock door on the west wall,
// the docked vehicle's tail poking through it (code-drawn 40 × 40
// `dock_tail_<type>_{closed,open}`, Q27), the dock lamp, the status panel
// ("Dock 1", what the dock is doing, the queue with up to three vehicle
// glyphs, the unload progress bar) and the locked docks 2–3.
//
// State-derived like the rest of the room: every frame it reads
// `vs.docks` / `vs.vehicles` / `vs.dockQueue`; a newly docked vehicle slides
// its tail in from x −48 (300 ms Quad.out, then `open`), a departed / sold /
// walked-out one slides out (`closed`, 300 ms) — the part outside the room
// is cropped so the tail really comes through the door. Parcel flights
// (unload → conveyor, shelf → door) are the LaneRenderer's.
import type Phaser from 'phaser'
import type { GameData } from '../../data/types.ts'
import type { VehicleSnapshot, ViewSim } from '../../sim/view-api.ts'
import { addPanel } from '../../ui/Panel.ts'
import { addText, textTop } from '../../ui/text.ts'
import { PALETTE, THEME } from '../../ui/theme.ts'
import { WAREHOUSE_ATLAS } from '../atlases.ts'
import { frameOrNull } from '../frames.ts'
import type { RoomLayers } from './LaneRenderer.ts'
import {
  DOCK_LAMP,
  DOCK_PANEL,
  DOOR,
  LOCKED_DOORS,
  TAIL,
  TAIL_HIDDEN_X,
  type Rect,
} from './RoomLayout.ts'

const TAIL_MS = 300
const BLINK_MS = 250 // 2 Hz red blink
const DOCK_ID = 'dock1'
const PANEL_H = 44
const GLYPHS = 3

type Img = Phaser.GameObjects.Image
type Txt = Phaser.GameObjects.BitmapText

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

/** Tooltip "Loading dock 2 — unlocks at Lv 3 ($800) · coming soon" (§6). */
export function lockedDockText(data: GameData, i: number): string | null {
  const row = data.economy.docks[i]
  if (!row) return null
  const soon =
    row.unlockLevel > data.economy.playtestMaxLevel ? ' · coming soon' : ''
  return `Loading dock ${row.index} — unlocks at Lv ${row.unlockLevel} ($${row.price.toLocaleString('en-US')})${soon}`
}

export class DockView {
  readonly scene: Phaser.Scene
  private L: RoomLayers
  private vs: ViewSim
  private door: Img
  private tail: Img
  private lamp: Img
  private panelLamp: Img
  private title: Txt
  private status: Txt
  private queue: Txt
  private glyphs: Img[] = []
  private barTrack: Phaser.GameObjects.Rectangle
  private barFill: Phaser.GameObjects.Rectangle
  private tailId: number | null = null
  private tailType = 'van'
  private tailTween: Phaser.Tweens.Tween | null = null
  private leaving = false
  private startCargo = 0
  private blink = 0

  constructor(scene: Phaser.Scene, layers: RoomLayers, vs: ViewSim) {
    this.scene = scene
    this.L = layers
    this.vs = vs
    const add = (
      layer: Phaser.GameObjects.Container,
      x: number,
      y: number,
      f: string,
    ): Img => {
      const img = scene.add
        .image(x, y, WAREHOUSE_ATLAS, frameOrNull(f) ?? '__MISSING')
        .setOrigin(0, 0)
      layer.add(img)
      return img
    }
    this.door = add(layers.walls, DOOR.x, DOOR.y, 'dock_door_closed')
    LOCKED_DOORS.forEach((r, i) => {
      add(layers.walls, r.x, r.y, 'dock_door_locked')
      add(layers.badges, r.x + 8, r.y + 12, 'ic_lock')
      const row = vs.data.economy.docks[i]
      const t = addText(scene, 0, r.y + 32, row ? `Lv${row.unlockLevel}` : '', {
        tint: PALETTE.grey5,
        shadow: true,
      })
      t.setX(Math.round(r.x + (r.w - t.width) / 2))
      layers.badges.add(t)
    })
    this.tail = add(layers.tail, TAIL_HIDDEN_X, TAIL.y, 'dock_tail_van_closed')
    this.tail.setVisible(false)
    this.lamp = add(layers.badges, DOCK_LAMP.x, DOCK_LAMP.y, 'lamp_off')

    // Status panel (§1.4): lamp copy, "Dock 1", activity, queue + glyphs, bar.
    const P = DOCK_PANEL
    const panel = addPanel(scene, P.x, P.y, P.w, PANEL_H, 'ui_panel_dark')
    layers.badges.add(panel)
    this.panelLamp = add(layers.badges, P.x + 6, P.y + 8, 'lamp_off')
    this.title = addText(scene, P.x + 18, textTop(P.y + 2, 18), 'Dock 1', {
      tint: THEME.textLight,
    })
    this.status = addText(scene, P.x + 62, textTop(P.y + 2, 18), '', {
      tint: PALETTE.grey3,
    })
    this.queue = addText(scene, P.x + 6, textTop(P.y + 20, 18), '', {
      tint: PALETTE.grey3,
    })
    layers.badges.add([this.title, this.status, this.queue])
    for (let i = 0; i < GLYPHS; i++)
      this.glyphs.push(
        add(layers.badges, P.x + 70 + i * 18, P.y + 21, 'ic_van'),
      )
    this.barTrack = scene.add
      .rectangle(P.x + 6, P.y + PANEL_H - 5, P.w - 12, 2, PALETTE.grey0, 1)
      .setOrigin(0, 0)
    this.barFill = scene.add
      .rectangle(P.x + 6, P.y + PANEL_H - 5, 0, 2, THEME.ok, 1)
      .setOrigin(0, 0)
    layers.badges.add([this.barTrack, this.barFill])
  }

  private dock() {
    return this.vs.docks.find((d) => d.id === DOCK_ID) ?? null
  }

  /** The vehicle standing in dock 1 (docked_unloading / docked_loading), or null. */
  dockedVehicle(): VehicleSnapshot | null {
    const id = this.dock()?.vehicleId ?? null
    if (id === null) return null
    const v = this.vs.vehicles.find((x) => x.id === id) ?? null
    return v && v.state.startsWith('docked') ? v : null
  }

  /** Dock tap tooltip: "Dock 1 — Van 2 unloading 4/9 · queue 1". */
  tooltipText(): string {
    const v = this.dockedVehicle()
    const total = Math.max(this.startCargo, v?.cargo.length ?? 0)
    const act = dockActivity(v, total - (v?.cargo.length ?? 0), total)
    return `Dock 1 — ${act} · queue ${this.vs.dockQueue.length}`
  }

  /** Index into economy.docks of the locked door at room (x, y), or null. */
  lockedDoorAt(x: number, y: number): number | null {
    const i = LOCKED_DOORS.findIndex(
      (r: Rect) => x >= r.x && x < r.x + r.w + 12 && y >= r.y && y < r.y + r.h,
    )
    return i >= 0 ? i : null
  }

  syncAll(): void {
    this.tailTween?.stop()
    this.tailTween = null
    this.leaving = false
    const v = this.dockedVehicle()
    if (v) {
      this.tailId = v.id
      this.tailType = v.type
      this.startCargo = v.cargo.length
      this.setTail(TAIL.x, true)
    } else {
      this.tailId = null
      this.tail.setVisible(false)
    }
    this.refresh(0)
  }

  update(_time: number, delta: number): void {
    const v = this.dockedVehicle()
    if (v && v.id !== this.tailId) this.slideIn(v)
    else if (!v && this.tailId !== null && !this.leaving) this.slideOut()
    if (v && v.cargo.length > this.startCargo) this.startCargo = v.cargo.length
    this.refresh(delta)
  }

  private setTail(x: number, open: boolean): void {
    const f = frameOrNull(
      `dock_tail_${this.tailType}_${open ? 'open' : 'closed'}`,
    )
    if (f) this.tail.setFrame(f)
    this.tail.setVisible(true).setX(Math.round(x))
    // Crop what is still outside the room (left of the west wall).
    const cut = Math.max(0, -Math.round(x))
    if (cut > 0) this.tail.setCrop(cut, 0, TAIL.w - cut, TAIL.h)
    else this.tail.setCrop()
  }

  private slideIn(v: VehicleSnapshot): void {
    this.tailTween?.stop()
    this.leaving = false
    this.tailId = v.id
    this.tailType = v.type
    this.startCargo = v.cargo.length
    this.setTail(TAIL_HIDDEN_X, false)
    const prog = { x: TAIL_HIDDEN_X }
    this.tailTween = this.scene.tweens.add({
      targets: prog,
      x: TAIL.x,
      duration: TAIL_MS,
      ease: 'Quad.easeOut',
      onUpdate: () => this.setTail(prog.x, false),
      onComplete: () => {
        this.tailTween = null
        this.setTail(TAIL.x, true)
      },
    })
  }

  private slideOut(): void {
    this.tailTween?.stop()
    this.leaving = true
    const prog = { x: this.tail.x }
    this.setTail(prog.x, false)
    this.tailTween = this.scene.tweens.add({
      targets: prog,
      x: TAIL_HIDDEN_X,
      duration: TAIL_MS,
      ease: 'Quad.easeIn',
      onUpdate: () => this.setTail(prog.x, false),
      onComplete: () => {
        this.tailTween = null
        this.tail.setVisible(false)
        this.tailId = null
        this.leaving = false
      },
    })
  }

  private refresh(delta: number): void {
    this.blink = (this.blink + delta) % (2 * BLINK_MS)
    const v = this.dockedVehicle()
    const conv = this.vs.lane.nodes().find((n) => n.kind === 'conveyor') ?? null
    const blocked =
      v?.state === 'docked_unloading' &&
      conv !== null &&
      conv.cap !== null &&
      conv.queue.length >= conv.cap
    const queued = this.vs.dockQueue.length
    let lamp = 'lamp_off'
    if (blocked || queued > 0)
      lamp = this.blink < BLINK_MS ? 'lamp_red' : 'lamp_off'
    else if (v) lamp = 'lamp_green'
    if (this.lamp.frame.name !== lamp) this.lamp.setFrame(lamp)
    if (this.panelLamp.frame.name !== lamp) this.panelLamp.setFrame(lamp)
    const door = v || this.tailTween ? 'dock_door_open' : 'dock_door_closed'
    if (this.door.frame.name !== door) this.door.setFrame(door)

    const total = Math.max(this.startCargo, v?.cargo.length ?? 0)
    const left = v?.cargo.length ?? 0
    this.status.setText(
      dockActivity(v, total - left, total).replace(/^\S+ \d+ /, ''),
    )
    this.queue.setText(queued > 0 ? `Queue ${queued}` : 'Queue 0')
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
    const unloading = v?.state === 'docked_unloading' && total > 0
    const frac = unloading ? (total - left) / total : 0
    this.barTrack.setVisible(unloading)
    this.barFill.setVisible(unloading)
    this.barFill.width = Math.round(this.barTrack.width * frac)
  }

  destroy(): void {
    this.tailTween?.stop()
  }

  /** Rect of the dock (tap target) in room px. */
  static readonly hit: Rect = { x: 0, y: 32, w: 128, h: 64 }
  /** For the scene: the panel rect is part of the dock's tap area. */
  static readonly panel: Rect = { ...DOCK_PANEL, h: PANEL_H }
}
