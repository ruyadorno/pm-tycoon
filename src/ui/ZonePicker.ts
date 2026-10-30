// Home-zone picker (city-view.md §6.2, §7.2; spec §4.1): the popover the
// Garage row's zone chip (`Any ▾`) opens. Rows: `Any`, then every live
// district by flavour name, then the locked ones greyed with `Lv N`; the
// Industrial row is greyed `Trucks only` for the types whose
// `vehicles.json disallowedRegions` names it; overseas hubs are never listed
// (they are not zones). Picking → viewSim.setHomeZone, then the picker closes.
// While open it emits `pm:zonePick {districtId|null}` (the vehicle's current
// zone on open, null on close) so the City draws the zone highlight.
//
// Also home to two small helpers the other popovers share:
//   - PopoverLayer: a Container at a far-off world origin seen through its
//     own full-screen camera added last (so it draws above a Sheet's list
//     camera and the HUD's strip cameras), with a transparent full-screen
//     backdrop that swallows taps and reports "outside" taps;
//   - addTapZone: an invisible interactive rectangle with the kit's tap rule
//     (≤ TAP_PX travel) that emits `ui:tap`.
import type Phaser from 'phaser'
import type { GameData, MapData } from '../data/types.ts'
import type { CommandResult } from '../sim/commands.ts'
import type { VehicleType, Zone } from '../sim/types.ts'
import type { ViewSim } from '../sim/view-api.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { Button, TAP_PX } from './Button.ts'
import type { Rect } from './layout.ts'
import { minHitFor } from './layout.ts'
import { addPanel } from './Panel.ts'
import { claimKey, offscreenOrigin, popModal, pushModal } from './Sheet.ts'
import { addText, textTop } from './text.ts'
import { EV_TOAST } from './Toast.ts'
import { PALETTE, THEME } from './theme.ts'

export const EV_ZONE_PICK = 'pm:zonePick'
export const EV_UI_TAP = 'ui:tap'
export const EV_UI_SFX = 'ui:sfx'

/** Popover geometry. */
export const PICKER_W = 196
export const PICKER_PAD = 4
/** Selectable rows are full tap targets; greyed rows are text lines. */
export const PICKER_ROW_H = 44
export const PICKER_GREY_ROW_H = 20
const ROW_GAP = 2
const TEXT_X = 8
const EDGE = 4

// ---- pure model ------------------------------------------------------------

export interface ZoneOption {
  zone: Zone
  /** `Any` or the district's flavour name. */
  label: string
  /** Tappable (live and allowed for this vehicle type). */
  enabled: boolean
  /** Right-aligned grey note: `Lv 2`, `Trucks only`, or ''. */
  note: string
  /** The vehicle's current zone. */
  current: boolean
}

/**
 * The picker rows for a vehicle of `type` whose zone is `current`: `Any`,
 * the live districts in districts.json order, then the locked ones. Hubs
 * (kind 'overseas') are not zones and never listed. A district the type may
 * not enter (`disallowedRegions`) is greyed `Trucks only` (named after the
 * types that may), whatever its lock state; other locked ones read `Lv N`.
 */
export function zoneOptions(
  data: GameData,
  type: VehicleType,
  isLive: (districtId: string) => boolean,
  current: Zone,
): ZoneOption[] {
  const def = data.vehicles.types.find((t) => t.id === type)
  const banned = new Set(def?.disallowedRegions ?? [])
  const any: ZoneOption = {
    zone: 'any',
    label: 'Any',
    enabled: true,
    note: '',
    current: current === 'any',
  }
  const live: ZoneOption[] = []
  const locked: ZoneOption[] = []
  for (const d of data.districts) {
    if (d.kind !== 'district') continue
    const open = isLive(d.id)
    const disallowed = banned.has(d.id)
    const opt: ZoneOption = {
      zone: d.id,
      label: d.flavour,
      enabled: open && !disallowed,
      note: disallowed
        ? onlyNote(data, d.allowed)
        : open
          ? ''
          : `Lv ${d.unlockLevel}`,
      current: current === d.id,
    }
    ;(open ? live : locked).push(opt)
  }
  return [any, ...live, ...locked]
}

/** `Trucks only` from a district's allowed types (vehicles.json names, plural). */
function onlyNote(data: GameData, allowed: readonly string[]): string {
  const names = data.vehicles.types
    .filter((t) => allowed.includes(t.id))
    .map((t) => `${t.name}s`)
  return names.length > 0 ? `${names.join(' and ')} only` : 'Not allowed'
}

/** Short zone name for chips (`Any`, map.json `chipLabel`, else the flavour). */
export function zoneLabel(data: GameData, map: MapData, zone: Zone): string {
  if (zone === 'any') return 'Any'
  const region = map.regions.find((r) => r.id === zone)
  if (region) return region.chipLabel
  return data.districts.find((d) => d.id === zone)?.flavour ?? zone
}

/** The Garage row's zone chip text: `Any ▾`, `Heights ▾`. */
export function zoneChipText(data: GameData, map: MapData, zone: Zone): string {
  return `${zoneLabel(data, map, zone)} ▾`
}

/** Popover placement: above the anchor when it fits, else below; clamped. */
export function placePopover(
  anchor: Rect,
  w: number,
  h: number,
  W: number,
  H: number,
  minTop = EDGE,
): { x: number; y: number } {
  const x = Math.round(
    Math.min(Math.max(EDGE, anchor.x + anchor.w - w), W - EDGE - w),
  )
  let y = anchor.y - EDGE - h
  if (y < minTop) y = anchor.y + anchor.h + EDGE
  y = Math.min(Math.max(minTop, y), H - EDGE - h)
  return { x, y: Math.round(y) }
}

/** Popover height for a list of options. */
export function pickerHeight(options: readonly ZoneOption[]): number {
  let h = 2 * PICKER_PAD
  for (const o of options)
    h += o.enabled ? PICKER_ROW_H : PICKER_GREY_ROW_H + ROW_GAP
  return h
}

/**
 * Tooltip/toast text for a command failure reason (plan.md §5 strings; M6
 * people reasons, spec-build2 §8 / design-m6 §6.3). Pass `data` for the
 * unlock levels (`Opens at Lv 2`, `Second desk opens at Lv 3`, from
 * employees.json holdStation / desks.rows); without it those read without a
 * number, so code never hard-codes a level.
 */
export function failText(
  reason: string,
  data?: Pick<GameData, 'employees'>,
): string {
  switch (reason) {
    case 'trucks-only':
      return 'Trucks only'
    case 'needs-van':
      return 'Needs a van'
    case 'no-vehicle':
      return 'No vehicle free'
    case 'insufficient-funds':
      return 'Not enough money'
    case 'last-vehicle':
      return 'Keep at least one vehicle'
    case 'locked':
      return 'Not available yet'
    case 'no-applicant':
      return 'That applicant took another job'
    case 'station-locked': {
      const lv = data?.employees.holdStation.unlockLevel
      return lv !== undefined ? `Opens at Lv ${lv}` : 'Not open yet'
    }
    case 'station-occupied':
      return 'The station is taken'
    case 'desk-locked': {
      const lv = data?.employees.desks.rows.find((r) => r.index === 2)
      return lv
        ? `Second desk opens at Lv ${lv.unlockLevel}`
        : 'Second desk not open yet'
    }
    case 'desk-exists':
      return 'That desk is already placed'
    default:
      return 'Not possible right now'
  }
}

// ---- shared popover helpers ------------------------------------------------

export interface PopoverLayerOptions {
  /** A tap on the backdrop (outside the popover's own interactive objects). */
  onOutside?: () => void
  W?: number
  H?: number
}

/**
 * A full-screen layer drawn above everything else in its scene: objects go
 * in `root` at screen coordinates. Every other camera ignores the layer and
 * its camera ignores everything else (like Dialog), so neither a Sheet's
 * list camera nor a HUD strip camera can draw over it. The transparent
 * backdrop swallows taps; a tap on it calls onOutside.
 */
export class PopoverLayer {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  readonly cam: Phaser.Cameras.Scene2D.Camera
  readonly backdrop: Phaser.GameObjects.Rectangle
  private armed = false
  private alive = true

  constructor(scene: Phaser.Scene, opts: PopoverLayerOptions = {}) {
    this.scene = scene
    const W = Math.round(opts.W ?? scene.scale.width)
    const H = Math.round(opts.H ?? scene.scale.height)
    const o = offscreenOrigin()
    this.backdrop = scene.add
      .rectangle(0, 0, W, H, THEME.shadow, 0)
      .setOrigin(0, 0)
      .setInteractive()
    this.backdrop.on('pointerdown', () => {
      this.armed = true
    })
    this.backdrop.on('pointerup', (p: Phaser.Input.Pointer) => {
      const armed = this.armed
      this.armed = false
      if (armed && p.getDistance() <= TAP_PX) opts.onOutside?.()
    })
    this.root = scene.add.container(o.x, o.y, [this.backdrop]).setDepth(90000)
    for (const c of scene.cameras.cameras) c.ignore(this.root)
    this.cam = scene.cameras.add(0, 0, W, H)
    this.cam.setScroll(o.x, o.y)
    for (const obj of scene.children.list)
      if (obj !== this.root) this.cam.ignore(obj)
  }

  add(...objs: Phaser.GameObjects.GameObject[]): this {
    this.root.add(objs)
    return this
  }

  resize(W: number, H: number): void {
    if (!this.alive) return
    this.cam.setSize(Math.round(W), Math.round(H))
    this.backdrop.setSize(Math.round(W), Math.round(H))
    const area = this.backdrop.input?.hitArea as
      | Phaser.Geom.Rectangle
      | undefined
    area?.setSize(Math.round(W), Math.round(H))
  }

  destroy(): void {
    if (!this.alive) return
    this.alive = false
    this.root.destroy()
    this.scene.cameras.remove(this.cam, true)
  }
}

/**
 * An invisible tap target over `r` (in the coordinates of whatever it is
 * added to): pointerdown then pointerup on it with ≤ TAP_PX travel emits
 * `ui:tap {id}` and calls onTap. Returns the Rectangle (add it to a
 * container; destroy it with that container).
 */
export function addTapZone(
  scene: Phaser.Scene,
  r: Rect,
  id: string,
  onTap: () => void,
  onPress?: (down: boolean) => void,
): Phaser.GameObjects.Rectangle {
  const z = scene.add
    .rectangle(Math.round(r.x), Math.round(r.y), r.w, r.h, THEME.shadow, 0)
    .setOrigin(0, 0)
    .setInteractive()
  let down = false
  z.on('pointerdown', () => {
    down = true
    onPress?.(true)
  })
  z.on('pointerout', () => {
    if (down) onPress?.(false)
    down = false
  })
  z.on('pointerup', (p: Phaser.Input.Pointer) => {
    const was = down
    down = false
    onPress?.(false)
    if (!was || p.getDistance() > TAP_PX) return
    scene.game.events.emit(EV_UI_TAP, { id })
    onTap()
  })
  return z
}

// ---- the picker ------------------------------------------------------------

export interface ZonePickerOptions {
  vehicleId: number
  /** Screen rect of the chip that opened the picker. */
  anchor: Rect
  W?: number
  H?: number
  /** Called after a successful or failed setHomeZone. */
  onPicked?: (zone: Zone, result: CommandResult) => void
  /** Called once when the picker closes (pick, outside tap, Esc, close()). */
  onClose?: () => void
}

/**
 * `new ZonePicker(scene, viewSim, opts)` opens immediately and destroys
 * itself when it closes. Esc closes it (it is the top modal while open).
 */
export class ZonePicker {
  readonly scene: Phaser.Scene
  readonly vehicleId: number
  private vs: ViewSim
  private opts: ZonePickerOptions
  private layer: PopoverLayer
  private open = true

  constructor(scene: Phaser.Scene, viewSim: ViewSim, opts: ZonePickerOptions) {
    this.scene = scene
    this.vs = viewSim
    this.opts = opts
    this.vehicleId = opts.vehicleId
    const W = Math.round(opts.W ?? scene.scale.width)
    const H = Math.round(opts.H ?? scene.scale.height)
    const v = viewSim.vehicles.find((x) => x.id === opts.vehicleId)
    const current: Zone = v?.zone ?? 'any'
    const options = zoneOptions(
      viewSim.data,
      v?.type ?? 'bike',
      (id) => viewSim.regionState(id) === 'live',
      current,
    )

    this.layer = new PopoverLayer(scene, {
      W,
      H,
      onOutside: () => this.close(),
    })
    const ph = pickerHeight(options)
    const at = placePopover(opts.anchor, PICKER_W, ph, W, H)
    const panel = addPanel(scene, at.x, at.y, PICKER_W, ph, 'ui_panel')
    panel.setInteractive() // taps on greyed rows stay inside the popover
    this.layer.add(panel)

    const minHit = minHitFor(scene.scale.zoom)
    const bw = PICKER_W - 2 * PICKER_PAD
    let y = at.y + PICKER_PAD
    for (const o of options) {
      if (o.enabled) {
        const btn = new Button(scene, {
          x: at.x + PICKER_PAD,
          y: y + 1,
          w: bw,
          h: PICKER_ROW_H - ROW_GAP,
          hit: { x: at.x + PICKER_PAD, y, w: bw, h: PICKER_ROW_H },
          minHit,
          id: `zone:${o.zone}`,
          onClick: () => this.pick(o.zone),
        })
        btn.setSelected(o.current)
        const t = addText(scene, TEXT_X, 0, o.label)
        t.setY(textTop(0, PICKER_ROW_H - ROW_GAP))
        btn.add(t)
        if (o.current) {
          const check = scene.add
            .image(bw - 6 - 16, 0, UI_ATLAS, 'ic_check')
            .setOrigin(0, 0)
          check.setY(Math.floor((PICKER_ROW_H - ROW_GAP - 16) / 2))
          btn.add(check)
        }
        this.layer.add(btn)
        y += PICKER_ROW_H
      } else {
        const t = addText(scene, at.x + PICKER_PAD + TEXT_X, 0, o.label, {
          tint: PALETTE.grey2,
        })
        t.setY(textTop(y + 1, PICKER_GREY_ROW_H))
        this.layer.add(t)
        if (o.note) {
          const n = addText(scene, 0, 0, o.note, { tint: PALETTE.grey2 })
          n.setPosition(
            at.x + PICKER_W - PICKER_PAD - TEXT_X - Math.round(n.width),
            textTop(y + 1, PICKER_GREY_ROW_H),
          )
          this.layer.add(n)
        }
        y += PICKER_GREY_ROW_H + ROW_GAP
      }
    }

    pushModal(this)
    scene.input.keyboard?.on('keydown', this.onKey, this)
    scene.events.once('shutdown', this.destroy, this)
    scene.events.once('sleep', this.close, this)
    scene.game.events.emit(EV_ZONE_PICK, {
      districtId: current === 'any' ? null : current,
    })
  }

  isOpen(): boolean {
    return this.open
  }

  /** Close (emits pm:zonePick {districtId: null}, then onClose). */
  close(): void {
    if (!this.open) return
    this.destroy()
    this.scene.game.events.emit(EV_ZONE_PICK, { districtId: null })
    this.opts.onClose?.()
  }

  /** Tear down without events or callbacks (scene shutdown). */
  destroy(): void {
    if (!this.open) return
    this.open = false
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
    this.scene.events.off('shutdown', this.destroy, this)
    this.scene.events.off('sleep', this.close, this)
    this.layer.destroy()
  }

  private pick(zone: Zone): void {
    if (!this.open) return
    const res = this.vs.setHomeZone(this.vehicleId, zone)
    if (!res.ok) {
      this.scene.game.events.emit(EV_TOAST, { text: failText(res.reason) })
      this.scene.game.events.emit(EV_UI_SFX, { name: 'deny' })
    } else {
      this.scene.game.events.emit(EV_ZONE_PICK, {
        districtId: zone === 'any' ? null : zone,
      })
    }
    this.opts.onPicked?.(zone, res)
    this.close()
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && claimKey(ev, this)) this.close()
  }
}
