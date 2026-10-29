// Toast lane (city-view.md §4.2): one lane at y = safeTop + 68 (L.toast),
// centred, a `ui_panel` NineSlice sized to the text + 12 px (6 each side),
// at most W − 24 wide (longer text wraps on spaces), shown 2.5 s (4 s for red
// ones), sliding in over 150 ms from 8 px above. One toast is visible at a
// time; at most 3 wait in the queue (the oldest waiting one drops). A toast
// whose text equals the one showing restarts its timer instead of queueing.
// The red variant (payroll short, wrong toss, walkout) uses red0 text; a
// normal toast may end in red from a character index (`Payday — payroll
// −$28`, the amount red: city-view §9.7) through BitmapText per-char tints.
// Not interactive: taps on the lane fall through (city-view.md §10).
//
// The HUD owns the single instance; with `listen: true` it also shows every
// `pm:toast {text, red?}` from game.events (removed on scene shutdown).
// Phaser is a type-only import so ToastQueue is unit-testable under Node.
import type Phaser from 'phaser'
import { addPanel } from './Panel.ts'
import { addText, lineCount, LINE_H, textTop } from './text.ts'
import { PALETTE, THEME } from './theme.ts'

export const TOAST_MS = 2500
export const TOAST_RED_MS = 4000
export const TOAST_IN_MS = 150
export const TOAST_OUT_MS = 150
export const TOAST_SLIDE_PX = 8
export const TOAST_PAD_X = 6
export const TOAST_LINE_BOX = 24
export const TOAST_QUEUE_MAX = 3
export const TOAST_DEPTH = 9000
export const EV_TOAST = 'pm:toast'

export interface ToastItem {
  text: string
  red: boolean
  /** Characters from this index on are drawn red (null: none). */
  redFrom?: number | null
}

/** MULTIPLY tint mode (Phaser.TintModes.MULTIPLY; Phaser is a type import here). */
const TINT_MULTIPLY = 0

/** Pure queue policy: one current item plus at most `max` waiting. */
export class ToastQueue {
  current: ToastItem | null = null
  readonly waiting: ToastItem[] = []
  readonly max: number

  constructor(max = TOAST_QUEUE_MAX) {
    this.max = max
  }

  /**
   * Add an item. Returns 'show' when nothing is showing (it became current),
   * 'restart' when it equals the current one, else 'queued'.
   */
  push(item: ToastItem): 'show' | 'restart' | 'queued' {
    if (!this.current) {
      this.current = item
      return 'show'
    }
    if (this.current.text === item.text && this.current.red === item.red)
      return 'restart'
    if (this.waiting.some((w) => w.text === item.text && w.red === item.red))
      return 'queued'
    this.waiting.push(item)
    // Older ones drop (city-view §4.2) — the oldest plain one first: a burst
    // (payday + mood + `Now playing`) must not push out the red payroll-short
    // or walkout toast queued before it.
    while (this.waiting.length > this.max) {
      const plain = this.waiting.findIndex((w) => !w.red)
      this.waiting.splice(plain >= 0 ? plain : 0, 1)
    }
    return 'queued'
  }

  /** The current item finished: promote the next one (or null). */
  next(): ToastItem | null {
    this.current = this.waiting.shift() ?? null
    return this.current
  }

  clear(): void {
    this.current = null
    this.waiting.length = 0
  }
}

export function toastDuration(red: boolean): number {
  return red ? TOAST_RED_MS : TOAST_MS
}

export interface ToastOptions {
  /** The lane rect (L.toast: x 12, y st + 68, w W − 24, h 24). */
  lane: { x: number; y: number; w: number; h: number }
  /** Canvas width; default scene.scale.width. */
  W?: number
  depth?: number
  /** Subscribe to `pm:toast` on game.events. */
  listen?: boolean
}

export class Toast {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  private panel: Phaser.GameObjects.NineSlice
  private text: Phaser.GameObjects.BitmapText
  private queue = new ToastQueue()
  private lane: ToastOptions['lane']
  private W: number
  private timer: Phaser.Time.TimerEvent | null = null
  private tween: Phaser.Tweens.Tween | null = null
  private listening = false
  private hiding = false
  private destroyed = false

  constructor(scene: Phaser.Scene, opts: ToastOptions) {
    this.scene = scene
    this.lane = { ...opts.lane }
    this.W = Math.round(opts.W ?? scene.scale.width)
    this.panel = addPanel(scene, 0, 0, 24, TOAST_LINE_BOX, 'ui_panel')
    this.text = addText(scene, TOAST_PAD_X, 0, '')
    this.root = scene.add
      .container(0, this.lane.y, [this.panel, this.text])
      .setDepth(opts.depth ?? TOAST_DEPTH)
      .setVisible(false)
    if (opts.listen) {
      this.listening = true
      scene.game.events.on(EV_TOAST, this.onEvent, this)
    }
    scene.events.once('shutdown', this.destroy, this)
  }

  /**
   * Queue a toast (red: the 4-s danger variant; redFrom: the characters from
   * that index on are red in a normal toast).
   */
  show(text: string, red = false, redFrom: number | null = null): void {
    if (this.destroyed || !text) return
    const r = this.queue.push({ text, red, redFrom })
    if (r === 'show') this.present()
    else if (r === 'restart') {
      if (this.hiding) {
        this.hiding = false
        this.tween?.stop()
        this.tween = null
        this.root.setAlpha(1).setY(this.lane.y)
      }
      this.armTimer()
    }
  }

  /** The text on screen, or null (e2e / debug). */
  currentText(): string | null {
    return this.queue.current?.text ?? null
  }

  /** Waiting items (not counting the visible one). */
  pending(): number {
    return this.queue.waiting.length
  }

  /** Drop everything and hide now. */
  clear(): void {
    this.queue.clear()
    this.timer?.remove(false)
    this.timer = null
    this.tween?.stop()
    this.tween = null
    this.hiding = false
    this.root.setVisible(false).setAlpha(1)
  }

  /** Re-fit to a new layout (pass L: uses L.toast and L.W). */
  relayout(L: { W: number; toast: ToastOptions['lane'] }): void {
    this.lane = { ...L.toast }
    this.W = Math.round(L.W)
    if (!this.queue.current) return
    this.tween?.stop()
    this.tween = null
    if (this.hiding) {
      // A stopped fade-out never reaches its onComplete: finish it here, or
      // the lane would keep a half-faded toast and never show the queue
      // (the HUD re-lays the lane on every city ↔ warehouse switch).
      this.hiding = false
      this.root.setVisible(false).setAlpha(1)
      if (this.queue.next()) this.present()
      return
    }
    this.fit()
    this.root.setY(this.lane.y)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.listening) this.scene.game.events.off(EV_TOAST, this.onEvent, this)
    this.scene.events.off('shutdown', this.destroy, this)
    this.timer?.remove(false)
    this.tween?.stop()
    this.root.destroy()
  }

  private onEvent(p: { text?: string; red?: boolean } | undefined): void {
    if (p?.text) this.show(p.text, !!p.red)
  }

  private fit(): void {
    const item = this.queue.current
    if (!item) return
    const maxW = Math.max(24, Math.round(this.lane.w))
    this.text.setMaxWidth(maxW - 2 * TOAST_PAD_X)
    this.text.setText(item.text)
    this.text.setTint(item.red ? PALETTE.red0 : THEME.textDark)
    // Per-character tints persist across setText: clear, then the red tail.
    if (item.text.length > 0) this.text.setCharacterTint(0, -1)
    const from = item.redFrom ?? null
    if (!item.red && from !== null && from >= 0 && from < item.text.length)
      this.text.setCharacterTint(from, -1, TINT_MULTIPLY, PALETTE.red0)
    const n = lineCount(this.text)
    const w = Math.min(maxW, Math.round(this.text.width) + 2 * TOAST_PAD_X)
    const h = TOAST_LINE_BOX + LINE_H * (n - 1)
    this.panel.setSize(w, h)
    this.text.setPosition(TOAST_PAD_X, textTop(0, h, n))
    this.root.setX(Math.round((this.W - w) / 2))
  }

  private present(): void {
    const item = this.queue.current
    if (!item) return
    this.fit()
    this.tween?.stop()
    this.root.setVisible(true).setAlpha(1)
    const proxy = { y: this.lane.y - TOAST_SLIDE_PX }
    this.root.setY(proxy.y)
    this.tween = this.scene.tweens.add({
      targets: proxy,
      y: this.lane.y,
      duration: TOAST_IN_MS,
      ease: 'Cubic.easeOut',
      onUpdate: () => this.root.setY(Math.round(proxy.y)),
      onComplete: () => {
        this.tween = null
        this.root.setY(this.lane.y)
      },
    })
    this.armTimer()
  }

  private armTimer(): void {
    const item = this.queue.current
    if (!item) return
    this.timer?.remove(false)
    this.timer = this.scene.time.delayedCall(toastDuration(item.red), () => {
      this.timer = null
      this.hide()
    })
  }

  private hide(): void {
    this.tween?.stop()
    this.hiding = true
    this.tween = this.scene.tweens.add({
      targets: this.root,
      alpha: 0,
      duration: TOAST_OUT_MS,
      onComplete: () => {
        this.tween = null
        this.hiding = false
        this.root.setVisible(false).setAlpha(1)
        if (this.queue.next()) this.present()
      },
    })
  }
}
