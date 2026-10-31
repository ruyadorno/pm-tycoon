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
//
// Build 3 M12 (B3 §3.4): with `onEffects`, a second entry `Effects · N`
// under the summary button (or under the text panel without one) opens the
// EffectsCard; the HUD sets N before show() (setEffectsCount) and the entry
// hides at 0. Its tap is a gesture like the summary entry's.
import type Phaser from 'phaser'
import { Button } from './Button.ts'
import type { Layout } from './layout.ts'
import { addPanel } from './Panel.ts'
import { claimKey, popModal, pushModal } from './Sheet.ts'
import { addText, textTop } from './text.ts'
import { THEME } from './theme.ts'

export const PAUSED_TEXT = 'Paused — tap to resume'
export const SUMMARY_ENTRY_TEXT = 'End run — show summary'
/** The Effects entry's label before a count is set. */
export const EFFECTS_ENTRY_TEXT = 'Effects'
export const PAUSED_DEPTH = 20000
export const PAUSED_DIM_ALPHA = 0.35
const CARD_H = 44
const CARD_PAD = 16
/** Gap between the text panel and the summary button. */
const ENTRY_GAP = 16
const ENTRY_W = 220
const ENTRY_H = 44
/** Gap between the summary entry and the Effects entry. */
const EFFECTS_ENTRY_GAP = 8

/** `Effects · 2` (the pause menu's EffectsCard entry). */
export function effectsEntryText(n: number): string {
  return `${EFFECTS_ENTRY_TEXT} · ${n}`
}

export interface PausedCardOptions {
  /** Inside the tap's pointerdown (audio resume gesture). */
  onGesture?: () => void
  /** The tap completed: resume the sim and close. */
  onResume: () => void
  /** `End run — show summary` (the button shows only when set). */
  onSummary?: () => void
  /**
   * Build 3 M12 (B3 §3.4): `Effects · N` — the EffectsCard (the entry shows
   * only while setEffectsCount(n > 0)).
   */
  onEffects?: () => void
}

export class PausedCard {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  private dim: Phaser.GameObjects.Rectangle
  private catcher: Phaser.GameObjects.Zone
  private panel: Phaser.GameObjects.NineSlice
  private text: Phaser.GameObjects.BitmapText
  private entry: Button | null = null
  private effects: Button | null = null
  private effectsN = 0
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
    const onEffects = opts.onEffects
    if (onEffects) {
      this.effects = new Button(scene, {
        x: 0,
        y: 0,
        w: ENTRY_W,
        h: ENTRY_H,
        label: EFFECTS_ENTRY_TEXT,
        minHit: L.minHit,
        id: 'paused:effects',
        onClick: () => {
          this.down = false
          this.opts.onGesture?.()
          onEffects()
        },
      }).setVisible(false)
    }
    this.root = scene.add
      .container(0, 0, [
        this.dim,
        this.catcher,
        this.panel,
        this.text,
        ...(this.entry ? [this.entry] : []),
        ...(this.effects ? [this.effects] : []),
      ])
      .setDepth(PAUSED_DEPTH)
      .setVisible(false)
    this.relayout(L)
    scene.events.on('sleep', this.onSleep, this)
    scene.events.on('wake', this.onWake, this)
    scene.events.once('shutdown', this.detach, this)
  }

  /**
   * Build 3 M12: the Effects entry's count (`Effects · 2`; hidden at 0). The
   * HUD calls it before show() with the live modifier count.
   */
  setEffectsCount(n: number): void {
    const c = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))
    this.effectsN = c
    const b = this.effects
    if (!b) return
    if (c > 0) b.setLabel(effectsEntryText(c))
    b.setVisible(c > 0)
  }

  /** The Effects entry's count (0: hidden). */
  get effectsCount(): number {
    return this.effects ? this.effectsN : 0
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
    const ew = Math.min(ENTRY_W, L.W - 24)
    const ex = Math.round((L.W - ew) / 2)
    const summaryY = y + CARD_H + ENTRY_GAP
    if (this.entry) {
      this.entry.setRect(
        { x: ex, y: summaryY, w: ew, h: ENTRY_H },
        undefined,
        L.minHit,
      )
    }
    if (this.effects) {
      // Under the summary entry (or the text panel), never past the safe area.
      const below = this.entry
        ? summaryY + ENTRY_H + EFFECTS_ENTRY_GAP
        : summaryY
      this.effects.setRect(
        {
          x: ex,
          y: Math.min(below, L.H - L.safeBottom - ENTRY_H),
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

  /** The Effects entry's rect while it shows (count > 0), else null. */
  effectsRect(): { x: number; y: number; w: number; h: number } | null {
    const b = this.effects
    if (!b || this.effectsN === 0) return null
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
