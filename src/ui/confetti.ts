// Build 3 M12 (B3 §5): the confetti burst — four `fx_confetti_f0..f7` pieces
// stepped on the scene clock (80 ms a frame, staggered), for the VictoryCard
// and the Golden Release stamp. No tween, scale, rotation or filter (the
// frame step copies LivesRow.loseLife); frozen-clock safe. Phaser is a
// type-only import.
import type Phaser from 'phaser'
import { UI_ATLAS } from '../render/atlases.ts'
import { frameOrNull } from '../render/frames.ts'

export const CONFETTI_FRAMES = 8
export const CONFETTI_STEP_MS = 80
export const CONFETTI_PX = 32
export const CONFETTI_PIECES: readonly { dx: number; delayMs: number }[] = [
  { dx: -112, delayMs: 0 },
  { dx: -48, delayMs: 160 },
  { dx: 16, delayMs: 80 },
  { dx: 80, delayMs: 240 },
]
/**
 * How far the pieces reach either side of `cx` (dx −112 … 80 + 32): a caller
 * near a screen edge clamps `cx` to at least this (the quest stamp, M12
 * critique 15) so no piece lands off screen.
 */
export const CONFETTI_HALF_SPAN = Math.max(
  ...CONFETTI_PIECES.map((p) => Math.max(-p.dx, p.dx + CONFETTI_PX)),
)
/** The burst's clock: one timer call every half frame step. */
export const CONFETTI_TICK_MS = CONFETTI_STEP_MS / 2
/** How far above `top` the pieces' tops sit (half a piece over the edge). */
export const CONFETTI_LIFT = 16

/** The piece's frame at `elapsedMs`: null before its delay or once its 8 frames ran. */
export function confettiFrameAt(
  elapsedMs: number,
  delayMs: number,
): number | null {
  if (elapsedMs < delayMs) return null
  const f = Math.floor((elapsedMs - delayMs) / CONFETTI_STEP_MS)
  return f >= CONFETTI_FRAMES ? null : f
}

/** The burst's length: the last piece's delay plus its eight frames (880 ms). */
export function confettiDurationMs(
  pieces: readonly { delayMs: number }[] = CONFETTI_PIECES,
): number {
  let last = 0
  for (const p of pieces) last = Math.max(last, p.delayMs)
  return last + CONFETTI_FRAMES * CONFETTI_STEP_MS
}

export interface ConfettiBurst {
  stop(): void
  readonly done: boolean
}

/**
 * One burst centred on `cx`, its pieces' tops at `top − 16`; `add` places
 * each image (a container, a depth). Null when the atlas has no confetti or
 * the scene has no clock.
 *
 * The images start hidden; a looping scene-clock timer (CONFETTI_TICK_MS)
 * advances the burst's own elapsed time and shows each piece's frame
 * (confettiFrameAt). Once every piece ran its frames the timer is removed
 * and the images destroyed. `stop()` does the same at once (call it before
 * destroying the container that holds the images — VictoryCard.teardown).
 */
export function confettiBurst(
  scene: Phaser.Scene,
  cx: number,
  top: number,
  add: (img: Phaser.GameObjects.Image) => void,
): ConfettiBurst | null {
  if (frameOrNull('fx_confetti_f0') === null || !scene.time) return null
  const y = Math.round(top - CONFETTI_LIFT)
  const imgs = CONFETTI_PIECES.map((p) => {
    const img = scene.add
      .image(Math.round(cx + p.dx), y, UI_ATLAS, 'fx_confetti_f0')
      .setOrigin(0, 0)
      .setVisible(false)
    add(img)
    return img
  })
  const end = confettiDurationMs()
  let elapsed = 0
  let done = false
  let timer: Phaser.Time.TimerEvent | null = null
  const stop = (): void => {
    if (done) return
    done = true
    timer?.remove(false)
    timer = null
    for (const img of imgs) img.destroy()
  }
  const apply = (): void => {
    CONFETTI_PIECES.forEach((p, i) => {
      const img = imgs[i]
      if (!img) return
      const f = confettiFrameAt(elapsed, p.delayMs)
      img.setVisible(f !== null)
      if (f !== null) img.setFrame(`fx_confetti_f${f}`)
    })
  }
  const step = (): void => {
    if (done) return
    elapsed += CONFETTI_TICK_MS
    if (elapsed >= end) stop()
    else apply()
  }
  apply() // the first piece shows its first frame at once
  timer = scene.time.addEvent({
    delay: CONFETTI_TICK_MS,
    loop: true,
    callback: step,
  })
  return {
    stop,
    get done(): boolean {
      return done
    },
  }
}
