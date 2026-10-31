// Build 3 M12 (B3 §5): the confetti burst — four `fx_confetti_f0..f7` pieces
// stepped on the scene clock at 80 ms a frame, staggered 0 / 160 / 80 / 240
// ms (880 ms in all): confettiFrameAt before, during and after a piece, the
// frames packed in the world atlas, and the burst on a stub scene (one
// looping timer, the frames shown in turn, everything gone at the end or on
// stop(), null without a clock). No tween, scale, rotation or filter is ever
// asked of the images.
import { describe, expect, it, vi } from 'vitest'

const cf = await import('../../src/ui/confetti.ts')
const { inAtlas } = await import('../../src/render/frames.generated.ts')

describe('B3 §5: confettiFrameAt', () => {
  it('null before the delay, frames 0..7 at 80 ms each, null from the 8th step on', () => {
    expect(cf.confettiFrameAt(0, 160)).toBeNull()
    expect(cf.confettiFrameAt(159, 160)).toBeNull()
    expect(cf.confettiFrameAt(160, 160)).toBe(0)
    expect(cf.confettiFrameAt(239, 160)).toBe(0)
    expect(cf.confettiFrameAt(240, 160)).toBe(1)
    expect(cf.confettiFrameAt(160 + 7 * 80, 160)).toBe(7)
    expect(cf.confettiFrameAt(160 + 8 * 80 - 1, 160)).toBe(7)
    expect(cf.confettiFrameAt(160 + 8 * 80, 160)).toBeNull()
    expect(cf.confettiFrameAt(10_000, 0)).toBeNull()
  })

  it('four pieces of 32 px spread across 224 px, the burst lasting 880 ms', () => {
    expect(cf.CONFETTI_PIECES).toHaveLength(4)
    const xs = cf.CONFETTI_PIECES.map((p) => p.dx)
    expect(Math.min(...xs)).toBe(-112)
    expect(Math.max(...xs) + cf.CONFETTI_PX).toBe(112)
    expect(cf.confettiDurationMs()).toBe(240 + 8 * 80)
    expect(cf.CONFETTI_HALF_SPAN).toBe(112)
  })

  it('every frame is packed in the world atlas (the HUD binds world)', () => {
    for (let f = 0; f < cf.CONFETTI_FRAMES; f++)
      expect(inAtlas(`fx_confetti_f${f}`, 'world'), `f${f}`).toBe(true)
  })
})

interface FakeImg {
  x: number
  y: number
  frame: string
  visible: boolean
  destroyed: boolean
  calls: string[]
  setOrigin(): FakeImg
  setVisible(v: boolean): FakeImg
  setFrame(f: string): FakeImg
  destroy(): void
}

function fakeScene(withTime = true) {
  const imgs: FakeImg[] = []
  const timers: {
    cfg: { delay: number; loop?: boolean; callback: () => void }
    removed: boolean
  }[] = []
  const scene = {
    add: {
      image: (x: number, y: number, _atlas: string, frame: string) => {
        const img: FakeImg = {
          x,
          y,
          frame,
          visible: true,
          destroyed: false,
          calls: [],
          setOrigin() {
            this.calls.push('setOrigin')
            return this
          },
          setVisible(v) {
            this.visible = v
            return this
          },
          setFrame(f) {
            this.frame = f
            return this
          },
          destroy() {
            this.destroyed = true
          },
        }
        imgs.push(img)
        return img
      },
    },
    time: withTime
      ? {
          addEvent: (cfg: {
            delay: number
            loop?: boolean
            callback: () => void
          }) => {
            const t = { cfg, removed: false }
            timers.push(t)
            return {
              remove: () => {
                t.removed = true
              },
            }
          },
        }
      : undefined,
  }
  return { scene, imgs, timers }
}

describe('B3 §5: confettiBurst on the scene clock', () => {
  it('four hidden pieces over the top edge, one looping timer; the frames step and the burst ends itself', () => {
    const { scene, imgs, timers } = fakeScene()
    const added: unknown[] = []
    const b = cf.confettiBurst(scene as never, 180, 100, (img) =>
      added.push(img),
    )
    expect(b).not.toBeNull()
    expect(imgs).toHaveLength(4)
    expect(added).toEqual(imgs)
    expect(imgs.map((i) => i.x)).toEqual(
      cf.CONFETTI_PIECES.map((p) => 180 + p.dx),
    )
    expect(imgs.every((i) => i.y === 100 - cf.CONFETTI_LIFT)).toBe(true)
    // Only the undelayed piece shows at once, on its first frame.
    expect(imgs.map((i) => i.visible)).toEqual([true, false, false, false])
    expect(imgs[0]?.frame).toBe('fx_confetti_f0')
    expect(timers).toHaveLength(1)
    const t = timers[0]!
    expect(t.cfg.loop).toBe(true)
    expect(t.cfg.delay).toBe(cf.CONFETTI_TICK_MS)
    // 80 ms: piece 0 on frame 1, piece 2 (delay 80) on frame 0.
    t.cfg.callback()
    t.cfg.callback()
    expect(imgs[0]?.frame).toBe('fx_confetti_f1')
    expect(imgs[2]).toMatchObject({ visible: true, frame: 'fx_confetti_f0' })
    expect(imgs[1]?.visible).toBe(false)
    // Run to the end: every piece showed, then everything goes.
    const steps = cf.confettiDurationMs() / cf.CONFETTI_TICK_MS
    for (let i = 2; i < steps - 1; i++) t.cfg.callback()
    expect(b!.done).toBe(false)
    expect(imgs[3]?.frame).toBe('fx_confetti_f7')
    t.cfg.callback()
    expect(b!.done).toBe(true)
    expect(t.removed).toBe(true)
    expect(imgs.every((i) => i.destroyed)).toBe(true)
    // Further calls (a stale timer) and stop() are harmless.
    t.cfg.callback()
    b!.stop()
    // Frames only: no tween, scale, rotation or filter was ever asked.
    expect(imgs.flatMap((i) => i.calls)).toEqual(imgs.map(() => 'setOrigin'))
  })

  it('stop() removes the timer and destroys the pieces at once', () => {
    const { scene, imgs, timers } = fakeScene()
    const b = cf.confettiBurst(scene as never, 0, 0, () => {})!
    b.stop()
    expect(b.done).toBe(true)
    expect(timers[0]?.removed).toBe(true)
    expect(imgs.every((i) => i.destroyed)).toBe(true)
  })

  it('null without a scene clock (nothing is created)', () => {
    const { scene, imgs } = fakeScene(false)
    const add = vi.fn()
    expect(cf.confettiBurst(scene as never, 0, 0, add)).toBeNull()
    expect(imgs).toHaveLength(0)
    expect(add).not.toHaveBeenCalled()
  })
})
