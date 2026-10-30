// "Paused — tap to resume" card (spec §2, city-view.md §4.3, plan.md §9
// "Auto-pause"): shown on Phaser VISIBLE after the HUD auto-paused the sim on
// HIDDEN / pagehide. A full-screen dim layer swallows every tap; the tap's
// pointerdown is the audio-resume gesture (director.resumeAfterPause() must
// run inside it on iOS) and its pointerup resumes the game. HudScene owns the
// instance and the stepper; this class only draws and reports.
//
// M4 (plan.md §12.7 task 2): the card is also the pause menu (the HUD opens
// it when the player taps ❚❚ while already paused) and, with `onSummary`,
// carries an `End run — show summary` button under the text panel — off the
// screen centre, which stays a resume tap. Its tap is a gesture too
// (onGesture runs first: the audio resume must happen inside it on iOS).
//
// Build 2 (report-playtest1 §6.5, plan-build2 §8.2 task 10): the card is on
// the shared modal stack (src/ui/Sheet.ts) while it shows, so the keys that
// only act with no modal open (W view switch, G Garage, the Warehouse's
// Esc-to-City) wait under it, and Esc resumes like a tap. The HUD routes
// Space and the speed keys to the card when it is the top modal (they
// resume, as their taps do). A sleeping or shut-down scene leaves the stack.
import type Phaser from 'phaser'
import { Button } from './Button.ts'
import type { Layout } from './layout.ts'
import { addPanel } from './Panel.ts'
import { claimKey, popModal, pushModal } from './Sheet.ts'
import { addText, textTop } from './text.ts'
import { THEME } from './theme.ts'

export const PAUSED_TEXT = 'Paused — tap to resume'
export const SUMMARY_ENTRY_TEXT = 'End run — show summary'
export const PAUSED_DEPTH = 20000
export const PAUSED_DIM_ALPHA = 0.35
const CARD_H = 44
const CARD_PAD = 16
/** Gap between the text panel and the summary button. */
const ENTRY_GAP = 16
const ENTRY_W = 220
const ENTRY_H = 44

export interface PausedCardOptions {
  /** Inside the tap's pointerdown (audio resume gesture). */
  onGesture?: () => void
  /** The tap completed: resume the sim and close. */
  onResume: () => void
  /** `End run — show summary` (the button shows only when set). */
  onSummary?: () => void
}

export class PausedCard {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  private dim: Phaser.GameObjects.Rectangle
  private catcher: Phaser.GameObjects.Zone
  private panel: Phaser.GameObjects.NineSlice
  private text: Phaser.GameObjects.BitmapText
  private entry: Button | null = null
  private opts: PausedCardOptions
  private down = false
  private opened = false

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
    const onSummary = opts.onSummary
    if (onSummary) {
      this.entry = new Button(scene, {
        x: 0,
        y: 0,
        w: ENTRY_W,
        h: ENTRY_H,
        label: SUMMARY_ENTRY_TEXT,
        minHit: L.minHit,
        id: 'paused:summary',
        onClick: () => {
          this.down = false
          this.opts.onGesture?.()
          onSummary()
        },
      })
    }
    this.root = scene.add
      .container(0, 0, [
        this.dim,
        this.catcher,
        this.panel,
        this.text,
        ...(this.entry ? [this.entry] : []),
      ])
      .setDepth(PAUSED_DEPTH)
      .setVisible(false)
    this.relayout(L)
    scene.events.on('sleep', this.onSleep, this)
    scene.events.on('wake', this.onWake, this)
    scene.events.once('shutdown', this.detach, this)
  }

  isOpen(): boolean {
    return this.opened
  }

  show(): void {
    this.down = false
    if (!this.opened) {
      this.opened = true
      pushModal(this)
      this.scene.input.keyboard?.on('keydown', this.onKey, this)
    }
    this.root.setVisible(true)
  }

  hide(): void {
    this.down = false
    if (this.opened) {
      this.opened = false
      popModal(this)
      this.scene.input?.keyboard?.off('keydown', this.onKey, this)
    }
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
    if (this.entry) {
      const ew = Math.min(ENTRY_W, L.W - 24)
      this.entry.setRect(
        {
          x: Math.round((L.W - ew) / 2),
          y: y + CARD_H + ENTRY_GAP,
          w: ew,
          h: ENTRY_H,
        },
        undefined,
        L.minHit,
      )
    }
  }

  /** The summary button's rect (tests, e2e taps), or null without one. */
  entryRect(): { x: number; y: number; w: number; h: number } | null {
    const b = this.entry
    if (!b) return null
    return { x: b.x, y: b.y, w: b.btnWidth, h: b.btnHeight }
  }

  destroy(): void {
    this.detach()
    this.root.destroy()
  }

  /** Esc resumes (the top-most modal only); every other key passes. */
  private onKey(ev: KeyboardEvent): void {
    if (!this.opened || ev.repeat || ev.key !== 'Escape') return
    if (!claimKey(ev, this)) return
    this.down = false
    this.opts.onGesture?.()
    this.scene.game.events.emit('ui:tap', { id: 'paused:resume' })
    this.opts.onResume()
  }

  private onSleep(): void {
    popModal(this)
  }

  private onWake(): void {
    if (this.opened) pushModal(this)
  }

  /** Off the modal stack and the scene's emitters (shutdown / destroy). */
  private detach(): void {
    popModal(this)
    this.opened = false
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
    this.scene.events.off('sleep', this.onSleep, this)
    this.scene.events.off('wake', this.onWake, this)
    this.scene.events.off('shutdown', this.detach, this)
  }
}
