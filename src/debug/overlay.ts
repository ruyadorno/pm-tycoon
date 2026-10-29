// Debug overlay (plan.md §6.8): fps, sim tick, sprites, sim ms/tick, draw
// calls. Phaser Text is allowed here only (phaser4-notes.md §7). Installed in
// debug builds (import.meta.env.DEV || ?debug=1); the HUD scene (or, in M0,
// the Gallery) mounts it with mountOverlay(scene). __pm.overlay(false) hides
// it for screenshots.
import Phaser from 'phaser'
import type { Stepper } from '../boot/stepper.ts'

export const REG_OVERLAY = 'overlay'
export const REG_DRAW_CALLS = 'drawCalls'

interface CountingRenderer {
  drawElements: (...args: unknown[]) => unknown
  drawInstancedArrays: (...args: unknown[]) => unknown
}

export interface DrawCallCounter {
  /** Draw calls issued by the last completed frame (incl. DynamicTexture renders). */
  readonly lastFrame: number
  /** Running total since install. */
  readonly total: number
}

/**
 * Wrap the WebGL renderer's two draw entry points (drawElements,
 * drawInstancedArrays) to count calls per frame; Phaser 4 keeps no counter of
 * its own. Idempotent per game.
 */
export function installDrawCallCounter(game: Phaser.Game): DrawCallCounter {
  const existing = game.registry.get(REG_DRAW_CALLS) as
    | DrawCallCounter
    | undefined
  if (existing) return existing
  let frame = 0
  let last = 0
  let total = 0
  const r = game.renderer as unknown as Partial<CountingRenderer>
  for (const name of ['drawElements', 'drawInstancedArrays'] as const) {
    const orig = r[name]
    if (typeof orig !== 'function') continue
    r[name] = function (this: unknown, ...args: unknown[]) {
      frame++
      total++
      return orig.apply(this, args)
    }
  }
  game.events.on(Phaser.Core.Events.PRE_RENDER, () => {
    frame = 0
  })
  game.events.on(Phaser.Core.Events.POST_RENDER, () => {
    last = frame
  })
  const counter: DrawCallCounter = {
    get lastFrame() {
      return last
    },
    get total() {
      return total
    },
  }
  game.registry.set(REG_DRAW_CALLS, counter)
  return counter
}

/** Display-list objects across every active scene. */
export function countSprites(game: Phaser.Game): number {
  let n = 0
  for (const s of game.scene.getScenes(true)) n += s.children.length
  return n
}

export interface OverlayStats {
  fps: number
  tick: number
  sprites: number
  simMsPerTick: number
  drawCalls: number
}

export function overlayStats(game: Phaser.Game): OverlayStats {
  const stepper = game.registry.get('stepper') as Stepper | undefined
  const counter = game.registry.get(REG_DRAW_CALLS) as
    | DrawCallCounter
    | undefined
  return {
    fps: Math.round(game.loop.actualFps),
    tick: stepper?.ticks ?? 0,
    sprites: countSprites(game),
    simMsPerTick: stepper?.simMsPerTick ?? 0,
    drawCalls: counter?.lastFrame ?? 0,
  }
}

/**
 * Mount the overlay text in `scene` at its camera's top-left (scroll factor 0,
 * depth above everything). Returns the Text; it updates itself at 4 Hz and
 * follows registry 'overlay' (true = visible).
 */
export function mountOverlay(
  scene: Phaser.Scene,
  x = 2,
  y = 2,
): Phaser.GameObjects.Text {
  const game = scene.game
  installDrawCallCounter(game)
  if (game.registry.get(REG_OVERLAY) === undefined)
    game.registry.set(REG_OVERLAY, true)
  const text = scene.add
    .text(x, y, '', {
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontSize: '10px',
      color: '#fcf9f1',
      backgroundColor: '#241e32cc',
      padding: { x: 2, y: 1 },
    })
    .setScrollFactor(0)
    .setDepth(1e6)
    .setResolution(1)
  let last = -Infinity
  const refresh = (): void => {
    text.setVisible(game.registry.get(REG_OVERLAY) !== false)
    if (!text.visible) return
    const now = scene.time.now
    if (now - last < 250) return
    last = now
    const s = overlayStats(game)
    const stepper = game.registry.get('stepper') as Stepper | undefined
    const speed = stepper
      ? stepper.paused
        ? 'pause'
        : `${stepper.speed}x`
      : '-'
    text.setText(
      `${s.fps}fps t${s.tick} ${speed} spr${s.sprites} ` +
        `sim${s.simMsPerTick.toFixed(2)}ms dc${s.drawCalls}`,
    )
  }
  scene.events.on(Phaser.Scenes.Events.UPDATE, refresh)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, refresh)
  })
  return text
}
