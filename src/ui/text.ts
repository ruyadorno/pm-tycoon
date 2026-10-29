// BitmapText helpers for the UI kit (city-view.md §4, style-guide.md §1.7,
// phaser4-notes.md §7): m5x7 at 16 px (32 px only for the Title and the LEVEL
// UP stamp), integer positions, optional 1-px drop shadow (city overlay text
// only), and the number formats the HUD and panels share.
// Phaser is imported as a type only, so the pure formatters below are
// unit-testable under Node (tests/ui/text.test.ts).
import type Phaser from 'phaser'
import { FONT_KEY } from '../render/atlases.ts'
import { FONT_SIZE, THEME } from './theme.ts'

/** m5x7 metrics at 16 px (art/final/font, public/assets/m5x7.xml). */
export const LINE_H = 14
/** Rows from a glyph cell's top to the cap top, and the cap height. */
export const CAP_TOP = 4
export const CAP_H = 7

/** U+2212, the minus the font draws for negative amounts (`−$28`). */
export const MINUS = '−'

/** `1,234` (rounded, thousands separators; negative numbers use `−`). */
export function formatInt(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0)
  const abs = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return v < 0 ? MINUS + abs : abs
}

/** `$1,234`, `−$28` (no decimals). */
export function formatMoney(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0)
  const s = '$' + formatInt(Math.abs(v))
  return v < 0 ? MINUS + s : s
}

/** `+$12` / `−$28` / `$0`: a money delta for popups and ledger lines. */
export function formatMoneyDelta(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0)
  return v > 0 ? '+' + formatMoney(v) : formatMoney(v)
}

/**
 * `m:ss` for a countdown in seconds (`Payday in 0:23`): partial seconds round
 * up so the clock reads 0:00 only when the time is really up; minutes are not
 * padded and are not wrapped into hours.
 */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** `97%` (rounded). */
export function formatPct(n: number): string {
  return `${Math.round(Number.isFinite(n) ? n : 0)}%`
}

/**
 * The y for a BitmapText of `lines` lines whose caps sit centred in the band
 * [top, top + h) (the artUi sign formula: cap top 4, cap height 7, pitch 14).
 */
export function textTop(top: number, h: number, lines = 1): number {
  const ink = CAP_H + LINE_H * (Math.max(1, lines) - 1)
  return top + Math.floor((h - ink) / 2) - CAP_TOP
}

/** Line count of a BitmapText after wrapping (1 for empty text). */
export function lineCount(t: Phaser.GameObjects.BitmapText): number {
  const b = t.getTextBounds(false)
  return Math.max(1, b.lines?.lengths?.length ?? 1)
}

export interface TextOptions {
  /** 16 (default) or 32; never anything else (crispness, notes §7). */
  size?: 16 | 32
  /** Palette tint; default THEME.textDark (text on light panels). */
  tint?: number
  /** 1-px black drop shadow (city overlay text only, style-guide §1.7). */
  shadow?: boolean
  /** Wrap width in px (wraps on spaces only). */
  maxWidth?: number
  /** 'left' (default), 'center' or 'right' alignment of wrapped lines. */
  align?: 'left' | 'center' | 'right'
}

/** True once PreloadScene registered the m5x7 BitmapFont. */
export function hasFont(scene: Phaser.Scene): boolean {
  return scene.cache.bitmapFont.has(FONT_KEY)
}

/** A m5x7 BitmapText at integer (x, y), origin top-left. */
export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: TextOptions = {},
): Phaser.GameObjects.BitmapText {
  const t = scene.add.bitmapText(
    Math.round(x),
    Math.round(y),
    FONT_KEY,
    text,
    opts.size ?? FONT_SIZE,
  )
  t.setTint(opts.tint ?? THEME.textDark)
  if (opts.maxWidth) t.setMaxWidth(Math.floor(opts.maxWidth))
  if (opts.align === 'center') t.setCenterAlign()
  else if (opts.align === 'right') t.setRightAlign()
  if (opts.shadow) t.setDropShadow(1, 1, THEME.shadow, 1)
  return t
}

/** Rounded width of a BitmapText (its current text). */
export function textWidth(t: Phaser.GameObjects.BitmapText): number {
  return Math.round(t.width)
}

/**
 * Place `t` centred in `r` (x centred on the text width, y on the cap band)
 * at integer coordinates. `r` is in the coordinates of `t`'s parent.
 */
export function centreText(
  t: Phaser.GameObjects.BitmapText,
  r: { x: number; y: number; w: number; h: number },
): Phaser.GameObjects.BitmapText {
  t.setOrigin(0, 0)
  t.setPosition(
    Math.round(r.x + (r.w - t.width) / 2),
    textTop(r.y, r.h, lineCount(t)),
  )
  return t
}

/**
 * Shorten `text` with `…` until `measure(text) <= maxW` (single-line labels
 * in fixed-width cells). `measure` is usually `s => t.setText(s).width`.
 */
export function ellipsize(
  text: string,
  maxW: number,
  measure: (s: string) => number,
): string {
  if (measure(text) <= maxW) return text
  let s = text
  while (s.length > 0 && measure(s + '…') > maxW) s = s.slice(0, -1)
  return s.trimEnd() + '…'
}
