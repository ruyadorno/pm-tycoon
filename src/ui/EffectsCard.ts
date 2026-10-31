// Build 3 M12 (B3 §3.4, D-M12-15): the EffectsCard — every live modifier,
// newest first (ViewSim.events().modifiers is already newest first: M12
// critique 1), up to 8 rows (`+N more`), each with its icon, the sim's line
// and `<time left> · <card title>` (the event that set it). A bottom card on
// the HUD camera like the EventCard (D-M12-1), on the modal stack, and it does
// NOT hold the sim. Opened from the event chip or the pause menu's
// `Effects · N` entry; Close, Esc, Enter and a tap outside (a Zone scrim:
// no draw call, D-M12-20) close it and call onClose.
//
// Geometry (card-local px; 300 wide, at most W − 12; eventCardRect places it
// 8 px above the bottom bar, never above the ticker):
//   0–24   masthead: `ic_event` (12, 4) · `EFFECTS` (x 32) · `N active`
//          muted, right-aligned at w − 12
//   26/28  the double rule
//   34+32k row k: the icon at (12, y + 1) on a grey3 plate with a 1-px
//          outline (some icons are drawn light for a runtime tint —
//          `ic_shield`, `ic_speed2` — and would vanish on the light panel:
//          critique 17; the plate is the EventCard picture inset's look), the
//          line dark at x 32, the sub line muted under it, both ellipsized
//          to w − 12 − 32
//   then   `+N more` (muted, x 32) or the empty line (muted, x 12), 14 px
//   +8     Close, a full-width secondary button (44), then 8 px of padding
// 8 rows + `+N more` = 364 px; 1 row = 126 px (the room at 360×604 is 468).
//
// open() slides it up from the bottom (300 ms); refresh() (the HUD's 2-Hz
// poll and the modifier events) does nothing while the model is unchanged,
// re-sets the texts in place while the shape holds (the same rows and footer:
// time left ticks in game hours, and a Close press must survive it), and
// otherwise rebuilds the children at the new height and rect; relayout()
// rebuilds at the new canvas without a slide. Programmatic close()
// calls nothing. Phaser is a type-only import (Button carries the value
// import); world-atlas frames only.
import type Phaser from 'phaser'
import { UI_ATLAS } from '../render/atlases.ts'
import { frameOrNull } from '../render/frames.ts'
import type { ModifierView } from '../sim/view-api.ts'
import { Button, TAP_PX } from './Button.ts'
import {
  EVENT_CARD_DEPTH,
  EVENT_CARD_IN_MS,
  EVENT_CARD_PAD,
  EVENT_MAST_H,
  EVENT_RULE_Y,
  eventCardRect,
  modifierIcon,
  timeLeftText,
} from './effectText.ts'
import type { Layout, Rect } from './layout.ts'
import { addPanel } from './Panel.ts'
import { claimKey, popModal, pushModal } from './Sheet.ts'
import { addText, ellipsize, LINE_H, textTop } from './text.ts'
import { PALETTE, THEME } from './theme.ts'

export const EFFECTS_TITLE = 'EFFECTS'
export const EFFECTS_EMPTY_TEXT = 'Nothing in effect right now'
export const EFFECTS_CLOSE_TEXT = 'Close'
export const EFFECTS_MAX_ROWS = 8
export const EFFECTS_ROW_H = 32
export const EFFECTS_LIST_TOP = 34
export const EFFECTS_TEXT_X = 32
/** Card-local x of the row icons and the masthead icon. */
export const EFFECTS_ICON_X = EVENT_CARD_PAD
/** The masthead icon's top ((24 − 16) / 2). */
export const EFFECTS_MAST_ICON_Y = 4
/** The icon plate: a 1-px outline square around the 16-px icon (critique 17). */
export const EFFECTS_PLATE = 18
/** List bottom → the Close button; Close → the card's bottom edge. */
export const EFFECTS_GAP = 8
export const EFFECTS_BTN_H = 44
export const EFFECTS_BOTTOM_PAD = 8
/** The masthead icon. */
export const EFFECTS_ICON = 'ic_event'
/** Button / scrim ids (e2e tapTarget). */
export const EFFECTS_CLOSE_ID = 'effects:close'
export const EFFECTS_SCRIM_ID = 'effects:scrim'

const MUTED = PALETTE.grey1
const ICON_PX = 16

export interface EffectsRow {
  icon: string
  line: string
  sub: string
}

export interface EffectsCardModel {
  /** `2 active`. */
  count: string
  rows: EffectsRow[]
  /** `+N more` past EFFECTS_MAX_ROWS, else null. */
  more: string | null
  /** EFFECTS_EMPTY_TEXT with no modifier, else null. */
  empty: string | null
}

/** The card's rows: `mods` in the view's order (newest first), at most 8. */
export function effectsCardModel(
  mods: readonly ModifierView[],
): EffectsCardModel {
  const n = mods.length
  return {
    count: `${n} active`,
    rows: mods.slice(0, EFFECTS_MAX_ROWS).map((m) => ({
      icon: modifierIcon(m.key),
      line: m.line,
      sub: `${timeLeftText(m.ticksLeft)} · ${m.label}`,
    })),
    more: n > EFFECTS_MAX_ROWS ? `+${n - EFFECTS_MAX_ROWS} more` : null,
    empty: n === 0 ? EFFECTS_EMPTY_TEXT : null,
  }
}

/** Card-local top of row `k`. */
export function effectsRowY(k: number): number {
  return EFFECTS_LIST_TOP + k * EFFECTS_ROW_H
}

/** The list's bottom: the rows (or the 14-px empty line) plus `+N more`. */
export function effectsListBottom(m: EffectsCardModel): number {
  return (
    EFFECTS_LIST_TOP +
    (m.rows.length > 0 ? m.rows.length * EFFECTS_ROW_H : LINE_H) +
    (m.more ? LINE_H : 0)
  )
}

/** The Close button's card-local top. */
export function effectsCloseY(m: EffectsCardModel): number {
  return effectsListBottom(m) + EFFECTS_GAP
}

/** 34 + rows (32 each, or 14 for the empty line) + `+N more` 14 + 8 + Close 44 + 8. */
export function effectsCardHeight(m: EffectsCardModel): number {
  return effectsCloseY(m) + EFFECTS_BTN_H + EFFECTS_BOTTOM_PAD
}

/** The text column's width in a card `w` px wide (w − 12 − 32). */
export function effectsTextW(w: number): number {
  return w - EVENT_CARD_PAD - EFFECTS_TEXT_X
}

/** A row's two lines, each ellipsized to `maxW` (`measure`: m5x7 width). */
export function fitEffectsRow(
  row: EffectsRow,
  maxW: number,
  measure: (s: string) => number,
): { line: string; sub: string } {
  return {
    line: ellipsize(row.line, maxW, measure),
    sub: ellipsize(row.sub, maxW, measure),
  }
}

function sameModel(a: EffectsCardModel | null, b: EffectsCardModel): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b)
}

/** The same rows and footer: the card keeps its height and children. */
function sameShape(a: EffectsCardModel, b: EffectsCardModel): boolean {
  return (
    a.rows.length === b.rows.length &&
    (a.more === null) === (b.more === null) &&
    (a.empty === null) === (b.empty === null)
  )
}

/** The children refresh() re-sets in place. */
interface EffectsTexts {
  count: Phaser.GameObjects.BitmapText
  rows: {
    icon: Phaser.GameObjects.Image
    line: Phaser.GameObjects.BitmapText
    sub: Phaser.GameObjects.BitmapText
  }[]
  footer: Phaser.GameObjects.BitmapText | null
}

export interface EffectsCardOptions {
  /** Close, Esc, Enter or an outside tap: the card has closed. */
  onClose(): void
  depth?: number
}

export class EffectsCard {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  readonly scrim: Phaser.GameObjects.Zone
  private L: Layout
  private readonly opts: EffectsCardOptions
  private readonly scratch: Phaser.GameObjects.BitmapText
  private m: EffectsCardModel | null = null
  private cardRect: Rect | null = null
  private parts: Phaser.GameObjects.GameObject[] = []
  private texts: EffectsTexts | null = null
  private slide: Phaser.Tweens.Tween | null = null
  private scrimArmed = false
  private destroyed = false

  constructor(scene: Phaser.Scene, L: Layout, opts: EffectsCardOptions) {
    this.scene = scene
    this.L = L
    this.opts = opts
    const depth = opts.depth ?? EVENT_CARD_DEPTH
    // A scene child under the card: swallows the world's taps while open; a
    // tap (≤ TAP_PX of travel) that started on it closes the card.
    this.scrim = scene.add
      .zone(0, 0, L.W, L.H)
      .setOrigin(0, 0)
      .setDepth(depth - 1)
      .setInteractive()
    this.scrim.setData('id', EFFECTS_SCRIM_ID)
    this.scrim.on('pointerdown', () => {
      this.scrimArmed = true
    })
    this.scrim.on('pointerup', (p: Phaser.Input.Pointer) => {
      const armed = this.scrimArmed
      this.scrimArmed = false
      if (armed && p.getDistance() <= TAP_PX && this.isOpen) this.dismiss()
    })
    this.setScrim(false)
    // The measuring text lives outside the rebuilt children.
    this.scratch = addText(scene, 0, 0, '').setVisible(false)
    this.root = scene.add.container(0, 0).setDepth(depth).setVisible(false)
    scene.events.once('shutdown', this.destroy, this)
  }

  get isOpen(): boolean {
    return this.m !== null
  }

  get model(): EffectsCardModel | null {
    return this.m
  }

  /** The card's screen rect while open (e2e, tests), else null. */
  get rect(): Rect | null {
    return this.isOpen ? this.cardRect : null
  }

  /** Show the live modifiers (an open card just refreshes). */
  open(mods: readonly ModifierView[]): void {
    if (this.destroyed) return
    if (this.isOpen) {
      this.refresh(mods)
      return
    }
    this.m = effectsCardModel(mods)
    pushModal(this)
    this.scene.input?.keyboard?.on('keydown', this.onKey, this)
    this.setScrim(true)
    this.build()
    this.slideIn()
  }

  /** Rebuild in place while open (time left, a modifier ended). */
  refresh(mods: readonly ModifierView[]): void {
    if (this.destroyed || !this.isOpen) return
    const m = effectsCardModel(mods)
    const prev = this.m
    if (sameModel(prev, m)) return
    this.m = m
    if (prev && this.texts && sameShape(prev, m)) this.update()
    else this.build()
  }

  /** Close without a callback. */
  close(): void {
    if (!this.isOpen) return
    this.m = null
    this.stopSlide()
    this.teardown()
    this.root.setVisible(false)
    this.scrimArmed = false
    this.setScrim(false)
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
  }

  relayout(L: Layout): void {
    if (this.destroyed) return
    this.L = L
    this.scrim.setSize(L.W, L.H)
    const area = this.scrim.input?.hitArea as Phaser.Geom.Rectangle | undefined
    area?.setTo(0, 0, L.W, L.H)
    if (!this.isOpen) return
    this.stopSlide()
    this.build()
  }

  destroy(): void {
    if (this.destroyed) return
    this.close()
    this.destroyed = true
    this.scene.events.off('shutdown', this.destroy, this)
    this.scrim.destroy()
    this.scratch.destroy()
    this.root.destroy()
  }

  // ---- internals ---------------------------------------------------------------

  /** Close + onClose (Close, Esc, Enter, a tap outside). */
  private dismiss(): void {
    if (!this.isOpen) return
    this.close()
    this.opts.onClose()
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' && ev.key !== 'Enter') return
    if (!claimKey(ev, this) || ev.repeat) return
    this.dismiss()
  }

  private setScrim(on: boolean): void {
    this.scrim.setVisible(on)
    if (this.scrim.input) this.scrim.input.enabled = on
  }

  private teardown(): void {
    for (const p of this.parts) p.destroy()
    this.parts = []
    this.texts = null
  }

  private measure(s: string): number {
    return Math.round(this.scratch.setText(s).width)
  }

  /** The footer's text: `+N more`, or the empty line cut to the inner width. */
  private footerText(m: EffectsCardModel, w: number): string | null {
    if (m.more) return m.more
    if (m.empty)
      return ellipsize(m.empty, w - 2 * EVENT_CARD_PAD, (s) => this.measure(s))
    return null
  }

  /** Re-set the texts and icons of a card whose shape held (refresh). */
  private update(): void {
    const m = this.m
    const t = this.texts
    const r = this.cardRect
    if (!m || !t || !r) return
    const textW = effectsTextW(r.w)
    t.count.setText(m.count)
    t.count.setX(Math.round(r.w - EVENT_CARD_PAD - t.count.width))
    m.rows.forEach((row, k) => {
      const v = t.rows[k]
      if (!v) return
      v.icon.setFrame(frameOrNull(row.icon) ?? EFFECTS_ICON)
      const fit = fitEffectsRow(row, textW, (s) => this.measure(s))
      v.line.setText(fit.line)
      v.sub.setText(fit.sub)
    })
    t.footer?.setText(this.footerText(m, r.w) ?? '')
  }

  /** (Re)build every child for the current model at its rect. */
  private build(): void {
    const m = this.m
    if (!m) return
    this.teardown()
    const scene = this.scene
    const h = effectsCardHeight(m)
    const r = eventCardRect(this.L, h)
    this.cardRect = r
    const { w } = r
    const PAD = EVENT_CARD_PAD
    const inner = w - 2 * PAD
    const textW = effectsTextW(w)
    const measure = (s: string): number => this.measure(s)

    const panel = addPanel(scene, 0, 0, w, h, 'ui_panel').setInteractive()

    // Shapes together (one batch break): the double rule, the icon plates.
    const shapes: Phaser.GameObjects.Rectangle[] = [0, 2].map((dy) =>
      scene.add
        .rectangle(PAD, EVENT_RULE_Y + dy, inner, 1, THEME.outline)
        .setOrigin(0, 0),
    )
    m.rows.forEach((_row, k) => {
      const y = effectsRowY(k)
      shapes.push(
        scene.add
          .rectangle(
            EFFECTS_ICON_X - 1,
            y,
            EFFECTS_PLATE,
            EFFECTS_PLATE,
            THEME.outline,
          )
          .setOrigin(0, 0),
        scene.add
          .rectangle(EFFECTS_ICON_X, y + 1, ICON_PX, ICON_PX, PALETTE.grey3)
          .setOrigin(0, 0),
      )
    })

    // Textures: the masthead, the rows, the footer line.
    const tex: Phaser.GameObjects.GameObject[] = []
    const rows: EffectsTexts['rows'] = []
    const mast = frameOrNull(EFFECTS_ICON)
    if (mast)
      tex.push(
        scene.add
          .image(EFFECTS_ICON_X, EFFECTS_MAST_ICON_Y, UI_ATLAS, mast)
          .setOrigin(0, 0),
      )
    tex.push(
      addText(scene, EFFECTS_TEXT_X, textTop(0, EVENT_MAST_H), EFFECTS_TITLE),
    )
    const count = addText(scene, 0, textTop(0, EVENT_MAST_H), m.count, {
      tint: MUTED,
    })
    count.setX(Math.round(w - PAD - count.width))
    tex.push(count)
    m.rows.forEach((row, k) => {
      const y = effectsRowY(k)
      const icon = scene.add
        .image(
          EFFECTS_ICON_X,
          y + 1,
          UI_ATLAS,
          frameOrNull(row.icon) ?? EFFECTS_ICON,
        )
        .setOrigin(0, 0)
      const fit = fitEffectsRow(row, textW, measure)
      const line = addText(scene, EFFECTS_TEXT_X, textTop(y, LINE_H), fit.line)
      const sub = addText(
        scene,
        EFFECTS_TEXT_X,
        textTop(y + LINE_H, LINE_H),
        fit.sub,
        { tint: MUTED },
      )
      rows.push({ icon, line, sub })
      tex.push(icon, line, sub)
    })
    // `+N more` under the text column; the empty line at the left pad.
    const foot = this.footerText(m, w)
    const footer =
      foot === null
        ? null
        : addText(
            scene,
            m.more ? EFFECTS_TEXT_X : PAD,
            textTop(effectsRowY(m.rows.length), LINE_H),
            foot,
            { tint: MUTED },
          )
    if (footer) tex.push(footer)

    const close = new Button(scene, {
      x: PAD,
      y: effectsCloseY(m),
      w: inner,
      h: EFFECTS_BTN_H,
      label: EFFECTS_CLOSE_TEXT,
      face: 'secondary',
      minHit: this.L.minHit,
      id: EFFECTS_CLOSE_ID,
      onClick: () => this.dismiss(),
    })

    this.parts = [panel, ...shapes, ...tex, close]
    this.texts = { count, rows, footer }
    this.root.add(this.parts)
    // A rebuild mid-slide snaps to the new rect.
    this.stopSlide()
    this.root.setPosition(r.x, r.y).setVisible(true)
  }

  private slideIn(): void {
    const r = this.cardRect
    const tweens = this.scene.tweens
    if (!r || !tweens) return
    const proxy = { y: this.L.H }
    this.root.setY(proxy.y)
    this.slide = tweens.add({
      targets: proxy,
      y: r.y,
      duration: EVENT_CARD_IN_MS,
      ease: 'Back.easeOut',
      onUpdate: () => this.root.setY(Math.round(proxy.y)),
      onComplete: () => {
        this.slide = null
        this.root.setY(this.cardRect?.y ?? r.y)
      },
    })
  }

  private stopSlide(): void {
    if (!this.slide) return
    this.slide.stop()
    this.slide = null
    if (this.cardRect) this.root.setY(this.cardRect.y)
  }
}
