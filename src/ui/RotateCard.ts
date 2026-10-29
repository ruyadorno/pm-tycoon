// The rotate card (decision #4, plan.md §6.5, city-view.md §9.5): a phone in
// landscape gets a full-screen `ui_panel_dark` card asking for portrait; it
// swallows every tap and HudScene pauses the sim (stepper.paused) while it is
// up, resuming when the phone is upright again. TitleScene uses the same card
// in place of its buttons. Phaser is a type-only import.
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

export class RotateCard {
  readonly root: Phaser.GameObjects.Container
  private bg: Phaser.GameObjects.NineSlice
  private icon: Phaser.GameObjects.Image
  private text: Phaser.GameObjects.BitmapText

  constructor(scene: Phaser.Scene, W: number, H: number) {
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
  }

  isOpen(): boolean {
    return this.root.visible
  }

  setOpen(on: boolean): void {
    this.root.setVisible(on)
  }

  relayout(W: number, H: number): void {
    this.bg.setSize(W, H)
    if (this.bg.input?.hitArea)
      (this.bg.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, W, H)
    this.text.setMaxWidth(Math.max(80, W - 48))
    const n = lineCount(this.text)
    const blockH = 16 + 8 + n * LINE_H
    const y0 = Math.round((H - blockH) / 2)
    this.icon.setPosition(Math.round(W / 2 - 8), y0)
    this.text.setPosition(Math.round((W - this.text.width) / 2), y0 + 24 - 4)
  }

  destroy(): void {
    this.root.destroy()
  }
}
