// Onboarding tooltips (city-view.md §9.1, plan.md §9 "Onboarding"): a 240-px
// `ui_panel` with the step text, a grey `Skip tour` link (44-px hit) and the
// 16x16 `arrow` frame (an 8x8 down-pointing glyph, artUi hand-off) touching
// its target. The state object is `pm.save.v1.onboarding` = {step, skipped,
// sawFirstFlag, sawTossHint, wanted}: HudScene keeps it in the game registry
// (REG_ONBOARDING, src/boot/autosave.ts), this class mutates it in place and
// autosave.ts writes it; the sim never sees it, so a reload never repeats a
// step. `step` = the highest step completed (0 = none).
//
// M1 ships steps 1 (Garage, at a new game with no vehicle; clears on
// vehicle:bought, no timeout) and 3 (rush, on the first parcel:pickedUp once
// another building has waiting parcels; clears on building:rushed or 20 s).
// HudScene shows step 3 only once such a building is on screen with room for
// the card above it, and hides any card while a sheet, popover or dialog is
// up (setSuppressed); an arrow that would land inside the card is dropped.
// Step 2 (the warehouse hint) lands in M2 by adding it to ONBOARDING_STEPS
// and STEP_TEXT; `stepEligible` already orders steps by that list.
//
// The class is plain (constructed by HudScene with the layout; HudScene
// forwards the sim events, city-view §11.2). Phaser is a type-only import so
// the model functions are unit-testable under Node.
import type Phaser from 'phaser'
import type { OnboardingSave } from '../sim/save.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import type { Layout, Rect } from './layout.ts'
import { addPanel } from './Panel.ts'
import { addText, lineCount, LINE_H } from './text.ts'
import { THEME } from './theme.ts'

/** Steps implemented in this build, in tour order. */
export const ONBOARDING_STEPS: readonly number[] = [1, 3]

export const STEP_TEXT: Readonly<Record<number, string>> = {
  1: 'Buy a bike in the Garage to start delivering',
  3: 'Tap a building with waiting parcels to rush a vehicle there',
}

/** Auto-clear after this many ms of scene time (null = until its action). */
export const STEP_TIMEOUT_MS: Readonly<Record<number, number | null>> = {
  1: null,
  3: 20_000,
}

export const ONBOARDING_W = 240
export const ONBOARDING_PAD = 6
export const ONBOARDING_DEPTH = 8500
/** The `Skip tour` row under the text. */
export const SKIP_ROW_H = 16
const ARROW = 16
/** The glyph's bottom row inside the 16x16 arrow frame (8x8 centred). */
const ARROW_TIP = 12
const BOB_MS = 300

// ---- model (pure) -----------------------------------------------------------

export function freshOnboarding(): OnboardingSave {
  return {
    step: 0,
    skipped: false,
    sawFirstFlag: false,
    sawTossHint: false,
    wanted: [],
  }
}

/** Coerce a stored value (any shape) into a valid OnboardingSave. */
export function normaliseOnboarding(x: unknown): OnboardingSave {
  const o = freshOnboarding()
  if (typeof x !== 'object' || x === null) return o
  const r = x as Record<string, unknown>
  if (typeof r.step === 'number' && Number.isFinite(r.step))
    o.step = Math.max(0, Math.min(3, Math.trunc(r.step)))
  o.skipped = r.skipped === true
  o.sawFirstFlag = r.sawFirstFlag === true
  o.sawTossHint = r.sawTossHint === true
  if (Array.isArray(r.wanted))
    o.wanted = r.wanted.filter((w): w is string => typeof w === 'string')
  return o
}

/**
 * True when `step` may show now: the tour is not skipped, the step is not
 * done, and every implemented step before it is done.
 */
export function stepEligible(
  s: OnboardingSave,
  step: number,
  steps: readonly number[] = ONBOARDING_STEPS,
): boolean {
  if (s.skipped || !steps.includes(step) || s.step >= step) return false
  return steps.filter((k) => k < step).every((k) => s.step >= k)
}

/** Mark `step` done (in place; the registry object is shared). */
export function completeStep(s: OnboardingSave, step: number): OnboardingSave {
  s.step = Math.max(s.step, step)
  return s
}

/** `Skip tour`: clears every step (in place). */
export function skipTour(s: OnboardingSave): OnboardingSave {
  s.skipped = true
  return s
}

// ---- view ---------------------------------------------------------------------

/** Where the arrow tip should touch, in HUD screen px (null = hide arrow). */
export type AnchorFn = () => { x: number; y: number } | null

export interface OnboardingOptions {
  /** Called after any state change (HudScene may save). */
  onChange?: (s: OnboardingSave) => void
}

export class Onboarding {
  readonly scene: Phaser.Scene
  readonly state: OnboardingSave
  private L: Layout
  private opts: OnboardingOptions
  private root: Phaser.GameObjects.Container
  private panel: Phaser.GameObjects.NineSlice
  private text: Phaser.GameObjects.BitmapText
  private skip: Phaser.GameObjects.BitmapText
  private skipZone: Phaser.GameObjects.Zone
  private arrow: Phaser.GameObjects.Image
  private active: number | null = null
  private anchor: AnchorFn | null = null
  private shownAt = 0
  private skipDown = false
  private suppressed = false

  constructor(
    scene: Phaser.Scene,
    L: Layout,
    state: OnboardingSave,
    opts: OnboardingOptions = {},
  ) {
    this.scene = scene
    this.L = L
    this.state = state
    this.opts = opts
    this.panel = addPanel(scene, 0, 0, ONBOARDING_W, 40, 'ui_panel')
    // Swallow taps on the card so they never rush the building under it.
    this.panel.setInteractive()
    this.text = addText(scene, ONBOARDING_PAD, ONBOARDING_PAD, '', {
      tint: THEME.textDark,
      maxWidth: ONBOARDING_W - 2 * ONBOARDING_PAD,
    })
    this.skip = addText(scene, 0, 0, 'Skip tour', { tint: THEME.textMuted })
    this.skipZone = scene.add.zone(0, 0, 10, 10).setOrigin(0, 0)
    this.skipZone.setInteractive()
    this.skipZone.on('pointerdown', () => {
      this.skipDown = true
    })
    this.skipZone.on('pointerout', () => {
      this.skipDown = false
    })
    this.skipZone.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.skipDown || p.getDistance() > 8) return
      this.skipDown = false
      scene.game.events.emit('ui:tap', { id: 'onboarding:skip' })
      this.skipTour()
    })
    this.arrow = scene.add.image(0, 0, UI_ATLAS, 'arrow').setOrigin(0, 0)
    this.root = scene.add
      .container(0, 0, [
        this.panel,
        this.text,
        this.skip,
        this.skipZone,
        this.arrow,
      ])
      .setDepth(ONBOARDING_DEPTH)
      .setVisible(false)
  }

  /** The step on screen, or null. */
  get activeStep(): number | null {
    return this.active
  }

  eligible(step: number): boolean {
    return stepEligible(this.state, step)
  }

  /** Show `step` (if eligible) with its arrow at `anchor()` (re-read every update). */
  show(step: number, anchor: AnchorFn): boolean {
    if (!this.eligible(step) || this.active !== null) return false
    this.active = step
    this.anchor = anchor
    this.shownAt = this.scene.time.now
    this.text.setText(STEP_TEXT[step] ?? '')
    this.fit()
    this.root.setVisible(!this.suppressed)
    this.place()
    return true
  }

  /**
   * Hide the card (it keeps its step and timer) while a sheet, popover or
   * dialog is up: at depth 8500 it would otherwise draw over the district
   * panel and point at buildings under it.
   */
  setSuppressed(on: boolean): void {
    if (this.suppressed === on) return
    this.suppressed = on
    this.root.setVisible(this.active !== null && !on)
  }

  /** The step's action happened (or it timed out): mark it done and hide. */
  complete(step: number): void {
    if (this.state.step >= step && this.active !== step) return
    completeStep(this.state, step)
    if (this.active === step) this.hide()
    this.opts.onChange?.(this.state)
  }

  skipTour(): void {
    skipTour(this.state)
    this.hide()
    this.opts.onChange?.(this.state)
  }

  /**
   * True when `step`'s card fits between the toast lane and an arrow tip at
   * screen y `tipY` (the card sits above its arrow). Measures the step's
   * text when no step is on screen.
   */
  fitsAbove(tipY: number, step: number): boolean {
    if (this.active === null) {
      this.text.setText(STEP_TEXT[step] ?? '')
      this.fit()
    }
    return this.panelTop(tipY) >= this.minY()
  }

  /** Timeouts and the arrow follow (call from scene.update). */
  update(now: number): void {
    if (this.active === null) return
    const limit = STEP_TIMEOUT_MS[this.active] ?? null
    if (limit !== null && now - this.shownAt >= limit) {
      this.complete(this.active)
      return
    }
    this.place()
  }

  relayout(L: Layout): void {
    this.L = L
    if (this.active !== null) {
      this.fit()
      this.place()
    }
  }

  destroy(): void {
    this.root.destroy()
  }

  private hide(): void {
    this.active = null
    this.anchor = null
    this.root.setVisible(false)
  }

  private panelW(): number {
    return Math.min(ONBOARDING_W, this.L.W - 12)
  }

  private fit(): void {
    const w = this.panelW()
    this.text.setMaxWidth(w - 2 * ONBOARDING_PAD)
    const n = lineCount(this.text)
    const h = ONBOARDING_PAD + n * LINE_H + SKIP_ROW_H + ONBOARDING_PAD
    this.panel.setSize(w, h)
    if (this.panel.input?.hitArea)
      (this.panel.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, w, h)
    this.text.setPosition(ONBOARDING_PAD, ONBOARDING_PAD - 3)
    this.skip.setPosition(
      Math.round(w - ONBOARDING_PAD - this.skip.width),
      ONBOARDING_PAD + n * LINE_H - 2,
    )
  }

  private minY(): number {
    return this.L.toast.y + this.L.toast.h + 2
  }

  /** The card's top when it sits above an arrow tip at `tipY`. */
  private panelTop(tipY: number): number {
    return Math.round(tipY) - ARROW_TIP - Math.round(this.panel.height) + 3
  }

  /** Panel above the arrow tip, clamped inside the screen. */
  private place(): void {
    let tip = this.anchor?.() ?? null
    const L = this.L
    const w = Math.round(this.panel.width)
    const h = Math.round(this.panel.height)
    const minY = this.minY()
    const maxY = L.chips.y + L.chips.h - h
    // No room above the target (it is right under the top bar): clamping the
    // card down would draw the arrow inside its text, so drop the arrow.
    if (tip && this.panelTop(tip.y) < minY) tip = null
    let px: number
    let py: number
    if (tip) {
      const tx = Math.round(Math.min(L.W - 8, Math.max(8, tip.x)))
      const ty = Math.round(tip.y)
      const bob = Math.floor(this.scene.time.now / BOB_MS) % 2
      this.arrow
        .setVisible(true)
        .setPosition(tx - ARROW / 2, ty - ARROW_TIP - bob)
      px = Math.min(L.W - 6 - w, Math.max(6, tx - Math.round(w / 2)))
      py = ty - ARROW_TIP - h + 3
    } else {
      this.arrow.setVisible(false)
      px = Math.round((L.W - w) / 2)
      py = minY
    }
    py = Math.min(maxY, Math.max(minY, py))
    this.panel.setPosition(px, py)
    this.text.setPosition(px + ONBOARDING_PAD, py + ONBOARDING_PAD - 3)
    const n = lineCount(this.text)
    const sx = Math.round(px + w - ONBOARDING_PAD - this.skip.width)
    const sy = py + ONBOARDING_PAD + n * LINE_H - 2
    this.skip.setPosition(sx, sy)
    // 44-px hit (L.minHit) around the link, kept inside the panel's column.
    const hitW = Math.max(L.minHit, Math.round(this.skip.width) + 12)
    const hitH = L.minHit
    const zr: Rect = {
      x: Math.min(px + w - hitW, sx - 6),
      y: Math.round(sy + 7 - hitH / 2),
      w: hitW,
      h: hitH,
    }
    this.skipZone.setPosition(zr.x, zr.y)
    this.skipZone.setSize(zr.w, zr.h)
    const area = this.skipZone.input?.hitArea as
      | Phaser.Geom.Rectangle
      | undefined
    area?.setTo(0, 0, zr.w, zr.h)
  }
}
