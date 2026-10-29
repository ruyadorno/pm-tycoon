// Button (city-view.md §4.3/§7, style-guide.md §1.7, phaser4-notes.md §4): a
// Container at an integer top-left holding a ui_btn* NineSlice, an optional
// 16x16 (or 32x32) icon, an optional m5x7 label and an optional count badge.
// The NineSlice is the interactive object; its hit area is a Rectangle local
// to its top-left, grown to at least minHit (= L.minHit, ceil(44 / zoom)) on
// each axis or set explicitly from a layout Target's `hit` rect.
//
// Visual state precedence: disabled > pressed (finger down) > selected >
// red > glow > normal. Faces: 'secondary' ui_btn, 'primary' ui_btn_primary,
// 'red' ui_btn_red; pressed uses the matching _down frame and shifts the icon
// and label down 1 px. A tap = pointerdown then pointerup on the button with
// at most TAP_PX of travel (so a drag that starts on a list row's button
// scrolls the list instead). Every tap emits `ui:tap` on game.events; a tap
// on a disabled button calls onDisabledTap instead of onClick (the tap is
// still swallowed so it never reaches the city).
import Phaser from 'phaser'
import type { FrameName } from '../render/frames.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import type { Rect } from './layout.ts'
import { minHitFor } from './layout.ts'
import { BAR_CAP, BAR_FILL, SLICE } from './Panel.ts'
import { addText, textTop } from './text.ts'
import { PALETTE, THEME } from './theme.ts'

export const TAP_PX = 8
/** Gap between icon and label. */
export const ICON_GAP = 4
/** The gap when icon + label would not fit with CONTENT_PAD on both sides. */
export const ICON_GAP_TIGHT = 2
/** Minimum air between the content and the face's edges (1 px outline + bevel). */
export const CONTENT_PAD = 5
/** Badge: 14 px tall pill, at least 14 wide, 3 px text padding. */
export const BADGE_H = 14

export type ButtonFace = 'secondary' | 'primary' | 'red'
export type ButtonVisual = 'normal' | 'down' | 'disabled' | 'glow' | 'red'
export type BadgeColour = 'red' | 'green'

export interface ButtonOptions {
  /** Visual rect, integer top-left in the parent's coordinates. */
  x: number
  y: number
  w: number
  h: number
  label?: string
  icon?: FrameName | null
  /** Base face; default 'secondary'. */
  face?: ButtonFace
  /**
   * Hit rect in the same coordinates as x/y (e.g. a layout Target's `hit`);
   * default: the visual rect grown symmetrically to `minHit`.
   */
  hit?: Rect
  /** Minimum hit size per axis; default ceil(44 / scene.scale.zoom). */
  minHit?: number
  onClick?: () => void
  onDisabledTap?: () => void
  /** Carried in the `ui:tap` payload and as data 'id' (e2e selectors). */
  id?: string
}

const UP: Record<ButtonFace, FrameName> = {
  secondary: 'ui_btn',
  primary: 'ui_btn_primary',
  red: 'ui_btn_red',
}
const DOWN: Record<ButtonFace, FrameName> = {
  secondary: 'ui_btn_down',
  primary: 'ui_btn_primary_down',
  red: 'ui_btn_red_down',
}

/**
 * Icon + label layout inside a `bw`-wide face: the normal ICON_GAP when both
 * fit with CONTENT_PAD on each side, ICON_GAP_TIGHT when only that fits, else
 * the label alone (the icon hides) so a label never touches the face's edge
 * (`Warehouse` in the 77-px bottom-bar button at W 360).
 */
export function fitContent(
  bw: number,
  iconW: number,
  textW: number,
): { icon: boolean; gap: number; textW: number } {
  if (iconW === 0 || textW === 0) return { icon: iconW > 0, gap: 0, textW }
  const room = bw - 2 * CONTENT_PAD
  if (iconW + ICON_GAP + textW <= room)
    return { icon: true, gap: ICON_GAP, textW }
  if (iconW + ICON_GAP_TIGHT + textW <= room)
    return { icon: true, gap: ICON_GAP_TIGHT, textW }
  return { icon: false, gap: 0, textW }
}

export class Button extends Phaser.GameObjects.Container {
  readonly bg: Phaser.GameObjects.NineSlice
  readonly id: string
  onClick: (() => void) | null
  onDisabledTap: (() => void) | null

  private icon: Phaser.GameObjects.Image | null = null
  private text: Phaser.GameObjects.BitmapText | null = null
  private badge: Phaser.GameObjects.Container | null = null
  private face: ButtonFace
  private bw: number
  private bh: number
  private hitRect: Rect | null
  private minHit: number
  private enabled = true
  private pressed = false
  private selected = false
  private red = false
  private glow = false
  private pulseTimer: Phaser.Time.TimerEvent | null = null

  constructor(scene: Phaser.Scene, opts: ButtonOptions) {
    super(scene, Math.round(opts.x), Math.round(opts.y))
    this.id = opts.id ?? opts.label ?? ''
    this.face = opts.face ?? 'secondary'
    this.bw = Math.round(opts.w)
    this.bh = Math.round(opts.h)
    this.hitRect = opts.hit ?? null
    this.minHit = opts.minHit ?? minHitFor(scene.scale.zoom)
    this.onClick = opts.onClick ?? null
    this.onDisabledTap = opts.onDisabledTap ?? null

    this.bg = new Phaser.GameObjects.NineSlice(
      scene,
      0,
      0,
      UI_ATLAS,
      UP[this.face],
      this.bw,
      this.bh,
      SLICE,
      SLICE,
      SLICE,
      SLICE,
    ).setOrigin(0, 0)
    this.add(this.bg)
    if (opts.icon) {
      this.icon = new Phaser.GameObjects.Image(
        scene,
        0,
        0,
        UI_ATLAS,
        opts.icon,
      ).setOrigin(0, 0)
      this.add(this.icon)
    }
    if (opts.label !== undefined) {
      this.text = addText(scene, 0, 0, opts.label)
      this.add(this.text)
    }
    this.setData('id', this.id)
    if (opts.label !== undefined) this.setData('label', opts.label)

    this.applyHitArea()
    this.bg.on('pointerdown', this.onDown, this)
    this.bg.on('pointerout', this.onOut, this)
    this.bg.on('pointerup', this.onUp, this)
    this.refresh()
    scene.add.existing(this)
  }

  // ---- public API --------------------------------------------------------

  setEnabled(on: boolean): this {
    if (this.enabled === on) return this
    this.enabled = on
    if (!on) this.pressed = false
    return this.refresh()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setLabel(label: string): this {
    if (!this.text) {
      this.text = addText(this.scene, 0, 0, label)
      this.add(this.text)
    } else this.text.setText(label)
    this.setData('label', label)
    return this.refresh()
  }

  setIcon(frame: FrameName | null): this {
    if (!frame) {
      this.icon?.destroy()
      this.icon = null
    } else if (this.icon) this.icon.setFrame(frame)
    else {
      this.icon = new Phaser.GameObjects.Image(
        this.scene,
        0,
        0,
        UI_ATLAS,
        frame,
      ).setOrigin(0, 0)
      this.addAt(this.icon, 1)
    }
    return this.refresh()
  }

  /** A count/flag pill at the top-right corner; null removes it. */
  setBadge(text: string | null, colour: BadgeColour = 'red'): this {
    this.badge?.destroy()
    this.badge = null
    if (text === null || text === '') return this
    const t = addText(this.scene, 0, 0, text, { tint: THEME.textLight })
    const w = Math.max(BADGE_H, Math.round(t.width) + 6)
    const pill = new Phaser.GameObjects.NineSlice(
      this.scene,
      0,
      0,
      UI_ATLAS,
      colour === 'green' ? BAR_FILL.green : BAR_FILL.red,
      w,
      BADGE_H,
      BAR_CAP,
      BAR_CAP,
      BAR_CAP,
      BAR_CAP,
    ).setOrigin(0, 0)
    t.setPosition(Math.round((w - t.width) / 2), textTop(0, BADGE_H))
    this.badge = new Phaser.GameObjects.Container(
      this.scene,
      this.bw - w + 3,
      -3,
      [pill, t],
    )
    this.add(this.badge)
    return this
  }

  /** Persistent pressed look (the active speed segment, a toggled tab). */
  setSelected(on: boolean): this {
    this.selected = on
    return this.refresh()
  }

  /** btn_red face (stalled lane); wins over glow. */
  setRed(on: boolean): this {
    this.red = on
    return this.refresh()
  }

  setGlow(on: boolean): this {
    this.glow = on
    return this.refresh()
  }

  /** Alternate normal/glow at 2 Hz (frame swap, no scaling); scene clock. */
  setPulse(on: boolean): this {
    if (on && !this.pulseTimer) {
      this.pulseTimer = this.scene.time.addEvent({
        delay: 250,
        loop: true,
        callback: () => this.setGlow(!this.glow),
      })
    } else if (!on && this.pulseTimer) {
      this.pulseTimer.remove(false)
      this.pulseTimer = null
      this.setGlow(false)
    }
    return this
  }

  /** Change the base face ('secondary' | 'primary' | 'red'). */
  setFace(face: ButtonFace): this {
    this.face = face
    return this.refresh()
  }

  /** Move/resize to a new visual rect (and optional explicit hit rect). */
  setRect(r: Rect, hit?: Rect, minHit?: number): this {
    this.setPosition(Math.round(r.x), Math.round(r.y))
    this.bw = Math.round(r.w)
    this.bh = Math.round(r.h)
    this.hitRect = hit ?? null
    if (minHit !== undefined) this.minHit = minHit
    this.bg.setSize(this.bw, this.bh)
    this.applyHitArea()
    if (this.badge) {
      const pill = this.badge.list[0] as Phaser.GameObjects.NineSlice
      this.badge.setX(this.bw - pill.width + 3)
    }
    return this.refresh()
  }

  get visual(): ButtonVisual {
    if (!this.enabled) return 'disabled'
    if (this.pressed || this.selected) return 'down'
    if (this.red) return 'red'
    if (this.glow) return 'glow'
    return 'normal'
  }

  get btnWidth(): number {
    return this.bw
  }

  get btnHeight(): number {
    return this.bh
  }

  override destroy(fromScene?: boolean): void {
    this.pulseTimer?.remove(false)
    this.pulseTimer = null
    super.destroy(fromScene)
  }

  // ---- internals ---------------------------------------------------------

  private applyHitArea(): void {
    let hx: number
    let hy: number
    let hw: number
    let hh: number
    if (this.hitRect) {
      hx = this.hitRect.x - this.x
      hy = this.hitRect.y - this.y
      hw = this.hitRect.w
      hh = this.hitRect.h
    } else {
      hw = Math.max(this.bw, this.minHit)
      hh = Math.max(this.bh, this.minHit)
      hx = -Math.floor((hw - this.bw) / 2)
      hy = -Math.floor((hh - this.bh) / 2)
    }
    const area = new Phaser.Geom.Rectangle(hx, hy, hw, hh)
    if (this.bg.input) {
      this.bg.input.hitArea = area
    } else {
      this.bg.setInteractive(area, Phaser.Geom.Rectangle.Contains)
    }
  }

  private frameFor(): FrameName {
    if (!this.enabled) return 'ui_btn_off'
    const face: ButtonFace = this.red ? 'red' : this.face
    if (this.pressed || this.selected) return DOWN[face]
    if (this.red) return UP.red
    if (this.glow && this.face === 'secondary') return 'ui_btn_glow'
    return UP[face]
  }

  private refresh(): this {
    const frame = this.frameFor()
    if (this.bg.frame.name !== frame) this.bg.setFrame(frame)
    const face: ButtonFace = this.red ? 'red' : this.face
    const tint = !this.enabled
      ? PALETTE.grey2
      : face === 'secondary'
        ? THEME.textDark
        : THEME.textLight
    const shift = this.enabled && (this.pressed || this.selected) ? 1 : 0
    const fit = fitContent(
      this.bw,
      this.icon ? Math.round(this.icon.width) : 0,
      this.text && this.text.text !== '' ? Math.round(this.text.width) : 0,
    )
    const iw = fit.icon ? Math.round(this.icon?.width ?? 0) : 0
    const ih = this.icon ? Math.round(this.icon.height) : 0
    const x0 = Math.round((this.bw - (iw + fit.gap + fit.textW)) / 2)
    if (this.icon) {
      this.icon.setVisible(fit.icon)
      this.icon.setPosition(x0, Math.floor((this.bh - ih) / 2) + shift)
      this.icon.setAlpha(this.enabled ? 1 : 0.5)
    }
    if (this.text) {
      this.text.setTint(tint)
      this.text.setPosition(x0 + iw + fit.gap, textTop(0, this.bh) + shift)
    }
    return this
  }

  private onDown(): void {
    if (!this.enabled) return
    this.pressed = true
    this.refresh()
  }

  private onOut(): void {
    if (!this.pressed) return
    this.pressed = false
    this.refresh()
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    const wasPressed = this.pressed
    this.pressed = false
    if (pointer.getDistance() > TAP_PX) {
      this.refresh()
      return
    }
    if (!this.enabled) {
      this.scene.game.events.emit('ui:tap', { id: this.id, disabled: true })
      this.onDisabledTap?.()
      return
    }
    this.refresh()
    if (!wasPressed) return
    this.scene.game.events.emit('ui:tap', { id: this.id })
    this.onClick?.()
  }
}
