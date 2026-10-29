// The rotate card (decision #4, plan.md §6.5, city-view.md §9.5): a phone in
// landscape gets a full-screen `ui_panel_dark` card asking for portrait; it
// swallows every tap and HudScene pauses the sim (stepper.paused) while it is
// up, resuming when the phone is upright again. TitleScene uses the same card
// in place of its buttons. Phaser is a type-only import.
//
// The card covers everything while it is up. A card's depth alone did not:
// the lost-life, game-over and summary cards and every Dialog draw through
// their own cameras added after the HUD's, and the Garage is a scene above
// the HUD, so in landscape they drew over the rotate card (squeezed into the
// 430-px landscape column, still tappable). While open the card therefore
// draws through its own camera, kept last in its scene's camera list (it
// ignores every other object, including ones added later), and its scene is
// lifted above the scenes over it; closing puts those scenes back on top in
// their old order and clears the camera's ignore bits.
import type Phaser from 'phaser'
import { UI_ATLAS } from '../render/atlases.ts'
import { addPanel } from './Panel.ts'
import { addText, lineCount, LINE_H } from './text.ts'
import { THEME } from './theme.ts'

export const ROTATE_TEXT = 'Turn your phone upright to keep delivering'
export const ROTATE_DEPTH = 30000

/**
 * True for a landscape canvas on a phone/tablet (desktop windows are never
 * asked to rotate: their #game column is portrait by construction).
 */
export function wantsRotateCard(
  W: number,
  H: number,
  desktop: boolean,
): boolean {
  return !desktop && W > H
}

type Camera = Phaser.Cameras.Scene2D.Camera
type Filtered = { cameraFilter: number }

/** Move `cam` to the end of `list` (drawn last, hit-tested first). */
export function keepCameraLast<T>(list: T[], cam: T): boolean {
  const i = list.indexOf(cam)
  if (i < 0 || i === list.length - 1) return false
  list.splice(i, 1)
  list.push(cam)
  return true
}

export class RotateCard {
  readonly root: Phaser.GameObjects.Container
  private scene: Phaser.Scene
  private bg: Phaser.GameObjects.NineSlice
  private icon: Phaser.GameObjects.Image
  private text: Phaser.GameObjects.BitmapText
  private W: number
  private H: number
  private cam: Camera | null = null
  /** Objects the card's camera ignores (their filter bit is cleared on close). */
  private ignored = new Set<Filtered>()
  /** Keys of the scenes that were above this one when the card opened. */
  private above: string[] = []
  private destroyed = false

  constructor(scene: Phaser.Scene, W: number, H: number) {
    this.scene = scene
    this.W = W
    this.H = H
    this.bg = addPanel(scene, 0, 0, W, H, 'ui_panel_dark')
    // Swallow every tap while the card is up.
    this.bg.setInteractive()
    this.icon = scene.add.image(0, 0, UI_ATLAS, 'ic_city').setOrigin(0, 0)
    this.text = addText(scene, 0, 0, ROTATE_TEXT, {
      tint: THEME.textLight,
      align: 'center',
    })
    this.root = scene.add
      .container(0, 0, [this.bg, this.icon, this.text])
      .setDepth(ROTATE_DEPTH)
      .setVisible(false)
    this.relayout(W, H)
    scene.events.once('shutdown', this.destroy, this)
  }

  isOpen(): boolean {
    return this.root.visible
  }

  setOpen(on: boolean): void {
    if (on === this.isOpen()) return
    this.root.setVisible(on)
    if (on) this.raise()
    else this.lower()
  }

  relayout(W: number, H: number): void {
    this.W = W
    this.H = H
    this.bg.setSize(W, H)
    if (this.bg.input?.hitArea)
      (this.bg.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, W, H)
    this.cam?.setSize(W, H)
    this.text.setMaxWidth(Math.max(80, W - 48))
    const n = lineCount(this.text)
    const blockH = 16 + 8 + n * LINE_H
    const y0 = Math.round((H - blockH) / 2)
    this.icon.setPosition(Math.round(W / 2 - 8), y0)
    this.text.setPosition(Math.round((W - this.text.width) / 2), y0 + 24 - 4)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.lower()
    this.scene.events.off('shutdown', this.destroy, this)
    this.root.destroy()
  }

  // ---- covering everything while open ------------------------------------

  private raise(): void {
    const s = this.scene
    if (this.cam || !s.cameras) return
    for (const c of s.cameras.cameras) c.ignore(this.root)
    const cam = s.cameras.add(0, 0, this.W, this.H)
    this.cam = cam
    for (const obj of s.children.list) this.ignore(obj)
    s.events.on('addedtoscene', this.ignore, this)
    s.events.on('prerender', this.keepLast, this)
    // Scenes drawn over this one (the Garage over the HUD): lift this one.
    const sp = s.scene
    const all = (sp.manager?.scenes ?? []) as Phaser.Scene[]
    const i = all.indexOf(s)
    this.above =
      i < 0
        ? []
        : all
            .slice(i + 1)
            .filter((o) => o.sys.isActive() || o.sys.isVisible())
            .map((o) => o.sys.settings.key)
    if (this.above.length > 0) sp.bringToTop()
  }

  private lower(): void {
    const s = this.scene
    const cam = this.cam
    if (!cam) return
    this.cam = null
    s.events.off('addedtoscene', this.ignore, this)
    s.events.off('prerender', this.keepLast, this)
    for (const o of this.ignored) o.cameraFilter &= ~cam.id
    this.ignored.clear()
    s.cameras?.remove(cam, true)
    const sp = s.scene
    for (const key of this.above) {
      const o = sp.get(key)
      if (o && (o.sys.isActive() || o.sys.isVisible())) sp.bringToTop(key)
    }
    this.above = []
  }

  private ignore(obj: Phaser.GameObjects.GameObject): void {
    if (!this.cam || obj === this.root) return
    this.cam.ignore(obj)
    this.ignored.add(obj as unknown as Filtered)
  }

  /** Cards and dialogs add their cameras later: stay the last one. */
  private keepLast(): void {
    if (this.cam) keepCameraLast(this.scene.cameras.cameras, this.cam)
  }
}
