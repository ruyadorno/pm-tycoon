// Gesture classifier (phaser4-notes.md §4, city-view.md §10, plan.md §7):
// tap / double-tap / long-press / pan (+ fling) / discrete pinch / wheel,
// from scene-level pointer events. Durations come from the scene clock
// (this.time.now), never pointer.getDuration() (DOM timestamps cannot follow
// the synthetic clock of __pm.freeze/step). Coordinates are screen (game) px.
import Phaser from 'phaser'

export const TAP_PX = 8
export const TAP_MS = 250
export const HOLD_MS = 450
export const PINCH_IN = 0.8
export const PINCH_OUT = 1.25
export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_PX = 16

export type Gesture = 'none' | 'maybe-tap' | 'pan' | 'pinch' | 'held'

export interface GestureHandlers {
  tap?: (x: number, y: number, p: Phaser.Input.Pointer) => void
  /** Second tap within DOUBLE_TAP_MS / DOUBLE_TAP_PX (the first tap already fired). */
  doubleTap?: (x: number, y: number, p: Phaser.Input.Pointer) => void
  /** HOLD_MS without moving, or a right-click (desktop parity). */
  longPress?: (x: number, y: number, p: Phaser.Input.Pointer) => void
  /** Drag delta in screen px since the previous move. */
  panBy?: (dx: number, dy: number) => void
  /** Drag released: pointer.velocity in px per input update (CameraRig.fling). */
  panEnd?: (vx: number, vy: number) => void
  /** Discrete pinch: 'in' (fingers apart, ratio >= PINCH_OUT) or 'out'. */
  pinch?: (dir: 'in' | 'out', cx: number, cy: number) => void
  /** Mouse wheel: +1 = zoom in (wheel up), -1 = zoom out. */
  wheel?: (dir: 1 | -1, x: number, y: number) => void
  /** Any gesture ended or was cancelled (pointer up outside, gameout). */
  reset?: () => void
}

export interface GestureOptions {
  /** Only start gestures whose first pointerdown satisfies this (sheet list areas). */
  accept?: (x: number, y: number) => boolean
  /** Pan only: no tap/long-press/pinch classification (sheet lists). */
  panOnly?: boolean
}

export class GestureClassifier {
  readonly scene: Phaser.Scene
  gesture: Gesture = 'none'
  private handlers: GestureHandlers
  private opts: GestureOptions
  private downAt = 0
  private downX = 0
  private downY = 0
  private lastTapAt = -Infinity
  private lastTapX = 0
  private lastTapY = 0
  private pinchStart = 0
  private pinchArmed = false
  private active = false

  constructor(
    scene: Phaser.Scene,
    handlers: GestureHandlers,
    opts: GestureOptions = {},
  ) {
    this.scene = scene
    this.handlers = handlers
    this.opts = opts
    const input = scene.input
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this)
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this)
    input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this)
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.cancel, this)
    input.on(Phaser.Input.Events.GAME_OUT, this.cancel, this)
    input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this)
  }

  private now(): number {
    return this.scene.time.now
  }

  private isPrimary(p: Phaser.Input.Pointer): boolean {
    return p === this.scene.input.activePointer || p.id <= 1
  }

  private twoDown(): boolean {
    const i = this.scene.input
    return i.pointer1.isDown && i.pointer2.isDown
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.opts.accept && !this.active && !this.opts.accept(p.x, p.y)) return
    this.active = true
    if (!this.opts.panOnly && p.rightButtonDown()) {
      this.gesture = 'held'
      this.handlers.longPress?.(p.x, p.y, p)
      return
    }
    if (!this.opts.panOnly && this.twoDown()) {
      const i = this.scene.input
      this.gesture = 'pinch'
      this.pinchStart = Phaser.Math.Distance.Between(
        i.pointer1.x,
        i.pointer1.y,
        i.pointer2.x,
        i.pointer2.y,
      )
      this.pinchArmed = this.pinchStart > 0
      return
    }
    if (this.isPrimary(p)) {
      this.gesture = 'maybe-tap'
      this.downAt = this.now()
      this.downX = p.x
      this.downY = p.y
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.active) return
    if (!this.opts.panOnly && this.twoDown()) {
      const i = this.scene.input
      const a = i.pointer1
      const b = i.pointer2
      if (this.gesture !== 'pinch') {
        this.gesture = 'pinch'
        this.pinchStart = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)
        this.pinchArmed = this.pinchStart > 0
        return
      }
      if (!this.pinchArmed) return
      const ratio =
        Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) / this.pinchStart
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      if (ratio >= PINCH_OUT) {
        this.pinchArmed = false
        this.handlers.pinch?.('in', cx, cy)
      } else if (ratio <= PINCH_IN) {
        this.pinchArmed = false
        this.handlers.pinch?.('out', cx, cy)
      }
      return
    }
    if (!p.isDown || this.gesture === 'pinch' || this.gesture === 'held') return
    if (this.gesture === 'maybe-tap' || this.gesture === 'none') {
      if (
        Phaser.Math.Distance.Between(p.x, p.y, this.downX, this.downY) <= TAP_PX
      )
        return
      this.gesture = 'pan'
      // The first pan step carries everything moved since the down event.
      this.handlers.panBy?.(p.x - this.downX, p.y - this.downY)
      return
    }
    if (this.gesture === 'pan')
      this.handlers.panBy?.(p.x - p.prevPosition.x, p.y - p.prevPosition.y)
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!this.active) return
    const t = this.now()
    if (
      !this.opts.panOnly &&
      this.gesture === 'maybe-tap' &&
      Phaser.Math.Distance.Between(p.x, p.y, this.downX, this.downY) <=
        TAP_PX &&
      t - this.downAt <= TAP_MS
    ) {
      const isDouble =
        t - this.lastTapAt <= DOUBLE_TAP_MS &&
        Phaser.Math.Distance.Between(p.x, p.y, this.lastTapX, this.lastTapY) <=
          DOUBLE_TAP_PX
      if (isDouble) {
        this.lastTapAt = -Infinity
        this.handlers.doubleTap?.(p.x, p.y, p)
      } else {
        this.lastTapAt = t
        this.lastTapX = p.x
        this.lastTapY = p.y
        this.handlers.tap?.(p.x, p.y, p)
      }
    }
    if (this.gesture === 'pan')
      this.handlers.panEnd?.(p.velocity.x, p.velocity.y)
    const i = this.scene.input
    if (!i.pointer1.isDown && !i.pointer2.isDown && !i.mousePointer?.isDown)
      this.end()
    else if (this.gesture === 'pan' || this.gesture === 'maybe-tap')
      this.gesture = 'none'
  }

  private onWheel(
    p: Phaser.Input.Pointer,
    _over: unknown,
    _dx: number,
    dy: number,
  ): void {
    if (this.opts.panOnly) {
      this.handlers.panBy?.(0, -dy)
      return
    }
    if (dy === 0) return
    if (this.opts.accept && !this.opts.accept(p.x, p.y)) return
    this.handlers.wheel?.(dy < 0 ? 1 : -1, p.x, p.y)
  }

  /** Poll from scene.update(): fires the long-press. */
  update(): void {
    if (this.opts.panOnly || this.gesture !== 'maybe-tap') return
    const p = this.scene.input.activePointer
    if (!p.isDown) return
    if (this.now() - this.downAt > HOLD_MS) {
      this.gesture = 'held'
      this.handlers.longPress?.(this.downX, this.downY, p)
    }
  }

  private end(): void {
    this.gesture = 'none'
    this.active = false
    this.pinchArmed = false
    this.handlers.reset?.()
  }

  /** Pointer lost (up outside the canvas, iOS system gesture): drop everything. */
  cancel(): void {
    if (this.gesture === 'pan') this.handlers.panEnd?.(0, 0)
    this.end()
  }

  destroy(): void {
    const input = this.scene.input
    input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this)
    input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this)
    input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this)
    input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.cancel, this)
    input.off(Phaser.Input.Events.GAME_OUT, this.cancel, this)
    input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this)
  }
}
