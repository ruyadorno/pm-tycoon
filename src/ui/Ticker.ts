// News ticker (city-view.md §8.1, §9.7; plan.md §9): the 16-px strip under
// the top bar. Left cell (52 px): `Day N` over a fill that grows with the
// day's progress (payday visible approaching). Right region: one m5x7 line
// scrolling right-to-left at 40 px/s, each line once, from a queue of at
// most 8 with identical-text dedupe; after 90 s with nothing queued a
// `puns.json tickerFiller` line runs. While the game is paused the strip
// shows a blinking `PAUSED` (1 Hz) instead and the line holds its place.
//
// Pacing (report-playtest1 §6.6, plan-build2 §8.2 task 10): the strip trailed
// the clock (`Day 5: …` still scrolling at 13:16). Now a newer `Day N:` line
// drops the stale day lines still waiting, a waiting line older than
// TICKER_MAX_AGE_MS is dropped unread, and when more than 8 wait the cap
// evicts fillers, then day lines, then the other lines, and the important
// ones (the summary offer, a lost life, a level-up) last. Ages run on the
// ticker's own clock: the ms the strip has run unpaused (update()'s clamped
// deltas), so a pause, the Paused card or a hidden tab never ages the queue
// and a 2× run does not either (the player reads the strip in wall time).
//
// Clipping: the line scrolls under the Day cell, which is opaque and drawn
// above it, and leaves through the canvas edge on the right, so no camera
// viewport is needed (the HUD stays one camera, one batch).
//
// The queue is pure (TickerQueue, dailyLine) and unit-tested, as are the M2
// lines the HUD pushes (stallLine, defusedLine, incidentLine — city-view
// §3.2, §8.1); Phaser is a type-only import.
import type Phaser from 'phaser'
import type { TickerKind } from '../sim/events.ts'
import type { Layout } from './layout.ts'
import { addPanel, BAR_CAP } from './Panel.ts'
import { addText, formatInt, formatMoney, textTop } from './text.ts'
import { THEME } from './theme.ts'
import { UI_ATLAS } from '../render/atlases.ts'

export const TICKER_PX_PER_MS = 0.04
export const TICKER_QUEUE_MAX = 8
export const TICKER_FILLER_MS = 90_000
/**
 * A waiting line older than this (on the ticker's clock, see the header) is
 * dropped unread (report §6.6). A UI pacing constant, not a balance number.
 */
export const TICKER_MAX_AGE_MS = 90_000
export const PAUSED_BLINK_MS = 500
/** city-view §8.1 says 0.85; matched to the top bar's 0.94 (world text read through). */
export const TICKER_ALPHA = 0.94
export const DAY_FILL_ALPHA = 0.3

/**
 * Kinds the HUD queues: the sim's TickerKind plus view-generated ones —
 * `offer` is the once-per-run summary offer line (Q55).
 */
export type TickerLineKind = TickerKind | 'offer'

export interface TickerItem {
  text: string
  kind: TickerLineKind
}

/** A waiting line with its queue time on the ticker's clock (ms). */
export interface QueuedLine extends TickerItem {
  at: number
}

/** Lines the cap evicts last: the summary offer, a lost life, a level-up. */
export const TICKER_IMPORTANT: ReadonlySet<TickerLineKind> =
  new Set<TickerLineKind>(['offer', 'incident', 'level'])

/**
 * Eviction rank when more than `max` lines wait (lowest goes first): filler
 * 0, the daily summary 1, the other lines 2, TICKER_IMPORTANT 3.
 */
export function evictRank(kind: TickerLineKind): number {
  if (kind === 'filler') return 0
  if (kind === 'daily') return 1
  return TICKER_IMPORTANT.has(kind) ? 3 : 2
}

/**
 * At most `max` waiting lines, played in order; identical text is never
 * queued twice; a newer daily line replaces the waiting ones; lines older
 * than `maxAgeMs` are dropped; the cap evicts by evictRank, oldest first.
 * `now` is the caller's clock in ms (Ticker passes its unpaused clock).
 */
export class TickerQueue {
  current: TickerItem | null = null
  readonly waiting: QueuedLine[] = []
  readonly max: number
  readonly maxAgeMs: number

  constructor(max = TICKER_QUEUE_MAX, maxAgeMs = TICKER_MAX_AGE_MS) {
    this.max = max
    this.maxAgeMs = maxAgeMs
  }

  /** 'duplicate' when the text is scrolling or already waiting. */
  push(item: TickerItem, now = 0): 'queued' | 'duplicate' {
    if (!item.text) return 'duplicate'
    if (this.current?.text === item.text) return 'duplicate'
    this.prune(now)
    if (this.waiting.some((w) => w.text === item.text)) return 'duplicate'
    // `Day 6: …` supersedes a `Day 5: …` that never got to scroll.
    if (item.kind === 'daily') this.dropWhere((w) => w.kind === 'daily')
    this.waiting.push({ text: item.text, kind: item.kind, at: now })
    while (this.waiting.length > this.max) this.evict()
    return 'queued'
  }

  /** The current line finished (or none was showing): promote the next. */
  next(now = 0): TickerItem | null {
    this.prune(now)
    const q = this.waiting.shift()
    this.current = q ? { text: q.text, kind: q.kind } : null
    return this.current
  }

  /** Drop the waiting lines older than maxAgeMs at `now`. */
  prune(now: number): void {
    this.dropWhere((w) => now - w.at > this.maxAgeMs)
  }

  get size(): number {
    return this.waiting.length + (this.current ? 1 : 0)
  }

  clear(): void {
    this.current = null
    this.waiting.length = 0
  }

  /** Remove the lowest-ranked waiting line (the oldest of that rank). */
  private evict(): void {
    let at = -1
    let rank = Infinity
    this.waiting.forEach((w, i) => {
      const r = evictRank(w.kind)
      if (r < rank) {
        rank = r
        at = i
      }
    })
    if (at >= 0) this.waiting.splice(at, 1)
  }

  private dropWhere(pred: (w: QueuedLine) => boolean): void {
    for (let i = this.waiting.length - 1; i >= 0; i--)
      if (pred(this.waiting[i] as QueuedLine)) this.waiting.splice(i, 1)
  }
}

/** The §2 daily summary: `Day 3: 14 delivered, $312 earned, payroll $28`. */
export function dailyLine(
  day: number,
  delivered: number,
  earned: number,
  payroll: number,
): string {
  const parts = [
    `${formatInt(delivered)} delivered`,
    `${formatMoney(earned)} earned`,
  ]
  if (payroll > 0) parts.push(`payroll ${formatMoney(payroll)}`)
  return `Day ${day}: ${parts.join(', ')}`
}

/** city-view §3.2 / spec §6.4: the stall line per `lane:stalled` reason. */
export function stallLine(reason: string): string {
  if (reason === 'shelfFull') return 'Warehouse backed up — shelf full'
  if (reason === 'bufferFull') return 'Warehouse backed up — lane jammed'
  return 'Warehouse backed up — Hold Bay full'
}

/** city-view §8.1 `incident`: a malware Toss (`parcel:tossed {wasMalware}`). */
export function defusedLine(label: string): string {
  return `Close call! ${label} defused at the warehouse`
}

/** city-view §8.1 `incident`: `Malware delivered to Async Arms — 2 lives left`. */
export function incidentLine(buildingName: string, livesLeft: number): string {
  const n = Math.max(0, Math.floor(livesLeft))
  const left =
    n === 0 ? 'no lives left' : `${n} ${n === 1 ? 'life' : 'lives'} left`
  return `Malware delivered to ${buildingName} — ${left}`
}

export interface TickerOptions {
  /** puns.json tickerFiller lines, used in order. */
  fillers: readonly string[]
}

export class Ticker {
  readonly scene: Phaser.Scene
  readonly queue = new TickerQueue()
  private L: Layout
  private fillers: readonly string[]
  private fillerIndex = 0
  private strip: Phaser.GameObjects.NineSlice
  private line: Phaser.GameObjects.BitmapText
  private cell: Phaser.GameObjects.NineSlice
  private fill: Phaser.GameObjects.NineSlice
  private dayText: Phaser.GameObjects.BitmapText
  private pausedText: Phaser.GameObjects.BitmapText
  private x = 0
  private idleMs = 0
  /** The queue's clock: ms the strip has run unpaused (see the header). */
  private clockMs = 0
  private paused = false
  private progress = 0
  private day = 1

  constructor(scene: Phaser.Scene, L: Layout, opts: TickerOptions) {
    this.scene = scene
    this.L = L
    this.fillers = opts.fillers
    this.strip = addPanel(scene, 0, 0, L.W, L.ticker.h, 'ui_panel_dark')
    this.strip.setAlpha(TICKER_ALPHA)
    this.line = addText(scene, 0, 0, '', { tint: THEME.textLight })
    this.line.setVisible(false)
    this.pausedText = addText(scene, 0, 0, 'PAUSED', { tint: THEME.warn })
    this.pausedText.setVisible(false)
    this.cell = addPanel(
      scene,
      0,
      0,
      L.tickerDay.w,
      L.tickerDay.h,
      'ui_panel_dark',
    )
    // The bar-fill frame as a 9-slice (3-px edges) so it can be 16 px tall.
    this.fill = scene.add
      .nineslice(
        0,
        0,
        UI_ATLAS,
        'ui_bar_fill_blue',
        8,
        L.tickerDay.h,
        BAR_CAP,
        BAR_CAP,
        BAR_CAP,
        BAR_CAP,
      )
      .setOrigin(0, 0)
      .setAlpha(DAY_FILL_ALPHA)
    this.dayText = addText(scene, 0, 0, 'Day 1', { tint: THEME.textLight })
    this.relayout(L)
  }

  /** Objects in draw order. */
  get objects(): Phaser.GameObjects.GameObject[] {
    return [
      this.strip,
      this.line,
      this.pausedText,
      this.cell,
      this.fill,
      this.dayText,
    ]
  }

  /**
   * Depths from `base`: strip, then the line and PAUSED, then the opaque Day
   * cell over them (it hides the line scrolling out), its fill and label.
   */
  setDepth(base: number): this {
    this.strip.setDepth(base)
    this.line.setDepth(base + 1)
    this.pausedText.setDepth(base + 1)
    this.cell.setDepth(base + 2)
    this.fill.setDepth(base + 3)
    this.dayText.setDepth(base + 4)
    return this
  }

  /** Queue a line (deduped; at most 8, aged on the ticker's clock). */
  push(text: string, kind: TickerLineKind): void {
    if (this.queue.push({ text, kind }, this.clockMs) === 'queued')
      this.idleMs = 0
  }

  /** `Day N` (N = completed days + 1). */
  setDay(n: number): void {
    if (n === this.day) return
    this.day = n
    this.dayText.setText(`Day ${n}`)
    this.placeDay()
  }

  /** 0..1 through the current day. */
  setProgress(p: number): void {
    const q = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0))
    const w = Math.round(this.L.tickerDay.w * q)
    if (w === Math.round(this.L.tickerDay.w * this.progress)) {
      this.progress = q
      return
    }
    this.progress = q
    this.fill.setVisible(w >= 2 * BAR_CAP)
    if (w >= 2 * BAR_CAP) this.fill.setSize(w, this.L.tickerDay.h)
  }

  setPaused(on: boolean): void {
    this.paused = on
    if (!on) this.pausedText.setVisible(false)
  }

  /** The text on the strip right now (e2e / debug). */
  currentText(): string | null {
    return this.queue.current?.text ?? null
  }

  update(now: number, delta: number): void {
    if (this.paused) {
      this.line.setVisible(false)
      this.pausedText.setVisible(Math.floor(now / PAUSED_BLINK_MS) % 2 === 0)
      return
    }
    this.pausedText.setVisible(false)
    const d = Math.max(0, Math.min(delta, 100))
    this.clockMs += d
    if (!this.queue.current) {
      if (this.queue.next(this.clockMs)) this.start()
      else {
        this.idleMs += d
        if (this.idleMs >= TICKER_FILLER_MS && this.fillers.length > 0) {
          const text = this.fillers[this.fillerIndex % this.fillers.length]!
          this.fillerIndex++
          this.push(text, 'filler')
        }
        this.line.setVisible(false)
        return
      }
    }
    this.x -= d * TICKER_PX_PER_MS
    const left = this.L.tickerDay.x + this.L.tickerDay.w
    if (this.x + this.line.width < left) {
      this.queue.current = null
      this.idleMs = 0
      if (this.queue.next(this.clockMs)) this.start()
      else this.line.setVisible(false)
      return
    }
    this.line.setX(Math.round(this.x)).setVisible(true)
  }

  relayout(L: Layout): void {
    this.L = L
    const r = L.ticker
    this.strip.setPosition(r.x, r.y).setSize(r.w, r.h)
    const c = L.tickerDay
    this.cell.setPosition(c.x, c.y).setSize(c.w, c.h)
    this.fill.setPosition(c.x, c.y)
    this.line.setY(textTop(r.y, r.h))
    this.pausedText.setPosition(
      Math.round(c.x + c.w + (r.w - c.w - this.pausedText.width) / 2),
      textTop(r.y, r.h),
    )
    const p = this.progress
    this.progress = -1
    this.setProgress(p)
    this.placeDay()
  }

  destroy(): void {
    for (const o of this.objects) o.destroy()
  }

  private start(): void {
    const item = this.queue.current
    if (!item) return
    this.line.setText(item.text)
    this.x = this.L.ticker.x + this.L.ticker.w
    this.line.setX(Math.round(this.x)).setVisible(true)
  }

  private placeDay(): void {
    const c = this.L.tickerDay
    this.dayText.setPosition(
      Math.round(c.x + (c.w - this.dayText.width) / 2),
      textTop(c.y, c.h),
    )
  }
}
