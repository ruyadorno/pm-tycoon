// Modal confirm (city-view.md §7.5): a 280x128 `ui_panel` centred on a
// full-screen black backdrop at alpha 0.5 that swallows taps; a title, one
// text line (wraps to a second line if it must) and two 44-px buttons
// (Cancel left, action right; the action uses btn_red when destructive).
// Keyboard: Esc cancels, Enter confirms (top-most modal only, claimKey).
// It does not pause the sim.
//
// Constructible in any scene and always drawn on top of that scene: the
// dialog lives in a Container at a far-off world origin, shown through its
// own full-screen camera added last (so it covers a Sheet's list camera);
// every other camera ignores it and its camera ignores everything else.
// `new Dialog(scene, opts)` opens immediately; it destroys itself (objects,
// camera, listeners) when it closes.
import type Phaser from 'phaser'
import { Button } from './Button.ts'
import { addPanel } from './Panel.ts'
import { offscreenOrigin, claimKey, popModal, pushModal } from './Sheet.ts'
import { addText, lineCount } from './text.ts'
import { THEME } from './theme.ts'

export const DIALOG_W = 280
export const DIALOG_H = 128
export const DIALOG_PAD = 12
export const DIALOG_BTN_H = 44
export const DIALOG_BTN_GAP = 8
export const DIALOG_BACKDROP_ALPHA = 0.5

export interface DialogOptions {
  title: string
  text: string
  /** Action button label (right), e.g. 'Sell'. */
  action: string
  /** Cancel button label (left); default 'Cancel'. */
  cancel?: string
  /** Use btn_red for the action button. */
  destructive?: boolean
  onConfirm: () => void
  onCancel?: () => void
  /** Canvas size; default scene.scale.width/height. */
  W?: number
  H?: number
  /** Min hit size per axis (L.minHit); default ceil(44 / zoom). */
  minHit?: number
  id?: string
}

/** The panel rect for a W x H canvas (pure; 12-px side margins below 304). */
export function dialogRect(
  W: number,
  H: number,
): { x: number; y: number; w: number; h: number } {
  const w = Math.min(DIALOG_W, W - 2 * DIALOG_PAD)
  return {
    x: Math.round((W - w) / 2),
    y: Math.round((H - DIALOG_H) / 2),
    w,
    h: DIALOG_H,
  }
}

export class Dialog {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  readonly cam: Phaser.Cameras.Scene2D.Camera
  readonly confirmButton: Button
  readonly cancelButton: Button

  private opts: DialogOptions
  private backdrop: Phaser.GameObjects.Rectangle
  private panel: Phaser.GameObjects.NineSlice
  private title: Phaser.GameObjects.BitmapText
  private line: Phaser.GameObjects.BitmapText
  private open = true

  constructor(scene: Phaser.Scene, opts: DialogOptions) {
    this.scene = scene
    this.opts = opts
    const W = Math.round(opts.W ?? scene.scale.width)
    const H = Math.round(opts.H ?? scene.scale.height)
    const o = offscreenOrigin()

    this.backdrop = scene.add
      .rectangle(0, 0, W, H, THEME.shadow, DIALOG_BACKDROP_ALPHA)
      .setOrigin(0, 0)
      .setInteractive()
    this.panel = addPanel(scene, 0, 0, DIALOG_W, DIALOG_H, 'ui_panel')
    this.panel.setInteractive()
    this.title = addText(scene, 0, 0, opts.title, { tint: THEME.textDark })
    this.line = addText(scene, 0, 0, opts.text, { tint: THEME.textDark })
    this.cancelButton = new Button(scene, {
      x: 0,
      y: 0,
      w: 100,
      h: DIALOG_BTN_H,
      label: opts.cancel ?? 'Cancel',
      minHit: opts.minHit,
      id: `${opts.id ?? 'dialog'}:cancel`,
      onClick: () => this.cancel(),
    })
    this.confirmButton = new Button(scene, {
      x: 0,
      y: 0,
      w: 100,
      h: DIALOG_BTN_H,
      label: opts.action,
      face: opts.destructive ? 'red' : 'primary',
      minHit: opts.minHit,
      id: `${opts.id ?? 'dialog'}:confirm`,
      onClick: () => this.confirm(),
    })
    this.root = scene.add.container(o.x, o.y, [
      this.backdrop,
      this.panel,
      this.title,
      this.line,
      this.cancelButton,
      this.confirmButton,
    ])
    this.root.setDepth(100000)

    for (const c of scene.cameras.cameras) c.ignore(this.root)
    this.cam = scene.cameras.add(0, 0, W, H)
    this.cam.setScroll(o.x, o.y)
    for (const obj of scene.children.list)
      if (obj !== this.root) this.cam.ignore(obj)

    this.layout(W, H)
    pushModal(this)
    scene.input.keyboard?.on('keydown', this.onKey, this)
    scene.events.once('shutdown', this.destroy, this)
  }

  isOpen(): boolean {
    return this.open
  }

  /** Run onConfirm and close. */
  confirm(): void {
    if (!this.open) return
    this.destroy()
    this.opts.onConfirm()
  }

  /** Run onCancel and close. */
  cancel(): void {
    if (!this.open) return
    this.destroy()
    this.opts.onCancel?.()
  }

  /** Re-fit to a new canvas size (pass L from computeLayout, or {W, H}). */
  relayout(L: { W: number; H: number }): void {
    if (!this.open) return
    this.cam.setSize(Math.round(L.W), Math.round(L.H))
    this.layout(Math.round(L.W), Math.round(L.H))
  }

  /** Close without running either callback. */
  destroy(): void {
    if (!this.open) return
    this.open = false
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
    this.scene.events.off('shutdown', this.destroy, this)
    this.root.destroy()
    this.scene.cameras.remove(this.cam, true)
  }

  private layout(W: number, H: number): void {
    const r = dialogRect(W, H)
    this.backdrop.setSize(W, H)
    if (this.backdrop.input?.hitArea)
      (this.backdrop.input.hitArea as Phaser.Geom.Rectangle).setSize(W, H)
    this.panel.setPosition(r.x, r.y).setSize(r.w, r.h)
    if (this.panel.input?.hitArea)
      (this.panel.input.hitArea as Phaser.Geom.Rectangle).setSize(r.w, r.h)
    const inner = r.w - 2 * DIALOG_PAD
    this.title.setPosition(r.x + DIALOG_PAD, r.y + 6)
    this.line.setMaxWidth(inner)
    // One line sits under the title; a wrapped second line still clears the
    // buttons (2 x 14 px pitch).
    this.line.setPosition(
      r.x + DIALOG_PAD,
      r.y + (lineCount(this.line) > 1 ? 26 : 32),
    )
    const bw = Math.floor((inner - DIALOG_BTN_GAP) / 2)
    const by = r.y + r.h - DIALOG_PAD - DIALOG_BTN_H
    this.cancelButton.setRect({
      x: r.x + DIALOG_PAD,
      y: by,
      w: bw,
      h: DIALOG_BTN_H,
    })
    this.confirmButton.setRect({
      x: r.x + r.w - DIALOG_PAD - bw,
      y: by,
      w: bw,
      h: DIALOG_BTN_H,
    })
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      if (claimKey(ev, this)) this.cancel()
    } else if (ev.key === 'Enter') {
      if (claimKey(ev, this)) this.confirm()
    }
  }
}
