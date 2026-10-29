// Gesture classifier (phaser4-notes.md §4, city-view.md §10, plan.md §7):
// tap / double-tap / long-press / pan (+ fling) / discrete pinch / wheel,
// from scene-level pointer events. Durations come from the scene clock
// (this.time.now), never pointer.getDuration() (DOM timestamps cannot follow
// the synthetic clock of __pm.freeze/step). Coordinates are screen (game) px.
//
// Pointer ownership (M4 bug hunt): only pointers whose pointerdown THIS
// scene received take part in a gesture. A finger that went down on a HUD
// button (the HUD scene captures it, globalTopOnly) still shows up in the
// shared InputManager pointers and can deliver its move / up to this scene;
// reading `input.pointer1/2.isDown` turned such a tap during a city pan into
// a pinch (a spurious zoom, then a frozen pan), and its stray pointerup
// flung the camera with the other finger's velocity and made the next move
// re-apply the whole drag (a jump). Pointers are tracked by id; a lost up
// (captured elsewhere) is pruned on the next down by `isDown`.
//
// Phaser is a type-only import (event names are the string constants of
// src:input/events) so tests/render/gesture-pointer-ownership.test.ts drives
// the classifier under Node with a fake scene.
import type Phaser from 'phaser'

export const TAP_PX = 8
export const TAP_MS = 250
export const HOLD_MS = 450
export const PINCH_IN = 0.8
export const PINCH_OUT = 1.25
export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_PX = 16

/** Phaser.Input.Events / Phaser.Scenes.Events string values. */
const EV = {
  down: 'pointerdown',
  move: 'pointermove',
  up: 'pointerup',
  upOutside: 'pointerupoutside',
  gameOut: 'gameout',
  wheel: 'wheel',
  shutdown: 'shutdown',
} as const

export type Gesture = 'none' | 'maybe-tap' | 'pan' | 'pinch' | 'held'

/** The parts of Phaser.Input.Pointer the classifier reads. */
export interface GesturePointer {
  id: number
  x: number
  y: number
  isDown: boolean
  prevPosition: { x: number; y: number }
  velocity: { x: number; y: number }
  rightButtonDown(): boolean
}

type Listener = (...args: never[]) => void

/** The parts of Phaser.Scene the classifier uses (a fake in the tests). */
export interface GestureHost {
  input: {
    on(event: string, fn: Listener, context?: unknown): unknown
    off(event: string, fn: Listener, context?: unknown): unknown
  }
  time: { now: number }
  events: {
    once(event: string, fn: Listener, context?: unknown): unknown
    off(event: string, fn: Listener, context?: unknown): unknown
  }
}

export interface GestureHandlers {
  tap?: (x: number, y: number, p: GesturePointer) => void
  /** Second tap within DOUBLE_TAP_MS / DOUBLE_TAP_PX (the first tap already fired). */
  doubleTap?: (x: number, y: number, p: GesturePointer) => void
  /** HOLD_MS without moving, or a right-click (desktop parity). */
  longPress?: (x: number, y: number, p: GesturePointer) => void
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

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by)

export class GestureClassifier {
  readonly scene: GestureHost
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
  /** Pointers whose pointerdown this scene received, in down order. */
  private tracked = new Map<number, GesturePointer>()
  /** The pointer that taps / pans / long-presses (the first one down). */
  private primaryId: number | null = null

  constructor(
    scene: GestureHost | Phaser.Scene,
    handlers: GestureHandlers,
    opts: GestureOptions = {},
  ) {
    this.scene = scene as GestureHost
    this.handlers = handlers
    this.opts = opts
    const input = this.scene.input
    input.on(EV.down, this.onDown, this)
    input.on(EV.move, this.onMove, this)
    input.on(EV.up, this.onUp, this)
    input.on(EV.upOutside, this.cancel, this)
    input.on(EV.gameOut, this.cancel, this)
    input.on(EV.wheel, this.onWheel, this)
    this.scene.events.once(EV.shutdown, this.destroy, this)
  }

  /** Pointers currently taking part (tests / debugging). */
  get pointers(): number {
    return this.tracked.size
  }

  private now(): number {
    return this.scene.time.now
  }

  /** The first two tracked pointers still down, or null. */
  private pair(): [GesturePointer, GesturePointer] | null {
    let a: GesturePointer | null = null
    for (const p of this.tracked.values()) {
      if (!p.isDown) continue
      if (!a) a = p
      else return [a, p]
    }
    return null
  }

  private anyDown(): boolean {
    for (const p of this.tracked.values()) if (p.isDown) return true
    return false
  }

  private startPinch(a: GesturePointer, b: GesturePointer): void {
    this.gesture = 'pinch'
    this.pinchStart = dist(a.x, a.y, b.x, b.y)
    this.pinchArmed = this.pinchStart > 0
  }

  private onDown(p: GesturePointer): void {
    // An up this scene never saw (captured by a scene above) leaves a stale
    // entry: drop pointers that are no longer down.
    for (const [id, q] of this.tracked)
      if (id !== p.id && !q.isDown) this.tracked.delete(id)
    if (this.tracked.size === 0 || this.primaryId === null) {
      // A fresh gesture (whatever the last one was left as).
      if (this.opts.accept && !this.opts.accept(p.x, p.y)) return
      this.tracked.clear()
      this.gesture = 'none'
      this.pinchArmed = false
      this.primaryId = null
    }
    this.tracked.set(p.id, p)
    if (!this.opts.panOnly && p.rightButtonDown()) {
      this.primaryId = p.id
      this.gesture = 'held'
      this.handlers.longPress?.(p.x, p.y, p)
      return
    }
    if (!this.opts.panOnly) {
      const two = this.pair()
      if (two) {
        this.startPinch(two[0], two[1])
        return
      }
    }
    if (this.primaryId === null || this.primaryId === p.id) {
      this.primaryId = p.id
      this.gesture = 'maybe-tap'
      this.downAt = this.now()
      this.downX = p.x
      this.downY = p.y
    }
  }

  private onMove(p: GesturePointer): void {
    if (!this.tracked.has(p.id)) return
    if (!this.opts.panOnly) {
      const two = this.pair()
      if (two) {
        const [a, b] = two
        if (this.gesture !== 'pinch') {
          this.startPinch(a, b)
          return
        }
        if (!this.pinchArmed) return
        const ratio = dist(a.x, a.y, b.x, b.y) / this.pinchStart
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
    }
    if (p.id !== this.primaryId) return
    if (!p.isDown || this.gesture === 'pinch' || this.gesture === 'held') return
    if (this.gesture === 'maybe-tap' || this.gesture === 'none') {
      if (dist(p.x, p.y, this.downX, this.downY) <= TAP_PX) return
      this.gesture = 'pan'
      // The first pan step carries everything moved since the down event.
      this.handlers.panBy?.(p.x - this.downX, p.y - this.downY)
      return
    }
    if (this.gesture === 'pan')
      this.handlers.panBy?.(p.x - p.prevPosition.x, p.y - p.prevPosition.y)
  }

  private onUp(p: GesturePointer): void {
    // Not ours: its down went to a scene above (a HUD button).
    if (!this.tracked.has(p.id)) return
    this.tracked.delete(p.id)
    const primary = p.id === this.primaryId
    if (primary) {
      const t = this.now()
      if (
        !this.opts.panOnly &&
        this.gesture === 'maybe-tap' &&
        dist(p.x, p.y, this.downX, this.downY) <= TAP_PX &&
        t - this.downAt <= TAP_MS
      ) {
        const isDouble =
          t - this.lastTapAt <= DOUBLE_TAP_MS &&
          dist(p.x, p.y, this.lastTapX, this.lastTapY) <= DOUBLE_TAP_PX
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
    }
    if (!this.anyDown()) {
      this.end()
      return
    }
    if (primary) {
      // The other finger carries on; a later pan starts where it is now
      // (never from the first finger's down point).
      const next = [...this.tracked.values()].find((q) => q.isDown) ?? null
      this.primaryId = next?.id ?? null
      if (next) {
        this.downX = next.x
        this.downY = next.y
        this.downAt = this.now()
      }
      if (this.gesture === 'pan' || this.gesture === 'maybe-tap')
        this.gesture = 'none'
    }
  }

  private onWheel(
    p: GesturePointer,
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
    const p = this.primaryId === null ? null : this.tracked.get(this.primaryId)
    if (!p?.isDown) return
    if (this.now() - this.downAt > HOLD_MS) {
      this.gesture = 'held'
      this.handlers.longPress?.(this.downX, this.downY, p)
    }
  }

  private end(): void {
    this.gesture = 'none'
    this.tracked.clear()
    this.primaryId = null
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
    input.off(EV.down, this.onDown, this)
    input.off(EV.move, this.onMove, this)
    input.off(EV.up, this.onUp, this)
    input.off(EV.upOutside, this.cancel, this)
    input.off(EV.gameOut, this.cancel, this)
    input.off(EV.wheel, this.onWheel, this)
    this.tracked.clear()
  }
}
