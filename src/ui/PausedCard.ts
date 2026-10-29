// "Paused — tap to resume" card (spec §2, city-view.md §4.3, plan.md §9
// "Auto-pause"): shown on Phaser VISIBLE after the HUD auto-paused the sim on
// HIDDEN / pagehide. A full-screen dim layer swallows every tap; the tap's
// pointerdown is the audio-resume gesture (director.resumeAfterPause() must
// run inside it on iOS) and its pointerup resumes the game. HudScene owns the
// instance and the stepper; this class only draws and reports. Phaser is a
// type-only import.
import type Phaser from 'phaser'
import type { Layout } from './layout.ts'
import { addPanel } from './Panel.ts'
import { addText, textTop } from './text.ts'
import { THEME } from './theme.ts'

export const PAUSED_TEXT = 'Paused — tap to resume'
export const PAUSED_DEPTH = 20000
export const PAUSED_DIM_ALPHA = 0.35
const CARD_H = 44
const CARD_PAD = 16

export interface PausedCardOptions {
  /** Inside the tap's pointerdown (audio resume gesture). */
  onGesture?: () => void
  /** The tap completed: resume the sim and close. */
  onResume: () => void
}

export class PausedCard {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  private dim: Phaser.GameObjects.Rectangle
  private catcher: Phaser.GameObjects.Zone
  private panel: Phaser.GameObjects.NineSlice
  private text: Phaser.GameObjects.BitmapText
  private opts: PausedCardOptions
  private down = false

  constructor(scene: Phaser.Scene, L: Layout, opts: PausedCardOptions) {
    this.scene = scene
    this.opts = opts
    this.dim = scene.add
      .rectangle(0, 0, L.W, L.H, THEME.shadow, PAUSED_DIM_ALPHA)
      .setOrigin(0, 0)
    this.catcher = scene.add.zone(0, 0, L.W, L.H).setOrigin(0, 0)
    this.catcher.setInteractive()
    this.catcher.on('pointerdown', () => {
      this.down = true
      this.opts.onGesture?.()
    })
    this.catcher.on('pointerup', () => {
      if (!this.down) return
      this.down = false
      scene.game.events.emit('ui:tap', { id: 'paused:resume' })
      this.opts.onResume()
    })
    this.panel = addPanel(scene, 0, 0, 200, CARD_H, 'ui_panel')
    this.text = addText(scene, 0, 0, PAUSED_TEXT, { tint: THEME.textDark })
    this.root = scene.add
      .container(0, 0, [this.dim, this.catcher, this.panel, this.text])
      .setDepth(PAUSED_DEPTH)
      .setVisible(false)
    this.relayout(L)
  }

  isOpen(): boolean {
    return this.root.visible
  }

  show(): void {
    this.down = false
    this.root.setVisible(true)
  }

  hide(): void {
    this.down = false
    this.root.setVisible(false)
  }

  relayout(L: Layout): void {
    this.dim.setSize(L.W, L.H)
    this.catcher.setSize(L.W, L.H)
    const area = this.catcher.input?.hitArea as
      | Phaser.Geom.Rectangle
      | undefined
    area?.setTo(0, 0, L.W, L.H)
    const w = Math.min(L.W - 24, Math.round(this.text.width) + 2 * CARD_PAD)
    const x = Math.round((L.W - w) / 2)
    const y = Math.round((L.H - CARD_H) / 2)
    this.panel.setPosition(x, y).setSize(w, CARD_H)
    this.text.setPosition(
      Math.round(x + (w - this.text.width) / 2),
      textTop(y, CARD_H),
    )
  }

  destroy(): void {
    this.root.destroy()
  }
}
