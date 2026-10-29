// NineSlice helpers (style-guide.md §1.7, phaser4-notes.md §8, artUi hand-off):
// every ui_* panel/button/chip frame is 16x16 with 4-px corners; the bar
// frames (ui_bar_track, ui_bar_fill_*) are 8x8 horizontal 3-slices with 3-px
// caps. All panels use origin (0, 0) and integer rects. Phaser is a type-only
// import so the pure helpers are unit-testable under Node.
import type Phaser from 'phaser'
import type { FrameName } from '../render/frames.ts'
import { UI_ATLAS } from '../render/atlases.ts'

/** Corner size of the 16x16 UI nine-slices. */
export const SLICE = 4
/** Cap width of the 8x8 bar 3-slices, and their fixed height. */
export const BAR_CAP = 3
export const BAR_H = 8

export type PanelFrame = Extract<
  FrameName,
  | 'ui_panel'
  | 'ui_panel_dark'
  | 'ui_card_held'
  | 'ui_tooltip'
  | 'ui_tag'
  | 'ui_tab'
  | 'ui_chip'
  | 'ui_chip_active'
  | `ui_btn${string}`
>

export type BarFrame = Extract<FrameName, `ui_bar_${string}`>

export type BarColour = 'green' | 'amber' | 'red' | 'blue'

export const BAR_FILL: Record<BarColour, BarFrame> = {
  green: 'ui_bar_fill_green',
  amber: 'ui_bar_fill_amber',
  red: 'ui_bar_fill_red',
  blue: 'ui_bar_fill_blue',
}

/** A `frame` nine-slice at the integer rect (x, y, w, h), origin (0, 0). */
export function addPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: PanelFrame = 'ui_panel',
): Phaser.GameObjects.NineSlice {
  return scene.add
    .nineslice(
      Math.round(x),
      Math.round(y),
      UI_ATLAS,
      frame,
      Math.max(2 * SLICE, Math.round(w)),
      Math.max(2 * SLICE, Math.round(h)),
      SLICE,
      SLICE,
      SLICE,
      SLICE,
    )
    .setOrigin(0, 0)
}

/** Move/resize a panel made by addPanel to an integer rect. */
export function setPanelRect(
  p: Phaser.GameObjects.NineSlice,
  r: { x: number; y: number; w: number; h: number },
): Phaser.GameObjects.NineSlice {
  p.setPosition(Math.round(r.x), Math.round(r.y))
  p.setSize(
    Math.max(2 * SLICE, Math.round(r.w)),
    Math.max(2 * SLICE, Math.round(r.h)),
  )
  return p
}

/**
 * A horizontal bar 3-slice (8 px tall): `ui_bar_track` or a fill. Resize the
 * width with `setBarWidth`; the height is fixed by the frame.
 */
export function addBar(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  frame: BarFrame = 'ui_bar_track',
): Phaser.GameObjects.NineSlice {
  return scene.add
    .nineslice(
      Math.round(x),
      Math.round(y),
      UI_ATLAS,
      frame,
      Math.max(2 * BAR_CAP, Math.round(w)),
      BAR_H,
      BAR_CAP,
      BAR_CAP,
    )
    .setOrigin(0, 0)
}

/**
 * Pixel width of a bar fill for `frac` of a `trackW` track: 0 (hide it) at or
 * below 0, else at least the two caps and at most the track.
 */
export function barFillWidth(trackW: number, frac: number): number {
  const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0
  if (f <= 0 || trackW <= 0) return 0
  return Math.min(
    Math.round(trackW),
    Math.max(2 * BAR_CAP, Math.round(trackW * f)),
  )
}

/** Set a bar fill to `frac` of `trackW` (hidden at 0). */
export function setBarFill(
  fill: Phaser.GameObjects.NineSlice,
  trackW: number,
  frac: number,
): Phaser.GameObjects.NineSlice {
  const w = barFillWidth(trackW, frac)
  fill.setVisible(w > 0)
  if (w > 0) fill.setSize(w, BAR_H)
  return fill
}

/** The fill frame for a state colour. */
export function barFrame(colour: BarColour): BarFrame {
  return BAR_FILL[colour]
}
